// The shared record behind the ideas board and the project board.
//
// Everything people do (add a note, vote, start a project, join) is one line added to the workshop's Google
// Sheet through the same web app as the tracing results (config.js: ENDPOINT, BOARD_SESSION). Nothing is ever
// changed or removed in the sheet: a page reads all lines and replays them. So the boards need no server of
// their own, two people cannot overwrite each other, and a deleted note can be found again in the sheet.
//
// Needs config.js (ENDPOINT, BOARD_SESSION) and site.js (remember).

const DEVICE = (() => {
  let id = remember("ssta-uid");
  if (!id) { id = Math.random().toString(36).slice(2, 10); remember("ssta-uid", id); }
  return id;
})();
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// openLog(session, onChange) -> { add(kind, data), events(), refresh() }
// onChange(events, state) is called whenever the list of events changes; state is "live", "local" or "off".
function openLog(session, onChange) {
  const LOCAL = !ENDPOINT, KEY = "ssta-log-" + session;
  let confirmed = [], pending = [], state = LOCAL ? "local" : "live", lastChange = Date.now(), timer = null, busy = false, sig = "";

  function ordered(rows) {
    // Lines of one device are put in the order that device made them (two quick lines can reach the sheet
    // the other way round); the order between devices is the sheet's.
    const byDev = new Map();
    rows.forEach((r, i) => { if (!byDev.has(r.by)) byDev.set(r.by, []); byDev.get(r.by).push(i); });
    const out = rows.slice();
    for (const idx of byDev.values()) {
      const evs = idx.map(i => rows[i]).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      idx.forEach((i, k) => { out[i] = evs[k]; });
    }
    return out;
  }
  function all() {
    const seen = new Set(), out = [];
    for (const ev of ordered(confirmed).concat(pending.map(p => p.ev))) {
      if (!ev || !ev.e || seen.has(ev.e)) continue;
      seen.add(ev.e); out.push(ev);
    }
    return out;
  }
  function emit(force) {
    const evs = all(), s = evs.length + ":" + (evs.length ? evs[evs.length - 1].e : "") + ":" + pending.length + ":" + state;
    if (!force && s === sig) return;
    sig = s; onChange(evs, state);
  }
  function post(ev) {
    const body = JSON.stringify({ session, id: DEVICE, attempt: 1, plan: ev });
    return fetch(ENDPOINT, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, keepalive: body.length < 60000 })
      .catch(() => {});
  }
  function add(kind, data) {
    const ev = { e: newId(), k: kind, ts: Date.now(), by: DEVICE, ...data };
    lastChange = Date.now();
    if (LOCAL) {
      confirmed.push(ev);
      try { localStorage.setItem(KEY, JSON.stringify(confirmed)); } catch (e) {}
    } else {
      pending.push({ ev, sent: Date.now(), tries: 1 });
      post(ev).then(() => schedule(1200));
    }
    emit();
    return ev;
  }
  async function refresh() {
    if (LOCAL) {
      try { confirmed = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { confirmed = []; }
      emit(); return;
    }
    if (busy) return;
    busy = true;
    const stop = new AbortController(), giveUp = setTimeout(() => stop.abort(), 15000);      // a read that hangs must not block the next ones
    try {
      const r = await fetch(`${ENDPOINT}?session=${encodeURIComponent(session)}&t=${Date.now()}`, { signal: stop.signal });
      const rows = await r.json();
      const next = [];
      for (const row of rows) {
        const ev = row.plan;
        if (!ev || Array.isArray(ev) || typeof ev !== "object" || !ev.e || !ev.k) continue;
        next.push({ ...ev, by: String(row.id || ev.by || ""), t: row.t });
      }
      if (next.length !== confirmed.length) lastChange = Date.now();
      confirmed = next;
      const have = new Set(confirmed.map(ev => ev.e)), now = Date.now();
      pending = pending.filter(p => !have.has(p.ev.e));
      for (const p of pending) {          // a line that did not arrive is sent again (the reader drops doubles)
        if (now - p.sent > 15000 && p.tries < 4) { p.tries += 1; p.sent = now; post(p.ev); }
      }
      state = pending.some(p => p.tries >= 4 && now - p.sent > 15000) ? "off" : "live";
    } catch (e) {
      state = "off";
    } finally {
      clearTimeout(giveUp); busy = false;
    }
    emit();
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (LOCAL) return;
    const idle = Date.now() - lastChange > 180000;
    timer = setTimeout(async () => {
      if (!document.hidden) await refresh();
      schedule();
    }, ms !== undefined ? ms : (idle ? 15000 : 6000) + Math.random() * 2000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(200); });
  window.addEventListener("storage", e => { if (LOCAL && e.key === KEY) refresh(); });
  refresh().then(() => { emit(true); schedule(); });
  return { add, events: all, refresh, unsaved: () => pending.length };
}

// Replay the lines into the boards' content.
const NEW_GROUP = "new";      // the group every note starts in; it cannot be removed
function replay(events) {
  const notes = new Map(), groups = new Map([[NEW_GROUP, { g: NEW_GROUP, title: "New ideas", order: 0 }]]), projects = new Map();
  const note = n => { if (!notes.has(n)) notes.set(n, { n, text: "", color: "yellow", g: NEW_GROUP, name: "", votes: new Set(), made: false, gone: false, ts: 0 }); return notes.get(n); };
  const proj = p => { if (!projects.has(p)) projects.set(p, { p, title: "", what: "", where: "", need: "", link: "", from: "", members: new Map(), made: false, gone: false, ts: 0 }); return projects.get(p); };
  const str = (v, max) => String(v === undefined || v === null ? "" : v).slice(0, max);
  let order = 0;
  for (const ev of events) {
    switch (ev.k) {
      case "note.add": { const x = note(ev.n); x.made = true; x.ts = ev.ts || 0; x.order = ++order; x.text = str(ev.text, 400); x.name = str(ev.name, 60);
        if (ev.color) x.color = str(ev.color, 12); if (ev.g) x.g = str(ev.g, 30); break; }
      case "note.edit": { const x = note(ev.n); if ("text" in ev) x.text = str(ev.text, 400); if ("color" in ev) x.color = str(ev.color, 12);
        if ("g" in ev) x.g = str(ev.g, 30); if ("name" in ev) x.name = str(ev.name, 60); break; }
      case "note.del": note(ev.n).gone = true; break;
      case "note.vote": { const x = note(ev.n); if (ev.on) x.votes.add(ev.by); else x.votes.delete(ev.by); break; }
      case "group.add": if (ev.g !== NEW_GROUP) groups.set(ev.g, { g: ev.g, title: str(ev.title, 60) || "Group", order: ++order }); break;
      case "group.edit": if (groups.has(ev.g)) groups.get(ev.g).title = str(ev.title, 60) || groups.get(ev.g).title; break;
      case "group.del": if (ev.g !== NEW_GROUP) groups.delete(ev.g); break;
      case "proj.add": case "proj.edit": { const x = proj(ev.p);
        if (ev.k === "proj.add") { x.made = true; x.ts = ev.ts || 0; x.order = ++order; x.from = str(ev.from, 30); }
        for (const [f, max] of [["title", 120], ["what", 1200], ["where", 300], ["need", 600], ["link", 500]]) if (f in ev) x[f] = str(ev[f], max);
        break; }
      case "proj.del": proj(ev.p).gone = true; break;
      case "proj.join": proj(ev.p).members.set(str(ev.m, 30), { m: str(ev.m, 30), name: str(ev.name, 80), org: str(ev.org, 120), by: ev.by }); break;
      case "proj.leave": proj(ev.p).members.delete(str(ev.m, 30)); break;
    }
  }
  const liveNotes = [...notes.values()].filter(x => x.made && !x.gone);
  for (const x of liveNotes) if (!groups.has(x.g)) x.g = NEW_GROUP;      // its group was removed
  const liveProjects = [...projects.values()].filter(x => x.made && !x.gone);
  const projectOfNote = new Map(liveProjects.filter(p => p.from).map(p => [p.from, p]));
  return { notes: liveNotes, groups: [...groups.values()].sort((a, b) => a.order - b.order), projects: liveProjects, projectOfNote };
}
