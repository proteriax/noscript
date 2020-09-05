import "../lib/UA"
import "../lib/browser-polyfill"
import "../lib/include"
import "../lib/log"
import "../lib/flextabs"
import "../common/locale"
import "./ui"
import "../lib/persistent-tabs"

//
;(async () => {
  await UI.init()

  let policy = UI.policy

  const version = browser.runtime.getManifest().version
  document.querySelector("#version").textContent = _("Version", version)
  // simple general options

  const opt = UI.wireOption

  opt("global", o => {
    if (o) {
      policy.enforced = !o.checked
      UI.updateSettings({ policy })
    }
    const { enforced } = policy
    const disabled = !enforced
    for (const e of document.querySelectorAll(".enforcement_required")) {
      e.disabled = disabled
    }
    return disabled
  })

  opt("auto", o => {
    if (o) {
      policy.autoAllowTop = o.checked
      UI.updateSettings({ policy })
    }
    return policy.autoAllowTop
  })

  opt("cascadeRestrictions")

  opt("xss")

  opt("overrideTorBrowserPolicy")

  opt("amnesticUpdates", "local")

  {
    document.querySelector("#btn-reset")!.addEventListener("click", async () => {
      if (confirm(_("reset_warning"))) {
        policy = new Policy()
        await UI.updateSettings({ policy, local: null, sync: null, xssUserChoices: {} })
        window.location.reload()
      }
    })

    const fileInput = document.querySelector("#file-import")!
    fileInput.onchange = () => {
      const fr = new FileReader()
      fr.onload = async () => {
        try {
          await UI.importSettings(fr.result)
        } catch (e) {
          error(e, "Importing settings %s", fr.result)
        }
        location.reload()
      }
      fr.readAsText(fileInput.files[0])
    }

    document.querySelector("#btn-import")!.addEventListener("click", async e => {
      fileInput.focus()
      fileInput.click()
      e.target.focus()
    })

    document.querySelector("#btn-export")!.addEventListener("click", async e => {
      const button = e.target
      button.disabled = true
      const settings = await UI.exportSettings()
      const id = "noscriptExportFrame"
      let f = document.getElementById(id)
      if (f) f.remove()
      f = document.createElement("iframe")
      f.id = id
      f.srcdoc = `<a download="noscript_data.txt" target="_blank">NoScript Export</a>`
      f.style.position = "fixed"
      f.style.top = "-999px"
      f.style.height = "1px"
      f.onload = () => {
        const w = f.contentWindow
        const a = w.document.querySelector("a")
        a.href = w.URL.createObjectURL(
          new w.Blob([settings], {
            type: "text/plain",
          })
        )
        a.click()
        setTimeout(() => {
          button.disabled = false
        }, 1000)
      }
      document.body.appendChild(f)
    })
  }

  {
    const a = document.querySelector("#xssFaq a")
    a.onclick = e => {
      e.preventDefault()
      browser.tabs.create({
        url: a.href,
      })
    }
    const button = document.querySelector("#btn-delete-xss-choices")
    const choices = UI.xssUserChoices
    button.disabled = !choices || Object.keys(choices).length === 0
    button.onclick = () => {
      UI.updateSettings({
        xssUserChoices: {},
      })
      button.disabled = true
    }
  }

  opt("clearclick")
  opt("debug", "local", b => {
    document.body.classList.toggle("debug", b)
    if (b) updateRawPolicyEditor()
  })

  // Appearance

  opt("showCountBadge", "local")
  opt("showCtxMenuItem", "local")
  opt("showFullAddresses", "local")

  // PRESET CUSTOMIZER
  {
    const parent = document.getElementById("presets")
    const presetsUI = new UI.Sites(parent, {
      DEFAULT: true,
      TRUSTED: true,
      UNTRUSTED: true,
    })

    presetsUI.render([""])
    window.setTimeout(() => {
      const def = parent.querySelector('input.preset[value="DEFAULT"]')
      def.checked = true
      def.click()
    }, 10)
  }

  // SITES UI
  const sitesUI = new UI.Sites(document.getElementById("sites"))
  UI.onSettings = () => {
    policy = UI.policy
    sitesUI.render(policy.sites)
  }
  {
    sitesUI.onChange = () => {
      if (UI.local.debug) {
        updateRawPolicyEditor()
      }
    }
    sitesUI.render(policy.sites)

    const newSiteForm = document.querySelector("#form-newsite")
    const newSiteInput = newSiteForm.newsite
    const button = newSiteForm.querySelector("button")
    const canAdd = s => policy.get(s).siteMatch === null

    const validate = () => {
      const site = newSiteInput.value.trim()
      button.disabled = !(Sites.isValid(site) && canAdd(site))
      sitesUI.filterSites(site)
    }
    validate()
    newSiteInput.addEventListener("input", validate)

    newSiteForm.addEventListener(
      "submit",
      e => {
        e.preventDefault()
        e.stopPropagation()
        const site = newSiteInput.value.trim()
        const valid = Sites.isValid(site)
        if (valid && canAdd(site)) {
          policy.set(site, policy.TRUSTED)
          UI.updateSettings({ policy })
          newSiteInput.value = ""
          sitesUI.render(policy.sites)
          sitesUI.highlight(site)
          sitesUI.onChange()
        }
      },
      true
    )
  }

  // UTILITY FUNCTIONS

  function updateRawPolicyEditor() {
    if (!UI.local.debug) return

    // RAW POLICY EDITING (debug only)
    const policyEditor = document.getElementById("policy")
    policyEditor.value = JSON.stringify(policy.dry(true), null, 2)
    if (!policyEditor.onchange)
      policyEditor.onchange = e => {
        const ed = e.currentTarget
        try {
          UI.policy = policy = new Policy(JSON.parse(ed.value))
          UI.updateSettings({ policy })
          sitesUI.render(policy.sites)
          ed.className = ""
          document.getElementById("policy-error").textContent = ""
        } catch (e) {
          error(e)
          ed.className = "error"
          document.getElementById("policy-error").textContent = e.message
        }
      }
  }
})()
