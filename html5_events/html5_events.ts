#!/usr/bin/env node -r avec-ts
import * as fs from "fs-extra"
import { uniq } from "lodash"
import {} from "path"
import fetch from "node-fetch"
import invariant from "tiny-invariant"

const HTML_ATOMS_URL =
  "https://hg.mozilla.org/mozilla-central/raw-file/tip/xpcom/ds/StaticAtoms.py"

const HERE = __dirname
const SOURCE_FILE = `${HERE}/../src/xss/InjectionChecker.js`

async function create_re() {
  const cache = `${HERE}/html5_events.re`
  const archive = `${HERE}/html5_events_archive.txt`
  // const sb = fs.statSync(cache)
  // if (Date.now() - sb.mtimeMs < 86400e3) {
  //   return fs.readFileSync(cache, "utf8")
  // }
  async function fetch_url(url: string) {
    const req = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    return await req.text()
  }
  let content = await fetch_url(HTML_ATOMS_URL)
  content = content
    .split("\n")
    .filter(line => /^\s*Atom\("on\w+"/.test(line))
    .join("\n")
    .replace(/.*"(on\w+)".*/g, "$1")
  const archived = await fs.readFile(archive, "utf8")
  content += archived
  content = content.replace(/\s+/g, "\n").replace(/^\s+|\s+$/g, "")
  const all_events = uniq(content.split("\n").filter(line => !/^only$/.test(line)))
  invariant(all_events.every(e => e.startsWith("on")))
  const cacheText = `on(${all_events.map(x => x.slice(2)).join("|")})`
  await fs.writeFile(archive, all_events.join("\n"))
  await fs.writeFile(cache, cacheText)
  return cacheText
}

async function patch(src: string) {
  const dst = `${src}.tmp`
  const re = await create_re()
  let must_replace = false
  console.log(`Patching ${src}...`)
  const source = await fs.readFile(src, "utf8")
  let output: string[] = []
  for (const line of source.split("\n")) {
    const next = line.replace(/(\s*const IC_EVENT_PATTERN\s*=\s*")([^"]+)/, "$1" + re)
    if (next !== line) {
      must_replace = true
    }
    output.push(line)
  }
  await fs.writeFile(dst, output.join("\n"))

  if (must_replace) {
    await fs.move(dst, src, { overwrite: true })
    console.log("Patched.")
    return 0
  }
  fs.unlink(dst)
  console.log("Nothing to do.")
  return 1
}

patch(SOURCE_FILE)
  .then(process.exit)
  .catch(e => {
    console.trace()
    throw e
  })
