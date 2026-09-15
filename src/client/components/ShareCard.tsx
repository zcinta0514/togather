import type { FinalizedPlan, Granularity } from '../../shared/types';
import { slotRangeLabel } from '../../core/slots';

interface Props {
  title: string;
  plan: FinalizedPlan;
  rangeStart: number;
  granularity: Granularity;
}

/**
 * 出行卡 —— 定案后的最终结果，用来截图发群里。
 *
 * 刻意做得「像一张卡」而不是「一段文字」：群里最容易被看见的是图，
 * 但同时也提供了复制成文字的入口，因为发文字更省事。
 */
export default function ShareCard({ title, plan, rangeStart, granularity }: Props) {
  const range = slotRangeLabel(rangeStart, plan.startSlot, plan.endSlot, granularity);
  const windowDays = plan.endSlot - plan.startSlot + 1;
  // 窗口比行程长 = 这几天里任意一段都能走，要显式说出来，
  // 否则「10月5日 – 10月7日」会被读成「玩三天」
  const flexible = plan.daysNeeded > 0 && windowDays > plan.daysNeeded;

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-brand-300 bg-white">
      <div className="bg-brand-600 px-5 py-4 text-white">
        <div className="text-[11px] uppercase tracking-widest opacity-75">行程已定</div>
        <div className="mt-1 text-xl font-semibold tracking-tight">{title}</div>
      </div>

      <div className="space-y-3.5 px-5 py-5">
        <Row label="时间">
          <span className="font-medium">{range}</span>
          {granularity === 'day' && plan.daysNeeded > 0 && (
            <span className="ml-2 text-ink-400">
              {flexible ? `玩 ${plan.daysNeeded} 天，任选` : `共 ${plan.daysNeeded} 天`}
            </span>
          )}
        </Row>

        <Row label="地点">
          <span className="font-medium">{plan.destinationName}</span>
        </Row>

        <Row label={`${plan.attendeeNames.length} 人`}>
          <span className="text-ink-600">{plan.attendeeNames.join(' · ')}</span>
        </Row>

        {flexible && (
          <p className="border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-400">
            这几天里任意连续 {plan.daysNeeded} 天都能成行，具体哪两天群里定一下。
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 text-sm">
      <span className="w-12 shrink-0 text-ink-400">{label}</span>
      <span>{children}</span>
    </div>
  );
}
