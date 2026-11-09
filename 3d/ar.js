// AR-Ansicht (Beta): das Möbel 1:1 im echten Raum zeigen – WebXR «immersive-ar» mit Bodenerkennung (hit-test).
// Läuft auf Android mit Chrome und «Google Play-Dienste für AR» (ARCore). iPhone/Safari kann WebXR-AR (noch) nicht.
// Wird von der 3D-Seite als ../ar.js geladen (nur nach Beta-Anmeldung), braucht window.V3D aus dem Viewer.
// Modell: Meter, y nach oben, Boden = 0, Mitte des Möbels im Ursprung → wird auf den angetippten Bodenpunkt gesetzt.
(function(){
'use strict';
let V, T, sess = null, hitSrc = null, reticle = null, root = null, overlay = null, karte = null;
let placed = false, yaw = 0, scale = 1, bestandAn = false, vorher = null;
// Ausrichten mit 2 Punkten: modellPkt = zwei im 3D gewählte Punkte (Modell-Koordinaten), raumPkt = dieselben im Raum angetippt
let modus = 'frei', modellPkt = null, raumPkt = [], marken = [], pruef = '', vorMarken = [];
let raumBoden = Infinity, bodenY = 0, schritt = 0.01, versatz = {x:0, y:0, z:0}, fein = false;   // Fertigboden im Modell (m), Feinschieben in Metern
// Fertigboden im Modell: Oberkante des grössten flachen Bestand-Bodens, sonst Unterkante des Möbels
// (die DWG muss den Boden nicht auf Höhe 0 haben – sonst schwebt das Möbel in AR)
// weicher Schatten unter dem Möbel: ohne Bodenkontakt wirkt ein AR-Objekt, als würde es schweben
function schattenBauen(){
  const box = new T.Box3();
  V.P.forEach(p => { if (!p.k || p.k === 'nl') box.union(new T.Box3().setFromObject(V.meshes[p.i])); });
  if (box.isEmpty()) return null;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(0.7, 'rgba(0,0,0,0.3)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const gr = box.getSize(new T.Vector3()), m = box.getCenter(new T.Vector3());
  const s = new T.Mesh(new T.PlaneGeometry(gr.x + 0.3, gr.z + 0.3).rotateX(-Math.PI / 2),
    new T.MeshBasicMaterial({map: new T.CanvasTexture(c), transparent: true, depthWrite: false}));
  s.position.set(m.x, bodenY + 0.002, m.z); s.renderOrder = -1;
  return s;
}
function bodenErmitteln(){
  // flache Bestand-Teile: die grossen (≥ 50 % der grössten Fläche) – davon das tiefste. Sonst würde die gleich grosse Decke gewinnen.
  const flach = []; let minM = Infinity;
  V.P.forEach(p => {
    const b = new T.Box3().setFromObject(V.meshes[p.i]); if (b.isEmpty()) return;
    const g = b.getSize(new T.Vector3());
    if (p.k === 'bst') { if (g.y < 0.2) flach.push({f: g.x * g.z, top: b.max.y}); }
    else if (!p.k || p.k === 'nl') minM = Math.min(minM, b.min.y);
  });
  if (flach.length) { const fmax = Math.max(...flach.map(x => x.f)); return Math.min(...flach.filter(x => x.f >= fmax * 0.5).map(x => x.top)); }
  return isFinite(minM) ? minM : 0;
}
const ROT = 0xE5484D, ORANGE = 0xF5A524;
function vorMarkenWeg(){ vorMarken.forEach(k => k.parent && k.parent.remove(k)); vorMarken = []; }


const css = `
#arkarte{position:fixed;left:12px;right:12px;bottom:12px;z-index:60;background:var(--surface);color:var(--ink);border:1px solid var(--line);
  border-radius:16px;box-shadow:var(--shadow);padding:16px;font-family:var(--font)}
#arkarte h2{margin:0 0 6px;font-size:19px}#arkarte p{margin:6px 0;font-size:15px;line-height:1.4}
#arkarte .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}#arkarte .acts button{flex:1}
#arkarte button,#arov button{min-height:48px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--ink);
  font:600 16px var(--font);padding:0 14px;cursor:pointer}
#arkarte .kp,#arov .kp{background:var(--accent);border-color:var(--accent);color:#fff}
#arov{position:fixed;inset:0;z-index:2147483647;font-family:var(--font,system-ui);pointer-events:none}
#arov [hidden]{display:none !important}
#arov .oben{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:8px;align-items:center;pointer-events:auto}
#arov .info{flex:1;background:rgba(0,0,0,.6);color:#fff;border-radius:12px;padding:10px 12px;font-size:15px}
#arov .unten{position:absolute;bottom:16px;left:12px;right:12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;pointer-events:auto}
#arov button{background:rgba(255,255,255,.92);color:#1B2329;border:0}
#arov .feinpad{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;width:100%}
#arov .feinpad button{min-height:44px;font-size:15px;padding:0 6px}
#arov button[aria-pressed="true"]{background:#1C5FD1;color:#fff}
#arhinweis{position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 70px);z-index:61;background:var(--accent);color:#fff;
  border-radius:12px;padding:12px 14px;font:600 16px var(--font);display:flex;gap:10px;align-items:center}
#arhinweis span{flex:1}#arhinweis button{min-height:40px;border-radius:10px;border:0;background:#fff;color:#1B2329;font:600 15px var(--font);padding:0 12px}
`;
function stil(){ if (document.getElementById('arstil')) return; const s = document.createElement('style'); s.id = 'arstil'; s.textContent = css; document.head.appendChild(s); }

async function kannAR(){
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch(e){ return false; }
}
function schliesseKarte(){ if (karte) { karte.remove(); karte = null; } if (!sess) vorMarkenWeg(); if (location.hash === '#ar') history.replaceState(null, '', location.pathname + location.search); }

async function start(v3d){
  V = v3d; T = V.THREE; stil(); schliesseKarte();
  karte = document.createElement('section'); karte.id = 'arkarte'; karte.setAttribute('aria-label', 'AR-Ansicht');
  karte.addEventListener('click', ev => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'zu') return schliesseKarte();
    if (a.dataset.a === 'punkte') return punkteWaehlen();
    if (a.dataset.a === 'ar2') { modus = 'punkte'; return beginnen(1); }
    modus = 'frei'; beginnen(a.dataset.a === '20' ? 1/20 : 1);
  });
  const knoepfe = `<div class="acts"><button class="kp" data-a="punkte">Genau: mit 2 Punkten ausrichten</button></div>
    <div class="acts"><button data-a="1">Frei platzieren 1:1</button><button data-a="20">Tischmodell 1:20</button><button data-a="zu">Schliessen</button></div>`;
  const anleitung = `<p><b>Genau:</b> zuerst im 3D zwei Punkte am Boden wählen (z. B. Wandecke unten, Stützenecke unten), dann im Raum dieselben Punkte antippen.</p>
       <p><b>Frei:</b> Ring auf dem Boden antippen, mit ↺ ↻ drehen. Der Bestand (Wände) ist in AR ausgeblendet – der echte Raum ist ja da.</p>`;
  // sofort zeigen – die Prüfung «kann das Gerät AR?» dauert auf Android manchmal lange (ARCore wird geprüft) oder antwortet nie
  karte.innerHTML = `<h2>Im Raum anzeigen (Beta)</h2><p id="arstatus">Prüfe, ob dieses Gerät AR kann …</p>` + anleitung + knoepfe;
  document.body.appendChild(karte);
  if (!navigator.xr) { zeigeNichtMoeglich(); return; }
  const ok = await Promise.race([kannAR(), new Promise(r => setTimeout(() => r('unklar'), 4000))]);
  if (!karte) return;
  const st = karte.querySelector('#arstatus');
  if (ok === true) st.textContent = 'AR ist auf diesem Gerät verfügbar.';
  else if (ok === 'unklar') st.textContent = 'Das Gerät antwortet nicht eindeutig – einfach «AR starten» versuchen.';
  else st.innerHTML = 'Chrome meldet: AR nicht verfügbar. Prüfen: App «Google Play-Dienste für AR» installiert/aktuell? Du kannst es trotzdem versuchen.';
}
function zeigeNichtMoeglich(){
  karte.innerHTML = `<h2>AR auf diesem Gerät nicht möglich</h2>
       <p>Die AR-Ansicht braucht <b>Chrome auf Android</b> mit der App «Google Play-Dienste für AR» (ARCore).
       Auf dem iPhone geht es im Browser noch nicht.</p>
       <div class="acts"><button data-a="zu">Schliessen</button></div>`;
}

// ---------- Schritt 1: zwei Punkte im 3D wählen (Messen-Werkzeug, rastet an Ecken ein) ----------
function hinweis(text, abbrechen){
  let h = document.getElementById('arhinweis');
  if (!text) { if (h) h.remove(); return; }
  if (!h) { h = document.createElement('div'); h.id = 'arhinweis'; h.setAttribute('role', 'status'); document.body.appendChild(h); }
  h.innerHTML = `<span>${text}</span>` + (abbrechen ? '<button type="button">Abbrechen</button>' : '');
  const b = h.querySelector('button'); if (b) b.onclick = () => { V.onMeasure = null; V.setMeasure(false); hinweis(null); };
}
function punkteWaehlen(){
  schliesseKarte();
  V.setMeasure(true);
  hinweis('Im 3D Punkt 1 und Punkt 2 am Boden antippen – z. B. Wandecke unten und Stützenecke unten. Weit auseinander = genauer.', true);
  V.onMeasure = (a, b) => {
    V.onMeasure = null; V.setMeasure(false); hinweis(null);
    modellPkt = [a.clone(), b.clone()];
    vorMarkenWeg();
    modellPkt.forEach((p, i) => { const k = kugel(i ? ORANGE : ROT); k.scale.setScalar(7); k.position.copy(p); V.scene.add(k); vorMarken.push(k); });
    const d = Math.hypot(b.x - a.x, b.z - a.z) * 1000;
    karte = document.createElement('section'); karte.id = 'arkarte'; karte.setAttribute('aria-label', 'AR ausrichten');
    karte.innerHTML = `<h2>Punkte gemerkt</h2>
      <p>Abstand der Punkte im Modell: <b>${Math.round(d)} mm</b>${d < 1000 ? ' – lieber weiter auseinander wählen (über 1 m), dann wird es genauer.' : ''}</p>
      <p>Im 3D markiert: <b style="color:#E5484D">Punkt 1 rot</b>, <b style="color:#C27803">Punkt 2 orange</b>. Merke dir die Stellen.</p>
      <p>Jetzt AR starten und im Raum <b>zuerst Punkt 1, dann Punkt 2</b> am Boden antippen (Ring genau auf die Ecke).</p>
      <div class="acts"><button class="kp" data-a="ar2">AR starten</button><button data-a="punkte">Punkte neu wählen</button><button data-a="zu">Abbrechen</button></div>`;
    karte.addEventListener('click', ev => {
      const x = ev.target.closest('[data-a]'); if (!x) return;
      if (x.dataset.a === 'zu') { modellPkt = null; return schliesseKarte(); }
      if (x.dataset.a === 'punkte') { vorMarkenWeg(); return punkteWaehlen(); }
      modus = 'punkte'; beginnen(1);
    });
    document.body.appendChild(karte);
  };
}
// Winkel eines Vektors in der Bodenebene so, dass rotation.y = θ ihn um θ dreht (three.js: x' = x cos + z sin, z' = −x sin + z cos)
const winkel = v => Math.atan2(-v.z, v.x);
function ausrichten(){
  const [a, b] = modellPkt, [A, B] = raumPkt;
  const m = new T.Vector3(b.x - a.x, 0, b.z - a.z), r = new T.Vector3(B.x - A.x, 0, B.z - A.z);
  yaw = winkel(r) - winkel(m);
  root.rotation.set(0, yaw, 0);
  const mitteM = new T.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2).applyAxisAngle(new T.Vector3(0, 1, 0), yaw);
  root.position.set((A.x + B.x) / 2 - mitteM.x, (A.y + B.y) / 2 - bodenY, (A.z + B.z) / 2 - mitteM.z);   // Fertigboden des Modells auf den Raumboden
  root.visible = true; placed = true; reticle.visible = false;
  const dm = m.length() * 1000, dr = r.length() * 1000, diff = Math.round(dr - dm);
  pruef = `Abstand Modell ${Math.round(dm)} mm, Raum ${Math.round(dr)} mm (${diff > 0 ? '+' : ''}${diff})` + (Math.abs(diff) > 50 ? ' – Punkte prüfen!' : '');
  // Kontrollpunkte im Modell anzeigen (sollen auf den angetippten Stellen liegen)
  modellPkt.forEach((p, i) => { const k = kugel(i ? ORANGE : ROT); k.scale.setScalar(.7); k.position.copy(p).setY(bodenY); root.add(k); marken.push(k); });
}
function kugel(farbe){ const k = new T.Mesh(new T.SphereGeometry(0.03, 16, 10), new T.MeshBasicMaterial({color:farbe, depthTest:false})); k.renderOrder = 999; return k; }

function bauOverlay(){
  overlay = document.createElement('div'); overlay.id = 'arov';
  overlay.innerHTML = `<div class="oben"><div class="info" id="arinfo">Boden suchen …</div><button data-a="ende" aria-label="AR beenden">Beenden</button></div>
    <div class="unten">
      <div class="feinpad" id="arfein" hidden>
        <button data-s="links" aria-label="nach links schieben">◀ links</button><button data-s="weg" aria-label="von mir weg schieben">▲ weg</button>
        <button data-s="her" aria-label="zu mir her schieben">▼ her</button><button data-s="rechts" aria-label="nach rechts schieben">rechts ▶</button>
        <button data-s="tiefer" aria-label="tiefer setzen">Höhe −</button><button data-s="hoeher" aria-label="höher setzen">Höhe +</button>
        <button data-a="schritt" id="arschritt">Schritt 1 cm</button><button data-a="null" aria-label="Verschiebung zurücksetzen">↺ 0</button>
      </div>
      <button data-a="l15" aria-label="15 Grad nach links drehen">↺ 15°</button><button data-a="l1" aria-label="1 Grad nach links drehen">↺ 1°</button>
      <button data-a="r1" aria-label="1 Grad nach rechts drehen">↻ 1°</button><button data-a="r15" aria-label="15 Grad nach rechts drehen">↻ 15°</button>
      <button data-a="fein" id="arfeinbtn" aria-pressed="false">Feinschieben</button>
      <button data-a="neu">Neu platzieren</button><button data-a="bst" id="arbst">Bestand zeigen</button></div>`;
  overlay.addEventListener('beforexrselect', ev => ev.preventDefault());   // Knöpfe lösen kein Platzieren aus
  overlay.addEventListener('click', ev => {
    const sb = ev.target.closest('[data-s]'); if (sb) return schieben(sb.dataset.s);
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'fein') { fein = !fein; a.setAttribute('aria-pressed', String(fein)); overlay.querySelector('#arfein').hidden = !fein; return; }
    if (a.dataset.a === 'schritt') { schritt = schritt === 0.01 ? 0.1 : 0.01; a.textContent = 'Schritt ' + Math.round(schritt * 100) + ' cm'; return; }
    if (a.dataset.a === 'null') { root.position.x -= versatz.x; root.position.y -= versatz.y; root.position.z -= versatz.z; versatz = {x:0, y:0, z:0}; return info(); }
    const d = {l15:15, l1:1, r1:-1, r15:-15}[a.dataset.a];
    if (d) { yaw += d * Math.PI / 180; root.rotation.y = yaw; return info(); }
    if (a.dataset.a === 'neu') { placed = false; root.visible = false; raumPkt = []; versatz = {x:0, y:0, z:0}; marken.forEach(k => k.parent && k.parent.remove(k)); marken = []; pruef = ''; return info(); }
    if (a.dataset.a === 'bst') { bestandAn = !bestandAn; zeigeBestand(); a.textContent = bestandAn ? 'Bestand ausblenden' : 'Bestand zeigen'; return; }
    if (a.dataset.a === 'ende') sess && sess.end();
  });
  document.body.appendChild(overlay);
}
// Feinschieben: links/rechts/weg/her aus Sicht der Kamera (waagrecht), Höhe senkrecht
function schieben(w){
  if (!placed || !root) return;
  if (w === 'hoeher' || w === 'tiefer') { const d = w === 'hoeher' ? schritt : -schritt; root.position.y += d; versatz.y += d; return info(); }
  const cam = V.renderer.xr.getCamera(V.camera), e = cam.matrixWorld.elements;
  const vor = new T.Vector3(-e[8], 0, -e[10]); if (vor.lengthSq() < 1e-6) vor.set(0, 0, -1); vor.normalize();
  const rechts = new T.Vector3(-vor.z, 0, vor.x);
  const d = {links: rechts.clone().multiplyScalar(-schritt), rechts: rechts.clone().multiplyScalar(schritt),
             weg: vor.clone().multiplyScalar(schritt), her: vor.clone().multiplyScalar(-schritt)}[w];
  root.position.add(d); versatz.x += d.x; versatz.z += d.z; info();
}
function versatzText(){
  const cm = v => Math.round(v * 100);
  const h = cm(Math.hypot(versatz.x, versatz.z)), z = cm(versatz.y);
  return (h || z) ? ` · geschoben ${h} cm${z ? ', Höhe ' + (z > 0 ? '+' : '') + z + ' cm' : ''}` : '';
}
function info(){
  const el = document.getElementById('arinfo'); if (!el) return;
  const m = scale === 1 ? '1:1' : '1:20';
  if (!placed && !(reticle && reticle.visible)) { el.textContent = 'Boden suchen – Handy langsam bewegen …'; return; }
  if (!placed && modus === 'punkte') { el.textContent = raumPkt.length ? 'Jetzt Punkt 2 im Raum antippen' : 'Punkt 1 im Raum antippen (Ring genau auf die Ecke)'; return; }
  el.textContent = placed ? (pruef ? 'Ausgerichtet · ' + pruef : `Massstab ${m} · gedreht ${Math.round(yaw * 180 / Math.PI)}°`) + versatzText() : 'Ring antippen zum Platzieren';
}
function zeigeBestand(){
  V.P.forEach(p => { if (p.k === 'bst') { V.meshes[p.i].visible = bestandAn; if (V.edges) V.edges[p.i].visible = bestandAn; } });
}

async function beginnen(s){
  schliesseKarte(); scale = s; placed = false; yaw = 0; bestandAn = false; raumPkt = []; marken = []; pruef = ''; versatz = {x:0, y:0, z:0}; fein = false;
  bodenY = bodenErmitteln(); raumBoden = Infinity;
  if (modus === 'punkte' && !modellPkt) modus = 'frei';
  vorMarkenWeg();
  bauOverlay();
  // alles andere der 3D-Seite (Liste, Knopfleiste, Etikett) während AR ausblenden – es lag über den AR-Knöpfen
  vorher = {versteckt: Array.from(document.body.children).filter(e => e !== overlay && e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE' && !e.contains(V.renderer.domElement))
    .map(e => [e, e.style.visibility])};
  vorher.versteckt.forEach(([e]) => { e.style.visibility = 'hidden'; });
  try {
    sess = await navigator.xr.requestSession('immersive-ar', {requiredFeatures:['hit-test'], optionalFeatures:['dom-overlay'], domOverlay:{root:overlay}});
  } catch(e) {
    overlay.remove(); overlay = null; vorher.versteckt.forEach(([el, v]) => { el.style.visibility = v; });
    alert('AR konnte nicht gestartet werden: ' + (e && e.message || e)); return;
  }
  const scene = V.scene, r = V.renderer;
  V.setPause(true);
  // alles Modell (ausser Licht) in eine Gruppe, die im Raum platziert wird
  root = new T.Group(); root.visible = false;
  const kinder = scene.children.filter(o => !o.isLight);
  vorher = {versteckt: vorher.versteckt, kinder, gridSichtbar: V.grid ? V.grid.visible : null, bst: V.P.filter(p => p.k === 'bst').map(p => [p.i, V.meshes[p.i].visible])};
  kinder.forEach(o => root.add(o));
  const schatten = schattenBauen(); if (schatten) { root.add(schatten); vorher.schatten = schatten; }
  root.scale.setScalar(scale); scene.add(root);
  if (V.grid) V.grid.visible = false;
  zeigeBestand();
  reticle = new T.Mesh(new T.RingGeometry(0.12, 0.17, 40).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({color:0xffffff}));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

  r.xr.enabled = true; r.xr.setReferenceSpaceType('local');
  await r.xr.setSession(sess);
  const viewer = await sess.requestReferenceSpace('viewer');
  hitSrc = await sess.requestHitTestSource({space:viewer});
  sess.addEventListener('select', () => {
    if (placed || !reticle.visible) return;
    const p = new T.Vector3().setFromMatrixPosition(reticle.matrix);
    if (modus === 'punkte') {
      raumPkt.push(p); const k = kugel(raumPkt.length === 1 ? ROT : ORANGE); k.position.copy(p); scene.add(k); marken.push(k);
      if (raumPkt.length === 2) {
        if (Math.hypot(raumPkt[1].x - raumPkt[0].x, raumPkt[1].z - raumPkt[0].z) < 0.2) {   // zu nah beieinander → Richtung unbestimmt
          const k = marken.pop(); if (k && k.parent) k.parent.remove(k); raumPkt.pop();
          const el = document.getElementById('arinfo'); if (el) el.textContent = 'Punkt 2 liegt zu nah an Punkt 1 – bitte Punkt 2 nochmals antippen';
          return;
        }
        ausrichten();
      }
      return info();
    }
    root.position.set(p.x, p.y - bodenY * scale, p.z); root.rotation.y = yaw; root.visible = true; placed = true; reticle.visible = false; info();
  });
  sess.addEventListener('end', ende);
  r.setAnimationLoop((t, frame) => {
    if (frame && hitSrc && !placed) {
      const res = frame.getHitTestResults(hitSrc);
      const war = reticle.visible;
      // nur waagrechte Flächen (Boden): ARCore meldet auch Wände – dort sass der Ring ~1 m hoch (Schiebetüre)
      let pose = null;
      for (const h of res) {
        const p = h.getPose(r.xr.getReferenceSpace()); if (!p) continue;
        const m = p.transform.matrix;            // Spalte 1 = Flächennormale (y-Achse der Trefferpose)
        if (m[5] <= 0.9) continue;
        raumBoden = Math.min(raumBoden, m[13]);   // tiefste erkannte waagrechte Fläche = Boden
        if (m[13] > raumBoden + 0.25) continue;   // Tisch, Podest, Sims … überspringen
        pose = p; break;
      }
      reticle.visible = !!pose; if (pose) reticle.matrix.fromArray(pose.transform.matrix);
      if (war !== reticle.visible) info();
    }
    r.render(scene, V.camera);
  });
  info();
}
function ende(){
  const scene = V.scene, r = V.renderer;
  r.setAnimationLoop(null); r.xr.enabled = false;
  if (hitSrc) { try { hitSrc.cancel(); } catch(e){} hitSrc = null; }
  if (reticle) { scene.remove(reticle); reticle.geometry.dispose(); reticle = null; }
  marken.forEach(k => k.parent && k.parent.remove(k)); marken = []; raumPkt = [];
  if (root) { if (vorher.schatten) { root.remove(vorher.schatten); vorher.schatten.geometry.dispose(); } vorher.kinder.forEach(o => scene.add(o)); scene.remove(root); root = null; }
  if (V.grid && vorher.gridSichtbar != null) V.grid.visible = vorher.gridSichtbar;
  vorher.bst.forEach(([i, sicht]) => { V.meshes[i].visible = sicht; if (V.edges) V.edges[i].visible = sicht; });
  if (overlay) { overlay.remove(); overlay = null; }
  (vorher.versteckt || []).forEach(([el, v]) => { el.style.visibility = v; });
  sess = null; V.setPause(false);
  addEventListener('resize', ()=>{}, {once:true}); dispatchEvent(new Event('resize'));
}
window.AR = {start, _intern:{kannAR, winkel, bodenErmitteln: () => { V = V || window.V3D; T = V.THREE; return bodenErmitteln(); }}};
})();
