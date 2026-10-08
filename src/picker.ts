import type { Lang, Strings } from './i18n';
import {
  formatOffset,
  getAllTimeZones,
  getOffsetMinutes,
  zoneCity,
  zoneCountry,
  zoneDisplayName,
} from './timezone';

interface Entry {
  id: string;
  city: string;
  name: string;
  country: string;
  offset: number;
  search: string;
}

interface OpenOptions {
  title: string;
  current: string;
  onSelect: (timeZone: string) => void;
}

/** 解析「UTC+8」「+5:30」「gmt-3」這類偏移查詢，回傳分鐘數 */
function parseOffsetQuery(q: string): number | null {
  const m = q.replace(/\s+/g, '').match(/^(?:utc|gmt)?([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!m) return /^(utc|gmt)$/i.test(q.trim()) ? 0 : null;
  const v = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -v : v;
}

/** 共用的時區選擇視窗（桌機為置中對話框，手機為底部抽屜） */
export class ZonePicker {
  private dialog: HTMLDialogElement;
  private titleEl: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLUListElement;
  private closeBtn: HTMLButtonElement;
  private entries: Entry[] | null = null;
  private filtered: Entry[] = [];
  private active = 0;
  private opts: OpenOptions | null = null;
  private timeFormats = new Map<string, Intl.DateTimeFormat>();

  constructor(
    private getLang: () => Lang,
    private getStrings: () => Strings,
  ) {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'zone-picker';
    this.dialog.innerHTML = `
      <div class="zp-panel">
        <header class="zp-header">
          <h2 class="zp-title" id="zp-title"></h2>
          <button type="button" class="icon-btn zp-close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </header>
        <div class="zp-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
          <input type="search" autocomplete="off" spellcheck="false" role="combobox"
            aria-expanded="true" aria-controls="zp-list" aria-autocomplete="list" />
        </div>
        <ul class="zp-list" id="zp-list" role="listbox" aria-labelledby="zp-title"></ul>
      </div>`;
    document.body.appendChild(this.dialog);
    this.dialog.setAttribute('aria-labelledby', 'zp-title');

    this.titleEl = this.dialog.querySelector('.zp-title')!;
    this.input = this.dialog.querySelector('input')!;
    this.list = this.dialog.querySelector('.zp-list')!;
    this.closeBtn = this.dialog.querySelector('.zp-close')!;

    this.closeBtn.addEventListener('click', () => this.close());
    // 包含按 Esc 關閉的情況
    this.dialog.addEventListener('close', () => document.body.classList.remove('modal-open'));
    // 點背景關閉
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.close();
    });
    this.input.addEventListener('input', () => this.render());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-id]');
      if (li) this.choose(li.dataset.id!);
    });
  }

  /** 語言改變時重建名稱 */
  invalidate() {
    this.entries = null;
    this.timeFormats.clear();
  }

  private buildEntries(): Entry[] {
    const lang = this.getLang();
    const now = new Date();
    const entries = getAllTimeZones().map((id) => {
      const city = zoneCity(id);
      const name = zoneDisplayName(id, lang, now);
      const country = zoneCountry(id, lang);
      const offset = getOffsetMinutes(id, now);
      const search = [id, id.replace(/_/g, ' '), city, name, country, zoneCountry(id, 'en'), formatOffset(offset)]
        .join(' ')
        .toLowerCase();
      return { id, city, name, country, offset, search };
    });
    entries.sort((a, b) => a.offset - b.offset || a.city.localeCompare(b.city));
    return entries;
  }

  open(opts: OpenOptions) {
    this.opts = opts;
    const s = this.getStrings();
    this.titleEl.textContent = opts.title;
    this.input.placeholder = s.search;
    this.input.setAttribute('aria-label', s.search);
    this.closeBtn.setAttribute('aria-label', s.close);
    this.input.value = '';
    if (!this.entries) this.entries = this.buildEntries();
    this.render();
    this.dialog.showModal();
    document.body.classList.add('modal-open');
    // 觸控裝置不自動跳出鍵盤
    if (window.matchMedia('(pointer: fine)').matches) this.input.focus();
    else this.closeBtn.focus();
    this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  }

  close() {
    this.dialog.close();
  }

  private choose(id: string) {
    this.opts?.onSelect(id);
    this.close();
  }

  private render() {
    const q = this.input.value.trim().toLowerCase();
    const all = this.entries!;
    const off = parseOffsetQuery(q);
    if (!q) this.filtered = all;
    else if (off !== null) this.filtered = all.filter((e) => e.offset === off);
    else {
      const words = q.split(/\s+/);
      this.filtered = all.filter((e) => words.every((w) => e.search.includes(w)));
    }

    const current = this.opts?.current;
    this.active = q ? 0 : Math.max(0, this.filtered.findIndex((e) => e.id === current));

    if (!this.filtered.length) {
      this.list.innerHTML = `<li class="zp-empty">${this.getStrings().noResults}</li>`;
      this.input.removeAttribute('aria-activedescendant');
      return;
    }

    const now = new Date();
    const frag = document.createDocumentFragment();
    this.filtered.forEach((e, i) => {
      const li = document.createElement('li');
      li.id = `zp-opt-${i}`;
      li.dataset.id = e.id;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(e.id === current));
      if (i === this.active) li.classList.add('active');
      const time = this.timeFormatter(e.id).format(now);
      const sub = [e.name, e.country].filter(Boolean).join(' · ');
      li.innerHTML = `
        <div class="zp-main">
          <span class="zp-city"></span>
          <span class="zp-sub"></span>
        </div>
        <div class="zp-side">
          <span class="zp-time">${time}</span>
          <span class="zp-offset">${formatOffset(e.offset)}</span>
        </div>`;
      li.querySelector('.zp-city')!.textContent = e.city;
      li.querySelector('.zp-sub')!.textContent = sub || e.id;
      li.title = e.id;
      frag.appendChild(li);
    });
    this.list.replaceChildren(frag);
    this.input.setAttribute('aria-activedescendant', `zp-opt-${this.active}`);
  }

  private timeFormatter(timeZone: string): Intl.DateTimeFormat {
    let f = this.timeFormats.get(timeZone);
    if (!f) {
      f = new Intl.DateTimeFormat(this.getLang(), { timeZone, hour: '2-digit', minute: '2-digit' });
      this.timeFormats.set(timeZone, f);
    }
    return f;
  }

  private setActive(i: number) {
    const items = this.list.querySelectorAll<HTMLLIElement>('li[data-id]');
    if (!items.length) return;
    this.active = (i + items.length) % items.length;
    items.forEach((el, idx) => el.classList.toggle('active', idx === this.active));
    items[this.active].scrollIntoView({ block: 'nearest' });
    this.input.setAttribute('aria-activedescendant', items[this.active].id);
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.setActive(this.active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.setActive(this.active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = this.filtered[this.active];
      if (entry) this.choose(entry.id);
    }
  }
}
