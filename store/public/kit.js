// The /kit pages: draw the guides' diagrams with the local copy of mermaid (served from this origin,
// strict security level: no HTML or scripts from a diagram's text), in the reader's colour scheme.
(function () {
  "use strict";
  if (!window.mermaid) return;
  var diagrams = Array.from(document.querySelectorAll("pre.mermaid"), function (el) { return { el: el, source: el.textContent }; });
  var rendering = false, pending = false;
  async function render() {
    if (rendering) { pending = true; return; }
    rendering = true;
    var dark = document.documentElement.dataset.theme === "dark";
    diagrams.forEach(function (d) { d.el.textContent = d.source; d.el.removeAttribute("data-processed"); });
    window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral",
                              fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, Noto Sans, sans-serif",
                              flowchart: { htmlLabels: false, useMaxWidth: false }, sequence: { mirrorActors: false, useMaxWidth: false },
                              state: { useMaxWidth: false } });
    try { await window.mermaid.run({ querySelector: "pre.mermaid" }); }
    catch (_) { diagrams.forEach(function (d) { d.el.textContent = d.source; }); }
    finally { rendering = false; if (pending) { pending = false; render(); } }
  }
  window.addEventListener("esim-theme-change", render);
  render();
})();
