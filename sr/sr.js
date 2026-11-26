// Make an image: a page in front of the super-resolution service (config.js: SR_SERVICE).
// It does what the Python client does: sign up by email, estimate, submit, follow the job, show and link the
// files. The page keeps the key in this browser only. Needs config.js, site.js, areas.js and Leaflet.

// For tests, ?api=http://localhost:PORT points the page at a stand-in service. Only local addresses are
// accepted, so a link can never send somebody's key to another server.
const API = (() => {
  const o = new URLSearchParams(location.search).get("api");
  return o && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : SR_SERVICE.replace(/\/+$/, "");
})();
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

let key = remember("sr-key"), me = null, map = null, rect = null, sel = { ready: null, lat: 14.5878, lon: 121.0585, km: 2 };
let current = null, pollTimer = null, shownStitched = -1, layers = {}, corsOk = false, zoom = 1, touchedView = false, s2Download = "";

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
const niceDate = d => { const x = new Date(String(d).slice(0, 10) + "T00:00:00"); return isNaN(x) ? String(d) : x.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); };
function box(cls, ...kids) { return el("div", { class: cls }, ...kids); }
async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const t = el("textarea", { value: text, style: "position:fixed;opacity:0" }); document.body.append(t); t.select(); try { document.execCommand("copy"); } catch (e2) {} t.remove(); }
  if (button) { const old = button.textContent; button.textContent = "Copied"; setTimeout(() => { button.textContent = old; }, 1400); }
}

// ---------------------------------------------------------------- connecting
function leave(message) {
  key = ""; me = null; forget("sr-key"); clearTimeout(pollTimer); current = null;
  $("app").hidden = true; $("cIn").hidden = true; $("cOut").hidden = false;
  $("cErr").hidden = !message; $("cErr").textContent = message || "";
}
async function enter() {
  me = await api("GET", "/v1/me");
  remember("sr-key", key);
  $("cOut").hidden = true; $("cIn").hidden = false; $("app").hidden = false;
  showBudget();
  const max = Math.max(0.5, Math.floor((me.limits.max_area_km || 5) * 2) / 2);
  $("pKm").max = String(max); if (sel.km > max) sel.km = max;
  startMap(); syncPlace(); listJobs();
  const m = location.hash.match(/job=([0-9a-f-]{36})/);
  if (m) openJob(m[1]);
}
function showBudget() {
  const b = me.budget, left = b.remaining_usd === null || b.remaining_usd === undefined ? "no budget limit" : `${usd(b.remaining_usd)} of ${usd(b.budget_usd)} left`;
  $("cWho").replaceChildren(el("b", { text: "Connected" }), ` as ${me.owner} · areas up to ${me.limits.max_area_km} km per side · ${left}`);
}
async function refreshMe() { try { me = await api("GET", "/v1/me"); showBudget(); } catch (e) {} }
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
$("cLeave").onclick = () => { if (confirm("Disconnect this browser? Your images stay with your email address: connect again to see them.")) leave(""); };
$("cCopy").onclick = e => copyText(key, e.currentTarget);

// ---------------------------------------------------------------- 1 where
function areaAround(lat, lon, km) {      // the same box as sr_client.area_around
  const dlat = km / 2 / 111.32, dlon = km / 2 / (111.32 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
  return [lon - dlon, lat - dlat, lon + dlon, lat + dlat].map(v => Math.round(v * 1e6) / 1e6);
}
function bbox() { return sel.ready && sel.ready.km === sel.km ? sel.ready.bbox : areaAround(sel.lat, sel.lon, sel.km); }
function placeName() { return sel.ready ? sel.ready.name : `${sel.lat.toFixed(4)}, ${sel.lon.toFixed(4)}`; }
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
  rect = L.rectangle([[0, 0], [0, 0]], { color: "#007db7", weight: 3, fillOpacity: 0.12, interactive: false }).addTo(map);
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
  $("est").replaceChildren();
}
function setOwn(lat, lon, fit) {
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return;
  sel = { ready: null, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, km: sel.km };
  $("pReady").value = "own"; syncPlace(fit);
}
$("pReady").onchange = () => {
  const v = $("pReady").value;
  if (v === "own") sel = { ready: null, lat: sel.lat, lon: sel.lon, km: sel.km };
  else { const a = READY[Number(v)]; sel = { ready: a, lat: a.lat, lon: a.lon, km: a.km }; $("dDate").value = a.date; }
  syncPlace();
};
$("pKm").oninput = () => { sel.km = Number($("pKm").value); syncPlace(); };
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

// ---------------------------------------------------------------- 3 what
const radio = name => document.querySelector(`input[name="${name}"]:checked`);
function syncStrength() {
  $("strengthBox").hidden = radio("stages").value === "1";
  const tau = $("oTau").value.trim();
  for (const r of document.querySelectorAll('input[name="strength"]')) r.checked = r.value === tau;
}
for (const r of document.querySelectorAll('input[name="stages"]')) r.onchange = () => { syncStrength(); $("est").replaceChildren(); };
for (const r of document.querySelectorAll('input[name="strength"]')) r.onchange = () => { $("oTau").value = r.value; $("est").replaceChildren(); };
$("oTau").oninput = syncStrength;
$("oReset").onclick = () => { for (const [id, v] of Object.entries(DEFAULTS)) $(id).value = v; $("oBands").checked = $("oCache").checked = true; syncStrength(); $("est").replaceChildren(); };
for (const id of [...Object.keys(DEFAULTS), "oBands", "oCache", "dDate"]) $(id).addEventListener("change", () => $("est").replaceChildren());

function request() {
  const whole = (id, lo, hi, name) => {
    const raw = $(id).value.trim(), v = Number(raw);
    if (raw === "" || !Number.isInteger(v) || v < lo || v > hi) { $("more").open = true; $(id).focus(); throw new Error(`${name} must be a whole number from ${lo} to ${hi}.`); }
    return v;
  };
  const date = $("dDate").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { $("dDate").focus(); throw new Error("Choose a date."); }
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
function minutes(tiles, body) {
  const s = 75 + (body.stages.length > 1 ? 45 + tiles * (body.nfe || body.tau) * 0.00263 : 0);
  return Math.max(1, Math.round(s / 60));
}
async function busy(fn) {
  $("check").disabled = $("make").disabled = true; $("busy").hidden = false;
  try { await fn(); } catch (e) { if (key) $("est").replaceChildren(box("bad-box", e.message)); }
  finally { $("check").disabled = $("make").disabled = false; $("busy").hidden = true; }
}
$("check").onclick = () => busy(async () => {
  const body = request(), e = await api("POST", "/v1/estimate", body), out = [];
  if (e.problems && e.problems.length) out.push(box("bad-box", el("b", { text: "This cannot run as it is. " }), e.problems.join(" ")));
  if (e.cached) out.push(box("ok-box", el("b", { text: "This image is ready. " }), "“Make the image” gives it to you at once, and it costs nothing."));
  else if (e.submittable) {
    const left = me && me.budget.remaining_usd !== null && me.budget.remaining_usd !== undefined ? ` (you have ${usd(me.budget.remaining_usd)} left)` : "";
    out.push(box("ok-box", el("b", { text: "This can run. " }), `It takes roughly ${minutes(e.tiles, body)} minute${minutes(e.tiles, body) === 1 ? "" : "s"}, longer when many people make images at once, and uses up to ${usd(e.estimated_usd)} of your budget${left}. The area is cut into ${e.tiles} tiles.`));
  }
  for (const w of e.warnings_likely || []) out.push(box("warn-box", w.message));
  const days = new Set((e.scenes || []).map(s => s.date)).size;
  if (e.scenes && e.scenes.length) out.push(el("details", null,
    el("summary", { text: `${e.scenes.length} Sentinel-2 image${e.scenes.length === 1 ? "" : "s"} from ${days} day${days === 1 ? "" : "s"} found between ${niceDate(e.search_window[0])} and ${niceDate(e.search_window[1])}` }),
    el("div", { class: "scroll-x" }, el("table", { class: "plain" }, el("tr", null, el("th", { text: "Date" }), el("th", { text: "Cloud cover of the whole image" })),
      e.scenes.map(s => el("tr", null, el("td", { text: niceDate(s.date) }), el("td", { text: s.cloud_cover === null || s.cloud_cover === undefined ? "–" : `${Math.round(s.cloud_cover)} %` })))))));
  $("est").replaceChildren(...out);
});
$("make").onclick = () => busy(async () => {
  const body = request(), name = placeName(), got = await api("POST", "/v1/jobs", body);
  const labels = JSON.parse(remember("sr-labels") || "{}"); labels[got.job_id] = name;
  remember("sr-labels", JSON.stringify(Object.fromEntries(Object.entries(labels).slice(-60))));
  $("est").replaceChildren();
  await openJob(got.job_id); listJobs(); refreshMe();
  $("job").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------------------------------------------------------------- the job
const labelOf = id => { try { return JSON.parse(remember("sr-labels") || "{}")[id] || ""; } catch (e) { return ""; } };
function summaryOf(p) {
  const parts = [];
  if (Array.isArray(p.area) && p.area.length === 4) {
    const b = p.area, h = (b[3] - b[1]) * 111.32, w = (b[2] - b[0]) * 111.32 * Math.cos((b[1] + b[3]) / 2 * Math.PI / 180);
    parts.push(`${w.toFixed(1)} km × ${h.toFixed(1)} km around ${((b[1] + b[3]) / 2).toFixed(4)}, ${((b[0] + b[2]) / 2).toFixed(4)}`);
  }
  parts.push(niceDate(p.target_date));
  if (p.stages.length > 1) {
    const s = { 100: "light", 250: "standard", 500: "strong" }[p.tau];
    parts.push(`stage 1 and stage 2, ${s ? s + " strength" : "tau " + p.tau}${p.nfe && p.nfe !== p.tau ? `, ${p.nfe} steps` : ""}${p.seed ? `, seed ${p.seed}` : ""}`);
  } else parts.push("stage 1 only");
  return parts.join(" · ");
}
async function openJob(id) {
  clearTimeout(pollTimer);
  current = { id }; shownStitched = -1; layers = {}; corsOk = false; touchedView = false; s2Download = "";
  history.replaceState(null, "", location.pathname + location.search + "#job=" + id);
  $("job").hidden = false; $("view").hidden = true; $("files").hidden = true;
  $("jTitle").textContent = labelOf(id) || "Your image"; $("jSummary").textContent = ""; $("jSteps").replaceChildren(); $("jMsg").replaceChildren();
  $("jStatus").textContent = "Loading…"; $("jStatus").className = "chip"; $("jCancel").hidden = $("jUpgrade").hidden = true; $("jCredit").textContent = "";
  await poll(id);
  for (const r of document.querySelectorAll(".jobrow")) r.classList.toggle("current", r.dataset.id === id);
}
async function poll(id) {
  if (!current || current.id !== id) return;
  let info;
  try { info = await api("GET", `/v1/jobs/${id}`); }
  catch (e) {
    if (!current || current.id !== id) return;
    if (e.status === 404) { $("jStatus").textContent = "Not found"; $("jMsg").replaceChildren(box("bad-box", "This image does not belong to the connected email address, or it no longer exists.")); return; }
    $("jMsg").replaceChildren(box("warn-box", e.message + " Trying again…")); pollTimer = setTimeout(() => poll(id), 8000); return;
  }
  if (!current || current.id !== id) return;
  const was = current.info; current.info = info;
  showJob(info);
  const stitched = info.progress.filter(p => p.step.startsWith("stitch") && p.state === "done").length;
  if (info.results_ready && stitched !== shownStitched) { if (await showResults(info)) shownStitched = stitched; }
  if (ACTIVE.includes(info.status)) pollTimer = setTimeout(() => poll(id), 4000);
  else if (was && ACTIVE.includes(was.status)) { refreshMe(); listJobs(); }
}
function showJob(info) {
  $("jSummary").textContent = summaryOf(info.params);
  $("jStatus").textContent = STATUS[info.status] || info.status; $("jStatus").className = "chip " + info.status;
  $("jCancel").hidden = !ACTIVE.includes(info.status);
  $("jUpgrade").hidden = !(info.status === "done" && info.params.stages.length === 1);
  $("jSteps").replaceChildren(...info.progress.map(p => {
    const many = p.total > 1, share = p.total ? p.done / p.total : 0;
    const bar = el("i", { class: p.state === "running" && !many ? "unknown" : "" }); if (many && p.state !== "done") bar.style.width = `${Math.round(share * 100)}%`;
    return el("div", { class: "step " + p.state }, el("b", { text: STEP[p.step] || p.step }), el("div", { class: "track" }, bar),
      el("span", { class: "small", text: p.state === "waiting" ? "waiting" : many ? `${p.done} of ${p.total} parts` : p.state }));
  }));
  const msg = [];
  if (info.status === "queued") msg.push(box("note-box", "Your image is waiting in line. One image per person runs at a time. You can leave this page open or come back later: it is listed under “My images”."));
  if (info.status === "running") msg.push(box("note-box", "The service is working. Stage 1 appears first; stage 2 follows a few minutes later."));
  if (info.status === "failed") msg.push(box("bad-box", el("b", { text: "The image could not be made. " }), info.error || ""));
  if (info.status === "cancelled") msg.push(box("warn-box", "This image was cancelled."));
  if (info.status === "partial") msg.push(box("warn-box", "Parts of the area could not be processed. The rest is shown below."));
  for (const w of info.warnings || []) msg.push(box("warn-box", el("b", { text: w.code + ": " }), w.message));
  if (info.cached_from) msg.push(el("p", { class: "small", text: "This image had already been made with the same settings, so it was free." }));
  else if (info.cost && info.cost.actual_usd !== null && info.cost.actual_usd !== undefined && !ACTIVE.includes(info.status)) msg.push(el("p", { class: "small", text: `This image used ${usd(info.cost.actual_usd)} of your budget.` }));
  $("jMsg").replaceChildren(...msg);
}
$("jCancel").onclick = async () => {
  if (!current || !confirm("Cancel this image?")) return;
  try { await api("DELETE", `/v1/jobs/${current.id}`); poll(current.id); } catch (e) { $("jMsg").prepend(box("bad-box", e.message)); }
};
$("jUpgrade").onclick = async e => {
  if (!current) return;
  e.currentTarget.disabled = true;
  try { await api("POST", `/v1/jobs/${current.id}/upgrade`); shownStitched = -1; clearTimeout(pollTimer); await poll(current.id); refreshMe(); }
  catch (err) { $("jMsg").prepend(box("bad-box", err.message)); }
  finally { e.currentTarget.disabled = false; }
};

// ---------------------------------------------------------------- results: viewer and files
async function showResults(info) {
  let res;
  try { res = await api("GET", `/v1/jobs/${info.id}/results`); } catch (e) { return false; }
  if (!current || current.id !== info.id) return false;
  const f = res.files, id = info.id;
  const next = {};
  if (f["stage1_preview.png"]) next["1"] = f["stage1_preview.png"];
  if (f["stage2_preview.png"]) next["2"] = f["stage2_preview.png"];
  if (layers.s2) next.s2 = layers.s2;
  layers = next; current.files = f;
  fillView(); fillFiles(info);
  $("view").hidden = !(layers["1"] || layers["2"]); $("files").hidden = false;
  $("jCredit").textContent = res.attribution ? res.attribution + ". Roads and place names on the map: © OpenStreetMap contributors." : "";
  if (f["lr_reference.tif"] && !layers.s2) loadSentinel(f["lr_reference.tif"], id);
  return true;
}
function loadScript(src) {
  return new Promise((ok, bad) => { if (window.GeoTIFF) return ok(); const s = el("script", { src }); s.onload = ok; s.onerror = bad; document.head.append(s); });
}
// The Sentinel-2 input is a small GeoTIFF. If the file store lets the browser read it, it is drawn with the
// same brightness as the previews (reflectance 0 to 0.3) and offered as a third image.
async function loadSentinel(url, id) {
  try {
    await loadScript("../assets/vendor/geotiff.js");
    const r = await fetch(url); if (!r.ok) throw new Error(String(r.status));
    const tiff = await GeoTIFF.fromArrayBuffer(await r.arrayBuffer()), img = await tiff.getImage();
    const [R, G, B] = await img.readRasters({ samples: [0, 1, 2] }), w = img.getWidth(), h = img.getHeight();
    const c = el("canvas", { width: w, height: h }), ctx = c.getContext("2d"), d = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { d.data[4 * i] = R[i] * 0.085; d.data[4 * i + 1] = G[i] * 0.085; d.data[4 * i + 2] = B[i] * 0.085; d.data[4 * i + 3] = 255; }
    ctx.putImageData(d, 0, 0);
    const big = el("canvas", { width: w * 4, height: h * 4 }), bctx = big.getContext("2d");      // enlarged 4 times without smoothing: same size as the 2.5 m images
    bctx.imageSmoothingEnabled = false; bctx.drawImage(c, 0, 0, w * 4, h * 4);
    if (!current || current.id !== id) return;
    corsOk = true; layers.s2 = c.toDataURL("image/png"); s2Download = big.toDataURL("image/png");
    fillView(); fillFiles(current.info);
  } catch (e) { /* the file store does not allow it, or the file could not be read: the page works without */ }
}
function fillView() {
  const ids = ["s2", "1", "2"].filter(k => layers[k]), l = $("vL"), r = $("vR");
  const keepL = l.value, keepR = r.value;
  for (const s of [l, r]) s.replaceChildren(...ids.map(k => el("option", { value: k, text: LAYER[k] })));
  const best = ids.includes("2") ? "2" : "1", other = ids.includes("s2") ? "s2" : ids.includes("1") ? "1" : best;
  l.value = touchedView && ids.includes(keepL) ? keepL : other;
  r.value = touchedView && ids.includes(keepR) ? keepR : best;
  drawView();
}
function drawView() {
  const l = $("vL").value, r = $("vR").value;
  for (const [img, k] of [[$("vLeft"), l], [$("vRight"), r]]) {
    if (img.dataset.k !== k || img.dataset.src !== layers[k]) { img.src = layers[k] || ""; img.dataset.k = k; img.dataset.src = layers[k] || ""; }
    img.classList.toggle("px", k === "s2"); img.alt = LAYER[k] || "";
  }
  const names = l === r ? `${LAYER[l]}.` : `Left of the line: ${LAYER[l]}. Right of the line: ${LAYER[r]}. Move the slider to compare.`;
  $("vNote").textContent = names + (layers.s2 ? "" : " The Sentinel-2 input is in lr_reference.tif (see the files below).");
  placeLine();
}
function placeLine() {
  const v = $("viewer"), c = $("vCanvas"), single = $("vL").value === $("vR").value;
  const x = single ? c.clientWidth : Math.min(c.clientWidth, v.scrollLeft + ($("vSplit").value / 100) * v.clientWidth);
  $("vLeft").style.clipPath = `inset(0 ${Math.max(c.clientWidth - x, 0)}px 0 0)`;
  $("vHandle").style.left = x + "px"; $("vHandle").hidden = single; $("vSplit").hidden = single;
}
$("vL").onchange = $("vR").onchange = () => { touchedView = true; drawView(); };
$("vSplit").oninput = placeLine; $("viewer").addEventListener("scroll", placeLine); window.addEventListener("resize", placeLine);
$("vRight").addEventListener("load", placeLine);
for (const b of document.querySelectorAll("[data-zoom]")) b.onclick = () => {
  const v = $("viewer"), cx = (v.scrollLeft + v.clientWidth / 2) / v.scrollWidth, cy = (v.scrollTop + v.clientHeight / 2) / v.scrollHeight;
  zoom = Number(b.dataset.zoom); $("vCanvas").style.width = zoom * 100 + "%";
  for (const o of document.querySelectorAll("[data-zoom]")) o.setAttribute("aria-pressed", String(o === b));
  v.scrollLeft = cx * v.scrollWidth - v.clientWidth / 2; v.scrollTop = cy * v.scrollHeight - v.clientHeight / 2; placeLine();
};

function fileName(info, what) {
  const base = (labelOf(info.id) || "image").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "image";
  return `${base}_${info.params.target_date}_${what}`;
}
async function saveAs(url, name, button) {      // only used when the file store lets the browser read the file
  const old = button.textContent; button.textContent = "Downloading…";
  try { const blob = await (await fetch(url)).blob(), a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
  catch (e) { window.open(url, "_blank", "noopener"); }
  button.textContent = old;
}
function fillFiles(info) {
  const f = current.files || {}, png = [];
  const row = (title, sub, ...buttons) => el("div", { class: "file" }, el("span", { class: "what" }, el("b", { text: title }), sub ? el("small", { text: sub }) : null), el("span", { class: "row" }, ...buttons));
  const link = (url, name, text) => {
    const a = el("a", { class: "btn small-btn", href: url, target: "_blank", rel: "noopener", download: name, text: text || "Download" });
    if (corsOk && !url.startsWith("data:")) a.addEventListener("click", e => { e.preventDefault(); saveAs(url, name, a); });
    return a;
  };
  for (const [k, file, what] of [["2", "stage2_preview.png", "stage2"], ["1", "stage1_preview.png", "stage1"]])
    if (f[file]) png.push(row(LAYER[k], null, link(f[file], fileName(info, what) + ".png")));
  if (s2Download) png.push(row(LAYER.s2, "enlarged to the same size, pixels kept", el("a", { class: "btn small-btn", href: s2Download, download: fileName(info, "sentinel2") + ".png", text: "Download" })));
  if (!corsOk && png.length) png.push(el("p", { class: "small", text: "The picture opens in a new tab: right-click it (or press and hold on a phone) and choose “Save image”." }));
  $("fPng").replaceChildren(...png);
  $("fTif").replaceChildren(...FILES.filter(([name]) => f[name]).map(([name, what]) => row(name, what,
    link(f[name], name), el("button", { type: "button", class: "small-btn", text: "Copy link", onclick: e => copyText(f[name], e.currentTarget) }))));
  const best = f["stage2_sr.tif"] ? "stage2_sr.tif" : "stage1_sr.tif";
  const code = k => `%pip install -q "sr-client[geo,viz] @ git+https://github.com/adb-sr/sr-client@v0.1.0"\nfrom sr_client import SRClient\n\nsr = SRClient("${k}", url="${API}")\njob = sr.job("${info.id}")\njob.show()                          # the pictures\nimage = job.open("${best}")   # xarray, reflectance 0 to 1\njob.download("results/")            # every file`;
  $("fCode").textContent = code("YOUR_KEY");
  $("fCopy").onclick = e => copyText(code(key), e.currentTarget);
}

// ---------------------------------------------------------------- my images
async function listJobs() {
  let jobs;
  try { jobs = (await api("GET", "/v1/jobs?limit=30")).jobs; } catch (e) { return; }
  if (!jobs.length) { $("mList").replaceChildren(el("p", { class: "small", text: "No images yet. Your images are listed here, and stay available for 30 days." })); return; }
  $("mList").replaceChildren(...jobs.map(j => el("div", { class: "jobrow" + (current && current.id === j.id ? " current" : ""), dataset: { id: j.id } },
    el("span", { class: "what" }, el("b", { text: labelOf(j.id) || "Image of " + niceDate(j.target_date) }),
      el("small", { text: `${niceDate(j.target_date)} · ${j.stages.length > 1 ? "stage 1 and 2" : "stage 1"} · made ${new Date(j.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` })),
    el("span", { class: "chip " + j.status, text: STATUS[j.status] || j.status }),
    el("button", { type: "button", class: "small-btn", text: "Open", onclick: async () => { await openJob(j.id); $("job").scrollIntoView({ behavior: "smooth", block: "start" }); } }))));
}
$("mRefresh").onclick = listJobs;

// ---------------------------------------------------------------- start
syncStrength();
if (key) enter().catch(e => { if (key) { $("cErr").textContent = e.message; $("cErr").hidden = false; } });
