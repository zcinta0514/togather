import { GRANULARITY_SECONDS, MAX_SLOTS, type Granularity } from '../shared/types';

/**
 * 闭区间 [rangeStart, rangeEnd] 覆盖多少个槽位。
 * 范围倒置返回 0（不抛异常，让调用方自己决定怎么处理空结果）。
 */
export function slotCountFor(
  rangeStart: number,
  rangeEnd: number,
  granularity: Granularity,
): number {
  if (rangeEnd < rangeStart) return 0;
  const unit = GRANULARITY_SECONDS[granularity];
  const span = rangeEnd - rangeStart + 1;
  return Math.min(Math.ceil(span / unit), MAX_SLOTS);
}

/** 第 index 格的起始时刻（Unix 秒）。 */
export function slotStartAt(
  rangeStart: number,
  index: number,
  granularity: Granularity,
): number {
  return rangeStart + index * GRANULARITY_SECONDS[granularity];
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
