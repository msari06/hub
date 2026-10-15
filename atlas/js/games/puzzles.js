/* Atlas — siyasi harita bulmacaları: Yapboz, Rota, Haritayı Boya, Silüet. */
(function () {
  'use strict';
  const A = window.Atlas;
  const el = A.el;
  const b = (s) => `<b>${A.esc(s)}</b>`;
  const SVGNS = 'http://www.w3.org/2000/svg';

  const sizeOf = (bb) => (bb ? Math.max(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1]) : 0);

  // ── Yapboz ──────────────────────────────────────────────────────────────
  A.registerGame({
    id: 'jigsaw', cat: 'puzzle', title: 'Yapboz', desc: 'Ülke parçalarını sürükleyip siyasi haritada yerine oturt.',
    how: 'Haritada sınırlar boş. Sana verilen ülke parçasını sürükleyip doğru yerine bırak; yeterince yaklaşınca yerine oturur. Haritayı boş yerden sürükleyerek kaydırabilir, yakınlaştırabilirsin. "İpucu" ülkenin yerini kısa süre gösterir ama puanı düşürür.',
    options: [{ key: 'count', label: 'Parça sayısı', values: [10, 20, 0], labels: ['10', '20', 'Tümü'], def: 10 }],
    start(g) {
      const map = g.map({ clickable: 'none' });
      const pool = A.regionCountries(g.region).filter((c) => c.geo && map.has(c.id) && sizeOf(map.bounds.get(c.id)) >= 6);
      const queue = A.takeItems(g, pool, g.opts.count);
      const total = queue.length;
      const hinted = new Set();
      let placed = 0;
      map.eachMember((id) => map.add(id, 'slot'));
      g.hud.timer('up');
      g.hud.progress(0, total);

      const hintBtn = el('button', { type: 'button', class: 'btn ghost' }, 'İpucu');
      const skipBtn = el('button', { type: 'button', class: 'btn ghost' }, 'Sonraki parça');
      g.setDock(el('div', { class: 'row-center' }, hintBtn, skipBtn), el('p', { class: 'hint center' }, 'Parçayı sürükle · haritayı kaydırmak için boş alanı sürükle'));
      let piece = null;

      function spawn() {
        if (piece) piece.g.remove();
        if (!queue.length) return finish();
        const c = queue[0];
        g.setPrompt(A.flagImg(c.id, 'flag sm'), `${b(c.n)} parçasını yerine sürükle`);
        const bb = map.bounds.get(c.id);
        const tcx = (bb[0][0] + bb[1][0]) / 2, tcy = (bb[0][1] + bb[1][1]) / 2;
        // Görünür alan içinde, hedefe en uzak aday noktaya koy.
        const { x: vx0, y: vy0, w: vw, h: vh } = map.viewRect();
        const cands = [[0.22, 0.25], [0.78, 0.25], [0.22, 0.75], [0.78, 0.75], [0.5, 0.82], [0.5, 0.18]]
          .map(([fx, fy]) => [vx0 + vw * fx, vy0 + vh * fy]);
        cands.sort((p, q) => Math.hypot(q[0] - tcx, q[1] - tcy) - Math.hypot(p[0] - tcx, p[1] - tcy));
        const [sx, sy] = cands[Math.floor(g.rnd() * 2)];
        const gEl = document.createElementNS(SVGNS, 'g');
        gEl.setAttribute('class', 'piece');
        const upp = map._unitsPerPx() / map.k;
        const pad = 16 * upp;
        const hit = document.createElementNS(SVGNS, 'rect');
        hit.setAttribute('class', 'piece-hit');
        hit.setAttribute('x', bb[0][0] - pad);
        hit.setAttribute('y', bb[0][1] - pad);
        hit.setAttribute('width', bb[1][0] - bb[0][0] + pad * 2);
        hit.setAttribute('height', bb[1][1] - bb[0][1] + pad * 2);
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', map.els.get(c.id)[0].getAttribute('d'));
        path.setAttribute('class', 'piece-shape');
        path.style.setProperty('--pf', A.politicalColor(c.id));
        gEl.append(hit, path);
        map.gTop.append(gEl);
        piece = { c, g: gEl, cx: tcx, cy: tcy, dx: sx - tcx, dy: sy - tcy, diag: Math.hypot(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1]) };
        place();
        bindDrag();
      }
      function place() { piece.g.style.transform = `translate(${piece.dx}px, ${piece.dy}px)`; }
      // Yakınlaştırma/kaydırma ya da ekran boyutu değişince parça görünür alanda kalsın.
      map.onZoom = () => {
        if (!piece || piece.dragging) return;
        const r = map.viewRect();
        const x = piece.cx + piece.dx, y = piece.cy + piece.dy;
        const nx = Math.min(r.x + r.w * 0.85, Math.max(r.x + r.w * 0.15, x));
        const ny = Math.min(r.y + r.h * 0.85, Math.max(r.y + r.h * 0.15, y));
        if (nx !== x || ny !== y) { piece.dx += nx - x; piece.dy += ny - y; place(); }
      };

      function bindDrag() {
        const p = piece;
        let start = null;
        p.g.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          try { p.g.setPointerCapture(e.pointerId); } catch (_) { /* yok say */ }
          start = { x: e.clientX, y: e.clientY, dx: p.dx, dy: p.dy, upp: map._unitsPerPx() / map.k };
          p.dragging = true;
          p.g.classList.add('dragging');
        });
        p.g.addEventListener('pointermove', (e) => {
          if (!start) return;
          p.dx = start.dx + (e.clientX - start.x) * start.upp;
          p.dy = start.dy + (e.clientY - start.y) * start.upp;
          place();
        });
        const up = () => {
          if (!start) return;
          const thr = Math.max(18 * start.upp, 0.1 * p.diag);
          start = null;
          p.dragging = false;
          p.g.classList.remove('dragging');
          if (Math.hypot(p.dx, p.dy) <= thr) snap(p);
        };
        p.g.addEventListener('pointerup', up);
        p.g.addEventListener('pointercancel', up);
      }

      function snap(p) {
        p.g.classList.add('snapping');
        p.dx = 0;
        p.dy = 0;
        place();
        A.sound.play('snap');
        if (!hinted.has(p.c.id)) A.progress.stats.mapHits++;
        g.wait(260).then(() => {
          p.g.remove();
          map.remove(p.c.id, 'slot', 'hint');
          map.add(p.c.id, 'placed');
          map.flashLabel(p.c.id, p.c.n, 1200);
          queue.shift();
          placed++;
          g.hud.progress(placed, total);
          piece = null;
          spawn();
        });
      }

      hintBtn.addEventListener('click', () => {
        if (!piece) return;
        const id = piece.c.id;
        hinted.add(id);
        map.add(id, 'hint');
        map.zoomTo(id, { onlyIfSmall: true, pad: 1.5, maxK: 8 });
        g.wait(1600).then(() => map.remove(id, 'hint'));
      });
      skipBtn.addEventListener('click', () => {
        if (!piece || queue.length < 2) return;
        queue.push(queue.shift());
        spawn();
      });

      function finish() {
        hintBtn.disabled = true;
        skipBtn.disabled = true;
        const pct = Math.round((100 * (total - hinted.size)) / total);
        g.wait(500).then(() => g.end({
          score: pct, label: `%${pct}`, pct, correct: total - hinted.size, total, time: g.elapsed(),
          puzzle: 'jigsaw', mistakes: [...hinted], lines: [hinted.size ? `${hinted.size} parçada ipucu kullandın.` : 'Hiç ipucu kullanmadın.'],
        }));
      }
      spawn();
    },
  });

  // ── Rota (sınır yolculuğu) ──────────────────────────────────────────────
  A.registerGame({
    id: 'route', cat: 'puzzle', title: 'Rota', desc: 'İki ülke arasında kara sınırlarından geçen en kısa yolu bul.',
    how: 'Başlangıç ve varış ülkesi verilir; harita sınırsız görünür. Aradaki ülkeleri yaz. Yeşil: en kısa yol üzerinde, turuncu: biraz sapma, kırmızı: uzak. Başlangıçtan varışa kesintisiz bir sınır zinciri kurduğunda tur biter. Hakların sınırlı.',
    options: [{ key: 'rounds', label: 'Tur', values: [3, 5], labels: ['3', '5'], def: 3 }],
    start(g) {
      const map = g.map({ clickable: 'none', political: true });
      const pool = A.regionCountries(g.region).filter((c) => map.has(c.id));
      const ids = pool.map((c) => c.id);
      const graph = A.graph(ids);
      const rounds = g.opts.rounds;
      let r = 0;
      let total = 0;
      let perfect = 0;
      const mistakes = [];
      g.hud.timer('up');

      function makePuzzle() {
        for (let attempt = 0; attempt < 200; attempt++) {
          const a = A.pick(ids.filter((id) => graph[id].length), g.rnd);
          const d = A.bfs(graph, a);
          const far = Object.keys(d).filter((x) => d[x] >= 3 && d[x] <= 6);
          if (!far.length) continue;
          const z = A.pick(far, g.rnd);
          return { a, z, D: d[z], dA: d, dZ: A.bfs(graph, z) };
        }
        return null;
      }

      function round() {
        if (r >= rounds) {
          const pct = Math.round(total / rounds);
          return g.end({ score: pct, label: `%${pct}`, pct, total: rounds, correct: perfect, time: g.elapsed(), puzzle: 'route', routePerfect: perfect > 0 && perfect === rounds, mistakes });
        }
        const pz = makePuzzle();
        if (!pz) { g.setPrompt('Bu bölgede uygun rota bulunamadı.'); return; }
        r++;
        g.hud.progress(r, rounds);
        const { a, z, D, dA, dZ } = pz;
        const need = D - 1; // aradaki en az ülke sayısı
        const limit = need + 4;
        const guessed = new Set();
        let used = 0;
        map.clearClass('ok', 'ok3', 'miss', 'end', 'hint');
        map.clearLabels();
        for (const id of map.els.keys()) map.add(id, 'fog');
        for (const id of [a, z]) { map.remove(id, 'fog'); map.add(id, 'end'); map.label(id, A.byId[id].n, 'tgt'); }
        map.resetZoom();
        const left = el('span', { class: 'counter' });
        const upd = () => { left.textContent = `${limit - used} hak`; };
        upd();
        g.setPrompt(`${b(A.byId[a].n)} → ${b(A.byId[z].n)}`, el('span', { class: 'sep' }, ' · '), el('span', {}, `en kısa yol ${need} ülke`), el('span', { class: 'sep' }, ' · '), left);
        const msg = el('p', { class: 'hint' });
        const input = A.ui.countryInput({
          id: 'route-input',
          placeholder: 'Aradaki bir ülkeyi yaz…',
          suggestPool: A.countries,
          onSubmit: (id) => guess(id),
        });
        const hintBtn = el('button', { type: 'button', class: 'btn ghost' }, 'İpucu');
        g.setDock(el('div', { class: 'type-row' }, input.el, hintBtn), msg);
        setTimeout(() => input.focus(), 50);

        const connected = () => {
          const allowed = new Set([...guessed, a, z]);
          return A.bfs(graph, a, allowed)[z] != null;
        };
        function reveal(id, cls) {
          map.remove(id, 'fog');
          map.add(id, cls);
          map.label(id, A.byId[id].n);
        }
        function guess(id) {
          input.clear();
          if (!id) { msg.textContent = 'Bu adı tanımadım.'; A.sound.play('bad'); return; }
          const c = A.byId[id];
          if (id === a || id === z || guessed.has(id)) { msg.textContent = `${c.n} zaten haritada.`; return; }
          if (!graph[id]) { msg.textContent = `${c.n} bu bölge haritasında yok.`; return; }
          guessed.add(id);
          used++;
          const via = (dA[id] ?? 99) + (dZ[id] ?? 99);
          const cls = via === D ? 'ok' : via === D + 1 ? 'ok3' : 'miss';
          reveal(id, cls);
          A.sound.play(cls === 'miss' ? 'bad' : 'ok');
          msg.textContent = cls === 'ok' ? `${c.n} en kısa yol üzerinde.` : cls === 'ok3' ? `${c.n} yakın ama en kısa yolda değil.` : `${c.n} rotadan uzak.`;
          upd();
          check();
        }
        function check() {
          if (connected()) return endRound(true);
          if (used >= limit) return endRound(false);
        }
        hintBtn.addEventListener('click', () => {
          // Başlangıçtan ulaşılan parçaya bitişik, en kısa yol üzerindeki ilk ülkeyi aç.
          const reach = A.bfs(graph, a, new Set([...guessed, a]));
          const cand = ids.filter((x) => !guessed.has(x) && x !== a && x !== z && dA[x] + dZ[x] === D)
            .sort((p, q) => {
              const adjP = graph[p].some((n) => reach[n] != null) ? 0 : 1;
              const adjQ = graph[q].some((n) => reach[n] != null) ? 0 : 1;
              return adjP - adjQ || dA[p] - dA[q];
            });
          if (!cand.length) return;
          guessed.add(cand[0]);
          used++;
          reveal(cand[0], 'hint');
          msg.textContent = `İpucu: ${A.byId[cand[0]].n}`;
          upd();
          check();
        });
        function endRound(won) {
          input.input.disabled = true;
          hintBtn.disabled = true;
          let score = 0;
          if (won) {
            score = Math.max(0, 100 - 15 * (used - need));
            if (used === need) perfect++;
            g.answer(true, 'map');
            msg.textContent = used === need ? 'Kusursuz rota!' : `Rota tamam: ${used} tahminde.`;
          } else {
            g.answer(false, 'map');
            mistakes.push(a, z);
            // Bir en kısa yolu göster.
            let cur = a;
            while (cur !== z) {
              cur = graph[cur].find((n) => dA[n] === dA[cur] + 1 && dZ[n] === dZ[cur] - 1);
              if (!cur || cur === z) break;
              if (!guessed.has(cur)) reveal(cur, 'hint');
            }
            msg.textContent = 'Hakların bitti. Sarıyla gösterilen bir en kısa yol.';
          }
          total += score;
          g.hud.score(`%${Math.round(total / r)}`);
          const nextBtn = el('button', { type: 'button', class: 'btn primary' }, r >= rounds ? 'Sonuçlar' : 'Sonraki rota');
          nextBtn.addEventListener('click', round);
          g.setDock(el('div', { class: 'row-center' }, nextBtn), msg);
          nextBtn.focus({ preventScroll: true });
        }
      }
      round();
    },
  });

  // ── Haritayı Boya (dört renk) ───────────────────────────────────────────
  /** DSATUR + geri izleme ile k-renklendirme. Başarısızsa null. */
  function colorGraph(graph, k, rnd) {
    const nodes = Object.keys(graph);
    const col = {};
    let steps = 0;
    const pickNode = () => {
      let best = null, bestSat = -1, bestDeg = -1;
      for (const n of nodes) {
        if (col[n] != null) continue;
        const sat = new Set(graph[n].map((m) => col[m]).filter((x) => x != null)).size;
        const deg = graph[n].length;
        if (sat > bestSat || (sat === bestSat && deg > bestDeg)) { best = n; bestSat = sat; bestDeg = deg; }
      }
      return best;
    };
    const solve = () => {
      if (++steps > 200000) return false;
      const n = pickNode();
      if (n == null) return true;
      const used = new Set(graph[n].map((m) => col[m]));
      const order = A.shuffle([...Array(k).keys()], rnd);
      for (const c of order) {
        if (used.has(c)) continue;
        col[n] = c;
        if (solve()) return true;
      }
      delete col[n];
      return false;
    };
    return solve() ? col : null;
  }

  A.registerGame({
    id: 'coloring', cat: 'puzzle', title: 'Haritayı Boya', desc: 'Dört renkle siyasi haritayı boya: komşular aynı renk olmasın.',
    how: 'Paletten bir renk seç ve ülkelere dokunarak boya. Kara sınırı olan iki ülke aynı renkte olamaz; çakışanlar kırmızı çizgiyle işaretlenir. Kilitli ülkelerin rengi sabit. Bütün ülkeler çakışmasız boyanınca bulmaca çözülür.',
    options: [{ key: 'locks', label: 'Kilitli ülke', values: [2, 4, 0], labels: ['2', '4', 'Yok'], def: 2 }],
    start(g) {
      const map = g.map({ clickable: 'members', political: false });
      const members = A.regionCountries(g.region).filter((c) => map.has(c.id)).map((c) => c.id);
      const base = A.graph(members);
      const nodes = members.filter((id) => base[id].length);
      const graph = A.graph(nodes);
      let k = 4;
      let sol = colorGraph(graph, 4, g.rnd);
      if (!sol) { k = 5; sol = colorGraph(graph, 5, g.rnd); }
      const COLS = [...Array(k).keys()].map((i) => `var(--c${i + 1})`);
      const assign = {};
      const locked = new Set(A.sample(nodes, g.opts.locks, g.rnd));
      for (const id of members) if (!graph[id]) map.add(id, 'inert');
      for (const id of nodes) {
        if (locked.has(id)) { assign[id] = sol[id]; map.paint(id, COLS[sol[id]]); map.add(id, 'painted', 'lock'); }
        else map.add(id, 'blank');
      }
      let brush = 0;
      const pal = el('div', { class: 'palette four', role: 'radiogroup', 'aria-label': 'Boya rengi' });
      const sw = [];
      const pick = (i) => {
        brush = i;
        sw.forEach((s, j) => { s.classList.toggle('on', j === i); s.setAttribute('aria-checked', String(j === i)); });
      };
      COLS.forEach((c, i) => {
        const s = el('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': 'false' }, el('span', { class: 'sw', style: `background:${c}` }), el('span', { class: 'sw-n' }, `Renk ${i + 1}`));
        s.addEventListener('click', () => pick(i));
        sw.push(s);
        pal.append(s);
      });
      const eraser = el('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': 'false' }, el('span', { class: 'sw eraser' }), el('span', { class: 'sw-n' }, 'Sil'));
      eraser.addEventListener('click', () => pick(-1));
      sw.push(eraser);
      pal.append(eraser);
      pick(0);
      const count = el('span', { class: 'counter' });
      g.setPrompt('Komşu ülkeler aynı renkte olmasın', el('span', { class: 'sep' }, ' · '), count);
      g.setDock(pal);
      g.hud.timer('up');
      const upd = () => {
        const n = Object.keys(assign).length;
        count.textContent = `${n} / ${nodes.length} boyandı`;
        g.hud.progress(n, nodes.length);
      };
      upd();
      const conflicts = () => {
        let bad = 0;
        for (const id of nodes) {
          const c = assign[id];
          const clash = c != null && graph[id].some((m) => assign[m] === c);
          map.toggle(id, 'conflict', clash);
          if (clash) bad++;
        }
        return bad;
      };
      g.onMapClick = (id) => {
        if (!graph[id] || locked.has(id) || g.ended) return;
        if (brush < 0) {
          delete assign[id];
          map.remove(id, 'painted');
          map.add(id, 'blank');
        } else {
          assign[id] = brush;
          map.paint(id, COLS[brush]);
          map.remove(id, 'blank');
          map.add(id, 'painted');
        }
        A.sound.play('tick');
        const bad = conflicts();
        upd();
        if (bad) A.sound.play('bad');
        if (!bad && Object.keys(assign).length === nodes.length) {
          g.onMapClick = null;
          g.wait(500).then(() => g.end({
            score: 100, label: 'Çözüldü', pct: 100, time: g.elapsed(), puzzle: 'coloring',
            lines: [`${nodes.length} ülkeyi ${k} renkle çakışmasız boyadın.`],
          }));
        }
      };
    },
  });

  // ── Sınır Zinciri ───────────────────────────────────────────────────────
  A.registerGame({
    id: 'chain', cat: 'puzzle', title: 'Sınır Zinciri', desc: 'Her ülke bir öncekiyle komşu olsun: zinciri ne kadar uzatabilirsin?',
    how: 'Zincir bir ülkeyle başlar. Son halkanın kara komşularından birini yaz, zincir uzasın. Bir ülke iki kez kullanılamaz. Son ülkenin kullanılmamış komşusu kalmazsa zincir kopar; yolunu dikkatli seç. Harita sınırları gösterir ama adları sen bilmelisin.',
    options: [{ key: 'limit', label: 'Süre', values: [90, 180, 0], labels: ['90 sn', '3 dk', 'Sınırsız'], def: 90 }],
    start(g) {
      const map = g.map({ clickable: 'none' });
      const ids = A.regionCountries(g.region).filter((c) => map.has(c.id)).map((c) => c.id);
      const graph = A.graph(ids);
      const starts = ids.filter((id) => graph[id].length >= 3);
      const chain = [A.pick(starts, g.rnd)];
      const used = new Set(chain);
      let misses = 0;
      const msg = el('p', { class: 'hint' });
      const count = el('span', { class: 'counter' });
      const last = () => chain[chain.length - 1];
      const show = () => {
        const l = A.byId[last()];
        g.setPrompt(`${b(A.genitive(l.n))} bir komşusunu yaz`, el('span', { class: 'sep' }, ' · '), count);
        count.textContent = `${chain.length - 1} halka`;
      };
      map.add(chain[0], 'sel');
      map.label(chain[0], A.byId[chain[0]].n, 'tgt');
      map.zoomTo(chain[0], { pad: 1.6, maxK: 5 });
      const input = A.ui.countryInput({
        id: 'chain-input',
        placeholder: 'Komşu ülkeyi yaz…',
        suggestPool: A.countries,
        onSubmit: (id) => guess(id),
      });
      const stop = el('button', { type: 'button', class: 'btn ghost' }, 'Bitir');
      stop.addEventListener('click', () => finish('Zinciri sen bitirdin.'));
      g.setDock(el('div', { class: 'type-row' }, input.el, stop), msg);
      setTimeout(() => input.focus(), 50);
      show();
      if (g.opts.limit) g.hud.timer('down', g.opts.limit * 1000, () => finish('Süre doldu.'));
      else g.hud.timer('up');

      function guess(id) {
        input.clear();
        if (!id) { msg.textContent = 'Bu adı tanımadım.'; A.sound.play('bad'); return; }
        const c = A.byId[id];
        const l = A.byId[last()];
        if (used.has(id)) { msg.textContent = `${c.n} zaten zincirde.`; A.sound.play('bad'); return; }
        if (!graph[id]) { msg.textContent = `${c.n} bu bölge haritasında yok.`; A.sound.play('bad'); return; }
        if (!graph[last()].includes(id)) {
          misses++;
          msg.textContent = `${c.n}, ${l.n} ile komşu değil.`;
          g.answer(false, 'map');
          return;
        }
        map.remove(last(), 'sel');
        map.add(last(), 'ok');
        chain.push(id);
        used.add(id);
        map.add(id, 'sel');
        map.raise(id);
        map.label(id, c.n, 'tgt');
        map.unlabel(chain[chain.length - 2]);
        map.label(chain[chain.length - 2], l.n);
        g.answer(true, 'map');
        msg.textContent = '';
        map.zoomTo(id, { pad: 1.6, maxK: 5 });
        show();
        if (!graph[id].some((n) => !used.has(n))) finish(`Çıkmaz: ${A.genitive(c.n)} kullanılmamış komşusu kalmadı.`);
      }
      function finish(why) {
        if (g.ended) return;
        input.input.disabled = true;
        stop.disabled = true;
        const links = chain.length - 1;
        msg.textContent = why;
        g.wait(900).then(() => g.end({
          score: links, label: `${links} halka`, correct: links, time: g.elapsed(),
          lines: [why, chain.map((id) => A.byId[id].n).join(' → '), misses ? `${misses} yanlış komşu tahmini.` : ''].filter(Boolean),
        }));
      }
    },
  });

  // ── Silüet ──────────────────────────────────────────────────────────────
  A.registerGame({
    id: 'silhouette', cat: 'puzzle', title: 'Silüet', desc: 'Sadece sınır çizgisine bakarak ülkeyi tanı.',
    how: 'Bir ülkenin dış hatları gösterilir. Hangi ülke olduğunu dört seçenekten bul. Uzak denizaşırı topraklar gösterilmez.',
    options: [A.COUNT_OPTION],
    start(g) {
      const pool = A.regionCountries(g.region).filter((c) => c.geo);
      A.runSeries(g, { items: A.takeItems(g, pool, g.opts.count), ask: (c) => A.Q.silhouette(g, c, pool), okDelay: 900 });
    },
  });
})();
