import { useMemo } from 'react';
import type { AvailabilityLevel, PublicParticipant, Granularity } from '../../shared/types';
import { decodeAvailability } from '../../core/bitmap';
import TimeGrid from './TimeGrid';

interface Props {
  participants: PublicParticipant[];
  slotCount: number;
  granularity: Granularity;
  rangeStart: number;
  slotStarts: number[];
}

/** 姓名列表是辅助信息，限制每格的 DOM 数量，避免大群活动展开热力图时膨胀。 */
const MAX_NAMES_PER_SLOT = 12;

/**
 * 只读热力图：颜色深浅 = 能来的人占比。
 * 复用 TimeGrid 的只读模式，避免两套网格代码走形。
 */
export default function Heatmap({
  participants,
  slotCount,
  granularity,
  rangeStart,
  slotStarts,
}: Props) {
  const responded = useMemo(
    () => participants.filter((p) => p.respondedAt !== null),
    [participants],
  );

  const { heat, counts, namesAt } = useMemo(() => {
    const decoded = responded.map((p) => ({
      name: p.name,
      levels: decodeAvailability(p.availability, slotCount) as AvailabilityLevel[],
    }));

    const heat: number[] = [];
    const counts: number[] = [];
    const namesAt: Array<{ labels: string[]; omitted: number }> = [];
    for (let i = 0; i < slotCount; i++) {
      let yesCount = 0;
      let maybeCount = 0;
      const labels: string[] = [];
      for (const d of decoded) {
        const level = d.levels[i];
        if (level === 2) {
          yesCount++;
          if (labels.length < MAX_NAMES_PER_SLOT) labels.push(`${d.name} ✓`);
        } else if (level === 1) {
          maybeCount++;
          if (labels.length < MAX_NAMES_PER_SLOT) labels.push(`${d.name} ~`);
        }
      }
      // 「勉强」算半分 —— 一个人勉强可以，不等于他不来，但也不等于他一定来
      heat.push(
        responded.length ? (yesCount + maybeCount * 0.5) / responded.length : 0,
      );
      // 格子里显示的人数只算「明确可以」的，不把「勉强」算进去 ——
      // 显示「4 人」却只有 3 个人确定能来，是会误导人的
      counts.push(yesCount);
      namesAt.push({
        labels,
        omitted: Math.max(0, yesCount + maybeCount - labels.length),
      });
    }
    return { heat, counts, namesAt };
  }, [responded, slotCount]);

  if (responded.length === 0) {
    return <p className="text-sm text-ink-400">还没人填，热力图暂时是空的</p>;
  }

  return (
    <div>
      <TimeGrid
        slotCount={slotCount}
        granularity={granularity}
        slotStarts={slotStarts}
        value={[]}
        onChange={() => {}}
        readOnly
        heat={heat}
        counts={counts}
      />
      <ul className="mt-8 space-y-1 text-[11px] text-ink-400">
        {namesAt.map((names, i) => {
          if (names.labels.length === 0) return null;
          const ts = slotStarts[i] ?? rangeStart;
          const d = new Date((ts + 8 * 3600) * 1000);
          return (
            <li key={i}>
              <span className="text-ink-600">
                {d.getUTCMonth() + 1}/{d.getUTCDate()}
                {/* 上下午看的是【槽位序号的奇偶】，不是时间戳。
                    rangeStart 是当天 00:00 减去 8 小时，所以任何一格的
                    ts % 86400 只会是 57600 或 14400，永远不等于 0 ——
                    曾经写成 ts % 86400 === 0，结果是每一格都显示「下午」，
                    上午那一格从来没对过。同一个坑 slots.ts 里已经标过注释。 */}
                {granularity === 'half_day' ? (i % 2 === 0 ? ' 上午' : ' 下午') : ''}
              </span>
              ：{names.labels.join('、')}
              {names.omitted > 0 && `　另有 ${names.omitted} 人`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
