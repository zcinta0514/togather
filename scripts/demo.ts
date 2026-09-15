/**
 * 用设计文档 §3.1 的那个反例跑一遍真实算法。
 *
 * 跑法：npm run demo
 *
 * 这个脚本存在的意义：让你不用读代码、不用开网页，
 * 就能亲眼看到「分开算」和「交叉算」得出的结论完全不一样。
 */
import { buildPlans } from '../src/core/planner';
import { slotRangeLabel } from '../src/core/slots';
import type { AvailabilityLevel, VoteLevel } from '../src/shared/types';

// ---------- 场景（设计文档 §3.1） ----------

const RANGE_START = Math.floor(Date.UTC(2025, 9, 1, 0, 0, 0) / 1000) - 8 * 3600; // 10/1 北京时间 00:00
const SLOTS = 7;

const A = (s: string): AvailabilityLevel[] =>
  s
    .split('')
    .map((c) => (c === '.' || c === '0' ? 0 : c === '~' || c === '1' ? 1 : 2) as AvailabilityLevel);

interface Person {
  id: string;
  has: string;
  why: string;
  votes: Record<string, VoteLevel>;
}

const PEOPLE: Person[] = [
  { id: '小王', has: '2222222', why: '10/1–10/7 有空', votes: { 云南: 2, 莫干山: 1 } },
  { id: '小李', has: '2222222', why: '10/1–10/7 有空', votes: { 云南: 2, 莫干山: 1 } },
  { id: '小张', has: '0000222', why: '只有 10/5–10/7 有空', votes: { 云南: 0, 莫干山: 2 } },
  { id: '小赵', has: '2222222', why: '10/1–10/7 有空', votes: { 云南: 0, 莫干山: 2 } },
];

const DESTS = [
  { id: '云南', name: '云南', daysNeeded: 5 },
  { id: '莫干山', name: '莫干山', daysNeeded: 2 },
];

const VOTE_LABEL: Record<VoteLevel, string> = { 2: '想去', 1: '都行', 0: '不想去' };

// ---------- 输出工具 ----------

const line = (c = '─') => c.repeat(66);
const h = (s: string) => `\n${s}\n${line()}`;

// ---------- 场景 ----------

console.log(h('场景'));
console.log(`时间范围：10/1 – 10/7（共 ${SLOTS} 天）\n`);
for (const p of PEOPLE) {
  const v = DESTS.map((d) => `${d.name}「${VOTE_LABEL[p.votes[d.id]]}」`).join('　');
  console.log(`  ${p.id}　${v}　·　${p.why}`);
}
console.log('\n  云南需要 5 天，莫干山需要 2 天');

// ---------- 分开算（Doodle 式） ----------

console.log(h('① 分开算 —— 两张独立的表'));

const total = PEOPLE.length;
const perDay = Array.from({ length: SLOTS }, (_, i) =>
  PEOPLE.filter((p) => A(p.has)[i] === 2).length,
);
const allFree = perDay.every((n) => n === total);

console.log('【表一 · 时间】每天能来的人数');
for (let i = 0; i < SLOTS; i++) {
  const bar = '█'.repeat(perDay[i]) + '░'.repeat(total - perDay[i]);
  console.log(`  10/${i + 1}　${bar}　${perDay[i]}/${total}`);
}
console.log(`\n  → 结论：${allFree ? '10/1–10/7 全员有空，那就这七天去' : '没有全员都有空的日子'}`);

console.log('\n【表二 · 地点】票数');
const tally = DESTS.map((d) => ({
  name: d.name,
  n: PEOPLE.filter((p) => (p.votes[d.id] ?? 0) >= 2).length,
}));
for (const t of tally) console.log(`  ${t.name}　${t.n} 票`);

const distinct = new Set(tally.map((t) => t.n));
console.log(
  `\n  → 结论：${distinct.size === 1 ? `${tally[0].name} 和 ${tally[1].name} 平票，定不了` : '票数最高的胜出'}`,
);

console.log('\n  把两张表拼起来 = 「10/1–10/7 去云南或莫干山」');
console.log('  ↑ 但这根本不可行：云南要 5 天，小张 10/1 才放假，去不了。');
console.log('    而且小赵压根没投云南。两张表都没错，拼起来是错的。');

// ---------- 交叉算 ----------

console.log(h('② 交叉算 —— 本产品的算法'));

const plans = buildPlans({
  slotCount: SLOTS,
  coreOnly: false,
  participants: PEOPLE.map((p) => ({
    id: p.id,
    name: p.id,
    isCore: false,
    availability: A(p.has),
    responded: true,
  })),
  destinations: DESTS.map((d) => ({
    id: d.id,
    name: d.name,
    daysNeeded: d.daysNeeded,
    budgetLevel: null,
    votes: Object.fromEntries(PEOPLE.map((p) => [p.id, p.votes[d.id] ?? 0])) as Record<
      string,
      VoteLevel
    >,
  })),
});

console.log(`算出来 ${plans.length} 个方案：\n`);

plans.forEach((plan, i) => {
  const isChampion = i === 0 && !plan.blocked;
  const range = slotRangeLabel(RANGE_START, plan.startSlot, plan.endSlot, 'day');
  const who = plan.attendeeIds.join('、');

  console.log(
    `${isChampion ? '🏆 ' : '   '}方案 ${String.fromCharCode(65 + i)}　${range} · ${plan.destinationName}（需 ${plan.daysNeeded} 天）`,
  );
  console.log(`      ✓ ${who}　→ ${plan.attendeeIds.length} 人`);

  if (plan.missing.length > 0) {
    const busy = plan.missing.filter((m) => m.reason === 'busy').map((m) => `${m.name}（没空）`);
    const no = plan.missing.filter((m) => m.reason === 'unwilling').map((m) => `${m.name}（不想去）`);
    console.log(`      ✕ ${[...busy, ...no].join('　')}`);
  }
  console.log('');
});

// ---------- 结论 ----------

console.log(h('结论'));

const top = plans[0];
const yunnan = plans.find((p) => p.destinationName === '云南');

console.log(`分开算给出的答案（10/1–10/7 去云南）实际只有 ${yunnan?.attendeeIds.length ?? 0} 人能去，是个假答案。`);
console.log(
  `交叉算给出的答案是：${slotRangeLabel(RANGE_START, top.startSlot, top.endSlot, 'day')} 去 ${top.destinationName}，${top.attendeeIds.length} 人能到。`,
);
console.log('\n而参与者为此多填的东西：一个字都没有。');
console.log('他们只涂了「什么时候有空」+ 选了「想去哪儿」。');
console.log('「最多能连续空几天」是系统从网格里自己推出来的。');
console.log('');
console.log(line());
console.log('（本脚本跑的是 src/core/planner.ts 里的真实算法，不是硬编码的示例数据）');
