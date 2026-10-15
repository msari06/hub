/* Atlas — bayrak ve başkent oyunları: Bayrak Bil, Bayrağı Seç, Bayrak Renkleri,
   Bayrağı Boya, Başkentler. */
(function () {
  'use strict';
  const A = window.Atlas;
  const el = A.el;
  const b = (s) => `<b>${A.esc(s)}</b>`;
  const SVGNS = 'http://www.w3.org/2000/svg';

  A.registerGame({
    id: 'flag2name', cat: 'flag', title: 'Bayrak Bil', desc: 'Bayrağı gör, ülkesini dört seçenekten bul.',
    how: 'Ekrandaki bayrağın hangi ülkeye ait olduğunu seç. Çeldiriciler renkleri benzeyen bayraklardan gelir; Romanya ile Çad gibi tuzaklara dikkat.',
    options: [A.COUNT_OPTION],
    start(g) {
      const pool = A.regionCountries(g.region);
      A.runSeries(g, { items: A.takeItems(g, pool, g.opts.count), ask: (c) => A.Q.flag2name(g, c, pool), okDelay: 650 });
    },
  });

  A.registerGame({
    id: 'name2flag', cat: 'flag', title: 'Bayrağı Seç', desc: 'Ülkenin adını gör, doğru bayrağı seç.',
    how: 'Adı verilen ülkenin bayrağını dört bayrak arasından seç. Seçenekler birbirine benzeyen bayraklardan oluşur.',
    options: [A.COUNT_OPTION],
    start(g) {
      const pool = A.regionCountries(g.region);
      A.runSeries(g, { items: A.takeItems(g, pool, g.opts.count), ask: (c) => A.Q.name2flag(g, c, pool), okDelay: 650 });
    },
  });

  A.registerGame({
    id: 'capitals', cat: 'capital', title: 'Başkentler', desc: 'Ülkelerin başkentlerini ya da başkentlerin ülkelerini bil.',
    how: 'Yönü sen seç: ülkeden başkente ya da başkentten ülkeye. Seçenekler hep yakın ülkelerin başkentlerinden gelir.',
    options: [
      { key: 'dir', label: 'Yön', values: ['c2cap', 'cap2c'], labels: ['Ülke → Başkent', 'Başkent → Ülke'], def: 'c2cap' },
      A.COUNT_OPTION,
    ],
    start(g) {
      const pool = A.regionCountries(g.region).filter((c) => c.capq);
      A.runSeries(g, { items: A.takeItems(g, pool, g.opts.count), ask: (c) => A.Q.capital(g, c, pool, g.opts.dir), okDelay: 650 });
    },
  });

  // ── Renk paleti bileşeni ───────────────────────────────────────────────
  function palette({ multi, onChange }) {
    const wrap = el('div', { class: 'palette', role: multi ? 'group' : 'radiogroup', 'aria-label': 'Renkler' });
    const chips = {};
    const selected = new Set();
    for (const [key, col] of Object.entries(A.COLORS)) {
      const chip = el('button', { type: 'button', class: 'swatch', 'data-key': key, 'aria-pressed': 'false', title: col.n },
        el('span', { class: 'sw', style: `background:${col.hex}` }), el('span', { class: 'sw-n' }, col.n));
      chip.addEventListener('click', () => {
        if (chip.disabled) return;
        if (multi) {
          if (selected.has(key)) selected.delete(key); else selected.add(key);
        } else {
          selected.clear();
          selected.add(key);
        }
        for (const [k, c] of Object.entries(chips)) {
          c.classList.toggle('on', selected.has(k));
          c.setAttribute('aria-pressed', String(selected.has(k)));
        }
        onChange && onChange(selected);
      });
      chips[key] = chip;
      wrap.append(chip);
    }
    return { el: wrap, chips, selected, lock() { Object.values(chips).forEach((c) => { c.disabled = true; }); } };
  }

  /** "Devam" düğmesi; Enter ile de ilerler. */
  function continueButton(host, label = 'Devam') {
    return new Promise((resolve) => {
      const btn = el('button', { type: 'button', class: 'btn primary' }, label);
      const onKey = (e) => { if (e.key === 'Enter') go(); };
      const go = () => { document.removeEventListener('keydown', onKey); resolve(); };
      btn.addEventListener('click', go);
      host.append(btn);
      setTimeout(() => document.addEventListener('keydown', onKey), 250);
      btn.focus({ preventScroll: true });
    });
  }

  // ── Bayrak Renkleri ─────────────────────────────────────────────────────
  A.registerGame({
    id: 'colors', cat: 'flag', title: 'Bayrak Renkleri', desc: 'Bir ülkenin bayrağında hangi renkler var? Hepsini işaretle.',
    how: 'Ülkenin bayrağındaki belirgin renklerin hepsini seç ve kontrol et (armadaki küçük ayrıntılar sayılmaz). Kolay modda bayrak siyah-beyaz gösterilir, desen ipucu verir. Aynı renk ailesindeki tonlar (Mavi/Açık Mavi, Kırmızı/Bordo) birbirinin yerine geçer.',
    options: [
      { key: 'mode', label: 'Zorluk', values: ['easy', 'hard'], labels: ['Siyah-beyaz ipucu', 'Sadece ad'], def: 'easy' },
      { key: 'count', label: 'Soru sayısı', values: [10, 20], labels: ['10', '20'], def: 10 },
    ],
    start(g) {
      const pool = A.regionCountries(g.region);
      A.runSeries(g, {
        items: A.takeItems(g, pool, g.opts.count),
        okDelay: 0,
        badDelay: 0,
        ask: async (c) => {
          const flag = A.flagImg(c.id, 'flag xl' + (g.opts.mode === 'easy' ? ' gray' : ' hidden-flag'));
          const stage = el('div', { class: 'flag-stage' }, flag);
          if (g.opts.mode === 'hard') stage.append(el('div', { class: 'flag-q', 'aria-hidden': 'true' }, '?'));
          g.showCard(stage);
          g.setPrompt(`${b(c.n)} bayrağında hangi renkler var?`);
          const check = el('button', { type: 'button', class: 'btn primary', disabled: true }, 'Kontrol et');
          const pal = palette({ multi: true, onChange: (sel) => { check.disabled = !sel.size; } });
          const actions = el('div', { class: 'row-center' }, check);
          g.setDock(pal.el, actions);
          await new Promise((res) => check.addEventListener('click', res, { once: true }));
          pal.lock();
          check.remove();
          const want = A.colorFamilies(c.col);
          const got = A.colorFamilies([...pal.selected]);
          for (const [key, chip] of Object.entries(pal.chips)) {
            const fam = A.COLORS[key].fam;
            const picked = pal.selected.has(key);
            if (picked && want.has(fam)) chip.classList.add('right');
            else if (picked) chip.classList.add('wrong');
            else if (c.col.includes(key)) chip.classList.add('missed');
          }
          let inter = 0;
          for (const f of got) if (want.has(f)) inter++;
          const exact = inter === want.size && got.size === want.size;
          g.answer(exact, 'flag');
          flag.classList.remove('gray', 'hidden-flag');
          const q = stage.querySelector('.flag-q');
          q && q.remove();
          stage.append(el('p', { class: 'reveal-line' }, exact ? 'Tam isabet! ' : 'Doğrusu: ', c.col.map((k) => A.COLORS[k].n).join(', ')));
          await continueButton(actions);
          return { score: inter / (want.size + got.size - inter), ok: exact };
        },
      });
    },
  });

  // ── Bayrağı Boya: şablonlar ─────────────────────────────────────────────
  // h: yatay şeritler, v: dikey şeritler, nordic: İskandinav haçı,
  // disc: daire, swiss: kare + haç, lh: solda dikey bant + sağda yatay şeritler,
  // tri: soldan üçgen + yatay şeritler. w: şerit oranları, x: bant/üçgen genişliği.
  const TEMPLATES = {
    DE: ['h', 'siyah kirmizi sari'], AT: ['h', 'kirmizi beyaz kirmizi'], HU: ['h', 'kirmizi beyaz yesil'],
    NL: ['h', 'kirmizi beyaz mavi'], RU: ['h', 'beyaz mavi kirmizi'], BG: ['h', 'beyaz yesil kirmizi'],
    LT: ['h', 'sari yesil kirmizi'], EE: ['h', 'mavi siyah beyaz'], LU: ['h', 'kirmizi beyaz acikmavi'],
    UA: ['h', 'mavi sari'], PL: ['h', 'beyaz kirmizi'], ID: ['h', 'kirmizi beyaz'], MC: ['h', 'kirmizi beyaz'],
    YE: ['h', 'kirmizi beyaz siyah'], AM: ['h', 'kirmizi mavi turuncu'], GA: ['h', 'yesil sari mavi'],
    SL: ['h', 'yesil beyaz mavi'], LV: ['h', 'bordo beyaz bordo', { w: [2, 1, 2] }],
    CO: ['h', 'sari mavi kirmizi', { w: [2, 1, 1] }], MU: ['h', 'kirmizi mavi sari yesil'],
    TH: ['h', 'kirmizi beyaz mavi beyaz kirmizi', { w: [1, 1, 2, 1, 1] }], BO: ['h', 'kirmizi sari yesil'],
    FR: ['v', 'mavi beyaz kirmizi'], IT: ['v', 'yesil beyaz kirmizi'], IE: ['v', 'yesil beyaz turuncu'],
    BE: ['v', 'siyah sari kirmizi'], RO: ['v', 'mavi sari kirmizi'], TD: ['v', 'mavi sari kirmizi'],
    ML: ['v', 'yesil sari kirmizi'], GN: ['v', 'kirmizi sari yesil'], CI: ['v', 'turuncu beyaz yesil'],
    NG: ['v', 'yesil beyaz yesil'], PE: ['v', 'kirmizi beyaz kirmizi'],
    DK: ['nordic', 'kirmizi beyaz'], SE: ['nordic', 'mavi sari'], FI: ['nordic', 'beyaz mavi'],
    NO: ['nordic', 'kirmizi beyaz mavi'], IS: ['nordic', 'mavi beyaz kirmizi'],
    JP: ['disc', 'beyaz kirmizi'], BD: ['disc', 'yesil kirmizi', { x: 0.45 }], PW: ['disc', 'acikmavi sari', { x: 0.45 }],
    CH: ['swiss', 'kirmizi beyaz'],
    BJ: ['lh', 'yesil sari kirmizi', { x: 0.4 }], MG: ['lh', 'beyaz kirmizi yesil', { x: 0.33 }],
    AE: ['lh', 'kirmizi yesil beyaz siyah', { x: 0.25 }],
    CZ: ['tri', 'mavi beyaz kirmizi', { x: 0.5 }], SD: ['tri', 'yesil kirmizi beyaz siyah', { x: 0.33 }],
    PS: ['tri', 'kirmizi siyah beyaz yesil', { x: 0.33 }], BS: ['tri', 'siyah acikmavi sari acikmavi', { x: 0.42, w: [1, 1, 1] }],
  };
  A.FLAG_TEMPLATES = TEMPLATES;

  /** Şablondan boyanabilir SVG üretir → { svg, regions: [{ node, key }] } */
  function buildTemplate(id) {
    const [type, colors, o = {}] = TEMPLATES[id];
    const keys = colors.split(' ');
    const Wd = type === 'swiss' ? 200 : 300;
    const Ht = 200;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${Wd} ${Ht}`);
    svg.setAttribute('class', 'paint-flag');
    const regions = [];
    const add = (tag, attrs, key) => {
      const n = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      n.setAttribute('class', 'pr');
      n.setAttribute('tabindex', '0');
      svg.append(n);
      regions.push({ node: n, key });
      return n;
    };
    const stripes = (ks, w, x0, horizontal) => {
      const weights = w || ks.map(() => 1);
      const sum = weights.reduce((p, q) => p + q, 0);
      let pos = 0;
      ks.forEach((k, i) => {
        const span = ((horizontal ? Ht : Wd - x0) * weights[i]) / sum;
        if (horizontal) add('rect', { x: x0, y: pos, width: Wd - x0, height: span }, k);
        else add('rect', { x: x0 + pos, y: 0, width: span, height: Ht }, k);
        pos += span;
      });
    };
    const cross = (cx, cy, half) =>
      `M0 ${cy - half}H${cx - half}V0H${cx + half}V${cy - half}H${Wd}V${cy + half}H${cx + half}V${Ht}H${cx - half}V${cy + half}H0Z`;
    if (type === 'h') stripes(keys, o.w, 0, true);
    else if (type === 'v') stripes(keys, o.w, 0, false);
    else if (type === 'nordic') {
      add('rect', { x: 0, y: 0, width: Wd, height: Ht }, keys[0]);
      const cx = 108, cy = 100;
      add('path', { d: cross(cx, cy, keys.length === 3 ? 30 : 20) }, keys[1]);
      if (keys[2]) add('path', { d: cross(cx, cy, 14) }, keys[2]);
    } else if (type === 'disc') {
      add('rect', { x: 0, y: 0, width: Wd, height: Ht }, keys[0]);
      add('circle', { cx: Wd * (o.x || 0.5), cy: Ht / 2, r: 60 }, keys[1]);
    } else if (type === 'swiss') {
      add('rect', { x: 0, y: 0, width: Wd, height: Ht }, keys[0]);
      add('path', { d: 'M85 40h30v45h45v30h-45v45h-30v-45h-45v-30h45z' }, keys[1]);
    } else if (type === 'lh') {
      const x = Wd * o.x;
      stripes(keys.slice(1), o.w, x, true);
      add('rect', { x: 0, y: 0, width: x, height: Ht }, keys[0]);
    } else if (type === 'tri') {
      stripes(keys.slice(1), o.w, 0, true);
      add('path', { d: `M0 0L${Wd * o.x} ${Ht / 2}L0 ${Ht}Z` }, keys[0]);
    }
    return { svg, regions };
  }

  A.registerGame({
    id: 'paintflag', cat: 'flag', title: 'Bayrağı Boya', desc: 'Boş bayrak şablonunu doğru renklerle boya.',
    how: 'Paletten bir renk seç, sonra bayraktaki bir alana dokunarak boya. Bütün alanlar boyanınca kontrol et. Mavi/Açık Mavi ve Kırmızı/Bordo aynı aile sayılır.',
    options: [{ key: 'count', label: 'Bayrak sayısı', values: [5, 10, 0], labels: ['5', '10', 'Tümü'], def: 5 }],
    start(g) {
      let pool = A.regionCountries(g.region).filter((c) => TEMPLATES[c.id]);
      if (pool.length < 5) pool = A.countries.filter((c) => TEMPLATES[c.id]);
      A.runSeries(g, {
        items: A.takeItems(g, pool, g.opts.count),
        okDelay: 0,
        badDelay: 0,
        ask: async (c) => {
          const { svg, regions } = buildTemplate(c.id);
          const stage = el('div', { class: 'paint-stage' }, svg);
          g.showCard(stage);
          g.setPrompt(`${b(c.n)} bayrağını boya`);
          const check = el('button', { type: 'button', class: 'btn primary', disabled: true }, 'Kontrol et');
          let brush = null;
          const pal = palette({ multi: false, onChange: (sel) => { brush = [...sel][0]; } });
          const painted = new Map();
          const paint = (r) => {
            if (!brush || check.dataset.done) return;
            painted.set(r, brush);
            r.node.style.fill = A.COLORS[brush].hex;
            r.node.classList.add('filled');
            A.sound.play('tick');
            check.disabled = painted.size < regions.length;
          };
          regions.forEach((r) => {
            r.node.addEventListener('click', () => {
              if (!brush) { stage.classList.add('nudge'); setTimeout(() => stage.classList.remove('nudge'), 500); return; }
              paint(r);
            });
            r.node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); paint(r); } });
          });
          const actions = el('div', { class: 'row-center' }, check);
          g.setDock(pal.el, actions);
          // İlk rengi önceden seç: dokunmaya hemen başlanabilsin.
          pal.chips[Object.keys(A.COLORS)[0]].click();
          await new Promise((res) => check.addEventListener('click', res, { once: true }));
          check.dataset.done = '1';
          pal.lock();
          check.remove();
          let right = 0;
          for (const r of regions) {
            const ok = A.COLORS[painted.get(r)].fam === A.COLORS[r.key].fam;
            if (ok) right++;
            else r.node.classList.add('wrong-part');
          }
          const exact = right === regions.length;
          g.answer(exact, 'flag');
          stage.append(el('div', { class: 'paint-ref' }, el('span', { class: 'opt-l' }, 'Gerçek bayrak'), A.flagImg(c.id, 'flag md')));
          stage.append(el('p', { class: 'reveal-line' }, exact ? 'Kusursuz boyadın!' : `${regions.length} alandan ${right} tanesi doğru.`));
          await continueButton(actions);
          return { score: right / regions.length, ok: exact };
        },
      });
    },
  });
})();
