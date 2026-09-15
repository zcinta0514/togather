/**
 * 给页面截图，按屏切片。
 *
 * 用法：
 *   node scripts/shoot.mjs http://localhost:5173/ --out=.shots/landing
 *   node scripts/shoot.mjs http://localhost:5173/ --width=320 --out=.shots/landing-320
 *
 * 为什么按屏切、而不是截一张长图：
 *   长图在对话里会被整体缩放到看不清，字号、间距、对齐的问题全看不出来 ——
 *   而「只有真的把页面看一眼才会发现」的那类 bug 恰恰藏在这些细节里。
 *   按视口高度切，每一张都是原生分辨率。
 *
 * 产物落到 --out 指定的目录（默认 .shots/，已在 .gitignore 里）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch } from './browser.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

if (!url) {
  console.error(
    '用法：node scripts/shoot.mjs <url> [--width=390] [--height=844] [--out=.shots/name]\n' +
      '                          [--format=png|jpeg] [--quality=88]',
  );
  process.exit(1);
}

const width = Number(flag('width', 390));
const height = Number(flag('height', 844));
const outDir = flag('out', '.shots/page');
const format = flag('format', 'png');
// 界面截图用 jpeg 划算得多：大片纯色和平坦的渐变，png 压不动，
// 同样清晰度下 jpeg 常常只有三分之一大。
const quality = Number(flag('quality', 88));
const ext = format === 'jpeg' ? 'jpg' : 'png';

mkdirSync(outDir, { recursive: true });

const page = await launch({ width, height });
try {
  console.log(`▸ 打开 ${url}（${width}×${height} @2x, ${format}）`);
  await page.goto(url);

  const total = await page.pageHeight();
  const screens = Math.max(1, Math.ceil(total / height));
  console.log(`▸ 页面高 ${total}px，切 ${screens} 屏\n`);

  for (let i = 0; i < screens; i++) {
    const y = i * height;
    // 最后一屏如果只剩一点点，就往前挪，别截出一张几乎全空的图
    const scrollY = Math.max(0, Math.min(y, total - height));
    const data = await page.shotAt(scrollY, format, quality);
    const file = path.join(outDir, `${String(i + 1).padStart(2, '0')}.${ext}`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  ${file}   (y=${scrollY})`);
  }
} finally {
  await page.close();
}

console.log('\n✓ 截图完成');

