import { describe, it, expect } from 'vitest';
import { buildPlans } from '../src/core/planner';
import type { AvailabilityLevel, VoteLevel } from '../src/shared/types';

// 简写：'.' 或 '0' = 不行，'~' 或 '1' = 勉强，其余（'2'）= 可以
const A = (s: string): AvailabilityLevel[] =>
  s
    .split('')
    .map((c) => (c === '.' || c === '0' ? 0 : c === '~' || c === '1' ? 1 : 2) as AvailabilityLevel);

/** 造一个测试用输入 */
function makeInput(opts: {
  slotCount: number;
  people: Array<{ id: string; avail: string; core?: boolean; responded?: boolean }>;
  dests: Array<{ id: string; days: number; votes: Record<string, VoteLevel> }>;
}) {
  return {
    slotCount: opts.slotCount,
    participants: opts.people.map((p) => ({
      id: p.id,
      name: p.id,
      isCore: p.core ?? false,
      availability: A(p.avail),
      responded: p.responded ?? true,
    })),
    destinations: opts.dests.map((d) => ({
      id: d.id,
      name: d.id,
      daysNeeded: d.days,
      budgetLevel: null,
      votes: d.votes,
    })),
  };
}

describe('buildPlans — 设计文档 §3.1 的那个反例', () => {
  // 小王、小李：想去云南(5天)，10/1-10/7 有空
  // 小张：想去莫干山(2天)，10/5-10/7 有空
  // 小赵：想去莫干山(2天)，10/1-10/7 有空
  const input = makeInput({
    slotCount: 7,
    people: [
      { id: '小王', avail: '2222222' },
      { id: '小李', avail: '2222222' },
      { id: '小张', avail: '....222' },
      { id: '小赵', avail: '2222222' },
    ],
    dests: [
      { id: '云南', days: 5, votes: { 小王: 2, 小李: 2, 小张: 0, 小赵: 0 } },
      { id: '莫干山', days: 2, votes: { 小王: 1, 小李: 1, 小张: 2, 小赵: 2 } },
    ],
  });

  it('冠军方案是四人全到的莫干山', () => {
    const plans = buildPlans(input);
    const top = plans[0];
    expect(top.destinationName).toBe('莫干山');
    expect(top.attendeeIds).toHaveLength(4);
    expect(top.blocked).toBe(false);
  });

  it('云南方案仍然存在，是 2 人 —— 不是被整体丢弃', () => {
    const plans = buildPlans(input);
    const yunnan = plans.find((p) => p.destinationName === '云南');
    expect(yunnan).toBeDefined();
    expect(yunnan!.attendeeIds.sort()).toEqual(['小李', '小王'].sort());
  });

  it('云南方案点名：小张没空、小赵不想去', () => {
    const plans = buildPlans(input);
    const yunnan = plans.find((p) => p.destinationName === '云南')!;
    expect(yunnan.missing).toContainEqual({ participantId: '小张', name: '小张', reason: 'busy' });
    expect(yunnan.missing).toContainEqual({
      participantId: '小赵',
      name: '小赵',
      reason: 'unwilling',
    });
  });

  it('方案按人数降序', () => {
    const plans = buildPlans(input);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i - 1].attendeeIds.length).toBeGreaterThanOrEqual(plans[i].attendeeIds.length);
    }
  });

  it('相邻且人群相同的窗口被合并成一个', () => {
    const plans = buildPlans(input);
    const mds = plans.find((p) => p.destinationName === '莫干山' && p.attendeeIds.length === 4)!;
    // 10/5 和 10/6 两个起点都是 4 人 → 合并成 10/5–10/7（槽位 4–6）
    expect(mds.startSlot).toBe(4);
    expect(mds.endSlot).toBe(6);
  });
});

describe('buildPlans — 基础行为', () => {
  it('没人投票的目的地不出现在方案里', () => {
    const input = makeInput({
      slotCount: 4,
      people: [{ id: 'a', avail: '2222' }],
      dests: [{ id: '无人区', days: 1, votes: { a: 0 } }],
    });
    expect(buildPlans(input).every((p) => p.destinationName !== '无人区')).toBe(true);
  });

  it('需要天数超过活动范围的目的一律不可行', () => {
    const input = makeInput({
      slotCount: 3,
      people: [{ id: 'a', avail: '222' }],
      dests: [{ id: '太远', days: 10, votes: { a: 2 } }],
    });
    expect(buildPlans(input)).toEqual([]);
  });

  it('没填的人不算进分母，也不出现在 missing 里', () => {
    const input = makeInput({
      slotCount: 2,
      people: [
        { id: 'a', avail: '22' },
        { id: 'b', avail: '00', responded: false },
      ],
      dests: [{ id: 'x', days: 1, votes: { a: 2 } }],
    });
    const top = buildPlans(input)[0];
    expect(top.attendeeIds).toEqual(['a']);
    expect(top.missing.some((m) => m.participantId === 'b')).toBe(false);
  });

  it('一个人都没填时返回空数组', () => {
    const input = makeInput({
      slotCount: 2,
      people: [{ id: 'a', avail: '00', responded: false }],
      dests: [{ id: 'x', days: 1, votes: { a: 2 } }],
    });
    expect(buildPlans(input)).toEqual([]);
  });

  it('参与者少于 3 人时直接给并排对照，不做方案枚举', () => {
    const input = makeInput({
      slotCount: 2,
      people: [{ id: 'a', avail: '22' }],
      dests: [{ id: 'x', days: 1, votes: { a: 2 } }],
    });
    const plans = buildPlans(input);
    expect(plans).toHaveLength(1);
    expect(plans[0].blockedReason).toBe('参与者不足 3 人，直接给出对照表');
  });

  it('时间完全不重叠时，给出每人单独成行的方案，而不是抛异常或返回空', () => {
    const input = makeInput({
      slotCount: 3,
      people: [
        { id: 'a', avail: '200' },
        { id: 'b', avail: '020' },
        { id: 'c', avail: '002' },
      ],
      dests: [{ id: 'x', days: 1, votes: { a: 2, b: 2, c: 2 } }],
    });
    const plans = buildPlans(input);
    expect(plans).toHaveLength(3);
    expect(plans.every((p) => p.attendeeIds.length === 1)).toBe(true);
  });
});

describe('buildPlans — 核心成员模式', () => {
  it('核心成员没全到的方案被标记为 blocked 并沉底', () => {
    const input = makeInput({
      slotCount: 4,
      people: [
        { id: '核心A', avail: '2222', core: true },
        { id: '核心B', avail: '22..', core: true }, // 只有前两格有空
        { id: '路人', avail: '2222' },
      ],
      dests: [{ id: 'x', days: 2, votes: { 核心A: 2, 核心B: 2, 路人: 2 } }],
    });
    const plans = buildPlans(input);

    // [0,1] 三个人都到 → 冠军
    expect(plans[0].attendeeIds).toHaveLength(3);
    expect(plans[0].blocked).toBe(false);

    // [1,2] 和 [2,3] 核心B 来不了 → blocked，排到后面
    const blockedOnes = plans.filter((p) => p.blocked);
    expect(blockedOnes.length).toBeGreaterThan(0);
    expect(blockedOnes[0].blockedReason).toContain('核心B');
  });

  it('没人被标记为核心时，不会标 blocked —— 标记了才算数，没标记就没影响', () => {
    const input = makeInput({
      slotCount: 4,
      people: [
        { id: 'a', avail: '2222' },
        { id: 'b', avail: '22..' },
        { id: 'c', avail: '2222' },
      ],
      dests: [{ id: 'x', days: 2, votes: { a: 2, b: 2, c: 2 } }],
    });
    expect(buildPlans(input).every((p) => !p.blocked)).toBe(true);
  });
});

describe('buildPlans — 排序', () => {
  it('人数相同时，「勉强」更少的方案排前面', () => {
    const input = makeInput({
      slotCount: 6,
      people: [
        { id: 'a', avail: '2~..22' }, // [0,1] 里有一格勉强；[4,5] 干净
        { id: 'b', avail: '22..22' },
        { id: 'c', avail: '22..22' },
      ],
      dests: [{ id: 'x', days: 2, votes: { a: 2, b: 2, c: 2 } }],
    });
    const plans = buildPlans(input);
    expect(plans[0].startSlot).toBe(4);
    expect(plans[0].weakCount).toBe(0);
  });
});

describe('buildPlans — 砍掉被支配的方案', () => {
  it('同目的地、人数更少、且能来的人完全被包含 → 不显示', () => {
    // a、b、c 全程有空；d 只有后三天有空
    // 莫干山(2天)：[4,5] 四人全到；[0,1] 等只有 a、b、c
    // 后者的人全是前者的子集 → 被支配 → 砍掉
    const input = makeInput({
      slotCount: 7,
      people: [
        { id: 'a', avail: '2222222' },
        { id: 'b', avail: '2222222' },
        { id: 'c', avail: '2222222' },
        { id: 'd', avail: '0000222' },
      ],
      dests: [{ id: '莫干山', days: 2, votes: { a: 2, b: 2, c: 2, d: 2 } }],
    });
    const plans = buildPlans(input);
    expect(plans).toHaveLength(1);
    expect(plans[0].attendeeIds).toHaveLength(4);
  });

  it('人群不是子集时不砍 —— 换人了就是不同的方案', () => {
    // a 只有前两天有空、c 只有后两天有空 → {a,b,d} 和 {b,c,d} 互不包含
    const input = makeInput({
      slotCount: 4,
      people: [
        { id: 'a', avail: '22..' },
        { id: 'b', avail: '2222' },
        { id: 'c', avail: '..22' },
        { id: 'd', avail: '2222' },
      ],
      dests: [{ id: 'x', days: 2, votes: { a: 2, b: 2, c: 2, d: 2 } }],
    });
    const plans = buildPlans(input);
    // {a,b,d} 和 {b,c,d} 都留；{b,d} 被两者支配 → 砍掉
    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.attendeeIds.length === 3)).toBe(true);
  });

  it('目的地不同就不构成支配 —— 人少的那个必须留着', () => {
    // §3.1 反例：莫干山 3 人方案被莫干山 4 人方案支配 → 砍
    // 但云南 2 人方案是【另一个目的地】→ 必须留，它是取舍的体现
    const input = makeInput({
      slotCount: 7,
      people: [
        { id: '小王', avail: '2222222' },
        { id: '小李', avail: '2222222' },
        { id: '小张', avail: '....222' },
        { id: '小赵', avail: '2222222' },
      ],
      dests: [
        { id: '云南', days: 5, votes: { 小王: 2, 小李: 2, 小张: 0, 小赵: 0 } },
        { id: '莫干山', days: 2, votes: { 小王: 1, 小李: 1, 小张: 2, 小赵: 2 } },
      ],
    });
    const plans = buildPlans(input);
    expect(plans).toHaveLength(2);
    expect(plans[0].destinationName).toBe('莫干山');
    expect(plans[0].attendeeIds).toHaveLength(4);
    expect(plans[1].destinationName).toBe('云南');
    expect(plans[1].attendeeIds).toHaveLength(2);
  });
});
