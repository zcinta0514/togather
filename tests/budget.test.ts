import { describe, expect, it } from 'vitest';
import { calculateBudgetStats, parseBudgetAmount, protectBudgetStats } from '../src/core/budget';
import { MAX_BUDGET_AMOUNT } from '../src/shared/types';

describe('parseBudgetAmount', () => {
  it('接受选填空值和闭区间边界', () => {
    expect(parseBudgetAmount(undefined)).toEqual({ ok: true, value: null });
    expect(parseBudgetAmount(null)).toEqual({ ok: true, value: null });
    expect(parseBudgetAmount(0)).toEqual({ ok: true, value: 0 });
    expect(parseBudgetAmount(MAX_BUDGET_AMOUNT)).toEqual({
      ok: true,
      value: MAX_BUDGET_AMOUNT,
    });
  });

  it.each([-1, 1.5, MAX_BUDGET_AMOUNT + 1, '2000', Number.NaN, Infinity])(
    '拒绝非法或极端金额：%s',
    (value) => {
      expect(parseBudgetAmount(value)).toEqual({ ok: false });
    },
  );
});

describe('calculateBudgetStats', () => {
  it('无金额时返回 null，而不是伪造 0 元统计', () => {
    expect(calculateBudgetStats([null, undefined], 2)).toBeNull();
  });

  it('计算奇数样本的中位数、平均数、范围和填写人数', () => {
    expect(calculateBudgetStats([3000, 1000, null, 2000], 6)).toEqual({
      median: 2000,
      average: 2000,
      min: 1000,
      max: 3000,
      filledCount: 3,
      totalCount: 6,
      sampleSmall: false,
    });
  });

  it('偶数样本取中间两项平均；少于一半标记样本太少', () => {
    expect(calculateBudgetStats([4000, 1000], 5)).toEqual({
      median: 2500,
      average: 2500,
      min: 1000,
      max: 4000,
      filledCount: 2,
      totalCount: 5,
      sampleSmall: true,
    });
  });

  it('忽略数据库中的非法旧值，避免污染统计', () => {
    expect(calculateBudgetStats([-1, 1000, MAX_BUDGET_AMOUNT + 1, 1.5], 4)).toEqual({
      median: 1000,
      average: 1000,
      min: 1000,
      max: 1000,
      filledCount: 1,
      totalCount: 4,
      sampleSmall: true,
    });
  });
});

describe('protectBudgetStats', () => {
  const oneSample = calculateBudgetStats([2000], 4);
  const twoSamples = calculateBudgetStats([2000, 3000], 4);
  const threeSamples = calculateBudgetStats([2000, 3000, 4000], 4);

  it('公开活动即使只有一个样本也返回聚合', () => {
    expect(protectBudgetStats(oneSample, 'open')).toEqual(oneSample);
  });

  it('意愿匿名活动隐藏少于三个样本的预算，避免反推个人金额', () => {
    expect(protectBudgetStats(oneSample, 'vote_anonymous')).toBeNull();
    expect(protectBudgetStats(twoSamples, 'vote_anonymous')).toBeNull();
  });

  it('意愿匿名活动达到三个样本后返回聚合', () => {
    expect(protectBudgetStats(threeSamples, 'vote_anonymous')).toEqual(threeSamples);
  });
});
