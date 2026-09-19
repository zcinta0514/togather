import { MAX_BUDGET_AMOUNT, type Anonymity, type BudgetStats } from '../shared/types';

export type BudgetAmountParseResult =
  | { ok: true; value: number | null }
  | { ok: false };

/** 把 API 输入收窄成数据库可保存的预算金额。0 和上限值都合法。 */
export function parseBudgetAmount(value: unknown): BudgetAmountParseResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_BUDGET_AMOUNT) {
    return { ok: false };
  }
  return { ok: true, value: value as number };
}

/**
 * 汇总一个目的地的个人预算意愿。
 *
 * totalCount 是该活动的已回应人数；金额数组只放这些人实际填写的值。
 * 无有效金额时返回 null，避免把「没人填」误显示成人均 0 元。
 */
export function calculateBudgetStats(
  amounts: Array<number | null | undefined>,
  totalCount: number,
): BudgetStats | null {
  const sorted = amounts
    .filter(
      (amount): amount is number =>
        typeof amount === 'number' &&
        Number.isInteger(amount) &&
        amount >= 0 &&
        amount <= MAX_BUDGET_AMOUNT,
    )
    .sort((a, b) => a - b);

  if (sorted.length === 0) return null;

  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const average = sorted.reduce((sum, amount) => sum + amount, 0) / sorted.length;

  return {
    median,
    average,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    filledCount: sorted.length,
    totalCount,
    sampleSmall: sorted.length * 2 < totalCount,
  };
}

/**
 * 意愿匿名时，1–2 个样本的聚合值几乎等于公开个人预算，必须隐藏。
 * 三个及以上样本才返回汇总；公开活动不设这个门槛。
 */
export function protectBudgetStats(
  stats: BudgetStats | null,
  anonymity: Anonymity,
): BudgetStats | null {
  if (anonymity === 'vote_anonymous' && stats && stats.filledCount < 3) return null;
  return stats;
}
