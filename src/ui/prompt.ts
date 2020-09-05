import {} from "../lib/UA"
import {} from "../lib/browser-polyfill"
import {} from "../lib/include"
import {} from "../lib/log"
import {} from "../common/locale"
import {} from "./resize_hack"

//
;(async () => {
  window.bg = await browser.runtime.getBackgroundPage()
  ;["Prompts"].forEach(p => (window[p] = bg[p]))
  const data = Prompts.promptData
  debug(data)
  const { title, message, options, checks, buttons } = data.features

  function labelFor(el, text) {
    const label = document.createElement("label")
    label.setAttribute("for", el.id)
    label.textContent = text
    return label
  }

  function createInput(container, { label, type, name, checked }, count) {
    const input = document.createElement("input")
    input.type = type
    input.value = count
    input.name = name
    input.checked = checked
    input.id = `${name}-${count}`
    const sub = document.createElement("div")
    sub.appendChild(input)
    sub.appendChild(labelFor(input, label))
    container.appendChild(sub)
  }

  function createButton(container, label, count) {
    const button = document.createElement("button")
    if (count === 0) button.type = "submit"
    button.id = `${button}-${count}`
    button.value = count
    button.textContent = label
    container.appendChild(button)
  }

  function renderInputs(container, dataset, type, name) {
    if (typeof container === "string") {
      container = document.querySelector(container)
    }
    if (typeof dataset === "string") {
      container.innerHTML = dataset
      return
    }
    container.innerHTML = ""
    let count = 0
    if (dataset && dataset[Symbol.iterator]) {
      const create = type === "button" ? createButton : createInput
      for (const data of dataset) {
        data.type = type
        data.name = name
        create(container, data, count++)
      }
    }
  }
  if (title) {
    document.title = title
    document.querySelector("#title").textContent = title
  }
  if (message) {
    const lines = message.split(/\n/)
    const container = document.querySelector("#message")
    container.classList.toggle("multiline", lines.length > 1)
    message.innerHTML = ""
    for (const l of lines) {
      const p = document.createElement("p")
      p.textContent = l
      container.appendChild(p)
    }
  }
  renderInputs("#options", options, "radio", "opt")
  renderInputs("#checks", checks, "checkbox", "flag")
  renderInputs("#buttons", buttons, "button", "button")
  addEventListener("unload", e => {
    data.done()
  })

  const buttonClicked = e => {
    const { result } = data
    result.button = parseInt(e.currentTarget.value)
    const option = document.querySelector('#options [type="radio"]:checked')
    result.option = option && parseInt(option.value)
    result.checks = [
      ...document.querySelectorAll('#checks [type="checkbox"]:checked'),
    ].map(c => parseInt(c.value))
    data.done()
  }
  for (const b of document.querySelectorAll("#buttons button")) {
    b.addEventListener("click", buttonClicked)
  }
})()
