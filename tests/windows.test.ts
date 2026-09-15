import { describe, it, expect } from 'vitest';
import { feasibleWindows } from '../src/core/windows';
import type { AvailabilityLevel } from '../src/shared/types';

const A = (s: string): AvailabilityLevel[] =>
  s.split('').map((c) => (c === '.' ? 0 : c === '~' ? 1 : 2) as AvailabilityLevel);

describe('feasibleWindows', () => {
  it('全空时返回空数组', () => {
    expect(feasibleWindows(A('....'), 2)).toEqual([]);
  });

  it('需要 1 格时，每个非 0 格都是一个窗口', () => {
    expect(feasibleWindows(A('2.2'), 1)).toEqual([
      { start: 0, end: 0, weakCount: 0 },
      { start: 2, end: 2, weakCount: 0 },
    ]);
  });

  it('连续可行时分出多个滑动窗口', () => {
    expect(feasibleWindows(A('222'), 2)).toEqual([
      { start: 0, end: 1, weakCount: 0 },
      { start: 1, end: 2, weakCount: 0 },
    ]);
  });

  it('窗口内遇到 0 就断开', () => {
    expect(feasibleWindows(A('22.22'), 2)).toEqual([
      { start: 0, end: 1, weakCount: 0 },
      { start: 3, end: 4, weakCount: 0 },
    ]);
  });

  it('允许「勉强」但记录数量', () => {
    expect(feasibleWindows(A('2~2'), 3)).toEqual([{ start: 0, end: 2, weakCount: 1 }]);
  });

  it('全是勉强时 weakCount 等于窗口长度', () => {
    expect(feasibleWindows(A('~~~'), 3)).toEqual([{ start: 0, end: 2, weakCount: 3 }]);
  });

  it('需要长度超过数组长度时返回空', () => {
    expect(feasibleWindows(A('222'), 4)).toEqual([]);
  });

  it('需要 0 格时返回空（无意义输入）', () => {
    expect(feasibleWindows(A('222'), 0)).toEqual([]);
  });

  it('空数组返回空', () => {
    expect(feasibleWindows([], 1)).toEqual([]);
  });

  it('刚好卡在末尾的窗口被包含', () => {
    expect(feasibleWindows(A('.22'), 2)).toEqual([{ start: 1, end: 2, weakCount: 0 }]);
  });

  it('同一段连续可行区里所有滑动窗口都返回', () => {
    expect(feasibleWindows(A('2222'), 2)).toEqual([
      { start: 0, end: 1, weakCount: 0 },
      { start: 1, end: 2, weakCount: 0 },
      { start: 2, end: 3, weakCount: 0 },
    ]);
  });

  it('滑动窗口的 weakCount 逐格更新正确（不累加历史）', () => {
    // 窗口 [0,2] 有 2 个勉强；滑到 [1,3] 剩 1 个（左边滑出的也是勉强）
    expect(feasibleWindows(A('~~22'), 3)).toEqual([
      { start: 0, end: 2, weakCount: 2 },
      { start: 1, end: 3, weakCount: 1 },
    ]);
  });
});
