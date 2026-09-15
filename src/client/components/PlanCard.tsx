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
  onExpand: () => void;
}

export default function PlanCard({
  plan,
  rank,
  participants,
  rangeStart,
  granularity,
  anonymity,
  onExpand,
}: Props) {
  const nameOf = useMemo(() => {
    const m = new Map(participants.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) ?? '未知';
  }, [participants]);

  const isChampion = rank === 0 && !plan.blocked;
  const busy = plan.missing.filter((m) => m.reason === 'busy');
  const unwilling = plan.missing.filter((m) => m.reason === 'unwilling');

  return (
    <button
      type="button"
      onClick={onExpand}
      className={[
        'block w-full rounded-[var(--radius-card)] border p-4 text-left transition',
        isChampion
          ? 'border-brand-500 bg-brand-100/50 ring-1 ring-brand-500'
          : 'border-ink-200 bg-white hover:border-ink-400',
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

      {(busy.length > 0 || unwilling.length > 0) && (
        <p className="mt-1 text-xs text-ink-400">
          ✕ {busy.map((m) => `${nameOf(m.participantId)}（没空）`).join('　')}
          {busy.length > 0 && unwilling.length > 0 ? '　' : ''}
          {/* 意愿匿名时不点名，只说人数 —— 有些话匿名才说得出口 */}
          {anonymity === 'vote_anonymous'
            ? unwilling.length > 0
              ? `另有 ${unwilling.length} 人不想去`
              : ''
            : unwilling.map((m) => `${nameOf(m.participantId)}（不想去）`).join('　')}
        </p>
      )}

      {plan.weakCount > 0 && (
        <p className="mt-1 text-[11px] text-ink-400">其中 {plan.weakCount} 格是「勉强」</p>
      )}
    </button>
  );
}
