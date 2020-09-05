export {}

if (ns.embeddingDocument) {
  const replace = () => {
    for (const policyType of ["object", "media"]) {
      const request = {
        id: `noscript-${policyType}-doc`,
        type: policyType,
        url: document.URL,
        documentUrl: document.URL,
        embeddingDocument: true,
      }

      if (ns.allows(policyType)) {
        const handler = PlaceHolder.handlerFor(policyType)
        if (handler && handler.selectFor(request).length > 0) {
          seen.record({ policyType, request, allowed: true })
        }
      } else {
        const ph = PlaceHolder.create(policyType, request)
        if (ph.replacements.size > 0) {
          debug(`Created placeholder for ${policyType} at ${document.URL}`)
          seen.record({ policyType, request, allowed: false })
        }
      }
    }
  }
  ns.on("capabilities", () => {
    if (!document.body.firstChild) {
      // we've been called early
      setTimeout(replace, 0)
      const types = {
        // Reminder: order is important because media matches also for
        // some /^application\// types
        media: /^(?:(?:video|audio)\/|application\/(?:ogg|mp4|mpeg)$)/i,
        object: /^application\//i,
      }
      for (const [type, rx] of Object.entries(types)) {
        if (rx.test(document.contentType)) {
          if (!ns.allows(type)) {
            window.stop()
          }
          break
        }
      }
    } else {
      replace()
    }
  })
}
