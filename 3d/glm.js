// Bosch GLM 50 C per Web Bluetooth (Android/Chrome) – gemeinsam für Türaufmass (und später Aufmass-Hilfe).
// Protokoll: Dienst 02a6c0d0-…, Merkmal 02a6c0d1-…, Befehl C0 55 02 01 00 1A schaltet «Messwert automatisch senden» ein,
// Antwort C0 55 10 … mit Distanz als float32 (little endian, Meter) ab Byte 7. Am echten Gerät noch nicht getestet.
(function(){
'use strict';
const SVC = '02a6c0d0-0451-4000-b000-fb3210111989', CHR = '02a6c0d1-0451-4000-b000-fb3210111989';
const AUTO = new Uint8Array([0xC0, 0x55, 0x02, 0x01, 0x00, 0x1A]);
const G = {status: 'aus', fehler: '', beiWert: null, beiStatus: null,
  moeglich: () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice)};
function setze(s, f){ G.status = s; G.fehler = f || ''; if (G.beiStatus) G.beiStatus(s); }
G.deuten = function(dv){
  if (dv.byteLength < 11 || dv.getUint8(0) !== 0xC0 || dv.getUint8(1) !== 0x55 || dv.getUint8(2) !== 0x10) return null;
  const m = dv.getFloat32(7, true);
  return (m > 0 && m < 200) ? Math.round(m * 2000) / 2 : null;     // mm, auf 0,5 gerundet
};
G.verbinden = async function(){
  try {
    setze('suche');
    const dev = await navigator.bluetooth.requestDevice({filters: [{namePrefix: 'GLM'}, {namePrefix: 'Bosch'}], optionalServices: [SVC]});
    dev.addEventListener('gattserverdisconnected', () => setze('getrennt'));
    const ch = await (await (await dev.gatt.connect()).getPrimaryService(SVC)).getCharacteristic(CHR);
    await ch.startNotifications();
    ch.addEventListener('characteristicvaluechanged', ev => { const v = G.deuten(ev.target.value); if (v != null && G.beiWert) G.beiWert(v); });
    await ch.writeValue(AUTO);
    setze('ok');
  } catch(e) { setze(e && e.name === 'NotFoundError' ? 'aus' : 'fehler', e && e.message); }
};
G.text = () => ({aus: 'Bosch verbinden', suche: 'Suche Bosch …', ok: 'GLM 50 C verbunden', getrennt: 'Bosch neu verbinden', fehler: 'Bosch: Fehler – nochmals'})[G.status];
window.GLM = G;
})();
