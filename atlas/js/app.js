/* Atlas — ana sayfa: bölge seçici harita, oyun kartları, rozetler. */
(function () {
  'use strict';
  const A = window.Atlas;
  const el = A.el;

  // ── Oyun simgeleri (32×32, currentColor + vurgu) ────────────────────────
  const ICONS = {
    find: '<path d="M16 29s9-8.2 9-15a9 9 0 0 0-18 0c0 6.8 9 15 9 15z" class="i-fill"/><circle cx="16" cy="14" r="3.4" class="i-dot"/>',
    findflag: '<path d="M9 28V5" /><path d="M9 6h15l-3.5 5L24 16H9" class="i-fill"/>',
    findcap: '<circle cx="16" cy="16" r="10" /><circle cx="16" cy="16" r="4.5" class="i-fill"/><path d="M16 2v4M16 26v4M2 16h4M26 16h4"/>',
    identify: '<path d="M6 10l8-5 11 4 2 10-7 8-11-2-4-8z" class="i-fill"/><path d="M13.5 13a3 3 0 1 1 3.6 3c-.8.3-1.1.8-1.1 1.7M16 21.4v.2"/>',
    typeall: '<rect x="3" y="8" width="26" height="16" rx="3"/><path d="M8 13h.01M12 13h.01M16 13h.01M20 13h.01M24 13h.01M10 19h12" /><path d="M8 13h.01" class="i-dot"/>',
    neighbors: '<path d="M4 6h11v10H4z" class="i-fill"/><path d="M15 6h13v8H15zM15 14h13v12H15zM4 16h11v10H4z"/>',
    explore: '<circle cx="16" cy="16" r="12"/><path d="M20.5 11.5l-2.8 6.2-6.2 2.8 2.8-6.2z" class="i-fill"/>',
    flag2name: '<rect x="4" y="7" width="24" height="18" rx="2"/><path d="M4 13h24v6H4z" class="i-fill"/>',
    name2flag: '<rect x="3" y="5" width="11" height="9" rx="1.5" class="i-fill"/><rect x="18" y="5" width="11" height="9" rx="1.5"/><rect x="3" y="18" width="11" height="9" rx="1.5"/><rect x="18" y="18" width="11" height="9" rx="1.5"/>',
    colors: '<circle cx="11" cy="12" r="6" class="i-fill"/><circle cx="21" cy="12" r="6"/><circle cx="16" cy="21" r="6"/>',
    paintflag: '<path d="M4 6h16v14H4z"/><path d="M4 11h16v4H4z" class="i-fill"/><path d="M24 4l4 4-9 10-3 1 1-3z"/>',
    capitals: '<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="5" class="i-fill"/>',
    jigsaw: '<path d="M6 8h6a3 3 0 1 1 6 0h6v6a3 3 0 1 0 0 6v6h-6a3 3 0 1 0-6 0H6v-6a3 3 0 1 1 0-6z" class="i-fill"/>',
    route: '<circle cx="7" cy="24" r="3.5" class="i-fill"/><circle cx="25" cy="8" r="3.5" class="i-fill"/><path d="M9.5 21.5C14 18 12 13 17 12s5-1 5.5-1.5" stroke-dasharray="2.5 3"/>',
    chain: '<rect x="2.5" y="11" width="15" height="10" rx="5"/><rect x="14.5" y="11" width="15" height="10" rx="5" class="i-fill"/><rect x="14.5" y="11" width="15" height="10" rx="5"/>',
    coloring: '<path d="M4 4h12v12H4z" class="i-fill"/><path d="M16 4h12v12H16zM4 16h12v12H4z"/><path d="M16 16h12v12H16z" class="i-fill2"/>',
    silhouette: '<path d="M7 9c3-4 8-5 10-2s7 1 8 5-2 5-1 9-5 6-8 4-7 1-9-3 0-6-2-8z" stroke-dasharray="3 2.5"/>',
    daily: '<rect x="5" y="7" width="22" height="20" rx="3"/><path d="M5 13h22M11 4v6M21 4v6"/><path d="M11 18h4v4h-4z" class="i-fill"/>',
    blitz: '<circle cx="16" cy="18" r="10"/><path d="M16 18l4-5M13 4h6M16 4v4"/><path d="M16 18l4-5" class="i-hand"/>',
    survival: '<path d="M16 27S4 20 4 12a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 8-12 15-12 15z" class="i-fill"/>',
  };
  A.gameIcon = (def) => {
    const s = document.createElement('span');
    s.className = `gicon cat-${def.cat}`;
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[def.id] || ''}</svg>`;
    return s;
  };

  const ORDER = {
    map: ['find', 'identify', 'typeall', 'neighbors', 'explore'],
    flag: ['flag2name', 'name2flag', 'findflag', 'colors', 'paintflag'],
    capital: ['capitals', 'findcap'],
    puzzle: ['jigsaw', 'route', 'chain', 'coloring', 'silhouette'],
    challenge: ['daily', 'blitz', 'survival'],
  };
  const CAT_LINES = {
    map: 'Siyasi haritada ülkeleri bul, adlandır, komşularını işaretle.',
    flag: 'Bayrakları tanı, renklerini hatırla, boş şablonları boya.',
    capital: 'Başkentleri ülkeleriyle eşleştir.',
    puzzle: 'Sınırlarla oynanan bulmacalar: yapboz, rota, zincir, dört renk.',
    challenge: 'Süreye, cana ve güne karşı karışık sorular.',
  };

  let region = A.store.get('region', 'world');
  if (!A.REGIONS[region]) region = 'world';
  let heroMap = null;

  const app = (A.app = {
    setRegion(rid) {
      region = rid;
      A.store.set('region', rid);
      update();
    },
    refresh() { update(); },
  });

  /** Ana sayfayı yeniden kurmadan değişen parçaları tazeler. */
  function update() {
    document.querySelectorAll('.regions .chip').forEach((b) => {
      const on = b.dataset.r === region;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('.gcard').forEach((c) => { c.querySelector('.gc-best').textContent = bestText(c.dataset.game); });
    const d = document.querySelector('.daily');
    if (d) d.replaceWith(dailyCard());
    paintHero();
    updateBadgeCount();
  }

  function paintHero() {
    if (!heroMap) return;
    for (const c of A.countries) heroMap.toggle(c.id, 'dim', !c.r.includes(region));
    heroMap.wrap.classList.toggle('world', region === 'world');
    const cap = document.getElementById('hero-caption');
    if (cap) cap.textContent = `${A.REGIONS[region].name} · ${A.regionCountries(region).length} ülke`;
  }

  function regionChips() {
    const nav = el('div', { class: 'chips regions', role: 'group', 'aria-label': 'Bölge seçimi' });
    for (const rid of A.REGION_ORDER) {
      const on = rid === region;
      const b = el('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-r': rid },
        A.REGIONS[rid].name, el('span', { class: 'chip-n' }, String(A.regionCountries(rid).length)));
      b.addEventListener('click', () => app.setRegion(rid));
      nav.append(b);
    }
    return nav;
  }

  function bestText(id) {
    const def = A.games[id];
    if (id === 'explore') return 'Serbest';
    if (id === 'daily') {
      const t = A.store.get(`daily:${A.dayKey()}`, null);
      return t ? `Bugün ${t.correct}/10` : 'Bugün oynanmadı';
    }
    const saved = A.store.get(`opts:${id}`, {});
    const optKey = (def.options || []).map((o) => `${o.key}=${o.values.includes(saved[o.key]) ? saved[o.key] : o.def}`).join(',');
    const b = A.ui.getBest(id, def.fixedRegion || region, optKey);
    return b ? `Rekor ${b.label}` : 'Rekor yok';
  }

  function card(id) {
    const def = A.games[id];
    const c = el('button', { type: 'button', class: `gcard cat-${def.cat}`, 'data-game': id },
      A.gameIcon(def),
      el('span', { class: 'gc-body' }, el('span', { class: 'gc-t' }, def.title), el('span', { class: 'gc-d' }, def.desc)),
      el('span', { class: 'gc-best mono' }, bestText(id)),
    );
    c.addEventListener('click', () => A.ui.setup(id, region));
    return c;
  }

  function dailyCard() {
    const today = A.store.get(`daily:${A.dayKey()}`, null);
    const no = A.dailyNumber();
    const streak = A.dailyStreak();
    const date = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    const box = el('div', { class: 'daily' },
      el('div', { class: 'daily-top' }, el('span', { class: 'mono' }, `№ ${no}`), el('span', {}, date)),
      el('h2', {}, 'Günlük Challenge'),
      el('p', {}, today ? `Bugünkü sonucun: ${today.correct}/10 · ${A.fmtTime(today.time)}` : 'Bugünün 10 sorusu hazır. Herkes aynı soruları alır.'),
    );
    if (today && today.marks) box.append(el('p', { class: 'mono marks' }, today.marks));
    const row = el('div', { class: 'daily-row' });
    const go = el('button', { type: 'button', class: 'btn primary' }, today ? 'Yeniden oyna' : 'Başla');
    go.addEventListener('click', () => A.ui.startGame('daily', 'world', {}));
    row.append(go, el('span', { class: 'streak-n' }, streak ? `${streak} günlük seri` : 'Seri başlat'));
    box.append(row);
    return box;
  }

  function render() {
    const home = document.getElementById('home');
    home.innerHTML = '';
    if (heroMap) { heroMap.destroy(); heroMap = null; }

    const heroMapHost = el('div', { class: 'hero-map' });
    const hero = el('section', { class: 'hero' },
      el('div', { class: 'hero-text' },
        el('p', { class: 'eyebrow' }, 'Bayrak ve harita oyunları'),
        el('h1', { class: 'wordmark' }, 'Atlas'),
        el('p', { class: 'lead' }, `${A.countries.length} ülke, ${A.REGION_ORDER.length} siyasi harita, ${Object.keys(A.games).length} oyun. Haritada bul, bayrağı tanı, sınırları birleştir.`),
        dailyCard(),
      ),
      el('figure', { class: 'hero-fig' },
        heroMapHost,
        el('figcaption', {},
          el('span', { id: 'hero-caption' }),
          el('span', { class: 'mono scale' }, 'Ölçek 1:50 000 000 · Natural Earth'),
        ),
      ),
    );
    home.append(hero);

    const sel = el('section', { class: 'region-bar' },
      el('h2', { class: 'sr-only' }, 'Bölge'),
      el('p', { class: 'opt-l' }, 'Harita'),
      regionChips(),
    );
    home.append(sel);

    const section = (cat) => el('section', { class: `cat cat-${cat}` },
      el('div', { class: 'cat-head' }, el('h2', {}, A.CATEGORIES[cat]), el('p', {}, CAT_LINES[cat])),
      el('div', { class: 'cards' }, ORDER[cat].filter((id) => A.games[id]).map(card)),
    );
    home.append(section('map'), section('flag'), section('puzzle'));
    home.append(el('div', { class: 'cat-pair' }, section('capital'), section('challenge')));

    home.append(el('footer', { class: 'foot' },
      el('p', {}, 'Sınırlar: Natural Earth 1:50m (kamu malı) · Ülke bilgisi: mledoze/countries (ODbL) · Bayraklar: flag-icons (MIT). Tartışmalı bölgelerdeki sınır ve adlar siyasi bir görüş bildirmez.'),
      el('p', {}, 'İlerlemen ve rekorların yalnızca bu tarayıcıda saklanır.'),
    ));

    heroMap = new A.MapView(heroMapHost, {
      region: 'world', clickable: 'all', zoom: false, hoverNames: true,
      members: A.countries.map((c) => c.id),
      onClick: (id) => {
        const c = A.byId[id];
        const next = c.r.includes(region) && region !== 'world' ? region : A.homeRegion(c);
        app.setRegion(next);
      },
      onBackground: () => { if (region !== 'world') app.setRegion('world'); },
    });
    heroMap.wrap.classList.add('hero-picker');
    paintHero();
    updateBadgeCount();
  }

  // ── Üst çubuk: rozetler ve ses ─────────────────────────────────────────
  function updateBadgeCount() {
    const n = Object.keys(A.progress.unlocked).length;
    const b = document.getElementById('badge-count');
    if (b) b.textContent = `${n}/${A.BADGES.length}`;
  }

  function openProfile() {
    const s = A.progress.stats;
    const body = el('div', { class: 'profile' },
      el('p', { class: 'eyebrow' }, 'İlerleme'),
      el('h2', {}, 'Rozetler'),
    );
    const facts = el('dl', { class: 'facts four' });
    const fact = (k, v) => facts.append(el('div', {}, el('dt', {}, k), el('dd', {}, v)));
    fact('Biten oyun', String(s.played));
    fact('Doğru cevap', String(s.correct));
    fact('En uzun seri', String(s.bestStreak));
    fact('Günlük seri', `${A.dailyStreak()} gün`);
    body.append(facts);
    const grid = el('div', { class: 'badges' });
    for (const b of A.BADGES) {
      const got = A.progress.unlocked[b.id];
      grid.append(el('div', { class: 'badge' + (got ? ' got' : '') },
        el('span', { class: 'b-medal', 'aria-hidden': 'true' }),
        el('span', { class: 'b-t' }, b.n),
        el('span', { class: 'b-d' }, b.d),
        el('span', { class: 'b-s mono' }, got ? `Kazanıldı · ${got.split('-').reverse().join('.')}` : 'Kilitli'),
      ));
    }
    body.append(grid, el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Kapat')));
    const close = A.ui.modal(body, { cls: 'wide' });
  }

  function boot() {
    const soundBtn = document.getElementById('sound-btn');
    const syncSound = () => {
      soundBtn.setAttribute('aria-pressed', String(A.sound.on));
      soundBtn.textContent = A.sound.on ? 'Ses açık' : 'Ses kapalı';
    };
    soundBtn.addEventListener('click', () => { A.sound.toggle(); syncSound(); });
    syncSound();
    document.getElementById('profile-btn').addEventListener('click', openProfile);
    document.getElementById('home-link').addEventListener('click', (e) => { e.preventDefault(); A.ui.exitGame(); });
    render();
    if (location.hash === '#gunluk') A.ui.startGame('daily', 'world', {});
  }

  const origCheck = A.progress.checkBadges;
  A.progress.checkBadges = (r) => { const f = origCheck(r); updateBadgeCount(); return f; };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
