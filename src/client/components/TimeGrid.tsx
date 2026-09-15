import { useRef } from 'react';
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

const LEVEL_CLASS: Record<AvailabilityLevel, string> = {
  0: 'bg-ink-100 border-ink-200',
  1: 'bg-warm-400 border-warm-600',
  2: 'bg-brand-500 border-brand-700',
};

/** 北京时间下的「月/日」标签 */
function dayLabel(ts: number): string {
  const d = new Date((ts + 8 * 3600) * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function periodLabel(ts: number): string {
  return ts % 86400 === 0 ? '上午' : '下午';
}

/** 点一下的循环：可以 → 勉强 → 不行 → 可以 */
function nextLevel(cur: AvailabilityLevel): AvailabilityLevel {
  return cur === 2 ? 1 : cur === 1 ? 0 : 2;
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
   * 为什么必须这样：一次拖拽会在极短时间内连发多个 pointermove。
   * 如果每次都读 props 里的 value，那么同一个渲染周期内的几次修改
   * 都基于同一份旧数组 —— 后一次会把前一次覆盖掉，只有最后一次生效。
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

  const paintFrom = (clientX: number, clientY: number) => {
    // 用坐标命中测试而不是 pointerenter：
    // 容器 setPointerCapture 之后，所有指针事件都归容器，
    // 单个格子的 pointerenter 根本不会触发。
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const raw = el?.dataset?.idx;
    if (raw === undefined) return;
    setCell(Number(raw), dragValue.current);
  };

  const columns = Math.min(slotCount, 14);

  return (
    <div
      className="select-none pt-5"
      style={{ touchAction: readOnly ? 'auto' : 'none' }}
      onPointerDown={(e) => {
        if (readOnly) return;
        e.preventDefault();
        try {
          // 捕获指针，这样手指划出网格再划回来也能继续涂。
          // 某些环境（合成事件、部分浏览器）不支持捕获会抛异常 ——
          // 不兜住的话整个 pointerdown 会中断，格子就彻底点不动了。
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
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: slotCount }, (_, i) => {
          const ts = slotStarts[i] ?? 0;
          const level = value[i] ?? 0;
          const label =
            granularity === 'half_day' ? `${dayLabel(ts)}${periodLabel(ts)}` : dayLabel(ts);

          if (readOnly) {
            const ratio = heat ? (heat[i] ?? 0) : 0;
            const n = counts ? (counts[i] ?? 0) : null;
            return (
              <div
                key={i}
                title={`${label}：${Math.round(ratio * 100)}%`}
                className="relative flex aspect-square items-center justify-center rounded-md"
                style={{
                  background:
                    ratio === 0
                      ? 'var(--color-ink-100)'
                      : `color-mix(in srgb, var(--color-brand-500) ${Math.round(ratio * 100)}%, var(--color-ink-100))`,
                }}
              >
                <span className="pointer-events-none absolute inset-x-0 -top-4 text-center text-[10px] text-ink-400">
                  {label}
                </span>
                {/* 人数直接写出来。只靠颜色深浅，「3/4」和「4/4」几乎看不出区别，
                    而且手机上根本没有 hover 可以补足。 */}
                {n !== null && n > 0 && (
                  <span className="text-[11px] font-semibold text-white/95">{n}</span>
                )}
              </div>
            );
          }

          return (
            <button
              key={i}
              type="button"
              data-idx={i}
              aria-label={`${label} ${['不行', '勉强', '可以'][level]}`}
              className={[
                'relative aspect-square cursor-pointer rounded-md border transition',
                LEVEL_CLASS[level],
              ].join(' ')}
            >
              <span className="pointer-events-none absolute inset-x-0 -top-4 text-center text-[10px] text-ink-400">
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {!readOnly && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-600">
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
