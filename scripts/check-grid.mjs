/**
 * 时间网格的回归检查 —— 几何 + 行为 + 控制台，一次全查。
 *
 * 用法：
 *   1. 另开终端跑 `npm run dev`
 *   2. node scripts/check-grid.mjs /e/xxxxxx/fill
 *      或 node scripts/check-grid.mjs /e/xxxxxx/fill --width=320
 *
 * 【为什么要有这个脚本】
 * 上一轮重做时间网格时做过一次几何检测，结论是「重叠从 16 处降到 0」——
 * 但那个脚本是临时写的，没进仓库，改完就没了。于是：
 *   · 结论无法复现，别人只能选择信或不信
 *   · 下次改网格没有任何东西能挡住回归
 * 所以这次把它固化下来，跟代码一起走。
 *
 * 它检查四件事：
 *   ① 几何    —— 格子够不够大、有没有互相压、有没有横向溢出
 *   ② 遮挡    —— 有没有文字压在格子上（日期标签跑位就是这一类）
 *   ③ 行为    —— 键盘能切换、鼠标点一次只走一步
 *   ④ 控制台  —— 有没有 React 的 key 重复之类的警告
 *
 * 第 ③ 条尤其重要：鼠标点一次如果被处理了两遍，格子会前进两格
 * （不行 → 可以 → 勉强），用户看到的是「点了没反应」。
 * 这种错几何检测完全抓不到，只有真的点一下才会发现。
 */
import { launch } from './browser.mjs';

const args = process.argv.slice(2);
const route = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = flag('base', 'http://localhost:5173');
const width = Number(flag('width', 390));
/** 触控下限。44 是 Apple 的建议值；这里按 32 卡，
 *  因为 320px 屏幕上 7 列本来就放不下 44 —— 那是已知且写明的取舍，
 *  卡 32 是为了挡住「又悄悄缩回 13px」这种回归。 */
const MIN_CELL = 32;

if (!route) {
  console.error('用法：node scripts/check-grid.mjs <路由，如 /e/xxxxxx/fill> [--width=390]');
  process.exit(1);
}

let failed = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.log(`  ✗ ${msg}`);
  failed++;
};

const page = await launch({ width, height: 844 });
try {
  await page.goto(`${BASE}${route}`);

  // ── ① 几何 ──────────────────────────────────
  console.log(`\n【几何】${width}px 宽`);

  const geo = await page.eval(`
    const cells = [...document.querySelectorAll('button[data-idx]')];
    // 注意：DOMRect 的 width/height/left… 是原型上的 getter，
    // 用 {...rect} 展开只会得到一个空对象。必须逐个取值。
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const rects = cells.map((el) => ({ i: +el.dataset.idx, ...box(el) }));

    // 两两相交的格子（真重叠，不是相邻贴边）
    const overlaps = [];
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const A = rects[a], B = rects[b];
        const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
        const oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (ox > 0.5 && oy > 0.5) overlaps.push([A.i, B.i]);
      }
    }

    return {
      count: rects.length,
      minW: rects.length ? Math.min(...rects.map((r) => r.width)) : 0,
      minH: rects.length ? Math.min(...rects.map((r) => r.height)) : 0,
      overlaps,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  `);

  if (geo.count === 0) {
    bad('一个格子都没找到 —— 页面没渲染出来？');
  } else {
    console.log(`    共 ${geo.count} 格，最小 ${geo.minW.toFixed(1)}×${geo.minH.toFixed(1)}px`);
    geo.minW >= MIN_CELL && geo.minH >= MIN_CELL
      ? ok(`每格都不小于 ${MIN_CELL}px`)
      : bad(`有格子小于 ${MIN_CELL}px（最小 ${geo.minW.toFixed(1)}px）—— 手指点不准`);

    geo.overlaps.length === 0
      ? ok('没有两个格子互相重叠')
      : bad(`${geo.overlaps.length} 对格子重叠：${JSON.stringify(geo.overlaps.slice(0, 5))}`);

    geo.scrollW <= geo.clientW + 1
      ? ok('没有横向溢出')
      : bad(`横向溢出：内容宽 ${geo.scrollW} > 视口 ${geo.clientW}`);
  }

  // ── ② 遮挡 ──────────────────────────────────
  console.log('\n【遮挡】有没有文字压在格子上');

  const covered = await page.eval(`
    const cells = [...document.querySelectorAll('button[data-idx]')];
    const rects = cells.map((el) => el.getBoundingClientRect());

    // 只挑「叶子节点 + 有文字」的元素：日期、月份、图例这些
    const texts = [...document.querySelectorAll('div,span,p')].filter(
      (el) => el.children.length === 0 && el.textContent.trim() !== ''
    );

    const hits = [];
    for (const el of texts) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      for (const c of rects) {
        const ox = Math.min(r.right, c.right) - Math.max(r.left, c.left);
        const oy = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top);
        // 要求两个方向都真的交叠，避免把「贴边」算成遮挡
        if (ox > 1 && oy > 1) {
          hits.push({ text: el.textContent.trim().slice(0, 12), overlapY: +oy.toFixed(1) });
          break;
        }
      }
    }
    return hits;
  `);

  covered.length === 0
    ? ok('没有文字压在格子上')
    : bad(`${covered.length} 处文字压在格子上：${JSON.stringify(covered.slice(0, 6))}`);

  // ── ②b 无障碍标签的日期 ──────────────────────
  // 格子是按时间先后排的，所以把它们念出来的日期换算成「月*100+日」之后
  // 必须严格递增。跨月那一行如果月份取错（拿了这一行第一天的月份，
  // 而不是格子自己的），11/1 会被念成「10月1日」，序列就会掉头往下 ——
  // 用这个单调性来抓它，比肉眼找快得多。
  const labels = await page.eval(`
    return [...document.querySelectorAll('button[data-idx]')]
      .sort((a, b) => +a.dataset.idx - +b.dataset.idx)
      .map((el, i) => ({ i, label: el.getAttribute('aria-label') ?? '' }));
  `);

  const seq = labels.map(({ i, label }) => {
    const m = label.match(/(\d+)月(\d+)日/);
    // 按半天时一格只有半天，同一天的「早」「午」是同一个月日 ——
    // 排序键必须把时段也算进去，否则同一天的上午和下午会被判成「倒退」，
    // 那是检测脚本自己的假警报，不是界面的问题。
    const period = /日\s*早/.test(label) ? 0 : /日\s*午/.test(label) ? 1 : 0;
    return { i, label, key: m ? +m[1] * 10000 + +m[2] * 10 + period : null };
  });

  const bad2 = seq.filter((s, i) => i > 0 && s.key !== null && seq[i - 1].key !== null && s.key <= seq[i - 1].key);

  bad2.length === 0
    ? ok(`无障碍标签的日期逐格递增（末格「${seq.at(-1)?.label}」）`)
    : bad(
        `无障碍标签的日期没有递增，${bad2.length} 处倒退：\n` +
          bad2
            .slice(0, 4)
            .map((s) => `      ${seq[s.i - 1].label}  →  ${s.label}`)
            .join('\n'),
      );

  // ── ③ 行为 ──────────────────────────────────
  console.log('\n【行为】键盘和鼠标');

  const first = await page.eval(`
    const el = document.querySelector('button[data-idx="0"]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { label: el.getAttribute('aria-label'), x: r.left + r.width / 2, y: r.top + r.height / 2 };
  `);

  if (!first) {
    bad('找不到第一格，行为检查跳过');
  } else {
    // 键盘：element.click() 派发的 click 事件 detail 是 0，
    // 和敲回车/空格走的是同一条路
    await page.eval(`document.querySelector('button[data-idx="0"]').click(); return 1;`);
    await new Promise((r) => setTimeout(r, 200));
    const afterKey = await page.eval(
      `return document.querySelector('button[data-idx="0"]').getAttribute('aria-label');`,
    );
    afterKey !== first.label
      ? ok(`键盘能切换：${first.label} → ${afterKey}`)
      : bad(`键盘按了没反应，还是「${afterKey}」—— 只用键盘的人填不了这张表`);

    // 鼠标：走真实的 pointerdown/pointerup/click 全链路。
    // 点【一次】只应该走【一步】。走两步说明 pointerdown 和 click 都改了值，
    // 结果互相抵消或越过一格，表现就是「点了没反应」。
    const beforeMouse = await page.eval(`
      const el = document.querySelector('button[data-idx="1"]');
      return el.getAttribute('aria-label');
    `);
    const box = await page.eval(`
      const el = document.querySelector('button[data-idx="1"]');
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `);
    await page.clickAt(box.x, box.y);
    await new Promise((r) => setTimeout(r, 250));
    const afterMouse = await page.eval(
      `return document.querySelector('button[data-idx="1"]').getAttribute('aria-label');`,
    );

    const level = (s) => (s ?? '').match(/(不行|勉强|可以)/)?.[1];
    // 初始是「不行」，点一次应该到「可以」；到「勉强」说明走了两步
    if (beforeMouse && afterMouse && beforeMouse !== afterMouse) {
      level(afterMouse) === '可以'
        ? ok(`鼠标点一次走一步：${beforeMouse} → ${afterMouse}`)
        : bad(`鼠标点一次走了不止一步：${beforeMouse} → ${afterMouse}（应该是「可以」）`);
    } else {
      bad(`鼠标点了没反应：${beforeMouse} → ${afterMouse}`);
    }
  }

  // ── ④ 控制台 ────────────────────────────────
  console.log('\n【控制台】');

  const noise = page
    .consoleMessages()
    .filter((m) => m.type === 'error' || m.type === 'warning' || m.type === 'exception');

  noise.length === 0
    ? ok('没有警告和报错')
    : bad(`${noise.length} 条警告/报错：\n${noise.map((m) => `      [${m.type}] ${m.text.slice(0, 160)}`).join('\n')}`);
} finally {
  await page.close();
}

console.log(`\n${'─'.repeat(46)}`);
if (failed === 0) {
  console.log('全部通过');
} else {
  console.log(`${failed} 项不通过`);
  process.exit(1);
}
