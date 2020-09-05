export {}

const RequestGuard = (() => {
  const VERSION_LABEL = `NoScript ${browser.runtime.getManifest().version}`
  browser.browserAction.setTitle({ title: VERSION_LABEL })
  const CSP_REPORT_URI = "https://noscript-csp.invalid/__NoScript_Probe__/"
  const CSP_MARKER = "noscript-marker"
  const csp = new ReportingCSP(CSP_MARKER, CSP_REPORT_URI)
  const policyTypesMap = {
    main_frame: "",
    sub_frame: "frame",
    script: "script",
    xslt: "script",
    xbl: "script",
    font: "font",
    object: "object",
    object_subrequest: "fetch",
    xmlhttprequest: "fetch",
    ping: "ping",
    beacon: "ping",
    media: "media",
    other: "",
  }

  Object.assign(policyTypesMap, { webgl: "webgl" }) // fake types
  const TabStatus = {
    map: new Map(),
    types: ["script", "object", "media", "frame", "font"],
    newRecords() {
      return {
        allowed: {},
        blocked: {},
        noscriptFrames: {},
        origins: new Set(),
      }
    },
    hasOrigin(tabId, origin) {
      const records = this.map.get(tabId)
      return records && records.origins.has(origin)
    },
    initTab(tabId, records = this.newRecords()) {
      if (tabId < 0) return
      this.map.set(tabId, records)
      return records
    },
    _record(request, what, optValue) {
      let { tabId, frameId, type, url, documentUrl } = request
      const policyType = policyTypesMap[type] || type
      const requestKey = Policy.requestKey(url, policyType, documentUrl)
      const map = this.map
      const records = map.has(tabId) ? map.get(tabId) : this.initTab(tabId)
      if (what === "noscriptFrame" && type !== "object") {
        const nsf = records.noscriptFrames
        nsf[frameId] = optValue
        what = optValue ? "blocked" : "allowed"
        if (frameId === 0) {
          request.type = type = "main_frame"
          Content.reportTo(request, optValue, type)
        }
      }
      if (type.endsWith("frame")) {
        records.origins.add(Sites.origin(url))
      }
      const collection = records[what]
      if (collection) {
        if (type in collection) {
          if (!collection[type].includes(requestKey)) {
            collection[type].push(requestKey)
          }
        } else {
          collection[type] = [requestKey]
        }
      }
      return records
    },
    record(request, what, optValue) {
      const { tabId } = request
      if (tabId < 0) return
      const records = this._record(request, what, optValue)
      if (records) {
        this.updateTab(request.tabId)
      }
    },
    _pendingTabs: new Set(),
    updateTab(tabId) {
      if (tabId < 0) return
      if (this._pendingTabs.size === 0) {
        window.setTimeout(() => {
          // clamp UI updates
          for (const tabId of this._pendingTabs) {
            this._updateTabNow(tabId)
          }
          this._pendingTabs.clear()
        }, 200)
      }
      this._pendingTabs.add(tabId)
    },
    _updateTabNow(tabId) {
      this._pendingTabs.delete(tabId)
      const records = this.map.get(tabId) || this.initTab(tabId)
      const { allowed, blocked, noscriptFrames } = records
      const topAllowed = !(noscriptFrames && noscriptFrames[0])
      let numAllowed = 0,
        numBlocked = 0,
        sum = 0
      const report = this.types
        .map(t => {
          const a = (allowed[t] && allowed[t].length) || 0,
            b = (blocked[t] && blocked[t].length) || 0,
            s = a + b
          ;(numAllowed += a), (numBlocked += b), (sum += s)
          return s && `<${t === "sub_frame" ? "frame" : t}>: ${b}/${s}`
        })
        .filter(s => s)
        .join("\n")
      const enforced = ns.isEnforced(tabId)
      const icon = enforced
        ? topAllowed
          ? numBlocked
            ? "part"
            : "yes"
          : numAllowed
          ? "sub"
          : "no" // not topAllowed
        : "global" // not enforced
      const showBadge = ns.local.showCountBadge && numBlocked > 0
      const browserAction = browser.browserAction
      if (!browserAction.setIcon) {
        // Fennec
        browserAction.setTitle({ tabId, title: `NoScript (${numBlocked})` })
        return
      }

      browserAction.setIcon({ tabId, path: { 64: `/img/ui-${icon}64.png` } })
      browserAction.setBadgeText({ tabId, text: showBadge ? numBlocked.toString() : "" })
      browserAction.setBadgeBackgroundColor({ tabId, color: [128, 0, 0, 160] })
      browserAction.setTitle({
        tabId,
        title: UA.mobile
          ? "NoScript"
          : `${VERSION_LABEL} \n${
              enforced
                ? _("BlockedItems", [numBlocked, numAllowed + numBlocked]) +
                  ` \n${report}`
                : _("NotEnforced")
            }`,
      })
    },
    async probe(tabId) {
      if (tabId === undefined) {
        ;(await browser.tabs.query({})).forEach(tab => TabStatus.probe(tab.id))
      } else {
        try {
          TabStatus.recordAll(tabId, await ns.collectSeen(tabId))
        } catch (e) {
          error(e)
        }
      }
    },
    recordAll(tabId, seen) {
      if (seen) {
        const records = TabStatus.map.get(tabId)
        if (records) {
          records.allowed = {}
          records.blocked = {}
        }
        for (const thing of seen) {
          const { request, allowed } = thing
          request.tabId = tabId
          debug(`Recording`, request)
          TabStatus._record(request, allowed ? "allowed" : "blocked")
          if (request.key === "noscript-probe" && request.type === "main_frame") {
            request.frameId = 0
            TabStatus._record(request, "noscriptFrame", !allowed)
          }
        }
        this._updateTabNow(tabId)
      }
    },
    async onActivatedTab(info) {
      const { tabId } = info
      const seen = await ns.collectSeen(tabId)
      TabStatus.recordAll(tabId, seen)
    },
    onRemovedTab(tabId) {
      TabStatus.map.delete(tabId)
    },
  }
  browser.tabs.onActivated.addListener(TabStatus.onActivatedTab)
  browser.tabs.onRemoved.addListener(TabStatus.onRemovedTab)
  const messageHandler = {
    async pageshow(message, sender) {
      TabStatus.recordAll(sender.tab.id, message.seen)
      return true
    },
    violation({ url, type }, sender) {
      const tabId = sender.tab.id
      const { frameId } = sender
      const r = {
        url,
        type,
        tabId,
        frameId,
      }
      Content.reportTo(r, false, policyTypesMap[type])
      if (type === "script" && url === sender.url) {
        TabStatus.record(r, "noscriptFrame", true)
      } else {
        TabStatus.record(r, "blocked")
      }
    },
    async blockedObjects(message, sender) {
      const { url, documentUrl, policyType } = message
      const TAG = `<${policyType.toUpperCase()}>`
      let origin = Sites.origin(url)
      const { siteKey } = Sites.parse(url)
      let options
      if (siteKey === origin) {
        origin = new URL(url).protocol
      }
      options = [
        { label: _("allowLocal", siteKey), checked: true },
        { label: _("allowLocal", origin) },
        { label: _("CollapseBlockedObjects") },
      ]
      const t = u => `${TAG}@${u}`
      const ret = await Prompts.prompt({
        title: _("BlockedObjects"),
        message: _("allowLocal", TAG),
        options,
      })
      debug(`Prompt returned`, ret, sender)
      if (ret.button !== 0) return
      if (ret.option === 2) {
        return { collapse: "all" }
      }
      const key = [siteKey, origin][ret.option || 0]
      if (!key) return
      let { siteMatch, contextMatch, perms } = ns.policy.get(key, documentUrl)
      const { capabilities } = perms
      if (!capabilities.has(policyType)) {
        const temp = sender.tab.incognito // we don't want to store in PBM
        perms = new Permissions(new Set(capabilities), temp)
        perms.capabilities.add(policyType)
        /* TODO: handle contextual permissions
        if (documentUrl) {
          let context = new URL(documentUrl).origin;
          let contextualSites = new Sites([context, perms]);
          perms = new Permissions(new Set(capabilities), false, contextualSites);
        }
        */
        ns.policy.set(key, perms)
        await ns.savePolicy()
      }
      return { enable: key }
    },
  }
  const Content = {
    async reportTo(request, allowed, policyType) {
      const { requestId, tabId, frameId, type, url, documentUrl, originUrl } = request
      const pending = pendingRequests.get(requestId) // null if from a CSP report
      const initialUrl = pending ? pending.initialUrl : request.url
      request = {
        key: Policy.requestKey(
          url,
          type,
          documentUrl || "",
          /^(media|object|frame)$/.test(type)
        ),
        type,
        url,
        documentUrl,
        originUrl,
      }
      if (tabId < 0) {
        if (
          type === "script" &&
          url.startsWith("https://") &&
          documentUrl &&
          documentUrl.startsWith("https://")
        ) {
          // service worker / importScripts()?
          const payload = {
            request,
            allowed,
            policyType,
            serviceWorker: Sites.origin(documentUrl),
          }
          const recipient = { frameId: 0 }
          for (const tab of await browser.tabs.query({
            url: ["http://*/*", "https://*/*"],
          })) {
            recipient.tabId = tab.id
            Messages.send("seen", payload, recipient)
          }
        }
        return
      }
      if (pending) request.initialUrl = pending.initialUrl
      if (type !== "sub_frame") {
        // we couldn't deliver it to frameId, since it's generally not loaded yet
        try {
          await Messages.send(
            "seen",
            { request, allowed, policyType, ownFrame: true },
            { tabId, frameId }
          )
        } catch (e) {
          debug(
            `Couldn't deliver "seen" message for ${type}@${url} ${
              allowed ? "A" : "F"
            } to document ${documentUrl} (${frameId}/${tabId})`,
            e
          )
        }
      }
      if (frameId === 0) return
      try {
        await Messages.send(
          "seen",
          { request, allowed, policyType },
          { tabId, frameId: 0 }
        )
      } catch (e) {
        debug(
          `Couldn't deliver "seen" message to top frame containing ${documentUrl} (${frameId}/${tabId}`,
          e
        )
      }
    },
  }
  const pendingRequests = new Map()
  function initPendingRequest(request) {
    const { requestId, url } = request
    const redirected = pendingRequests.get(requestId)
    const initialUrl = redirected ? redirected.initialUrl : url
    pendingRequests.set(requestId, {
      initialUrl,
      url,
      redirected,
      onCompleted: new Set(),
    })
    return redirected
  }

  const normalizeRequest = UA.isMozilla
    ? () => {}
    : request => {
        if ("initiator" in request && !("originUrl" in request)) {
          request.originUrl = request.initiator
          if (request.type !== "main_frame" && !("documentUrl" in request)) {
            request.documentUrl = request.initiator
          }
        }
      }

  function intersectCapabilities(perms, request) {
    const { frameId, frameAncestors, tabId } = request
    if (frameId !== 0 && ns.sync.cascadeRestrictions) {
      let topUrl =
        frameAncestors &&
        frameAncestors.length &&
        frameAncestors[frameAncestors.length - 1].url
      if (!topUrl) {
        const tab = TabCache.get(tabId)
        if (tab) topUrl = tab.url
      }
      if (topUrl) {
        return ns.policy.cascadeRestrictions(perms, topUrl).capabilities
      }
    }
    return perms.capabilities
  }

  const ABORT = { cancel: true },
    ALLOW = {}
  const listeners = {
    onBeforeRequest(request) {
      normalizeRequest(request)
      try {
        const redirected = initPendingRequest(request)
        const { policy } = ns
        const { type } = request
        if (type in policyTypesMap) {
          const policyType = policyTypesMap[type]
          let { url, originUrl, documentUrl, tabId } = request
          const isFetch = "fetch" === policyType

          if (
            (isFetch || "frame" === policyType) &&
            ((((isFetch &&
              (!originUrl ||
                (browser.runtime.onSyncMessage &&
                  url.includes(browser.runtime.onSyncMessage.ENDPOINT_PREFIX)))) ||
              url === originUrl) &&
              originUrl === documentUrl) ||
              // some extensions make them both undefined,
              // see https://github.com/eight04/image-picka/issues/150
              Sites.isInternal(originUrl))
          ) {
            // livemark request or similar browser-internal, always allow;
            return ALLOW
          }

          if (/^(?:data|blob):/.test(url)) {
            request._dataUrl = url
            request.url = url = documentUrl || originUrl
          }

          let allowed = Sites.isInternal(url)
          if (!allowed) {
            if (tabId < 0 && documentUrl && documentUrl.startsWith("https://")) {
              const origin = Sites.origin(documentUrl)
              allowed = [...ns.unrestrictedTabs].some(tabId =>
                TabStatus.hasOrigin(tabId, origin)
              )
            } else {
              allowed = !ns.isEnforced(tabId)
            }
            if (!allowed) {
              const capabilities = intersectCapabilities(
                policy.get(url, documentUrl).perms,
                request
              )
              allowed = !policyType || capabilities.has(policyType)
              if (allowed && request._dataUrl && type.endsWith("frame")) {
                const blocker = csp.buildFromCapabilities(capabilities)
                if (blocker) {
                  const redirectUrl = CSP.patchDataURI(request._dataUrl, blocker)
                  if (redirectUrl !== request._dataUrl) {
                    return { redirectUrl }
                  }
                }
              }
            }
          }
          Content.reportTo(request, allowed, policyType)
          if (!allowed) {
            debug(`Blocking ${policyType}`, request)
            TabStatus.record(request, "blocked")
            return ABORT
          }
        }
      } catch (e) {
        error(e)
      }
      return ALLOW
    },
    onHeadersReceived(request) {
      // called for main_frame, sub_frame and object

      // check for duplicate calls
      let pending = pendingRequests.get(request.requestId)
      if (pending) {
        if (pending.headersProcessed) {
          if (!request.fromCache) {
            debug("Headers already processed, skipping ", request)
            return ALLOW
          }
          debug("Reprocessing headers for cached request ", request)
        } else {
          debug("onHeadersReceived", request)
        }
      } else {
        debug("[WARNING] no pending information for ", request)
        initPendingRequest(request)
        pending = pendingRequests.get(request.requestId)
      }
      if (
        request.fromCache &&
        listeners.onHeadersReceived.resetCSP &&
        !pending.resetCachedCSP
      ) {
        debug("Resetting CSP Headers")
        pending.resetCachedCSP = true
        const { responseHeaders } = request
        const headersCount = responseHeaders.length
        const purged = false
        responseHeaders.forEach((h, index) => {
          if (csp.isMine(h)) {
            responseHeaders.splice(index, 1)
          }
        })
        if (headersCount > responseHeaders.length) {
          debug("Resetting cached NoScript CSP header(s)", request)
          return { responseHeaders }
        }
      }

      normalizeRequest(request)
      let result = ALLOW
      let promises = []
      let headersModified = false

      pending.headersProcessed = true
      const { url, documentUrl, tabId, responseHeaders, type } = request
      const isMainFrame = type === "main_frame"
      try {
        let capabilities
        if (ns.isEnforced(tabId)) {
          const policy = ns.policy
          let perms = policy.get(url, documentUrl).perms
          if (isMainFrame) {
            if (policy.autoAllowTop && perms === policy.DEFAULT) {
              policy.set(Sites.optimalKey(url), (perms = policy.TRUSTED.tempTwin))
            }
            capabilities = perms.capabilities
          } else {
            capabilities = intersectCapabilities(perms, request)
          }
        } // else unrestricted, either globally or per-tab
        if (isMainFrame && !TabStatus.map.has(tabId)) {
          debug("No TabStatus data yet for noscriptFrame", tabId)
          TabStatus.record(
            request,
            "noscriptFrame",
            capabilities && !capabilities.has("script")
          )
        }
        const header = csp.patchHeaders(responseHeaders, capabilities)
        /*
        // Uncomment me to disable networking-level CSP for debugging purposes
        header = null;
        */
        if (header) {
          pending.cspHeader = header
          debug(`CSP blocker on %s:`, url, header.value)
          headersModified = true
        }
        if (headersModified) {
          result = { responseHeaders }
          debug("Headers changed ", request)
        }
      } catch (e) {
        error(e, "Error in onHeadersReceived", request)
      }
      promises = promises.filter(p => p instanceof Promise)
      if (promises.length > 0) {
        return Promise.all(promises).then(() => result)
      }
      return result
    },
    onResponseStarted(request) {
      normalizeRequest(request)
      debug("onResponseStarted", request)
      const { requestId, url, tabId, frameId, type } = request
      if (type === "main_frame") {
        TabStatus.initTab(tabId)
      }
      const scriptBlocked = request.responseHeaders.some(
        h => csp.isMine(h) && csp.blocks(h.value, "script")
      )
      debug(
        "%s scriptBlocked=%s setting noscriptFrame on ",
        url,
        scriptBlocked,
        tabId,
        frameId
      )
      TabStatus.record(request, "noscriptFrame", scriptBlocked)
      const pending = pendingRequests.get(requestId)
      if (pending) {
        pending.scriptBlocked = scriptBlocked
        if (
          !(
            pending.headersProcessed &&
            (scriptBlocked || ns.requestCan(request, "script"))
          )
        ) {
          debug(
            "[WARNING] onHeadersReceived %s %o",
            frameId,
            tabId,
            pending.headersProcessed ? "has been overridden on" : "could not process",
            request
          )
        }
      }
    },
    onCompleted(request) {
      const { requestId } = request
      if (pendingRequests.has(requestId)) {
        const r = pendingRequests.get(requestId)
        pendingRequests.delete(requestId)
        for (const callback of r.onCompleted) {
          try {
            callback(request, r)
          } catch (e) {
            error(e)
          }
        }
      }
    },
    onErrorOccurred(request) {
      pendingRequests.delete(request.requestId)
    },
  }
  function fakeRequestFromCSP(report, request) {
    let type = report["violated-directive"].split("-", 1)[0] // e.g. script-src 'none' => script
    if (type === "frame") type = "sub_frame"
    let url = report["blocked-uri"]
    if (!url || url === "self") url = request.documentUrl
    return Object.assign({}, request, {
      url,
      type,
    })
  }

  const utf8Decoder = new TextDecoder("UTF-8")
  function onViolationReport(request) {
    try {
      const text = utf8Decoder.decode(request.requestBody.raw[0].bytes)
      if (text.includes(`"inline"`)) return ABORT
      const report = JSON.parse(text)["csp-report"]
      const originalPolicy = report["original-policy"]
      debug("CSP report", report)
      const blockedURI = report["blocked-uri"]
      if (blockedURI && blockedURI !== "self") {
        const r = fakeRequestFromCSP(report, request)
        if (!/:/.test(r.url)) r.url = request.documentUrl
        Content.reportTo(r, false, policyTypesMap[r.type])
        TabStatus.record(r, "blocked")
      } else if (
        report["violated-directive"] === "script-src" &&
        originalPolicy.includes("; script-src 'none'")
      ) {
        const r = fakeRequestFromCSP(report, request)
        Content.reportTo(r, false, "script") // NEW
        TabStatus.record(r, "noscriptFrame", true)
      }
    } catch (e) {
      error(e)
    }
    return ABORT
  }
  const RequestGuard = {
    async start() {
      Messages.addHandler(messageHandler)
      const wr = browser.webRequest
      const listen = (what, ...args) => wr[what].addListener(listeners[what], ...args)
      const allUrls = ["<all_urls>"]
      const docTypes = ["main_frame", "sub_frame", "object"]
      const filterDocs = { urls: allUrls, types: docTypes }
      const filterAll = { urls: allUrls }
      listen("onBeforeRequest", filterAll, ["blocking"])

      let mergingCSP = "getBrowserInfo" in browser.runtime
      if (mergingCSP) {
        const { vendor, version } = await browser.runtime.getBrowserInfo()
        mergingCSP = vendor === "Mozilla" && parseInt(version) >= 77
      }
      if (mergingCSP) {
        // In Gecko>=77 (https://bugzilla.mozilla.org/show_bug.cgi?id=1462989)
        // we need to cleanup our own cached headers in a dedicated listener :(
        // see also https://trac.torproject.org/projects/tor/ticket/34305
        wr.onHeadersReceived.addListener(
          (listeners.onHeadersReceived.resetCSP = request =>
            listeners.onHeadersReceived(request)),
          filterDocs,
          ["blocking", "responseHeaders"]
        )
      }
      listen("onHeadersReceived", filterDocs, ["blocking", "responseHeaders"])
      // Still, other extensions may accidentally delete our CSP header
      // if called before us, hence we try our best reinjecting it in the end
      ;(listeners.onHeadersReceivedLast = new LastListener(
        wr.onHeadersReceived,
        request => {
          const { requestId, responseHeaders } = request
          const pending = pendingRequests.get(request.requestId)
          if (pending && pending.headersProcessed) {
            const { cspHeader } = pending
            if (cspHeader) {
              responseHeaders.push(cspHeader)
              return { responseHeaders }
            }
          } else {
            debug("[WARNING] onHeadersReceived not called (yet?)", request)
          }
          return ALLOW
        },
        filterDocs,
        ["blocking", "responseHeaders"]
      )).install()

      listen("onResponseStarted", filterDocs, ["responseHeaders"])
      listen("onCompleted", filterAll)
      listen("onErrorOccurred", filterAll)
      if (csp.reportURI) {
        wr.onBeforeRequest.addListener(
          onViolationReport,
          { urls: [csp.reportURI], types: ["csp_report"] },
          ["blocking", "requestBody"]
        )
      }
      TabStatus.probe()
    },
    stop() {
      const wr = browser.webRequest
      for (const [name, listener] of Object.entries(listeners)) {
        if (typeof listener === "function") {
          wr[name].removeListener(listener)
        } else if (listener instanceof LastListener) {
          listener.uninstall()
        }
      }
      wr.onBeforeRequest.removeListener(onViolationReport)
      if (listeners.onHeadersReceived.resetCSP) {
        wr.onHeadersReceived.removeListener(listeners.onHeadersReceived.resetCSP)
      }
      Messages.removeHandler(messageHandler)
    },
  }
  return RequestGuard
})()
