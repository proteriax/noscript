export {}
const TabCache = (() => {
  const cache = new Map()

  browser.tabs.onUpdated.addListener(tab => {
    cache.set(tab.id, tab)
  })

  browser.tabs.onRemoved.addListener(tab => {
    cache.delete(tab.id)
  })
  ;(async () => {
    for (const tab of await browser.tabs.query({})) {
      cache.set(tab.id, tab)
    }
  })()

  return {
    get(tabId) {
      return cache.get(tabId)
    },
  }
})()
