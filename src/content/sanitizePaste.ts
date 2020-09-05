export {}
const urlAttributes = ["href", "to", "from", "by", "values"]
const selector = urlAttributes.map(a => `[${a}]`).join(",")

for (const evType of ["drop", "paste"])
  window.addEventListener(
    evType,
    e => {
      const container = e.target
      let editing = false
      for (let el = container; el; el = el.parentElement) {
        if (el.setRangeText || el.contentEditable) {
          editing = true
          break
        }
      }
      if (!editing) return

      // we won't touch DOM elements which are already there
      const oldNodes = new Set(container.querySelectorAll(selector + ",form"))
      window.setTimeout(() => {
        // we delay our custom sanitization after the browser performed the paste
        // or drop job, rather than replacing it, in order to avoid interferences
        // with built-in sanitization
        try {
          const html = container.innerHTML
          if (sanitizeExtras(container, oldNodes)) {
            const t = e.type.toUpperCase()
            console.log(
              `[NoScript] Sanitized\n<${t}>\n${html}\n</${t}>\nto\n<${t}>\n${container.innerHTML}\n</${t}>`,
              container
            )
          }
        } catch (ex) {
          console.log(ex)
        }
      }, 0)
    },
    true
  )

function removeAttribute(node, name, value = node.getAttribute(name)) {
  node.setAttribute(`data-noscript-removed-${name}`, value)
  node.removeAttribute(name)
}

function sanitizeExtras(container, oldNodes = []) {
  let ret = false

  // remove attributes from forms
  for (const f of container.getElementsByTagName("form")) {
    if (oldNodes.has(f)) continue
    for (const a of [...f.attributes]) {
      removeAttribute(f, a.name)
    }
  }

  for (const node of container.querySelectorAll(selector)) {
    if (oldNodes.has(node)) continue
    for (const name of urlAttributes) {
      const value = node.getAttribute(name)
      if (/^\W*(?:(?:javascript|data):|https?:[\s\S]+[[(<])/i.test(unescape(value))) {
        removeAttribute(node, name, value)
        ret = true
      }
    }
  }
  return ret
}
