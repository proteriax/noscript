export {}
;(this.ns || (this.ns = {})).syncFetchPolicy = function () {
  const url = document.URL

  // Here we've got no CSP header yet (file: or ftp: URL), we need one
  // injected in the DOM as soon as possible.
  debug("No CSP yet for non-HTTP document load: fetching policy synchronously...")

  const syncFetch = callback => {
    browser.runtime.sendSyncMessage({ id: "fetchPolicy", url, contextUrl: url }, callback)
  }
  debug("Initial readyState and body", document.readyState, document.body)

  if (UA.isMozilla) {
    // Mozilla has already parsed the <head> element, we must take extra steps...

    try {
      DocumentFreezer.freeze()

      ns.on("capabilities", () => {
        const { readyState } = document
        debug(
          "Readystate: %s, suppressedScripts = %s, canScript = %s",
          readyState,
          DocumentFreezer.suppressedScripts,
          ns.canScript
        )
        // CSP works on HTML documents only on Mozilla: we'll keep frozen elsewhere
        const honorsCSP = document instanceof HTMLDocument

        if (!ns.canScript) {
          if (honorsCSP) {
            DocumentFreezer.unfreeze()
          }
          return
        }

        if (DocumentFreezer.suppressedScripts === 0 && readyState === "loading") {
          // we don't care reloading, if no script has been suppressed
          // and no readyState change has been fired yet
          DocumentFreezer.unfreeze()
          return
        }

        const softReload = ev => {
          try {
            //let html = document.documentElement.outerHTML;
            debug("Soft reload", ev) // DEV_ONLY
            try {
              const doc = window.wrappedJSObject.document
              removeEventListener("DOMContentLoaded", softReload, true)
              doc.open()
              console.debug("Opened", doc.documentElement)
              DocumentFreezer.unfreeze()
              ;(async () => {
                const html = await (await fetch(document.URL)).text()
                doc.write(html)
                doc.close()
                debug("Written", html)
              })()
            } catch (e) {
              debug("Can't use document.write(), XML document?")
              try {
                DocumentFreezer.unfreeze()
                const scripts = [],
                  deferred = []
                // push deferred scripts, if any, to the end
                for (const s of [...document.querySelectorAll("script")]) {
                  ;(s.defer && !s.text ? deferred : scripts).push(s)
                  s.addEventListener("beforescriptexecute", e => {
                    console.debug("Suppressing", script)
                    e.preventDefault()
                  })
                }
                if (deferred.length) scripts.push(...deferred)
                const doneEvents = ["afterscriptexecute", "load", "error"]
                ;(async () => {
                  for (const s of scripts) {
                    const clone = document.createElement("script")
                    for (const a of s.attributes) {
                      clone.setAttribute(a.name, a.value)
                    }
                    clone.text = s.text
                    await new Promise(resolve => {
                      const listener = ev => {
                        if (ev.target !== clone) return
                        debug("Resolving on ", ev.type, ev.target)
                        resolve(ev.target)
                        for (const et of doneEvents)
                          removeEventListener(et, listener, true)
                      }
                      for (const et of doneEvents) {
                        addEventListener(et, listener, true)
                      }
                      s.replaceWith(clone)
                      debug("Replaced", clone)
                    })
                  }
                  debug("ALl scripts done, firing completion events.")
                  document.dispatchEvent(new Event("readystatechange"))
                  document.dispatchEvent(
                    new Event("DOMContentLoaded", {
                      bubbles: true,
                      cancelable: true,
                    })
                  )
                  if (document.readyState === "complete") {
                    window.dispatchEvent(new Event("load"))
                  }
                })()
              } catch (e) {
                error(e)
              }
            }
          } catch (e) {
            error(e)
          }
        }

        if (readyState === "loading") {
          debug("Deferring softReload to DOMContentLoaded...")
          addEventListener("DOMContentLoaded", softReload, true)
        } else {
          softReload()
        }
      })
    } catch (e) {
      error(e)
    }
  }

  const setup = policy => {
    debug("Fetched %o, readyState %s", policy, document.readyState) // DEV_ONLY
    ns.setup(policy)
  }

  for (let attempts = 3; attempts-- > 0; ) {
    try {
      syncFetch(setup)
      break
    } catch (e) {
      if (!Messages.isMissingEndpoint(e) || document.readyState === "complete") {
        error(e)
        break
      }
      error("Background page not ready yet, retrying to fetch policy...")
    }
  }
}
