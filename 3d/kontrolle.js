// Baustellen-Kontrolle für die Planung (Projektleiter auf der Baustelle).
// Wird von der 3D-Seite (viewer/template.html) als ../kontrolle.js geladen – nur auf Planungs-Geräten
// (localStorage «upload-schluessel» vorhanden). Braucht window.V3D aus dem Viewer.
//
// Kontrollmasse: automatisch aus der Pipeline (D.kontrolle: Bestand ↔ Positionen, Podest, Stützen) – einzeln löschbar –
// plus eigene Masse (zwei Punkte im 3D antippen). Ist-Wert von Hand oder vom Bosch GLM 50 C (Web Bluetooth, Android/Chrome).
// Toleranz: grün ≤ 2 mm, orange ≤ 5 mm, rot darüber.
// Speicherung: sofort im Gerät (localStorage «kontrolle-<nr>»), dazu im privaten Repo (Branch «kontrolle»,
// Datei kontrolle/<nr>.json) über die GitHub-API mit dem Upload-Schlüssel. Zusammenführen je Mass nach Zeitstempel.
(function(){
'use strict';
const TOL_GRUEN = 2, TOL_ORANGE = 5;
const BRANCH = 'kontrolle', API = 'https://api.github.com';
// Bosch GLM 50 C: BLE-Dienst und Merkmal (Bosch-Messgeräte-Protokoll), Befehl «automatisch senden» einschalten
const GLM_SVC = '02a6c0d0-0451-4000-b000-fb3210111989', GLM_CHR = '02a6c0d1-0451-4000-b000-fb3210111989';
const GLM_AUTO = new Uint8Array([0xC0, 0x55, 0x02, 0x01, 0x00, 0x1A]);

const ls = { get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
             set(k, v){ try { localStorage.setItem(k, v); } catch(e){} } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function mm(v){                       // 10 399 bzw. 1,5 (Tausender mit schmalem Abstand, Komma)
  const n = Math.round(Math.abs(+v) * 2) / 2, g = Math.floor(n), r = n - g;
  return (v < 0 ? '−' : '') + String(g).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F') + (r ? ',5' : '');
}
const mmz = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + mm(Math.abs(v));
const jetzt = () => new Date().toISOString();
function stufe(d){ if (d == null) return 'offen'; const a = Math.abs(d); return a <= TOL_GRUEN ? 'gruen' : a <= TOL_ORANGE ? 'orange' : 'rot'; }
const FARBE = {gruen:'#1E7B34', orange:'#C2410C', rot:'#B91C1C', offen:'#6B7680'};

let V, NR, KEY, st, ui = {ansicht:'liste', filter:'alle', sel:null, geloeschte:false}, linien = null, glm = {dev:null, ch:null, wert:null, status:'aus'};
let syncT = 0, syncStatus = '';

// ---------- Daten ----------
function leer(){ return {v:1, auftrag:NR, masse:{}, eigene:[]}; }
function autoListe(){ return (V.D.kontrolle || []).map(k => Object.assign({}, k, {auto:true}, st.masse[k.id] || {})); }
function alle(){ return autoListe().concat(st.eigene.map(e => Object.assign({auto:false}, e))); }
function sichtbar(){ return alle().filter(m => ui.geloeschte ? m.geloescht : !m.geloescht); }
function delta(m){ return (m.ist == null || m.ist === '') ? null : Math.round((+m.ist - +m.soll) * 2) / 2; }
function finde(id){ return alle().find(m => m.id === id); }
function setze(id, werte){
  const e = st.eigene.find(x => x.id === id);
  if (e) Object.assign(e, werte, {zeit:jetzt()});
  else st.masse[id] = Object.assign({}, st.masse[id] || {}, werte, {zeit:jetzt()});
  speichern();
}
function zusammenfuehren(a, b){            // je Mass gewinnt der neuere Zeitstempel
  const r = leer();
  for (const q of [a, b]) for (const [id, w] of Object.entries((q && q.masse) || {}))
    if (!r.masse[id] || (w.zeit || '') > (r.masse[id].zeit || '')) r.masse[id] = w;
  const e = {};
  for (const q of [a, b]) for (const w of (q && q.eigene) || []) if (!e[w.id] || (w.zeit || '') > (e[w.id].zeit || '')) e[w.id] = w;
  r.eigene = Object.values(e).sort((x, y) => (x.erstellt || '').localeCompare(y.erstellt || ''));
  return r;
}
function lokalLaden(){ try { return JSON.parse(ls.get(KEY) || 'null'); } catch(e){ return null; } }
function speichern(){ ls.set(KEY, JSON.stringify(st)); zeichneLinien(); clearTimeout(syncT); syncT = setTimeout(hochladen, 2500); }

// ---------- GitHub (privates Repo, Branch «kontrolle») ----------
const token = () => ls.get('upload-schluessel'), repo = () => ls.get('planung-repo');
async function gh(method, pfad, body){
  const r = await fetch(API + pfad, {method, headers:Object.assign({'Authorization':'Bearer ' + token(), 'Accept':'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28'}, body ? {'Content-Type':'application/json'} : {}), body: body ? JSON.stringify(body) : undefined});
  if (r.status === 404) return null;
  if (!r.ok) { const t = await r.text().catch(()=> ''); const e = new Error('GitHub ' + r.status); e.status = r.status; e.text = t; throw e; }
  return r.status === 204 ? {} : r.json();
}
const b64enc = s => btoa(unescape(encodeURIComponent(s))), b64dec = s => decodeURIComponent(escape(atob(s.replace(/\s/g, ''))));
const dateiPfad = () => '/repos/' + repo() + '/contents/kontrolle/' + encodeURIComponent(NR) + '.json';
async function fernLaden(){
  if (!token() || !repo()) return null;
  const f = await gh('GET', dateiPfad() + '?ref=' + BRANCH);
  return f ? {sha:f.sha, daten:JSON.parse(b64dec(f.content))} : {sha:null, daten:null};
}
async function branchSicherstellen(){
  if (await gh('GET', '/repos/' + repo() + '/git/ref/heads/' + BRANCH)) return;
  const main = await gh('GET', '/repos/' + repo() + '/git/ref/heads/main');
  await gh('POST', '/repos/' + repo() + '/git/refs', {ref:'refs/heads/' + BRANCH, sha:main.object.sha});
}
let laeuft = false;
async function hochladen(versuch){
  if (!token() || !repo()) { syncStatus = 'Nur auf diesem Gerät gespeichert (kein Upload-Schlüssel).'; zeichne(); return; }
  if (!navigator.onLine) { syncStatus = 'Offline – auf dem Gerät gespeichert, wird später hochgeladen.'; zeichne(); return; }
  if (laeuft) { clearTimeout(syncT); syncT = setTimeout(hochladen, 1500); return; }
  laeuft = true; syncStatus = 'Speichere …'; zeichne();
  try {
    await branchSicherstellen();
    const f = await fernLaden();
    if (f && f.daten) { st = zusammenfuehren(f.daten, st); ls.set(KEY, JSON.stringify(st)); }
    st.gespeichert = jetzt();
    await gh('PUT', dateiPfad(), {message:'Baustellen-Kontrolle ' + NR, content:b64enc(JSON.stringify(st, null, 1)), branch:BRANCH, ...(f && f.sha ? {sha:f.sha} : {})});
    ls.set(KEY, JSON.stringify(st));
    syncStatus = 'Gespeichert für die Planung · ' + new Date().toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit'});
  } catch(e) {
    if ((e.status === 409 || e.status === 422) && !versuch) { laeuft = false; return hochladen(1); }
    syncStatus = e.status === 401 ? 'Upload-Schlüssel ungültig – in der Übersicht neu einfügen. Auf dem Gerät gespeichert.'
               : 'Hochladen fehlgeschlagen (' + (e.status || e.message) + '). Auf dem Gerät gespeichert.';
  }
  laeuft = false; zeichne(); zeichneLinien();
}
addEventListener('online', ()=> { if (st) hochladen(); });

// ---------- Bosch GLM 50 C ----------
const blueOk = () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
async function glmVerbinden(){
  try {
    glm.status = 'suche'; zeichne();
    const dev = await navigator.bluetooth.requestDevice({filters:[{namePrefix:'GLM'}, {namePrefix:'Bosch'}], optionalServices:[GLM_SVC]});
    dev.addEventListener('gattserverdisconnected', ()=> { glm.status = 'getrennt'; glm.ch = null; zeichne(); });
    const server = await dev.gatt.connect();
    const svc = await server.getPrimaryService(GLM_SVC);
    const ch = await svc.getCharacteristic(GLM_CHR);
    await ch.startNotifications();
    ch.addEventListener('characteristicvaluechanged', ev => glmWert(ev.target.value));
    await ch.writeValue(GLM_AUTO);                       // Messwerte automatisch senden
    glm.dev = dev; glm.ch = ch; glm.status = 'ok'; zeichne();
  } catch(e) {
    glm.status = e && e.name === 'NotFoundError' ? 'aus' : 'fehler'; glm.fehler = e && e.message; zeichne();
  }
}
// Antwort: C0 55 10 … Distanz als float32 (little endian, Meter) ab Byte 7
function glmWert(dv){
  if (dv.byteLength < 11 || dv.getUint8(0) !== 0xC0 || dv.getUint8(1) !== 0x55 || dv.getUint8(2) !== 0x10) return;
  const m = dv.getFloat32(7, true); if (!(m > 0 && m < 200)) return;
  const wert = Math.round(m * 2000) / 2;               // mm, auf 0,5 gerundet
  glm.wert = {mm:wert, zeit:Date.now()};
  if (ui.ansicht === 'detail' && ui.sel) { setze(ui.sel, {ist:wert, quelle:'GLM 50 C'}); if (navigator.vibrate) navigator.vibrate(60); }
  zeichne();
}

// ---------- 3D-Linien ----------
function zeichneLinien(){
  const T = V.THREE;
  if (!linien) { linien = new T.Group(); linien.renderOrder = 997; V.scene.add(linien); }
  while (linien.children.length) { const c = linien.children.pop(); c.geometry && c.geometry.dispose(); }
  if (!ui.offen) return;
  const kugel = new T.SphereGeometry(0.035, 12, 8);
  for (const m of sichtbar()) {
    const a = new T.Vector3(...m.a), b = new T.Vector3(...m.b), sel = m.id === ui.sel;
    const farbe = sel ? V.css('--accent') : FARBE[stufe(delta(m))];
    const mat = new T.LineBasicMaterial({color:farbe, depthTest:false, transparent:true, opacity: sel ? 1 : .8});
    const l = new T.Line(new T.BufferGeometry().setFromPoints([a, b]), mat); l.renderOrder = sel ? 999 : 997; linien.add(l);
    for (const p of [a, b]) { const k = new T.Mesh(kugel, new T.MeshBasicMaterial({color:farbe, depthTest:false, transparent:true})); k.position.copy(p); k.scale.setScalar(sel ? 1.3 : .8); k.renderOrder = 998; linien.add(k); }
  }
}
function zeigeIm3D(m){
  const T = V.THREE, a = new T.Vector3(...m.a), b = new T.Vector3(...m.b);
  const mid = a.clone().add(b).multiplyScalar(.5), len = a.distanceTo(b);
  const dir = V.camera.position.clone().sub(V.controls.target).normalize();
  V.controls.target.copy(mid); V.camera.position.copy(mid).addScaledVector(dir, Math.max(len * 1.15, 2.2)); V.controls.update();
}

// ---------- Oberfläche ----------
const css = `
#kpanel{position:fixed;left:8px;right:8px;bottom:8px;z-index:40;max-height:54vh;overflow:auto;background:var(--surface);color:var(--ink);
  border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);font-family:var(--font);padding:12px 14px 14px;}
#kpanel h2{margin:0;font-size:18px;flex:1}
#kpanel .kr{display:flex;align-items:center;gap:8px}
#kpanel .ks{font-size:14px;color:color-mix(in srgb,var(--ink) 70%,transparent)}
#kpanel button,#kpanel .kb{min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:600 15px var(--font);padding:0 12px;cursor:pointer}
#kpanel .kp{background:var(--accent);border-color:var(--accent);color:#fff}
#kpanel .kx{width:44px;padding:0;font-size:22px;line-height:1}
#kpanel .seg{display:flex;gap:6px;margin:10px 0}
#kpanel .seg button{flex:1}
#kpanel .seg button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
#kpanel .ki{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px;margin:6px 0;border-radius:12px;min-height:56px;font-weight:400}
#kpanel .ki .kn{flex:1;min-width:0;display:flex;flex-direction:column}
#kpanel .ki .kn b{font-size:15px;font-weight:600}
#kpanel .ki .kn span{font-size:13px;color:color-mix(in srgb,var(--ink) 70%,transparent)}
#kpanel .chip{padding:5px 9px;border-radius:8px;font-weight:700;font-size:14px;white-space:nowrap;color:#fff}
#kpanel .c-gruen{background:#1E7B34}#kpanel .c-orange{background:#C2410C}#kpanel .c-rot{background:#B91C1C}
#kpanel .c-offen{background:transparent;color:var(--ink);border:1px solid var(--line)}
#kpanel .auto{font-size:11px;font-weight:700;letter-spacing:.05em;padding:2px 6px;border-radius:5px;border:1px solid var(--line)}
#kpanel .big{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:10px 0}
#kpanel .big small{display:block;font-size:12px;font-weight:700;letter-spacing:.05em;color:color-mix(in srgb,var(--ink) 65%,transparent)}
#kpanel .big .v{font-size:28px;font-weight:700}
#kpanel input,#kpanel textarea{font:400 17px var(--font);color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 10px;box-sizing:border-box}
#kpanel input.ist{width:150px;font-size:26px;font-weight:700;text-align:right}
#kpanel textarea{width:100%;height:64px;resize:none}
#kpanel .dz{padding:10px 12px;border-radius:10px;font-weight:700;color:#fff;margin:8px 0}
#kpanel .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
#kpanel .acts > *{flex:1}
#kpanel .grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}
#kpanel .grid3 div{border-radius:12px;padding:10px;color:#fff}
#kpanel .grid3 b{display:block;font-size:26px}
#kpanel .glm{font-size:13px;font-weight:600;padding:0 10px}
#kpanel .msg{font-size:13px;margin-top:8px;color:color-mix(in srgb,var(--ink) 70%,transparent)}
`;
function setupDom(){
  if (document.getElementById('kpanel')) return;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  const p = document.createElement('section'); p.id = 'kpanel'; p.setAttribute('aria-label', 'Baustellen-Kontrolle'); p.hidden = true; document.body.appendChild(p);
  p.addEventListener('click', klick); p.addEventListener('input', eingabe); p.addEventListener('change', eingabe);
}
function glmKnopf(){
  if (!blueOk()) return '<span class="ks">Bosch: Bluetooth nur mit Chrome auf Android</span>';
  const t = {aus:'Bosch verbinden', suche:'Suche Bosch …', ok:'GLM 50 C verbunden', getrennt:'Bosch neu verbinden', fehler:'Bosch: Fehler – nochmals'}[glm.status];
  return `<button class="glm${glm.status === 'ok' ? ' kp' : ''}" data-a="glm">${esc(t)}</button>`;
}
function zeile(m){
  const d = delta(m), s = stufe(d);
  return `<button class="ki" data-a="auf" data-id="${esc(m.id)}">
    <span class="kn"><b>${esc(m.n)}</b><span>Soll ${mm(m.soll)}${m.ist != null && m.ist !== '' ? ' · Ist ' + mm(+m.ist) : ' · offen'}${m.auto ? '' : ' · eigenes Mass'}</span></span>
    <span class="chip c-${s}">${d == null ? 'messen' : mmz(d)}</span></button>`;
}
function zeichne(){
  const p = document.getElementById('kpanel'); if (!p || p.hidden) return;
  const L = alle().filter(m => !m.geloescht), n = L.length, g = L.filter(m => delta(m) != null).length;
  const nGel = alle().filter(m => m.geloescht).length;
  if (ui.ansicht === 'liste') {
    let liste = sichtbar();
    if (!ui.geloeschte && ui.filter === 'offen') liste = liste.filter(m => delta(m) == null);
    if (!ui.geloeschte && ui.filter === 'abw') liste = liste.filter(m => ['orange', 'rot'].includes(stufe(delta(m))));
    p.innerHTML = `<div class="kr"><h2>Baustellen-Kontrolle</h2><button class="kx" data-a="zu" aria-label="Kontrolle schliessen">×</button></div>
      <div class="ks">${g} von ${n} gemessen · grün ≤ ${TOL_GRUEN} mm, orange ≤ ${TOL_ORANGE} mm</div>
      <div class="kr" style="margin-top:8px">${glmKnopf()}${glm.wert ? `<span class="ks">Letzter Wert ${mm(glm.wert.mm)} mm</span>` : ''}</div>
      ${ui.geloeschte ? `<div class="kr" style="margin-top:10px"><b style="flex:1">Gelöschte Masse (${nGel})</b><button data-a="gel">Zurück</button></div>`
        : `<div class="seg" role="group" aria-label="Filter"><button data-a="f" data-f="alle" aria-pressed="${ui.filter === 'alle'}">Alle ${n}</button>
        <button data-a="f" data-f="offen" aria-pressed="${ui.filter === 'offen'}">Offen ${n - g}</button>
        <button data-a="f" data-f="abw" aria-pressed="${ui.filter === 'abw'}">Abweichung ${L.filter(m => ['orange', 'rot'].includes(stufe(delta(m)))).length}</button></div>`}
      ${liste.map(zeile).join('') || '<p class="ks">Keine Masse in dieser Auswahl.</p>'}
      <div class="acts"><button data-a="neu">+ Eigenes Mass</button><button class="kp" data-a="bericht">Bericht</button></div>
      ${!ui.geloeschte && nGel ? `<div class="acts"><button data-a="gel">Gelöschte anzeigen (${nGel})</button></div>` : ''}
      <div class="msg">${esc(syncStatus)}</div>`;
  } else if (ui.ansicht === 'detail') {
    const m = finde(ui.sel); if (!m) { ui.ansicht = 'liste'; return zeichne(); }
    const d = delta(m), s = stufe(d);
    p.innerHTML = `<div class="kr"><button class="kx" data-a="liste" aria-label="Zurück zur Liste">‹</button><h2>${esc(m.n)}</h2></div>
      <div class="ks">${m.auto ? 'Automatisch aus dem Entwurf' : 'Eigenes Mass'}${m.pos && m.pos.length ? ' · Pos. ' + m.pos.join(', ') : ''}</div>
      <div class="big"><div><small>SOLL</small>${m.auto ? `<span class="v">${mm(m.soll)}</span>` : `<input class="ist" data-f="soll" inputmode="decimal" value="${esc(mm(m.soll))}" aria-label="Soll in mm">`}</div>
        <div style="text-align:right"><small>IST (mm)</small><input class="ist" data-f="ist" inputmode="decimal" placeholder="– – –" value="${m.ist != null && m.ist !== '' ? esc(mm(+m.ist)) : ''}" aria-label="Ist-Mass in mm"></div></div>
      ${d == null ? `<div class="dz c-offen" style="color:var(--ink)">${glm.status === 'ok' ? 'Am Bosch messen – der Wert erscheint hier.' : 'Ist-Mass eintippen oder Bosch verbinden.'}</div>`
                  : `<div class="dz c-${s}">Abweichung ${mmz(d)} mm · ${{gruen:'in Ordnung', orange:'knapp', rot:'zu gross – klären'}[s]}${m.quelle ? ' · ' + esc(m.quelle) : ''}</div>`}
      <div class="kr">${glmKnopf()}</div>
      <label class="ks" for="knotiz" style="display:block;margin-top:10px">Notiz</label>
      <textarea id="knotiz" data-f="notiz" placeholder="z. B. Wand nicht im Lot, unten 12 mm weniger">${esc(m.notiz || '')}</textarea>
      <div class="acts"><button data-a="zeigen">Im 3D zeigen</button>
        ${m.geloescht ? '<button data-a="wieder">Wiederherstellen</button>' : `<button data-a="loeschen">${m.auto ? 'Aus Liste löschen' : 'Mass löschen'}</button>`}</div>
      <div class="acts"><button data-a="liste">Liste</button><button class="kp" data-a="weiter">Nächstes offenes</button></div>
      <div class="msg">${esc(syncStatus)}</div>`;
  } else {
    const cnt = {gruen:0, orange:0, rot:0}; L.forEach(m => { const s = stufe(delta(m)); if (cnt[s] != null) cnt[s]++; });
    const klaeren = L.filter(m => ['orange', 'rot'].includes(stufe(delta(m))));
    p.innerHTML = `<div class="kr"><button class="kx" data-a="liste" aria-label="Zurück zur Liste">‹</button><h2>Kontrollbericht</h2></div>
      <div class="ks">Auftrag ${esc(NR)} · ${new Date().toLocaleDateString('de-CH')} · ${g} von ${n} gemessen</div>
      <div class="grid3"><div style="background:#1E7B34"><b>${cnt.gruen}</b>bis ${TOL_GRUEN} mm</div><div style="background:#C2410C"><b>${cnt.orange}</b>bis ${TOL_ORANGE} mm</div><div style="background:#B91C1C"><b>${cnt.rot}</b>über ${TOL_ORANGE} mm</div></div>
      <b>Zu klären</b>${klaeren.map(zeile).join('') || '<p class="ks">Keine Abweichungen über 2 mm.</p>'}
      ${n - g ? `<p class="ks">${n - g} Masse noch nicht gemessen.</p>` : ''}
      <div class="acts"><button data-a="teilen">Teilen</button><button data-a="pdf">PDF / Drucken</button><button class="kp" data-a="sync">Speichern</button></div>
      <div class="msg">${esc(syncStatus)}</div>`;
  }
  V.insets && V.insets();
}
function zahl(s){ const v = parseFloat(String(s).replace(/[\s’']/g, '').replace('−', '-').replace(',', '.')); return isFinite(v) ? v : null; }
function eingabe(ev){
  const f = ev.target.dataset.f; if (!f || !ui.sel) return;
  if (f === 'notiz') { if (ev.type === 'change') setze(ui.sel, {notiz:ev.target.value}); return; }
  if (ev.type !== 'change') return;
  const v = ev.target.value.trim() === '' ? null : zahl(ev.target.value);
  setze(ui.sel, f === 'ist' ? {ist:v, quelle:v == null ? null : 'von Hand'} : {soll:v == null ? 0 : v});
  zeichne();
}
function klick(ev){
  const b = ev.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a;
  if (a === 'zu') return schliessen();
  if (a === 'glm') return glmVerbinden();
  if (a === 'f') { ui.filter = b.dataset.f; return zeichne(); }
  if (a === 'gel') { ui.geloeschte = !ui.geloeschte; zeichneLinien(); return zeichne(); }
  if (a === 'auf') { ui.sel = b.dataset.id; ui.ansicht = 'detail'; zeichne(); zeichneLinien(); const m = finde(ui.sel); if (m) zeigeIm3D(m); return; }
  if (a === 'liste') { ui.ansicht = 'liste'; ui.sel = null; zeichneLinien(); return zeichne(); }
  if (a === 'zeigen') { const m = finde(ui.sel); if (m) zeigeIm3D(m); return; }
  if (a === 'loeschen') { const m = finde(ui.sel); if (m && (m.auto || confirm('Eigenes Mass löschen?'))) { setze(ui.sel, {geloescht:true}); ui.ansicht = 'liste'; ui.sel = null; zeichne(); } return; }
  if (a === 'wieder') { setze(ui.sel, {geloescht:false}); return zeichne(); }
  if (a === 'weiter') {
    const L = alle().filter(m => !m.geloescht); const i = L.findIndex(m => m.id === ui.sel);
    const n = L.slice(i + 1).concat(L.slice(0, i)).find(m => delta(m) == null);
    if (n) { ui.sel = n.id; zeichne(); zeichneLinien(); zeigeIm3D(n); } else { ui.ansicht = 'bericht'; ui.sel = null; zeichneLinien(); zeichne(); }
    return;
  }
  if (a === 'neu') return eigenesMass();
  if (a === 'bericht') { ui.ansicht = 'bericht'; ui.sel = null; zeichneLinien(); return zeichne(); }
  if (a === 'sync') return hochladen();
  if (a === 'teilen') return teilen();
  if (a === 'pdf') return drucken();
}
function eigenesMass(){
  const p = document.getElementById('kpanel'); p.hidden = true;
  V.setMeasure(true);
  V.onMeasure = (a, b) => {
    V.onMeasure = null;
    const soll = Math.round(a.distanceTo(b) * 2000) / 2;
    const n = prompt('Name für das Mass (Soll ' + mm(soll) + ' mm):', 'Eigenes Mass ' + (st.eigene.length + 1));
    V.setMeasure(false); p.hidden = false;
    if (n === null) return zeichne();
    const id = 'm' + Date.now().toString(36);
    st.eigene.push({id, n:n.trim() || 'Eigenes Mass', soll, a:[a.x, a.y, a.z].map(v => +v.toFixed(4)), b:[b.x, b.y, b.z].map(v => +v.toFixed(4)), erstellt:jetzt(), zeit:jetzt()});
    speichern(); ui.sel = id; ui.ansicht = 'detail'; zeichne(); zeichneLinien();
  };
}
function berichtText(){
  const L = alle().filter(m => !m.geloescht);
  const z = L.map(m => { const d = delta(m); return `${m.n}: Soll ${mm(m.soll)}, Ist ${d == null ? 'offen' : mm(+m.ist) + ' (' + mmz(d) + ' mm, ' + {gruen:'grün', orange:'orange', rot:'rot'}[stufe(d)] + ')'}${m.notiz ? ' – ' + m.notiz : ''}`; });
  return `Baustellen-Kontrolle Auftrag ${NR}, ${new Date().toLocaleDateString('de-CH')}\n\n` + z.join('\n');
}
function teilen(){
  const t = berichtText();
  if (navigator.share) navigator.share({title:'Kontrolle ' + NR, text:t}).catch(()=>{});
  else if (navigator.clipboard) navigator.clipboard.writeText(t).then(()=> { syncStatus = 'Bericht in die Zwischenablage kopiert.'; zeichne(); });
}
function drucken(){
  const L = alle().filter(m => !m.geloescht);
  const rows = L.map(m => { const d = delta(m), s = stufe(d); return `<tr><td>${esc(m.n)}</td><td>${mm(m.soll)}</td><td>${d == null ? '–' : mm(+m.ist)}</td>
    <td style="color:${FARBE[s]};font-weight:700">${d == null ? 'offen' : mmz(d)}</td><td>${esc(m.notiz || '')}</td></tr>`; }).join('');
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!doctype html><html lang="de"><meta charset="utf-8"><title>Kontrolle ${esc(NR)}</title>
    <style>body{font:14px system-ui,sans-serif;margin:24px;color:#1B2329}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left}th{font-size:12px}</style>
    <h1>Baustellen-Kontrolle – Auftrag ${esc(NR)}</h1><p>${new Date().toLocaleString('de-CH')} · Toleranz grün ≤ ${TOL_GRUEN} mm, orange ≤ ${TOL_ORANGE} mm, rot darüber</p>
    <table><tr><th>Mass</th><th>Soll mm</th><th>Ist mm</th><th>Abweichung</th><th>Notiz</th></tr>${rows}</table>
    <script>setTimeout(()=>print(),300)<\/script></html>`);
  w.document.close();
}

// ---------- Öffnen / Schliessen ----------
async function oeffnen(v3d){
  V = v3d; NR = String(V.AUFTRAG); KEY = 'kontrolle-' + NR;
  if (!st) {
    st = zusammenfuehren(leer(), lokalLaden());
    syncStatus = 'Lade gespeicherte Messungen …';
    fernLaden().then(f => { if (f && f.daten) { st = zusammenfuehren(f.daten, st); ls.set(KEY, JSON.stringify(st)); }
      syncStatus = f ? 'Stand der Planung geladen.' : 'Nur auf diesem Gerät gespeichert (kein Upload-Schlüssel).'; zeichne(); zeichneLinien(); })
      .catch(e => { syncStatus = navigator.onLine ? 'Laden von GitHub fehlgeschlagen (' + (e.status || e.message) + ').' : 'Offline – Stand vom Gerät.'; zeichne(); });
  }
  setupDom(); ui.offen = true;
  document.getElementById('kpanel').hidden = false;
  ['#sheet', '#label'].forEach(s => { const e = document.querySelector(s); if (e) e.style.visibility = 'hidden'; });
  zeichne(); zeichneLinien();
}
function schliessen(){
  ui.offen = false; document.getElementById('kpanel').hidden = true;
  ['#sheet', '#label'].forEach(s => { const e = document.querySelector(s); if (e) e.style.visibility = ''; });
  zeichneLinien(); V.btn && V.btn.setAttribute('aria-pressed', 'false');
  if (location.hash === '#kontrolle') history.replaceState(null, '', location.pathname + location.search);
}
window.Kontrolle = {oeffnen, schliessen, offen: () => !!ui.offen, _intern:{stufe, zusammenfuehren, glmWert}};
})();
