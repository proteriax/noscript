export {}
const makeBigObj = propsNum => {
  const bigObj = {}
  for (let j = propsNum; j-- > 0; ) {
    const x = "0000".concat(j.toString(16)).slice(-4)
    bigObj[`k${x}`] = `v${x}`
  }
  log("[TEST] created bigObj %s JSON characters long.", JSON.stringify(bigObj).length)
  return bigObj
}
const HUGE_SIZE = 16000,
  BIG_SIZE = 1000
const bigObject = makeBigObj(BIG_SIZE)
const hugeObject = makeBigObj(HUGE_SIZE)
const items = { small1: { x: 1, y: 2 }, bigObject, small2: { k: 3, j: 4 } }
const keys = Object.keys(items)
keys.push("hugeObject")

const eq = async (key, prop, val) => {
  const current = (await Storage.get("sync", key))[key]
  const ok = current[prop] === val
  log("[TEST] sync.%s.%s %s %s\n(%o)", key, prop, ok ? "==" : "!=", val, current)
  return ok
}

const fallbackOrChunked = async key => {
  const fallback = await Storage.hasLocalFallback(key)
  const chunked = await Storage.isChunked(key)
  log("[TEST] %s fallback: %s, chunked: %s", key, fallback, chunked)
  return fallback ? !chunked : chunked
}

const checkSize = async (key, size) =>
  Object.keys((await Storage.get("sync", key))[key]).length === size

let all
;(async () => {
  for (const t of [
    async () => {
      await Storage.set("sync", items)
      await Storage.set("sync", { hugeObject }) // fallback to local
      all = await Storage.get("sync", keys)
      log(
        "[TEST] Storage:\nsync %o\nlocal %o\nfiltered (%o) %o",
        await browser.storage.sync.get(),
        await browser.storage.local.get(),
        keys,
        all
      )
      return Object.keys(all).length === keys.length
    },
    async () => checkSize("hugeObject", HUGE_SIZE),
    async () => checkSize("bigObject", BIG_SIZE),
    async () => await fallbackOrChunked("bigObject"),
    async () => await fallbackOrChunked("hugeObject"),
    async () => await eq("small1", "y", 2),
    async () => await eq("small2", "k", 3),
    async () => await eq("bigObject", "k0000", "v0000"),
    async () => await eq("hugeObject", "k0001", "v0001"),
    async () => {
      const key = "bigObject"
      const wasChunked = await Storage.isChunked(key)
      await Storage.set("sync", { [key]: { tiny: "prop" } })
      return wasChunked && !(await Storage.isChunked(key))
    },
    async () => eq("bigObject", "tiny", "prop"),
    async () => {
      await Storage.remove("sync", keys)
      const myItems = await Storage.get("sync", keys)
      return Object.keys(myItems).length === 0
    },
  ]) {
    await Test.run(t)
  }
  Test.report()
})()
