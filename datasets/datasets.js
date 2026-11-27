// Search and filters of the datasets page. The entries are plain HTML; without this file the page is still a readable list.
(function () {
  const all = [...document.querySelectorAll("article.ds")];
  const text = new Map(all.map(a => [a, a.textContent.toLowerCase()]));
  const chips = [...document.querySelectorAll(".chip")];
  let fit = "";
  function show() {
    const words = $("q").value.toLowerCase().split(/\s+/).filter(Boolean), people = $("people").checked;
    let n = 0;
    for (const a of all) {
      const ok = (!fit || a.dataset.fit === fit) && (!people || a.dataset.people === "1") && words.every(w => text.get(a).includes(w));
      a.hidden = !ok; if (ok) n++;
    }
    const filtered = Boolean(fit || people || words.length);
    for (const s of document.querySelectorAll("section.theme")) {
      const left = s.querySelectorAll("article.ds:not([hidden])").length;
      s.hidden = filtered && !left;
      const badge = s.querySelector(".sec-head .n"); if (badge) badge.textContent = left;
    }
    for (const id of ["how", "start", "checked"]) $(id).hidden = filtered;      // the reading notes step aside while you search
    $("none").hidden = n > 0;
    $("count").textContent = filtered ? `${n} of ${all.length} datasets` : `${all.length} datasets`;
  }
  for (const c of chips) c.onclick = () => {
    fit = c.dataset.fit;
    for (const x of chips) { x.classList.toggle("on", x === c); x.setAttribute("aria-pressed", x === c); }
    show();
  };
  $("q").oninput = show; $("people").onchange = show;
  // a link to a hidden entry or theme (from "Start here" or the theme list) clears the filters first
  addEventListener("click", e => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    const to = document.getElementById(a.getAttribute("href").slice(1));
    if (to && (to.hidden || to.closest("[hidden]"))) { $("q").value = ""; $("people").checked = false; chips[0].click(); }
  });
  show();
})();
