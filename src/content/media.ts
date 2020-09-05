export {}
if ("MediaSource" in window) {
  const notify = allowed => {
    const request = {
      id: "noscript-media",
      type: "media",
      url: document.URL,
      documentUrl: document.URL,
      embeddingDocument: true,
    }
    seen.record({ policyType: "media", request, allowed })
    debug("MSE notification", document.URL) // DEV_ONLY
    notifyPage()
    return request
  }

  const createPlaceholder = (mediaElement, request) => {
    try {
      const ph = PlaceHolder.create("media", request)
      ph.replace(mediaElement)
      PlaceHolder.listen()
      debug("MSE placeholder for %o", mediaElement) // DEV_ONLY
    } catch (e) {
      error(e)
    }
  }

  if (typeof exportFunction === "function") {
    // Mozilla
    const mediablocker = true
    ns.on("capabilities", e => {
      mediaBlocker = !ns.allows("media")
    })

    const unpatched = new Map()
    function patch(obj, methodName, replacement) {
      const methods = unpatched.get(obj) || {}
      methods[methodName] = obj[methodName]
      exportFunction(replacement, obj, { defineAs: methodName })
      unpatched.set(obj, methods)
    }
    const urlMap = new WeakMap()
    patch(window.URL, "createObjectURL", function (o, ...args) {
      const url = unpatched.get(window.URL).createObjectURL.call(this, o, ...args)
      if (o instanceof MediaSource) {
        let urls = urlMap.get(o)
        if (!urls) urlMap.set(o, (urls = new Set()))
        urls.add(url)
      }
      return url
    })

    patch(window.MediaSource.prototype, "addSourceBuffer", function (mime, ...args) {
      const ms = this
      const urls = urlMap.get(ms)
      const request = notify(!mediaBlocker)
      if (mediaBlocker) {
        const exposedMime = `${mime} (MSE)`
        setTimeout(() => {
          const me = Array.from(document.querySelectorAll("video,audio")).find(
            e => e.srcObject === ms || (urls && urls.has(e.src))
          )
          if (me) createPlaceholder(me, request)
        }, 0)
        throw new Error(`${exposedMime} blocked by NoScript`)
      }

      return unpatched
        .get(window.MediaSource.prototype)
        .addSourceBuffer.call(ms, mime, ...args)
    })
  } else if ("SecurityPolicyViolationEvent" in window) {
    // Chromium
    const createPlaceholders = () => {
      const request = notify(false)
      for (const me of document.querySelectorAll("video,audio")) {
        if (!(me.src || me.currentSrc) || me.src.startsWith("blob")) {
          createPlaceholder(me, request)
        }
      }
    }
    const processedURIs = new Set()
    const whenReady = false
    addEventListener(
      "securitypolicyviolation",
      e => {
        if (!e.isTrusted || ns.allows("media")) return
        const { blockedURI, violatedDirective } = e
        if (
          blockedURI.startsWith("blob") &&
          violatedDirective.startsWith("media-src") &&
          !processedURIs.has(blockedURI)
        ) {
          processedURIs.add(blockedURI)
          setTimeout(createPlaceholders, 0)
        }
      },
      true
    )
  }
}
