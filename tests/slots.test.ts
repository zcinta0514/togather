import { describe, it, expect } from 'vitest';
import { slotCountFor, slotStartAt, slotRangeLabel } from '../src/core/slots';

const DAY = 86400;
const HALF = 43200;

describe('slotCountFor', () => {
  it('按天粒度，闭区间 10/1–10/7 是 7 格', () => {
    const start = 1759248000; // 2025-10-01 00:00 UTC
    const end = start + 6 * DAY;
    expect(slotCountFor(start, end, 'day')).toBe(7);
  });

  it('按半天粒度，一整天是 2 格', () => {
    const start = 1759248000;
    const end = start + DAY - 1; // 当天 23:59:59，和创建活动时传的一致
    expect(slotCountFor(start, end, 'half_day')).toBe(2);
  });

  it('单日按天粒度是 1 格', () => {
    const start = 1759248000;
    expect(slotCountFor(start, start, 'day')).toBe(1);
  });

  it('范围倒置时返回 0，不抛异常', () => {
    expect(slotCountFor(1000, 500, 'day')).toBe(0);
  });

  it('超过上限时截断到 MAX_SLOTS', () => {
    const start = 1759248000;
    const end = start + 999 * DAY;
    expect(slotCountFor(start, end, 'day')).toBe(180);
  });
});

describe('slotStartAt', () => {
  it('第 0 格就是起点', () => {
    const start = 1759248000;
    expect(slotStartAt(start, 0, 'day')).toBe(start);
  });

  it('第 3 格是按天粒度加 3 天', () => {
    const start = 1759248000;
    expect(slotStartAt(start, 3, 'day')).toBe(start + 3 * DAY);
  });

  it('按半天粒度第 3 格是加 1.5 天', () => {
    const start = 1759248000;
    expect(slotStartAt(start, 3, 'half_day')).toBe(start + 3 * HALF);
  });
});

describe('slotRangeLabel', () => {
  it('单格按天粒度显示为一天', () => {
    const start = 1759248000;
    expect(slotRangeLabel(start, 0, 0, 'day')).toBe('10月1日');
  });

  it('多格按天粒度显示为区间', () => {
    const start = 1759248000;
    expect(slotRangeLabel(start, 0, 6, 'day')).toBe('10月1日 – 10月7日');
  });

  it('按半天粒度区分上午下午', () => {
    const start = 1759248000;
    expect(slotRangeLabel(start, 0, 0, 'half_day')).toBe('10月1日 上午');
    expect(slotRangeLabel(start, 1, 1, 'half_day')).toBe('10月1日 下午');
    expect(slotRangeLabel(start, 2, 2, 'half_day')).toBe('10月2日 上午');
    expect(slotRangeLabel(start, 3, 3, 'half_day')).toBe('10月2日 下午');
  });
});
