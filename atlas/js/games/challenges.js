/* Atlas — challenge'lar: Günlük Challenge, 60 Saniye, Hayatta Kal. */
(function () {
  'use strict';
  const A = window.Atlas;
  const el = A.el;

  const LAUNCH = new Date(2026, 9, 15); // Günlük №1
  A.dailyNumber = (d = new Date()) => {
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((a - LAUNCH) / 86400000) + 1;
  };

  /** Karışık soru sorar; harita sorularından önce haritayı temizler. */
  async function askMixed(g, kind, c, pool) {
    if (kind === 'find' || kind === 'identify') {
      const map = g.map({ clickable: 'members' });
      map.clearClass('target', 'ok', 'ok2', 'ok3', 'miss', 'bad');
      map.clearLabels();
      map.resetZoom(false);
      g.setDock();
      if (kind === 'find') return A.Q.find(g, c, { tries: 2 });
      return A.Q.identify(g, c, pool);
    }
    if (kind === 'flag2name') return A.Q.flag2name(g, c, pool);
    if (kind === 'name2flag') return A.Q.name2flag(g, c, pool);
    if (kind === 'capital') return A.Q.capital(g, c, pool.filter((x) => x.capq), g.rnd() < 0.5 ? 'c2cap' : 'cap2c');
    if (kind === 'silhouette') return A.Q.silhouette(g, c, pool.filter((x) => x.geo));
    throw new Error(kind);
  }
  const KIND_OK = { find: () => true, identify: () => true, flag2name: () => true, name2flag: () => true, capital: (c) => c.capq, silhouette: (c) => c.geo };

  // ── Günlük Challenge ────────────────────────────────────────────────────
  const DAILY_KINDS = ['identify', 'flag2name', 'find', 'capital', 'name2flag', 'silhouette', 'find', 'flag2name', 'identify', 'capital'];

  A.registerGame({
    id: 'daily', cat: 'challenge', title: 'Günlük Challenge', fixedRegion: 'world', fixedRegionLabel: 'Dünya',
    desc: 'Herkese aynı 10 soru: harita, bayrak, başkent ve silüet karışık.',
    how: "Her gün yeni 10 soru; gün içinde herkes aynı soruları alır. Sorular kolaydan zora gider. Sonunda sonucunu paylaşılabilir metin olarak kopyalayabilirsin. Günü kaçırma: üst üste oynadıkça seri büyür.",
    start(g) {
      const day = A.dayKey();
      const no = A.dailyNumber();
      g.rnd = A.rng(A.hashStr(`atlas-daily-${day}`));
      const pool = A.countries;
      const used = new Set();
      const items = DAILY_KINDS.map((kind, i) => {
        const maxTier = i < 4 ? 1 : i < 7 ? 2 : 3;
        let cands = pool.filter((c) => c.t <= maxTier && !used.has(c.id) && KIND_OK[kind](c));
        if (i >= 7) cands = cands.filter((c) => c.t >= 2);
        const c = A.pick(cands, g.rnd);
        used.add(c.id);
        return { kind, c };
      });
      const prev = A.store.get(`daily:${day}`, null);
      const marks = [];
      let sum = 0;
      let correct = 0;
      (async () => {
        if (prev) {
          A.ui.toast(`Bugünü zaten oynadın (${prev.correct}/10). Tekrar oynayabilirsin, ilk skorun saklı kalır.`);
        }
        g.hud.timer('up');
        for (let i = 0; i < items.length; i++) {
          g.hud.progress(i + 1, items.length);
          const r = await askMixed(g, items[i].kind, items[i].c, pool);
          sum += r.score;
          if (r.ok) correct++;
          marks.push(r.ok ? '🟩' : r.score > 0 ? '🟨' : '🟥');
          g.hud.score(`${correct} doğru`);
          await g.wait(r.ok ? 800 : 1700);
        }
        const time = g.elapsed();
        const points = Math.round(sum * 100);
        if (!prev) A.store.set(`daily:${day}`, { correct, points, time, marks: marks.join('') });
        const share = `Atlas Günlük №${no} · ${correct}/10 · ${A.fmtTime(time)}\n${marks.join('')}`;
        const pct = Math.round(sum * 10);
        g.end({
          score: points, label: `${correct}/10`, pct, correct, total: 10, time, daily: day, share, noReplay: true, noRecord: true,
          facts: [['Puan', `${points} / 1000`], ['Günlük seri', `${A.dailyStreak() + (prev ? 0 : A.progress.stats.daily.includes(day) ? 0 : 1)} gün`]],
          mistakes: items.filter((_, i) => marks[i] !== '🟩').map((x) => x.c.id),
          extra: el('p', { class: 'mono marks' }, marks.join('')),
        });
      })();
    },
  });

  // ── 60 Saniye ───────────────────────────────────────────────────────────
  A.registerGame({
    id: 'blitz', cat: 'challenge', title: '60 Saniye', desc: 'Bir dakikada olabildiğince çok doğru. Yanlış cevap 3 saniye yakar.',
    how: 'Süre 60 saniye. Her doğru cevap bir puan; her yanlış süreden 3 saniye düşer. Soru türünü sen seç: bayrak, harita ya da karışık.',
    options: [{ key: 'kind', label: 'Soru türü', values: ['flag', 'map', 'mix'], labels: ['Bayrak', 'Harita', 'Karışık'], def: 'flag' }],
    start(g) {
      const pool = A.regionCountries(g.region);
      const kinds = { flag: ['flag2name'], map: ['identify'], mix: ['flag2name', 'identify', 'name2flag', 'capital'] }[g.opts.kind];
      let correct = 0;
      let asked = 0;
      let over = false;
      const mistakes = [];
      const recent = [];
      const finish = () => {
        if (over) return;
        over = true;
        g.end({ score: correct, label: `${correct} doğru`, correct, total: asked, mistakes });
      };
      g.hud.timer('down', 60000, finish);
      (async () => {
        while (!over && g.alive) {
          const kind = A.pick(kinds, g.rnd);
          let c;
          do { c = A.pick(pool, g.rnd); } while ((recent.includes(c.id) || !KIND_OK[kind](c)) && pool.length > 12);
          recent.push(c.id);
          if (recent.length > 10) recent.shift();
          const r = await askMixed(g, kind, c, pool);
          if (over) return;
          asked++;
          if (r.ok) correct++;
          else { mistakes.push(c.id); g.hud.penalty(3000); }
          g.hud.score(`${correct} doğru`);
          await g.wait(r.ok ? 250 : 800);
        }
      })();
    },
  });

  // ── Hayatta Kal ─────────────────────────────────────────────────────────
  A.registerGame({
    id: 'survival', cat: 'challenge', title: 'Hayatta Kal', desc: 'Üç canla karışık sorular; zorluk giderek artar.',
    how: 'Üç canın var; her yanlış bir can götürür. İlk sorular tanıdık ülkelerden gelir, ilerledikçe küçük ve az bilinen ülkeler çıkar. Soru türleri karışık: harita, bayrak, başkent ve silüet.',
    start(g) {
      const pool = A.regionCountries(g.region);
      let lives = 3;
      let correct = 0;
      let n = 0;
      const mistakes = [];
      const seen = new Set();
      g.hud.lives(lives, 3);
      g.hud.timer('up');
      (async () => {
        while (lives > 0 && g.alive) {
          n++;
          g.hud.progress(n, 0);
          const maxTier = n <= 8 ? 1 : n <= 20 ? 2 : 3;
          const kinds = n <= 5 ? ['flag2name', 'identify'] : ['flag2name', 'identify', 'name2flag', 'capital', 'find', 'silhouette'];
          const kind = A.pick(kinds, g.rnd);
          let cands = pool.filter((c) => c.t <= maxTier && !seen.has(c.id) && KIND_OK[kind](c));
          if (cands.length < 3) cands = pool.filter((c) => !seen.has(c.id) && KIND_OK[kind](c));
          if (!cands.length) { seen.clear(); cands = pool.filter((c) => KIND_OK[kind](c)); }
          const c = A.pick(cands, g.rnd);
          seen.add(c.id);
          const r = await askMixed(g, kind, c, pool);
          if (r.ok) correct++;
          else { lives--; mistakes.push(c.id); g.hud.lives(lives, 3); }
          g.hud.score(`${correct} doğru`);
          await g.wait(r.ok ? 700 : 1600);
        }
        g.end({ score: correct, label: `${correct} doğru`, correct, total: n, time: g.elapsed(), mistakes });
      })();
    },
  });
})();
