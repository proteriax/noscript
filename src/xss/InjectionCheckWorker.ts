const include = src => {
  if (Array.isArray(src)) importScripts(...src)
  else importScripts(src)
}

const XSS = {}
include("/lib/log.js")

for (const logType of ["log", "debug", "error"]) {
  this[logType] = (...log) => {
    postMessage({ log, logType })
  }
}

include("InjectionChecker.js")
Entities = {
  convertAll(s) {
    return s
  },
}

{
  const timingsMap = new Map()

  const Handlers = {
    async check({ xssReq, skip }) {
      const { destUrl, unparsedRequest: request, debugging } = xssReq
      const { skipParams, skipRx } = skip
      const ic = new (await XSS.InjectionChecker)()

      if (debugging) {
        ic.logEnabled = true
        debug(
          "[XSS] InjectionCheckWorker started in %s ms (%s).",
          Date.now() - xssReq.timestamp,
          destUrl
        )
      } else {
        debug = () => {}
      }

      const { timing } = ic
      timingsMap.set(request.requestId, timing)
      timing.fatalTimeout = true

      const postInjection =
        xssReq.isPost &&
        request.requestBody &&
        request.requestBody.formData &&
        (await ic.checkPost(request.requestBody.formData, skipParams))

      let protectName = ic.nameAssignment
      const urlInjection = await ic.checkUrl(destUrl, skipRx)
      protectName = protectName || ic.nameAssignment
      if (timing.tooLong) {
        log("[XSS] Long check (%s ms) - %s", timing.elapsed, JSON.stringify(xssReq))
      } else if (debugging) {
        debug(
          "[XSS] InjectionCheckWorker done in %s ms (%s).",
          Date.now() - xssReq.timestamp,
          destUrl
        )
      }

      postMessage(
        !(protectName || postInjection || urlInjection)
          ? null
          : { protectName, postInjection, urlInjection }
      )
    },

    requestDone({ requestId }) {
      const timing = timingsMap.get(requestId)
      if (timing) {
        timing.interrupted = true
        timingsMap.delete(requestId)
      }
    },
  }

  onmessage = async e => {
    const msg = e.data
    if (msg.handler in Handlers)
      try {
        await Handlers[msg.handler](msg)
      } catch (e) {
        postMessage({ error: e.message })
      }
  }
}
