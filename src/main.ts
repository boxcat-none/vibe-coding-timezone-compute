import './style.css';
import { CITIES, findCity } from './data/cities';
import { ZONE_COORDS } from './data/zones';
import { Globe } from './globe';
import { detectLang, fill, getStrings, LANG_LABELS, type Lang, type Strings } from './i18n';
import { ZonePicker } from './picker';
import {
  getAllTimeZones,
  getLocalTimeZone,
  getOffsetMinutes,
  getSubsolarPoint,
  getWallTime,
  getZoneCoords,
  zoneCity,
} from './timezone';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const LANG_KEY = 'tz-lang';
const localZone = getLocalTimeZone();

const state = {
  lang: loadLang(),
  /** 鎖定的地點（0～2 個），第一個顯示在左邊，第二個在右邊 */
  targets: [] as Place[],
};

function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && saved in LANG_LABELS) return saved as Lang;
  } catch {
    /* 無法使用 localStorage 時就用瀏覽器語言 */
  }
  return detectLang();
}

let S: Strings = getStrings(state.lang);

// ---------- 地點 ----------
interface Place {
  tz: string;
  lat: number;
  lon: number;
  /** 是常用城市清單裡的城市（名稱有各語言翻譯） */
  preset: boolean;
  /** 顯示名稱用的時區（定位到的所在地：時間用瀏覽器時區，名稱用最近的城市） */
  nameTz?: string;
}

function placeOfZone(tz: string): Place {
  const city = findCity(tz);
  const c = city ?? getZoneCoords(tz);
  return { tz, lat: c.lat, lon: c.lon, preset: !!city };
}

function placeName(p: Place): string {
  const tz = p.nameTz ?? p.tz;
  return (p.preset && findCity(tz)?.name[state.lang]) || zoneCity(tz);
}

/** 兩點的大圓距離（公里） */
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 地球上點到的位置 → 地點：靠近常用城市就用該城市，否則用最近的時區代表城市；在大洋中央則依經度用 UTC 偏移 */
function placeAt(lat: number, lon: number): Place {
  let best: { tz: string; d: number } | null = null;
  for (const c of CITIES) {
    const d = distanceKm(lat, lon, c.lat, c.lon);
    if (d < 250 && (!best || d < best.d)) best = { tz: c.tz, d };
  }
  if (best) return placeOfZone(best.tz);

  const valid = new Set(getAllTimeZones());
  for (const [tz, [zlat, zlon]] of Object.entries(ZONE_COORDS)) {
    if (!valid.has(tz)) continue;
    const d = distanceKm(lat, lon, zlat, zlon);
    if (!best || d < best.d) best = { tz, d };
  }
  if (best && best.d < 1500) return { tz: best.tz, lat, lon, preset: false };

  const h = Math.round(lon / 15);
  // Etc/GMT 的正負號與一般習慣相反
  return { tz: h === 0 ? 'Etc/GMT' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`, lat, lon, preset: false };
}

/** 使用者的所在地：先用瀏覽器時區推估，取得定位後換成實際位置 */
let homePlace: Place = placeOfZone(localZone);

/** 用瀏覽器定位取得實際所在地（時區推估只能精確到時區的代表城市，有些時區甚至沒有城市） */
function locateHome() {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const near = placeAt(lat, lon);
      // 時間仍用瀏覽器的時區，名稱用離定位最近的城市
      homePlace = { tz: localZone, lat, lon, preset: !!findCity(near.tz), nameTz: near.tz };
      globe.setHome(homePlace);
      // 還沒鎖定任何地點時，讓地球轉到所在地
      if (!state.targets.length && !collapsed) globe.focus([homePlace]);
      render();
    },
    () => {
      /* 使用者拒絕或無法定位：維持用時區推估 */
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 },
  );
}

const samePlace = (a: Place | undefined, b: Place | undefined) =>
  !!a && !!b && a.tz === b.tz && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

// ---------- 地球 ----------
const globe = new Globe($<HTMLCanvasElement>('globe'));

const banner = $('banner');

let lastStageKey = '';
function updateStage() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // 用版面位置（不受收起時的 transform 影響），地球位置不會跟著選單跳動
  const top = banner.offsetTop + banner.offsetHeight + 12;
  // 選單寬度動畫時也會觸發，位置沒變就不用重設
  const key = `${w}|${h}|${top}`;
  if (key === lastStageKey) return;
  lastStageKey = key;
  const height = h - top - 16;
  // 高度不夠（例如手機橫放）時就讓地球用整個畫面
  globe.setStage(height < 220 ? { x: 0, y: 0, width: w, height: h } : { x: 0, y: top, width: w, height });
}

// ---------- 鎖定 ----------
function syncTargets() {
  globe.setTargets(state.targets);
  render();
}

function setTarget(slot: number, place: Place) {
  const t = state.targets;
  if (slot === 0) {
    t[0] = place;
    if (samePlace(t[1], place)) t.length = 1;
  } else {
    // 還沒有第一個目標時，用所在地當作比較的基準
    if (!t[0]) t[0] = homePlace;
    if (samePlace(t[0], place)) return;
    t[1] = place;
  }
  syncTargets();
}

/** 點地球上的一點：沒有目標時鎖定為第一個，已有一個時加入比較，兩個都有時取代第二個 */
function lockAt(lat: number, lon: number) {
  if (performance.now() - menuClosedAt < 500) return;
  // 選單收起時點了地球：把選單拉回來，改用這次點的地點
  if (collapsed) {
    savedTargets = [];
    setCollapsed(false);
  }
  setTarget(state.targets.length ? 1 : 0, placeAt(lat, lon));
}

/** 點背景或空白處：解除所有鎖定，地球繼續自轉 */
function unlockAll() {
  if (performance.now() - menuClosedAt < 500) return;
  if (!state.targets.length) return;
  state.targets = [];
  syncTargets();
}

// ---------- 收起／展開選單 ----------
let collapsed = false;
/** 收起前鎖定的地點，展開時還原 */
let savedTargets: Place[] = [];
const pull = $<HTMLButtonElement>('pull');

/** 收起：記下鎖定的地點並進入自轉模式；展開：還原鎖定的地點 */
function setCollapsed(v: boolean) {
  if (v === collapsed) return;
  collapsed = v;
  closeMenu();
  setPeek(false);
  document.body.classList.toggle('banner-collapsed', v);
  banner.inert = v;
  globe.setHomeHidden(v);
  pull.tabIndex = v ? 0 : -1;
  if (v) {
    savedTargets = state.targets.slice();
    state.targets = [];
    syncTargets();
  } else if (savedTargets.length) {
    state.targets = savedTargets;
    savedTargets = [];
    syncTargets();
  }
}

/** 偵測垂直滑動（手指或滑鼠拖曳），回傳是否觸發 */
function onVerticalSwipe(el: HTMLElement, handler: (dir: 'up' | 'down') => boolean) {
  let start: { id: number; x: number; y: number } | null = null;
  let swiped = false;
  el.addEventListener('pointerdown', (e) => {
    start = { id: e.pointerId, x: e.clientX, y: e.clientY };
    swiped = false;
  });
  // 手指很快就會滑出元素範圍，所以在整個視窗上追蹤移動
  window.addEventListener('pointermove', (e) => {
    if (!start || start.id !== e.pointerId || swiped) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      swiped = handler(dy < 0 ? 'up' : 'down');
      if (swiped) start = null;
    }
  });
  const end = () => {
    start = null;
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  // 滑動之後不要再觸發點擊（例如打開城市選單）
  el.addEventListener(
    'click',
    (e) => {
      if (!swiped) return;
      swiped = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

// ---------- 格式化 ----------
const formats = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${state.lang}|${key}|${opts.timeZone}`;
  let f = formats.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(state.lang, opts);
    formats.set(k, f);
  }
  return f;
}

function timeHTML(tz: string, now: Date): string {
  const parts = fmt('clock', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
  // 秒數與上下午用較小的字
  let html = '';
  parts.forEach((p, i) => {
    const next = parts[i + 1];
    const small = p.type === 'second' || (p.type === 'literal' && next?.type === 'second');
    const cls = p.type === 'dayPeriod' ? 'ampm' : small ? 'sec' : '';
    html += cls ? `<span class="${cls}">${p.value}</span>` : p.value;
  });
  return html;
}

const PHASE_ICONS = {
  day: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
  night: '<svg viewBox="0 0 24 24"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>',
  dawn: '<svg viewBox="0 0 24 24"><path d="M4 18h16M7.5 18a4.5 4.5 0 0 1 9 0M12 7v4M9.5 9.5 12 7l2.5 2.5"/></svg>',
  dusk: '<svg viewBox="0 0 24 24"><path d="M4 18h16M7.5 18a4.5 4.5 0 0 1 9 0M12 7v4M9.5 8.5 12 11l2.5-2.5"/></svg>',
};

/** 依太陽高度判斷該地現在是白天、夜晚、清晨或黃昏 */
function phaseOf(c: Place, now: Date): keyof typeof PHASE_ICONS {
  const tz = c.tz;
  const sun = getSubsolarPoint(now);
  const r = Math.PI / 180;
  const sinAlt =
    Math.sin(sun.lat * r) * Math.sin(c.lat * r) +
    Math.cos(sun.lat * r) * Math.cos(c.lat * r) * Math.cos((sun.lon - c.lon) * r);
  const alt = Math.asin(sinAlt) / r;
  if (alt > 0) return 'day';
  if (alt > -8) return getWallTime(tz, now).hour < 12 ? 'dawn' : 'dusk';
  return 'night';
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return fill(S.hm, { h, m });
  if (m) return fill(S.minutes, { m });
  return fill(S.hours, { h });
}

/** 偏移顯示成 UTC+8、UTC+5:30、UTC−3 */
function shortOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  const m = abs % 60;
  return `UTC${minutes < 0 ? '−' : '+'}${Math.floor(abs / 60)}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

// ---------- 繪製 ----------
const slotIds = ['a', 'b'] as const;

/** 第 i 個欄位顯示的時區；左邊沒有鎖定時顯示所在地 */
function slotPlace(i: number): Place | null {
  return state.targets[i] ?? (i === 0 ? homePlace : null);
}

function render() {
  const now = new Date();
  const pair = state.targets.length === 2;
  banner.dataset.count = String(state.targets.length);

  slotIds.forEach((id, i) => {
    const place = slotPlace(i);
    const slot = $(`slot-${id}`);
    slot.dataset.state = state.targets[i] ? 'locked' : i === 0 ? 'home' : 'empty';
    if (!place) return;
    const tz = place.tz;
    $(`name-${id}`).textContent = placeName(place);
    $(`zone-${id}`).textContent = shortOffset(getOffsetMinutes(tz, now));
    $(`zone-${id}`).title = tz;
    $(`place-${id}`).setAttribute('aria-label', `${placeName(place)}, ${tz}. ${S.cities}`);
  });

  // 比較地點由點地球加入，有第二個目標時才顯示右邊
  $('body-b').hidden = !pair;
  $('link').hidden = !pair;
  tick();
  updateBannerWidth();
}

/** 只有一個地點時選單縮到剛好包住內容並置中；有兩個地點時拉伸成完整寬度（用 CSS transition 做動畫） */
function updateBannerWidth() {
  const app = banner.parentElement!;
  const as = getComputedStyle(app);
  const avail = app.clientWidth - parseFloat(as.paddingLeft) - parseFloat(as.paddingRight);
  const bs = getComputedStyle(banner);
  const max = Math.min(avail, parseFloat(bs.maxWidth) || avail);
  let width = max;
  if (state.targets.length < 2) {
    // 單一地點時內容寬度是 max-content，不受選單寬度影響，可以直接量
    const row = $('slot-a').querySelector<HTMLElement>('.slot-row')!;
    const chrome =
      parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight) + parseFloat(bs.borderLeftWidth) + parseFloat(bs.borderRightWidth);
    width = Math.min(max, Math.ceil(row.offsetWidth + chrome));
  }
  banner.style.width = `${width}px`;
}

function tick() {
  const now = new Date();
  slotIds.forEach((id, i) => {
    const place = slotPlace(i);
    if (!place) return;
    const tz = place.tz;
    $(`time-${id}`).innerHTML = timeHTML(tz, now);
    $(`date-${id}`).textContent = fmt('date', { timeZone: tz, month: 'short', day: 'numeric', weekday: 'short' }).format(now);
    const phase = phaseOf(place, now);
    const el = $(`phase-${id}`);
    if (el.dataset.phase !== `${state.lang}|${phase}`) {
      el.dataset.phase = `${state.lang}|${phase}`;
      el.dataset.kind = phase;
      el.innerHTML = `${PHASE_ICONS[phase]}<span>${S[phase]}</span>`;
    }
  });

  if (state.targets.length === 2) {
    const [pa, pb] = state.targets;
    const a = pa.tz;
    const b = pb.tz;
    const diff = getOffsetMinutes(b, now) - getOffsetMinutes(a, now);
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
    const d = formatDuration(Math.abs(diff));
    $('link-diff').textContent = diff === 0 ? '±0' : `${sign}${d}`;
    $('link').dataset.dir = diff > 0 ? 'ahead' : diff < 0 ? 'behind' : 'same';
  }
}

function scheduleTick() {
  tick();
  setTimeout(scheduleTick, 1000 - (Date.now() % 1000) + 5);
}

// ---------- 城市選單 ----------
const picker = new ZonePicker(
  () => state.lang,
  () => S,
);
const menu = $('city-menu');
let menuSlot = 0;
let menuAnchor: HTMLElement | null = null;
let menuClosedAt = -Infinity;

function openMenu(slot: number, anchor: HTMLElement) {
  if (!menu.hidden && menuSlot === slot) {
    closeMenu();
    return;
  }
  menuSlot = slot;
  menuAnchor = anchor;
  const current = state.targets[slot]?.tz;
  $('city-menu-title').textContent = slot === 0 ? S.lockTarget : S.compareTarget;
  $('city-more-label').textContent = S.moreZones;

  const now = new Date();
  const options = [
    { tz: localZone, name: placeName(homePlace), home: true },
    ...CITIES.filter((c) => c.tz !== localZone).map((c) => ({ tz: c.tz, name: c.name[state.lang], home: false })),
  ];
  const grid = $('city-grid');
  grid.replaceChildren(
    ...options.map((o) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cm-city';
      btn.dataset.tz = o.tz;
      if (o.home) btn.dataset.home = '1';
      if (o.tz === current) btn.setAttribute('aria-current', 'true');
      // 另一邊已經鎖定的城市不能重複選
      if (slot === 1 && o.tz === (state.targets[0]?.tz ?? localZone)) btn.disabled = true;
      const name = document.createElement('span');
      name.className = 'cm-name';
      name.textContent = o.name;
      if (o.home) name.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>');
      const time = document.createElement('span');
      time.className = 'cm-time';
      time.textContent = fmt('short', { timeZone: o.tz, hour: '2-digit', minute: '2-digit' }).format(now);
      btn.append(name, time);
      btn.title = o.home ? `${S.myLocation} · ${o.tz}` : o.tz;
      return btn;
    }),
  );

  menu.hidden = false;
  positionMenu();
  anchor.setAttribute('aria-expanded', 'true');
  (grid.querySelector<HTMLElement>('[aria-current]') ?? grid.querySelector<HTMLElement>('button:not(:disabled)'))?.focus({
    preventScroll: true,
  });
}

function positionMenu() {
  if (menu.hidden || !menuAnchor) return;
  const r = menuAnchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const width = Math.min(380, vw - 24);
  menu.style.width = `${width}px`;
  let left = menuSlot === 0 ? r.left - 8 : r.right - width + 8;
  left = Math.max(12, Math.min(left, vw - width - 12));
  menu.style.left = `${left}px`;
  menu.style.top = `${r.bottom + 8}px`;
  menu.style.maxHeight = `${window.innerHeight - r.bottom - 24}px`;
}

function closeMenu(restoreFocus = false) {
  if (menu.hidden) return;
  menu.hidden = true;
  menuClosedAt = performance.now();
  menuAnchor?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) menuAnchor?.focus();
}

$('city-grid').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.cm-city');
  if (!btn || btn.disabled) return;
  closeMenu();
  setTarget(menuSlot, btn.dataset.home ? homePlace : placeOfZone(btn.dataset.tz!));
});

$('city-more').addEventListener('click', () => {
  const slot = menuSlot;
  closeMenu();
  picker.open({
    title: slot === 0 ? S.lockTarget : S.compareTarget,
    current: state.targets[slot]?.tz ?? '',
    onSelect: (tz) => setTarget(slot, placeOfZone(tz)),
  });
});

// 點選單以外的地方：只關閉選單，不要同時解除鎖定
document.addEventListener(
  'pointerdown',
  (e) => {
    if (menu.hidden) return;
    const t = e.target as Node;
    if (menu.contains(t) || menuAnchor?.contains(t)) return;
    closeMenu();
  },
  true,
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) closeMenu(true);
});

// ---------- 事件 ----------
onVerticalSwipe(banner, (dir) => dir === 'up' && (setCollapsed(true), true));
onVerticalSwipe(pull, (dir) => dir === 'down' && (setCollapsed(false), true));
pull.addEventListener('click', () => setCollapsed(false));

// 選單收起時把手先藏起來。手機：從頂端往下滑一下出現把手，再滑一下才拉回選單
const mobileQuery = window.matchMedia('(max-width: 699px)');
let peekTimer = 0;
function setPeek(v: boolean, autoHide = true) {
  clearTimeout(peekTimer);
  document.body.classList.toggle('pull-peek', v);
  // 手機上一陣子沒動作就自動縮回去
  if (v && autoHide) peekTimer = window.setTimeout(() => setPeek(false), 3000);
}

// 桌機：選單收起時，滑鼠移到畫面頂端才出現把手，離開後藏起來
window.addEventListener('mousemove', (e) => {
  if (!collapsed || mobileQuery.matches) return;
  const peeking = document.body.classList.contains('pull-peek');
  if (!peeking && e.clientY < 48) setPeek(true, false);
  else if (peeking && e.clientY > 80) setPeek(false);
});
onVerticalSwipe($('pull-zone'), (dir) => {
  if (dir !== 'down' || !collapsed || !mobileQuery.matches) return false;
  if (document.body.classList.contains('pull-peek')) setCollapsed(false);
  else setPeek(true);
  return true;
});

// 滾輪：在地球或背景上縮放地球；在上方選單或把手上，往下捲收起選單、往上捲拉回選單
let wheelSum = 0;
let wheelLock = 0;
window.addEventListener(
  'wheel',
  (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.city-menu, dialog')) return;
    if (!t.closest('.banner, .pull')) {
      // 滑鼠滾輪一格的 deltaY 依瀏覽器不同（行或像素），統一換算成像素
      globe.zoomBy(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY);
      return;
    }
    const now = performance.now();
    if (now < wheelLock) return;
    wheelSum = Math.sign(e.deltaY) === Math.sign(wheelSum) ? wheelSum + e.deltaY : e.deltaY;
    if (Math.abs(wheelSum) < 60) return;
    setCollapsed(wheelSum > 0);
    wheelSum = 0;
    // 觸控板會連續送出很多事件，觸發後先停一下
    wheelLock = now + 700;
  },
  { passive: true },
);

$('place-a').addEventListener('click', () => openMenu(0, $('place-a')));
$('place-b').addEventListener('click', () => openMenu(1, $('place-b')));

// 點到地球就鎖定那個地方，點到背景就解除鎖定
globe.onTap = (hit) => (hit ? lockAt(hit.lat, hit.lon) : unlockAll());
// 點 banner 上的地點框：地球轉到那個地點；點中間的時差：轉回兩地中間
banner.addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  if (el.closest('button')) return;
  const slot = el.closest<HTMLElement>('.slot');
  if (slot) {
    const place = slotPlace(Number(slot.dataset.slot));
    if (place) globe.focus([place]);
  } else if (state.targets.length) {
    globe.focus(state.targets);
  }
});

const langSelect = $<HTMLSelectElement>('lang');
langSelect.innerHTML = (Object.keys(LANG_LABELS) as Lang[])
  .map((l) => `<option value="${l}">${LANG_LABELS[l]}</option>`)
  .join('');
langSelect.value = state.lang;
langSelect.addEventListener('change', () => {
  state.lang = langSelect.value as Lang;
  try {
    localStorage.setItem(LANG_KEY, state.lang);
  } catch {
    /* 忽略 */
  }
  applyLang();
});

function applyLang() {
  S = getStrings(state.lang);
  document.documentElement.lang = state.lang;
  document.title = S.title;
  $('lang-label').textContent = S.language;
  pull.setAttribute('aria-label', S.expand);
  pull.title = S.expand;
  picker.invalidate();
  closeMenu();
  render();
}

window.addEventListener('resize', () => {
  updateBannerWidth();
  updateStage();
  positionMenu();
});

// ---------- 啟動 ----------
globe.faceLongitude(homePlace.lon);
globe.setHome(homePlace);
locateHome();
applyLang();
updateStage();
new ResizeObserver(updateStage).observe(banner);
// 字型載入後文字寬度會改變
document.fonts?.ready.then(updateBannerWidth);
globe.start();
$<HTMLCanvasElement>('globe').addEventListener('globe-ready', () => document.body.classList.add('globe-ready'));
scheduleTick();
