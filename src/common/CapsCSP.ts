export {}

function CapsCSP(baseCSP = new CSP()) {
  return Object.assign(baseCSP, {
    types: ["script", "object", "media", "font"],
    dataUriTypes: ["font", "media", "object"],

    buildFromCapabilities(capabilities, blockHttp = false) {
      const forbidData = new Set(this.dataUriTypes.filter(t => !capabilities.has(t)))
      const blockedTypes = new Set(this.types.filter(t => !capabilities.has(t)))
      if (!capabilities.has("script")) {
        blockedTypes.add("worker")
        if (!blockedTypes.has("object")) {
          // data: URIs loaded in objects may run scripts
          blockedTypes.add({ name: "object", value: "http:" })
        }
      }

      if (!blockHttp) {
        // HTTP is blocked in onBeforeRequest, let's allow it only and block
        // for instance data: and blob: URIs
        for (const type of this.dataUriTypes) {
          if (blockedTypes.delete(type)) {
            blockedTypes.add({ name: type, value: "http:" })
          }
        }
      }

      return blockedTypes.size ? this.buildBlocker(...blockedTypes) : null
    },
  })
}
