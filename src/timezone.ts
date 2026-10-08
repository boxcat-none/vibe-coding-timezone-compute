import { ZONE_COORDS } from './data/zones';

/** 年月日時分秒（不含時區資訊的「牆上時間」） */
export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** 瀏覽器所在的時區，例如 Asia/Taipei */
export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

let zoneListCache: string[] | null = null;

/** 所有可選的 IANA 時區 */
export function getAllTimeZones(): string[] {
  if (zoneListCache) return zoneListCache;
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = Object.keys(ZONE_COORDS);
  }
  const set = new Set(zones);
  set.add('UTC');
  set.add(getLocalTimeZone());
  zoneListCache = [...set].sort();
  return zoneListCache;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

/** 某個瞬間在指定時區的牆上時間 */
export function getWallTime(timeZone: string, date: Date): WallTime {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  };
}

function wallToUtcMs(w: WallTime): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** 指定時區在某個瞬間相對 UTC 的偏移（分鐘），會反映夏令時間 */
export function getOffsetMinutes(timeZone: string, date: Date): number {
  const ms = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((wallToUtcMs(getWallTime(timeZone, new Date(ms))) - ms) / 60000);
}

/** 偏移格式化成 UTC+08:00 */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

export interface ZonedResult {
  date: Date;
  /** 這個牆上時間因夏令時間跳躍而不存在 */
  nonexistent: boolean;
}

/** 把「某時區的牆上時間」轉成實際的瞬間 */
export function zonedWallToDate(w: WallTime, timeZone: string): ZonedResult {
  const asUtc = wallToUtcMs(w);
  let guess = asUtc - getOffsetMinutes(timeZone, new Date(asUtc)) * 60000;
  // 再修正一次，處理在夏令時間切換附近的情況
  guess = asUtc - getOffsetMinutes(timeZone, new Date(guess)) * 60000;
  const back = getWallTime(timeZone, new Date(guess));
  if (wallToUtcMs(back) === asUtc) return { date: new Date(guess), nonexistent: false };
  // 落在夏令時間跳過的區間：用跳躍前的偏移，等於往後順延（例如 02:30 → 03:30）
  const before = getOffsetMinutes(timeZone, new Date(guess - 12 * 3600000));
  const after = getOffsetMinutes(timeZone, new Date(guess + 12 * 3600000));
  return { date: new Date(asUtc - Math.min(before, after) * 60000), nonexistent: true };
}

/** 兩個牆上時間相差幾天（只看日期） */
export function dayDiff(a: WallTime, b: WallTime): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}

/** 時區代表城市的座標；Etc/GMT 之類沒有城市的，用偏移推估經度 */
export function getZoneCoords(timeZone: string, date = new Date()): { lat: number; lon: number; exact: boolean } {
  const c = ZONE_COORDS[timeZone];
  if (c) return { lat: c[0], lon: c[1], exact: true };
  return { lat: 0, lon: (getOffsetMinutes(timeZone, date) / 60) * 15, exact: false };
}

const regionNames = new Map<string, Intl.DisplayNames | null>();

/** 時區所屬國家在指定語系下的名稱，例如 Asia/Tokyo →「日本」 */
export function zoneCountry(timeZone: string, locale: string): string {
  const cc = ZONE_COORDS[timeZone]?.[2];
  if (!cc) return '';
  if (!regionNames.has(locale)) {
    try {
      regionNames.set(locale, new Intl.DisplayNames([locale], { type: 'region' }));
    } catch {
      regionNames.set(locale, null);
    }
  }
  return regionNames.get(locale)?.of(cc) ?? cc;
}

/** Asia/Ho_Chi_Minh → Ho Chi Minh */
export function zoneCity(timeZone: string): string {
  // Etc/GMT-8 的正負號與一般習慣相反，實際是 UTC+8
  const etc = timeZone.match(/^Etc\/GMT([+-])(\d+)$/);
  if (etc) return `UTC${etc[1] === '-' ? '+' : '−'}${etc[2]}`;
  if (/^(Etc\/)?(UTC|UCT|GMT|Universal|Zulu|Greenwich)0?$/.test(timeZone)) return 'UTC';
  const seg = timeZone.split('/');
  return seg[seg.length - 1].replace(/_/g, ' ');
}

const nameCache = new Map<string, string>();

/** 時區在指定語系下的名稱，例如「台北標準時間」 */
export function zoneDisplayName(timeZone: string, locale: string, date = new Date()): string {
  const key = `${locale}|${timeZone}`;
  const cached = nameCache.get(key);
  if (cached !== undefined) return cached;
  let name = '';
  for (const style of ['longGeneric', 'long'] as const) {
    try {
      const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style })
        .formatToParts(date)
        .find((p) => p.type === 'timeZoneName');
      if (part && !/^GMT[+-]?/.test(part.value)) {
        name = part.value;
        break;
      }
    } catch {
      /* 舊瀏覽器不支援 longGeneric */
    }
  }
  nameCache.set(key, name);
  return name;
}

export interface SunPosition {
  /** 太陽直射點緯度（度） */
  lat: number;
  /** 太陽直射點經度（度，-180 ~ 180） */
  lon: number;
}

/** 依照時間計算太陽直射點（精度約 0.1 度，足夠畫晨昏線） */
export function getSubsolarPoint(date: Date): SunPosition {
  const rad = Math.PI / 180;
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // 自 J2000 起的天數
  const g = (357.529 + 0.98560028 * d) * rad; // 平近點角
  const q = 280.459 + 0.98564736 * d; // 平黃經
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // 視黃經
  const e = (23.439 - 0.00000036 * d) * rad; // 黃赤交角
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / rad;
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15; // 格林威治恆星時（度）
  let lon = (ra - gmst) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat: dec, lon };
}
