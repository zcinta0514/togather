import { useMemo } from 'react';
import type { PlanDto, PublicParticipant, Granularity, Anonymity } from '../../shared/types';
import { slotRangeLabel } from '../../core/slots';

interface Props {
  plan: PlanDto;
  rank: number;
  participants: PublicParticipant[];
  rangeStart: number;
  granularity: Granularity;
  anonymity: Anonymity;
  expanded: boolean;
  detailsId: string;
  onExpand: () => void;
}

export default function PlanCard({
  plan,
  rank,
  participants,
  rangeStart,
  granularity,
  anonymity,
  expanded,
  detailsId,
  onExpand,
}: Props) {
  const nameOf = useMemo(() => {
    const m = new Map(participants.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) ?? '未知';
  }, [participants]);

  const isChampion = rank === 0 && !plan.blocked;
  const busy = plan.missing.filter((m) => m.reason === 'busy');
  const unwilling = plan.missing.filter((m) => m.reason === 'unwilling');
  // 意愿匿名时服务端把「不想去」的人名整条删掉了 —— missing 里查不到他们，
  // 数量只能看 unwillingCount。界面不显示但数据还在的话，这个设置就是摆设。
  const unwillingCount =
    anonymity === 'vote_anonymous' ? plan.unwillingCount : unwilling.length;
  const budget = plan.budgetStats;
  const money = (amount: number) => `¥${Math.round(amount).toLocaleString('zh-CN')}`;

  return (
    <article
      className={[
        'rounded-[var(--radius-card)] border p-4 transition',
        isChampion
          ? 'border-brand-500 bg-brand-100/50 ring-1 ring-brand-500'
          : 'border-ink-200 bg-white',
        plan.blocked ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {isChampion && <span className="mr-1.5">🏆</span>}
          {slotRangeLabel(rangeStart, plan.startSlot, plan.endSlot, granularity)}
          <span className="ml-2 text-ink-600">
            · {plan.destinationName}
            {/* 行程长度必须单独写出来：窗口可能被合并过，
                比行程长，「10月5日–10月7日 · 莫干山」容易被读成玩三天 */}
            {plan.daysNeeded > 0 && (
              <span className="text-ink-400"> {plan.daysNeeded} 天</span>
            )}
          </span>
        </span>
        <span
          className={
            isChampion ? 'shrink-0 text-sm font-semibold text-brand-700' : 'shrink-0 text-sm text-ink-400'
          }
        >
          {plan.attendeeIds.length} 人
        </span>
      </div>

      {plan.blocked && plan.blockedReason && (
        <p className="mt-2 text-xs text-warm-600">⚠ {plan.blockedReason}</p>
      )}

      {plan.attendeeIds.length > 0 && (
        <p className="mt-2 text-xs text-ink-600">
          ✓ {plan.attendeeIds.map(nameOf).join(' · ')}
        </p>
      )}

      {(busy.length > 0 || unwillingCount > 0) && (
        <p className="mt-1 text-xs text-ink-400">
          ✕ {busy.map((m) => `${nameOf(m.participantId)}（没空）`).join('　')}
          {busy.length > 0 && unwillingCount > 0 ? '　' : ''}
          {/* 意愿匿名时不点名，只说人数 —— 有些话匿名才说得出口 */}
          {anonymity === 'vote_anonymous'
            ? unwillingCount > 0
              ? `另有 ${unwillingCount} 人不想去`
              : ''
            : unwilling.map((m) => `${nameOf(m.participantId)}（不想去）`).join('　')}
        </p>
      )}

      {plan.weakCount > 0 && (
        <p className="mt-1 text-[11px] text-ink-400">其中 {plan.weakCount} 格是「勉强」</p>
      )}

      {budget && budget.filledCount > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer list-none text-ink-500 marker:hidden">
            预算上限约{' '}
            <span className="font-medium text-ink-700">{money(budget.median)}</span>
            <span className="text-ink-400">（中位数） · {budget.filledCount}/{budget.totalCount} 人填了</span>
          </summary>
          <div className="mt-1 pl-1 text-[11px] text-ink-400">
            平均 {money(budget.average)} · 范围 {money(budget.min)}–{money(budget.max)}
            {budget.sampleSmall && (
              <p className="mt-0.5 text-warm-600">样本太少，参考意义有限</p>
            )}
          </div>
        </details>
      )}

      <button
        type="button"
        onClick={onExpand}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="mt-3 rounded-[var(--radius-btn)] px-2 py-1 text-xs text-ink-400 transition hover:bg-brand-100 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        {expanded ? '收起大家的时间 ▴' : '查看大家的时间 ▾'}
      </button>
    </article>
  );
}
