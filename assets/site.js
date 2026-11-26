// Top bar and footer of every page. A page has <header class="top" data-root="../" data-page="ideas"></header>
// and <footer class="foot"></footer>; this file fills them in. data-root is the path back to the landing page.
(function () {
  const PAGES = [
    ["ideas", "ideas/", "Ideas board"],
    ["projects", "projects/", "Project board"],
    ["sr", "sr/", "Make an image"],
    ["exercises", "exercises/", "Exercises"],
    ["faq", "#faq", "Questions"],
    ["office", "#office-hours", "Office hours"],
  ];
  const top = document.querySelector("header.top");
  if (top) {
    const root = top.dataset.root || "", here = top.dataset.page || "";
    const q = location.search.match(/[?&]s=[\w-]+/);      // keep a rehearsal session across pages
    const s = q ? "?" + q[0].slice(1) : "";
    const href = p => p.startsWith("#") ? root + (root ? "" : "./") + s + p : root + p + s;
    const inner = document.createElement("div"); inner.className = "in";
    const home = document.createElement("a"); home.className = "home"; home.href = (root || "./") + s;
    home.textContent = "Super-resolution workshop";
    const nav = document.createElement("nav"); nav.setAttribute("aria-label", "Pages");
    for (const [id, path, name] of PAGES) {
      const a = document.createElement("a"); a.href = href(path); a.textContent = name;
      if (id === here) a.setAttribute("aria-current", "page");
      nav.append(a);
    }
    inner.append(home, nav); top.append(inner);
  }
  const foot = document.querySelector("footer.foot");
  if (foot) {
    const d = document.createElement("div"); d.className = "in";
    d.textContent = "Super-Resolution Satellite Imagery as a Regional Public Good for Sustainable Development · TA workshop, 26–27 November 2026, ADB headquarters. Super-resolved images contain modified Copernicus Sentinel data.";
    foot.append(d);
  }
})();

// Small helpers shared by the pages.
const $ = id => document.getElementById(id);
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k in e && k !== "list") e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) e.append(kid);
  return e;
}
function remember(key, value) {
  try { if (value === undefined) return localStorage.getItem(key) || ""; localStorage.setItem(key, value); } catch (e) {}
  return value || "";
}
function forget(key) { try { localStorage.removeItem(key); } catch (e) {} }
function safeUrl(u) { try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; } }
