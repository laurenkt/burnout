'use strict';

// The six areas (Maslach & Leiter), clockwise from the top of the map.
const AREAS = [
  { key: 'workload', color: '#9C5B45', rgb: '156,91,69', shape: '54% 46% 48% 52% / 50% 52% 48% 50%',
    meaning: 'How much is asked of you, and how demanding it is, and whether there’s ever a chance to rest and recover.',
    example: 'Covering for two people who left, with no end in sight.' },
  { key: 'control', color: '#7A6A3C', rgb: '122,106,60', shape: '48% 52% 55% 45% / 53% 47% 52% 48%',
    meaning: 'How much say you have in decisions that affect your work, and whether you have what you need to do it well.',
    example: 'The plan changes every week and nobody asks me first.' },
  { key: 'reward', color: '#4E6B4A', rgb: '78,107,74', shape: '52% 48% 45% 55% / 47% 53% 47% 53%',
    meaning: 'What you get back for the work: pay, recognition from others, and satisfaction in the work itself.',
    example: 'Years of good work, with no pay rise and no one noticing.' },
  { key: 'community', color: '#3F6470', rgb: '63,100,112', shape: '45% 55% 52% 48% / 55% 45% 55% 45%',
    meaning: 'Your relationships with people at work: whether there’s support and trust, and whether conflict gets worked out.',
    example: 'A falling-out with a colleague that nobody has helped sort out.' },
  { key: 'fairness', color: '#7A4460', rgb: '122,68,96', shape: '47% 53% 52% 48% / 53% 46% 54% 47%',
    meaning: 'Whether decisions at work are made fairly, and whether you’re treated with respect.',
    example: 'Someone junior promoted past me, and no reason given.' },
  { key: 'values', color: '#5A5378', rgb: '90,83,120', shape: '50% 50% 55% 45% / 48% 55% 45% 52%',
    meaning: 'Whether the work still fits what you care about and why you took the job, or keeps asking you to do things you don’t believe in.',
    example: 'Being told to cut corners on something I think really matters.' },
];
const AREA = Object.fromEntries(AREAS.map(a => [a.key, a]));

// Map geometry, in the map's own coordinate space. Three bands of severity:
// inside R1 bothers you a lot, R1–R2 somewhat, R2–EDGE a little.
const W = 900, H = 720, CX = 450, CY = 360;
const R1 = 100, R2 = 200, EDGE = 300, LABEL_R = 338;
const BANDS = [
  { r: R1, word: 'a lot', alpha: 0.62 },
  { r: R2, word: 'somewhat', alpha: 0.3 },
  { r: EDGE, word: 'a little', alpha: 0.09 },
];
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

const NUMS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const num = n => NUMS[n] ?? String(n);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

function geom(x, y) {
  const dx = x - CX, dy = y - CY;
  const r = Math.hypot(dx, dy);
  let a = Math.atan2(dx, -dy) * 180 / Math.PI;
  if (a < 0) a += 360;
  return { r, area: AREAS[Math.floor(a / 60) % 6].key };
}
const polar = (deg, r) => [CX + r * Math.sin(deg * Math.PI / 180), CY - r * Math.cos(deg * Math.PI / 180)];
const areaOf = it => geom(it.x, it.y).area;
const weight = it => 1 - Math.min(geom(it.x, it.y).r, EDGE) / EDGE;
const severity = r => (BANDS.find(b => r < b.r) || BANDS[2]).word;
const dotSize = it => Math.round(16 + 16 * weight(it));
const blob = (a, size = 13) => `<span class="blob" style="width:${size}px;height:${size}px;border-radius:${a.shape};background:${a.color}"></span>`;
const and = list => list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];

// ---------- state ----------
// Persisted to localStorage only; nothing leaves the browser.
const STORE = 'burnout-worksheet-v2';
const SCREENS = ['intro', 'map', 'plan'];
const OLD_SCREENS = { summary: 'plan', takeaway: 'plan' };
const S = {
  screen: 'intro',
  items: [],        // { id, name, x, y, eased, reflect: { thought, proportion, realistic, fair, balanced, control, worth, small, when, rather } }
  hover: 'workload',
  selected: null,   // id of the item open in the side panel
  press: null,      // pointer down on a point, not yet a drag
  drag: null,       // { id, fromX, fromY }
  nextId: 1,
};
function save() {
  // Once something new is added after a clear, undoing would throw it away.
  if (cleared && S.items.length) { cleared = null; hideUndo(); }
  try {
    const { screen, items, hover, nextId } = S;
    localStorage.setItem(STORE, JSON.stringify({ screen, items, hover, nextId, cx: CX }));
  } catch {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE));
    if (!d || !Array.isArray(d.items)) return;
    // Saved positions are relative to the map centre at the time; shift them if it has moved.
    const shift = CX - (d.cx || 380);
    if (shift) for (const it of d.items) it.x += shift;
    Object.assign(S, {
      items: d.items, hover: AREA[d.hover] ? d.hover : S.hover,
      nextId: d.nextId || d.items.length + 1,
      screen: SCREENS.includes(d.screen) ? d.screen : OLD_SCREENS[d.screen] || 'intro',
    });
  } catch {}
}

const byId = id => S.items.find(i => i.id === id);
const onMap = () => S.items.filter(i => !i.eased);

// Areas ranked by their heaviest item, each with its items heaviest first.
function ranked() {
  const groups = {};
  for (const it of onMap()) (groups[areaOf(it)] ||= []).push(it);
  return Object.entries(groups)
    .map(([key, list]) => ({ area: AREA[key], items: list.sort((a, b) => weight(b) - weight(a)) }))
    .sort((a, b) => weight(b.items[0]) - weight(a.items[0]));
}

// ---------- navigation (browser history) ----------
const hashScreen = () => {
  const h = location.hash.slice(1);
  return SCREENS.includes(h) ? h : OLD_SCREENS[h] || null;
};
function go(screen, { replace = false, select = null } = {}) {
  if (S.screen === 'map') dropEmptySelection();
  S.screen = screen;
  S.selected = select; S.drag = null; S.press = null;
  history[replace ? 'replaceState' : 'pushState']({ screen }, '', '#' + screen);
  render();
  window.scrollTo({ top: 0 });
}
window.addEventListener('popstate', e => {
  if (S.screen === 'map') dropEmptySelection();
  S.screen = e.state?.screen || hashScreen() || 'intro';
  S.selected = null; S.drag = null; S.press = null;
  render();
});

function render() {
  ({ intro: renderIntro, map: renderMapScreen, plan: renderPlan })[S.screen]();
  save();
  $('#home').onclick = () => go('intro');
  for (const b of $$('.step-link')) b.onclick = () => { if (b.dataset.go !== S.screen) go(b.dataset.go); };
  $('#clear').onclick = clearAll;
}

// Clearing happens straight away; what was cleared is kept in memory (not
// storage) so it can be undone until the page is reloaded.
let cleared = null;
function clearAll() {
  if (S.items.length) cleared = { items: S.items, nextId: S.nextId, screen: S.screen };
  S.items = []; S.nextId = 1; S.selected = null;
  try { localStorage.removeItem(STORE); } catch {}
  go('intro');
  showUndo();
}
function undoClear() {
  if (!cleared) return;
  const { items, nextId, screen } = cleared;
  cleared = null;
  Object.assign(S, { items, nextId });
  hideUndo();
  go(screen);
}
function showUndo() {
  if (!cleared) return;
  let bar = $('#undo-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'undo-bar';
    bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<span>Everything was cleared.</span><button class="undo-btn" id="undo">Undo</button><button class="undo-x" id="undo-x" aria-label="dismiss">×</button>`;
  bar.hidden = false;
  $('#undo').onclick = undoClear;
  $('#undo-x').onclick = () => { cleared = null; hideUndo(); };
}
function hideUndo() { const bar = $('#undo-bar'); if (bar) bar.hidden = true; }

const STEPS = [
  { screen: 'intro', label: 'What burnout is' },
  { screen: 'map', label: 'Map it out' },
  { screen: 'plan', label: 'Your plan' },
];

const frame = (body, status = '') => `
  <div class="card">
    <header class="bar">
      <button class="brand" id="home" title="back to the start">burnout</button>
      <nav class="stepper" aria-label="steps">${STEPS.map((st, i) => {
        const here = S.screen === st.screen, off = st.screen === 'plan' && !onMap().length && !S.items.length;
        return `<button class="step-link${here ? ' here' : ''}" data-go="${st.screen}"${off ? ' disabled title="Add something to the map first"' : ''}${here ? ' aria-current="step"' : ''}><span class="step-n">${i + 1}</span><span class="step-label" data-text="${st.label}">${st.label}</span></button>`;
      }).join('<span class="step-sep" aria-hidden="true"></span>')}</nav>
      <span class="status">${status}</span>
      <span class="storage"><span class="storage-label">saved locally only</span><button class="link" id="clear">clear</button></span>
    </header>${body}
  </div>`;

// The same footer on every page: secondary things on the left, one primary button on the right.
const pageFoot = (primary, left = '') => `<div class="page-foot"><div class="foot-left">${left}</div>${primary}</div>`;

// ---------- intro ----------
function renderIntro() {
  app.innerHTML = frame(`
    <div class="intro">
      <div class="intro-head">
        <p class="big">Burnout is a state of exhaustion and detachment that builds up when stress at work goes on for a long time without easing.</p>
        <p class="copy">The World Health Organization describes it by three signs: feeling drained, feeling distant or cynical about your work, and feeling less effective at it.</p>
        <p class="copy">This worksheet helps you work out why you are feeling this way: what is feeding it, how much each thing weighs on you, and what, if anything, you want to do about it.</p>
      </div>
      <h2 class="section-h">The six areas</h2>
      <p class="copy section-lede" style="margin-bottom:14px">The psychologist Christina Maslach began studying burnout in the 1970s, interviewing nurses, social workers and others in demanding caring jobs about the exhaustion they kept describing. The questionnaire she went on to develop, the Maslach Burnout Inventory, was the first burnout measure built on thorough psychometric research, and is still in use today.</p>
      <p class="copy section-lede">With Michael Leiter she later looked at what tends to sit underneath it. Their Areas of Worklife model treats burnout as a problem of fit between a person and their work, across the six areas below. It rarely comes from all six at once: usually one or two carry most of the weight, and each calls for a different kind of response. Having less on your plate does little for a sense that decisions are unfair.</p>
      <div class="areas">
        ${AREAS.map(a => `
          <div class="area-cell">
            <div class="area-name">${blob(a)}${a.key}</div>
            <div class="area-meaning">${a.meaning}</div>
            <div class="area-example">${a.example}</div>
          </div>`).join('')}
      </div>
      ${pageFoot('<button class="btn" id="start">Next: map it out</button>')}
    </div>`);
  $('#start').onclick = () => go('map');
}

// ---------- the map drawing ----------
// One segment of a band within a wedge (a full sector for the innermost band).
// pad trims a few degrees off each side, to leave gaps between neighbours.
function segment(i, rIn, rOut, pad = 0) {
  const a0 = i * 60 + pad, a1 = i * 60 + 60 - pad;
  const [ox0, oy0] = polar(a0, rOut), [ox1, oy1] = polar(a1, rOut);
  if (!rIn) return `M${CX} ${CY}L${ox0} ${oy0}A${rOut} ${rOut} 0 0 1 ${ox1} ${oy1}Z`;
  const [ix0, iy0] = polar(a0, rIn), [ix1, iy1] = polar(a1, rIn);
  return `M${ix0} ${iy0}L${ox0} ${oy0}A${rOut} ${rOut} 0 0 1 ${ox1} ${oy1}L${ix1} ${iy1}A${rIn} ${rIn} 0 0 0 ${ix0} ${iy0}Z`;
}

// A circle with a waveform drawn along its border, as a clip-path. Each sample
// sits at a fixed angle (nothing rotates or travels); only its amplitude moves,
// independently of its neighbours. Nearer the centre the waveform is louder,
// faster and more erratic.
const JAG = {
  // speed and amp run from the outer edge of the band (first) to its inner edge (second)
  hot: { samples: 72, amp: [0.2, 0.3], speed: [22, 120] },
  warm: { samples: 60, amp: [0.06, 0.1], speed: [4, 12] },
};
const waveParams = new Map();
function params(band, seed) {
  const key = band + seed;
  if (!waveParams.has(key)) {
    let s = seed * 9301 + (band === 'hot' ? 49297 : 17);
    const rand = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    waveParams.set(key, Array.from({ length: JAG[band].samples }, () =>
      [0.5 + rand(), 0.5 + rand() * 1.5, 2 + rand() * 2, rand() * 6.28, rand() * 6.28, rand() * 6.28]));
  }
  return waveParams.get(key);
}
// close: 0 at the outer edge of the dot's band, 1 at its inner edge.
function jagged(band, seed, t, close = 0) {
  const J = JAG[band], ps = params(band, seed), pts = [], samples = J.samples;
  const amp = J.amp[0] + (J.amp[1] - J.amp[0]) * close, speed = J.speed[0] + (J.speed[1] - J.speed[0]) * close;
  for (let i = 0; i < samples; i++) {
    const [f1, f2, f3, p1, p2, p3] = ps[i], th = i / samples * Math.PI * 2;
    const v = 0.5 * Math.sin(t * speed * f1 + p1) + 0.3 * Math.sin(t * speed * f2 + p2) + 0.2 * Math.sin(t * speed * f3 + p3);
    const r = 50 * (1 - amp) + 50 * amp * v;
    pts.push(`${(50 + r * Math.cos(th)).toFixed(2)}% ${(50 + r * Math.sin(th)).toFixed(2)}%`);
  }
  return `polygon(${pts.join(',')})`;
}
if (!REDUCED_MOTION) {
  const frame = now => {
    const t = now / 1000;
    for (const d of $$('.pt .dot')) {
      if (d.dataset.band !== 'calm') d.style.clipPath = jagged(d.dataset.band, +d.dataset.seed, t, +d.dataset.close);
      // Colour throb: barely there at the edge, deep and quick at the centre.
      const w = +d.dataset.w, depth = 0.04 + 0.4 * w * w, hz = 0.35 + 2.4 * w;
      const beat = 0.5 + 0.5 * Math.sin(t * hz * Math.PI * 2 + +d.dataset.seed);
      d.style.filter = `brightness(${(1 - depth * 0.45 * beat).toFixed(3)}) saturate(${(1 + depth * 1.4 * beat).toFixed(3)})`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Six wedges, each in three bands that get bolder towards the centre.
function mapSvg(id, { labels = true, dots = false } = {}) {
  const bands = BANDS.map((b, bi) => {
    const rIn = bi ? BANDS[bi - 1].r : 0;
    return AREAS.map((a, i) =>
      `<path class="wedge" data-area="${a.key}" data-alpha="${b.alpha}" d="${segment(i, rIn, b.r)}" fill="${a.color}" fill-opacity="${b.alpha}"/>`).join('');
  }).join('');
  const rings = `<circle cx="${CX}" cy="${CY}" r="${EDGE}" fill="none" stroke="#C9BFAD" stroke-width="1"/>`;
  // Arcs outside the circle, sized by how much is in each area (set by updateLoad).
  const loads = AREAS.map(a => `<path class="load-arc" data-area="${a.key}" fill="${a.color}"/>`).join('');
  const dividers = AREAS.map((_, i) => { const [x, y] = polar(i * 60, EDGE); return `<line x1="${CX}" y1="${CY}" x2="${x}" y2="${y}" stroke="#F7F3EA" stroke-width="3"/>`; }).join('');
  const scale = labels ? BANDS.map((b, i) => {
    const mid = ((i ? BANDS[i - 1].r : 0) + b.r) / 2;
    return `<text class="scale scale-${i}" x="${CX + 9}" y="${CY - mid + 5}">${b.word}</text>`;
  }).join('') : '';
  // The two side labels sit level with the centre, anchored outwards so they grow away from the circle.
  const names = labels ? AREAS.map((a, i) => {
    const mid = i * 60 + 30;
    const side = mid === 90 ? 'start' : mid === 270 ? 'end' : '';
    const [x, y] = side ? [CX + (side === 'start' ? 1 : -1) * (EDGE + 30), CY] : polar(mid, LABEL_R);
    return `<text class="area-label${side ? (side === 'start' ? ' side-r' : ' side-l') : ''}" data-area="${a.key}" x="${x}" y="${y}" fill="${a.color}"${side ? ` style="text-anchor:${side}"` : ''}>${a.key}</text>`;
  }).join('') : '';
  const pts = dots ? onMap().map(it => {
    const a = AREA[areaOf(it)];
    return `<circle cx="${it.x}" cy="${it.y}" r="${dotSize(it) * 0.9}" fill="${a.color}" stroke="#F7F3EA" stroke-width="5"/>`;
  }).join('') : '';
  return `<svg class="map-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">${bands}${rings}${loads}${dividers}${scale}${names}${pts}</svg>`;
}

// How much each area is carrying: heavier things count for much more than light ones.
function areaLoad() {
  const load = Object.fromEntries(AREAS.map(a => [a.key, 0]));
  for (const it of onMap()) load[areaOf(it)] += weight(it) ** 2;
  return load;
}

// Make the areas carrying the most stand out: a thicker arc outside the circle,
// stronger shading and a larger label. Areas with nothing in them fade back.
function updateLoad(el) {
  const svg = el && $('.map-svg', el);
  if (!svg) return;
  const load = areaLoad(), max = Math.max(...Object.values(load));
  AREAS.forEach((a, i) => {
    const rel = max ? load[a.key] / max : 0;
    // Every band of a heavy area gets darker and more saturated; light areas fade back.
    for (const w of $$(`.wedge[data-area="${a.key}"]`, svg)) {
      const alpha = +w.dataset.alpha;
      w.setAttribute('fill-opacity', max ? (alpha * (0.55 + 0.45 * rel) + 0.18 * rel).toFixed(3) : alpha);
      w.style.filter = max && rel ? `saturate(${(1 + 0.6 * rel).toFixed(2)}) brightness(${(1 - 0.1 * rel).toFixed(2)})` : '';
    }
    $(`.load-arc[data-area="${a.key}"]`, svg).setAttribute('d', rel ? segment(i, EDGE + 5, EDGE + 5 + 3 + 15 * rel, 1.5) : '');
    const lab = $(`.area-label[data-area="${a.key}"]`, svg);
    if (lab) {
      lab.style.fontSize = max ? `calc(${Math.round(18 + 9 * rel)}px * var(--label-k, 1))` : '';
      lab.style.fontWeight = !max ? '' : rel > 0.99 ? 700 : rel > 0.4 ? 600 : 400;
    }
  });
}

function highlight(el, key) {
  if (!el) return;
  for (const w of $$('.wedge', el)) w.classList.toggle('on', w.dataset.area === key);
  for (const l of $$('.area-label', el)) l.classList.toggle('on', l.dataset.area === key);
  if (el.id === 'map') showArea(key);
}

// Scale the fixed-size map down to fit narrow containers.
function fit(wrap) {
  const map = wrap.firstElementChild;
  const s = Math.min(1, wrap.clientWidth / W);
  map.style.transform = `scale(${s})`;
  map.style.setProperty('--inv', (1 / s).toFixed(3));
  wrap.style.height = H * s + 'px';
}
const fitObserver = new ResizeObserver(entries => { for (const e of entries) fit(e.target); });
// Phones and narrow windows: the item panel sits below the map, so don't jump the keyboard up.
const compact = () => matchMedia('(max-width: 1060px), (pointer: coarse)').matches;

function renderPoints(el) {
  updateLoad(el);
  const dragId = S.drag?.id;
  $('.points', el).innerHTML = onMap().map(it => {
    const a = AREA[areaOf(it)], s = dotSize(it), left = it.x < CX, r = geom(it.x, it.y).r, w = weight(it);
    const band = r < R1 ? 'hot' : r < R2 ? 'warm' : 'calm';
    const close = band === 'hot' ? 1 - r / R1 : band === 'warm' ? (R2 - r) / (R2 - R1) : 0;
    // Jagged dots are drawn a little larger so the spikes do not shrink them.
    const ds = Math.round(s * (band === 'hot' ? 1.3 : band === 'warm' ? 1.08 : 1));
    const cls = ['pt', band, it.id === S.selected ? 'selected' : '', it.id === dragId ? 'lifted' : '', dragId && it.id !== dragId ? 'dim' : ''].join(' ');
    const label = it.name || (it.id === S.selected ? 'new' : '');
    // Labels get larger, darker and heavier the more something bothers you.
    const size = Math.round(15 + 7 * w), shade = Math.round(122 - 76 * w);
    const labStyle = `font-size:calc(${size}px * var(--label-k, 1));top:0;transform:translateY(-50%);font-weight:${w > 0.66 ? 600 : w > 0.33 ? 500 : 400};color:rgb(${shade},${shade - 4},${shade - 10})`;
    return `<div class="${cls}" data-id="${it.id}" style="left:${it.x}px;top:${it.y}px" tabindex="0" role="button" aria-label="${esc(label)}, ${a.key}, bothers you ${severity(r)}">
      ${it.id === S.selected ? `<div class="sel-ring" style="width:${s + 14}px;height:${s + 14}px;left:${-s / 2 - 7}px;top:${-s / 2 - 7}px;border-color:${a.color}"></div>` : ''}
      <div class="hit"></div>
      <div class="dot" style="width:${ds}px;height:${ds}px;left:${-ds / 2}px;top:${-ds / 2}px;background:${a.color}${band === 'calm' ? '' : `;clip-path:${jagged(band, it.id, performance.now() / 1000, close)}`}" data-band="${band}" data-seed="${it.id}" data-close="${close.toFixed(3)}" data-w="${w.toFixed(3)}"></div>
      ${label ? `<div class="lab${it.name ? '' : ' placeholder'}${left ? ' l' : ''}" style="${left ? `right:${s / 2 + 8}px` : `left:${s / 2 + 8}px`};${labStyle}">${esc(label)}</div>` : ''}
    </div>`;
  }).join('');
}

// ---------- map screen ----------
function renderMapScreen() {
  app.innerHTML = frame(`
    <div class="split">
      <div class="map-top" id="map-top"></div>
      <div class="map-wrap" id="map-wrap"><div class="map interactive" id="map">
        ${mapSvg('m')}
        <div class="points"></div>
        <div class="overlay"></div>
      </div></div>
      <aside class="side" id="side"></aside>
      <div class="map-foot" id="map-foot"></div>
    </div>`);
  const map = $('#map');
  fit(map.parentElement);
  fitObserver.observe(map.parentElement);
  renderPoints(map);
  renderSide();
  wireMap(map);
}

function renderTop() {
  const top = $('#map-top');
  if (!top) return;
  top.innerHTML = `
    <p class="instr"><b>${matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click'} in the circle to add something that is bothering you.</b> Put it in the area it belongs to — the closer to the centre, the more it bothers you.</p>
    <div class="zone-now" id="zone-now"></div>`;
  updateZoneNow();
  const foot = $('#map-foot');
  if (foot) foot.innerHTML = pageFoot(onMap().length
    ? '<button class="btn" id="to-plan">Next: your plan</button>'
    : '<button class="btn" id="to-plan" disabled title="Add something to the map first">Next: your plan</button>',
    '<button class="btn secondary" id="to-intro">Back: what burnout is</button>');
  const btn = $('#to-plan');
  if (btn) btn.onclick = () => go('plan');
  const back = $('#to-intro');
  if (back) back.onclick = () => go('intro');
}

function renderSide() {
  renderTop();
  const side = $('#side');
  if (!side) return;
  const it = S.selected && byId(S.selected);
  if (it) return renderDetail(side, it);
  // All six areas are listed; the one under the cursor is highlighted, and
  // hovering one in the list highlights it on the map too.
  side.innerHTML = `<ul class="area-list">${AREAS.map(a => `
    <li class="area-li" data-area="${a.key}" style="--c:${a.color};--bg:rgba(${a.rgb},.1)">
      <div class="area-li-name">${blob(a, 12)}${a.key}</div>
      <div class="area-li-meaning">${a.meaning}</div>
    </li>`).join('')}</ul>`;
  const map = $('#map');
  for (const li of $$('.area-li', side)) {
    li.onmouseenter = () => highlight(map, li.dataset.area);
    li.onmouseleave = () => highlight(map, null);
  }
}

// Small screens: above the map, describe only the area the selected (or dragged) item is in.
function updateZoneNow() {
  const box = $('#zone-now');
  if (!box) return;
  const it = byId(S.drag?.id) || (S.selected && byId(S.selected));
  const g = it && geom(it.x, it.y);
  if (!it || g.r > EDGE) {
    box.removeAttribute('style');
    box.innerHTML = '<p class="zone-empty">Tap something on the map to see which area it is in.</p>';
    return;
  }
  const a = AREA[g.area];
  box.style.cssText = `border-color:${a.color};background:rgba(${a.rgb},.08)`;
  box.innerHTML = `<div class="zone-name" style="color:${a.color}">${blob(a, 12)}${a.key}<span>· bothers you ${severity(g.r)}</span></div><p class="zone-meaning">${a.meaning}</p>`;
}

// Highlight an area in the side-panel list (null clears it).
function showArea(key) {
  for (const li of $$('.area-li')) li.classList.toggle('on', li.dataset.area === key);
}

function detailHead(it) {
  const a = AREA[areaOf(it)];
  return `${blob(a, 12)}<span style="color:${a.color}">${a.key}</span><span class="sev">· bothers you ${severity(geom(it.x, it.y).r)}</span>`;
}

// The per-item form: first check the thought (in the spirit of a CBT thought
// record), then work out whether it can change and whether that is worth the effort.
const CHECKS = [
  { k: 'proportion', q: 'Is the strength of the feeling in proportion to how much it actually affects you?' },
  { k: 'realistic', q: 'Is what you want here something you can reasonably expect, from people or from this job?' },
  { k: 'fair', q: 'Is the way you are seeing it fair, to you and to the others involved?' },
];
const CONTROL = [
  ['mine', 'Mine to change'],
  ['influence', 'I can influence it'],
  ['outside', 'Out of my hands'],
];
const WORTH = [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'Not really']];

// act: something to do about it. letgo: to be let be. null: not worked out yet.
function outcome(it) {
  const r = it.reflect;
  if (r.control === 'outside' || r.worth === 'no') return 'letgo';
  if (r.control && (r.worth === 'yes' || r.worth === 'maybe')) return 'act';
  return null;
}

function renderDetail(side, it) {
  const r = it.reflect;
  const area = (field, ph = '—') => `<textarea class="answer" rows="1" data-k="${field}" placeholder="${ph}">${esc(r[field])}</textarea>`;
  const chips = (key, options) => `<div class="chips" role="group">${options.map(([v, label]) =>
    `<button class="chip${r[key] === v ? ' on' : ''}" data-set="${key}" data-v="${v}" aria-pressed="${r[key] === v}">${label}</button>`).join('')}</div>`;
  const checked = CHECKS.some(c => r[c.k]);
  const doubts = CHECKS.some(c => r[c.k] && r[c.k] !== 'yes');
  const out = outcome(it);
  const thought = (r.thought || '').trim();

  // One step open at a time, so the panel stays about as tall as the map.
  const open = S.openStep ?? (!thought ? 1 : !checked ? 2 : 3);
  const next = n => `<button class="link next-step" data-step="${n}">next</button>`;
  const step = (n, title, summary, body, long = false) => `
    <section class="step${open === n ? ' open' : ''}">
      <button class="step-h${long ? ' long' : ''}" data-step="${n}" aria-expanded="${open === n}"><span class="n">${n}</span><span class="title">${title}${long && open !== n && summary ? `<span class="sum">${esc(summary)}</span>` : ''}</span>${!long && open !== n && summary ? `<span class="sum">${esc(summary)}</span>` : ''}</button>
      ${open === n ? `<div class="step-body">${body}</div>` : ''}
    </section>`;
  const controlLabel = (CONTROL.find(([v]) => v === r.control) || [])[1];

  side.innerHTML = `
    <div class="detail">
      <div class="detail-head"><span id="detail-head">${detailHead(it)}</span><button class="link" id="close">close</button></div>
      <input class="name-input" data-k="name" maxlength="48" placeholder="a few words" value="${esc(it.name)}" aria-label="short name">

      ${step(1, 'The thought', thought, `
        <label class="q">When it comes up, what do you find yourself thinking?</label>
        ${area('thought', 'e.g. nobody here notices anything I do')}
        ${next(2)}`)}

      ${step(2, 'Strong feelings are real, but they are not always an accurate reading. A quick check helps separate the two.', checked ? (doubts ? 'not entirely balanced' : 'seems balanced') : '', `
        ${CHECKS.map(c => `<div class="check"><p class="q">${c.q}</p>${chips(c.k, [['yes', 'Yes'], ['partly', 'Partly'], ['no', 'No']])}</div>`).join('')}
        ${doubts ? `
          <label class="sub">A more balanced way to put it</label>
          ${area('balanced', 'e.g. one launch went unnoticed, but I was thanked for the last one')}
          <p class="coach">Imagine a friend told you this. What would you say back to them?</p>` : ''}
        ${next(3)}`, true)}

      ${step(3, 'How much of this is in your hands?', out ? (out === 'act' ? 'worth acting on' : 'worth letting be') : controlLabel || '', `
        ${chips('control', CONTROL)}
        ${r.control === 'outside' ? '' : '<p class="coach">Some things are just part of the world you work in, like the economic system, a health condition you live with, or how your industry works. Others you can genuinely shape. It helps to know which is which.</p>'}
        ${r.control && r.control !== 'outside' ? `
          <p class="q">Would putting effort in actually change anything?</p>
          ${chips('worth', WORTH)}` : ''}
        ${out === 'act' ? `
          <div class="verdict act">Worth acting on</div>
          <label class="sub">The smallest thing you could do</label>${area('small')}
          <label class="sub">When</label>${area('when')}` : ''}
        ${out === 'letgo' ? `
          <div class="verdict letgo">Worth letting be</div>
          <div class="advice">
            <p>Some things won't change however much effort you put in. Staying frustrated about them doesn't change them either; it just wears you down.</p>
            <p>Letting it be isn't agreeing with it or pretending it's fine. It's accepting that this one is outside your control, so energy can be spent on other things.</p>
          </div>
          <label class="sub">Where would you rather put that energy?</label>${area('rather')}` : ''}`)}

      <div class="actions">
        <button class="btn" id="done">Done</button>
        <button class="link" id="remove">remove</button>
      </div>
    </div>`;

  for (const el of $$('[data-k]', side)) {
    if (el.tagName === 'TEXTAREA') autoGrow(el);
    el.addEventListener('input', () => {
      const k = el.dataset.k;
      if (k === 'name' || k === 'note') it[k] = el.value; else r[k] = el.value;
      if (k === 'name') renderPoints($('#map'));
      if (el.tagName === 'TEXTAREA') autoGrow(el);
      save();
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeDetail();
      if (e.key === 'Enter' && el.dataset.k === 'name') { e.preventDefault(); $('.step.open .answer, .step.open .chip', side)?.focus(); }
    });
  }
  for (const b of $$('[data-set]', side)) b.onclick = () => {
    const key = b.dataset.set, v = b.dataset.v;
    r[key] = r[key] === v ? null : v;
    if (key === 'control' && r.control === 'outside') r.worth = null;
    save();
    renderDetail(side, it);
    $(`[data-set="${key}"][data-v="${v}"]`, side)?.focus({ preventScroll: true });
  };
  for (const b of $$('[data-step]', side)) b.onclick = () => {
    const n = +b.dataset.step;
    S.openStep = open === n && b.classList.contains('step-h') ? 0 : n;
    renderDetail(side, it);
    $('.step.open .answer, .step.open .chip', side)?.focus({ preventScroll: true });
  };
  $('#close', side).onclick = closeDetail;
  $('#done', side).onclick = closeDetail;
  $('#remove', side).onclick = () => { S.items = S.items.filter(i => i.id !== it.id); S.selected = null; refreshMap(); };
}

function autoGrow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

function selectItem(id, focusName = false) {
  if (S.selected && S.selected !== id) dropEmptySelection();
  if (S.selected !== id) S.openStep = null;
  S.selected = id;
  refreshMap();
  if (focusName) $('.name-input')?.focus();
}
// An item closed without a name is discarded.
function dropEmptySelection() {
  const it = S.selected && byId(S.selected);
  if (it && !it.name.trim()) S.items = S.items.filter(i => i.id !== it.id);
}
function closeDetail() {
  dropEmptySelection();
  S.selected = null;
  refreshMap();
}
function refreshMap() {
  const map = $('#map');
  if (!map) return;
  renderPoints(map); renderSide(); save();
}

function localPoint(map, e) {
  const r = map.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}

// Keep receiving a finger or mouse after it leaves the element; never let a refusal break the gesture.
function capture(el, id) { try { el.setPointerCapture(id); } catch {} }

function wireMap(map) {
  map.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const p = localPoint(map, e);
    const pt = e.target.closest('.pt');
    if (pt) {
      e.preventDefault();
      const it = byId(+pt.dataset.id);
      S.press = { id: it.id, sx: p.x, sy: p.y, ox: it.x, oy: it.y, touch: e.pointerType === 'touch' };
      capture(map, e.pointerId);
      return;
    }
    if (geom(p.x, p.y).r > EDGE) { if (S.selected) closeDetail(); return; }
    e.preventDefault();
    dropEmptySelection();
    const it = { id: S.nextId++, name: '', note: '', x: p.x, y: p.y, eased: false, reflect: {} };
    S.items.push(it);
    selectItem(it.id, !compact());
    // Keep the finger (or mouse) on it: moving before letting go drags the new item into place.
    S.press = { id: it.id, sx: p.x, sy: p.y, ox: it.x, oy: it.y, touch: e.pointerType === 'touch' };
    capture(map, e.pointerId);
  });

  map.addEventListener('pointermove', e => {
    const p = localPoint(map, e);
    if (S.press) {
      if (!S.drag && Math.hypot(p.x - S.press.sx, p.y - S.press.sy) < 4) return;
      if (!S.drag) {
        S.drag = { id: S.press.id, fromX: S.press.ox, fromY: S.press.oy, touch: S.press.touch };
        map.classList.add('grabbing');
      }
      const it = byId(S.drag.id);
      // The item sits exactly under the pointer (not offset by where on the dot you first pressed).
      it.x = Math.max(-30, Math.min(W + 30, p.x));
      it.y = Math.max(-30, Math.min(H + 30, p.y));
      const g = geom(it.x, it.y);
      highlight(map, g.r > EDGE ? null : g.area);
      renderPoints(map);
      renderDragOverlay(map);
      if (it.id === S.selected && $('#detail-head')) $('#detail-head').innerHTML = detailHead(it);
      updateZoneNow();
      return;
    }
    const g = geom(p.x, p.y);
    if (g.r > EDGE || e.target.closest('.pt')) { highlight(map, null); return; }
    highlight(map, g.area);
    showArea(g.area);
    S.hover = g.area;
  });

  map.addEventListener('pointerleave', () => { if (!S.drag) highlight(map, null); });

  const end = () => {
    if (!S.press) return;
    const { id } = S.press;
    S.press = null;
    if (!S.drag) { selectItem(id); return; }
    const it = byId(id);
    S.drag = null;
    map.classList.remove('grabbing');
    $('.overlay', map).innerHTML = '';
    highlight(map, null);
    if (geom(it.x, it.y).r > EDGE) {
      if (it.name.trim()) it.eased = true;
      else S.items = S.items.filter(i => i.id !== id);
      if (S.selected === id) S.selected = null;
    }
    refreshMap();
  };
  map.addEventListener('pointerup', end);
  map.addEventListener('pointercancel', end);

  map.addEventListener('keydown', e => {
    const pt = e.target.closest?.('.pt');
    if (pt && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectItem(+pt.dataset.id, true); }
  });
}

function renderDragOverlay(map) {
  const it = byId(S.drag.id), g = geom(it.x, it.y), from = geom(S.drag.fromX, S.drag.fromY);
  const outside = g.r > EDGE, a = AREA[g.area], fa = AREA[from.area];
  const color = outside ? '#7A736A' : a.color;
  const dx = it.x - S.drag.fromX, dy = it.y - S.drag.fromY;
  const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const cardLeft = it.x < CX ? Math.max(4, it.x - 240) : Math.min(W - 254, it.x + 14);
  const cardTop = Math.max(4, Math.min(H - 90, it.y + 30));
  const now = outside ? 'no longer bothering you' : `${a.key} · bothers you ${severity(g.r)}`;
  $('.overlay', map).innerHTML = `
    <div class="from-ghost" style="left:${S.drag.fromX}px;top:${S.drag.fromY}px;border-color:${color}"></div>
    <div class="trail" style="left:${S.drag.fromX}px;top:${S.drag.fromY}px;width:${len}px;transform:rotate(${ang}deg);border-color:${color}"></div>
    ${S.drag.touch ? `<div class="touch-ring" style="left:${it.x}px;top:${it.y}px;border-color:${color};background:${outside ? 'rgba(122,115,106,.12)' : `rgba(${a.rgb},.16)`}"></div>` : `<div class="move-card" style="left:${cardLeft}px;top:${cardTop}px;border-color:${color}">
      <div class="now" style="color:${color}">${now}</div>
    </div>`}`;
}

// ---------- plan ----------
// Each answer from the item form, said back as a plain sentence.
const SAY = {
  proportion: { yes: 'The feeling fits how much it affects you.', partly: 'The feeling is partly out of proportion to how much it affects you.', no: 'The feeling is bigger than how much it affects you.' },
  realistic: { yes: 'What you want here is reasonable to expect.', partly: 'What you want is only partly reasonable to expect.', no: 'What you want is not something you can reasonably expect here.' },
  fair: { yes: 'Your view of it is fair to you and to others.', partly: 'Your view of it is only partly fair.', no: 'Your view of it is not quite fair, to you or to others.' },
  control: { mine: 'It is yours to change.', influence: 'You can influence it.', outside: 'It is out of your hands.' },
  worth: { yes: 'Putting effort in would change it.', maybe: 'Putting effort in might change it.', no: 'Putting effort in would not change much.' },
};

function renderPlan() {
  const order = ranked().flatMap(g => g.items);
  if (!order.length && !S.items.length) return go('intro', { replace: true });
  const eased = S.items.filter(i => i.eased);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const trim = s => (s || '').trim();

  // Group by how much it bothers you, then by area (heaviest first within each band).
  const bands = BANDS.map((b, i) => {
    const inBand = order.filter(it => BANDS.indexOf(BANDS.find(x => geom(it.x, it.y).r < x.r) || BANDS[2]) === i);
    const areas = [];
    for (const it of inBand) {
      const key = areaOf(it);
      let g = areas.find(x => x.area.key === key);
      if (!g) areas.push(g = { area: AREA[key], items: [] });
      g.items.push(it);
    }
    return { i, word: b.word, areas };
  }).filter(b => b.areas.length);

  const decision = it => {
    const r = it.reflect, out = outcome(it);
    if (out === 'act') {
      const step = trim(r.small), when = trim(r.when);
      return `You are going to act on it${step ? `: <b>${esc(step)}</b>` : '.'}${when ? ` <span class="when">${esc(when)}</span>` : ''}`;
    }
    if (out === 'letgo') {
      const rather = trim(r.rather);
      return `You are letting it be${rather ? `, and putting the energy into <b>${esc(rather)}</b>` : ''}.`;
    }
    return `<span class="undecided">You have not decided what to do yet.</span> <button class="link decide" data-id="${it.id}">decide now</button>`;
  };

  const card = (it, a) => {
    const r = it.reflect;
    const reasons = ['proportion', 'realistic', 'fair', 'control', 'worth'].map(k => SAY[k][r[k]]).filter(Boolean);
    return `
      <li class="card-item" style="background:rgba(${a.rgb},.09);border-color:rgba(${a.rgb},.35);--accent:${a.color}">
        <button class="plan-name" data-id="${it.id}" title="edit">${esc(it.name)}</button>
        ${trim(r.thought) ? `<p class="plan-thought">“${esc(trim(r.thought))}”</p>` : ''}
        ${trim(r.balanced) ? `<p class="plan-balanced"><span>More balanced:</span> ${esc(trim(r.balanced))}</p>` : ''}
        <p class="plan-verdict">${decision(it)}</p>
        ${reasons.length ? `<ul class="plan-reasons">${reasons.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
      </li>`;
  };

  const pips = i => `<span class="pips" aria-hidden="true">${[0, 1, 2].map(n => `<span class="${n >= i ? 'on' : ''}"></span>`).join('')}</span>`;

  app.innerHTML = frame(`
    <div class="pad">
      <div class="take-top">
        <div>
          <p class="big">Your plan</p>
          <p class="copy">When you're burnt out, it can be hard to say exactly what's wrong. It often just feels like everything. Listing the specific things makes it easier to tell which ones you can change and which you can't.</p>
          <p class="copy">For the things you can change, start with one small, specific step. For the things you can't, it helps to check whether the way you're thinking about them is accurate and fair. Studies have found that this kind of reflection can reduce the exhaustion and cynicism that come with burnout, even when the situation itself stays the same.</p>
        </div>
        <div class="mini">${mapSvg('t', { labels: false, dots: true })}</div>
      </div>
      ${bands.map(b => `
        <section class="band band-${b.i}">
          <h2 class="band-h">${pips(b.i)}Bothers you ${b.word}</h2>
          ${b.areas.map(g => `
            <div class="area-group">
              <div class="area-group-h"><span class="area-group-name" style="color:${g.area.color}">${blob(g.area, 12)}${g.area.key}</span><span class="area-group-sub">${g.area.meaning}</span></div>
              <ul class="cards">${g.items.map(it => card(it, g.area)).join('')}</ul>
            </div>`).join('')}
        </section>`).join('')}
      ${eased.length ? `<p class="still">No longer bothering you: ${esc(and(eased.map(i => i.name)))}.</p>` : ''}
      ${pageFoot('<button class="btn" id="print">Print or save as PDF</button>',
        '<button class="btn secondary" id="to-map">Back: map it out</button><p class="saved-note">Everything here stays saved in this browser until you clear it.</p><button class="link" id="clear-plan">clear everything</button>')}
    </div>`, today);
  updateLoad($('.mini'));
  $('#print').onclick = () => window.print();
  $('#clear-plan').onclick = clearAll;
  $('#to-map').onclick = () => go('map');
  for (const b of $$('.plan-name, .decide')) b.onclick = () => go('map', { select: +b.dataset.id });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.screen === 'map' && S.selected) closeDetail();
});

load();
S.screen = hashScreen() || S.screen;
history.replaceState({ screen: S.screen }, '', '#' + S.screen);
render();
