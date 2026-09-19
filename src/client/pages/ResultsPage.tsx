import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, parseFinalizedPlan } from '../lib/api';
import { getParticipation, getAdminKey } from '../lib/storage';
import { slotRangeLabel } from '../../core/slots';
import PlanCard from '../components/PlanCard';
import Heatmap from '../components/Heatmap';
import type { PlanDto, ResultsPageDetail, ResultsResponse } from '../../shared/types';

/** 默认展示几个方案，其余的折叠。列表短才看得下去。 */
const DEFAULT_VISIBLE_PLANS = 3;

export default function ResultsPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<ResultsPageDetail | null>(null);
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showCore, setShowCore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState('');

  const adminKey = getAdminKey(id);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setDetail(null);
    setResults(null);
    try {
      const page = await api.resultsPage(id);
      setDetail(page.detail);
      setResults(page.results);
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

  async function handleFinalize(plan: PlanDto) {
    if (!adminKey) return;
    // 忙标记必须带上目的地：不同目的地常常共享同一个起始槽位
    // （10/5–10/7 去莫干山、10/5–10/7 去千岛湖），只按槽位做 key
    // 会让点其中一个的时候，另一个也变成「定案中…」并被禁用。
    setBusy(`final-${plan.destinationId}-${plan.startSlot}`);
    try {
      await api.finalize(id, {
        adminKey,
        destinationId: plan.destinationId,
        startSlot: plan.startSlot,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '定案失败');
    } finally {
      setBusy('');
    }
  }

  async function toggleCore(participantId: string, next: boolean) {
    if (!adminKey) return;
    setBusy(`core-${participantId}`);
    try {
      await api.setCore(id, participantId, { adminKey, isCore: next });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '标记失败');
    } finally {
      setBusy('');
    }
  }

  if (loading) return <main className="p-6 text-ink-400">加载中…</main>;
  if (!detail || !results) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-5">
        {detail && <h1 className="text-xl font-semibold">{detail.event.title}</h1>}
        <div className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-700">{error || '结果暂时加载失败'}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 rounded-[var(--radius-btn)] border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 transition hover:border-red-500"
          >
            重试
          </button>
        </div>
      </main>
    );
  }

  const participation = getParticipation(id);
  const finalized = parseFinalizedPlan(detail.event.finalizedPlan);
  const progress = results.totalCount
    ? Math.round((results.respondedCount / results.totalCount) * 100)
    : 0;

  const responded = detail.participants.filter((p) => p.respondedAt !== null);
  const coreNames = responded.filter((p) => p.isCore).map((p) => p.name);

  const visible = showAll ? results.plans : results.plans.slice(0, DEFAULT_VISIBLE_PLANS);
  const hiddenCount = results.plans.length - visible.length;

  /**
   * 一个方案都没有，原因不止一种。
   *
   * 方案是由【目的地】驱动的，所以「压根没收集目的地」和「收集了但没人提名」
   * 这两种情况也会走到空列表。这时候说「凑不出共同时间」是错的 ——
   * 时间从来就没被拿去算过。组织者会照着这句话去放宽日期范围，
   * 而真正该改的是设置，白折腾一圈还找不到原因。
   */
  const emptyState = !detail.event.collectDestinations
    ? {
        title: '这个活动没有收集目的地',
        hint: '没有候选地点就没有方案可算。上面的进度是大家填时间的统计，先看那个。',
      }
    : detail.destinations.length === 0
      ? {
          title: '还没人提名要去哪儿',
          hint: '在填写页提名一个想去的地方、填上大概要去几天，这里就能算出方案了。',
        }
      : {
          title: '这段时间内凑不出共同时间',
          hint: '建议把时间范围放宽一点，或者再等等还没填的人。',
        };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-5 pb-16">
      <header className="rise-in space-y-3">
        <h1 className="text-xl font-semibold">{detail.event.title}</h1>

        {finalized ? (
          <Link
            to={`/e/${id}/final`}
            className="glass glass-edge block rounded-[var(--radius-card)] border-brand-300 p-4 transition"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-brand-700">✓ 已定案</div>
                <div className="mt-1 font-medium">
                  {slotRangeLabel(
                    detail.event.rangeStart,
                    finalized.startSlot,
                    finalized.endSlot,
                    detail.event.granularity,
                  )}
                  <span className="ml-2 text-ink-600">· {finalized.destinationName}</span>
                </div>
                <div className="mt-1 text-xs text-ink-400">
                  {finalized.attendeeNames.length} 人 · 点开看出行卡
                </div>
              </div>
              <span className="text-brand-600">→</span>
            </div>
          </Link>
        ) : (
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
        )}

        {!participation && !finalized && (
          <Link
            to={`/e/${id}/fill`}
            className="block rounded-[var(--radius-btn)] border border-brand-300 bg-brand-100/40 px-4 py-3 text-center text-sm text-brand-700"
          >
            你还没填，点这里涂一下你的时间 →
          </Link>
        )}
      </header>

      {/* 核心成员：只有发起人能改。
          放在方案列表【上面】—— 改完立刻能看到下面的排序怎么变，
          如果放在最底下，用户勾完之后还要往上翻才知道发生了什么。 */}
      {adminKey && responded.length >= 2 && (
        <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
          <button
            type="button"
            onClick={() => setShowCore((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-sm font-medium text-ink-600">
              核心成员
              {coreNames.length > 0 && (
                <span className="ml-2 font-normal text-brand-600">已标 {coreNames.length} 人</span>
              )}
            </span>
            <span className="text-xs text-ink-400">{showCore ? '收起 ▴' : '设置 ▾'}</span>
          </button>

          {showCore && (
            <>
              <p className="mt-3 text-xs leading-relaxed text-ink-400">
                标出「这次必须有谁」。标上的人到不了的方案会沉到后面 ——
                适合有那么一两个主心骨、缺了就不成局的场合。不标就等于没有核心。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {responded.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy === `core-${p.id}`}
                    onClick={() => toggleCore(p.id, !p.isCore)}
                    className={[
                      'rounded-full border px-3.5 py-1.5 text-sm transition disabled:opacity-40',
                      p.isCore
                        ? 'border-brand-700 bg-brand-500 text-white'
                        : 'border-ink-200 text-ink-600 hover:border-ink-400',
                    ].join(' ')}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink-600">
          {finalized ? '当时考虑过的方案' : '能执行的方案'}
        </h2>

        {results.plans.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-6 text-center">
            <p className="text-sm text-ink-600">{emptyState.title}</p>
            <p className="mt-2 text-xs text-ink-400">{emptyState.hint}</p>
          </div>
        ) : (
          <>
            {visible.map((plan, i) => {
              const isFinalized =
                finalized?.destinationId === plan.destinationId &&
                finalized.startSlot === plan.startSlot;
              return (
                <div
                  key={`${plan.destinationId}-${plan.startSlot}`}
                  className="plan-in"
                  style={{ animationDelay: `${Math.min(i * 70, 350)}ms` }}
                >
                  <PlanCard
                    plan={plan}
                    rank={i}
                    participants={detail.participants}
                    rangeStart={detail.event.rangeStart}
                    granularity={detail.event.granularity}
                    anonymity={detail.event.anonymity}
                    expanded={expanded === i}
                    detailsId={`plan-details-${i}`}
                    onExpand={() => setExpanded(expanded === i ? null : i)}
                  />

                  {/* 定案按钮放在卡片外面，和查看热力图保持两个独立操作。 */}
                  {adminKey && !finalized && (
                    <div className="mt-1.5 flex justify-end">
                      <button
                        type="button"
                        disabled={busy === `final-${plan.destinationId}-${plan.startSlot}`}
                        onClick={() => handleFinalize(plan)}
                        className="rounded-[var(--radius-btn)] px-3 py-1.5 text-xs text-ink-400 transition hover:bg-brand-100 hover:text-brand-700 disabled:opacity-40"
                      >
                        {busy === `final-${plan.destinationId}-${plan.startSlot}`
                          ? '定案中…'
                          : '定这个 →'}
                      </button>
                    </div>
                  )}

                  {isFinalized && (
                    <p className="mt-1.5 text-right text-xs text-brand-600">✓ 就是它</p>
                  )}

                  <div
                    id={`plan-details-${i}`}
                    hidden={expanded !== i}
                    className="mt-2 rounded-[var(--radius-card)] border border-ink-200 bg-white p-4"
                  >
                    {expanded === i && (
                      <Heatmap
                        participants={detail.participants}
                        slotCount={results.slotCount}
                        granularity={detail.event.granularity}
                        rangeStart={detail.event.rangeStart}
                        slotStarts={results.slotStarts}
                      />
                    )}
                  </div>
                </div>
              );
            })}

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

      {error && (
        <p className="rounded-[var(--radius-btn)] bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <Link
        to="/my"
        className="block pt-2 text-center text-xs text-ink-400 transition hover:text-brand-600"
      >
        我发起的活动 →
      </Link>
    </main>
  );
}
