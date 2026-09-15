import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getParticipation } from '../lib/storage';
import PlanCard from '../components/PlanCard';
import Heatmap from '../components/Heatmap';
import type { EventDetailResponse, ResultsResponse } from '../../shared/types';

/** 默认展示几个方案，其余的折叠。列表短才看得下去。 */
const DEFAULT_VISIBLE_PLANS = 3;

export default function ResultsPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<EventDetailResponse | null>(null);
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([api.getEvent(id), api.results(id)]);
      setDetail(d);
      setResults(r);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function copyNudge() {
    if (!results || !detail) return;
    const link = `${location.origin}/e/${id}/fill`;
    const names = results.notResponded.map((p) => p.name).join('、');
    const text = `${detail.event.title} 还差 ${results.notResponded.length} 个人没填（${names}）\n点开涂一下你哪几天有空 👇\n${link}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('复制失败，手动复制地址栏吧');
    }
  }

  if (loading) return <main className="p-6 text-ink-400">加载中…</main>;
  if (error && !detail) return <main className="p-6 text-red-600">{error}</main>;
  if (!detail || !results) return null;

  const participation = getParticipation(id);
  const progress = results.totalCount
    ? Math.round((results.respondedCount / results.totalCount) * 100)
    : 0;

  const visible = showAll ? results.plans : results.plans.slice(0, DEFAULT_VISIBLE_PLANS);
  const hiddenCount = results.plans.length - visible.length;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-5 pb-16">
      <header className="space-y-3">
        <h1 className="text-xl font-semibold">{detail.event.title}</h1>

        <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-600">
              已填 {results.respondedCount} / {results.totalCount} 人
            </span>
            {results.notResponded.length > 0 && (
              <button
                type="button"
                onClick={copyNudge}
                className="rounded-[var(--radius-btn)] border border-ink-200 px-3 py-1.5 text-xs transition hover:border-brand-500 hover:text-brand-600"
              >
                {copied ? '已复制 ✓' : `催剩下 ${results.notResponded.length} 人`}
              </button>
            )}
          </div>

          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {results.notResponded.length > 0 && (
            <p className="mt-2.5 text-xs text-ink-400">
              还没填：{results.notResponded.map((p) => p.name).join('、')}
            </p>
          )}
        </div>

        {!participation && (
          <Link
            to={`/e/${id}/fill`}
            className="block rounded-[var(--radius-btn)] border border-brand-300 bg-brand-100/40 px-4 py-3 text-center text-sm text-brand-700"
          >
            你还没填，点这里涂一下你的时间 →
          </Link>
        )}
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink-600">能执行的方案</h2>

        {results.plans.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-6 text-center">
            <p className="text-sm text-ink-600">这段时间内凑不出共同时间</p>
            <p className="mt-2 text-xs text-ink-400">
              建议把时间范围放宽一点，或者再等等还没填的人
            </p>
          </div>
        ) : (
          <>
            {visible.map((plan, i) => (
              <div key={`${plan.destinationId}-${plan.startSlot}`}>
                <PlanCard
                  plan={plan}
                  rank={i}
                  participants={detail.participants}
                  rangeStart={detail.event.rangeStart}
                  granularity={detail.event.granularity}
                  anonymity={detail.event.anonymity}
                  onExpand={() => setExpanded(expanded === i ? null : i)}
                />
                {expanded === i && (
                  <div className="mt-2 rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
                    <Heatmap
                      participants={detail.participants}
                      slotCount={results.slotCount}
                      granularity={detail.event.granularity}
                      rangeStart={detail.event.rangeStart}
                      slotStarts={results.slotStarts}
                    />
                  </div>
                )}
              </div>
            ))}

            {/* 默认只显示前几个，其余折叠 —— 列表短才看得下去，但一个都没丢 */}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full rounded-[var(--radius-card)] border border-dashed border-ink-400 py-3 text-sm text-ink-600 transition hover:border-brand-500 hover:text-brand-600"
              >
                还有 {hiddenCount} 个方案 ▾
              </button>
            )}
          </>
        )}
      </section>

      {results.unreachable.length > 0 && (
        <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-ink-600">这些地方去不了</h2>
          <ul className="space-y-1.5 text-xs text-ink-400">
            {results.unreachable.map((u) => (
              <li key={u.destinationId}>
                {u.name} —— {u.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
