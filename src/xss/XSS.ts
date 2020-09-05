export {}

const XSS = (() => {
  const ABORT = { cancel: true },
    ALLOW = {}

  const workersMap = new Map()
  const promptsMap = new Map()

  async function getUserResponse(xssReq) {
    const { originKey } = xssReq
    await promptsMap.get(originKey)
    // promptsMap.delete(originKey);
    switch (await XSS.getUserChoice(originKey)) {
      case "allow":
        return ALLOW
      case "block":
        log(
          "Blocking request from %s to %s by previous XSS prompt user choice",
          xssReq.srcUrl,
          xssReq.destUrl
        )
        return ABORT
    }
    return null
  }

  function doneListener(request) {
    const { requestId } = request
    const worker = workersMap.get(requestId)
    if (worker) {
      worker.terminate()
      workersMap.delete(requestId)
    }
  }

  async function requestListener(request) {
    if (ns.isEnforced(request.tabId)) {
      const { policy } = ns
      let { type } = request
      if (type !== "main_frame") {
        if (type === "sub_frame") type = "frame"
        if (!policy.can(request.url, type, request.originUrl)) {
          return ALLOW // it will be blocked by RequestGuard
        }
      }
    }
    const xssReq = XSS.parseRequest(request)
    if (!xssReq) return null
    let userResponse = await getUserResponse(xssReq)
    if (userResponse) return userResponse

    let data
    let reasons

    try {
      reasons = await XSS.maybe(xssReq)
      if (!reasons) return ALLOW

      data = []
    } catch (e) {
      error(e, "XSS filter processing %o", xssReq)
      if (/^Timing:[^]*\binterrupted\b/.test(e.message)) {
        // we don't want prompts if the request expired / errored first
        return ABORT
      }
      reasons = { urlInjection: true }
      data = [e.toString()]
    }

    const prompting = (async () => {
      userResponse = await getUserResponse(xssReq)
      if (userResponse) return userResponse

      const { srcOrigin, destOrigin, unescapedDest } = xssReq
      let block = !!(reasons.urlInjection || reasons.postInjection)

      if (reasons.protectName) {
        await include("bg/ContentScriptOnce.js")
        await ContentScriptOnce.execute(request, {
          js: [{ file: "/xss/sanitizeName.js" }],
        })
        if (!block) return ALLOW
      }
      if (reasons.urlInjection) data.push(`(URL) ${unescapedDest}`)
      if (reasons.postInjection) data.push(`(POST) ${reasons.postInjection}`)

      const source = srcOrigin && srcOrigin !== "null" ? srcOrigin : "[...]"

      const { button, option } = await Prompts.prompt({
        title: _("XSS_promptTitle"),
        message: _("XSS_promptMessage", [source, destOrigin, data.join(",")]),
        options: [
          { label: _(`XSS_opt${block ? "Block" : "Sanitize"}`), checked: true }, // 0
          { label: _("XSS_optAlwaysBlock", [source, destOrigin]) }, // 1
          { label: _("XSS_optAllow") }, // 2
          { label: _("XSS_optAlwaysAllow", [source, destOrigin]) }, // 3
        ],

        buttons: [_("Ok")],
        multiple: "focus",
        width: 600,
        height: 480,
      })

      if (button === 0 && option >= 2) {
        if (option === 3) {
          // always allow
          await XSS.setUserChoice(xssReq.originKey, "allow")
          await XSS.saveUserChoices()
        }
        return ALLOW
      }
      if (option === 1) {
        // always block
        block = true
        await XSS.setUserChoice(xssReq.originKey, "block")
        await XSS.saveUserChoices()
      }
      return block ? ABORT : ALLOW
    })()
    promptsMap.set(xssReq.originKey, prompting)
    try {
      return await prompting
    } catch (e) {
      error(e)
      return ABORT
    }
  }

  function parseUrl(url) {
    const u = new URL(url)
    // make it cloneable
    return {
      href: u.href,
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port,
      origin: u.origin,
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
    }
  }

  return {
    async start() {
      if (!UA.isMozilla) return // async webRequest is supported on Mozilla only

      const { onBeforeRequest, onCompleted, onErrorOccurred } = browser.webRequest

      if (onBeforeRequest.hasListener(requestListener)) return

      await include("/legacy/Legacy.js")
      await include("/xss/Exceptions.js")

      this._userChoices =
        (await Storage.get("sync", "xssUserChoices")).xssUserChoices || {}

      // conver old style whitelist if stored
      const oldWhitelist = await XSS.Exceptions.getWhitelist()
      if (oldWhitelist) {
        for (const [destOrigin, sources] of Object.entries(oldWhitelist)) {
          for (const srcOrigin of sources) {
            this._userChoices[`${srcOrigin}>${destOrigin}`] = "allow"
          }
        }
        XSS.Exceptions.setWhitelist(null)
      }
      const filter = {
        urls: ["*://*/*"],
        types: ["main_frame", "sub_frame", "object"],
      }
      onBeforeRequest.addListener(requestListener, filter, ["blocking", "requestBody"])
      if (!onCompleted.hasListener(doneListener)) {
        onCompleted.addListener(doneListener, filter)
        onErrorOccurred.addListener(doneListener, filter)
      }
    },

    stop() {
      const { onBeforeRequest } = browser.webRequest
      if (onBeforeRequest.hasListener(requestListener)) {
        onBeforeRequest.removeListener(requestListener)
      }
    },

    parseRequest(request) {
      let { url: destUrl, originUrl: srcUrl, method } = request
      let destObj
      try {
        destObj = parseUrl(destUrl)
      } catch (e) {
        error(e, "Cannot create URL object for %s", destUrl)
        return null
      }
      let srcObj = null
      if (srcUrl) {
        try {
          srcObj = parseUrl(srcUrl)
        } catch (e) {}
      } else {
        srcUrl = ""
      }

      const unescapedDest = unescape(destUrl)
      let srcOrigin = srcObj ? srcObj.origin : ""
      if (srcOrigin === "null") {
        srcOrigin = srcObj.href.replace(/[\?#].*/, "")
      }
      const destOrigin = destObj.origin

      const isGet = method === "GET"
      return {
        unparsedRequest: request,
        srcUrl,
        destUrl,
        srcObj,
        destObj,
        srcOrigin,
        destOrigin,
        srcDomain: (srcObj && srcObj.hostname && tld.getDomain(srcObj.hostname)) || "",
        destDomain: tld.getDomain(destObj.hostname),
        originKey: `${srcOrigin}>${destOrigin}`,
        unescapedDest,
        isGet,
        isPost: !isGet && method === "POST",
        timestamp: Date.now(),
        debugging: ns.local.debug,
      }
    },

    async saveUserChoices(xssUserChoices = this._userChoices || {}) {
      this._userChoices = xssUserChoices
      await Storage.set("sync", { xssUserChoices })
    },
    getUserChoices() {
      return this._userChoices
    },
    setUserChoice(originKey, choice) {
      this._userChoices[originKey] = choice
    },
    getUserChoice(originKey) {
      return this._userChoices[originKey]
    },

    async maybe(xssReq) {
      // return reason or null if everything seems fine
      if (await this.Exceptions.shouldIgnore(xssReq)) {
        return null
      }

      const skip = this.Exceptions.partial(xssReq)
      const worker = new Worker(browser.runtime.getURL("/xss/InjectionCheckWorker.js"))
      const { requestId } = xssReq.unparsedRequest
      workersMap.set(requestId, worker)
      return await new Promise((resolve, reject) => {
        worker.onmessage = e => {
          const { data } = e
          if (data) {
            if (data.logType) {
              window[data.logType](...data.log)
              return
            }
            if (data.error) {
              cleanup()
              reject(data.error)
              return
            }
          }
          cleanup()
          resolve(e.data)
        }
        worker.onerror = worker.onmessageerror = e => {
          cleanup()
          reject(e)
        }
        worker.postMessage({ handler: "check", xssReq, skip })

        const onNavError = details => {
          debug("Navigation error: %o", details)
          const { tabId, frameId, url } = details
          const r = xssReq.unparsedRequest
          if (tabId === r.tabId && frameId === r.frameId) {
            cleanup()
            reject(
              new Error(
                "Timing: request interrupted while being filtered, no need to go on."
              )
            )
          }
        }
        browser.webNavigation.onErrorOccurred.addListener(onNavError, {
          url: [{ urlEquals: xssReq.destUrl }],
        })

        const dosTimeout = setTimeout(() => {
          if (cleanup()) {
            // the request might have been aborted otherwise
            reject(new Error("Timeout! DOS attack attempt?"))
          } else {
            debug(
              "[XSS] Request %s already aborted while being filtered.",
              xssReq.destUrl
            )
          }
        }, 20000)

        function cleanup() {
          clearTimeout(dosTimeout)
          browser.webNavigation.onErrorOccurred.removeListener(onNavError)
          if (workersMap.has(requestId)) {
            workersMap.delete(requestId)
            worker.terminate()
            return true
          }
          return false
        }
      })
    },
  }
})()
