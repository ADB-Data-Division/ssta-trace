// Super-resolution service page: a page in front of the service (config.js: SR_SERVICE).
// It does what the Python client does: sign up by email, estimate, submit, follow the job, show and link the
// files. The page keeps the key in this browser only. Needs config.js, site.js, areas.js and Leaflet.
//
// Where the pictures come from:
//   stage 1 and stage 2   the service's preview PNGs (plain <img>, always works)
//   Sentinel-2 inputs     read by this page from the public Sentinel-2 archive on AWS (the same files the service uses)
//   validity mask, the exact list of images used, lr_reference.tif
//                         the service's own files; the page can only read them if the file store (Backblaze B2
//                         bucket) allows this site (CORS rule, see README). It notices by itself.

// For tests, ?api=http://localhost:PORT points the page at a stand-in service. Only local addresses are
// accepted, so a link can never send somebody's key to another server.
const API = (() => {
  const o = new URLSearchParams(location.search).get("api");
  return o && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : SR_SERVICE.replace(/\/+$/, "");
})();
const COGS = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs";      // public Sentinel-2 L2A archive (Element 84 Earth Search)
const ACTIVE = ["queued", "running"];
const STATUS = { queued: "Waiting in line", running: "Running", done: "Ready", partial: "Ready, with gaps", failed: "Failed", cancelled: "Cancelled" };
const STEP = { acquire: "Sentinel-2 images", stage1: "Stage 1", stitch1: "Stage 1 image", stage2: "Stage 2", stitch2: "Stage 2 image" };
const LAYER = { s2: "Sentinel-2 (10 m)", "1": "Stage 1 (2.5 m)", "2": "Stage 2 (2.5 m)" };
const FILES = [   // name, what it is
  ["stage2_sr.tif", "Stage 2 image"], ["stage1_sr.tif", "Stage 1 image"], ["lr_reference.tif", "Sentinel-2 input, 10 m"],
  ["bands20_sr.tif", "Red-edge and short-wave infrared bands at 2.5 m"], ["lr20_reference.tif", "Sentinel-2 20 m bands, as delivered"],
  ["validity.tif", "0 no data · 1 valid · 2 few clear images"], ["manifest.json", "Images used, settings, cost, warnings"],
];
const DEFAULTS = { oBefore: 45, oAfter: 45, oCloud: 40, oClear: 70, oRevisits: 1, oTau: 250, oNfe: "", oSeed: 0 };
const WARN = {      // the service's warning codes in the words of the workshop
  water: ["Much of the area is water", "Super-resolution removes detail in shallow water. Use the Sentinel-2 image there.", v => `${pct(v)} of the area is water`],
  low_diversity: ["Few clear Sentinel-2 images", "For part of the area the service found fewer than 4 different clear images, so the result can be less sharp there. A longer search period or a higher cloud limit helps.", v => `${pct(v)} of the area`],
  nodata: ["Part of the area is empty", "No clear Sentinel-2 image covers it. Try a longer search period, a higher cloud limit or a lower clear share.", v => `${pct(v)} of the area`],
  haze: ["Hazy Sentinel-2 images", "Colours may look washed out. Try another date.", v => `${pct(v)} of the tiles start from a hazy image`],
  missing_tiles: ["Part of the area could not be processed", "That part is empty in the image. Make the image again.", v => `${v} tile${v === 1 ? "" : "s"}`],
};

let key = remember("sr-key"), me = null, map = null, rect = null, sel = { ready: null, lat: 14.5878, lon: 121.0585, km: 2 };
let view = "", current = null, pollTimer = null, estTimer = null, estSeq = 0, jobsTimer = null;

// ---------------------------------------------------------------- talking to the service
function detailOf(data, status) {
  const d = data && data.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map(x => `${(x.loc || []).slice(1).join(".")}: ${x.msg}`).join("; ");
  return `The service answered with error ${status}.`;
}
async function api(method, path, body) {
  let r;
  try {
    r = await fetch(API + path, { method, headers: { ...(key ? { Authorization: "Bearer " + key } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    const err = new Error("The image service could not be reached. Check your connection; some office networks block the service, so try another network.");
    err.status = 0; throw err;
  }
  let data = null; try { data = await r.json(); } catch (e) {}
  if (!r.ok) {
    const err = new Error(detailOf(data, r.status)); err.status = r.status;
    if (r.status === 401 && key) { leave("The key does not work (" + err.message + "). Connect again with your email address, or ask the workshop team."); }
    throw err;
  }
  return data;
}
const usd = v => "USD " + (v > 0 && v < 0.095 ? v.toFixed(3) : v.toFixed(2));
const pct = v => { const p = v * 100; return p > 0 && p < 0.05 ? "under 0.1 %" : (p > 0 && p < 0.95 ? p.toFixed(1) : String(Math.round(p))) + " %"; };
const niceDate = d => { const x = new Date(String(d).slice(0, 10) + "T00:00:00"); return isNaN(x) ? String(d) : x.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); };
const shortDate = d => { const x = new Date(String(d).slice(0, 10) + "T00:00:00"); return isNaN(x) ? String(d) : x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const niceTime = t => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function box(cls, ...kids) { return el("div", { class: cls }, ...kids); }
async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const t = el("textarea", { value: text, style: "position:fixed;opacity:0" }); document.body.append(t); t.select(); try { document.execCommand("copy"); } catch (e2) {} t.remove(); }
  if (button) { const old = [...button.childNodes]; button.textContent = "Copied"; setTimeout(() => { button.replaceChildren(...old); }, 1400); }
}

// ---------------------------------------------------------------- connecting, and which part of the page shows
function leave(message) {
  key = ""; me = null; forget("sr-key"); clearTimeout(pollTimer); clearTimeout(estTimer); clearTimeout(jobsTimer); current = null;
  $("app").hidden = $("tabs").hidden = $("acct").hidden = true; $("signin").hidden = false;
  $("cErr").hidden = !message; $("cErr").textContent = message || "";
}
async function enter() {
  me = await api("GET", "/v1/me");
  remember("sr-key", key);
  $("signin").hidden = true; $("app").hidden = $("tabs").hidden = $("acct").hidden = false;
  showAccount();
  const max = Math.max(0.5, Math.floor((me.limits.max_area_km || 5) * 2) / 2);
  $("pKm").max = String(max); if (sel.km > max) sel.km = max;
  route(); listJobs();
}
function showAccount() {
  const b = me.budget, has = b.remaining_usd !== null && b.remaining_usd !== undefined && b.budget_usd;
  $("aLeft").textContent = has ? `${usd(Math.max(b.remaining_usd, 0))} left` : "No budget limit";
  $("aOf").textContent = has ? `of ${usd(b.budget_usd)}` : "";
  const share = has ? Math.max(0, Math.min(1, b.remaining_usd / b.budget_usd)) : 1;
  $("aMeter").style.width = share * 100 + "%"; $("aMeter").className = share < 0.2 ? "low" : "";
  $("aAvatar").textContent = (me.owner || "?").slice(0, 1);
  $("aMail").textContent = me.owner || "";
  $("aLimits").textContent = `Areas up to ${me.limits.max_area_km} km per side · ${me.limits.max_running === 1 ? "one image" : me.limits.max_running + " images"} at a time`;
  $("aExpires").textContent = me.expires_at ? `Key valid until ${new Date(me.expires_at).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })} (your time)` : "";
}
async function refreshMe() { try { me = await api("GET", "/v1/me"); showAccount(); } catch (e) {} }
$("cForm").addEventListener("submit", async e => {
  e.preventDefault();
  const v = $("cEmail").value.trim(); if (!v) return;
  $("cErr").hidden = true; $("cGo").disabled = true; $("cGo").textContent = "Connecting…";
  try {
    if (v.startsWith("srk_")) key = v;
    else { key = ""; key = (await api("POST", "/v1/signup", { email: v })).key; }
    await enter();
  } catch (err) {
    if (!$("cErr").textContent || $("cErr").hidden) { $("cErr").textContent = err.message; }
    $("cErr").hidden = false; key = "";
  } finally { $("cGo").disabled = false; $("cGo").textContent = "Connect"; }
});
$("cLeave").onclick = () => { $("aMenu").open = false; if (confirm("Disconnect this browser? Your images stay with your email address: connect again to see them.")) { leave(""); history.replaceState(null, "", location.pathname + location.search); } };
$("cCopy").onclick = e => copyText(key, e.currentTarget);
document.addEventListener("click", e => { if ($("aMenu").open && !$("aMenu").contains(e.target)) $("aMenu").open = false; });

const go = hash => { if (location.hash === "#" + hash) route(); else location.hash = hash; };
function route() {
  if (!me) return;
  const m = location.hash.match(/job=([0-9a-f-]{36})/), v = m ? "job" : location.hash === "#jobs" ? "jobs" : "new";
  view = v;
  $("vNew").hidden = v !== "new"; $("vJobs").hidden = v !== "jobs"; $("vJob").hidden = v !== "job";
  $("tNew").toggleAttribute("aria-current", v === "new"); if (v === "new") $("tNew").setAttribute("aria-current", "page");
  $("tJobs").toggleAttribute("aria-current", v !== "new"); if (v !== "new") $("tJobs").setAttribute("aria-current", "page");
  clearTimeout(pollTimer); clearTimeout(jobsTimer);
  if (v === "job") { if (!current || current.id !== m[1]) openJob(m[1]); else { poll(current.id); requestAnimationFrame(() => { if (Math.abs(V.k - V.fitK) < 1e-6) vFit(); else vApply(); }); } }
  if (v === "jobs") listJobs();
  if (v === "new") { startMap(); syncPlace(); if (!$("est").childElementCount) changed(); }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- 1 area
function areaAround(lat, lon, km) {      // the same box as sr_client.area_around
  const dlat = km / 2 / 111.32, dlon = km / 2 / (111.32 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
  return [lon - dlon, lat - dlat, lon + dlon, lat + dlat].map(v => Math.round(v * 1e6) / 1e6);
}
function bbox() { return sel.ready && sel.ready.km === sel.km ? sel.ready.bbox : areaAround(sel.lat, sel.lon, sel.km); }
function placeName() { return sel.ready ? sel.ready.name : `${sel.lat.toFixed(4)}, ${sel.lon.toFixed(4)}`; }
const readyOf = area => Array.isArray(area) ? READY.find(a => a.bbox.every((v, i) => Math.abs(v - area[i]) < 2e-6)) : null;
(function fillPlaces() {
  const s = $("pReady");
  s.append(el("option", { value: "own", text: "My own place…" }));
  for (const [set, title] of [["demo", "Places of the practical demonstrations"], ["hackathon", "Areas of the mini hackathon"]]) {
    const g = el("optgroup", { label: title });
    READY.forEach((a, i) => { if (a.set === set) g.append(el("option", { value: String(i), text: `${a.name} (${a.km} km)` })); });
    s.append(g);
  }
  s.value = "0"; sel = { ready: READY[0], lat: READY[0].lat, lon: READY[0].lon, km: READY[0].km };
  $("dDate").value = READY[0].date; $("dDate").max = new Date().toISOString().slice(0, 10);
})();
function startMap() {
  if (map || !window.L) return;
  map = L.map("map", { scrollWheelZoom: true }).setView([sel.lat, sel.lon], 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
  rect = L.rectangle([[0, 0], [0, 0]], { color: "#007db7", weight: 2.5, fillOpacity: 0.12, interactive: false }).addTo(map);
  map.on("click", e => { setOwn(e.latlng.lat, e.latlng.lng, false); });
}
function syncPlace(fit = true) {
  const b = bbox();
  $("own").hidden = !!sel.ready;
  $("pNote").textContent = sel.ready ? `${sel.ready.note}. A ready-made area: with the standard settings the image is usually there at once and costs nothing.`
    : "Your own place: the service makes a new image, which takes a few minutes and uses your budget.";
  $("pLat").value = sel.lat; $("pLon").value = sel.lon; $("pKm").value = sel.km;
  $("pKmText").textContent = `${sel.km} km × ${sel.km} km`;
  if (map) { map.invalidateSize(); rect.setBounds([[b[1], b[0]], [b[3], b[2]]]); if (fit) map.fitBounds(rect.getBounds(), { padding: [30, 30], maxZoom: 16 }); }
}
function setOwn(lat, lon, fit) {
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return;
  sel = { ready: null, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, km: sel.km };
  $("pReady").value = "own"; syncPlace(fit); changed();
}
$("pReady").onchange = () => {
  const v = $("pReady").value;
  if (v === "own") sel = { ready: null, lat: sel.lat, lon: sel.lon, km: sel.km };
  else { const a = READY[Number(v)]; sel = { ready: a, lat: a.lat, lon: a.lon, km: a.km }; $("dDate").value = a.date; }
  syncPlace(); changed();
};
$("pKm").oninput = () => { sel.km = Number($("pKm").value); syncPlace(); changed(); };
$("pLat").onchange = $("pLon").onchange = () => setOwn(Number($("pLat").value), Number($("pLon").value), true);
async function findPlace() {
  const q = $("pSearch").value.trim(), hits = $("pHits"); if (!q) return;
  const c = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (c) { hits.replaceChildren(); setOwn(Number(c[1]), Number(c[2]), true); return; }
  hits.replaceChildren(el("span", { class: "small", text: "Searching…" }));
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=" + encodeURIComponent(q), { headers: { Accept: "application/json" } });
    const found = await r.json();
    if (!found.length) { hits.replaceChildren(el("span", { class: "small", text: "Nothing found. Try another name, or click on the map." })); return; }
    hits.replaceChildren(...found.map(f => el("button", { type: "button", text: f.display_name, onclick: () => { hits.replaceChildren(); setOwn(Number(f.lat), Number(f.lon), true); } })));
  } catch (e) { hits.replaceChildren(el("span", { class: "small", text: "The place search is not available here. Click on the map or type coordinates." })); }
}
$("pFind").onclick = findPlace;
$("pSearch").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); findPlace(); } });

// ---------------------------------------------------------------- 3 processing, and the request
const radio = name => document.querySelector(`input[name="${name}"]:checked`);
function syncStrength() {
  $("strengthBox").hidden = radio("stages").value === "1";
  const tau = $("oTau").value.trim();
  for (const r of document.querySelectorAll('input[name="strength"]')) r.checked = r.value === tau;
}
for (const r of document.querySelectorAll('input[name="stages"]')) r.onchange = () => { syncStrength(); changed(); };
for (const r of document.querySelectorAll('input[name="strength"]')) r.onchange = () => { $("oTau").value = r.value; changed(); };
$("oTau").oninput = syncStrength;
$("oReset").onclick = () => { for (const [id, v] of Object.entries(DEFAULTS)) $(id).value = v; $("oBands").checked = $("oCache").checked = true; syncStrength(); changed(); };
for (const id of [...Object.keys(DEFAULTS), "oBands", "oCache", "dDate"]) $(id).addEventListener("change", changed);

function request(point) {      // the request as the service wants it; point = true moves the cursor to a wrong field
  const whole = (id, lo, hi, name) => {
    const raw = $(id).value.trim(), v = Number(raw);
    if (raw === "" || !Number.isInteger(v) || v < lo || v > hi) { if (point) { $("more").open = true; $(id).focus(); } throw new Error(`${name} must be a whole number from ${lo} to ${hi}.`); }
    return v;
  };
  const date = $("dDate").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { if (point) $("dDate").focus(); throw new Error("Choose a date."); }
  if (!isFinite(sel.lat) || !isFinite(sel.lon)) throw new Error("Choose a place.");
  const both = radio("stages").value === "12", tau = whole("oTau", 10, 1000, "The noise level (tau)");
  const body = {
    area: bbox(), target_date: date, stages: both ? ["1", "2"] : ["1"],
    time_window: { days_before: whole("oBefore", 0, 365, "Search before the date"), days_after: whole("oAfter", 0, 365, "Search after the date") },
    max_cloud: whole("oCloud", 1, 100, "The cloud limit"), min_clear: whole("oClear", 0, 100, "The clear share") / 100,
    n_revisits: whole("oRevisits", 1, 8, "Different images needed"), tau, seed: whole("oSeed", 0, 2147483647, "The seed"),
    bands20: $("oBands").checked, cache: $("oCache").checked,
  };
  if ($("oNfe").value.trim() !== "") body.nfe = whole("oNfe", 10, tau, "The number of steps (nfe)");
  return body;
}
const strengthName = tau => ({ 100: "light", 250: "standard", 500: "strong" })[tau];
function processingOf(p) {
  if (p.stages.length < 2) return "Stage 1 only";
  const s = strengthName(p.tau);
  return `Stage 1 and 2 · ${s ? s : "tau " + p.tau}${p.nfe && p.nfe !== p.tau ? `, ${p.nfe} steps` : ""}${p.seed ? `, seed ${p.seed}` : ""}`;
}
function minutes(tiles, body) {
  const s = 75 + (body.stages.length > 1 ? 45 + tiles * (body.nfe || body.tau) * 0.00263 : 0);
  return Math.max(1, Math.round(s / 60));
}
const kv = rows => rows.filter(Boolean).flatMap(([k, v]) => [el("dt", { text: k }), el("dd", null, v)]);
function changed() {      // something in the form changed: show it, and ask the service (after a short pause) what it would take
  if (!me) return;
  let body = null, problem = "";
  try { body = request(false); } catch (e) { problem = e.message; }
  const custom = body && (body.time_window.days_before !== 45 || body.time_window.days_after !== 45 || body.max_cloud !== 40 || body.min_clear !== 0.7 || body.n_revisits !== 1 || !body.bands20 || !body.cache);
  $("sumKv").replaceChildren(...kv([["Place", placeName()], ["Area", `${sel.km} km × ${sel.km} km`], ["Date", /^\d{4}-/.test($("dDate").value) ? niceDate($("dDate").value) : "–"],
    ["Processing", body ? processingOf(body) : "–"], custom ? ["Advanced options", "changed"] : null]));
  clearTimeout(estTimer); estSeq += 1; $("make").disabled = false;
  if (problem) { $("est").replaceChildren(box("bad-box", problem)); return; }
  $("est").replaceChildren(el("div", { class: "quote wait" }, el("span", { class: "spinner" }), el("span", { class: "txt" }, "Checking price and Sentinel-2 images…")));
  estTimer = setTimeout(estimate, 900);
}
async function estimate() {
  if (!me || view !== "new") return;
  const seq = estSeq; let body, e;
  try { body = request(false); e = await api("POST", "/v1/estimate", body); }
  catch (err) { if (seq === estSeq && key) $("est").replaceChildren(box("bad-box", err.message)); return; }
  if (seq !== estSeq) return;
  const out = [];
  if (e.problems && e.problems.length) out.push(box("bad-box", el("b", { text: "This cannot run as it is. " }), e.problems.join(" ")));
  if (e.cached) out.push(el("div", { class: "quote" }, el("span", { class: "big", text: "Free" }), el("span", { class: "txt" }, el("b", { text: "Ready at once" }), "This image was already made with these settings.")));
  else if (e.submittable) {
    const mins = minutes(e.tiles, body), left = me.budget.remaining_usd !== null && me.budget.remaining_usd !== undefined ? ` You have ${usd(me.budget.remaining_usd)} left.` : "";
    out.push(el("div", { class: "quote cost" }, el("span", { class: "big", text: usd(e.estimated_usd) }),
      el("span", { class: "txt" }, el("b", { text: `About ${mins} minute${mins === 1 ? "" : "s"}` }), `At most this much of your budget.${left} Longer when many people make images at once.`)));
  }
  for (const w of e.warnings_likely || []) out.push(box("warn-box", (WARN[w.code] ? WARN[w.code][0] + ". " + WARN[w.code][1] : w.message)));
  if (e.scenes && e.scenes.length) out.push(timeline(e.scenes, e.search_window, body.target_date));
  else if (!(e.problems && e.problems.length)) out.push(box("warn-box", "No Sentinel-2 image under the cloud limit was found around this date. Try another date, a longer search period or a higher cloud limit (advanced options)."));
  $("est").replaceChildren(...out);
  $("make").disabled = !(e.cached || e.submittable);
}
function timeline(scenes, win, target) {      // the Sentinel-2 images the service found, as dots along the search period
  const t0 = Date.parse(win[0]), t1 = Date.parse(win[1]), x = d => Math.max(0, Math.min(100, (Date.parse(d) - t0) / Math.max(t1 - t0, 1) * 100));
  const days = new Set(scenes.map(s => s.date)).size;
  return el("div", { class: "timeline" },
    el("div", { class: "cap" }, el("b", { text: `${scenes.length} Sentinel-2 image${scenes.length === 1 ? "" : "s"} on ${days} day${days === 1 ? "" : "s"}`, style: "color:var(--ink)" }), el("span", { text: "darker = fewer clouds" })),
    el("div", { class: "tl" }, el("i", { class: "target", style: `left:${x(target)}%`, title: "Your date: " + niceDate(target) }),
      scenes.map(s => { const c = s.cloud_cover === null || s.cloud_cover === undefined ? 50 : s.cloud_cover;
        return el("i", { class: "dot", style: `left:${x(s.date)}%;opacity:${(1 - Math.min(c, 60) / 75).toFixed(2)}`, title: `${niceDate(s.date)} · ${Math.round(c)} % cloud` }); })),
    el("div", { class: "cap" }, el("span", { text: shortDate(win[0]) }), el("span", { text: shortDate(win[1]) })));
}
$("make").onclick = async () => {
  let body;
  try { body = request(true); } catch (e) { $("est").replaceChildren(box("bad-box", e.message)); return; }
  const btn = $("make"), old = [...btn.childNodes]; btn.disabled = true; btn.textContent = "Sending…";
  try {
    const name = placeName(), got = await api("POST", "/v1/jobs", body);
    const labels = JSON.parse(remember("sr-labels") || "{}"); labels[got.job_id] = name;
    remember("sr-labels", JSON.stringify(Object.fromEntries(Object.entries(labels).slice(-60))));
    $("est").replaceChildren(); refreshMe(); listJobs();
    go("job=" + got.job_id);
  } catch (e) { if (key) $("est").replaceChildren(box("bad-box", e.message)); }
  finally { btn.disabled = false; btn.replaceChildren(...old); }
};

// ---------------------------------------------------------------- one image: status
const labelOf = id => { try { return JSON.parse(remember("sr-labels") || "{}")[id] || ""; } catch (e) { return ""; } };
function sizeOf(area) {
  const h = (area[3] - area[1]) * 111.32, w = (area[2] - area[0]) * 111.32 * Math.cos((area[1] + area[3]) / 2 * Math.PI / 180);
  return { w, h, lat: (area[1] + area[3]) / 2, lon: (area[0] + area[2]) / 2 };
}
function summaryOf(p) {
  const parts = [];
  if (Array.isArray(p.area) && p.area.length === 4) { const s = sizeOf(p.area); parts.push(`${s.w.toFixed(1)} km × ${s.h.toFixed(1)} km at ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`); }
  parts.push(niceDate(p.target_date), processingOf(p));
  return parts.join(" · ");
}
async function openJob(id) {
  clearTimeout(pollTimer);
  current = { id, info: null, files: null, aux: null, shown: -1, touched: false };
  vReset();
  $("jBody").hidden = true; $("files").hidden = true; $("dPanel").hidden = true;
  $("jTitle").textContent = labelOf(id) || "Your image"; $("jSummary").textContent = ""; $("jSteps").replaceChildren(); $("jMsg").replaceChildren();
  $("jStatus").textContent = "Loading…"; $("jStatus").className = "chip"; $("jCancel").hidden = $("jUpgrade").hidden = true; $("jAgain").hidden = true; $("jCredit").textContent = "";
  await poll(id);
}
async function poll(id) {
  clearTimeout(pollTimer);
  if (!current || current.id !== id || view !== "job") return;
  const job = current;
  let info;
  try { info = await api("GET", `/v1/jobs/${id}`); }
  catch (e) {
    if (current !== job) return;
    if (e.status === 404) { $("jStatus").textContent = "Not found"; $("jMsg").replaceChildren(box("bad-box", "This image does not belong to the connected email address, or it no longer exists.")); return; }
    $("jMsg").replaceChildren(box("warn-box", e.message + " Trying again…")); pollTimer = setTimeout(() => poll(id), 8000); return;
  }
  if (current !== job) return;
  const was = job.info; job.info = info;
  showJob(info);
  const stitched = info.progress.filter(p => p.step.startsWith("stitch") && p.state === "done").length;
  if (info.results_ready && stitched !== job.shown) { if (await showResults(job, info)) job.shown = stitched; }
  if (current !== job || view !== "job") return;
  if (ACTIVE.includes(info.status)) pollTimer = setTimeout(() => poll(id), 4000);
  else if (was && ACTIVE.includes(was.status)) { refreshMe(); listJobs(); }
}
function showJob(info) {
  const ready = readyOf(info.params.area);
  $("jTitle").textContent = labelOf(info.id) || (ready ? ready.name : "Image of " + niceDate(info.params.target_date));
  $("jSummary").textContent = summaryOf(info.params);
  $("jStatus").textContent = STATUS[info.status] || info.status; $("jStatus").className = "chip " + info.status;
  $("jCancel").hidden = !ACTIVE.includes(info.status); $("jAgain").hidden = false;
  $("jUpgrade").hidden = !(info.status === "done" && info.params.stages.length === 1);
  $("jSteps").replaceChildren(...info.progress.map(p => {
    const many = p.total > 1, share = p.total ? p.done / p.total : 0;
    const bar = el("i", { class: p.state === "running" && !many ? "unknown" : "" }); if (many && p.state !== "done") bar.style.width = `${Math.round(share * 100)}%`;
    return el("div", { class: "step " + p.state }, el("b", null, p.state === "done" ? icon("check") : null, STEP[p.step] || p.step), el("div", { class: "track" }, bar),
      el("span", { text: p.state === "waiting" ? "Waiting" : p.state === "done" ? "Done" : many ? `${p.done} of ${p.total} parts` : p.state === "running" ? "Running…" : p.state }));
  }));
  $("jSteps").hidden = !ACTIVE.includes(info.status) && info.status !== "failed" && info.status !== "partial";
  const msg = [];
  if (info.status === "queued") msg.push(box("note-box", "Your image is waiting in line. One image per person runs at a time. You can leave this page or come back later: it is listed under “My images”."));
  if (info.status === "running") msg.push(box("note-box", "The service is working. Stage 1 appears first; stage 2 follows a few minutes later."));
  if (info.status === "failed") msg.push(box("bad-box", el("b", { text: "The image could not be made. " }), info.error || ""));
  if (info.status === "cancelled") msg.push(box("warn-box", "This image was cancelled."));
  if (info.status === "partial") msg.push(box("warn-box", "Parts of the area could not be processed. The rest is shown below."));
  $("jMsg").replaceChildren(...msg);
  showQuality(); showDetails(info);
}
$("jCancel").onclick = async () => {
  if (!current || !confirm("Cancel this image?")) return;
  try { await api("DELETE", `/v1/jobs/${current.id}`); poll(current.id); } catch (e) { $("jMsg").prepend(box("bad-box", e.message)); }
};
$("jUpgrade").onclick = async e => {
  if (!current) return;
  const b = e.currentTarget; b.disabled = true;
  try { await api("POST", `/v1/jobs/${current.id}/upgrade`); current.shown = -1; await poll(current.id); refreshMe(); }
  catch (err) { $("jMsg").prepend(box("bad-box", err.message)); }
  finally { b.disabled = false; }
};
$("jAgain").onclick = () => {      // fill the form with this image's settings
  const p = current && current.info && current.info.params; if (!p) return;
  const ready = readyOf(p.area), s = sizeOf(p.area), max = Number($("pKm").max) || 5;
  if (ready) { sel = { ready, lat: ready.lat, lon: ready.lon, km: ready.km }; $("pReady").value = String(READY.indexOf(ready)); }
  else { sel = { ready: null, lat: Math.round(s.lat * 1e5) / 1e5, lon: Math.round(s.lon * 1e5) / 1e5, km: Math.min(max, Math.max(0.5, Math.round(s.h * 2) / 2)) }; $("pReady").value = "own"; }
  $("dDate").value = p.target_date;
  for (const r of document.querySelectorAll('input[name="stages"]')) r.checked = r.value === (p.stages.length > 1 ? "12" : "1");
  $("oBefore").value = p.time_window.days_before; $("oAfter").value = p.time_window.days_after; $("oCloud").value = Math.round(p.max_cloud); $("oClear").value = Math.round(p.min_clear * 100);
  $("oRevisits").value = p.n_revisits; $("oTau").value = p.tau; $("oNfe").value = p.nfe && p.nfe !== p.tau ? p.nfe : ""; $("oSeed").value = p.seed || 0;
  $("oBands").checked = p.bands20 !== false; $("oCache").checked = true;
  syncStrength(); $("est").replaceChildren(); go("new");
};
function showDetails(info) {
  const p = info.params, a = current && current.aux, m = a && a.manifest, cost = info.cost || {};
  const rows = [["Image ID", info.id], ["Made", niceTime(info.created_at)], info.finished_at && !ACTIVE.includes(info.status) ? ["Finished", niceTime(info.finished_at)] : null,
    ["Model", (m && m.model && m.model.model) || p.model || info.model || "–"],
    ["Area (west, south, east, north)", (p.area || []).join(", ")], ["Target date", niceDate(p.target_date)],
    ["Search period", `${p.time_window.days_before} days before, ${p.time_window.days_after} days after`], ["Cloud limit", `${Math.round(p.max_cloud)} %`], ["Clear share per tile", `${Math.round(p.min_clear * 100)} %`],
    ["Different images needed", String(p.n_revisits)], ["Stages", p.stages.length > 1 ? "1 and 2" : "1"],
    p.stages.length > 1 ? ["Stage 2 noise level (tau) / steps (nfe)", `${p.tau} / ${p.nfe || p.tau}`] : null, p.stages.length > 1 ? ["Seed", String(p.seed || 0)] : null,
    ["Red-edge and short-wave infrared bands", p.bands20 === false ? "no" : "yes"],
    m && m.grid ? ["Grid", `${m.grid.crs}, ${m.grid.width * 4} × ${m.grid.height * 4} pixels of ${m.sr_pixel_m} m`] : null,
    ["Cost", info.cached_from ? "free (made before with the same settings)" : cost.actual_usd !== null && cost.actual_usd !== undefined && !ACTIVE.includes(info.status) ? usd(cost.actual_usd) : cost.estimated_usd !== undefined ? `up to ${usd(cost.estimated_usd)}` : "–"]];
  $("dKv").replaceChildren(...rows.filter(Boolean).map(([k, v]) => el("div", null, el("dt", { text: k }), el("dd", { text: v }))));
  $("dPanel").hidden = false;
}

// ---------------------------------------------------------------- one image: the viewer
// A stack of pictures of the same area in one frame ("world", in pixels of the 2.5 m image) that can be moved and
// zoomed. In "compare" the left picture lies over the right one and is cut at the dividing line.
const viewer = $("viewer"), vWorld = $("vWorld");
const V = { k: 1, x: 0, y: 0, w: 0, h: 0, fitK: 1, split: 0.5, mode: "compare", mask: false, sized: "" };
let layerEls = {};
function vReset() {
  layerEls = {}; Object.assign(V, { w: 0, h: 0, k: 1, x: 0, y: 0, split: 0.5, mask: false, sized: "" });
  $("vLeft").replaceChildren(); $("vRight").replaceChildren(); $("vMask").hidden = true; $("vLegend").hidden = true; $("vLoad").hidden = true;
  $("vMaskBtn").disabled = true; $("vMaskBtn").setAttribute("aria-pressed", "false"); $("vL").replaceChildren(); $("vR").replaceChildren();
  $("qCover").replaceChildren(); $("qWarn").replaceChildren(); $("iList").replaceChildren(); $("iNote").textContent = "";
}
function vSize(w, h, from) {      // the previews decide the frame; the Sentinel-2 image only if it comes first
  if (!w || !h || (V.sized === "preview" && from !== "preview") || (V.w === w && V.h === h)) return;
  V.w = w; V.h = h; V.sized = from; vWorld.style.width = w + "px"; vWorld.style.height = h + "px"; vFit();
}
function vFit() {
  const W = viewer.clientWidth, H = viewer.clientHeight; if (!V.w || !W) return;
  V.fitK = Math.min(W / V.w, H / V.h); V.k = V.fitK; V.x = (W - V.w * V.k) / 2; V.y = (H - V.h * V.k) / 2; vApply();
}
const vSingle = () => V.mode === "single" || $("vL").value === $("vR").value || $("vL").options.length < 2;
function vApply() {
  const W = viewer.clientWidth, H = viewer.clientHeight; if (!V.w || !W) return;
  const m = 90;
  V.x = Math.min(W - m, Math.max(m - V.w * V.k, V.x)); V.y = Math.min(H - m, Math.max(m - V.h * V.k, V.y));
  vWorld.style.transform = `translate(${V.x}px, ${V.y}px) scale(${V.k})`;
  const single = vSingle(), sx = V.split * W, wx = (sx - V.x) / V.k;
  $("vLeft").style.clipPath = single ? "none" : `inset(0 ${Math.min(V.w, Math.max(0, V.w - wx))}px 0 0)`;
  $("vDiv").hidden = single; $("vDiv").style.left = sx + "px"; $("vDiv").setAttribute("aria-valuenow", String(Math.round(V.split * 100)));
  $("vTagR").hidden = single;
  $("vPct").textContent = Math.abs(V.k - V.fitK) < 1e-6 ? "Fit" : Math.round(V.k * 100) + " %";
  const metres = current && current.info ? sizeOf(current.info.params.area).w * 1000 : 0;      // scale bar
  if (metres) {
    const pxPerM = V.k * V.w / metres, n = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5].find(v => v * pxPerM <= 130) || 5;
    $("vScale").firstChild.style.width = n * pxPerM + "px"; $("vScale").lastChild.textContent = n >= 1000 ? n / 1000 + " km" : n + " m"; $("vScale").hidden = false;
  } else $("vScale").hidden = true;
}
function vZoom(sx, sy, k) {
  k = Math.max(V.fitK * 0.6, Math.min(Math.max(8, V.fitK * 10), k));
  const wx = (sx - V.x) / V.k, wy = (sy - V.y) / V.k;
  V.k = k; V.x = sx - wx * k; V.y = sy - wy * k; vApply();
}
const layerName = k => k === "s2" && current && current.aux && current.aux.s2Label ? current.aux.s2Label : LAYER[k];
function fillView() {
  const ids = ["s2", "1", "2"].filter(k => layerEls[k]), l = $("vL"), r = $("vR"), keepL = l.value, keepR = r.value;
  for (const s of [l, r]) s.replaceChildren(...ids.map(k => el("option", { value: k, text: layerName(k) })));
  const best = ids.includes("2") ? "2" : "1", other = ids.includes("s2") ? "s2" : ids.includes("1") ? "1" : best;
  l.value = current.touched && ids.includes(keepL) ? keepL : other;
  r.value = current.touched && ids.includes(keepR) ? keepR : best;
  $("jBody").hidden = !ids.length;
  drawView();
}
function drawView() {
  const l = $("vL").value, r = $("vR").value, single = vSingle();
  $("vLeft").replaceChildren(); $("vRight").replaceChildren();
  if (single) { if (layerEls[l]) $("vRight").append(layerEls[l]); }
  else { if (layerEls[r]) $("vRight").append(layerEls[r]); if (layerEls[l]) $("vLeft").append(layerEls[l]); }
  $("vmCompare").setAttribute("aria-pressed", String(V.mode === "compare")); $("vmSingle").setAttribute("aria-pressed", String(V.mode === "single"));
  $("vRwrap").hidden = V.mode === "single"; $("vLname").textContent = V.mode === "single" ? "Image" : "Left";
  $("vmCompare").disabled = $("vL").options.length < 2;
  $("vTagL").textContent = layerName(l) || ""; $("vTagR").textContent = layerName(r) || "";
  $("vNote").textContent = single ? "Drag to move the image. Zoom with the buttons, with Ctrl + mouse wheel, with two fingers or with a double click."
    : "Drag the round handle to compare. Drag the image to move it; zoom with the buttons, with Ctrl + mouse wheel, with two fingers or with a double click.";
  if (Math.abs(V.k - V.fitK) < 1e-6) vFit(); else vApply();
}
$("vL").onchange = $("vR").onchange = () => { current.touched = true; drawView(); };
$("vmCompare").onclick = () => { V.mode = "compare"; drawView(); };
$("vmSingle").onclick = () => { V.mode = "single"; drawView(); };
$("vIn").onclick = () => vZoom(viewer.clientWidth / 2, viewer.clientHeight / 2, V.k * 1.5);
$("vOut").onclick = () => vZoom(viewer.clientWidth / 2, viewer.clientHeight / 2, V.k / 1.5);
$("vPct").onclick = vFit;
$("vFull").onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else if ($("viewCard").requestFullscreen) $("viewCard").requestFullscreen().catch(() => {}); };
document.addEventListener("fullscreenchange", () => setTimeout(vFit, 60));
$("vMaskBtn").onclick = () => { V.mask = !V.mask; $("vMaskBtn").setAttribute("aria-pressed", String(V.mask)); $("vMask").hidden = $("vLegend").hidden = !V.mask; };
if (window.ResizeObserver) new ResizeObserver(() => { if (Math.abs(V.k - V.fitK) < 1e-6) vFit(); else vApply(); }).observe(viewer);
viewer.addEventListener("wheel", e => {
  if (!(e.ctrlKey || e.metaKey)) return;      // a plain wheel scrolls the page
  e.preventDefault();
  const r = viewer.getBoundingClientRect();
  vZoom(e.clientX - r.left, e.clientY - r.top, V.k * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)));
}, { passive: false });
viewer.addEventListener("dblclick", e => { if (e.target.closest(".vdivider")) return; const r = viewer.getBoundingClientRect(); vZoom(e.clientX - r.left, e.clientY - r.top, V.k * 2); });
(function pointers() {
  const pts = new Map(); let pan = null, pinch = null, div = false;
  const at = e => { const r = viewer.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  viewer.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = at(e); pts.set(e.pointerId, p);
    try { viewer.setPointerCapture(e.pointerId); } catch (err) {}
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pan = null; div = false;
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: V.k, wx: ((a.x + b.x) / 2 - V.x) / V.k, wy: ((a.y + b.y) / 2 - V.y) / V.k }; return; }
    if (e.target.closest(".vdivider")) { div = true; e.preventDefault(); return; }
    pan = { sx: p.x, sy: p.y, vx: V.x, vy: V.y }; viewer.classList.add("panning");
  });
  viewer.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    const p = at(e); pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()], k = Math.max(V.fitK * 0.6, Math.min(Math.max(8, V.fitK * 10), pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.d));
      V.k = k; V.x = (a.x + b.x) / 2 - pinch.wx * k; V.y = (a.y + b.y) / 2 - pinch.wy * k; vApply(); return; }
    if (div) { V.split = Math.max(0, Math.min(1, p.x / viewer.clientWidth)); vApply(); }
    else if (pan) { V.x = pan.vx + p.x - pan.sx; V.y = pan.vy + p.y - pan.sy; vApply(); }
  });
  const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { pan = null; div = false; viewer.classList.remove("panning"); } };
  viewer.addEventListener("pointerup", end); viewer.addEventListener("pointercancel", end);
  $("vDiv").addEventListener("keydown", e => { const d = { ArrowLeft: -0.02, ArrowRight: 0.02 }[e.key]; if (d) { e.preventDefault(); V.split = Math.max(0, Math.min(1, V.split + d)); vApply(); } });
})();

// ---------------------------------------------------------------- one image: results
async function showResults(job, info) {
  let res;
  try { res = await api("GET", `/v1/jobs/${info.id}/results`); } catch (e) { return false; }
  if (current !== job) return false;
  const f = res.files; job.files = f;
  for (const [k, file] of [["1", "stage1_preview.png"], ["2", "stage2_preview.png"]]) {
    if (!f[file] || layerEls[k]) continue;
    const img = el("img", { alt: LAYER[k], draggable: false });
    img.addEventListener("load", () => { if (current === job) vSize(img.naturalWidth, img.naturalHeight, "preview"); });
    img.src = f[file]; layerEls[k] = img;
  }
  fillView(); fillFiles(info); $("files").hidden = false;
  $("jCredit").textContent = res.attribution ? res.attribution + ". Place names and the map: © OpenStreetMap contributors." : "";
  if (!job.aux) loadAux(job, info, f);
  return true;
}
function loadScript(src) {
  return new Promise((ok, bad) => { if (window.GeoTIFF) return ok(); const s = el("script", { src }); s.onload = ok; s.onerror = bad; document.head.append(s); });
}
async function loadAux(job, info, f) {      // everything around the two previews: inputs, validity, the list of images used
  const a = job.aux = { store: null, manifest: null, scenes: [], from: "", cover: null, s2: "", s2Label: "", want: "", cache: {}, ref: null, problem: "" };
  const mine = () => current === job;
  try { const r = await fetch(f["manifest.json"]); if (!r.ok) throw new Error(String(r.status)); a.manifest = await r.json(); a.store = true; }
  catch (e) { a.store = false; }      // the file store does not let the browser read: the page works without
  if (!mine()) return;
  if (a.store) {
    const m = a.manifest, tiles = m.tiles || [], primary = new Set((m.windows || []).map(w => w.primary_id));
    const used = new Map(); for (const t of tiles) for (const id of new Set(t.scene_ids || [])) used.set(id, (used.get(id) || 0) + 1);
    a.scenes = Object.entries(m.scenes || {}).map(([id, s]) => ({ id, date: String(s.datetime).slice(0, 10), cloud: s.cloud_cover, share: tiles.length ? (used.get(id) || 0) / tiles.length : null, primary: primary.has(id) }));
    a.from = "manifest";
    if (m.coverage) a.cover = { valid: m.coverage.valid, low: m.coverage.low_diversity, nodata: m.coverage.nodata };
    fillFiles(info); showDetails(info);
    loadReference(job, f["lr_reference.tif"]); loadValidity(job, f["validity.tif"]);
  } else {
    try {
      const p = info.params, e = await api("POST", "/v1/estimate", { area: p.area, target_date: p.target_date, stages: p.stages, time_window: p.time_window, max_cloud: p.max_cloud, min_clear: p.min_clear, n_revisits: p.n_revisits, tau: p.tau, seed: p.seed });
      a.scenes = (e.scenes || []).map(s => ({ id: s.id, date: s.date, cloud: s.cloud_cover, share: null, primary: false })); a.from = "search";
    } catch (e) {}
    if (!mine()) return;
  }
  a.scenes.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
  showInputs(); showQuality();
  if (!a.store && a.scenes.length) {      // show the image nearest to the date, the clearer one if two are equally near
    const t = Date.parse(info.params.target_date), near = a.scenes.slice().sort((x, y) => (Math.abs(Date.parse(x.date) - t) - Math.abs(Date.parse(y.date) - t)) || ((x.cloud || 0) - (y.cloud || 0)))[0];
    pickScene(job, near.id, false);
  }
}
const s2Fill = (R, G, B, n, out) => { for (let i = 0; i < n; i++) { out[4 * i] = R[i] * 0.085; out[4 * i + 1] = G[i] * 0.085; out[4 * i + 2] = B[i] * 0.085; out[4 * i + 3] = 255; } };      // reflectance 0 to 0.3, like the previews
function s2Canvas(R, G, B, w, h) {
  const c = el("canvas", { width: w, height: h }), ctx = c.getContext("2d"), d = ctx.createImageData(w, h);
  s2Fill(R, G, B, w * h, d.data); ctx.putImageData(d, 0, 0); return c;
}
async function loadReference(job, url) {      // the service's own Sentinel-2 composite (lr_reference.tif)
  const a = job.aux;
  try {
    await loadScript("../assets/vendor/geotiff.js");
    const r = await fetch(url); if (!r.ok) throw new Error(String(r.status));
    const tiff = await GeoTIFF.fromArrayBuffer(await r.arrayBuffer()), img = await tiff.getImage();
    const [R, G, B] = await img.readRasters({ samples: [0, 1, 2] });
    a.ref = s2Canvas(R, G, B, img.getWidth(), img.getHeight());
    if (current !== job) return;
    showInputs();
    if (!a.want) pickScene(job, "ref", false);
  } catch (e) { if (current === job && !a.want && a.scenes.length) pickScene(job, a.scenes[0].id, false); }
}
async function loadValidity(job, url) {
  const a = job.aux;
  try {
    await loadScript("../assets/vendor/geotiff.js");
    const r = await fetch(url); if (!r.ok) throw new Error(String(r.status));
    const tiff = await GeoTIFF.fromArrayBuffer(await r.arrayBuffer()), img = await tiff.getImage(), w = img.getWidth(), h = img.getHeight();
    const [cls] = await img.readRasters({ samples: [0] });
    if (current !== job) return;
    const c = $("vMask"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"), d = ctx.createImageData(w, h), n = [0, 0, 0];
    for (let i = 0; i < w * h; i++) {
      const v = cls[i]; n[v === 1 ? 1 : v === 2 ? 2 : 0] += 1;
      if (v === 1) continue;
      const o = 4 * i; if (v === 2) { d.data[o] = 246; d.data[o + 1] = 177; d.data[o + 2] = 0; } else { d.data[o] = 229; d.data[o + 1] = 72; d.data[o + 2] = 77; }
      d.data[o + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);
    if (!a.cover) a.cover = { valid: n[1] / (w * h), low: n[2] / (w * h), nodata: n[0] / (w * h) };
    a.mask = true; $("vMaskBtn").disabled = false; showQuality();
  } catch (e) {}
}

// One Sentinel-2 image of the area, read from the public archive: the three colour bands of the scene, cut to the
// frame of the job. The frame is found the way the service finds it (core/acquire.py define_grid): the area's
// centre on the scene's own 10 m pixel lattice, even pixel offsets.
function utm(lat, lon, zone, south) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = lat * Math.PI / 180, lam = (lon - (zone * 6 - 183)) * Math.PI / 180, s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = c * lam;
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const x = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [x, y + (south ? 10000000 : 0)];
}
function sceneParts(id) {
  const m = String(id).match(/^S2[A-Z]_(\d{1,2})([C-X])([A-Z]{2})_(\d{4})(\d{2})(\d{2})_/);
  return m ? { zone: Number(m[1]), south: m[2] < "N", dir: `${COGS}/${Number(m[1])}/${m[2]}/${m[3]}/${m[4]}/${Number(m[5])}/${id}` } : null;
}
function frameOn(area, ox, oy, zone, south) {      // [col0, row0, width, height] of the job's frame on a scene whose top left corner is (ox, oy)
  const lat = (area[1] + area[3]) / 2, lon = (area[0] + area[2]) / 2;
  const h = Math.max(32, Math.round((area[3] - area[1]) * 111320 / 10)), w = Math.max(32, Math.round((area[2] - area[0]) * 111320 * Math.cos(lat * Math.PI / 180) / 10));
  const [x, y] = utm(lat, lon, zone, south);
  let c0 = Math.floor((x - ox) / 10) - Math.floor(w / 2), r0 = Math.floor((oy - y) / 10) - Math.floor(h / 2);
  c0 -= ((c0 % 2) + 2) % 2; r0 -= ((r0 % 2) + 2) % 2;
  return [c0, r0, w, h];
}
async function readScene(id, area) {
  const s = sceneParts(id); if (!s) throw new Error("unknown scene name");
  await loadScript("../assets/vendor/geotiff.js");
  const stop = new AbortController(), giveUp = setTimeout(() => stop.abort(), 60000);
  try {
    const band = async name => {
      const tiff = await GeoTIFF.fromUrl(`${s.dir}/${name}.tif`, {}, stop.signal), img = await tiff.getImage();
      const [ox, oy] = img.getOrigin(), [c0, r0, w, h] = frameOn(area, ox, oy, s.zone, s.south), W = img.getWidth(), H = img.getHeight();
      const x0 = Math.max(0, c0), y0 = Math.max(0, r0), x1 = Math.min(W, c0 + w), y1 = Math.min(H, r0 + h);
      const out = new Uint16Array(w * h);
      if (x1 > x0 && y1 > y0) {
        const [d] = await img.readRasters({ window: [x0, y0, x1, y1], samples: [0], signal: stop.signal });
        for (let r = 0; r < y1 - y0; r++) out.set(d.subarray(r * (x1 - x0), (r + 1) * (x1 - x0)), (r + y0 - r0) * w + (x0 - c0));
      }
      return { out, w, h, frame: [ox + c0 * 10, oy - r0 * 10] };
    };
    const [R, G, B] = await Promise.all(["B04", "B03", "B02"].map(band));
    const c = s2Canvas(R.out, G.out, B.out, R.w, R.h); c.dataset.frame = R.frame.join(",");
    return c;
  } finally { clearTimeout(giveUp); }
}
async function pickScene(job, id, byUser) {
  const a = job.aux, scene = a.scenes.find(s => s.id === id);
  a.want = id; a.problem = ""; markScenes();
  if (id !== "ref" && !a.cache[id]) {
    $("vLoad").replaceChildren(el("span", { class: "spinner" }), `Loading the Sentinel-2 image of ${shortDate(scene.date)}…`); $("vLoad").hidden = false;
    try { a.cache[id] = await readScene(id, job.info.params.area); }
    catch (e) { if (current === job && a.want === id) { a.problem = "This Sentinel-2 image could not be loaded from the public archive. Your network may block it."; a.want = a.s2; markScenes(); $("vLoad").hidden = true; } return; }
    if (current !== job) return;
    if (a.want !== id) return;
    $("vLoad").hidden = true;
  }
  if (current !== job || a.want !== id) return;
  const c = id === "ref" ? a.ref : a.cache[id];
  a.s2 = id; a.s2Label = id === "ref" ? "Sentinel-2 input (10 m)" : `Sentinel-2 · ${shortDate(scene.date)}`;
  layerEls.s2 = c; vSize(c.width * 4, c.height * 4, "s2");
  if (byUser) { current.touched = true; fillView(); $("vL").value = "s2"; if ($("vR").value === "s2") $("vR").value = layerEls["2"] ? "2" : "1"; drawView(); if (window.innerWidth < 981) $("viewCard").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  else fillView();
  markScenes(); fillFiles(job.info);
}
function markScenes() {
  const a = current && current.aux; if (!a) return;
  for (const b of $("iList").querySelectorAll(".scene")) { const on = b.dataset.id === a.s2, wait = b.dataset.id === a.want && a.want !== a.s2;
    b.classList.toggle("on", on); b.querySelector(".see").textContent = wait ? "Loading…" : on ? "Shown" : "Show"; }
  const note = $("iProblem"); if (note) { note.hidden = !a.problem; note.textContent = a.problem; }
}
function showInputs() {
  const job = current, a = job && job.aux; if (!a) return;
  const p = job.info.params, target = p.target_date;
  const usedN = a.scenes.filter(s => s.share).length;
  $("iNote").replaceChildren(a.from === "manifest"
    ? `The service used ${usedN} of the ${a.scenes.length} Sentinel-2 images it found, up to 8 for each part of the area. Click one to see it in the viewer.`
    : a.scenes.length ? `${a.scenes.length} Sentinel-2 images were available around ${niceDate(target)}. The service combines up to 8 of them for each part of the area, the clearest and nearest in time first. Click one to see it in the viewer.`
    : "The list of Sentinel-2 images could not be loaded. It is in manifest.json (see the files below).");
  const rows = [];
  if (a.ref) rows.push(el("button", { type: "button", class: "scene", dataset: { id: "ref" }, onclick: () => pickScene(job, "ref", true) },
    el("span", { class: "d" }, "Input as the model saw it", el("small", { text: "lr_reference.tif: the main image of each part" })), el("span"), el("span", { class: "see", text: "Show" })));
  for (const s of a.scenes) {
    const c = s.cloud === null || s.cloud === undefined ? null : Math.round(s.cloud), days = Math.round((Date.parse(s.date) - Date.parse(target)) / 864e5);
    rows.push(el("button", { type: "button", class: "scene", dataset: { id: s.id }, title: s.id, onclick: () => pickScene(job, s.id, true) },
      el("span", { class: "d" }, el("span", null, shortDate(s.date), s.primary ? el("span", { class: "mini", text: "main" }) : null),
        el("small", { text: `${s.id.slice(0, 3)} · ${days === 0 ? "on your date" : Math.abs(days) + (Math.abs(days) === 1 ? " day " : " days ") + (days < 0 ? "before" : "after")}${s.share ? " · used for " + pct(s.share) + " of the area" : s.share === 0 ? " · not used" : ""}` })),
      el("span", { class: "cl" }, c === null ? "" : `${c} % cloud`, el("span", { class: "meter" }, el("i", { style: `width:${c === null ? 0 : Math.min(100, c)}%` }))),
      el("span", { class: "see", text: "Show" })));
  }
  $("iList").replaceChildren(...rows, el("p", { class: "small", id: "iProblem", hidden: true, style: "padding:6px 8px;color:var(--bad)" }));
  markScenes();
}
function showQuality() {
  const job = current, info = job && job.info; if (!info) return;
  const a = job.aux, cover = a && a.cover, out = [];
  if (cover) {
    const parts = [["Enough clear images", cover.valid, "#1f8a70"], ["Few clear images (fewer than 4)", cover.low, "#f6b100"], ["No data", cover.nodata, "#e5484d"]];
    $("qCover").replaceChildren(el("div", { class: "cover" },
      el("div", { class: "bar" }, parts.map(([, v, c]) => el("i", { style: `width:${Math.max(0, v) * 100}%;background:${c}` }))),
      el("div", { class: "legend" }, parts.map(([n, v, c]) => el("span", null, el("i", { style: `background:${c}` }), n, el("b", { text: pct(Math.max(0, v || 0)) })))),
      a.mask ? el("p", { class: "small", text: "“Validity mask” above the image shows where." }) : null));
  } else if (a && a.store === false && info.results_ready) {
    $("qCover").replaceChildren(el("p", { class: "small" }, "The map of valid, weak and empty parts is in ", el("code", { text: "validity.tif" }), " (see the files below). It cannot be drawn on this page yet."));
  } else $("qCover").replaceChildren();
  for (const w of info.warnings || []) {
    const t = WARN[w.code];
    out.push(el("div", { class: "wcard" }, icon("alert"), el("div", null, el("b", { text: t ? t[0] : w.code }), t ? t[1] : w.message,
      t && w.value !== undefined && w.value !== null ? el("small", { text: `Measured: ${t[2](w.value)}${w.threshold !== undefined && w.code !== "missing_tiles" ? ` (warning above ${pct(w.threshold)})` : ""}` }) : null)));
  }
  if (!out.length && info.results_ready) out.push(el("div", { class: "wcard ok" }, icon("check"), el("div", null, el("b", { text: "No warnings" }), "The service found nothing to look at twice: not much water, enough clear images, no empty parts.")));
  $("qWarn").replaceChildren(...out);
}

// ---------------------------------------------------------------- one image: files
function fileName(info, what) {
  const base = ($("jTitle").textContent || "image").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "image";
  return `${base}_${info.params.target_date}_${what}`;
}
async function saveAs(url, name, button) {      // only used when the file store lets the browser read the file
  const old = [...button.childNodes]; button.textContent = "Downloading…";
  try { const blob = await (await fetch(url)).blob(), a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
  catch (e) { window.open(url, "_blank", "noopener"); }
  button.replaceChildren(...old);
}
function fillFiles(info) {
  const job = current, f = job.files || {}, a = job.aux || {}, png = [], open = a.store === true;
  const row = (title, sub, ...buttons) => el("div", { class: "file" }, el("span", { class: "what" }, el("b", { text: title }), sub ? el("small", { text: sub }) : null), el("span", { class: "row" }, ...buttons));
  const link = (url, name, text) => {
    const b = el("a", { class: "btn small-btn", href: url, target: "_blank", rel: "noopener", download: name }, icon("download"), text || "Download");
    if (open) b.addEventListener("click", e => { e.preventDefault(); saveAs(url, name, b); });
    return b;
  };
  for (const [k, file, what] of [["2", "stage2_preview.png", "stage2"], ["1", "stage1_preview.png", "stage1"]])
    if (f[file]) png.push(row(LAYER[k], null, link(f[file], fileName(info, what) + ".png")));
  if (layerEls.s2) png.push(row(a.s2Label || LAYER.s2, "enlarged to the same size, pixels kept",
    el("button", { type: "button", class: "small-btn", onclick: () => {      // enlarged 4 times without smoothing: the same size as the 2.5 m images
      const c = layerEls.s2, big = el("canvas", { width: c.width * 4, height: c.height * 4 }), ctx = big.getContext("2d");
      ctx.imageSmoothingEnabled = false; ctx.drawImage(c, 0, 0, big.width, big.height);
      const l = el("a", { href: big.toDataURL("image/png"), download: fileName(info, a.s2 === "ref" ? "sentinel2" : "sentinel2_" + ((a.scenes.find(s => s.id === a.s2) || {}).date || "")) + ".png" }); document.body.append(l); l.click(); l.remove();
    } }, icon("download"), "Download")));
  if (!open && png.length) png.push(el("p", { class: "small", text: "A stage 1 or stage 2 picture opens in a new tab: right-click it (or press and hold on a phone) and choose “Save image”." }));
  $("fPng").replaceChildren(...png);
  $("fTif").replaceChildren(...FILES.filter(([name]) => f[name]).map(([name, what]) => row(name, what,
    link(f[name], name), el("button", { type: "button", class: "small-btn", onclick: e => copyText(f[name], e.currentTarget) }, "Copy link"))));
  const best = f["stage2_sr.tif"] ? "stage2_sr.tif" : "stage1_sr.tif";
  const code = k => `%pip install -q "sr-client[geo,viz] @ git+https://github.com/adb-sr/sr-client@v0.1.0"\nfrom sr_client import SRClient\n\nsr = SRClient("${k}", url="${API}")\njob = sr.job("${info.id}")\njob.show()                          # the pictures\nimage = job.open("${best}")   # xarray, reflectance 0 to 1\njob.download("results/")            # every file`;
  $("fCode").textContent = code("YOUR_KEY");
  $("fCopy").onclick = e => copyText(code(key), e.currentTarget);
}

// ---------------------------------------------------------------- my images
async function listJobs() {
  clearTimeout(jobsTimer);
  let jobs;
  try { jobs = (await api("GET", "/v1/jobs?limit=30")).jobs; } catch (e) { return; }
  $("tCount").textContent = String(jobs.length); $("tCount").hidden = !jobs.length;
  if (!jobs.length) { $("mList").replaceChildren(el("div", { class: "empty", style: "border:0" }, "No images yet. ", el("a", { href: "#new", text: "Make your first image" }), ".")); return; }
  $("mList").replaceChildren(...jobs.map(j => el("a", { class: "jobrow", href: "#job=" + j.id },
    el("span", { class: "what" }, el("b", { text: labelOf(j.id) || "Image of " + niceDate(j.target_date) }),
      el("small", { text: `${niceDate(j.target_date)} · ${j.stages.length > 1 ? "stage 1 and 2" : "stage 1"} · made ${niceTime(j.created_at)}` })),
    el("span", { class: "chip " + j.status, text: STATUS[j.status] || j.status }), el("span", { class: "arrow" }, "→"))));
  if (view === "jobs" && jobs.some(j => ACTIVE.includes(j.status))) jobsTimer = setTimeout(listJobs, 8000);
}
$("mRefresh").onclick = listJobs;

// ---------------------------------------------------------------- start
syncStrength();
if (key) enter().catch(e => { if (key) { $("cErr").textContent = e.message; $("cErr").hidden = false; } });
