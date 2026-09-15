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
    const namesAt: string[][] = [];
    for (let i = 0; i < slotCount; i++) {
      const yes = decoded.filter((d) => d.levels[i] === 2).map((d) => d.name);
      const maybe = decoded.filter((d) => d.levels[i] === 1).map((d) => d.name);
      // 「勉强」算半分 —— 一个人勉强可以，不等于他不来，但也不等于他一定来
      heat.push(responded.length ? (yes.length + maybe.length * 0.5) / responded.length : 0);
      // 格子里显示的人数只算「明确可以」的，不把「勉强」算进去 ——
      // 显示「4 人」却只有 3 个人确定能来，是会误导人的
      counts.push(yes.length);
      namesAt.push([...yes.map((n) => `${n} ✓`), ...maybe.map((n) => `${n} ~`)]);
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
          if (names.length === 0) return null;
          const ts = slotStarts[i] ?? rangeStart;
          const d = new Date((ts + 8 * 3600) * 1000);
          return (
            <li key={i}>
              <span className="text-ink-600">
                {d.getUTCMonth() + 1}/{d.getUTCDate()}
                {granularity === 'half_day' ? (ts % 86400 === 0 ? ' 上午' : ' 下午') : ''}
              </span>
              ：{names.join('、')}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
