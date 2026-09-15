import type { AvailabilityLevel } from '../shared/types';

export interface Window {
  /** 起始槽位（含） */
  start: number;
  /** 结束槽位（含） */
  end: number;
  /** 窗口内「勉强」的格数，用于排序时惩罚 */
  weakCount: number;
}

/**
 * 找出所有长度为 needSlots、且不含「不行」的连续窗口。
 *
 * 允许「勉强」是有意的：真实场景里「我那天可能有点事」不该直接判死，
 * 但要在排序时被惩罚，让更干净的时间排前面。
 *
 * 复杂度 O(n)：一次线性扫描，用滑动窗口同时维护 weak 和 zeros 两个计数。
 */
export function feasibleWindows(
  availability: AvailabilityLevel[],
  needSlots: number,
): Window[] {
  const n = availability.length;
  if (needSlots <= 0 || needSlots > n) return [];

  const out: Window[] = [];
  let weak = 0;
  let zeros = 0;

  // 第一个窗口
  for (let i = 0; i < needSlots; i++) {
    if (availability[i] === 1) weak++;
    else if (availability[i] === 0) zeros++;
  }
  if (zeros === 0) out.push({ start: 0, end: needSlots - 1, weakCount: weak });

  // 逐个右移一格：左边滑出、右边滑入
  for (let start = 1; start + needSlots <= n; start++) {
    const outIdx = start - 1;
    const inIdx = start + needSlots - 1;

    if (availability[outIdx] === 1) weak--;
    else if (availability[outIdx] === 0) zeros--;

    if (availability[inIdx] === 1) weak++;
    else if (availability[inIdx] === 0) zeros++;

    if (zeros === 0) out.push({ start, end: inIdx, weakCount: weak });
  }

  return out;
}
