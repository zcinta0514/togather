import type { AvailabilityLevel, BudgetStats, PlanDto, VoteLevel } from '../shared/types';
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
  budgetStats?: BudgetStats | null;
}

export interface PlannerInput {
  slotCount: number;
  /**
   * 一个自然日占几个槽位（按天 = 1，按半天 = 2）。
   *
   * 必须有这个数，否则没法把参与者的「大概要去几天」换算成算法吃的槽位数。
   * 之前是直接把 daysNeeded 当槽位数用 —— 按天粒度下碰巧是对的，
   * 按半天粒度下就把「2 天」算成了 1 天，而卡片上还写着「2 天」。
   * 做成必填而不是给个默认值 1：默认值会让下一个调用方继续踩同一个坑，
   * 而且踩得毫无声响。
   */
  slotsPerDay: number;
  /** 是否有核心成员，由 participants[].isCore 表达，不需要单独开关 */
  participants: PlannerParticipant[];
  destinations: PlannerDestination[];
}

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

  // 曾经这里有一条「少于 3 人就换成并排对照表」的捷径。那个实现是同一件事的
  // 第二份代码，而且有两处硬伤：只看【第一个投票的人】有没有可行窗口，
  // 他没有就整个目的地作罢（哪怕后面的人都能去）；窗口也只取他最早的那一段。
  // 结果是同一个人换个加入顺序，答案就不一样；而且它给出的方案常常比真正
  // 可行的更小。它唯一多出来的信息 blockedReason 写死在一段 blocked 为 false
  // 的方案上，界面上根本不渲染。
  //
  // 下面这条路径对任意人数都成立，而且被随机差分测试比过 —— 少一份实现就少一类 bug。

  // 「要几天」→「要几格」。换算只在这里发生，后面一律用槽位数。
  const needSlotsFor = (days: number) => days * input.slotsPerDay;

  // 预计算：每个人对每个目的地的可行窗口，按起点索引，方便 O(1) 查
  const windowCache = new Map<string, Map<number, Window>>();
  const candidateStarts = new Set<number>();
  for (const p of responded) {
    for (const d of input.destinations) {
      const byStart = new Map<number, Window>();
      for (const w of feasibleWindows(p.availability, needSlotsFor(d.daysNeeded))) {
        byStart.set(w.start, w);
        candidateStarts.add(w.start);
      }
      windowCache.set(`${p.id}|${d.id}`, byStart);
    }
  }

  const plans: PlanDto[] = [];

  for (const d of input.destinations) {
    const needSlots = needSlotsFor(d.daysNeeded);
    for (const start of candidateStarts) {
      const end = start + needSlots - 1;
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

      // 核心成员：只看【有没有人被标记】。
      //
      // 曾经还有一个 coreOnly 开关，要求「创建时勾选 + 结果页标记」两步都做才生效 ——
      // 而发起人在创建活动时根本不知道会不会用到核心成员，等于埋了个死胡同。
      // 现在只有一个概念：标了谁，谁就是核心；一个都没标，就等于没有核心。
      const cores = responded.filter((p) => p.isCore);
      const missingCores = cores.filter((c) => !attendeeSet.has(c.id));
      const blocked = cores.length > 0 && missingCores.length > 0;

      plans.push({
        destinationId: d.id,
        destinationName: d.name,
        daysNeeded: d.daysNeeded,
        startSlot: start,
        endSlot: end,
        attendeeIds,
        weakCount,
        missing,
        // 匿名时服务端会把 missing 里的 unwilling 条目删掉，
        // 所以数量必须单独带一个字段，不然界面上连「几个」都说不出来
        unwillingCount: missing.filter((m) => m.reason === 'unwilling').length,
        blocked,
        blockedReason: blocked
          ? `核心成员 ${missingCores.map((c) => c.name).join('、')} 到不了`
          : undefined,
        budgetStats: d.budgetStats ?? null,
      });
    }
  }

  return rankAndTrim(dropDominated(mergeAdjacent(plans)));
}

/**
 * 砍掉「被支配」的方案。
 *
 * 方案 X 被方案 Y 支配，当且仅当同时满足：
 *   1. 同一个目的地
 *   2. 受阻状态相同（核心成员到没到）
 *   3. X 的人全都包含在 Y 的人里，且 Y 人更多
 *
 * 为什么可以砍：能去 X 的人一定能去 Y，而 Y 人更多 ——
 * X 没有提供任何 Y 没有的东西，留着只会占位置、干扰视线。
 *
 * 注意这个规则【不会】砍掉「另一个目的地的人少的方案」——
 * 目的地不同就不构成支配。那种方案是取舍的体现，必须留着。
 * （设计文档 §8.2 第 6 步：保证用户能看到「换个地方会怎样」）
 */
function dropDominated(plans: PlanDto[]): PlanDto[] {
  const entries = plans.map((plan) => ({ plan, crowd: new Set(plan.attendeeIds) }));

  const isSubset = (a: Set<string>, b: Set<string>) => {
    for (const x of a) if (!b.has(x)) return false;
    return true;
  };

  return entries
    .filter(
      (x) =>
        !entries.some(
          (y) =>
            y.plan !== x.plan &&
            y.plan.destinationId === x.plan.destinationId &&
            y.plan.blocked === x.plan.blocked &&
            y.crowd.size > x.crowd.size &&
            isSubset(x.crowd, y.crowd),
        ),
    )
    .map((e) => e.plan);
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
