import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, parseFinalizedPlan } from '../lib/api';
import { getAdminKey } from '../lib/storage';
import { downloadTextFile } from '../lib/download';
import { buildIcs } from '../../core/ics';
import { slotRangeLabel, slotsForDays } from '../../core/slots';
import ShareCard from '../components/ShareCard';
import type { EventDetailResponse } from '../../shared/types';

export default function FinalPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<EventDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false);

  const adminKey = getAdminKey(id);

  const load = useCallback(async () => {
    try {
      setDetail(await api.getEvent(id));
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

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      setError('复制失败，手动选中吧');
    }
  }

  async function handleUnfinalize() {
    if (!adminKey || !detail) return;
    if (!confirm('撤销定案？大家会回到「还没定」的状态。')) return;
    setBusy(true);
    try {
      await api.unfinalize(id, { adminKey });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="p-6 text-ink-400">加载中…</main>;
  if (error && !detail) return <main className="p-6 text-red-600">{error}</main>;
  if (!detail) return null;

  const plan = parseFinalizedPlan(detail.event.finalizedPlan);

  if (!plan) {
    return (
      <main className="mx-auto max-w-2xl space-y-5 p-5">
        <h1 className="text-xl font-semibold">{detail.event.title}</h1>
        <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-6 text-center">
          <p className="text-sm text-ink-600">这次活动还没定下来</p>
          <p className="mt-2 text-xs text-ink-400">
            {adminKey ? '去结果页挑一个方案，点「定这个」' : '等发起人拍板'}
          </p>
        </div>
        <Link
          to={`/e/${id}`}
          className="block rounded-[var(--radius-btn)] border border-ink-200 py-3 text-center text-sm transition hover:border-brand-500 hover:text-brand-600"
        >
          ← 回到方案列表
        </Link>
      </main>
    );
  }

  const { event } = detail;
  const range = slotRangeLabel(event.rangeStart, plan.startSlot, plan.endSlot, event.granularity);
  const link = `${location.origin}/e/${id}`;

  // 窗口长度是【格数】，daysNeeded 是【天数】，按半天粒度时两者差一倍。
  // 拿格数直接跟天数比，会把「窗口正好等于行程」误判成「这几天任选」——
  // 于是卡片上多出一句「任选」，而其实并没有可选的余地。
  const needSlots = slotsForDays(plan.daysNeeded, event.granularity);
  const windowSlots = plan.endSlot - plan.startSlot + 1;
  const flexible = plan.daysNeeded > 0 && windowSlots > needSlots;

  const shareText = [
    `【${event.title}】定啦`,
    `🗓 ${range}${flexible ? `（玩 ${plan.daysNeeded} 天，任选）` : ''}`,
    `📍 ${plan.destinationName}`,
    `👥 ${plan.attendeeNames.join('、')}`,
    '',
    link,
  ].join('\n');

  function downloadIcs() {
    if (!plan) return;
    // 日历要的是具体日期，不是「窗口」。
    // 窗口比行程长时按最早的那几天排 —— 具体哪几天群里定，先占上位置。
    // 同样是格数对格数。按半天粒度时加天数会短一半，
    // 导进日历的提醒就只盖住行程的前半段。
    const icsEnd = plan.daysNeeded > 0 ? plan.startSlot + needSlots - 1 : plan.endSlot;
    const ics = buildIcs({
      eventId: id,
      title: event.title,
      destinationName: plan.destinationName,
      rangeStart: event.rangeStart,
      startSlot: plan.startSlot,
      endSlot: icsEnd,
      granularity: event.granularity,
      attendeeNames: plan.attendeeNames,
      url: link,
      now: Math.floor(Date.now() / 1000),
    });
    // 文件名去掉路径不安全字符
    const safe = event.title.replace(/[\\/:*?"<>|]/g, '_');
    downloadTextFile(`${safe}.ics`, ics, 'text/calendar;charset=utf-8');
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-5 pb-16">
      <ShareCard
        title={event.title}
        plan={plan}
        rangeStart={event.rangeStart}
        granularity={event.granularity}
      />

      <section className="space-y-2.5">
        <button
          type="button"
          onClick={() => copy('text', shareText)}
          className="btn-solid w-full rounded-[var(--radius-btn)] py-3.5 text-base font-medium text-white"
        >
          {copied === 'text' ? '已复制 ✓' : '复制到群里'}
        </button>

        <button
          type="button"
          onClick={downloadIcs}
          className="glass glass-edge w-full rounded-[var(--radius-btn)] py-3.5 text-base transition hover:text-brand-600"
        >
          加进手机日历
        </button>
        <p className="px-1 text-center text-xs text-ink-400">
          加进日历后，到时间手机会自己提醒 —— 不用谁去记着
        </p>
      </section>

      <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-medium text-ink-600">链接</h2>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-[var(--radius-btn)] bg-ink-100 px-3 py-2 text-xs text-ink-600">
            {link}
          </code>
          <button
            type="button"
            onClick={() => copy('link', link)}
            className="shrink-0 rounded-[var(--radius-btn)] border border-ink-200 px-3 py-2 text-xs transition hover:border-brand-500 hover:text-brand-600"
          >
            {copied === 'link' ? '已复制 ✓' : '复制'}
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded-[var(--radius-btn)] bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="flex items-center justify-between pt-1">
        <Link to={`/e/${id}`} className="text-sm text-ink-600 transition hover:text-brand-600">
          ← 看全部方案
        </Link>
        {adminKey && (
          <button
            type="button"
            onClick={handleUnfinalize}
            disabled={busy}
            className="text-sm text-ink-400 transition hover:text-red-600 disabled:opacity-40"
          >
            {busy ? '撤销中…' : '撤销定案'}
          </button>
        )}
      </div>
    </main>
  );
}
