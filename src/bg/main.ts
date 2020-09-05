import {} from "../lib/UA"
import {} from "../lib/browser-polyfill"
import {} from "../lib/uuid"
import {} from "../lib/SyncMessage"
import {} from "../lib/log"
import {} from "../lib/include"
import {} from "../lib/punycode"
import {} from "../lib/tld"
import {} from "../lib/LastListener"
import {} from "../lib/Messages"
import {} from "../lib/CSP"
import {} from "../lib/NetCSP"
import {} from "../lib/TabCache"
import {} from "../common/CapsCSP"
import {} from "../common/Policy"
import {} from "../common/locale"
import {} from "../common/Entities"
import {} from "../common/SyntaxChecker"
import {} from "../common/Storage"
import {} from "../ui/Prompts"
import {} from "../xss/XSS"
import {} from "./ReportingCSP"
import {} from "./deferWebTraffic"
import {} from "./Defaults"
import {} from "./RequestGuard"
import {} from "./Settings"

{
  {
    for (const event of ["onInstalled", "onUpdateAvailable"]) {
      browser.runtime[event].addListener(async details => {
        await include("/bg/LifeCycle.js")
        LifeCycle[event](details)
      })
    }
  }
  const popupURL = browser.extension.getURL("/ui/popup.html")
  const popupFor = tabId => `${popupURL}#tab${tabId}`

  const ctxMenuId = "noscript-ctx-menu"

  async function toggleCtxMenuItem(show = ns.local.showCtxMenuItem) {
    if (!("contextMenus" in browser)) return
    const id = ctxMenuId
    try {
      await browser.contextMenus.remove(id)
    } catch (e) {}

    if (show) {
      browser.contextMenus.create({
        id,
        title: "NoScript",
        contexts: ["all"],
      })
    }
  }

  async function init() {
    await Defaults.init()

    if (!ns.policy) {
      // it could have been already retrieved by LifeCycle
      const policyData = (await Storage.get("sync", "policy")).policy
      if (policyData && policyData.DEFAULT) {
        ns.policy = new Policy(policyData)
      } else {
        await include("/legacy/Legacy.js")
        ns.policy = await Legacy.createOrMigratePolicy()
        await ns.savePolicy()
      }
    }

    Sites.onionSecure = ns.local.isTorBrowser

    await RequestGuard.start()
    await XSS.start() // we must start it anyway to initialize sub-objects
    if (!ns.sync.xss) {
      XSS.stop()
    }

    Messages.addHandler(messageHandler)

    try {
      await Messages.send("started")
    } catch (e) {
      // no embedder to answer us
    }
    log("STARTED")
    await include("/bg/popupHandler.js")
  }

  const Commands = {
    async openPageUI() {
      if (ns.popupOpening) return
      ns.popupOpening = true
      ns.popupOpened = false
      const openPanel = async () => {
        ns.popupOpening = false
        if (ns.popupOpened) return
        messageHandler.openStandalonePopup()
      }
      try {
        await browser.browserAction.openPopup()
        setTimeout(openPanel, 500)
        return
      } catch (e) {
        openPanel()
        debug(e)
      }
    },

    togglePermissions() {},
    install() {
      if ("command" in browser) {
        // keyboard shortcuts
        browser.commands.onCommand.addListener(cmd => {
          if (cmd in Commands) {
            Commands[cmd]()
          }
        })
      }

      if ("contextMenus" in browser) {
        toggleCtxMenuItem()
        browser.contextMenus.onClicked.addListener((info, tab) => {
          if (info.menuItemId == ctxMenuId) {
            this.openPageUI()
          }
        })
      }

      // wiring main UI
      const ba = browser.browserAction
      if ("setIcon" in ba) {
        //desktop or Fenix
        ba.setPopup({
          popup: popupURL,
        })
      } else {
        // Fennec
        ba.onClicked.addListener(async tab => {
          try {
            await browser.tabs.remove(
              await browser.tabs.query({
                url: popupURL,
              })
            )
          } catch (e) {}
          await browser.tabs.create({
            url: popupFor(tab.id),
          })
        })
      }
    },
  }

  const messageHandler = {
    async updateSettings(settings, sender) {
      await Settings.update(settings)
      toggleCtxMenuItem()
    },

    async broadcastSettings({ tabId = -1 }) {
      const policy = ns.policy.dry(true)
      const seen = tabId !== -1 ? await ns.collectSeen(tabId) : null
      const xssUserChoices = await XSS.getUserChoices()
      await Messages.send("settings", {
        policy,
        seen,
        xssUserChoices,
        local: ns.local,
        sync: ns.sync,
        unrestrictedTab: ns.unrestrictedTabs.has(tabId),
      })
    },

    async exportSettings() {
      return Settings.export()
    },

    async importSettings({ data }) {
      return await Settings.import(data)
    },

    async fetchChildPolicy({ url, contextUrl }, sender) {
      await ns.initializing
      return (messageHandler.fetchChildPolicy = messageHandler.fetchChildPolicySync)(
        ...arguments
      )
    },
    fetchChildPolicySync({ url, contextUrl }, sender) {
      const { tab, frameId } = sender
      let policy = ns.policy
      if (!policy) {
        console.log(
          "Policy is null, initializing: %o, sending fallback.",
          ns.initializing
        )
        return {
          permissions: new Permissions(Permissions.DEFAULT).dry(),
          unrestricted: false,
          cascaded: false,
          fallback: true,
        }
      }
      const topUrl = frameId === 0 ? contextUrl : tab && (tab.url || TabCache.get(tab.id))
      if (Sites.isInternal(url) || !ns.isEnforced(tab ? tab.id : -1)) {
        policy = null
      }

      let permissions, unrestricted, cascaded
      if (policy) {
        let perms = policy.get(url, contextUrl).perms
        cascaded = topUrl && ns.sync.cascadeRestrictions
        if (cascaded) {
          perms = policy.cascadeRestrictions(perms, topUrl)
        }
        permissions = perms.dry()
      } else {
        // otherwise either internal URL or unrestricted
        permissions = new Permissions(Permissions.ALL).dry()
        unrestricted = true
        cascaded = false
      }
      return { permissions, unrestricted, cascaded }
    },

    async openStandalonePopup() {
      const win = await browser.windows.getLastFocused()
      const [tab] = await browser.tabs.query({
        lastFocusedWindow: true,
        active: true,
      })

      if (!tab || tab.id === -1) {
        log("No tab found to open the UI for")
        return
      }
      browser.windows.create({
        url: popupFor(tab.id),
        width: 800,
        height: 600,
        top: win.top + 48,
        left: win.left + 48,
        type: "panel",
      })
    },
  }

  function onSyncMessage(msg, sender) {
    switch (msg.id) {
      case "fetchPolicy":
        return messageHandler.fetchChildPolicy(msg, sender)
        break
    }
  }

  const ns = {
    running: false,
    policy: null,
    local: null,
    sync: null,
    initializing: null,
    unrestrictedTabs: new Set(),

    isEnforced(tabId = -1) {
      return this.policy.enforced && (tabId === -1 || !this.unrestrictedTabs.has(tabId))
    },

    requestCan(request, capability) {
      return (
        !this.isEnforced(request.tabId) ||
        this.policy.can(request.url, capability, request.documentURL)
      )
    },

    start() {
      if (this.running) return
      this.running = true
      browser.runtime.onSyncMessage.addListener(onSyncMessage)
      deferWebTraffic((this.initializing = init()), async () => {
        Commands.install()
        try {
          this.devMode =
            (await browser.management.getSelf()).installType === "development"
        } catch (e) {}
        if (!(this.local.debug || this.devMode)) {
          debug = () => {} // suppress verbosity
        }
      })
    },

    stop() {
      if (!this.running) return
      this.running = false
      browser.runtime.onSyncMessage.removeListener(onSyncMessage)
      Messages.removeHandler(messageHandler)
      RequestGuard.stop()
      log("STOPPED")
    },

    test() {
      include("/test/run.js")
    },

    async savePolicy() {
      if (this.policy) {
        await Storage.set("sync", {
          policy: this.policy.dry(),
        })
        await browser.webRequest.handlerBehaviorChanged()
      }
      return this.policy
    },

    async save(obj) {
      if (obj && obj.storage) {
        const toBeSaved = {
          [obj.storage]: obj,
        }
        await Storage.set(obj.storage, toBeSaved)
      }
      return obj
    },

    async collectSeen(tabId) {
      try {
        const seen = Array.from(
          await Messages.send("collect", { uuid: ns.local.uuid }, { tabId, frameId: 0 })
        )
        debug("Collected seen", seen)
        return seen
      } catch (e) {
        await include("/lib/restricted.js")
        if (!isRestrictedURL((await browser.tabs.get(tabId)).url)) {
          // probably a page where content scripts cannot run, let's open the options instead
          error(e, "Cannot collect noscript activity data")
        }
      }
      return null
    },
  }
}

ns.start()
