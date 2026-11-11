// Bosch-Laser (GLM 50 C und verwandte) per Web Bluetooth (Android/Chrome) – gemeinsam für Türaufmass.
// Bosch-Messprotokoll: Befehl C0 55 02 01 00 1A schaltet «Messwert automatisch senden» ein, Antwort C0 55 10 … mit Distanz als
// float32 (little endian, Meter) ab Byte 7. Der Dienst heisst je nach Gerätegeneration anders (DIENSTE); Lese-/Schreib-Merkmal werden
// an ihren Eigenschaften erkannt. Jeder Schritt wird in G.log festgehalten (Diagnose). Am echten Gerät noch nicht bestätigt.
(function(){
'use strict';
const DIENSTE = ['02a6c0d0-0451-4000-b000-fb3210111989',      // neuere GLM (… C, -27 C)
                 '00005301-0000-0041-5253-534f46540000',      // ältere GLM/PLR (serieller Dienst)
                 '49535343-fe7d-4ae5-8fa9-9fafd205e455'];     // serieller Dienst (Microchip)
const PRAEFIXE = ['Bosch', 'BOSCH', 'bosch', 'GLM', 'PLR'];
const AUTO = new Uint8Array([0xC0, 0x55, 0x02, 0x01, 0x00, 0x1A]);
const G = {status: 'aus', fehler: '', schritt: '', log: [], versuche: 0, beiWert: null, beiStatus: null,
  moeglich: () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice)};
function merke(t){ G.log.push(new Date().toTimeString().slice(0, 8) + ' ' + t); if (G.log.length > 60) G.log.shift(); }
function setze(s, f){ G.status = s; G.fehler = f || ''; if (G.beiStatus) G.beiStatus(s); }
function schritt(t){ G.schritt = t; merke(t); if (G.beiStatus) G.beiStatus(G.status); }
const warte = ms => new Promise(ok => setTimeout(ok, ms));
G.deuten = function(dv){
  if (dv.byteLength < 11 || dv.getUint8(0) !== 0xC0 || dv.getUint8(1) !== 0x55 || dv.getUint8(2) !== 0x10) return null;
  const m = dv.getFloat32(7, true);
  return (m > 0 && m < 200) ? Math.round(m * 2000) / 2 : null;     // mm, auf 0,5 gerundet
};
const hex = dv => Array.from(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)).map(b => b.toString(16).padStart(2, '0')).join(' ');
G.verbinden = async function(alle){
  G.versuche++; G.log = []; merke('Start' + (alle ? ' (alle Geräte)' : '') + ' · ' + navigator.userAgent.replace(/^.*?(Android [^;)]*).*?(Chrome\/[\d.]+).*$/, '$1 $2'));
  try {
    setze('suche'); schritt('Bluetooth prüfen');
    if (navigator.bluetooth.getAvailability && !(await navigator.bluetooth.getAvailability())) throw Object.assign(new Error('Bluetooth am Handy ist aus'), {name: 'BluetoothAus'});
    schritt('Gerät wählen');
    const dev = await navigator.bluetooth.requestDevice(alle ? {acceptAllDevices: true, optionalServices: DIENSTE}
      : {filters: PRAEFIXE.map(p => ({namePrefix: p})).concat(DIENSTE.map(d => ({services: [d]}))), optionalServices: DIENSTE});
    merke('gewählt: ' + (dev.name || '(ohne Namen)'));
    dev.addEventListener('gattserverdisconnected', () => { merke('getrennt'); if (G.status === 'ok') setze('getrennt'); });
    let server = null, letzter = null;
    for (let i = 1; i <= 3 && !server; i++) {            // Android bricht den ersten Verbindungsaufbau öfter ab
      schritt('Verbinden (' + i + '/3)');
      try { server = await dev.gatt.connect(); } catch(e) { letzter = e; merke('  ' + e.name + ': ' + e.message); await warte(700); }
    }
    if (!server) throw letzter;
    schritt('Dienst suchen');
    let svc = null;
    for (const d of DIENSTE) { try { svc = await server.getPrimaryService(d); merke('Dienst ' + d.slice(0, 8)); break; } catch(e) { merke('  kein Dienst ' + d.slice(0, 8) + ' (' + e.name + ')'); } }
    if (!svc) throw Object.assign(new Error('Kein Bosch-Messdienst auf «' + (dev.name || '?') + '» gefunden'), {name: 'KeinDienst'});
    const chs = await svc.getCharacteristics();
    chs.forEach(c => merke('  Merkmal ' + c.uuid.slice(0, 8) + ' ' + ['notify', 'indicate', 'write', 'writeWithoutResponse', 'read'].filter(p => c.properties[p]).join('/')));
    const lesen = chs.filter(c => c.properties.notify || c.properties.indicate), schreiben = chs.find(c => c.properties.write) || chs.find(c => c.properties.writeWithoutResponse);
    if (!lesen.length || !schreiben) throw Object.assign(new Error('Merkmale für Messwerte fehlen'), {name: 'KeinMerkmal'});
    schritt('Messwerte abonnieren');
    for (const c of lesen) { await c.startNotifications();
      c.addEventListener('characteristicvaluechanged', ev => { const dv = ev.target.value, v = G.deuten(dv); merke('← ' + hex(dv) + (v != null ? ' = ' + v + ' mm' : '')); if (v != null && G.beiWert) G.beiWert(v); }); }
    schritt('Automatisch senden einschalten');
    if (schreiben.properties.write && schreiben.writeValueWithResponse) await schreiben.writeValueWithResponse(AUTO);
    else if (schreiben.writeValueWithoutResponse) await schreiben.writeValueWithoutResponse(AUTO);
    else await schreiben.writeValue(AUTO);
    G.name = dev.name || 'Bosch'; schritt('bereit'); setze('ok');
  } catch(e) {
    const n = (e && e.name) || 'Fehler', m = (e && e.message) || String(e); merke('FEHLER bei «' + G.schritt + '»: ' + n + ': ' + m);
    setze(n === 'NotFoundError' ? 'keins' : 'fehler', n + ': ' + m);
  }
};
G.text = () => ({aus: 'Bosch verbinden', suche: 'Bosch: ' + (G.schritt || 'Suche') + ' …', ok: (G.name || 'Bosch') + ' verbunden', getrennt: 'Bosch neu verbinden',
  keins: 'Bosch verbinden', fehler: 'Bosch: Fehler – nochmals'})[G.status];
// Klartext-Hinweis zum letzten Fehler (leer, wenn alles gut)
G.hinweis = function(){
  if (G.status === 'keins') return 'Kein Gerät gewählt. Erscheint der Bosch nicht in der Liste? Am Laser Bluetooth einschalten (Symbol im Display), ' +
    'am Handy Bluetooth und Standort einschalten, Chrome die Berechtigung «Geräte in der Nähe» geben. In den Bluetooth-Einstellungen des Handys eine alte Kopplung mit dem Bosch entfernen ' +
    'und die Bosch-App (MeasureOn) schliessen – sonst ist der Laser besetzt. Dann «Alle Geräte zeigen» versuchen.';
  if (G.status !== 'fehler') return '';
  const f = G.fehler;
  if (/BluetoothAus/.test(f)) return 'Bluetooth am Handy ist ausgeschaltet.';
  if (/SecurityError|NotAllowedError/.test(f)) return 'Chrome darf Bluetooth nicht benutzen: Android-Einstellungen → Apps → Chrome → Berechtigungen → «Geräte in der Nähe» (und Standort) erlauben.';
  if (/KeinDienst|KeinMerkmal/.test(f)) return 'Verbunden, aber dieses Gerät spricht eine andere Bluetooth-Sprache. Bitte «Diagnose kopieren» und an Claude schicken.';
  if (/NetworkError|NotSupportedError|AbortError/.test(f)) return 'Verbindung zum Laser bricht ab (bei «' + G.schritt + '»). Laser näher halten, am Laser Bluetooth aus/ein, Bosch-App schliessen, ' +
    'alte Kopplung in den Bluetooth-Einstellungen entfernen, dann nochmals.';
  return 'Fehler bei «' + G.schritt + '»: ' + f;
};
G.diagnose = () => G.log.join('\n');
window.GLM = G;
})();
