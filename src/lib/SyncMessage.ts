export {}

const ENDPOINT_ORIGIN = "https://255.255.255.255"
const ENDPOINT_PREFIX = `${ENDPOINT_ORIGIN}/${browser.extension.getURL("")}?`
const MOZILLA = "mozSystem" in XMLHttpRequest.prototype

if (browser.webRequest) {
  if (typeof browser.runtime.onSyncMessage !== "object") {
    // Background Script side

    const pending = new Map()
    if (MOZILLA) {
      // we don't care this is async, as long as it get called before the
      // sync XHR (we are not interested in the response on the content side)
      browser.runtime.onMessage.addListener((m, sender) => {
        const wrapper = m.__syncMessage__
        if (!wrapper) return
        const { id } = wrapper
        pending.set(id, wrapper)
        let result
        const unsuspend = result => {
          pending.delete(id)
          if (wrapper.unsuspend) {
            wrapper.unsuspend()
          }
          return result
        }
        try {
          result = notifyListeners(JSON.stringify(wrapper.payload), sender)
        } catch (e) {
          unsuspend()
          throw e
        }
        /*
          // Uncomment me to add artificial delay for debugging purposes
          let tmpResult = result;
          result = new Promise(resolve => setTimeout(() => resolve(tmpResult), 500));
          */
        return (result instanceof Promise
          ? result
          : new Promise(resolve => resolve(result))
        ).then(result => unsuspend(result))
      })
    }

    const tabUrlCache = new Map()
    const asyncResults = new Map()
    let tabRemovalListener = null
    const CANCEL = { cancel: true }
    const { TAB_ID_NONE } = browser.tabs

    const onBeforeRequest = request => {
      try {
        const { url, tabId } = request
        const params = new URLSearchParams(url.split("?")[1])
        const msgId = params.get("id")
        if (asyncResults.has(msgId)) {
          return asyncRet(msgId)
        }
        const msg = params.get("msg")

        if (MOZILLA || tabId === TAB_ID_NONE) {
          // this shoud be a mozilla suspension request
          return params.get("suspend")
            ? new Promise(resolve => {
                if (pending.has(msgId)) {
                  const wrapper = pending.get(msgId)
                  if (!wrapper.unsuspend) {
                    wrapper.unsuspend = resolve
                  } else {
                    const { unsuspend } = wrapper
                    wrapper.unsuspend = () => {
                      unsuspend()
                      resolve()
                    }
                  }
                  return
                }
                resolve()
              }).then(() => ret("go on"))
            : CANCEL // otherwise, bail
        }
        // CHROME from now on
        const documentUrl = params.get("url")
        const { frameAncestors, frameId } = request
        const isTop = frameId === 0 || !!params.get("top")
        let tabUrl =
          frameAncestors &&
          frameAncestors.length &&
          frameAncestors[frameAncestors.length - 1].url

        if (!tabUrl) {
          if (isTop) {
            tabUrlCache.set(tabId, (tabUrl = documentUrl))
            if (!tabRemovalListener) {
              browser.tabs.onRemoved.addListener(
                (tabRemovalListener = tab => {
                  tabUrlCache.delete(tab.id)
                })
              )
            }
          } else {
            tabUrl = tabUrlCache.get(tabId)
          }
        }
        const sender = {
          tab: {
            id: tabId,
            url: tabUrl,
          },
          frameId,
          url: documentUrl,
          timeStamp: Date.now(),
        }

        if (!(msg !== null && sender)) {
          return CANCEL
        }
        let result = notifyListeners(msg, sender)
        if (result instanceof Promise) {
          // On Chromium, if the promise is not resolved yet,
          // we redirect the XHR to the same URL (hence same msgId)
          // while the result get cached for asynchronous retrieval
          result.then(r => {
            asyncResults.set(msgId, (result = r))
          })
          return asyncResults.has(msgId)
            ? asyncRet(msgId) // promise was already resolved
            : {
                redirectUrl: url.replace(
                  /&redirects=(\d+)|$/, // redirects count to avoid loop detection
                  (all, count) => `&redirects=${parseInt(count) + 1 || 1}`
                ),
              }
        }
        return ret(result)
      } catch (e) {
        console.error(e)
        return CANCEL
      }
    }

    const onHeaderReceived = request => {
      let replaced = ""
      const { responseHeaders } = request
      const rxFP = /^feature-policy$/i
      for (const h of request.responseHeaders) {
        if (rxFP.test(h.name)) {
          h.value = h.value.replace(
            /\b(sync-xhr\s+)([^*][^;]*)/g,
            (all, m1, m2) => (replaced = `${m1}${m2.replace(/'none'/, "")} 'self'`)
          )
        }
      }
      return replaced ? { responseHeaders } : null
    }

    const ret = r => ({ redirectUrl: `data:application/json,${JSON.stringify(r)}` })
    const asyncRet = msgId => {
      const result = asyncResults.get(msgId)
      asyncResults.delete(msgId)
      return ret(result)
    }

    const listeners = new Set()
    function notifyListeners(msg, sender) {
      // Just like in the async runtime.sendMessage() API,
      // we process the listeners in order until we find a not undefined
      // result, then we return it (or undefined if none returns anything).
      for (const l of listeners) {
        try {
          const result = l(JSON.parse(msg), sender)
          if (result !== undefined) return result
        } catch (e) {
          console.error("%o processing message %o from %o", e, msg, sender)
        }
      }
    }
    browser.runtime.onSyncMessage = {
      ENDPOINT_PREFIX,
      addListener(l) {
        listeners.add(l)
        if (listeners.size === 1) {
          browser.webRequest.onBeforeRequest.addListener(
            onBeforeRequest,
            {
              urls: [`${ENDPOINT_PREFIX}*`],
              types: ["xmlhttprequest"],
            },
            ["blocking"]
          )
          browser.webRequest.onHeadersReceived.addListener(
            onHeaderReceived,
            {
              urls: ["<all_urls>"],
              types: ["main_frame", "sub_frame"],
            },
            ["blocking", "responseHeaders"]
          )
        }
      },
      removeListener(l) {
        listeners.remove(l)
        if (listeners.size === 0) {
          browser.webRequest.onBeforeRequest.removeListener(onBeforeRequest)
          browser.webRequest.onHeadersReceived.removeListener(onHeadersReceived)
        }
      },
      hasListener(l) {
        return listeners.has(l)
      },
    }
  }
} else if (typeof browser.runtime.sendSyncMessage !== "function") {
  // Content Script side
  const uuid = () => (Math.random() * Date.now()).toString(16)
  const docUrl = document.URL
  browser.runtime.sendSyncMessage = (msg, callback) => {
    const msgId = `${uuid()},${docUrl}`
    let url =
      `${ENDPOINT_PREFIX}id=${encodeURIComponent(msgId)}` +
      `&url=${encodeURIComponent(docUrl)}`
    if (window.top === window) {
      // we add top URL information because Chromium doesn't know anything
      // about frameAncestors
      url += "&top=true"
    }

    if (MOZILLA) {
      const startTime = Date.now() // DEV_ONLY
      const suspendURL = url + "&suspend=true"
      let suspended = 0
      let suspendedId = 0
      const suspend = () => {
        suspended++
        const id = suspendedId++
        console.debug("sendSyncMessage suspend #%s/%s", id, suspended)
        try {
          const r = new XMLHttpRequest()
          r.open("GET", suspendURL, false)
          r.send(null)
        } catch (e) {
          console.error(e)
        }
        suspended--
        console.debug(
          "sendSyncMessage resume #%s/%s - %sms",
          id,
          suspended,
          Date.now() - startTime
        ) // DEV_ONLY
      }

      const finalize = () => {
        console.debug("sendSyncMessage finalizing")
      }

      // on Firefox we first need to send an async message telling the
      // background script about the tab ID, which does not get sent
      // with "privileged" XHR
      let result

      browser.runtime
        .sendMessage({ __syncMessage__: { id: msgId, payload: msg } })
        .then(r => {
          result = r
          if (callback) callback(r)
          finalize()
        })
        .catch(e => {
          throw e
        })

      try {
        suspend()
      } finally {
        finalize()
      }
      return result
    }
    // then we send the payload using a privileged XHR, which is not subject
    // to CORS but unfortunately doesn't carry any tab id except on Chromium

    url += `&msg=${encodeURIComponent(JSON.stringify(msg))}` // adding the payload
    const r = new XMLHttpRequest()
    let result
    const key = `${ENDPOINT_PREFIX}`
    let reloaded
    try {
      reloaded = sessionStorage.getItem(key) === "reloaded"
      if (reloaded) {
        sessionStorage.removeItem(key)
        console.log("Syncmessage attempt aftert reloading page.")
      }
    } catch (e) {
      // we can't access sessionStorage: let's act as we've already reloaded
      reloaded = true
    }
    for (let attempts = 3; attempts-- > 0; ) {
      try {
        r.open("GET", url, false)
        r.send(null)
        result = JSON.parse(r.responseText)
        break
      } catch (e) {
        console.error(
          `syncMessage error in ${document.URL}: ${e.message} (response ${r.responseText}, remaining attempts ${attempts})`
        )
        if (attempts === 0) {
          if (reloaded) {
            console.log("Already reloaded or no sessionStorage, giving up.")
            break
          }
          sessionStorage.setItem(key, "reloaded")
          if (sessionStorage.getItem(key)) {
            stop()
            location.reload()
            return {}
          } else {
            console.error(`Cannot set sessionStorage item ${key}`)
          }
        }
      }
    }
    if (callback) callback(result)
    return result
  }
}
