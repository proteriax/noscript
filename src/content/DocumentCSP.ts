export {}

class DocumentCSP {
  constructor(document) {
    this.document = document
    this.builder = new CapsCSP()
  }

  apply(capabilities, embedding = CSP.isEmbedType(this.document.contentType)) {
    const { document } = this
    if (!capabilities.has("script")) {
      // safety net for XML (especially SVG) documents and synchronous scripts running
      // while inserting the CSP <meta> element.
      document.defaultView.addEventListener(
        "beforescriptexecute",
        e => {
          if (!e.isTrusted) return
          e.preventDefault()
          debug("Fallback beforexecutescript listener blocked ", e.target)
        },
        true
      )
    }

    const csp = this.builder
    const blocker = csp.buildFromCapabilities(capabilities, embedding)
    if (!blocker) return true

    const createHTMLElement = tagName =>
      document.createElementNS("http://www.w3.org/1999/xhtml", tagName)

    const header = csp.asHeader(blocker)
    const meta = createHTMLElement("meta")
    meta.setAttribute("http-equiv", header.name)
    meta.setAttribute("content", header.value)
    const root = document.documentElement

    const { head } = document
    const parent = head || document.documentElement.appendChild(createHTMLElement("head"))

    try {
      parent.insertBefore(meta, parent.firstElementChild)
      debug(`Failsafe <meta> CSP inserted in %s: "%s"`, document.URL, header.value)
      meta.remove()
      if (!head) parent.remove()
    } catch (e) {
      error(e, "Error inserting CSP %s in %s", document.URL, header && header.value)
      return false
    }
    return true
  }
}
