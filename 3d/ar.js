// AR-Ansicht (Beta): das Möbel 1:1 im echten Raum zeigen – WebXR «immersive-ar» mit Bodenerkennung (hit-test).
// Läuft auf Android mit Chrome und «Google Play-Dienste für AR» (ARCore). iPhone/Safari kann WebXR-AR (noch) nicht.
// Wird von der 3D-Seite als ../ar.js geladen (nur nach Beta-Anmeldung), braucht window.V3D aus dem Viewer.
// Modell: Meter, y nach oben, Boden = 0, Mitte des Möbels im Ursprung → wird auf den angetippten Bodenpunkt gesetzt.
(function(){
'use strict';
let V, T, sess = null, hitSrc = null, reticle = null, root = null, overlay = null, karte = null;
let placed = false, yaw = 0, scale = 1, bestandAn = false, vorher = null;

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
`;
function stil(){ if (document.getElementById('arstil')) return; const s = document.createElement('style'); s.id = 'arstil'; s.textContent = css; document.head.appendChild(s); }

async function kannAR(){
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch(e){ return false; }
}
function schliesseKarte(){ if (karte) { karte.remove(); karte = null; } if (location.hash === '#ar') history.replaceState(null, '', location.pathname + location.search); }

async function start(v3d){
  V = v3d; T = V.THREE; stil(); schliesseKarte();
  karte = document.createElement('section'); karte.id = 'arkarte'; karte.setAttribute('aria-label', 'AR-Ansicht');
  const ok = await kannAR();
  karte.innerHTML = ok
    ? `<h2>Im Raum anzeigen (Beta)</h2>
       <p>Handy langsam über den Boden bewegen, bis ein Ring erscheint. Dann antippen: das Möbel steht dort im Massstab 1:1.</p>
       <p>Mit ↺ ↻ drehen, «Neu platzieren» zum Verschieben. Der Bestand (Wände) ist ausgeblendet – der echte Raum ist ja da.</p>
       <div class="acts"><button class="kp" data-a="1">AR starten 1:1</button><button data-a="20">Tischmodell 1:20</button><button data-a="zu">Schliessen</button></div>`
    : `<h2>AR auf diesem Gerät nicht möglich</h2>
       <p>Die AR-Ansicht braucht <b>Chrome auf Android</b> mit der App «Google Play-Dienste für AR» (ARCore).
       Auf dem iPhone geht es im Browser noch nicht.</p>
       <div class="acts"><button data-a="zu">Schliessen</button></div>`;
  document.body.appendChild(karte);
  karte.addEventListener('click', ev => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'zu') return schliesseKarte();
    beginnen(a.dataset.a === '20' ? 1/20 : 1);
  });
}

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
    if (a.dataset.a === 'neu') { placed = false; root.visible = false; return info(); }
    if (a.dataset.a === 'bst') { bestandAn = !bestandAn; zeigeBestand(); a.textContent = bestandAn ? 'Bestand ausblenden' : 'Bestand zeigen'; return; }
    if (a.dataset.a === 'ende') sess && sess.end();
  });
  document.body.appendChild(overlay);
}
function info(){
  const el = document.getElementById('arinfo'); if (!el) return;
  const m = scale === 1 ? '1:1' : '1:20';
  el.textContent = placed ? `Massstab ${m} · gedreht ${Math.round(yaw * 180 / Math.PI)}°` : (reticle && reticle.visible ? 'Ring antippen zum Platzieren' : 'Boden suchen – Handy langsam bewegen …');
}
function zeigeBestand(){
  V.P.forEach(p => { if (p.k === 'bst') { V.meshes[p.i].visible = bestandAn; if (V.edges) V.edges[p.i].visible = bestandAn; } });
}

async function beginnen(s){
  schliesseKarte(); scale = s; placed = false; yaw = 0; bestandAn = false;
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
    root.position.setFromMatrixPosition(reticle.matrix); root.rotation.y = yaw; root.visible = true; placed = true; reticle.visible = false; info();
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
  if (root) { vorher.kinder.forEach(o => scene.add(o)); scene.remove(root); root = null; }
  if (V.grid && vorher.gridSichtbar != null) V.grid.visible = vorher.gridSichtbar;
  vorher.bst.forEach(([i, sicht]) => { V.meshes[i].visible = sicht; if (V.edges) V.edges[i].visible = sicht; });
  if (overlay) { overlay.remove(); overlay = null; }
  sess = null; V.setPause(false);
  addEventListener('resize', ()=>{}, {once:true}); dispatchEvent(new Event('resize'));
}
window.AR = {start, _intern:{kannAR}};
})();
