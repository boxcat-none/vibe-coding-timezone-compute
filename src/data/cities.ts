import type { Lang } from '../i18n';

export interface City {
  tz: string;
  lat: number;
  lon: number;
  name: Record<Lang, string>;
}

/** 點地名時列出的常用城市 */
export const CITIES: City[] = [
  { tz: 'Asia/Taipei', lat: 25.03, lon: 121.57, name: { 'zh-TW': '台北', 'zh-CN': '台北', en: 'Taipei', ja: '台北' } },
  { tz: 'Asia/Tokyo', lat: 35.68, lon: 139.69, name: { 'zh-TW': '東京', 'zh-CN': '东京', en: 'Tokyo', ja: '東京' } },
  { tz: 'Asia/Seoul', lat: 37.57, lon: 126.98, name: { 'zh-TW': '首爾', 'zh-CN': '首尔', en: 'Seoul', ja: 'ソウル' } },
  { tz: 'Asia/Shanghai', lat: 31.23, lon: 121.47, name: { 'zh-TW': '上海', 'zh-CN': '上海', en: 'Shanghai', ja: '上海' } },
  { tz: 'Asia/Hong_Kong', lat: 22.32, lon: 114.17, name: { 'zh-TW': '香港', 'zh-CN': '香港', en: 'Hong Kong', ja: '香港' } },
  { tz: 'Asia/Singapore', lat: 1.35, lon: 103.82, name: { 'zh-TW': '新加坡', 'zh-CN': '新加坡', en: 'Singapore', ja: 'シンガポール' } },
  { tz: 'Asia/Bangkok', lat: 13.76, lon: 100.5, name: { 'zh-TW': '曼谷', 'zh-CN': '曼谷', en: 'Bangkok', ja: 'バンコク' } },
  { tz: 'Asia/Kolkata', lat: 28.61, lon: 77.21, name: { 'zh-TW': '新德里', 'zh-CN': '新德里', en: 'New Delhi', ja: 'ニューデリー' } },
  { tz: 'Asia/Dubai', lat: 25.2, lon: 55.27, name: { 'zh-TW': '杜拜', 'zh-CN': '迪拜', en: 'Dubai', ja: 'ドバイ' } },
  { tz: 'Europe/Moscow', lat: 55.76, lon: 37.62, name: { 'zh-TW': '莫斯科', 'zh-CN': '莫斯科', en: 'Moscow', ja: 'モスクワ' } },
  { tz: 'Africa/Cairo', lat: 30.04, lon: 31.24, name: { 'zh-TW': '開羅', 'zh-CN': '开罗', en: 'Cairo', ja: 'カイロ' } },
  { tz: 'Europe/Paris', lat: 48.86, lon: 2.35, name: { 'zh-TW': '巴黎', 'zh-CN': '巴黎', en: 'Paris', ja: 'パリ' } },
  { tz: 'Europe/London', lat: 51.51, lon: -0.13, name: { 'zh-TW': '倫敦', 'zh-CN': '伦敦', en: 'London', ja: 'ロンドン' } },
  { tz: 'America/Sao_Paulo', lat: -23.55, lon: -46.63, name: { 'zh-TW': '聖保羅', 'zh-CN': '圣保罗', en: 'São Paulo', ja: 'サンパウロ' } },
  { tz: 'America/New_York', lat: 40.71, lon: -74.01, name: { 'zh-TW': '紐約', 'zh-CN': '纽约', en: 'New York', ja: 'ニューヨーク' } },
  { tz: 'America/Chicago', lat: 41.88, lon: -87.63, name: { 'zh-TW': '芝加哥', 'zh-CN': '芝加哥', en: 'Chicago', ja: 'シカゴ' } },
  { tz: 'America/Los_Angeles', lat: 34.05, lon: -118.24, name: { 'zh-TW': '洛杉磯', 'zh-CN': '洛杉矶', en: 'Los Angeles', ja: 'ロサンゼルス' } },
  { tz: 'Pacific/Honolulu', lat: 21.31, lon: -157.86, name: { 'zh-TW': '檀香山', 'zh-CN': '檀香山', en: 'Honolulu', ja: 'ホノルル' } },
  { tz: 'Australia/Sydney', lat: -33.87, lon: 151.21, name: { 'zh-TW': '雪梨', 'zh-CN': '悉尼', en: 'Sydney', ja: 'シドニー' } },
  { tz: 'Pacific/Auckland', lat: -36.85, lon: 174.76, name: { 'zh-TW': '奧克蘭', 'zh-CN': '奥克兰', en: 'Auckland', ja: 'オークランド' } },
];

export function findCity(tz: string): City | undefined {
  return CITIES.find((c) => c.tz === tz);
}
