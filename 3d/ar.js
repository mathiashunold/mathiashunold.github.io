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
#arov{position:fixed;inset:0;font-family:var(--font,system-ui);pointer-events:none}
#arov .oben{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:8px;align-items:center;pointer-events:auto}
#arov .info{flex:1;background:rgba(0,0,0,.6);color:#fff;border-radius:12px;padding:10px 12px;font-size:15px}
#arov .unten{position:absolute;bottom:16px;left:12px;right:12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;pointer-events:auto}
#arov button{background:rgba(255,255,255,.92);color:#1B2329;border:0}
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
  root.position.set((A.x + B.x) / 2 - mitteM.x, (A.y + B.y) / 2, (A.z + B.z) / 2 - mitteM.z);   // Modellboden y=0 auf den Raumboden
  root.visible = true; placed = true; reticle.visible = false;
  const dm = m.length() * 1000, dr = r.length() * 1000, diff = Math.round(dr - dm);
  pruef = `Abstand Modell ${Math.round(dm)} mm, Raum ${Math.round(dr)} mm (${diff > 0 ? '+' : ''}${diff})` + (Math.abs(diff) > 50 ? ' – Punkte prüfen!' : '');
  // Kontrollpunkte im Modell anzeigen (sollen auf den angetippten Stellen liegen)
  modellPkt.forEach((p, i) => { const k = kugel(i ? ORANGE : ROT); k.scale.setScalar(.7); k.position.copy(p).setY(0); root.add(k); marken.push(k); });
}
function kugel(farbe){ const k = new T.Mesh(new T.SphereGeometry(0.03, 16, 10), new T.MeshBasicMaterial({color:farbe, depthTest:false})); k.renderOrder = 999; return k; }

function bauOverlay(){
  overlay = document.createElement('div'); overlay.id = 'arov';
  overlay.innerHTML = `<div class="oben"><div class="info" id="arinfo">Boden suchen …</div><button data-a="ende" aria-label="AR beenden">Beenden</button></div>
    <div class="unten"><button data-a="l15" aria-label="15 Grad nach links drehen">↺ 15°</button><button data-a="l1" aria-label="1 Grad nach links drehen">↺ 1°</button>
    <button data-a="r1" aria-label="1 Grad nach rechts drehen">↻ 1°</button><button data-a="r15" aria-label="15 Grad nach rechts drehen">↻ 15°</button>
    <button data-a="neu">Neu platzieren</button><button data-a="bst" id="arbst">Bestand zeigen</button></div>`;
  overlay.addEventListener('beforexrselect', ev => ev.preventDefault());   // Knöpfe lösen kein Platzieren aus
  overlay.addEventListener('click', ev => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    const d = {l15:15, l1:1, r1:-1, r15:-15}[a.dataset.a];
    if (d) { yaw += d * Math.PI / 180; root.rotation.y = yaw; return info(); }
    if (a.dataset.a === 'neu') { placed = false; root.visible = false; raumPkt = []; marken.forEach(k => k.parent && k.parent.remove(k)); marken = []; pruef = ''; return info(); }
    if (a.dataset.a === 'bst') { bestandAn = !bestandAn; zeigeBestand(); a.textContent = bestandAn ? 'Bestand ausblenden' : 'Bestand zeigen'; return; }
    if (a.dataset.a === 'ende') sess && sess.end();
  });
  document.body.appendChild(overlay);
}
function info(){
  const el = document.getElementById('arinfo'); if (!el) return;
  const m = scale === 1 ? '1:1' : '1:20';
  if (!placed && !(reticle && reticle.visible)) { el.textContent = 'Boden suchen – Handy langsam bewegen …'; return; }
  if (!placed && modus === 'punkte') { el.textContent = raumPkt.length ? 'Jetzt Punkt 2 im Raum antippen' : 'Punkt 1 im Raum antippen (Ring genau auf die Ecke)'; return; }
  el.textContent = placed ? (pruef ? 'Ausgerichtet · ' + pruef : `Massstab ${m} · gedreht ${Math.round(yaw * 180 / Math.PI)}°`) : 'Ring antippen zum Platzieren';
}
function zeigeBestand(){
  V.P.forEach(p => { if (p.k === 'bst') { V.meshes[p.i].visible = bestandAn; if (V.edges) V.edges[p.i].visible = bestandAn; } });
}

async function beginnen(s){
  schliesseKarte(); scale = s; placed = false; yaw = 0; bestandAn = false; raumPkt = []; marken = []; pruef = '';
  if (modus === 'punkte' && !modellPkt) modus = 'frei';
  vorMarkenWeg();
  bauOverlay();
  try {
    sess = await navigator.xr.requestSession('immersive-ar', {requiredFeatures:['hit-test'], optionalFeatures:['dom-overlay'], domOverlay:{root:overlay}});
  } catch(e) {
    overlay.remove(); overlay = null; alert('AR konnte nicht gestartet werden: ' + (e && e.message || e)); return;
  }
  const scene = V.scene, r = V.renderer;
  V.setPause(true);
  // alles Modell (ausser Licht) in eine Gruppe, die im Raum platziert wird
  root = new T.Group(); root.visible = false;
  const kinder = scene.children.filter(o => !o.isLight);
  vorher = {kinder, gridSichtbar: V.grid ? V.grid.visible : null, bst: V.P.filter(p => p.k === 'bst').map(p => [p.i, V.meshes[p.i].visible])};
  kinder.forEach(o => root.add(o));
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
      if (raumPkt.length === 2) ausrichten();
      return info();
    }
    root.position.copy(p); root.rotation.y = yaw; root.visible = true; placed = true; reticle.visible = false; info();
  });
  sess.addEventListener('end', ende);
  r.setAnimationLoop((t, frame) => {
    if (frame && hitSrc && !placed) {
      const res = frame.getHitTestResults(hitSrc);
      const war = reticle.visible;
      if (res.length) { const pose = res[0].getPose(r.xr.getReferenceSpace()); reticle.visible = !!pose; if (pose) reticle.matrix.fromArray(pose.transform.matrix); }
      else reticle.visible = false;
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
  if (root) { vorher.kinder.forEach(o => scene.add(o)); scene.remove(root); root = null; }
  if (V.grid && vorher.gridSichtbar != null) V.grid.visible = vorher.gridSichtbar;
  vorher.bst.forEach(([i, sicht]) => { V.meshes[i].visible = sicht; if (V.edges) V.edges[i].visible = sicht; });
  if (overlay) { overlay.remove(); overlay = null; }
  sess = null; V.setPause(false);
  addEventListener('resize', ()=>{}, {once:true}); dispatchEvent(new Event('resize'));
}
window.AR = {start, _intern:{kannAR, winkel}};
})();
