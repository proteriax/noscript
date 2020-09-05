{
  const toolbar = document.getElementById("top")!
  const spacer = toolbar.querySelector(".spacer")
  const hider = toolbar.querySelector(".hider")!

  if (UI.local.toolbarLayout) {
    const { left, right, hidden } = UI.local.toolbarLayout
    for (const id of left) {
      toolbar.insertBefore(document.getElementById(id)!, hider)
    }
    for (const id of right) {
      toolbar.appendChild(document.getElementById(id)!)
    }
    for (const id of hidden) {
      hider.appendChild(document.getElementById(id)!)
    }
  }

  function toggleHider(b) {
    const cl = hider.classList
    cl.toggle("open", b)
    cl.toggle("empty", !hider.querySelector(".icon"))
  }
  hider.querySelector(".hider-close")!.onclick = e => {
    toggleHider(false)
  }

  toggleHider(false)

  const dnd = {
    dragstart(ev) {
      const d = ev.target
      if (hider.querySelectorAll(".icon").length) {
        toggleHider(true)
      }

      if (!d.classList.contains("icon")) {
        ev.preventDefault()
        return
      }
      d.style.opacity = ".5"
      d.style.filter = "none"
      const dt = ev.dataTransfer
      dt.setData("text/plain", d.id)
      dt.dropEffect = "move"
      dt.setDragImage(d, d.offsetWidth / 2, d.offsetHeight / 2)
      toggleHider(true)
      this.draggedElement = d
    },
    dragend(ev) {
      const d = ev.target
      d.style.opacity = ""
      d.style.filter = ""
      this.draggedElement = null
    },
    dragover(ev) {
      ev.preventDefault()
    },
    dragenter(ev) {},
    dragleave(ev) {},
    drop(ev) {
      const t = ev.target
      const d = ev.dataTransfer
        ? document.getElementById(ev.dataTransfer.getData("text/plain"))
        : this.draggedElement
      if (!d) return
      switch (t) {
        case hider:
          t.appendChild(d)
          break
        default:
          if (!t.closest("#top")) return // outside the toolbar?
          let stop = null
          for (const c of toolbar.children) {
            if (ev.clientX < c.offsetLeft + c.offsetWidth / 2) {
              stop = c
              break
            }
          }
          toolbar.insertBefore(d, stop)
      }

      const left = [],
        right = []
      let side = left
      for (const el of document.querySelectorAll("#top > .icon, #top > .spacer")) {
        if (el === spacer) {
          side = right
        } else {
          side.push(el.id)
        }
      }
      UI.local.toolbarLayout = {
        left,
        right,
        hidden: Array.from(document.querySelectorAll("#top > .hider > .icon")).map(
          el => el.id
        ),
      }

      debug("%o", UI.local)
      UI.updateSettings({ local: UI.local })
    },

    click(ev) {
      const el = ev.target
      if (el.parentNode === hider && el.classList.contains("icon")) {
        ev.preventDefault()
        ev.stopPropagation()
      } else if (el === spacer || el.classList.contains("reveal")) {
        toggleHider(true)
      }
    },
  }

  for (const [action, handler] of Object.entries(dnd)) {
    toolbar.addEventListener(action, handler, true)
  }

  for (const draggable of document.querySelectorAll("#top .icon")) {
    draggable.setAttribute("draggable", "true")
  }
}
