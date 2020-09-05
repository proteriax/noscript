export {}

const Defaults = {
  async init() {
    const defaults = {
      local: {
        debug: false,
        showCtxMenuItem: true,
        showCountBadge: true,
        showFullAddresses: false,
        amnesticUpdates: false,
      },
      sync: {
        global: false,
        xss: true,
        cascadeRestrictions: false,
        overrideTorBrowserPolicy: false, // note: Settings.update() on reset will flip this to true
        clearclick: true,
      },
    }
    const defaultsClone = JSON.parse(JSON.stringify(defaults))

    for (const [k, v] of Object.entries(defaults)) {
      const store = await Storage.get(k, k)
      if (k in store) {
        Object.assign(v, store[k])
      }
      v.storage = k
    }

    Object.assign(ns, defaults)

    // dynamic settings
    if (!ns.local.uuid) {
      ns.local.uuid = uuid()
      await ns.save(ns.local)
    }

    return (ns.defaults = defaultsClone)
  },
}
