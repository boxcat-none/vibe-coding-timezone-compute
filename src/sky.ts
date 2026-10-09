/** 背景星雲：畫成等距圓柱投影（equirectangular）的貼圖，包在 3D 場景的天球上，才能跟著地球一起轉動 */

/** 固定種子的亂數，讓每次產生的星空都一樣 */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number, w: number) {
  // 左右邊界要能無縫接起來，靠近邊緣的也在另一側畫一次
  for (const dx of [0, -w, w]) {
    const cx = x + dx;
    if (cx + r < 0 || cx - r > w) continue;
    const g = ctx.createRadialGradient(cx, y, 0, cx, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.5, `rgba(${rgb},${a * 0.35})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, y - r, r * 2, r * 2);
  }
}

export function createNebulaCanvas(): HTMLCanvasElement {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rand = seeded(20261009);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';

  // 銀河般的帶狀星雲：在天球上是一個傾斜的大圓，投影後成為正弦曲線
  const palette = ['70,40,150', '30,60,160', '110,35,120', '20,90,170', '150,70,40'];
  for (let i = 0; i < 160; i++) {
    const x = rand() * w;
    const y = h / 2 + Math.sin((x / w) * Math.PI * 2 + 0.6) * h * 0.22 + (rand() - 0.5) * h * 0.16;
    const r = h * (0.05 + rand() * 0.14);
    const c = palette[i % 11 === 0 ? 4 : Math.floor(rand() * 4)];
    blob(ctx, x, y, r, c, 0.04 + rand() * 0.06, w);
  }
  // 零星的暗色雲氣
  for (let i = 0; i < 24; i++) {
    blob(ctx, rand() * w, h * (0.15 + rand() * 0.7), h * (0.1 + rand() * 0.2), palette[Math.floor(rand() * 3)], 0.03, w);
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}
