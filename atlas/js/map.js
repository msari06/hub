/* Atlas — siyasi harita görünümü: projeksiyon, çizim, yakınlaştırma, tıklama. */
(function () {
  'use strict';
  const A = window.Atlas;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const W = 1000;
  const POLITICAL = 6; // siyasi harita pastel renk sayısı

  // Tüm dünya özellikleri bir kez çözülür; her harita kendi projeksiyonuyla çizer.
  let FEATURES = null;
  let COLOR_INDEX = null;
  function features() {
    if (FEATURES) return FEATURES;
    const topo = window.ATLAS_TOPO;
    const obj = topo.objects.countries;
    FEATURES = topojson.feature(topo, obj).features;
    // Siyasi harita boyaması: komşular aynı rengi almasın (açgözlü boyama).
    const nb = topojson.neighbors(obj.geometries);
    const order = FEATURES.map((f, i) => i).sort((a, b) => nb[b].length - nb[a].length);
    const color = new Array(FEATURES.length).fill(-1);
    for (const i of order) {
      const used = new Set(nb[i].map((j) => color[j]));
      let c = A.hashStr(FEATURES[i].id) % POLITICAL;
      for (let t = 0; t < POLITICAL && used.has(c); t++) c = (c + 1) % POLITICAL;
      color[i] = c;
    }
    COLOR_INDEX = {};
    FEATURES.forEach((f, i) => { COLOR_INDEX[f.id] = color[i]; });
    return FEATURES;
  }
  A.politicalColor = (id) => { features(); return `var(--p${COLOR_INDEX[id] ?? 0})`; };
  A.feature = (id) => features().find((f) => f.id === id) || null;

  function boxPoints([x0, y0, x1, y1]) {
    const pts = [];
    for (let x = x0; x <= x1; x += 1) pts.push([x, y0], [x, y1]);
    for (let y = y0; y <= y1; y += 1) pts.push([x0, y], [x1, y]);
    return { type: 'MultiPoint', coordinates: pts };
  }

  function buildProjection(region) {
    const R = A.REGIONS[region];
    let p;
    if (R.proj === 'naturalEarth') p = d3.geoNaturalEarth1();
    else p = d3.geoAzimuthalEqualArea().rotate([-R.rot[0], -R.rot[1]]).clipAngle(90);
    const box = boxPoints(R.box);
    p.fitWidth(W, box);
    const h = d3.geoPath(p).bounds(box)[1][1];
    const pad = 6;
    const H = Math.ceil(h + pad * 2);
    p.fitExtent([[pad, pad], [W - pad, H - pad]], box);
    p.clipExtent([[0, 0], [W, H]]);
    return { p, H };
  }
  A.buildProjection = buildProjection;

  const svgEl = (tag, attrs = {}) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };

  /**
   * new MapView(container, opts)
   *  region        bölge kimliği
   *  members       oyuna dahil ülke kimlikleri (varsayılan: bölgenin ülkeleri)
   *  clickable     'members' | 'all' | 'none'
   *  zoom          yakınlaştırma/kaydırma açık mı
   *  hoverNames    üzerine gelince ad göster (yalnız keşif/ana sayfa)
   *  onClick(id)   ülkeye tıklama
   *  political     üye ülkeleri pastel siyasi renklerle boya
   */
  class MapView {
    constructor(container, opts = {}) {
      this.opts = Object.assign({ clickable: 'members', zoom: true, hoverNames: false, political: true }, opts);
      this.region = opts.region || 'world';
      this.container = container;
      const { p, H } = buildProjection(this.region);
      // "fill": harita kabını doldurur; kutu dışındaki kara/deniz de çizilir,
      // böylece geniş ya da uzun ekranlarda kesik kenar görünmez.
      this.fill = opts.fill ?? this.opts.zoom;
      if (this.fill) p.clipExtent([[-W, -W], [2 * W, H + W]]);
      this.proj = p;
      this.H = H;
      this.V = { vx: 0, vy: 0, vw: W, vh: H };
      this.path = d3.geoPath(p);
      this.k = 1;
      this.tx = 0;
      this.ty = 0;
      this.maxK = A.REGIONS[this.region].maxK || 12;
      this.members = new Set(opts.members || A.regionCountries(this.region).map((c) => c.id));
      this.els = new Map(); // id → [path, marker?]
      this.bounds = new Map(); // id → [[x0,y0],[x1,y1]]
      this.labels = new Map();
      this.markers = [];
      this._build();
      this._bind();
    }

    _build() {
      const svg = (this.svg = svgEl('svg', {
        viewBox: `0 0 ${W} ${this.H}`,
        class: 'map',
        role: 'img',
        'aria-label': `${A.REGIONS[this.region].name} siyasi haritası`,
        preserveAspectRatio: 'xMidYMid meet',
      }));
      svg.append(this.fill
        ? svgEl('rect', { class: 'sea', x: -W, y: -W, width: 3 * W, height: this.H + 2 * W })
        : svgEl('rect', { class: 'sea', x: 0, y: 0, width: W, height: this.H }));
      const zoom = (this.gZoom = svgEl('g', { class: 'zoom' }));
      svg.append(zoom);
      const grat = svgEl('path', { class: 'graticule', d: this.path(d3.geoGraticule10()) || '' });
      zoom.append(grat);
      this.gLand = svgEl('g', { class: 'land' });
      this.gMarks = svgEl('g', { class: 'marks' });
      this.gTop = svgEl('g', { class: 'top' });
      this.gLabels = svgEl('g', { class: 'labels' });
      zoom.append(this.gLand, this.gMarks, this.gTop, this.gLabels);

      const clickAll = this.opts.clickable === 'all';
      for (const f of features()) {
        const d = this.path(f);
        if (!d) continue;
        const isCountry = !!A.byId[f.id];
        const isMember = this.members.has(f.id);
        const el = svgEl('path', { d, 'data-id': f.id });
        const cls = ['cty'];
        if (!isCountry) cls.push('terr');
        else if (!isMember) cls.push('ctx');
        if (isCountry && (isMember || clickAll) && this.opts.clickable !== 'none') cls.push('int');
        el.setAttribute('class', cls.join(' '));
        if (isCountry && this.opts.political) el.style.setProperty('--pf', A.politicalColor(f.id));
        this.gLand.append(el);
        this.els.set(f.id, [el]);
        const b = this.path.bounds(f);
        this.bounds.set(f.id, b);
      }

      // Küçük ülkeler (ve geometrisi olmayanlar) için dairesel işaretçi.
      for (const c of A.countries) {
        const relevant = this.members.has(c.id) || clickAll;
        if (!relevant) continue;
        const b = this.bounds.get(c.id);
        const size = b ? Math.max(b[1][0] - b[0][0], b[1][1] - b[0][1]) : 0;
        if (b && size >= 7) continue;
        const pt = this.proj(c.lp);
        const m = this.fill ? W * 0.5 : 0;
        if (!pt || pt[0] < -m || pt[1] < -m || pt[0] > W + m || pt[1] > this.H + m) continue;
        if (!b && !this.members.has(c.id)) continue;
        const g = svgEl('g', { class: 'mk-g', 'data-id': c.id, transform: `translate(${pt[0]},${pt[1]})` });
        const hit = svgEl('circle', { class: 'mk-hit', r: 10, 'data-id': c.id });
        const dot = svgEl('circle', { class: 'cty mk', r: 4, 'data-id': c.id });
        if (this.opts.clickable !== 'none') dot.classList.add('int');
        if (!this.members.has(c.id)) dot.classList.add('ctx');
        if (this.opts.political) dot.style.setProperty('--pf', A.politicalColor(c.id));
        g.append(hit, dot);
        this.gMarks.append(g);
        this.markers.push({ id: c.id, g, hit, dot });
        const arr = this.els.get(c.id) || [];
        arr.push(dot);
        this.els.set(c.id, arr);
        if (!b) this.bounds.set(c.id, [[pt[0] - 2, pt[1] - 2], [pt[0] + 2, pt[1] + 2]]);
      }

      this.tip = A.el('div', { class: 'map-tip', hidden: true });
      const ctrls = A.el('div', { class: 'map-ctrls' });
      if (this.opts.zoom) {
        ctrls.append(
          A.el('button', { type: 'button', class: 'mc', 'aria-label': 'Yakınlaştır', onclick: () => this.zoomBy(1.6) }, '+'),
          A.el('button', { type: 'button', class: 'mc', 'aria-label': 'Uzaklaştır', onclick: () => this.zoomBy(1 / 1.6) }, '−'),
          A.el('button', { type: 'button', class: 'mc', 'aria-label': 'Haritayı sıfırla', onclick: () => this.resetZoom() }, '⟲'),
        );
      }
      this.wrap = A.el('div', { class: 'map-wrap' + (this.opts.zoom ? ' zoomable' : '') + (this.fill ? ' fill' : '') }, svg, this.tip, ctrls);
      this.container.append(this.wrap);
      this._ensureHome();
      this._apply();
    }

    /**
     * Başlangıç görünümü: uzun (dikey) ya da çok geniş kaplarda kutu küçük
     * kalmasın diye "sığdır" ile "doldur" arasında bir yakınlık seçilir.
     */
    _homeView() {
      const { vx, vy, vw, vh } = this.V;
      const ratio = Math.max(vh / this.H, vw / W);
      const k = ratio > 1.15 ? Math.min(Math.pow(ratio, 0.65), this.maxK) : 1;
      return { k, tx: vx + vw / 2 - (W / 2) * k, ty: vy + vh / 2 - (this.H / 2) * k };
    }
    _ensureHome() {
      if (this._homed) return;
      this._fitView();
      if (!this.svg.clientWidth || !this.svg.clientHeight) return;
      this._homed = true;
      Object.assign(this, this._homeView());
    }

    // ── Koordinat dönüşümleri ─────────────────────────────────────────────
    _unitsPerPx() {
      const m = this.svg.getScreenCTM();
      return m && m.a ? 1 / m.a : W / Math.max(1, this.svg.clientWidth || W);
    }
    _toUnits(clientX, clientY) {
      const m = this.svg.getScreenCTM();
      if (!m) return [0, 0];
      const pt = this.svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const r = pt.matrixTransform(m.inverse());
      return [r.x, r.y];
    }
    /** Ekran noktası → harita (yakınlaştırma öncesi) koordinatı. */
    toMap(clientX, clientY) {
      const [u, v] = this._toUnits(clientX, clientY);
      return [(u - this.tx) / this.k, (v - this.ty) / this.k];
    }

    /** viewBox'ı kabın en-boy oranına genişlet (kutu ortada kalır). */
    _fitView() {
      if (!this.fill) return;
      const cw = this.svg.clientWidth, ch = this.svg.clientHeight;
      if (!cw || !ch) return;
      const a = cw / ch, b = W / this.H;
      let vx = 0, vy = 0, vw = W, vh = this.H;
      if (a > b) { vw = Math.min(this.H * a, 3 * W); vx = (W - vw) / 2; }
      else { vh = Math.min(W / a, this.H + 2 * W); vy = (this.H - vh) / 2; }
      const V = this.V;
      if (Math.abs(V.vx - vx) < 0.5 && Math.abs(V.vy - vy) < 0.5 && Math.abs(V.vw - vw) < 0.5 && Math.abs(V.vh - vh) < 0.5) return;
      this.V = { vx, vy, vw, vh };
      this.svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
    }
    _clamp() {
      const { vx, vy, vw, vh } = this.V;
      this.k = Math.min(this.maxK, Math.max(1, this.k));
      const k1 = 1 - this.k;
      this.tx = Math.min(vx * k1, Math.max((vx + vw) * k1, this.tx));
      this.ty = Math.min(vy * k1, Math.max((vy + vh) * k1, this.ty));
    }
    /** Görünür alanın harita koordinatlarındaki dikdörtgeni. */
    viewRect() {
      const { vx, vy, vw, vh } = this.V;
      return { x: (vx - this.tx) / this.k, y: (vy - this.ty) / this.k, w: vw / this.k, h: vh / this.k };
    }
    _apply() {
      this._clamp();
      this.gZoom.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.k})`);
      const upp = this._unitsPerPx() / this.k;
      this.upp = upp;
      for (const m of this.markers) {
        m.dot.setAttribute('r', Math.max(4.5 * upp, 0.6));
        m.hit.setAttribute('r', 13 * upp);
      }
      for (const lab of this.labels.values()) lab.setAttribute('font-size', 13 * upp);
      if (this.onZoom) this.onZoom();
    }
    zoomBy(f, cx, cy) {
      const px = cx ?? this.V.vx + this.V.vw / 2;
      const py = cy ?? this.V.vy + this.V.vh / 2;
      const k2 = Math.min(this.maxK, Math.max(1, this.k * f));
      this.tx = px - ((px - this.tx) * k2) / this.k;
      this.ty = py - ((py - this.ty) * k2) / this.k;
      this.k = k2;
      this._apply();
    }
    resetZoom(animate = true) {
      this._fitView();
      const h = this._homeView();
      this._animateTo(h.k, h.tx, h.ty, animate);
    }

    _animateTo(k, tx, ty, animate = true) {
      cancelAnimationFrame(this._raf);
      if (!animate || A.reducedMotion()) {
        Object.assign(this, { k, tx, ty });
        this._apply();
        return;
      }
      const k0 = this.k, x0 = this.tx, y0 = this.ty;
      const t0 = performance.now();
      const dur = 450;
      const step = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.k = k0 + (k - k0) * e;
        this.tx = x0 + (tx - x0) * e;
        this.ty = y0 + (ty - y0) * e;
        this._apply();
        if (t < 1) this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    }

    /** Verilen ülkeleri ekrana sığdır. `minSize`: ekranda en az kaç birim kaplasın. */
    zoomTo(ids, { maxK = this.maxK, pad = 0.18, onlyIfSmall = false } = {}) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of [].concat(ids)) {
        const b = this.bounds.get(id);
        if (!b) continue;
        x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]);
        x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]);
      }
      if (!isFinite(x0)) return;
      this._ensureHome();
      this._fitView();
      const w = Math.max(x1 - x0, 8), h = Math.max(y1 - y0, 8);
      const { vx, vy, vw, vh } = this.V;
      if (onlyIfSmall && Math.max(w / W, h / this.H) > 0.06) {
        // Yeterince büyük: mevcut görünümde tamamen görünüyorsa dokunma.
        const r = this.viewRect();
        if (x0 >= r.x && y0 >= r.y && x1 <= r.x + r.w && y1 <= r.y + r.h) return;
        return this.resetZoom();
      }
      let k = Math.min(vw / (w * (1 + pad * 2)), vh / (h * (1 + pad * 2)), maxK);
      k = Math.max(1, k);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      this._animateTo(k, vx + vw / 2 - cx * k, vy + vh / 2 - cy * k);
    }

    // ── Olaylar: tıklama, sürükleme, kıstırma, tekerlek ───────────────────
    _bind() {
      const svg = this.svg;
      const pointers = new Map();
      let start = null; // tek parmak sürükleme başlangıcı
      let pinch = null;
      let moved = false;

      const hitId = (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const t = el && el.closest && el.closest('[data-id]');
        return t ? t.getAttribute('data-id') : null;
      };

      svg.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        if (this.onPointerDown && this.onPointerDown(e) === false) return;
        pointers.set(e.pointerId, [e.clientX, e.clientY]);
        try { svg.setPointerCapture(e.pointerId); } catch (_) { /* yok say */ }
        if (pointers.size === 1) {
          start = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
          moved = false;
        } else if (pointers.size === 2 && this.opts.zoom) {
          const [a, b] = [...pointers.values()];
          pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: this.k, mid: this._toUnits((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), tx: this.tx, ty: this.ty };
          moved = true;
        }
      });
      svg.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) {
          if (this.opts.hoverNames && e.pointerType === 'mouse') this._hover(e, hitId(e));
          return;
        }
        pointers.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch && pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          const k2 = Math.min(this.maxK, Math.max(1, (pinch.k * d) / pinch.d));
          const mid = this._toUnits((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          // pinch.mid noktasındaki harita noktası parmakların ortasında kalsın
          const mx = (pinch.mid[0] - pinch.tx) / pinch.k, my = (pinch.mid[1] - pinch.ty) / pinch.k;
          this.k = k2;
          this.tx = mid[0] - mx * k2;
          this.ty = mid[1] - my * k2;
          this._apply();
          return;
        }
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) > 6) moved = true;
        if (moved && this.opts.zoom && this.k > 1.001) {
          const upp = this._unitsPerPx();
          this.tx = start.tx + dx * upp;
          this.ty = start.ty + dy * upp;
          this._apply();
        }
      });
      const end = (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (pointers.size === 0) {
          if (!moved && e.type === 'pointerup' && this.opts.clickable !== 'none') {
            const id = hitId(e);
            if (id && this._clickable(id)) {
              if (this.opts.hoverNames) this._hover(e, id, true);
              this.opts.onClick && this.opts.onClick(id, e);
            } else if (this.opts.onBackground) this.opts.onBackground(e);
          }
          start = null;
        } else if (pointers.size === 1) {
          const [p] = [...pointers.values()];
          start = { x: p[0], y: p[1], tx: this.tx, ty: this.ty };
        }
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
      svg.addEventListener('pointerleave', () => { if (!pointers.size) this.tip.hidden = true; });
      if (this.opts.zoom) {
        svg.addEventListener('wheel', (e) => {
          e.preventDefault();
          const [u, v] = this._toUnits(e.clientX, e.clientY);
          this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), u, v);
        }, { passive: false });
      }
      this._ro = new ResizeObserver(() => { this._fitView(); this._ensureHome(); this._apply(); });
      this._ro.observe(svg);
    }
    _clickable(id) {
      if (!A.byId[id]) return false;
      if (this.opts.clickable === 'all') return true;
      return this.members.has(id);
    }
    _hover(e, id, sticky) {
      const name = id ? (A.byId[id] ? A.byId[id].n : A.territories[id]) : null;
      if (!name) { this.tip.hidden = true; return; }
      const r = this.wrap.getBoundingClientRect();
      this.tip.textContent = name;
      this.tip.hidden = false;
      this.tip.style.left = `${e.clientX - r.left}px`;
      this.tip.style.top = `${e.clientY - r.top}px`;
      if (sticky) {
        clearTimeout(this._tipT);
        this._tipT = setTimeout(() => { this.tip.hidden = true; }, 1600);
      }
    }

    // ── Durum (sınıf) ve boya ─────────────────────────────────────────────
    has(id) { return this.els.has(id); }
    add(id, ...cls) { for (const el of this.els.get(id) || []) el.classList.add(...cls); }
    remove(id, ...cls) { for (const el of this.els.get(id) || []) el.classList.remove(...cls); }
    toggle(id, cls, on) { for (const el of this.els.get(id) || []) el.classList.toggle(cls, on); }
    clearClass(...cls) { for (const arr of this.els.values()) for (const el of arr) el.classList.remove(...cls); }
    paint(id, color) { for (const el of this.els.get(id) || []) el.style.setProperty('--pf', color); }
    flash(id, cls = 'bad', ms = 650) {
      this.add(id, cls);
      setTimeout(() => this.remove(id, cls), ms);
    }
    /** Tüm üyelere sınıf ekle (ör. 'blank'). */
    eachMember(fn) { for (const id of this.members) if (this.els.has(id)) fn(id); }
    /** Ülkeyi en üste taşı (vurgu kenarı komşuların altında kalmasın). */
    raise(id) {
      const [p] = this.els.get(id) || [];
      if (p && p.parentNode === this.gLand) this.gLand.append(p);
    }

    // ── Etiketler ─────────────────────────────────────────────────────────
    label(id, text, cls = '') {
      this.unlabel(id);
      const c = A.byId[id];
      if (!c) return;
      let pt = this.proj(c.lp);
      if (!pt) {
        const b = this.bounds.get(id);
        if (!b) return;
        pt = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
      }
      const t = svgEl('text', { x: pt[0], y: pt[1], class: 'lbl ' + cls, 'text-anchor': 'middle', dy: '0.35em' });
      t.textContent = text ?? c.n;
      t.setAttribute('font-size', 13 * (this.upp || 1));
      this.gLabels.append(t);
      this.labels.set(id, t);
      return t;
    }
    unlabel(id) {
      const t = this.labels.get(id);
      if (t) { t.remove(); this.labels.delete(id); }
    }
    clearLabels() { for (const t of this.labels.values()) t.remove(); this.labels.clear(); }
    flashLabel(id, text, ms = 1400, cls = '') {
      const t = this.label(id, text, cls);
      if (t) setTimeout(() => { if (this.labels.get(id) === t) this.unlabel(id); }, ms);
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      this._ro && this._ro.disconnect();
      this.wrap.remove();
    }
  }

  A.MapView = MapView;
  A.MAP_W = W;
})();
