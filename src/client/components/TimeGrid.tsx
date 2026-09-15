import { Fragment, useRef } from 'react';
import type { AvailabilityLevel, Granularity } from '../../shared/types';

interface Props {
  slotCount: number;
  granularity: Granularity;
  slotStarts: number[]; // 每格起始时刻（Unix 秒）
  value: AvailabilityLevel[];
  onChange: (next: AvailabilityLevel[]) => void;
  /** 只读模式：结果页看别人涂的 */
  readOnly?: boolean;
  /** 只读模式下每格显示的人数占比 0–1 */
  heat?: number[];
  /** 只读模式下每格显示的具体人数 —— 颜色不该是唯一的信息载体 */
  counts?: number[];
}

/**
 * 一行放几天。
 *
 * 曾经是写死 14 列的平铺，结果 320px 屏幕上每格只剩 13.8px ——
 * 远低于 44px 的触控下限，点都点不准；而且折行之后每个格子的日期标签
 * 是绝对定位在格子上方的，第二行开始正好压在上一行的格子上。
 *
 * 改成「每天一列、一周一行」：每列约 36px 可点，日期标签放在列顶，
 * 折行时不会压到上一行。顺带也更符合人对日程的直觉。
 */
const DAYS_PER_ROW = 7;

const PERIODS = ['早', '午'];

// 「可以」和「勉强」用渐变 + 内高光做出微微凸起的果冻感（见 index.css）。
// 「不行」保持扁平 —— 它是底色，不该有存在感。
const LEVEL_CLASS: Record<AvailabilityLevel, string> = {
  0: 'bg-ink-100 border-ink-200 cell-jelly',
  1: 'cell-lv1 cell-jelly',
  2: 'cell-lv2 cell-jelly',
};

/** 入场动画的错峰延迟，封顶 600ms —— 90 格不能让最后一个等两秒 */
const enterDelay = (i: number) => `${Math.min(i * 18, 600)}ms`;

/** 北京时间下的「月/日」 */
function partsOf(ts: number) {
  const d = new Date((ts + 8 * 3600) * 1000);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 点一下的循环：可以 → 勉强 → 不行 → 可以 */
function nextLevel(cur: AvailabilityLevel): AvailabilityLevel {
  return cur === 2 ? 1 : cur === 1 ? 0 : 2;
}

/** 生成 n 个占位格子，用来把不满一周的最后一行补齐 */
function filler(n: number) {
  return Array.from({ length: Math.max(0, n) }, (_, i) => <div key={`gap-${i}`} />);
}

export default function TimeGrid({
  slotCount,
  granularity,
  slotStarts,
  value,
  onChange,
  readOnly = false,
  heat,
  counts,
}: Props) {
  const dragging = useRef(false);
  // 一次拖拽里所有划过的格子统一设成同一个值。
  // 否则「想涂可以」的拖拽会在碰到已有的「可以」时把它循环成「不行」。
  const dragValue = useRef<AvailabilityLevel>(2);

  /**
   * 组件内部维护一份「最新值」，不等 React 回传。
   *
   * 一次拖拽会在极短时间内连发多个 pointermove。如果每次都读 props 里的 value，
   * 同一个渲染周期内的几次修改都基于同一份旧数组 —— 后一次会覆盖前一次，
   * 表现就是「划过去只涂上了最后一格」。
   */
  const valueRef = useRef(value);
  valueRef.current = value;

  const setCell = (index: number, level: AvailabilityLevel) => {
    const cur = valueRef.current;
    if (cur[index] === level) return;
    const next = [...cur];
    next[index] = level;
    valueRef.current = next; // 立刻生效，供下一次连涂读取
    onChange(next);
  };

  const slotsPerDay = granularity === 'day' ? 1 : 2;
  const dayCount = Math.ceil(slotCount / slotsPerDay);

  // 把「天」按 DAYS_PER_ROW 切成若干行
  const weeks: number[][] = [];
  for (let d = 0; d < dayCount; d += DAYS_PER_ROW) {
    weeks.push(
      Array.from({ length: Math.min(DAYS_PER_ROW, dayCount - d) }, (_, k) => d + k),
    );
  }

  const paintFrom = (clientX: number, clientY: number) => {
    // 用坐标命中测试而不是 pointerenter：
    // 容器 setPointerCapture 之后所有指针事件都归容器，单个格子的 pointerenter 不会触发
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const raw = el?.dataset?.idx;
    if (raw === undefined) return;
    setCell(Number(raw), dragValue.current);
  };

  return (
    <div
      className="select-none"
      style={{ touchAction: readOnly ? 'auto' : 'none' }}
      onPointerDown={(e) => {
        if (readOnly) return;
        e.preventDefault();
        try {
          // 捕获指针，这样手指划出网格再划回来也能继续涂。
          // 某些环境不支持捕获会抛异常 —— 不兜住的话整个 pointerdown 会中断
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* 退化成普通拖拽：指针在容器内时依然能连涂 */
        }
        const idx = (e.target as HTMLElement).dataset?.idx;
        if (idx === undefined) return;
        dragging.current = true;
        dragValue.current = nextLevel(valueRef.current[Number(idx)] ?? 0);
        setCell(Number(idx), dragValue.current);
      }}
      onPointerMove={(e) => {
        if (!dragging.current || readOnly) return;
        paintFrom(e.clientX, e.clientY);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {weeks.map((days, wi) => {
        const firstTs = slotStarts[days[0] * slotsPerDay] ?? 0;
        const prevTs = wi > 0 ? (slotStarts[weeks[wi - 1][0] * slotsPerDay] ?? 0) : null;
        const thisMonth = partsOf(firstTs).month;
        // 跨月时标出月份，否则 30 天以上找不到北
        const monthChanged = prevTs === null || partsOf(prevTs).month !== thisMonth;

        return (
          <div key={wi} className={wi > 0 ? 'mt-5' : ''}>
            {monthChanged && (
              <div className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-400">
                {thisMonth} 月
              </div>
            )}

            <div
              className="grid gap-x-1 gap-y-1"
              style={{ gridTemplateColumns: `auto repeat(${DAYS_PER_ROW}, minmax(0, 1fr))` }}
            >
              {/* 表头：空角 + 每天的日期。
                  末尾必须补齐空格子 —— CSS Grid 是自动排布的，
                  如果这一行不满 8 列，下一组的元素会被填进同一行的空位。
                  最后一周只有 3 天时就会看到「早」标签跑进日期那一行。 */}
              <div />
              {days.map((d, di) => {
                const p = partsOf(slotStarts[d * slotsPerDay] ?? 0);
                // 一周跨月时，新月份的头一天要带上月份 ——
                // 否则「10/28–11/3」那一行里的 1、2、3 会让人以为是 10 月
                const showMonth =
                  p.day === 1 || (di === 0 && wi > 0 && partsOf(firstTs).month !== thisMonth);
                return (
                  <div
                    key={d}
                    className={[
                      'pb-1 text-center leading-none',
                      showMonth ? 'text-[10px] font-medium text-ink-600' : 'text-[11px] text-ink-400',
                    ].join(' ')}
                  >
                    {showMonth ? `${p.month}/${p.day}` : p.day}
                  </div>
                );
              })}
              {filler(DAYS_PER_ROW - days.length)}

              {/* 按天粒度只有一行；按半天有两行，左侧标「早 / 午」 */}
              {Array.from({ length: slotsPerDay }, (_, k) => (
                <Fragment key={k}>
                  <div className="flex items-center pr-1.5 text-[11px] leading-none text-ink-400">
                    {slotsPerDay > 1 ? PERIODS[k] : ''}
                  </div>

                  {days.map((d) => {
                    const i = d * slotsPerDay + k;
                    if (i >= slotCount) return <div key={d} />;

                    if (readOnly) {
                      const ratio = heat ? (heat[i] ?? 0) : 0;
                      const n = counts ? (counts[i] ?? 0) : null;
                      return (
                        <div
                          key={d}
                          className="cell-jelly flex aspect-square min-h-8 items-center justify-center rounded-md text-[11px] font-semibold text-white/95"
                          style={{
                            background:
                              ratio === 0
                                ? 'var(--color-ink-100)'
                                : `color-mix(in srgb, var(--color-brand-500) ${Math.round(ratio * 100)}%, var(--color-ink-100))`,
                          }}
                        >
                          {n !== null && n > 0 ? n : ''}
                        </div>
                      );
                    }

                    const level = value[i] ?? 0;
                    const { day } = partsOf(slotStarts[i] ?? 0);
                    const period = slotsPerDay > 1 ? ` ${PERIODS[k]}` : '';
                    return (
                      <button
                        key={d}
                        type="button"
                        data-idx={i}
                        aria-label={`${thisMonth}月${day}日${period} ${['不行', '勉强', '可以'][level]}`}
                        style={{ animationDelay: enterDelay(i) }}
                        className={[
                          'cell-enter relative aspect-square min-h-8 cursor-pointer rounded-md border transition',
                          LEVEL_CLASS[level],
                        ].join(' ')}
                      />
                    );
                  })}
                  {filler(DAYS_PER_ROW - days.length)}
                </Fragment>
              ))}
            </div>
          </div>
        );
      })}

      {!readOnly && (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-600">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-brand-700 bg-brand-500" /> 可以
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-warm-600 bg-warm-400" /> 勉强
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-ink-200 bg-ink-100" /> 不行
          </span>
          <span className="text-ink-400">点一下切换，按住划过去可以连涂</span>
        </div>
      )}
    </div>
  );
}
