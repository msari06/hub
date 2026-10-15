/* Atlas — tekrar kullanılan soru türleri ve seri (N soruluk) koşucusu. */
(function () {
  'use strict';
  const A = window.Atlas;
  const el = A.el;
  const Q = (A.Q = {});

  A.CATEGORIES = { map: 'Harita', flag: 'Bayrak', capital: 'Başkent', puzzle: 'Bulmaca', challenge: 'Challenge' };
  A.COUNT_OPTION = { key: 'count', label: 'Soru sayısı', values: [10, 20, 0], labels: ['10', '20', 'Tümü'], def: 10 };

  const b = (s) => `<b>${A.esc(s)}</b>`;

  /** Haritada ülke bulma. prompt: 'name' | 'flag' | 'capital'. → {score, ok} */
  Q.find = (g, c, { tries = 3, prompt = 'name' } = {}) =>
    new Promise((resolve) => {
      const map = g.map();
      g.showMap();
      if (prompt === 'flag') g.setPrompt(A.flagImg(c.id, 'flag pf'), 'Bu bayrağın ülkesini haritada bul');
      else if (prompt === 'capital') g.setPrompt(`Başkenti ${b(c.cap)} olan ülkeyi haritada bul`);
      else g.setPrompt(`${b(c.n)} nerede?`);
      let attempts = 0;
      g.onMapClick = (id) => {
        if (id === c.id) {
          g.onMapClick = null;
          map.add(id, ['ok', 'ok2', 'ok3'][attempts]);
          map.flashLabel(id, c.n, 1100);
          if (attempts === 0) g.answer(true, 'map');
          else { A.sound.play('ok'); g.streak = 0; }
          resolve({ score: [1, 0.5, 0.25][attempts], ok: attempts === 0 });
          return;
        }
        attempts++;
        map.flash(id, 'bad');
        map.flashLabel(id, A.byId[id].n, 1100, 'bad');
        if (attempts >= tries) {
          g.onMapClick = null;
          g.answer(false, 'map');
          map.add(c.id, 'miss');
          map.raise(c.id);
          map.label(c.id, c.n, 'miss');
          map.zoomTo(c.id, { onlyIfSmall: true, pad: 1.2, maxK: 10 });
          resolve({ score: 0, ok: false });
        } else A.sound.play('bad');
      };
    });

  /** Vurgulanan ülkeyi seçeneklerden bul. */
  Q.identify = async (g, c, pool) => {
    const map = g.map();
    g.showMap();
    map.add(c.id, 'target');
    map.raise(c.id);
    map.zoomTo(c.id, { onlyIfSmall: true, pad: 1.2, maxK: 10 });
    g.setPrompt('Vurgulanan ülke hangisi?');
    const options = A.options(c, pool, g.rnd, 'near');
    const ok = await A.ui.choose(g.dock, options, { correct: c, render: (o) => el('span', {}, o.n) });
    g.answer(ok, 'map');
    map.remove(c.id, 'target');
    map.add(c.id, ok ? 'ok' : 'miss');
    map.flashLabel(c.id, c.n, 1300);
    return { score: ok ? 1 : 0, ok };
  };

  /** Bayrak → ülke. */
  Q.flag2name = async (g, c, pool) => {
    g.showCard(el('div', { class: 'flag-stage' }, A.flagImg(c.id, 'flag xl')));
    g.setPrompt('Bu bayrak hangi ülkenin?');
    const options = A.options(c, pool, g.rnd, 'flag');
    const ok = await A.ui.choose(g.dock, options, { correct: c, render: (o) => el('span', {}, o.n) });
    g.answer(ok, 'flag');
    return { score: ok ? 1 : 0, ok };
  };

  /** Ülke → bayrak (dört bayraktan seç). */
  Q.name2flag = async (g, c, pool) => {
    g.setPrompt(`${b(c.n)} bayrağı hangisi?`);
    const host = el('div', { class: 'flag-grid-host' });
    g.showCard(host);
    g.setDock();
    const options = A.options(c, pool, g.rnd, 'flag');
    const ok = await A.ui.choose(host, options, { correct: c, render: (o) => A.flagImg(o.id, 'flag md'), cls: 'flags' });
    g.answer(ok, 'flag');
    if (!ok) g.setPrompt(`${b(c.n)} bayrağı işaretli olandı.`);
    return { score: ok ? 1 : 0, ok };
  };

  /** Başkent soruları. dir: 'c2cap' (ülke → başkent) | 'cap2c' (başkent → ülke) */
  Q.capital = async (g, c, pool, dir = 'c2cap') => {
    const capPool = pool.filter((x) => x.capq);
    const options = A.options(c, capPool, g.rnd, 'near');
    let ok;
    if (dir === 'c2cap') {
      g.showCard(el('div', { class: 'cap-card' }, A.flagImg(c.id, 'flag lg'), el('div', { class: 'cap-name' }, c.n)));
      g.setPrompt(`${b(A.genitive(c.n))} başkenti neresi?`);
      ok = await A.ui.choose(g.dock, options, { correct: c, render: (o) => el('span', {}, o.cap) });
    } else {
      g.showCard(el('div', { class: 'cap-card' }, el('div', { class: 'cap-sym', 'aria-hidden': 'true' }), el('div', { class: 'cap-name' }, c.cap)));
      g.setPrompt(`${b(c.cap)} hangi ülkenin başkenti?`);
      ok = await A.ui.choose(g.dock, options, { correct: c, render: (o) => el('span', {}, o.n) });
    }
    g.answer(ok, 'other');
    return { score: ok ? 1 : 0, ok };
  };

  /** Ülke silüeti — ana kara parçası ve yakınındaki adalar. */
  A.silhouetteSVG = (id, size = 300) => {
    const f = A.feature(id);
    if (!f) return null;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const areas = polys.map((p) => d3.geoArea({ type: 'Polygon', coordinates: p }));
    const big = areas.indexOf(Math.max(...areas));
    const center = d3.geoCentroid({ type: 'Polygon', coordinates: polys[big] });
    const keep = polys.filter((p, i) => {
      if (i === big) return true;
      const cen = d3.geoCentroid({ type: 'Polygon', coordinates: p });
      return d3.geoDistance(cen, center) < 0.21 || areas[i] > areas[big] * 0.25;
    });
    const shape = { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: keep } };
    const proj = d3.geoAzimuthalEqualArea().rotate([-center[0], -center[1]]).fitExtent([[14, 14], [size - 14, size - 14]], shape);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('class', 'silhouette');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Ülke silüeti');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d3.geoPath(proj)(shape));
    svg.append(path);
    return svg;
  };

  Q.silhouette = async (g, c, pool) => {
    g.showCard(el('div', { class: 'sil-stage' }, A.silhouetteSVG(c.id)));
    g.setPrompt('Bu silüet hangi ülkenin?');
    const options = A.options(c, pool, g.rnd, 'near');
    const ok = await A.ui.choose(g.dock, options, { correct: c, render: (o) => el('span', {}, o.n) });
    g.answer(ok, 'map');
    const stage = g.cardHost.querySelector('.sil-stage');
    stage && stage.append(el('div', { class: 'sil-reveal' }, A.flagImg(c.id, 'flag xs'), c.n));
    return { score: ok ? 1 : 0, ok };
  };

  /**
   * N soruluk seri: her soru {score 0..1, ok} döner; sonunda sonuç ekranı.
   * opts: { items, ask(item, i), okDelay, badDelay, before(item, i) }
   */
  A.runSeries = async (g, { items, ask, okDelay = 800, badDelay = 1600, before, full = false, correctLabel }) => {
    const n = items.length;
    let sum = 0;
    let correct = 0;
    const mistakes = [];
    g.hud.timer('up');
    for (let i = 0; i < n; i++) {
      g.hud.progress(i + 1, n);
      before && before(items[i], i);
      const r = await ask(items[i], i);
      sum += r.score;
      if (r.ok) correct++;
      else mistakes.push(items[i].id);
      g.hud.score(`%${Math.round((100 * sum) / (i + 1))}`);
      await g.wait(r.ok ? okDelay : badDelay);
    }
    const pct = Math.round((100 * sum) / n);
    g.end({ score: pct, label: `%${pct}`, pct, correct, total: n, time: g.elapsed(), mistakes, full, correctLabel });
  };

  /** Bölge havuzundan soru listesi (0 = hepsi). */
  A.takeItems = (g, pool, count) => A.shuffle(pool, g.rnd).slice(0, count ? Math.min(count, pool.length) : pool.length);
})();
