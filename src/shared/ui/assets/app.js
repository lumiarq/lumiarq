;(function () {
  "use strict"

  // ── Keyboard shortcut: Cmd+K / Ctrl+K → open search modal ────────────────
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault()
      var body = document.body
      if (body._x_dataStack) {
        var alpine = body._x_dataStack[0]
        if (alpine && typeof alpine.searchOpen !== "undefined") {
          alpine.searchOpen = true
          return
        }
      }
      var overlay = document.querySelector(".search-modal-overlay")
      if (overlay) overlay.style.display = ""
      var input = document.getElementById("search-input")
      if (input) input.focus()
    }
  })
})()
