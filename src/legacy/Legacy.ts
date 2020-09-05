export {}

const Legacy = {
  async init() {
    const migrated = (await browser.storage.local.get("legacyBackup")).legacyBackup
    const real = await this.import(migrated)
    this.init = async () => real
    return real
  },

  async import(migrated) {
    if (this.migrated) this.undo = this.migrated
    this.migrated = migrated && migrated.prefs ? migrated : { prefs: {} }
    await include("/legacy/defaults.js")
    return "whitelist" in this.migrated // "real" migration with custom policy
  },

  async persist() {
    await browser.storage.local.set({ legacyBackup: this.migrated })
  },

  getPref(name, def) {
    return name in this.migrated.prefs ? this.migrated.prefs[name] : def
  },

  getRxPref(name, parseRx = Legacy.RX.multi, flags, def) {
    const source = this.getPref(name, def)
    if (source instanceof RegExp) return source
    try {
      return parseRx(source, flags)
    } catch (e) {
      error(e, "Parsing RegExp preference %s, falling back to %s", name, def)
      if (def) {
        if (def instanceof RegExp) {
          return def
        }
        try {
          return parseRx(def, flags)
        } catch (e) {
          error(e)
        }
      }
    }
    return null
  },

  async createOrMigratePolicy() {
    try {
      if (await this.init()) {
        return this.migratePolicy()
      }
    } catch (e) {
      error(e)
    }
    return new Policy()
  },

  extractLists(lists) {
    return lists
      .map(listString => listString.split(/\s+/))
      .map(sites =>
        sites.filter(
          s => !(s.includes(":") && sites.includes(s.replace(/.*:\/*(?=\w)/g, "")))
        )
      )
  },

  migratePolicy() {
    // here we normalize both NS whitelist and blacklist, getting finally rid of
    // the legacy of CAPS mandating protocols for top-level domains
    const [trusted, untrusted] = this.extractLists([
      this.migrated.whitelist,
      this.getPref("untrusted", ""),
    ])

    // securify default whitelist domain items
    if (this.getPref("httpsDefWhitelist")) {
      this.getPref("default", "")
        .split(/\s+/)
        .filter(s => !s.includes(":"))
        .forEach(s => {
          const idx = trusted.indexOf(s)
          if (idx !== -1) {
            trusted[idx] = Sites.secureDomainKey(s)
          }
        })
    }

    let DEFAULT = new Permissions(["other"])
    const { capabilities } = DEFAULT
    // let's semplify object permissions now that almost everything is
    // either blacklisted or C2P by the browser
    if (
      !["Java", "Flash", "Silverlight", "Plugins"].find(type =>
        this.getPref(`forbid${type}`)
      )
    ) {
      capabilities.add("object")
    }

    const prefMap = {
      Fonts: "font",
      Frames: "frame",
      IFrames: "frame",
      Media: "media",
      WebGL: "webgl",
    }
    for (const [legacy, current] of Object.entries(prefMap)) {
      if (!this.getPref(`forbid${legacy}`, true)) capabilities.add(current)
    }

    const TRUSTED = new Permissions(
      new Set(this.getPref("contentBlocker") ? capabilities : Permissions.ALL)
    )
    TRUSTED.capabilities.add("script").add("fetch")

    const UNTRUSTED = new Permissions()
    if (this.getPref("global")) {
      if (!this.getPref("alwaysBlockUntrustedContent")) {
        UNTRUSTED.capabilities = new Set(capabilities)
      }
      DEFAULT = new Permissions(TRUSTED.capabilities)
    }

    return new Policy({
      sites: { untrusted, trusted, custom: {} },
      DEFAULT,
      TRUSTED,
      UNTRUSTED,
      enforced: true,
      // TODO: enforce these before ESR 59 gets released
      cascadePermissions: this.getPref("cascadePermissions"),
      restrictSubDocScripting: this.getPref("restrictSubDocScripting"),
      onlySecure: this.getPref("allowHttpsOnly"),
    })
  },

  RX: {
    simple(s, flags) {
      const anchor = /\^/.test(flags)
      return new RegExp(
        anchor ? rxParsers.anchor(s) : s,
        anchor ? flags.replace(/\^/g, "") : flags
      )
    },
    anchor(s) {
      return /^\^|\$$/.test(s) ? s : "^" + s + "$"
    },
    multi(s, flags) {
      const anchor = /\^/.test(flags)
      const lines = s.split(anchor ? /\s+/ : /[\n\r]+/).filter(l => /\S/.test(l))
      return new RegExp(
        (anchor ? lines.map(rxParsers.anchor) : lines).join("|"),
        anchor ? flags.replace(/\^/g, "") : flags
      )
    },
  },
}
Legacy.init()
