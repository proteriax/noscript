export {}
const include = (() => {
  const _inclusions = new Map()

  function scriptLoader(src) {
    const script = document.createElement("script")
    script.src = src
    return script
  }

  function styleLoader(src) {
    const style = document.createElement("link")
    style.rel = "stylesheet"
    style.type = "text/css"
    style.href = src
    return style
  }

  return async function include(src) {
    if (_inclusions.has(src)) return await _inclusions.get(src)
    if (Array.isArray(src)) {
      return await Promise.all(src.map(s => include(s)))
    }
    debug("Including", src)

    const loading = new Promise((resolve, reject) => {
      const inc = src.endsWith(".css") ? styleLoader(src) : scriptLoader(src)
      inc.onload = () => resolve(inc)
      inc.onerror = () => reject(new Error(`Failed to load ${src}`))
      document.head.appendChild(inc)
    })
    _inclusions.set(src, loading)
    return await loading
  }
})()
