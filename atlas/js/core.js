/* Atlas — çekirdek: veri dizini, bölgeler, yardımcılar, kayıt, ses. */
(function () {
  'use strict';
  const A = (window.Atlas = window.Atlas || {});

  // ── Veri dizini ─────────────────────────────────────────────────────────
  A.countries = window.ATLAS_COUNTRIES;
  A.territories = window.ATLAS_TERRITORIES;
  A.byId = Object.create(null);
  for (const c of A.countries) A.byId[c.id] = c;

  // Bayrak renk paleti. `fam` aynı renk ailesindeki tonları eşler:
  // oyuncu Qatar için "Kırmızı" ya da "Bordo" seçse de doğru sayılır.
  A.COLORS = {
    kirmizi: { n: 'Kırmızı', hex: '#d62a32', fam: 'red' },
    bordo: { n: 'Bordo', hex: '#8a1c3c', fam: 'red' },
    turuncu: { n: 'Turuncu', hex: '#f08a24', fam: 'orange' },
    sari: { n: 'Sarı', hex: '#f6c935', fam: 'yellow' },
    yesil: { n: 'Yeşil', hex: '#1f9a52', fam: 'green' },
    acikmavi: { n: 'Açık Mavi', hex: '#5ab1e3', fam: 'blue' },
    mavi: { n: 'Mavi', hex: '#1d4fa3', fam: 'blue' },
    siyah: { n: 'Siyah', hex: '#161616', fam: 'black' },
    beyaz: { n: 'Beyaz', hex: '#ffffff', fam: 'white' },
  };
  A.colorFamilies = (keys) => new Set(keys.map((k) => A.COLORS[k].fam));

  // ── Bölgeler ve projeksiyonları ────────────────────────────────────────
  // `box`: haritanın sığdırılacağı boylam/enlem dikdörtgeni.
  // `rot`: azimutal projeksiyonun merkezi (boylam, enlem).
  A.REGIONS = {
    world: { name: 'Dünya', proj: 'naturalEarth', box: [-180, -57, 180, 84], maxK: 24 },
    europe: { name: 'Avrupa', proj: 'azimuthal', rot: [15, 53], box: [-24, 34, 50, 71], maxK: 14 },
    asia: { name: 'Asya', proj: 'azimuthal', rot: [88, 28], box: [26, -11, 146, 56], maxK: 14 },
    africa: { name: 'Afrika', proj: 'azimuthal', rot: [17, 2], box: [-26, -36, 58, 38], maxK: 14 },
    namerica: { name: 'Kuzey Amerika', proj: 'azimuthal', rot: [-98, 42], box: [-170, 7, -55, 72], maxK: 16 },
    samerica: { name: 'Güney Amerika', proj: 'azimuthal', rot: [-62, -22], box: [-84, -56, -33, 13], maxK: 10 },
    oceania: { name: 'Okyanusya', proj: 'azimuthal', rot: [160, -12], box: [110, -48, 190, 15], maxK: 18 },
    mideast: { name: 'Orta Doğu', proj: 'azimuthal', rot: [44, 28], box: [24, 12, 63, 42.5], maxK: 10 },
  };
  A.REGION_ORDER = ['world', 'europe', 'asia', 'africa', 'namerica', 'samerica', 'oceania', 'mideast'];

  A.inRegion = (c, rid) => c.r.includes(rid);
  A.regionCountries = (rid) => A.countries.filter((c) => c.r.includes(rid));
  /** Ülkenin ana bölgesi (Dünya dışındaki ilk bölge). */
  A.homeRegion = (c) => c.r.find((r) => r !== 'world') || 'world';

  // ── Bayrak görselleri ──────────────────────────────────────────────────
  const flagCache = Object.create(null);
  A.flagSrc = (id) =>
    flagCache[id] || (flagCache[id] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.ATLAS_FLAGS[id]));
  /** Bayrak <img>; alt metni bilerek cevabı vermez. */
  A.flagImg = (id, cls = 'flag') => {
    const img = document.createElement('img');
    img.className = cls;
    img.src = A.flagSrc(id);
    img.alt = 'Bayrak';
    img.draggable = false;
    return img;
  };

  // ── Metin eşleme (Türkçe duyarlı) ──────────────────────────────────────
  A.norm = (s) =>
    String(s)
      .toLocaleLowerCase('tr')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ı/g, 'i')
      .replace(/[^a-z0-9]/g, '');

  const nameIndex = new Map(); // norm → id (çakışan adlar dizine girmez)
  const clashes = new Set();
  for (const c of A.countries) {
    for (const s of [c.n, ...c.al]) {
      const k = A.norm(s);
      if (!k || clashes.has(k)) continue;
      const prev = nameIndex.get(k);
      if (prev && prev !== c.id) { nameIndex.delete(k); clashes.add(k); continue; }
      nameIndex.set(k, c.id);
    }
  }
  A.nameKeys = (c) => [c.n, ...c.al].map(A.norm).filter((k) => nameIndex.get(k) === c.id);
  /** Tam eşleşen ülke kimliği ya da null. */
  A.matchName = (input) => nameIndex.get(A.norm(input)) || null;
  /** Otomatik tamamlama: önce başı eşleşenler, sonra içinde geçenler. */
  A.suggest = (input, pool = A.countries, n = 6) => {
    const q = A.norm(input);
    if (q.length < 2) return [];
    const starts = [];
    const contains = [];
    for (const c of pool) {
      const keys = [A.norm(c.n), ...c.al.map(A.norm)];
      if (keys.some((k) => k.startsWith(q))) starts.push(c);
      else if (keys.some((k) => k.includes(q))) contains.push(c);
    }
    const byName = (a, b) => a.n.localeCompare(b.n, 'tr');
    return [...starts.sort(byName), ...contains.sort(byName)].slice(0, n);
  };

  // ── Rastgelelik ────────────────────────────────────────────────────────
  A.rng = (seed) => {
    let a = seed >>> 0 || 0x9e3779b9;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  A.hashStr = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  A.shuffle = (arr, rnd = Math.random) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  A.sample = (arr, n, rnd = Math.random) => A.shuffle(arr, rnd).slice(0, n);
  A.pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];

  // ── Mesafe ve çeldirici seçimi ─────────────────────────────────────────
  const toRad = Math.PI / 180;
  A.dist = (a, b) => {
    const [lo1, la1] = a.lp;
    const [lo2, la2] = b.lp;
    const s =
      Math.sin(((la2 - la1) * toRad) / 2) ** 2 +
      Math.cos(la1 * toRad) * Math.cos(la2 * toRad) * Math.sin(((lo2 - lo1) * toRad) / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(s)));
  };
  A.flagSimilarity = (a, b) => {
    const fa = A.colorFamilies(a.col);
    const fb = A.colorFamilies(b.col);
    let inter = 0;
    for (const f of fa) if (fb.has(f)) inter++;
    return inter / (fa.size + fb.size - inter);
  };
  /**
   * Doğru cevap + 3 çeldirici. `by`: 'near' (coğrafi yakın) ya da 'flag'
   * (bayrak renkleri benzer). Sonuç karıştırılmış dizi.
   */
  A.options = (c, pool, rnd = Math.random, by = 'near', n = 4) => {
    const others = pool.filter((x) => x.id !== c.id);
    let ranked;
    if (by === 'flag') {
      ranked = others
        .map((x) => [x, A.flagSimilarity(c, x) + rnd() * 0.35])
        .sort((p, q) => q[1] - p[1])
        .map((p) => p[0]);
    } else {
      ranked = others.map((x) => [x, A.dist(c, x)]).sort((p, q) => p[1] - q[1]).map((p) => p[0]);
    }
    const near = ranked.slice(0, Math.max(n + 3, 7));
    const chosen = A.sample(near, n - 1, rnd);
    return A.shuffle([c, ...chosen], rnd);
  };

  // ── Biçimlendirme ──────────────────────────────────────────────────────
  A.fmtTime = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  A.fmtArea = (km2) => (km2 < 1 ? '< 1' : Math.round(km2).toLocaleString('tr-TR')) + ' km²';
  /** "Macaristan'ın" — Türkçe iyelik eki (ünlü uyumu + kaynaştırma). */
  A.genitive = (name) => {
    const lower = name.toLocaleLowerCase('tr');
    const vowels = lower.match(/[aeıioöuü]/g);
    const last = vowels ? vowels[vowels.length - 1] : 'e';
    const suffix = { a: 'ın', ı: 'ın', e: 'in', i: 'in', o: 'un', u: 'un', ö: 'ün', ü: 'ün' }[last];
    const endsVowel = /[aeıioöuü]$/.test(lower);
    return `${name}'${endsVowel ? 'n' : ''}${suffix}`;
  };
  A.el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : String(kid));
    return e;
  };
  A.esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  A.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  A.reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Kalıcı kayıt (tarayıcıda; erişilemezse sessizce bellekte) ───────────
  const mem = {};
  A.store = {
    get(key, def) {
      try {
        const v = localStorage.getItem('atlas:' + key);
        return v == null ? (key in mem ? mem[key] : def) : JSON.parse(v);
      } catch (e) {
        return key in mem ? mem[key] : def;
      }
    },
    set(key, val) {
      mem[key] = val;
      try { localStorage.setItem('atlas:' + key, JSON.stringify(val)); } catch (e) { /* özel pencere vb. */ }
    },
  };

  // ── Ses (WebAudio; ilk etkileşimden sonra çalar) ───────────────────────
  let ctx = null;
  A.sound = {
    on: A.store.get('sound', true),
    toggle() { this.on = !this.on; A.store.set('sound', this.on); return this.on; },
    play(kind) {
      if (!this.on) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        const seq = {
          ok: [[660, 0, 0.09], [990, 0.08, 0.12]],
          bad: [[180, 0, 0.18]],
          win: [[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.12], [1047, 0.3, 0.25]],
          tick: [[1200, 0, 0.03]],
          snap: [[880, 0, 0.06], [1320, 0.05, 0.08]],
        }[kind] || [];
        const now = ctx.currentTime;
        for (const [f, t, d] of seq) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = kind === 'bad' ? 'sawtooth' : 'triangle';
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, now + t);
          g.gain.exponentialRampToValueAtTime(kind === 'bad' ? 0.06 : 0.12, now + t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, now + t + d);
          o.connect(g).connect(ctx.destination);
          o.start(now + t);
          o.stop(now + t + d + 0.02);
        }
      } catch (e) { /* ses yoksa oyun sessiz devam eder */ }
    },
  };

  // ── Graf yardımcıları (komşuluk) ───────────────────────────────────────
  /** Verilen kimlik kümesiyle sınırlı komşuluk listesi. */
  A.graph = (ids) => {
    const set = new Set(ids);
    const g = {};
    for (const id of ids) g[id] = A.byId[id].b.filter((x) => set.has(x));
    return g;
  };
  /** BFS mesafeleri (kaynaktan). */
  A.bfs = (g, src, allowed) => {
    const d = { [src]: 0 };
    const q = [src];
    while (q.length) {
      const u = q.shift();
      for (const v of g[u] || []) {
        if (d[v] != null || (allowed && !allowed.has(v))) continue;
        d[v] = d[u] + 1;
        q.push(v);
      }
    }
    return d;
  };

  A.games = {};
  A.registerGame = (def) => { A.games[def.id] = def; };
})();
