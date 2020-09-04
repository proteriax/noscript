#!/usr/bin/env node -r avec-ts
import { writeJSONSync, copySync } from "fs-extra"
import { resolve } from "path"
import { execSync } from "child_process"

const BASE = process.cwd()
const SRC = `${BASE}/src`
const BUILD = `${BASE}/build`
const CHROMIUM = `${BASE}/chromium`
const MANIFEST_IN = `${SRC}/manifest.json`
const MANIFEST_OUT = `${BUILD}/manifest.json`

const args = process.argv.slice(2)

function strip_rc_ver(MANIFEST: string, $2?: "rel") {
  const source: { version: string } = require(MANIFEST)
  if ($2 == "rel") {
    source.version = source.version.replace(/rc\d+$/, "")
  } else {
    source.version = source.version.replace(/(\d+)rc(\d+)/, (_, $2: string, $3: string) =>
      $2 == "0" ? "0" : `${parseInt($2, 10) - 1}.9${$3.padStart(3, "0")}`
    )
  }
  writeJSONSync(MANIFEST, source, { spaces: 2 })
}

const VER = require(MANIFEST_IN).version
if (args[0] == "tag") {
  tag()
}
function tag() {
  console.log("Tagging at $VER")
  execSync(`git tag -a "${VER}" && git push origin "${VER}"`)
  process.exit(0)
}

if (["r", "rel", "release"].includes(args[0])) {
  strip_rc_ver("$MANIFEST_IN", "rel")
  execSync(`"${process.argv[1]}" && "${process.argv[1]}" bump`)
  process.exit()
}

if (args[0] == "bump") {
  bump()
}
function bump() {
  const $2 = args[1]
  if ($2) {
    let NEW_VER = $2
    let pattern: RegExp
    if ($2.includes(".")) {
      // full dotted version number
      pattern = /"\d+.*?/
      NEW_VER = `.${$2}`
    } else if ($2.includes("rc")) {
      // new RC after release
      if ($2.startsWith("rc")) {
        if (!VER.includes("rc")) {
          console.error(
            "Please specify next release version (like 12rc1). Current is $VER"
          )
          process.exit(1)
        } else {
          pattern = /rc\d+/
        }
      } else {
        pattern = /\b(?:\d+rc)?\d+/
      }
    } else {
      // incremental version
      pattern = /\b\d+/
    }
    const source: { version: string } = require(MANIFEST_IN)
    source.version = source.version.replace(pattern, NEW_VER)
    writeJSONSync(MANIFEST_IN, source, { spaces: 2 })
    process.exit()
  }
  console.log("Bumping to $VER")
  execSync(`git add "${MANIFEST_IN}"`)
  execSync(`git commit -m "Version bump: ${VER}."`)
  if (!VER.includes("rc")) tag()
  process.exit()
}

const XPI_DIR = `${BASE}/xpi`
const XPI = `${XPI_DIR}/noscript-$VER`
const LIB = `${SRC}/lib`
const TLD = `${BASE}/TLD`

if (true || args[0] === "tld") {
  copySync(`${TLD}/tld.js`, LIB)
  execSync(`git add src/lib/tld.js TLD && git commit -m 'Updated TLDs.'`)
}

// if ./html5_events/html5_events.pl; then
//   # update full event list as an array in src/content/syncFetchPolicy.js
//   EVENTS=$(egrep '^on[a-z]+$' html5_events/html5_events_archive.txt | sed "s/^on//;s/.*/'&'/;H;1h;"'$!d;x;s/\n/, /g');
//   perl -pi -e 's/(\blet eventTypes\s*=\s*)\[.*?\]/$1['"$EVENTS"']/' src/content/syncFetchPolicy.js
// fi

// rm -rf "$BUILD" "$XPI"
// cp -pR "$SRC" "$BUILD"
// cp -p LICENSE.txt GPL.txt "$BUILD"/

// BUILD_CMD="web-ext"
// BUILD_OPTS="build --overwrite-dest"
// CHROMIUM_BUILD_OPTS="$BUILD_OPTS"

// if [[ $VER == *rc* ]]; then
//   sed -re 's/^(\s+)"strict_min_version":.*$/\1"update_url": "https:\/\/secure.informaction.com\/update\/?v='$VER'",\n\0/' \
//     "$MANIFEST_IN" > "$MANIFEST_OUT"
//   if [[ "$1" == "sign" ]]; then
//     BUILD_CMD="$BASE/../../we-sign"
//     BUILD_OPTS=""
//   fi
// else
//   grep -v '"update_url":' "$MANIFEST_IN" > "$MANIFEST_OUT"
//   if [[ "$1" == "sign" ]]; then
//     echo >&2 "WARNING: won't auto-sign a release version, please manually upload to AMO."
//   fi
// fi
// if ! grep '"id":' "$MANIFEST_OUT" >/dev/null; then
//   echo >&2 "Cannot build manifest.json"
//   exit 1
// fi

// if [ "$1" != "debug" ]; then
//   for file in "$SRC"/content/*.js; do
//     if grep -P '\/\/\s(REL|DEV)_ONLY' "$file" >/dev/null; then
//       sed -re 's/\s*\/\/\s*(\S.*)\s*\/\/\s*REL_ONLY.*/\1/' -e 's/.*\/\/\s*DEV_ONLY.*//' "$file" > "$BUILD/content/$(basename "$file")"
//     fi
//   done
// fi

// echo "Creating $XPI.xpi..."
// mkdir -p "$XPI_DIR"

// if which cygpath; then
//   WEBEXT_IN="$(cygpath -w "$BUILD")"
//   WEBEXT_OUT="$(cygpath -w "$XPI_DIR")"
// else
//   WEBEXT_IN="$BUILD"
//   WEBEXT_OUT="$XPI_DIR"
// fi

// COMMON_BUILD_OPTS="--ignore-files=test/XSS_test.js"

// "$BUILD_CMD" $BUILD_OPTS --source-dir="$WEBEXT_IN" --artifacts-dir="$WEBEXT_OUT" $COMMON_BUILD_OPTS
// SIGNED="$XPI_DIR/noscript_security_suite-$VER-an+fx.xpi"
// if [ -f "$SIGNED" ]; then
//   mv "$SIGNED" "$XPI.xpi"
//   ../../we-publish "$XPI.xpi"
// elif [ -f "$XPI.zip" ]; then
//   [[ "$VER" == *rc* ]] && xpicmd="mv" || xpicmd="cp"
//   $xpicmd "$XPI.zip" "$XPI.xpi"
// else
//   echo >&2 "ERROR: Could not create $XPI.xpi!"
//   exit 3
// fi
// echo "Created $XPI.xpi"
// ln -fs $XPI.xpi "$BASE/latest.xpi"
// # create chromium pre-release
// rm -rf "$CHROMIUM"
// strip_rc_ver "$MANIFEST_OUT"
// # skip "application" manifest key
// (grep -B1000 '"name": "NoScript"' "$MANIFEST_OUT"; \
//   grep -A2000 '"version":' "$MANIFEST_OUT") > "$MANIFEST_OUT".tmp && \
//   mv "$MANIFEST_OUT.tmp" "$MANIFEST_OUT"
// mv "$BUILD" "$CHROMIUM"
// web-ext $CHROMIUM_BUILD_OPTS --source-dir="$CHROMIUM" --artifacts-dir="$WEBEXT_OUT" $COMMON_BUILD_OPTS
