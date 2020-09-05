export {}

function onScriptDisabled() {
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", e => onScriptDisabled())
    return
  }
  onScriptDisabled = () => {}
  let refresh = false
  for (const noscript of document.querySelectorAll("noscript")) {
    // force show NOSCRIPT elements content
    const replacement = document
      .createRange()
      .createContextualFragment(noscript.innerHTML)
    // emulate meta-refresh
    for (const meta of replacement.querySelectorAll('meta[http-equiv="refresh"]')) {
      refresh = true
      document.head.appendChild(meta)
      console.log(`State %s, emulating`, document.readyState, meta)
    }

    if (noscript.closest("head") && document.body) {
      document.body.insertBefore(noscript, document.body.firstChild)
    }
    noscript.replaceWith(replacement)
  }
  if (refresh) {
    const html = document.documentElement.outerHTML
    const rewrite = () => {
      const document = window.wrappedJSObject
        ? window.wrappedJSObject.document
        : window.document
      document.open()
      document.write(html)
      document.close()
    }
    if (document.readyState === "complete") {
      rewrite()
    } else {
      window.addEventListener("load", e => {
        if (e.isTrusted) rewrite()
      })
    }
  }
  {
    const eraser = {
      tapped: null,
      delKey: false,
    }

    addEventListener(
      "pagehide",
      ev => {
        if (!ev.isTrusted) return
        eraser.tapped = null
        eraser.delKey = false
      },
      false
    )

    addEventListener(
      "keyup",
      ev => {
        if (!ev.isTrusted) return
        let el = eraser.tapped
        if (el && ev.keyCode === 46) {
          eraser.tapped = null
          eraser.delKey = true
          const doc = el.ownerDocument
          const w = doc.defaultView
          if (w.getSelection().isCollapsed) {
            const root = doc.body || doc.documentElement
            const posRx = /^(?:absolute|fixed)$/
            do {
              if (posRx.test(w.getComputedStyle(el, "").position)) {
                ;(eraser.tapped = el.parentNode).removeChild(el)
                break
              }
            } while ((el = el.parentNode) && el != root)
          }
        }
      },
      true
    )

    addEventListener(
      "mousedown",
      ev => {
        if (!ev.isTrusted) return
        if (ev.button === 0) {
          eraser.tapped = ev.target
          eraser.delKey = false
        }
      },
      true
    )

    addEventListener(
      "mouseup",
      ev => {
        if (!ev.isTrusted) return
        if (eraser.delKey) {
          eraser.delKey = false
          ev.preventDefault()
          ev.stopPropagation()
        }
        eraser.tapped = null
      },
      true
    )
  }
}
