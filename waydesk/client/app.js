// waydesk istemcisi — Aşama 1: görüntü.
//
// Sunucudan gelen binary kareler (12 baytlık başlık + JPEG) canvas'a çizilir.
// Her kare ALINIR ALINMAZ "ack" yollanır: sunucu ack'lere göre havadaki kare sayısını
// sınırlar (ağda gecikme birikmez), çözme ise bir sonraki karenin aktarımıyla paralel
// yürür. Çözücü yetişemezse yalnız en yeni kare çizilir, aradakiler atlanır.

const HEADER_BYTES = 12;
const KIND_JPEG = 1;

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const hud = document.getElementById('hud');
const statusEl = document.getElementById('status');

let ws = null;
let retries = 0;
let queued = null; // çizilmeyi bekleyen en yeni kare
let drawing = false;
let decodeMs = [];
let drawnFrames = 0;
let lastHudAt = performance.now();
let serverStats = null;
let build = null; // sunucunun istemci dosyaları özeti; değişirse sayfa yenilenir

function setStatus(text) {
  statusEl.textContent = text;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    retries = 0;
    setStatus('Görüntü bekleniyor…');
    send({ t: 'hello', v: 1 });
  };
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      onMessage(JSON.parse(event.data));
    } else {
      onFrame(event.data);
    }
  };
  ws.onclose = () => {
    queued = null;
    const delay = Math.min(5000, 500 * 2 ** retries++);
    setStatus('Bağlantı yok, yeniden deneniyor…');
    setTimeout(connect, delay);
  };
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function onMessage(msg) {
  switch (msg.t) {
    case 'hello':
      if (build && msg.build && msg.build !== build) {
        location.reload(); // sunucu yeni istemci koduyla yeniden başladı
        return;
      }
      build = msg.build;
      if (msg.state !== 'ok') setStatus('Sunucu ekran oturumunu başlatıyor…');
      break;
    case 'status':
      if (msg.state === 'session-closed') setStatus('Ekran oturumu kapandı, yeniden açılıyor…');
      else if (msg.state === 'capture-error') {
        setStatus(`Yakalama hatası, yeniden deneniyor…\n${(msg.detail || '').slice(0, 160)}`);
      } else if (msg.state === 'ok') setStatus('Görüntü bekleniyor…');
      break;
    case 'stats':
      serverStats = msg;
      renderHud();
      break;
  }
}

function onFrame(buffer) {
  const view = new DataView(buffer);
  const kind = view.getUint8(0);
  const seq = view.getUint32(4);
  send({ t: 'ack', seq });
  if (kind !== KIND_JPEG) return;
  queued = { seq, data: new Uint8Array(buffer, HEADER_BYTES) }; // varsa eskisi atlanır
  if (!drawing) drain();
}

async function drain() {
  drawing = true;
  while (queued) {
    const frame = queued;
    queued = null;
    const started = performance.now();
    try {
      const bitmap = await createImageBitmap(new Blob([frame.data], { type: 'image/jpeg' }));
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      decodeMs.push(performance.now() - started);
      drawnFrames++;
      if (statusEl.textContent) setStatus('');
    } catch (err) {
      console.warn('kare çözülemedi', err);
    }
  }
  drawing = false;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function renderHud() {
  const s = serverStats;
  const dec = median(decodeMs);
  decodeMs = [];
  const now = performance.now();
  const drawnFps = (drawnFrames * 1000) / (now - lastHudAt);
  drawnFrames = 0;
  lastHudAt = now;
  const fmt = (v, unit) => (v === null || v === undefined ? '–' : `${Math.round(v)}${unit}`);
  const size = s.size ? `${s.size[0]}×${s.size[1]}` : '–';
  const mbit = typeof s.kbps === 'number' ? `${(s.kbps / 1000).toFixed(1)} Mbit/s` : '–';
  const num = (v) => (v === null || v === undefined ? '–' : v);
  hud.textContent =
    `${s.fps} fps (çizilen ${drawnFps.toFixed(1)})  ${size}  ${mbit}\n` +
    `kodlama ${fmt(s.enc, ' ms')}  ağ ${fmt(s.lat, ' ms')}  çözme ${fmt(dec, ' ms')}\n` +
    `kaynak ${num(s.src)}  prob −${num(s.drop)}  kodlanan ${num(s.encfps)}  ` +
    `atlanan ${num(s.skip)}  kare ${fmt(s.kb, ' KB')}`;
  hud.hidden = false;
}

connect();
