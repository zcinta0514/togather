import type { AvailabilityLevel, PlanDto, VoteLevel } from '../shared/types';
import { feasibleWindows, type Window } from './windows';

export interface PlannerParticipant {
  id: string;
  name: string;
  isCore: boolean;
  availability: AvailabilityLevel[];
  responded: boolean;
}

export interface PlannerDestination {
  id: string;
  name: string;
  daysNeeded: number;
  budgetLevel: number | null;
  votes: Record<string, VoteLevel>; // participantId -> level
}

export interface PlannerInput {
  slotCount: number;
  coreOnly: boolean;
  participants: PlannerParticipant[];
  destinations: PlannerDestination[];
}

/** 少于这个人数就不做方案枚举，直接给对照表 */
const MIN_FOR_PLANNING = 3;

/** 最多返回多少个方案 */
const MAX_PLANS = 8;

/**
 * 交叉方案矩阵 —— 整个产品的立身之本。
 *
 * 关键：不再对每个窗口暴力枚举，只把「某人的可行段起点」当作候选起点。
 * 因为任何最优窗口的起点一定落在某个人的可行段起点上 ——
 * 否则往前挪一格不会损失任何人，说明原来那个不是最优。
 * 这把候选数从 O(K²) 降到 O(B)，B = 总可行段边界数（真实场景 < 50）。
 */
export function buildPlans(input: PlannerInput): PlanDto[] {
  const responded = input.participants.filter((p) => p.responded);

  if (responded.length === 0) return [];
  // 边界情况：人太少时算法没有价值，直接给对照表
  if (responded.length < MIN_FOR_PLANNING) return buildSimpleComparison(input, responded);

  // 预计算：每个人对每个目的地的可行窗口，按起点索引，方便 O(1) 查
  const windowCache = new Map<string, Map<number, Window>>();
  const candidateStarts = new Set<number>();
  for (const p of responded) {
    for (const d of input.destinations) {
      const byStart = new Map<number, Window>();
      for (const w of feasibleWindows(p.availability, d.daysNeeded)) {
        byStart.set(w.start, w);
        candidateStarts.add(w.start);
      }
      windowCache.set(`${p.id}|${d.id}`, byStart);
    }
  }

  const plans: PlanDto[] = [];

  for (const d of input.destinations) {
    for (const start of candidateStarts) {
      const end = start + d.daysNeeded - 1;
      if (end >= input.slotCount) continue;

      const attendeeIds: string[] = [];
      let weakCount = 0;

      // ★ 关键：能来一个算一个，不是「全员能来才算方案」。
      //   要求全员到齐会直接抹掉 subset 视图 —— 而那正是产品的差异化所在。
      for (const p of responded) {
        if ((d.votes[p.id] ?? 0) < 1) continue; // 不想去的不进方案
        const hit = windowCache.get(`${p.id}|${d.id}`)?.get(start);
        if (!hit) continue; // 来不了的跳过，不整体失败
        attendeeIds.push(p.id);
        weakCount += hit.weakCount;
      }

      if (attendeeIds.length === 0) continue; // 一个都来不了 → 不成方案

      attendeeIds.sort();
      const attendeeSet = new Set(attendeeIds);

      const missing: PlanDto['missing'] = [];
      for (const p of responded) {
        if (attendeeSet.has(p.id)) continue;
        // 时间原因优先于意愿原因：确实没空比「不想去」更硬，
        // 而且两者都成立时，「没空」对组织者更有用
        const hasWindow = windowCache.get(`${p.id}|${d.id}`)?.has(start) ?? false;
        missing.push({
          participantId: p.id,
          name: p.name,
          reason: hasWindow ? 'unwilling' : 'busy',
        });
      }

      const cores = responded.filter((p) => p.isCore);
      const missingCores = cores.filter((c) => !attendeeSet.has(c.id));
      const blocked = input.coreOnly && cores.length > 0 && missingCores.length > 0;

      plans.push({
        destinationId: d.id,
        destinationName: d.name,
        daysNeeded: d.daysNeeded,
        startSlot: start,
        endSlot: end,
        attendeeIds,
        weakCount,
        missing,
        blocked,
        blockedReason: blocked
          ? `核心成员 ${missingCores.map((c) => c.name).join('、')} 到不了`
          : undefined,
      });
    }
  }

  return rankAndTrim(mergeAdjacent(plans));
}

/**
 * 合并相邻且「人群完全相同」的窗口。
 *
 * 必须先按 (目的地, 是否核心受阻, 人群) 分组，组内按起始槽位排序再合并 ——
 * 不能直接对排好序的列表做相邻判断：排序键里有 weakCount，
 * 会让时间上不相邻的两个窗口在列表里挨在一起，一合就错。
 */
function mergeAdjacent(plans: PlanDto[]): PlanDto[] {
  const groups = new Map<string, PlanDto[]>();
  for (const p of plans) {
    const key = `${p.destinationId}|${p.blocked}|${p.attendeeIds.join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const out: PlanDto[] = [];
  for (const [, list] of groups) {
    list.sort((a, b) => a.startSlot - b.startSlot);
    let cur: PlanDto | null = null;
    for (const p of list) {
      if (cur && p.startSlot <= cur.endSlot + 1) {
        cur.endSlot = Math.max(cur.endSlot, p.endSlot);
        // 合并后取最优子窗口的 weakCount 作为排序代理值
        cur.weakCount = Math.min(cur.weakCount, p.weakCount);
        continue;
      }
      if (cur) out.push(cur);
      cur = { ...p };
    }
    if (cur) out.push(cur);
  }
  return out;
}

/**
 * 排序 → 裁剪。
 *
 * 排序优先级（设计文档 §8.2 第 5 步）：
 *   1. 核心受阻的沉底
 *   2. 人数降序
 *   3. 勉强格数升序
 *   4. 时间更早
 */
function rankAndTrim(plans: PlanDto[]): PlanDto[] {
  const sorted = [...plans].sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
    if (a.attendeeIds.length !== b.attendeeIds.length) {
      return b.attendeeIds.length - a.attendeeIds.length;
    }
    if (a.weakCount !== b.weakCount) return a.weakCount - b.weakCount;
    return a.startSlot - b.startSlot;
  });

  // 裁到 MAX_PLANS，但保证每个目的地至少留一个方案 ——
  // 让用户能看到「换个地方会怎样」，而不是被同一个地方刷屏
  const picked: PlanDto[] = [];
  for (const p of sorted) {
    if (picked.length < MAX_PLANS) {
      picked.push(p);
      continue;
    }
    if (!picked.some((x) => x.destinationId === p.destinationId)) picked.push(p);
  }
  return picked;
}

/**
 * 人少时（< 3 人）不做方案枚举，直接给一张并排对照表。
 * 两三个人的时候，算法算出来的东西人脑一眼就看完了。
 */
function buildSimpleComparison(input: PlannerInput, responded: PlannerParticipant[]): PlanDto[] {
  const out: PlanDto[] = [];
  for (const d of input.destinations) {
    const willing = responded.filter((p) => (d.votes[p.id] ?? 0) >= 1);
    if (willing.length === 0) continue;

    // 缓存每个人的可行窗口，避免在 filter 里重复计算
    const windowsOf = new Map<string, Window[]>();
    for (const p of willing) windowsOf.set(p.id, feasibleWindows(p.availability, d.daysNeeded));

    // 找到所有人都能到的最早窗口
    const first = windowsOf.get(willing[0].id)?.[0];
    if (!first) continue;

    const attendeeIds = willing
      .filter((p) => (windowsOf.get(p.id) ?? []).some((w) => w.start === first.start))
      .map((p) => p.id);

    const attendeeSet = new Set(attendeeIds);
    out.push({
      destinationId: d.id,
      destinationName: d.name,
      daysNeeded: d.daysNeeded,
      startSlot: first.start,
      endSlot: first.end,
      attendeeIds: [...attendeeIds].sort(),
      weakCount: first.weakCount,
      missing: responded
        .filter((p) => !attendeeSet.has(p.id))
        .map((p) => ({
          participantId: p.id,
          name: p.name,
          reason: (d.votes[p.id] ?? 0) >= 1 ? ('busy' as const) : ('unwilling' as const),
        })),
      blocked: false,
      blockedReason: '参与者不足 3 人，直接给出对照表',
    });
  }
  return out;
}
