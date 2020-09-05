export {}

const Entities = {
  get htmlNode() {
    delete this.htmlNode
    return (this.htmlNode = document.implementation
      .createHTMLDocument("")
      .createElement("body"))
  },

  convert(e: string) {
    try {
      this.htmlNode.innerHTML = e
      const child = this.htmlNode.firstChild || null
      return (child && child.nodeValue) || e
    } catch (ex) {
      return e
    }
  },

  convertAll(s: string) {
    return s.replace(/[\\&][^<>]+/g, e => Entities.convert(e))
  },

  convertDeep(s: string) {
    for (
      let prev = null;
      (s = this.convertAll(s)) !== prev || (s = unescape(s)) !== prev;
      prev = s
    );
    return s
  },

  neutralize(e: string, whitelist) {
    const c = this.convert(e)
    return c == e ? c : whitelist && whitelist.test(c) ? e : e.replace(";", ",")
  },

  neutralizeAll(s: string, whitelist) {
    return s.replace(/&[\w#-]*?;/g, e => Entities.neutralize(e, whitelist || null))
  },
}
