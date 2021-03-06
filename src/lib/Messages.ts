export {}

const handlers = new Set()

const dispatch = (msg, sender) => {
  let { __meta, _messageName } = msg
  if (!__meta) {
    // legacy message from embedder or library? ignore it
    if (!_messageName) {
      debug(`Message not in NoScript-specific format: %s`, JSON.stringify(msg))
      return undefined
    }
    __meta = { name: _messageName }
  }
  delete msg.__meta
  delete msg._messageName
  const { name } = __meta
  let responderFound = false
  let exception = null
  for (const h of handlers) {
    const f = h[name]

    if (typeof f === "function") {
      let result
      try {
        result = f(msg, sender)
      } catch (e) {
        error(e)
        exception = e
        continue
      }
      if (typeof result === "undefined") {
        responderFound = true
        continue
      }
      return result instanceof Promise ? result : new Promise(r => r(result))
    }
  }
  if (exception) throw exception
  if (!responderFound) {
    debug(
      "Warning: no handler for message %s %s in context %s",
      name,
      JSON.stringify(msg),
      document.URL
    )
  }
}

const Messages = {
  addHandler(handler) {
    const originalSize = handlers.size
    handlers.add(handler)
    if (originalSize === 0 && handlers.size === 1) {
      browser.runtime.onMessage.addListener(dispatch)
    }
  },

  removeHandler(handler) {
    const originalSize = handlers.size
    handlers.delete(handler)
    if (originalSize === 1 && handlers.size === 0) {
      browser.runtime.onMessage.removeListener(dispatch)
    }
  },

  async send(name, args = {}, recipientInfo = null) {
    args.__meta = { name, recipientInfo }
    args._messageName = name // legacy protocol, for embedders
    if (recipientInfo && "tabId" in recipientInfo) {
      let opts
      if ("frameId" in recipientInfo) opts = { frameId: parseInt(recipientInfo.frameId) }
      return await browser.tabs.sendMessage(parseInt(recipientInfo.tabId), args, opts)
    }
    return await browser.runtime.sendMessage(args)
  },

  isMissingEndpoint(error) {
    return (
      error &&
      error.message === "Could not establish connection. Receiving end does not exist."
    )
  },
}
