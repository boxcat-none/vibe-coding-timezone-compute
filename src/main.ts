import './style.css';
import { Globe } from './globe';
import { detectLang, fill, getStrings, LANG_LABELS, type Lang, type Strings } from './i18n';
import { ZonePicker } from './picker';
import {
  dayDiff,
  formatOffset,
  getLocalTimeZone,
  getOffsetMinutes,
  getSubsolarPoint,
  getWallTime,
  getZoneCoords,
  zoneCity,
  zoneCountry,
  zoneDisplayName,
  zonedWallToDate,
  type WallTime,
} from './timezone';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const LANG_KEY = 'tz-lang';
const localZone = getLocalTimeZone();

const state = {
  lang: loadLang(),
  lockedZone: localZone,
  locked: true,
  zoneA: localZone,
  zoneB: defaultZoneB(localZone),
  tab: 'diff' as 'diff' | 'convert',
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

function defaultZoneB(local: string): string {
  const candidates = ['America/New_York', 'Europe/London', 'Asia/Tokyo'];
  const localOffset = getOffsetMinutes(local, new Date());
  return candidates.find((z) => z !== local && getOffsetMinutes(z, new Date()) !== localOffset) ?? 'UTC';
}

let S: Strings = getStrings(state.lang);

// ---------- 地球 ----------
const globe = new Globe($<HTMLCanvasElement>('globe'));
const stageEl = $('globe-stage');

function updateStage() {
  const r = stageEl.getBoundingClientRect();
  // 以頁面頂端為基準，捲動時地球留在原位
  globe.setStage({ x: r.left, y: r.top + window.scrollY, width: r.width, height: r.height });
}

function syncGlobeTarget() {
  const c = getZoneCoords(state.lockedZone);
  globe.setTarget(c.lat, c.lon);
  globe.setLocked(state.locked);
}

// ---------- 時區選擇器 ----------
const picker = new ZonePicker(
  () => state.lang,
  () => S,
);

function zoneButtonHTML(tz: string, compact = false): string {
  const now = new Date();
  const name = zoneDisplayName(tz, state.lang, now);
  const country = zoneCountry(tz, state.lang);
  const sub = [name, country].filter(Boolean).join(' · ') || tz;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `
    <span class="zb-text">
      <span class="zb-city">${esc(zoneCity(tz))}</span>
      <span class="zb-sub">${esc(compact ? formatOffset(getOffsetMinutes(tz, now)) : sub)}</span>
    </span>
    ${compact ? '' : `<span class="zb-offset">${formatOffset(getOffsetMinutes(tz, now))}</span>`}
    <svg class="zb-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>`;
}

function setZoneButton(btn: HTMLElement, tz: string, label: string, compact = false) {
  btn.innerHTML = zoneButtonHTML(tz, compact);
  btn.title = tz;
  btn.setAttribute('aria-label', `${label}: ${tz}. ${S.changeZone}`);
}

// ---------- 鎖定時區的時鐘 ----------
const clockFormats = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${state.lang}|${key}|${opts.timeZone}`;
  let f = clockFormats.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(state.lang, opts);
    clockFormats.set(k, f);
  }
  return f;
}

function renderClock(now: Date) {
  const tz = state.lockedZone;
  const parts = fmt('clock', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
  // 秒數與上下午用較小的字
  let html = '';
  parts.forEach((p, i) => {
    const next = parts[i + 1];
    const small = p.type === 'second' || (p.type === 'literal' && next?.type === 'second');
    const cls = p.type === 'dayPeriod' ? 'ampm' : small ? 'sec' : '';
    html += cls ? `<span class="${cls}">${p.value}</span>` : p.value;
  });
  $('clock-time').innerHTML = html;
  $('clock-date').textContent = fmt('date', { timeZone: tz, dateStyle: 'full' }).format(now);
}

/** 依太陽高度判斷鎖定地點現在是白天、夜晚、清晨或黃昏 */
function renderPhase(now: Date) {
  const sun = getSubsolarPoint(now);
  const c = getZoneCoords(state.lockedZone, now);
  const r = Math.PI / 180;
  const sinAlt =
    Math.sin(sun.lat * r) * Math.sin(c.lat * r) +
    Math.cos(sun.lat * r) * Math.cos(c.lat * r) * Math.cos((sun.lon - c.lon) * r);
  const alt = Math.asin(sinAlt) / r;
  const hour = getWallTime(state.lockedZone, now).hour;
  let phase: 'day' | 'night' | 'dawn' | 'dusk';
  if (alt > 0) phase = 'day';
  else if (alt > -8) phase = hour < 12 ? 'dawn' : 'dusk';
  else phase = 'night';
  const icon = {
    day: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
    night: '<svg viewBox="0 0 24 24"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>',
    dawn: '<svg viewBox="0 0 24 24"><path d="M4 18h16M7.5 18a4.5 4.5 0 0 1 9 0M12 7v4M9.5 9.5 12 7l2.5 2.5"/></svg>',
    dusk: '<svg viewBox="0 0 24 24"><path d="M4 18h16M7.5 18a4.5 4.5 0 0 1 9 0M12 7v4M9.5 8.5 12 11l2.5-2.5"/></svg>',
  }[phase];
  const el = $('phase');
  el.dataset.phase = phase;
  el.innerHTML = `${icon}<span>${S[phase]}</span>`;
}

function renderLock() {
  const btn = $('lock-toggle');
  btn.setAttribute('aria-pressed', String(state.locked));
  $('lock-label').textContent = state.locked ? S.unlock : S.lock;
  $('lock-hint').textContent = state.locked ? S.lockedHint : S.unlockedHint;
  ($('back-local') as HTMLButtonElement).hidden = state.lockedZone === localZone;
}

// ---------- 時差 ----------
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return fill(S.hm, { h, m });
  if (m) return fill(S.minutes, { m });
  return fill(S.hours, { h });
}

function renderDiff(now: Date) {
  const a = state.zoneA;
  const b = state.zoneB;
  const diff = getOffsetMinutes(b, now) - getOffsetMinutes(a, now);
  const cityA = zoneCity(a);
  const cityB = zoneCity(b);
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  $('diff-value').innerHTML = `<span class="diff-sign">${sign}</span>${diff === 0 ? '0' : formatDuration(Math.abs(diff))}`;
  $('diff-value').dataset.dir = diff > 0 ? 'ahead' : diff < 0 ? 'behind' : 'same';
  const tpl = diff > 0 ? S.ahead : diff < 0 ? S.behind : S.same;
  $('diff-text').textContent = fill(tpl, { a: cityA, b: cityB, d: formatDuration(Math.abs(diff)) });
}

/** 兩列對齊的 24 小時刻度，方便看出彼此的白天夜晚 */
let lastRulerKey = '';
function renderRuler(now: Date) {
  const key = `${state.lang}|${state.zoneA}|${state.zoneB}|${Math.floor(now.getTime() / 60000)}`;
  if (key === lastRulerKey) return;
  lastRulerKey = key;

  const wa = getWallTime(state.zoneA, now);
  const start = now.getTime() - (wa.minute * 60 + wa.second) * 1000 - now.getMilliseconds();
  const row = (tz: string) => {
    let cells = '';
    for (let i = 0; i < 24; i++) {
      const t = new Date(start + i * 3600000);
      const w = getWallTime(tz, t);
      const kind = w.hour >= 7 && w.hour < 18 ? 'day' : w.hour >= 18 && w.hour < 22 ? 'eve' : w.hour >= 5 && w.hour < 7 ? 'eve' : 'night';
      const label =
        w.hour === 0 && w.minute === 0
          ? `<span class="hr-date">${w.month}/${w.day}</span>`
          : `${w.hour}${w.minute ? `<small>:${String(w.minute).padStart(2, '0')}</small>` : ''}`;
      cells += `<span class="hr-cell ${kind}${i === 0 ? ' now' : ''}">${label}</span>`;
    }
    return `<div class="hr-row"><span class="hr-name">${zoneCity(tz)}</span><div class="hr-cells">${cells}</div></div>`;
  };
  $('hour-ruler').innerHTML = row(state.zoneA) + row(state.zoneB);
}

// ---------- 時間換算 ----------
const convertInput = $<HTMLInputElement>('convert-input');

function wallToInput(w: WallTime): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(w.year, 4)}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}`;
}

function inputToWall(v: string): WallTime | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: 0 };
}

function setConvertNow() {
  convertInput.value = wallToInput(getWallTime(state.zoneA, new Date()));
  renderConvert();
}

function renderConvert() {
  const w = inputToWall(convertInput.value);
  const warn = $('convert-warn');
  const dayEl = $('result-day');
  if (!w) {
    $('result-time').textContent = '—';
    $('result-date').textContent = '';
    $('result-offsets').textContent = '';
    dayEl.hidden = true;
    warn.hidden = true;
    return;
  }
  const { date, nonexistent } = zonedWallToDate(w, state.zoneA);
  const tz = state.zoneB;
  $('result-time').textContent = fmt('rt', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(date);
  $('result-date').textContent = fmt('rd', { timeZone: tz, dateStyle: 'full' }).format(date);

  const days = dayDiff(w, getWallTime(tz, date));
  dayEl.hidden = days === 0;
  dayEl.dataset.dir = days > 0 ? 'plus' : 'minus';
  dayEl.textContent =
    days === 1 ? S.dayPlus : days === -1 ? S.dayMinus : `${days > 0 ? '+' : '−'}${fill(S.dayN, { n: Math.abs(days) })}`;

  $('result-offsets').innerHTML = `${zoneCity(state.zoneA)} <b>${formatOffset(getOffsetMinutes(state.zoneA, date))}</b>
    <span aria-hidden="true">→</span> ${zoneCity(tz)} <b>${formatOffset(getOffsetMinutes(tz, date))}</b>`;

  warn.hidden = !nonexistent;
  warn.textContent = S.nonexistent;
}

// ---------- 分頁 ----------
function renderTabs() {
  const tabs = [
    { id: 'diff', tab: $('tab-diff'), panel: $('panel-diff') },
    { id: 'convert', tab: $('tab-convert'), panel: $('panel-convert') },
  ];
  for (const t of tabs) {
    const on = t.id === state.tab;
    t.tab.setAttribute('aria-selected', String(on));
    t.tab.tabIndex = on ? 0 : -1;
    t.panel.hidden = !on;
  }
  document.querySelector<HTMLElement>('.tabs')!.dataset.active = state.tab;
  $('label-a').textContent = state.tab === 'diff' ? S.zoneA : S.fromZone;
  $('label-b').textContent = state.tab === 'diff' ? S.zoneB : S.toZone;
  setZoneButton($('zone-a-btn'), state.zoneA, $('label-a').textContent!, true);
  setZoneButton($('zone-b-btn'), state.zoneB, $('label-b').textContent!, true);
}

// ---------- 整體繪製 ----------
function renderStatic() {
  S = getStrings(state.lang);
  document.documentElement.lang = state.lang;
  document.title = S.title;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = S[el.dataset.i18n as keyof Strings];
  });
  $('swap').setAttribute('aria-label', S.swap);
  $('swap').title = S.swap;

  const now = new Date();
  $('local-zone').textContent = zoneCity(localZone);
  $('local-zone').title = localZone;
  $('local-offset').textContent = formatOffset(getOffsetMinutes(localZone, now));
  setZoneButton($('locked-zone-btn'), state.lockedZone, S.lockedZone);
  renderLock();
  renderTabs();
  renderConvert();
  lastRulerKey = '';
  tick();
}

function tick() {
  const now = new Date();
  renderClock(now);
  renderPhase(now);
  renderDiff(now);
  renderRuler(now);
}

function scheduleTick() {
  tick();
  setTimeout(scheduleTick, 1000 - (Date.now() % 1000) + 5);
}

// ---------- 事件 ----------
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
  picker.invalidate();
  renderStatic();
});

$('locked-zone-btn').addEventListener('click', () =>
  picker.open({
    title: S.lockedZone,
    current: state.lockedZone,
    onSelect: (tz) => {
      state.lockedZone = tz;
      // 選了新的時區就自動鎖定，讓地球轉過去
      state.locked = true;
      syncGlobeTarget();
      renderStatic();
    },
  }),
);

$('lock-toggle').addEventListener('click', () => {
  state.locked = !state.locked;
  globe.setLocked(state.locked);
  renderLock();
});

$('back-local').addEventListener('click', () => {
  state.lockedZone = localZone;
  state.locked = true;
  syncGlobeTarget();
  renderStatic();
});

function pickPair(which: 'A' | 'B') {
  picker.open({
    title: (which === 'A' ? $('label-a') : $('label-b')).textContent ?? '',
    current: which === 'A' ? state.zoneA : state.zoneB,
    onSelect: (tz) => {
      if (which === 'A') state.zoneA = tz;
      else state.zoneB = tz;
      renderStatic();
    },
  });
}
$('zone-a-btn').addEventListener('click', () => pickPair('A'));
$('zone-b-btn').addEventListener('click', () => pickPair('B'));

$('swap').addEventListener('click', () => {
  // 換算模式下，交換後保留同一個瞬間
  const w = inputToWall(convertInput.value);
  const instant = w ? zonedWallToDate(w, state.zoneA).date : null;
  [state.zoneA, state.zoneB] = [state.zoneB, state.zoneA];
  if (instant) convertInput.value = wallToInput(getWallTime(state.zoneA, instant));
  const btn = $('swap');
  btn.classList.remove('spin');
  void btn.offsetWidth;
  btn.classList.add('spin');
  renderStatic();
});

function selectTab(tab: 'diff' | 'convert', focus = false) {
  state.tab = tab;
  renderTabs();
  if (focus) $(`tab-${tab}`).focus();
}
$('tab-diff').addEventListener('click', () => selectTab('diff'));
$('tab-convert').addEventListener('click', () => selectTab('convert'));
document.querySelector('.tabs')!.addEventListener('keydown', (e) => {
  const k = (e as KeyboardEvent).key;
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    e.preventDefault();
    selectTab(state.tab === 'diff' ? 'convert' : 'diff', true);
  }
});

convertInput.addEventListener('input', renderConvert);
$('convert-now').addEventListener('click', setConvertNow);

// ---------- 啟動 ----------
syncGlobeTarget();
globe.snapToTarget();
setConvertNow();
renderStatic();
updateStage();
window.addEventListener('resize', updateStage);
new ResizeObserver(updateStage).observe(stageEl);
globe.start();
$<HTMLCanvasElement>('globe').addEventListener('globe-ready', () => document.body.classList.add('globe-ready'));
scheduleTick();
