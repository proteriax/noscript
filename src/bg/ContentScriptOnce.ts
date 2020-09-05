export {}

const ContentScriptOnce = (() => {
  const requestMap = new Map()

  {
    const cleanup = r => {
      const { requestId } = r
      const scripts = requestMap.get(requestId)
      if (scripts) {
        window.setTimeout(() => {
          requestMap.delete(requestId)
          for (const s of scripts) {
            s.unregister()
          }
        }, 0)
      }
    }

    const filter = {
      urls: ["<all_urls>"],
      types: ["main_frame", "sub_frame", "object"],
    }

    const wr = browser.webRequest
    for (const event of ["onCompleted", "onErrorOccurred"]) {
      wr[event].addListener(cleanup, filter)
    }
  }

  return {
    async execute(request, options) {
      let { requestId, url } = request
      let scripts = requestMap.get(requestId)
      if (!scripts) requestMap.set(requestId, (scripts = new Set()))
      try {
        const urlObj = new URL(url)
        if (urlObj.port) {
          urlObj.port = ""
          url = urlObj.toString()
        }
      } catch {}

      const defOpts = {
        runAt: "document_start",
        matchAboutBlank: true,
        matches: [url],
        allFrames: true,
      }

      scripts.add(await browser.contentScripts.register(Object.assign(defOpts, options)))
    },
  }
})()
