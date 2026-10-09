export type Lang = 'zh-TW' | 'zh-CN' | 'en' | 'ja';

const zhTW = {
  title: '時區計算',
  myLocation: '你的所在地',
  lockTarget: '鎖定地點',
  compareTarget: '比較地點',
  cities: '常用城市',
  moreZones: '搜尋所有時區',
  search: '搜尋城市、時區或 UTC+8',
  noResults: '找不到符合的時區',
  close: '關閉',
  hours: '{h} 小時',
  minutes: '{m} 分鐘',
  hm: '{h} 小時 {m} 分',
  day: '白天',
  night: '夜晚',
  dawn: '清晨',
  dusk: '黃昏',
  language: '語言',
  expand: '展開選單',
};

export type Strings = typeof zhTW;

const dict: Record<Lang, Strings> = {
  'zh-TW': zhTW,
  'zh-CN': {
    title: '时区计算',
    myLocation: '你的所在地',
    lockTarget: '锁定地点',
    compareTarget: '比较地点',
    cities: '常用城市',
    moreZones: '搜索所有时区',
    search: '搜索城市、时区或 UTC+8',
    noResults: '找不到符合的时区',
    close: '关闭',
    hours: '{h} 小时',
    minutes: '{m} 分钟',
    hm: '{h} 小时 {m} 分',
    day: '白天',
    night: '夜晚',
    dawn: '清晨',
    dusk: '黄昏',
    language: '语言',
    expand: '展开菜单',
  },
  en: {
    title: 'Time Zone Calculator',
    myLocation: 'Your location',
    lockTarget: 'Locked place',
    compareTarget: 'Compare with',
    cities: 'Popular cities',
    moreZones: 'Search all time zones',
    search: 'Search city, zone or UTC+8',
    noResults: 'No matching time zones',
    close: 'Close',
    hours: '{h} h',
    minutes: '{m} min',
    hm: '{h} h {m} min',
    day: 'Daytime',
    night: 'Night',
    dawn: 'Dawn',
    dusk: 'Dusk',
    language: 'Language',
    expand: 'Show panel',
  },
  ja: {
    title: 'タイムゾーン計算',
    myLocation: '現在地',
    lockTarget: '固定する場所',
    compareTarget: '比較する場所',
    cities: '主な都市',
    moreZones: 'すべてのタイムゾーンを検索',
    search: '都市・タイムゾーン・UTC+9 で検索',
    noResults: '該当するタイムゾーンがありません',
    close: '閉じる',
    hours: '{h}時間',
    minutes: '{m}分',
    hm: '{h}時間{m}分',
    day: '昼',
    night: '夜',
    dawn: '明け方',
    dusk: '夕暮れ',
    language: '言語',
    expand: 'パネルを表示',
  },
};

export const LANG_LABELS: Record<Lang, string> = {
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  en: 'English',
  ja: '日本語',
};

/** 依照瀏覽器語言選出最接近的介面語言 */
export function detectLang(): Lang {
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of prefs) {
    const tag = (raw || '').toLowerCase();
    if (tag.startsWith('zh')) {
      if (/hans|cn|sg|my/.test(tag)) return 'zh-CN';
      return 'zh-TW';
    }
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

export function getStrings(lang: Lang): Strings {
  return dict[lang];
}

/** 把 {key} 換成對應的值 */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
