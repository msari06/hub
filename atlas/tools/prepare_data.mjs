// atlas/tools/prepare_data.mjs — ham kaynaklardan oyun verisini üretir.
//
//   cd atlas/tools && npm install && npm run data
//
// Girdiler (npm):  world-atlas (Natural Earth 1:50m sınırlar, TopoJSON),
//                  world-countries (bölge, komşuluk, alan, koordinat),
//                  flag-icons (4x3 SVG bayraklar)
// Girdi (elle):    meta_tr.mjs (Türkçe ad, başkent, bayrak renkleri)
// Çıktılar:        ../data/world.js, ../data/countries.js, ../data/flags.js,
//                  ../js/vendor/*.min.js
//
// Çıktılar `window.ATLAS_*` global'leri tanımlayan klasik script dosyalarıdır;
// böylece oyun file:// üzerinden de (fetch/CORS olmadan) açılır.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as d3 from 'd3-geo';
import * as topojson from 'topojson-client';
import { META, NO_CAPITAL_QUIZ, TIER1, TERRITORY_NAMES } from './meta_tr.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXTRA = ['XK', 'TW', 'PS', 'VA']; // BM üyesi olmayan ama oyuna dahil edilenler

const topo = structuredClone(require('world-atlas/countries-50m.json'));
const wc = require('world-countries');

const byCca3 = Object.fromEntries(wc.map((c) => [c.cca3, c]));
byCca3.UNK = wc.find((c) => c.cca2 === 'XK');
const playable = wc.filter((c) => c.unMember || EXTRA.includes(c.cca2));
const playSet = new Set(playable.map((c) => c.cca2));
const byNum = Object.fromEntries(playable.filter((c) => c.ccn3).map((c) => [c.ccn3, c]));

const COLOR_KEYS = new Set(['kirmizi', 'bordo', 'turuncu', 'sari', 'yesil', 'acikmavi', 'mavi', 'siyah', 'beyaz']);
const MIDEAST = 'TR CY SY LB IL PS JO IQ IR SA KW BH QA AE OM YE EG'.split(' ');
const EUROPE_EXTRA = ['TR', 'GE', 'AM', 'AZ'];

function regionsOf(c) {
  const r = ['world'];
  if (c.region === 'Europe' || EUROPE_EXTRA.includes(c.cca2)) r.push('europe');
  if (c.region === 'Asia' || c.cca2 === 'RU') r.push('asia');
  if (c.region === 'Africa') r.push('africa');
  if (['North America', 'Central America', 'Caribbean'].includes(c.subregion)) r.push('namerica');
  if (c.subregion === 'South America') r.push('samerica');
  if (c.region === 'Oceania') r.push('oceania');
  if (MIDEAST.includes(c.cca2)) r.push('mideast');
  return r;
}

// ── Topoloji: kimlikleri ISO alpha-2'ye çevir, Antarktika'yı çıkar ──────────
const geoms = topo.objects.countries.geometries;
const territories = {};
let tIndex = 0;
topo.objects.countries.geometries = geoms
  .filter((g) => g.id !== '010')
  .map((g) => {
    const name = g.properties.name;
    const c = name === 'Kosovo' ? byCca3.UNK : byNum[g.id];
    if (c && playSet.has(c.cca2)) return { ...g, id: c.cca2, properties: {} };
    const tid = `T${++tIndex}`;
    const any = wc.find((x) => x.ccn3 && x.ccn3 === g.id);
    territories[tid] = TERRITORY_NAMES[name] || any?.translations?.tur?.common || name;
    return { ...g, id: tid, properties: {} };
  });

const features = topojson.feature(topo, topo.objects.countries).features;
const featById = Object.fromEntries(features.map((f) => [f.id, f]));

// En büyük poligonun merkezi: küçük ülke işaretçisi ve etiket noktası.
function labelPoint(f) {
  if (!f) return null;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null;
  let bestArea = -1;
  for (const p of polys) {
    const a = d3.geoArea({ type: 'Polygon', coordinates: p });
    if (a > bestArea) { bestArea = a; best = p; }
  }
  const [lon, lat] = d3.geoCentroid({ type: 'Polygon', coordinates: best });
  return [+lon.toFixed(2), +lat.toFixed(2)];
}

// ── Ülke listesi ──────────────────────────────────────────────────────────
const problems = [];
const countries = playable.map((c) => {
  const m = META[c.cca2];
  if (!m) { problems.push(`meta eksik: ${c.cca2}`); return null; }
  const [name, capital, colorStr, ...aliases] = m;
  const colors = colorStr.split(' ');
  for (const k of colors) if (!COLOR_KEYS.has(k)) problems.push(`${c.cca2}: bilinmeyen renk ${k}`);
  const borders = c.borders
    .map((b) => byCca3[b]?.cca2)
    .filter((b) => b && playSet.has(b));
  const area = Math.round(c.area);
  const tier = TIER1.includes(c.cca2) ? 1 : area < 30000 ? 3 : 2;
  const alias = new Set([...aliases, c.name.common, c.name.official, c.translations?.tur?.common].filter(Boolean));
  alias.delete(name);
  const f = featById[c.cca2];
  return {
    id: c.cca2,
    n: name,
    cap: capital,
    capq: NO_CAPITAL_QUIZ.includes(c.cca2) ? 0 : 1,
    r: regionsOf(c),
    b: borders,
    a: area,
    t: tier,
    col: colors,
    al: [...alias],
    lp: labelPoint(f) || [c.latlng[1], c.latlng[0]],
    geo: f ? 1 : 0,
  };
}).filter(Boolean);

for (const k of Object.keys(META)) if (!playSet.has(k)) problems.push(`fazla meta: ${k}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
countries.sort((a, b) => a.n.localeCompare(b.n, 'tr'));

// ── Bayraklar ─────────────────────────────────────────────────────────────
const flagDir = path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3');
const flags = {};
for (const c of countries) {
  flags[c.id] = fs.readFileSync(path.join(flagDir, `${c.id.toLowerCase()}.svg`), 'utf8').trim();
}

// ── Yazım ─────────────────────────────────────────────────────────────────
const banner = '// Otomatik üretildi: atlas/tools/prepare_data.mjs — elle düzenlemeyin.\n';
const write = (rel, body) => {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  console.log(`✓ ${rel} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
};

write('data/world.js', `${banner}// Kaynak: Natural Earth 1:50m (world-atlas@2.0.2, kamu malı)\nwindow.ATLAS_TOPO=${JSON.stringify(topo)};\n`);
write('data/countries.js', `${banner}window.ATLAS_COUNTRIES=${JSON.stringify(countries)};\nwindow.ATLAS_TERRITORIES=${JSON.stringify(territories)};\n`);
write('data/flags.js', `${banner}// Kaynak: flag-icons@7.5.0 (MIT, Lipis)\nwindow.ATLAS_FLAGS=${JSON.stringify(flags)};\n`);

const vendor = [
  ['d3-array/dist/d3-array.min.js', 'd3-array.min.js'],
  ['d3-geo/dist/d3-geo.min.js', 'd3-geo.min.js'],
  ['topojson-client/dist/topojson-client.min.js', 'topojson-client.min.js'],
];
for (const [from, to] of vendor) {
  write(`js/vendor/${to}`, fs.readFileSync(path.join(HERE, 'node_modules', from), 'utf8'));
}
console.log(`  ${countries.length} ülke, ${Object.keys(territories).length} bölge`);
