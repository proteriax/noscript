export {}
if (typeof exportFunction === "function")
  ns.on("capabilities", event => {
    debug(
      "WebGL Hook",
      document.URL,
      document.documentElement && document.documentElement.innerHTML,
      ns.capabilities
    ) // DEV_ONLY
    if (ns.allows("webgl")) return

    // win: window object to modify.
    // modifyTarget: callback to function that modifies the desired properties
    //                or methods. Callback must take target window as argument.
    function modifyWindow(win, modifyTarget) {
      try {
        modifyTarget(win)
        modifyWindowOpenMethod(win, modifyTarget)
        modifyFramingElements(win, modifyTarget)
      } catch (e) {
        if (e instanceof DOMException && e.name === "SecurityError") {
          // In case someone tries to access SOP restricted window.
          // We can just ignore this.
        } else throw e
      }
    }

    function modifyWindowOpenMethod(win, modifyTarget) {
      const windowOpen = win.wrappedJSObject ? win.wrappedJSObject.open : win.open
      exportFunction(
        function (...args) {
          const newWin = windowOpen.call(this, ...args)
          if (newWin) modifyWindow(newWin, modifyTarget)
          return newWin
        },
        win,
        { defineAs: "open" }
      )
    }

    function modifyFramingElements(win, modifyTarget) {
      for (const property of ["contentWindow", "contentDocument"]) {
        for (const _interface of ["Frame", "IFrame", "Object"]) {
          const proto = win[`HTML${_interface}Element`].prototype
          modifyContentProperties(proto, property, modifyTarget)
        }
      }
    }

    function modifyContentProperties(proto, property, modifyTarget) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, property)
      const origGetter = descriptor.get
      let replacementFn

      if (property === "contentWindow") {
        replacementFn = function () {
          const win = origGetter.call(this)
          if (win) modifyWindow(win, modifyTarget)
          return win
        }
      }
      if (property === "contentDocument") {
        replacementFn = function () {
          const document = origGetter.call(this)
          if (document && document.defaultView)
            modifyWindow(document.defaultView, modifyTarget)
          return document
        }
      }

      descriptor.get = exportFunction(replacementFn, proto, { defineAs: `get $property` })
      const wrappedProto = proto.wrappedJSObject || proto
      Object.defineProperty(wrappedProto, property, descriptor)
    }

    //

    function modifyGetContext(win) {
      const proto = win.HTMLCanvasElement.prototype
      const getContext = proto.getContext
      exportFunction(
        function (type, ...rest) {
          if (type && type.toLowerCase().includes("webgl")) {
            const request = {
              id: "noscript-webgl",
              type: "webgl",
              url: document.URL,
              documentUrl: document.URL,
              embeddingDocument: true,
            }
            seen.record({ policyType: "webgl", request, allowed: false })
            try {
              const ph = PlaceHolder.create("webgl", request)
              ph.replace(this)
              PlaceHolder.listen()
            } catch (e) {
              error(e)
            }
            notifyPage()
            return {}
          }
          return getContext.call(this, type, ...rest)
        },
        proto,
        { defineAs: "getContext" }
      )
    }

    modifyWindow(window, modifyGetContext)
  })
