# vibe-coding-timezone-compute
計算時區的網頁

在宇宙中央有一顆緩緩轉動的地球，依照真實的太陽位置畫出白天與夜晚。

## 功能

- **所屬時區**：自動偵測瀏覽器所在的時區與 UTC 偏移
- **鎖定時區時鐘**：預設為所屬時區，可搜尋並切換到任何 IANA 時區；鎖定時地球會轉向該時區並標出位置，解除鎖定後地球繼續自轉
- **時差**：比較兩個時區目前相差多少，並用 24 小時刻度對照雙方的白天夜晚
- **時間換算**：輸入某時區的日期時間，換算成另一個時區（會處理夏令時間與跨日）
- **多語系**：繁體中文、简体中文、English、日本語，預設跟隨瀏覽器語言
- **響應式**：支援電腦、平板與手機

## 開發

需要 Node.js 18 以上。

```bash
npm install
npm run dev      # 開發伺服器，同網路的手機、平板也能連線測試
npm run build    # 輸出到 dist/
npm run preview  # 預覽 build 結果
```

## 專案結構

```
index.html          主頁
src/main.ts         進入點，組合畫面與事件
src/timezone.ts     時區運算（偵測、偏移、換算、太陽直射點）
src/globe.ts        Three.js 地球、晨昏線 shader、星空
src/picker.ts       時區搜尋選擇器
src/i18n.ts         介面文字翻譯
src/style.css       樣式與響應式版面
src/data/zones.ts   時區 → 代表城市座標（由 IANA tzdb zone.tab 產生）
public/textures/    地球白天／夜晚貼圖
```

## 素材來源

- 地球貼圖：NASA Blue Marble / Black Marble（公有領域），取自 [three-globe](https://github.com/vasturiano/three-globe) 範例
- 時區座標：[IANA Time Zone Database](https://www.iana.org/time-zones) `zone.tab`
