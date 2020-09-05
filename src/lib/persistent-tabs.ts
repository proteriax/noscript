export {}

if (typeof flextabs === "function") {
  for (const tabs of document.querySelectorAll(".flextabs")) {
    flextabs(tabs).init()
    const { id } = tabs
    if (!id) continue
    const rx = new RegExp(`(?:^|[#;])tab-${id}=(\\d+)(?:;|$)`)
    const current = location.hash.match(rx)
    console.log(`persisted %o`, current)
    const toggles = Array.from(tabs.querySelectorAll(".flextabs__toggle"))
    const currentToggle = toggles[(current && parseInt(current[1])) || 0]
    if (currentToggle) currentToggle.click()
    for (const toggle of toggles) {
      toggle.addEventListener("click", e => {
        const currentIdx = toggles.indexOf(toggle)
        location.hash = location.hash
          .split(";")
          .filter(p => !rx.test(p))
          .concat(`tab-${id}=${currentIdx}`)
          .join(";")
      })
    }
  }
}
