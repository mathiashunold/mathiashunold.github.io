/* Etiketten-Scanner für die 3D-Werkstatt (Übersicht und 3D-Seiten).
 * Liest Data-Matrix- und QR-Codes mit der Handykamera.
 *  - Browser mit BarcodeDetector (Android/Chrome): eingebaut
 *  - sonst (iPhone/Safari, Firefox): zxing-wasm 3.1.5 aus lib/ (selbst ausgeliefert, MIT/Apache-2.0)
 * Die Etiketten (Cut Rite) enthalten den Pfad des CNC-Programms, z. B.
 *   01_Aufträge\2000\0_CADT\00_Test\01_010_UK_Polster  →  Programm «01_010_UK_Polster» → Pos. 1.10
 * API:  Scanner.open(text => …)   Scanner.deuten(text) → {link, nr, hash} | {prog, h, u}
 */
(function(){
'use strict';
const BASE = (document.currentScript && document.currentScript.src || location.href).replace(/[^/]*$/, '');
const FORMATE_ZX = ['DataMatrix', 'QRCode'];
const FORMATE_BD = ['data_matrix', 'qr_code'];

function deuten(text){
  const t = String(text || '').trim();
  const m = /\/3d\/([^/?#]+)\/?(?:\?[^#]*)?(#p-\d+-\d+)?\s*$/.exec(t);
  if (/^https?:\/\//.test(t) && m) return {link:true, nr:decodeURIComponent(m[1]), hash:m[2] || '', text:t};
  const prog = t.split(/[\\/]/).pop().trim();
  const p = /^(\d{1,3})_(\d{1,4})(?:_|$)/.exec(prog);
  return {prog, h:p ? +p[1] : null, u:p ? +p[2] : null, text:t};
}

// ---------- Decoder ----------
let decoderP = null;
function ladeScript(src){
  return new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => err(new Error('Scanner-Bibliothek nicht geladen')); document.head.appendChild(s); });
}
// Eingebauter Leser (BarcodeDetector): manche Browser melden «data_matrix», werfen aber beim Lesen
// «Barcode detection not implemented» (z. B. Chrome auf macOS/Windows, Android ohne Play-Dienste).
// Deshalb einmal an einem leeren Bild ausprobieren und bei jedem Fehler dauerhaft auf zxing-wasm wechseln.
let ohneEingebaut = false;
async function eingebauterLeser(){
  if (ohneEingebaut || !('BarcodeDetector' in window)) return null;
  try {
    const f = await BarcodeDetector.getSupportedFormats();
    if (!f.includes('data_matrix')) return null;
    const bd = new BarcodeDetector({formats: FORMATE_BD.filter(x => f.includes(x))});
    const probe = document.createElement('canvas'); probe.width = probe.height = 32;
    probe.getContext('2d').fillRect(0, 0, 8, 8);
    await bd.detect(probe);                                   // wirft, wenn nicht wirklich vorhanden
    return async src => {
      try { const r = await bd.detect(src); return r.length ? r[0].rawValue : null; }
      catch(e) { ohneEingebaut = true; decoderP = null; return null; }   // nächste Runde mit zxing
    };
  } catch(e) { ohneEingebaut = true; return null; }
}
async function decoder(){
  if (decoderP) return decoderP;
  decoderP = (async () => {
    const eingebaut = await eingebauterLeser();
    if (eingebaut) return eingebaut;
    if (!window.ZXingWASM) await ladeScript(BASE + 'lib/zxing-reader.js');
    ZXingWASM.prepareZXingModule({overrides:{locateFile:(p, pre) => p.endsWith('.wasm') ? BASE + 'lib/zxing_reader.wasm' : pre + p}, fireImmediately:true});
    const opt = {formats:FORMATE_ZX, tryHarder:true, tryRotate:true, tryInvert:false, maxNumberOfSymbols:1};
    return async (src, ctx) => {
      const img = ctx.getImageData(0, 0, src.width, src.height);
      const r = await ZXingWASM.readBarcodes(img, opt);
      const ok = r.find(x => x.isValid && x.text);
      return ok ? ok.text : null;
    };
  })();
  decoderP.catch(() => { decoderP = null; });
  return decoderP;
}

// ---------- Oberfläche ----------
const CSS = `
.scn{position:fixed;inset:0;z-index:1000;background:#000;color:#fff;font-family:var(--font,system-ui,-apple-system,"Segoe UI",sans-serif);display:flex;flex-direction:column}
.scn video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scn .rahmen{position:absolute;left:50%;top:45%;width:min(68vw,68vh,360px);aspect-ratio:1;transform:translate(-50%,-50%);border-radius:18px;box-shadow:0 0 0 100vmax rgba(0,0,0,.55)}
.scn .rahmen::before,.scn .rahmen::after{content:"";position:absolute;inset:-3px;border-radius:20px;border:3px solid #fff;
  -webkit-mask:linear-gradient(#000 0 0) top left/28% 28% no-repeat,linear-gradient(#000 0 0) top right/28% 28% no-repeat,linear-gradient(#000 0 0) bottom left/28% 28% no-repeat,linear-gradient(#000 0 0) bottom right/28% 28% no-repeat;
          mask:linear-gradient(#000 0 0) top left/28% 28% no-repeat,linear-gradient(#000 0 0) top right/28% 28% no-repeat,linear-gradient(#000 0 0) bottom left/28% 28% no-repeat,linear-gradient(#000 0 0) bottom right/28% 28% no-repeat}
.scn.treffer .rahmen::before{border-color:#4ADE80}
.scn .kopf{position:relative;padding:calc(env(safe-area-inset-top,0px) + 16px) 16px 0;text-align:center}
.scn .kopf b{display:block;font-size:20px;font-weight:700}
.scn .kopf span{font-size:15px;opacity:.85}
.scn .fuss{position:relative;margin-top:auto;padding:16px 16px calc(env(safe-area-inset-bottom,0px) + 20px);display:flex;gap:10px;justify-content:center;flex-wrap:wrap;align-items:stretch}
.scn .fuss>*{box-sizing:border-box}
.scn button,.scn label.btn{font:inherit;font-size:17px;font-weight:600;min-height:48px;padding:10px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.35);background:rgba(20,24,28,.75);color:#fff;cursor:pointer;display:inline-flex;align-items:center}
.scn button.haupt{background:#fff;color:#111;border-color:#fff}
.scn button[aria-pressed="true"]{background:#FFD24D;color:#111;border-color:#FFD24D}
.scn .meldung{position:absolute;left:16px;right:16px;top:45%;transform:translateY(-50%);text-align:center;font-size:17px;line-height:1.45;background:rgba(20,24,28,.92);border-radius:14px;padding:18px}
.scn :focus-visible{outline:3px solid #6AA2FF;outline-offset:2px}
`;
function ui(){
  if (!document.getElementById('scn-css')) { const st = document.createElement('style'); st.id = 'scn-css'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div');
  el.className = 'scn'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Etikett scannen');
  el.innerHTML = `<video playsinline muted autoplay></video><div class="rahmen" aria-hidden="true"></div>
    <div class="kopf"><b>Etikett scannen</b><span>Den Code auf dem Etikett in den Rahmen halten</span></div>
    <div class="meldung" hidden role="alert"></div>
    <div class="fuss">
      <button type="button" class="licht" hidden aria-pressed="false">Licht</button>
      <label class="btn foto">Foto<input type="file" accept="image/*" capture="environment" hidden></label>
      <button type="button" class="haupt zu">Abbrechen</button>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function open(onCode){
  const el = ui(), video = el.querySelector('video'), meldung = el.querySelector('.meldung');
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', {willReadFrequently:true});
  let stream = null, aktiv = true, laeuft = false, timer = 0;
  const zeige = t => { meldung.hidden = !t; meldung.textContent = t || ''; };
  const zu = () => { aktiv = false; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); el.remove(); document.removeEventListener('keydown', esc); };
  const esc = ev => { if (ev.key === 'Escape') zu(); };
  document.addEventListener('keydown', esc);
  el.querySelector('.zu').addEventListener('click', zu);
  el.querySelector('.zu').focus();
  const fertig = text => {
    if (!aktiv) return; el.classList.add('treffer');
    try { navigator.vibrate && navigator.vibrate(60); } catch(e){}
    setTimeout(() => { zu(); onCode(text); }, 180);
  };

  // Ausschnitt im Rahmen (plus Rand) in das Canvas kopieren
  function ausschnitt(src, w, h){
    const s = Math.min(w, h) * 0.8, x = (w - s) / 2, y = Math.max(0, Math.min(h - s, h * 0.45 - s / 2));
    const z = Math.min(1, 900 / s);
    canvas.width = Math.round(s * z); canvas.height = Math.round(s * z);
    ctx.drawImage(src, x, y, s, s, 0, 0, canvas.width, canvas.height);
  }
  async function runde(){
    if (!aktiv) return;
    if (!laeuft && video.readyState >= 2 && video.videoWidth) {
      laeuft = true;
      try {
        const dec = await decoder();
        ausschnitt(video, video.videoWidth, video.videoHeight);
        const t = await dec(canvas, ctx);
        if (t) return fertig(t);
      } catch(e) { zeige(e.message || 'Scanner konnte nicht gestartet werden.'); return; }
      finally { laeuft = false; }
    }
    timer = setTimeout(runde, 120);
  }

  // Foto als Rückfallebene (ältere Geräte, keine Kamera-Freigabe)
  el.querySelector('.foto input').addEventListener('change', async ev => {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    zeige('Foto wird gelesen …');
    try {
      const bmp = await createImageBitmap(f);
      const dec = await decoder();
      for (const z of [1, 0.6, 0.35]) {            // ganzes Bild, dann Mitte
        const s = Math.min(bmp.width, bmp.height) * z, x = (bmp.width - s) / 2, y = (bmp.height - s) / 2;
        const k = Math.min(1, 1600 / Math.max(s, 1));
        canvas.width = Math.round((z === 1 ? bmp.width : s) * k); canvas.height = Math.round((z === 1 ? bmp.height : s) * k);
        if (z === 1) ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height); else ctx.drawImage(bmp, x, y, s, s, 0, 0, canvas.width, canvas.height);
        const t = await dec(canvas, ctx); if (t) return fertig(t);
      }
      zeige('Kein Code im Foto gefunden. Näher heran und scharf fotografieren.');
    } catch(e){ zeige('Foto konnte nicht gelesen werden.'); }
    ev.target.value = '';
  });

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    zeige('Die Kamera ist hier nicht verfügbar (Seite über https öffnen). Alternativ «Foto» antippen.');
    return {close: zu};
  }
  navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}}})
    .then(s => {
      if (!aktiv) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s; video.srcObject = s; video.play().catch(() => {});
      const track = s.getVideoTracks()[0];
      try {
        const cap = track.getCapabilities ? track.getCapabilities() : {};
        if (cap.torch) {
          const b = el.querySelector('.licht'); b.hidden = false;
          b.addEventListener('click', async () => { const an = b.getAttribute('aria-pressed') !== 'true';
            try { await track.applyConstraints({advanced:[{torch:an}]}); b.setAttribute('aria-pressed', String(an)); } catch(e){} });
        }
        if (cap.focusMode && cap.focusMode.includes('continuous')) track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(() => {});
      } catch(e){}
      decoder().catch(e => zeige(e.message));      // Bibliothek schon laden, während die Kamera startet
      runde();
    })
    .catch(e => {
      zeige(e && e.name === 'NotAllowedError'
        ? 'Kein Zugriff auf die Kamera. In den Browser-Einstellungen die Kamera für diese Seite erlauben – oder «Foto» antippen.'
        : 'Kamera konnte nicht gestartet werden. Alternativ «Foto» antippen.');
    });
  return {close: zu};
}

window.Scanner = {open, deuten, BASE};
})();
