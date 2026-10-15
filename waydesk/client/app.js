// waydesk istemcisi — Aşama 1: görüntü.
//
// Sunucudan gelen binary kareler (12 baytlık başlık + JPEG) canvas'a çizilir.
// Her kare çizilince (ya da daha yenisi geldiği için atlanınca) "ack" yollanır;
// sunucu ack'lere göre havadaki kare sayısını sınırlar, gecikme birikmez.

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
let serverStats = null;

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
  if (kind !== KIND_JPEG) {
    send({ t: 'ack', seq, d: 0 });
    return;
  }
  if (queued) send({ t: 'ack', seq: queued.seq, d: 0 }); // daha yenisi geldi, atla
  queued = { seq, data: new Uint8Array(buffer, HEADER_BYTES) };
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
      if (statusEl.textContent) setStatus('');
      send({ t: 'ack', seq: frame.seq, d: 1 });
    } catch (err) {
      console.warn('kare çözülemedi', err);
      send({ t: 'ack', seq: frame.seq, d: 0 });
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
  const fmt = (v, unit) => (v === null || v === undefined ? '–' : `${Math.round(v)}${unit}`);
  const size = s.size ? `${s.size[0]}×${s.size[1]}` : '–';
  const mbit = typeof s.kbps === 'number' ? `${(s.kbps / 1000).toFixed(1)} Mbit/s` : '–';
  hud.textContent =
    `${s.fps} fps  ${size}  ${mbit}\n` +
    `kodlama ${fmt(s.enc, ' ms')}  çözme ${fmt(dec, ' ms')}  ağ+çizim ${fmt(s.lat, ' ms')}`;
  hud.hidden = false;
}

connect();
