/* Atlas — harita oyunları: Haritada Bul (ad/bayrak/başkent), Bu Hangi Ülke?,
   Hepsini Yaz, Komşular, Keşfet. */
(function () {
  'use strict';
  const A = window.Atlas;
  const el = A.el;
  const b = (s) => `<b>${A.esc(s)}</b>`;

  // ── Haritada Bul (üç varyant) ───────────────────────────────────────────
  function findGame(id, cat, title, desc, how, promptKind) {
    A.registerGame({
      id, cat, title, desc, how,
      options: [A.COUNT_OPTION],
      start(g) {
        let pool = A.regionCountries(g.region);
        if (promptKind === 'capital') pool = pool.filter((c) => c.capq);
        const items = A.takeItems(g, pool, g.opts.count);
        const map = g.map();
        A.runSeries(g, {
          items,
          full: items.length === pool.length,
          before: () => map.clearClass('target'),
          ask: async (c) => {
            const r = await A.Q.find(g, c, { tries: 3, prompt: promptKind });
            if (!r.ok && r.score === 0) {
              g.wait(1700).then(() => map.unlabel(c.id));
            }
            return r;
          },
          okDelay: 450,
          badDelay: 1500,
          correctLabel: 'İlk denemede',
        });
      },
    });
  }
  findGame('find', 'map', 'Haritada Bul', 'Adı verilen ülkeyi haritada işaretle.',
    'Adı verilen ülkeyi haritada bul ve dokun. Her ülke için 3 hakkın var; ilk denemede bulursan tam puan alırsın. İki parmakla ya da tekerlekle yakınlaştırabilirsin; küçük ülkeler daire ile gösterilir.', 'name');
  findGame('findflag', 'flag', 'Bayraktan Bul', 'Bayrağı gösterilen ülkeyi haritada bul.',
    'Ekranda bir bayrak çıkar. Bu bayrağın ülkesini haritada bul ve dokun. Her bayrak için 3 hakkın var.', 'flag');
  findGame('findcap', 'capital', 'Başkentten Bul', 'Başkenti verilen ülkeyi haritada işaretle.',
    'Bir başkent adı çıkar. O şehrin bulunduğu ülkeyi haritada bul. Her soru için 3 hakkın var.', 'capital');

  // ── Bu Hangi Ülke? ──────────────────────────────────────────────────────
  A.registerGame({
    id: 'identify', cat: 'map', title: 'Bu Hangi Ülke?', desc: 'Haritada vurgulanan ülkenin adını seç.',
    how: 'Haritada sarıyla vurgulanan ülkeyi dört seçenek arasından bul. Çeldiriciler hep yakın komşulardan seçilir.',
    options: [A.COUNT_OPTION],
    start(g) {
      const pool = A.regionCountries(g.region);
      const items = A.takeItems(g, pool, g.opts.count);
      g.map({ clickable: 'none' });
      A.runSeries(g, { items, ask: (c) => A.Q.identify(g, c, pool), okDelay: 700, badDelay: 1500 });
    },
  });

  // ── Hepsini Yaz ─────────────────────────────────────────────────────────
  A.registerGame({
    id: 'typeall', cat: 'map', title: 'Hepsini Yaz', desc: 'Bölgedeki bütün ülkeleri ezberden yaz, harita dolsun.',
    how: 'Aklına gelen ülkeleri yaz; doğru yazdığın ülke haritada boyanır. Türkçe ya da İngilizce adlar ve kısaltmalar (ABD, BAE, KDC…) kabul edilir. Takılırsan "Pes et" ile kalanları görebilirsin.',
    options: [{ key: 'limit', label: 'Süre', values: [0, 5, 10, 15], labels: ['Sınırsız', '5 dk', '10 dk', '15 dk'], def: 0 }],
    start(g) {
      const pool = A.regionCountries(g.region);
      const map = g.map({ clickable: 'none' });
      const remaining = new Set(pool.map((c) => c.id));
      const found = new Set();
      map.eachMember((id) => map.add(id, 'blank'));
      const counter = el('span', { class: 'counter' });
      const msg = el('span', { class: 'hint' });
      const update = () => {
        counter.textContent = `${found.size} / ${pool.length}`;
        g.hud.progress(found.size, pool.length);
      };
      g.setPrompt(`${b(A.REGIONS[g.region].name)} haritasındaki ülkeleri yaz`, el('span', { class: 'sep' }, ' · '), counter);
      let pending = null;
      const accept = (id) => {
        clearTimeout(pending);
        if (!g.alive || g.ended) return;
        remaining.delete(id);
        found.add(id);
        map.remove(id, 'blank');
        map.add(id, 'found');
        map.flashLabel(id, A.byId[id].n, 1600);
        g.answer(true, 'map');
        input.clear();
        msg.textContent = '';
        update();
        if (!remaining.size) finish(false);
      };
      const keysOf = (id) => A.nameKeys(A.byId[id]);
      const check = (text, enter) => {
        const q = A.norm(text);
        const id = A.matchName(text);
        if (id && remaining.has(id)) {
          // "Nijer" yazılırken "Nijerya" kastediliyor olabilir: kısa bir süre bekle.
          const longer = [...remaining].some((r) => r !== id && keysOf(r).some((k) => k.length > q.length && k.startsWith(q)));
          clearTimeout(pending);
          if (longer && !enter) pending = setTimeout(() => accept(id), 900);
          else accept(id);
          return;
        }
        clearTimeout(pending);
        if (!enter) return;
        if (id && found.has(id)) msg.textContent = `${A.byId[id].n} zaten bulundu.`;
        else if (id) msg.textContent = `${A.byId[id].n} bu haritada yok.`;
        else if (q) msg.textContent = 'Bu adı tanımadım.';
        if (q) A.sound.play('bad');
      };
      const input = A.ui.countryInput({
        id: 'typeall-input',
        onInput: (t) => check(t, false),
        onSubmit: (_, t) => check(t, true),
      });
      const giveUp = el('button', { type: 'button', class: 'btn ghost' }, 'Pes et');
      giveUp.addEventListener('click', () => finish(true));
      g.setDock(el('div', { class: 'type-row' }, input.el, giveUp), msg);
      update();
      setTimeout(() => input.focus(), 50);
      const limit = g.opts.limit * 60000;
      if (limit) g.hud.timer('down', limit, () => finish(true));
      else g.hud.timer('up');

      function finish(gaveUp) {
        if (g.ended) return;
        input.input.disabled = true;
        giveUp.disabled = true;
        for (const id of remaining) { map.remove(id, 'blank'); map.add(id, 'miss'); }
        if (gaveUp && remaining.size <= 40) for (const id of remaining) map.label(id, A.byId[id].n, 'miss');
        const pct = Math.round((100 * found.size) / pool.length);
        g.wait(gaveUp ? 1800 : 600).then(() =>
          g.end({ score: pct, label: `%${pct}`, pct, correct: found.size, total: pool.length, time: g.elapsed(), mistakes: [...remaining] }),
        );
      }
    },
  });

  // ── Komşular ────────────────────────────────────────────────────────────
  A.registerGame({
    id: 'neighbors', cat: 'map', title: 'Komşular', desc: 'Bir ülkenin kara sınırı olan tüm komşularını işaretle.',
    how: 'Ortadaki ülkenin kara sınırı paylaştığı bütün ülkelere dokun. Yanlış dokunuşlar puanı düşürür. Bilemediğinde "Göster" ile kalanları açabilirsin.',
    options: [{ key: 'rounds', label: 'Tur', values: [5, 10], labels: ['5', '10'], def: 5 }],
    start(g) {
      const map = g.map({ clickable: 'all' });
      // Görünür ve tıklanabilir komşular (küçük ülkeler işaretçiyle sayılır).
      const marked = new Set(map.markers.map((m) => m.id));
      const visibleNb = (c) => c.b.filter((id) => {
        const bb = map.bounds.get(id);
        return bb && (marked.has(id) || (bb[1][0] - bb[0][0]) * (bb[1][1] - bb[0][1]) > 4);
      });
      const pool = A.regionCountries(g.region).filter((c) => c.geo && visibleNb(c).length >= 2);
      const items = A.takeItems(g, pool, g.opts.rounds);
      let total = 0;
      let i = 0;
      const mistakes = [];
      g.hud.timer('up');
      const next = () => {
        if (i >= items.length) {
          const pct = Math.round((100 * total) / items.length);
          return g.end({ score: pct, label: `%${pct}`, pct, total: items.length, time: g.elapsed(), mistakes });
        }
        const c = items[i++];
        g.hud.progress(i, items.length);
        const nb = visibleNb(c);
        const got = new Set();
        let wrong = 0;
        map.clearClass('target', 'ok', 'miss', 'bad');
        map.clearLabels();
        map.add(c.id, 'target');
        map.raise(c.id);
        map.label(c.id, c.n, 'tgt');
        map.zoomTo([c.id, ...nb], { pad: 0.12 });
        const count = el('span', { class: 'counter' });
        const upd = () => { count.textContent = `${got.size} / ${nb.length}`; };
        upd();
        g.setPrompt(`${b(A.genitive(c.n))} komşularını bul`, el('span', { class: 'sep' }, ' · '), count);
        const reveal = el('button', { type: 'button', class: 'btn ghost' }, 'Göster');
        g.setDock(el('div', { class: 'row-center' }, reveal));
        const done = (gaveUp) => {
          g.onMapClick = null;
          reveal.disabled = true;
          for (const id of nb) if (!got.has(id)) { map.add(id, 'miss'); map.label(id, A.byId[id].n, 'miss'); }
          const score = got.size / (nb.length + wrong);
          total += score;
          if (gaveUp || wrong) mistakes.push(c.id);
          g.hud.score(`%${Math.round((100 * total) / i)}`);
          g.wait(gaveUp ? 2200 : 1300).then(next);
        };
        reveal.addEventListener('click', () => done(true));
        g.onMapClick = (id) => {
          if (id === c.id || got.has(id)) return;
          if (nb.includes(id)) {
            got.add(id);
            map.add(id, 'ok');
            map.label(id, A.byId[id].n);
            g.answer(true, 'map');
            upd();
            if (got.size === nb.length) done(false);
          } else {
            wrong++;
            map.flash(id, 'bad');
            map.flashLabel(id, A.byId[id].n, 1000, 'bad');
            g.answer(false, 'map');
          }
        };
      };
      next();
    },
  });

  // ── Keşfet ──────────────────────────────────────────────────────────────
  A.registerGame({
    id: 'explore', cat: 'map', title: 'Keşfet', desc: 'Puan yok: ülkelere dokun, bayrak, başkent ve komşuları öğren.',
    how: 'Haritada bir ülkeye dokun ya da adını ara. Bayrağını, başkentini, yüzölçümünü ve komşularını görürsün. Komşulara dokunarak ülkeden ülkeye gezebilirsin.',
    start(g) {
      const map = g.map({ clickable: 'all', hoverNames: true });
      const info = el('div', { class: 'info', 'aria-live': 'polite' }, el('p', { class: 'hint' }, 'Bir ülkeye dokun ya da yukarıdan ara.'));
      const search = A.ui.countryInput({
        id: 'explore-search',
        placeholder: 'Ülke ara…',
        suggestPool: A.countries.filter((c) => map.has(c.id)),
        onSubmit: (id) => { if (id && map.has(id)) { select(id, true); search.clear(); search.input.blur(); } },
      });
      g.setPrompt(el('span', {}, 'Haritayı keşfet'), el('span', { class: 'sep' }, ' · '), el('span', { class: 'counter' }, `${A.regionCountries(g.region).length} ülke`));
      g.setDock(search.el, info);
      function select(id, fly) {
        const c = A.byId[id];
        map.clearClass('sel');
        map.clearLabels();
        map.add(id, 'sel');
        map.raise(id);
        map.label(id, c.n, 'tgt');
        if (fly) map.zoomTo(id, { pad: 0.8, maxK: 8 });
        info.innerHTML = '';
        const nbs = el('div', { class: 'nb-chips' });
        for (const n of c.b) {
          const nc = A.byId[n];
          nbs.append(el('button', { type: 'button', class: 'chip sm', onclick: () => select(n, true) }, nc.n));
        }
        if (!c.b.length) nbs.append(el('span', { class: 'hint' }, 'Kara komşusu yok (ada ülkesi).'));
        info.append(
          el('div', { class: 'info-head' },
            A.flagImg(id, 'flag md'),
            el('div', {},
              el('h3', {}, c.n),
              el('p', {}, el('span', { class: 'cap-dot', 'aria-hidden': 'true' }), ` ${c.cap}`),
              el('p', { class: 'mono' }, A.fmtArea(c.a)),
            ),
          ),
          el('p', { class: 'opt-l' }, 'Komşular'),
          nbs,
        );
      }
      g.onMapClick = (id) => select(id, false);
    },
  });
})();
