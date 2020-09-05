import {} from "../lib/UA"
import {} from "../lib/browser-polyfill"
import {} from "../lib/log"
import {} from "../lib/include"
;(async () => {
  const [domain, tabId] = decodeURIComponent(location.hash.replace("#", "")).split(";")
  const BASE = "https://noscript.net"
  await include(["/lib/punycode.js", "/common/Storage.js"])
  let { siteInfoConsent } = await Storage.get("sync", "siteInfoConsent")
  if (!siteInfoConsent) {
    await include("/common/locale.js")
    siteInfoConsent = confirm(_("siteInfo_confirm", [domain, BASE]))
    if (siteInfoConsent) {
      await Storage.set("sync", { siteInfoConsent })
    } else {
      const current = await browser.tabs.getCurrent()
      await browser.tabs.update(parseInt(tabId), { active: true })
      await browser.tabs.remove(current.id)
      return
    }
  }
  const ace = punycode.toASCII(domain)
  location.href = `${BASE}/about/${domain};${ace}`
})()
