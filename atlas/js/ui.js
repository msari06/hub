/* Atlas — arayüz: oyun ekranı, kurulum, sonuç, bildirim, ilerleme ve rozetler. */
(function () {
  'use strict';
  const A = window.Atlas;
  const el = A.el;
  const ui = (A.ui = {});

  // ── Bildirim ve pencere ─────────────────────────────────────────────────
  ui.toast = (html, kind = '') => {
    const host = document.getElementById('toasts');
    const t = el('div', { class: `toast ${kind}`, role: 'status', html });
    host.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  };

  ui.modal = (content, { onClose, cls = '' } = {}) => {
    const host = document.getElementById('modal');
    host.innerHTML = '';
    const box = el('div', { class: `sheet ${cls}`, role: 'dialog', 'aria-modal': 'true' }, content);
    const close = () => {
      host.hidden = true;
      host.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      onClose && onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    host.append(box);
    host.hidden = false;
    host.onclick = (e) => { if (e.target === host) close(); };
    document.addEventListener('keydown', onKey);
    const focusable = box.querySelector('[data-autofocus]') || box.querySelector('button');
    focusable && focusable.focus({ preventScroll: true });
    return close;
  };

  // ── Ülke adı girişi (isteğe bağlı otomatik tamamlama) ──────────────────
  ui.countryInput = ({ placeholder = 'Ülke adı yaz…', suggestPool = null, onSubmit, onInput, id = 'country-input' }) => {
    const input = el('input', {
      id, type: 'text', class: 'cinput', placeholder, autocomplete: 'off', autocapitalize: 'words',
      spellcheck: 'false', enterkeyhint: 'go', 'aria-label': placeholder,
    });
    const list = el('div', { class: 'suggest', role: 'listbox', hidden: true });
    const wrap = el('div', { class: 'cinput-wrap' }, input, list);
    let items = [];
    let active = 0;
    const render = () => {
      list.innerHTML = '';
      if (!suggestPool || !items.length) { list.hidden = true; return; }
      items.forEach((c, i) => {
        const b = el('button', { type: 'button', class: 'sg' + (i === active ? ' on' : ''), role: 'option' }, c.n);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); submit(c.id, c.n); });
        list.append(b);
      });
      list.hidden = false;
    };
    const submit = (cid, text) => {
      onSubmit && onSubmit(cid, text);
    };
    input.addEventListener('input', () => {
      if (suggestPool) { items = A.suggest(input.value, suggestPool, 6); active = 0; render(); }
      onInput && onInput(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && items.length) { active = (active + 1) % items.length; render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && items.length) { active = (active - 1 + items.length) % items.length; render(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const exact = A.matchName(input.value);
        if (exact) submit(exact, input.value);
        else if (items[active]) submit(items[active].id, items[active].n);
        else submit(null, input.value);
      }
    });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
    return {
      el: wrap, input,
      clear() { input.value = ''; items = []; render(); },
      focus() { input.focus({ preventScroll: true }); },
    };
  };

  // ── Seçenek düğmeleri ───────────────────────────────────────────────────
  /**
   * Çoktan seçmeli düğmeler. Tıklanınca kilitlenir, doğru/yanlışı işaretler,
   * Promise<boolean> döner (doğru mu). Klavye: 1-4.
   */
  ui.choose = (host, options, { correct, render, cls = '' }) =>
    new Promise((resolve) => {
      const grid = el('div', { class: `choices ${cls}` });
      const btns = options.map((o, i) => {
        const b = el('button', { type: 'button', class: 'choice', 'data-k': i + 1 });
        const content = render(o);
        b.append(el('span', { class: 'kbd', 'aria-hidden': 'true' }, String(i + 1)), content);
        b.addEventListener('click', () => pick(i));
        grid.append(b);
        return b;
      });
      let done = false;
      const onKey = (e) => {
        if (e.target && e.target.tagName === 'INPUT') return;
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= btns.length) pick(n - 1);
      };
      document.addEventListener('keydown', onKey);
      function pick(i) {
        if (done) return;
        if (!grid.isConnected) { document.removeEventListener('keydown', onKey); return; }
        done = true;
        document.removeEventListener('keydown', onKey);
        const ok = options[i] === correct;
        btns.forEach((b, j) => {
          b.disabled = true;
          if (options[j] === correct) b.classList.add('right');
          else if (j === i) b.classList.add('wrong');
        });
        resolve(ok);
      }
      host.innerHTML = '';
      host.append(grid);
    });

  // ── İlerleme, istatistik ve rozetler ───────────────────────────────────
  const P = (A.progress = {
    stats: Object.assign(
      { played: 0, correct: 0, flags: 0, mapHits: 0, perfect: 0, bestStreak: 0, regions: [], games: [], daily: [], puzzles: {} },
      A.store.get('stats', {}),
    ),
    unlocked: A.store.get('badges', {}),
    save() { A.store.set('stats', this.stats); A.store.set('badges', this.unlocked); },
  });

  A.BADGES = [
    { id: 'ilk', n: 'İlk Adım', d: 'Bir oyunu bitir.', ok: (s) => s.played >= 1 },
    { id: 'kusursuz', n: 'Kusursuz', d: 'Bir oyunu %100 ile bitir.', ok: (s) => s.perfect >= 1 },
    { id: 'seri10', n: 'Seri 10', d: 'Üst üste 10 doğru cevap ver.', ok: (s) => s.bestStreak >= 10 },
    { id: 'seri25', n: 'Durdurulamaz', d: 'Üst üste 25 doğru cevap ver.', ok: (s) => s.bestStreak >= 25 },
    { id: 'bayrakci', n: 'Bayrakçı', d: '100 bayrak sorusunu doğru bil.', ok: (s) => s.flags >= 100 },
    { id: 'kartograf', n: 'Kartograf', d: 'Haritada 200 ülkeyi doğru bul.', ok: (s) => s.mapHits >= 200 },
    { id: 'kasif', n: 'Kâşif', d: 'Sekiz bölgenin hepsinde bir oyun bitir.', ok: (s) => s.regions.length >= 8 },
    { id: 'avrupa', n: 'Avrupa Ustası', d: "Avrupa'da Haritada Bul'u %100 bitir.", ok: (s, r) => r && r.game === 'find' && r.region === 'europe' && r.pct === 100 && r.full },
    { id: 'dunya', n: 'Dünya Vatandaşı', d: "Dünya'da Hepsini Yaz'da 197 ülkenin hepsini bul.", ok: (s, r) => r && r.game === 'typeall' && r.region === 'world' && r.pct === 100 },
    { id: 'yapboz', n: 'Yapbozcu', d: 'Bir yapbozu tamamla.', ok: (s) => (s.puzzles.jigsaw || 0) >= 1 },
    { id: 'dortrenk', n: 'Dört Renk', d: 'Haritayı Boya bulmacasını çöz.', ok: (s) => (s.puzzles.coloring || 0) >= 1 },
    { id: 'rotaci', n: 'Rotacı', d: "Rota'da en kısa yolu bul.", ok: (s) => (s.puzzles.routePerfect || 0) >= 1 },
    { id: 'sadik', n: 'Sadık', d: "Günlük challenge'ı 3 gün üst üste oyna.", ok: (s) => dailyStreak(s.daily) >= 3 },
    { id: 'yildirim', n: 'Yıldırım', d: "60 Saniye'de 25 doğru yap.", ok: (s, r) => r && r.game === 'blitz' && r.correct >= 25 },
    { id: 'hayatta', n: 'Hayatta Kalan', d: "Hayatta Kal'da 30 doğruya ulaş.", ok: (s, r) => r && r.game === 'survival' && r.correct >= 30 },
    { id: 'renk', n: 'Renk Ustası', d: "Bayrak Renkleri'nde 10 bayrağın hepsini bil.", ok: (s, r) => r && r.game === 'colors' && r.pct === 100 && r.total >= 10 },
    { id: 'hepsi', n: 'Her Telden', d: '10 farklı oyun bitir.', ok: (s) => s.games.length >= 10 },
  ];

  function dailyStreak(dates) {
    const set = new Set(dates);
    let n = 0;
    const d = new Date();
    if (!set.has(A.dayKey(d))) d.setDate(d.getDate() - 1);
    while (set.has(A.dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  A.dailyStreak = () => dailyStreak(P.stats.daily);
  A.dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  P.checkBadges = (result) => {
    const fresh = [];
    for (const b of A.BADGES) {
      if (P.unlocked[b.id]) continue;
      if (b.ok(P.stats, result)) { P.unlocked[b.id] = A.dayKey(); fresh.push(b); }
    }
    P.save();
    fresh.forEach((b, i) => setTimeout(() => ui.toast(`<b>Rozet kazandın:</b> ${A.esc(b.n)}`, 'badge'), 400 + i * 700));
    return fresh;
  };

  // ── Rekorlar ────────────────────────────────────────────────────────────
  const recordKey = (game, region, optKey) => `best:${game}:${region}:${optKey}`;
  ui.getBest = (game, region, optKey = '') => A.store.get(recordKey(game, region, optKey), null);
  /** Daha iyi skor ya da aynı skorda daha kısa süre → yeni rekor. */
  function saveBest(game, region, optKey, res) {
    const prev = ui.getBest(game, region, optKey);
    const better = !prev || res.score > prev.score || (res.score === prev.score && res.time != null && prev.time != null && res.time < prev.time);
    if (better) A.store.set(recordKey(game, region, optKey), { score: res.score, label: res.label, time: res.time, at: A.dayKey() });
    return { better: better && !!prev, prev };
  }

  // ── Oyun ekranı ─────────────────────────────────────────────────────────
  let current = null;

  ui.exitGame = () => {
    if (!current) return;
    current.alive = false;
    current.cleanups.forEach((f) => { try { f(); } catch (e) { /* yok say */ } });
    current = null;
    document.getElementById('game').hidden = true;
    document.getElementById('game').innerHTML = '';
    document.getElementById('home').hidden = false;
    document.body.classList.remove('in-game');
    A.app && A.app.refresh();
  };

  ui.startGame = (gameId, region, opts = {}) => {
    if (current) ui.exitGame();
    const def = A.games[gameId];
    const root = document.getElementById('game');
    root.innerHTML = '';
    const optKey = (def.options || []).map((o) => `${o.key}=${opts[o.key]}`).join(',');
    const regionName = def.fixedRegion ? def.fixedRegionLabel || A.REGIONS[def.fixedRegion].name : A.REGIONS[region].name;

    const stProg = el('span', { class: 'st prog', hidden: true });
    const stScore = el('span', { class: 'st score', hidden: true });
    const stLives = el('span', { class: 'st lives', hidden: true });
    const stTime = el('span', { class: 'st time', hidden: true });
    const stStreak = el('span', { class: 'st streak', hidden: true });
    const hud = el('header', { class: 'hud' },
      el('button', { type: 'button', class: 'back', onclick: ui.exitGame, 'aria-label': 'Menüye dön' }, '←', el('span', {}, ' Menü')),
      el('div', { class: 'hud-title' }, el('b', {}, def.title), el('span', {}, regionName)),
      el('div', { class: 'hud-stats' }, stStreak, stProg, stScore, stLives, stTime),
    );
    const prompt = el('div', { class: 'prompt', 'aria-live': 'polite' });
    const mapHost = el('div', { class: 'map-host' });
    const cardHost = el('div', { class: 'card-host', hidden: true });
    const stage = el('div', { class: 'stage' }, mapHost, cardHost);
    const dock = el('div', { class: 'dock' });
    root.append(hud, prompt, stage, dock);
    document.getElementById('home').hidden = true;
    root.hidden = false;
    document.body.classList.add('in-game');
    window.scrollTo(0, 0);

    const seed = opts.seed ?? (Date.now() ^ (Math.random() * 1e9));
    const g = (current = {
      id: gameId, def, region, opts, optKey, alive: true, cleanups: [],
      rnd: A.rng(seed),
      root, prompt, stage, dock, mapHost, cardHost,
      streak: 0, t0: performance.now(),
      cleanup(fn) { this.cleanups.push(fn); },
      wait(ms) { return new Promise((res) => setTimeout(() => { if (g.alive) res(); }, ms)); },
      setPrompt(...nodes) {
        prompt.innerHTML = '';
        for (const n of nodes) prompt.append(typeof n === 'string' ? el('span', { html: n }) : n);
      },
      setDock(...nodes) { dock.innerHTML = ''; dock.append(...nodes.filter(Boolean)); },
      showMap() { mapHost.hidden = false; cardHost.hidden = true; },
      showCard(...nodes) {
        mapHost.hidden = true; cardHost.hidden = false;
        cardHost.innerHTML = '';
        cardHost.append(...nodes);
      },
      /** Haritayı (bir kez) oluşturur. */
      map(mopts = {}) {
        if (g._map && !mopts.fresh) return g._map;
        if (g._map) g._map.destroy();
        g.showMap();
        g._map = new A.MapView(mapHost, Object.assign({
          region: def.fixedRegion || region,
          onClick: (id, e) => g.onMapClick && g.onMapClick(id, e),
        }, mopts));
        g.cleanup(() => g._map && g._map.destroy());
        return g._map;
      },
      hud: {
        progress(i, n) { stProg.hidden = false; stProg.textContent = n ? `${i}/${n}` : String(i); },
        score(text) { stScore.hidden = false; stScore.textContent = text; },
        lives(n, max) { stLives.hidden = false; stLives.textContent = '●'.repeat(n) + '○'.repeat(Math.max(0, max - n)); stLives.setAttribute('aria-label', `${n} can`); },
        timer(mode = 'up', limitMs = 0, onEnd = null) {
          stTime.hidden = false;
          const start = performance.now();
          g._timer = { start, mode, limitMs };
          clearInterval(g._tick);
          const tick = () => {
            if (!g.alive) return clearInterval(g._tick);
            const el2 = performance.now() - start + (g._penalty || 0);
            if (mode === 'down') {
              const left = limitMs - el2;
              stTime.textContent = A.fmtTime(left);
              stTime.classList.toggle('low', left < 10000);
              if (left <= 0) { clearInterval(g._tick); stTime.textContent = '0:00'; onEnd && onEnd(); }
            } else stTime.textContent = A.fmtTime(el2);
          };
          tick();
          g._tick = setInterval(tick, 250);
          g.cleanup(() => clearInterval(g._tick));
        },
        stopTimer() { clearInterval(g._tick); },
        penalty(ms) { g._penalty = (g._penalty || 0) + ms; stTime.classList.add('hit'); setTimeout(() => stTime.classList.remove('hit'), 400); },
      },
      elapsed() { return g._timer ? performance.now() - g._timer.start : performance.now() - g.t0; },
      /** Cevap istatistiği + ses + seri. kind: 'flag' | 'map' | 'other' */
      answer(ok, kind = 'other') {
        A.sound.play(ok ? 'ok' : 'bad');
        if (ok) {
          g.streak++;
          P.stats.correct++;
          if (kind === 'flag') P.stats.flags++;
          if (kind === 'map') P.stats.mapHits++;
          P.stats.bestStreak = Math.max(P.stats.bestStreak, g.streak);
        } else g.streak = 0;
        stStreak.hidden = g.streak < 3;
        stStreak.textContent = `seri ×${g.streak}`;
      },
      /**
       * Oyunu bitirir. res: { score, label, pct?, correct?, total?, time?, mistakes?: [id],
       *  lines?: [str], share?: str, full?: bool, extra?: Node }
       */
      end(res) {
        if (!g.alive || g.ended) return;
        g.ended = true;
        clearInterval(g._tick);
        const s = P.stats;
        s.played++;
        if (!s.games.includes(gameId)) s.games.push(gameId);
        const reg = def.fixedRegion || region;
        if (!s.regions.includes(reg)) s.regions.push(reg);
        if (res.pct === 100) s.perfect++;
        if (res.puzzle) s.puzzles[res.puzzle] = (s.puzzles[res.puzzle] || 0) + 1;
        if (res.routePerfect) s.puzzles.routePerfect = (s.puzzles.routePerfect || 0) + 1;
        if (res.daily && !s.daily.includes(res.daily)) s.daily.push(res.daily);
        const rec = res.noRecord ? { better: false } : saveBest(gameId, reg, optKey, res);
        P.checkBadges(Object.assign({ game: gameId, region: reg }, res));
        A.sound.play('win');
        showResults(g, res, rec);
      },
    });
    def.start(g);
    return g;
  };

  function stars(pct) {
    return pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 40 ? 1 : 0;
  }

  function showResults(g, res, rec) {
    const n = res.pct != null ? stars(res.pct) : null;
    const body = el('div', { class: 'results' });
    body.append(el('p', { class: 'eyebrow' }, `${g.def.title} · ${g.def.fixedRegion ? g.def.fixedRegionLabel || A.REGIONS[g.def.fixedRegion].name : A.REGIONS[g.region].name}`));
    if (n != null) {
      const st = el('div', { class: 'stars', 'aria-label': `${n} yıldız` });
      for (let i = 0; i < 3; i++) st.append(el('span', { class: i < n ? 'on' : '' }, '★'));
      body.append(st);
    }
    body.append(el('div', { class: 'big' }, res.label));
    const facts = el('dl', { class: 'facts' });
    const fact = (k, v) => facts.append(el('div', {}, el('dt', {}, k), el('dd', {}, v)));
    const cl = res.correctLabel || 'Doğru';
    if (res.correct != null && res.total != null) fact(cl, `${res.correct} / ${res.total}`);
    else if (res.correct != null) fact(cl, String(res.correct));
    if (res.time != null) fact('Süre', A.fmtTime(res.time));
    if (rec && rec.prev) fact('Önceki rekor', rec.prev.label + (rec.prev.time != null ? ` · ${A.fmtTime(rec.prev.time)}` : ''));
    for (const [k, v] of res.facts || []) fact(k, v);
    body.append(facts);
    if (rec && rec.better) body.append(el('p', { class: 'record' }, 'Yeni rekor!'));
    for (const line of res.lines || []) body.append(el('p', { class: 'note' }, line));
    if (res.extra) body.append(res.extra);
    if (res.mistakes && res.mistakes.length) {
      const uniq = [...new Set(res.mistakes)].filter((id) => A.byId[id]);
      const list = el('div', { class: 'mistakes' });
      for (const id of uniq.slice(0, 24)) {
        const c = A.byId[id];
        list.append(el('span', { class: 'mchip' }, A.flagImg(id, 'flag xs'), c.n));
      }
      body.append(el('h3', {}, 'Tekrar bakmaya değer'), list);
    }
    if (res.share) {
      const ta = el('textarea', { class: 'share-text', readonly: true, rows: 4, id: 'share-text' });
      ta.value = res.share;
      const copyBtn = el('button', { type: 'button', class: 'btn ghost' }, 'Sonucu kopyala');
      copyBtn.addEventListener('click', () => {
        const ok = () => { copyBtn.textContent = 'Kopyalandı'; };
        const fallback = () => { ta.hidden = false; ta.focus(); ta.select(); copyBtn.textContent = 'Metni seçip kopyala'; };
        try { navigator.clipboard.writeText(res.share).then(ok, fallback); } catch (e) { fallback(); }
      });
      ta.hidden = true;
      body.append(ta, copyBtn);
    }
    const actions = el('div', { class: 'actions' });
    if (!res.noReplay) {
      actions.append(el('button', { type: 'button', class: 'btn primary', 'data-autofocus': true, onclick: () => { close(); ui.startGame(g.id, g.region, Object.assign({}, g.opts, { seed: undefined })); } }, 'Tekrar oyna'));
    }
    actions.append(el('button', { type: 'button', class: 'btn', onclick: () => { close(); ui.exitGame(); } }, 'Menüye dön'));
    body.append(actions);
    const close = ui.modal(body, { cls: 'res' });
  }

  // ── Kurulum penceresi ───────────────────────────────────────────────────
  ui.setup = (gameId, region) => {
    const def = A.games[gameId];
    const saved = A.store.get(`opts:${gameId}`, {});
    const opts = {};
    let reg = def.fixedRegion ? def.fixedRegion : region;
    const body = el('div', { class: 'setup' });
    body.append(
      el('div', { class: 'setup-head' }, A.gameIcon(def), el('div', {}, el('p', { class: 'eyebrow' }, A.CATEGORIES[def.cat]), el('h2', {}, def.title))),
      el('p', { class: 'lead' }, def.how || def.desc),
    );
    if (!def.fixedRegion) {
      const row = el('div', { class: 'opt' }, el('span', { class: 'opt-l' }, 'Bölge'));
      const chips = el('div', { class: 'chips' });
      for (const rid of A.REGION_ORDER) {
        const b = el('button', { type: 'button', class: 'chip' + (rid === reg ? ' on' : ''), 'aria-pressed': String(rid === reg) }, A.REGIONS[rid].name);
        b.addEventListener('click', () => {
          reg = rid;
          chips.querySelectorAll('.chip').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
          refreshBest();
        });
        chips.append(b);
      }
      row.append(chips);
      body.append(row);
    }
    for (const o of def.options || []) {
      opts[o.key] = o.values.includes(saved[o.key]) ? saved[o.key] : o.def;
      const row = el('div', { class: 'opt' }, el('span', { class: 'opt-l' }, o.label));
      const chips = el('div', { class: 'chips' });
      o.values.forEach((v, i) => {
        const b = el('button', { type: 'button', class: 'chip' + (v === opts[o.key] ? ' on' : ''), 'aria-pressed': String(v === opts[o.key]) }, o.labels[i]);
        b.addEventListener('click', () => {
          opts[o.key] = v;
          chips.querySelectorAll('.chip').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
          refreshBest();
        });
        chips.append(b);
      });
      row.append(chips);
      body.append(row);
    }
    const bestLine = el('p', { class: 'best-line' });
    const refreshBest = () => {
      const optKey = (def.options || []).map((o) => `${o.key}=${opts[o.key]}`).join(',');
      const b = ui.getBest(gameId, reg, optKey);
      bestLine.textContent = b ? `Rekorun: ${b.label}${b.time != null ? ' · ' + A.fmtTime(b.time) : ''}` : 'Bu ayarlarla henüz rekorun yok.';
    };
    refreshBest();
    body.append(bestLine);
    const go = el('button', { type: 'button', class: 'btn primary', 'data-autofocus': true }, 'Başla');
    go.addEventListener('click', () => {
      A.store.set(`opts:${gameId}`, opts);
      if (!def.fixedRegion && reg !== region) A.app && A.app.setRegion(reg);
      close();
      ui.startGame(gameId, reg, Object.assign({}, opts));
    });
    body.append(el('div', { class: 'actions' }, go, el('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Vazgeç')));
    const close = ui.modal(body);
  };
})();
