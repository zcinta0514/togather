import { GRANULARITY_SECONDS, MAX_SLOTS, type Granularity } from '../shared/types';

/**
 * 闭区间 [rangeStart, rangeEnd] 理论上要多少个槽位 —— **不与上限取小**。
 *
 * 单独留这个函数，是为了让调用方能分辨「本来就这么多」和「被上限截断了」。
 * 判断「这个范围是不是太长」时必须用它：拿被截断后的数字去比，
 * 永远比不出超限（180 永远不大于 180）。
 */
export function rawSlotCount(
  rangeStart: number,
  rangeEnd: number,
  granularity: Granularity,
): number {
  if (rangeEnd < rangeStart) return 0;
  const unit = GRANULARITY_SECONDS[granularity];
  return Math.ceil((rangeEnd - rangeStart + 1) / unit);
}

/**
 * 闭区间 [rangeStart, rangeEnd] 覆盖多少个槽位，封顶 MAX_SLOTS。
 * 范围倒置返回 0（不抛异常，让调用方自己决定怎么处理空结果）。
 *
 * ⚠️ 封顶是**静默**的：超出上限时这里返回 180，而 rangeEnd 原样存进库，
 * 于是活动对外说「到 12/31」，界面只画到 6/29。建活动那条路必须先用
 * rawSlotCount 把超限的范围拦下来，不能指望这个函数报错。
 */
export function slotCountFor(
  rangeStart: number,
  rangeEnd: number,
  granularity: Granularity,
): number {
  return Math.min(rawSlotCount(rangeStart, rangeEnd, granularity), MAX_SLOTS);
}

/** 第 index 格的起始时刻（Unix 秒）。 */
export function slotStartAt(
  rangeStart: number,
  index: number,
  granularity: Granularity,
): number {
  return rangeStart + index * GRANULARITY_SECONDS[granularity];
}

/** 一个自然日占几个槽位：按天 = 1，按半天 = 2 */
export function slotsPerDay(granularity: Granularity): number {
  return GRANULARITY_SECONDS.day / GRANULARITY_SECONDS[granularity];
}

/**
 * 「这趟要几天」换算成「要几个连续的槽位」。
 *
 * 这两个数只有在按天粒度下才相等。按半天粒度时一格只有半天，
 * 「2 天」要占 4 格 —— 把天数直接当槽位数用，会把两天的行程算成一天，
 * 而界面上还理直气壮地写着「2 天」。
 *
 * 参与者填的是天（「大概要去几天」），算法吃的是槽位，
 * 换算必须发生在这两者交界的地方，而且只发生一次。
 */
export function slotsForDays(days: number, granularity: Granularity): number {
  return days * slotsPerDay(granularity);
}

const PERIODS = ['上午', '下午'];

/**
 * 槽位区间的人类可读标签。
 * 按天用「10月1日」；按半天用「10月1日 上午/下午」。
 * 固定按 Asia/Shanghai 渲染（跨时区留给二期）。
 */
export function slotRangeLabel(
  rangeStart: number,
  startSlot: number,
  endSlot: number,
  granularity: Granularity,
): string {
  const fmtDay = (ts: number) => {
    const d = new Date((ts + 8 * 3600) * 1000); // 转北京时间再取日期
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  };

  if (granularity === 'day') {
    const a = slotStartAt(rangeStart, startSlot, granularity);
    if (startSlot === endSlot) return fmtDay(a);
    const b = slotStartAt(rangeStart, endSlot, granularity);
    return `${fmtDay(a)} – ${fmtDay(b)}`;
  }

  // half_day：每格 12 小时，用「槽位序号的奇偶」判断上午/下午。
  // 不要用时间戳取模 —— rangeStart 是当天 00:00，槽位 0 才是上午。
  const slotLabel = (i: number) => {
    const ts = slotStartAt(rangeStart, i, granularity);
    const d = new Date((ts + 8 * 3600) * 1000);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${PERIODS[i % 2]}`;
  };
  return startSlot === endSlot
    ? slotLabel(startSlot)
    : `${slotLabel(startSlot)} – ${slotLabel(endSlot)}`;
}

/** 供前端渲染表头：每一格的起始时刻。 */
export function allSlotStarts(
  rangeStart: number,
  slotCount: number,
  granularity: Granularity,
): number[] {
  return Array.from({ length: slotCount }, (_, i) => slotStartAt(rangeStart, i, granularity));
}
