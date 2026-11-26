// Top bar and footer of every page. A page has <header class="top" data-root="../" data-page="ideas"></header>
// and <footer class="foot"></footer>; this file fills them in. data-root is the path back to the landing page.

// Line icons used across the pages: icon("map") gives an <svg class="ic">.
const ICONS = {
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1.3 1.6 1.5 2.5h5c.2-.9.7-1.7 1.5-2.5A6 6 0 0 0 12 3z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.2a5 5 0 0 1 4.5 5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  notebook: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 8h4M3 12h4M3 16h4"/><path d="M12.5 8h4M12.5 12h4"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/>',
  pen: '<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14.5 6l3 3"/>',
  code: '<path d="M8.5 7l-5 5 5 5"/><path d="M15.5 7l5 5-5 5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M16 7l3 3"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  map: '<path d="M9 4L3 6.5v13.5L9 17.5l6 2.5 6-2.5V4L15 6.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  alert: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M4.5 20h15"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.5 4L20 15"/><path d="M20 20v-5h-5"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  up: '<path d="M12 19V6"/><path d="M6 12l6-6 6 6"/>',
  back: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
  out: '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  satellite: '<path d="M13.5 6.5l4 4-3 3-4-4z"/><path d="M6 9l3-3 2.5 2.5-3 3zM13 16l3-3 2.5 2.5-3 3z" transform="translate(-1 -1)"/><path d="M4 16a4 4 0 0 0 4 4"/><path d="M4 12.5A7.5 7.5 0 0 0 11.500 20"/>',
};
function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ic"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name] || "";
  return s;
}

(function () {
  const PAGES = [
    ["ideas", "ideas/", "Ideas board"],
    ["projects", "projects/", "Project board"],
    ["sr", "sr/", "Make an image"],
    ["exercises", "exercises/", "Exercises"],
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
    home.setAttribute("aria-label", "Super-resolution workshop, start page");
    const mark = document.createElement("span"); mark.className = "mark"; mark.append(icon("layers"));
    const name = document.createElement("span"); name.className = "name"; name.textContent = "Super-resolution workshop";
    home.append(mark, name);
    const nav = document.createElement("nav"); nav.setAttribute("aria-label", "Pages");
    for (const [id, path, label] of PAGES) {
      const a = document.createElement("a"); a.href = href(path); a.textContent = label;
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
  // <i data-icon="map"></i> in a page becomes the icon
  for (const i of document.querySelectorAll("[data-icon]")) i.replaceWith(icon(i.dataset.icon));
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
