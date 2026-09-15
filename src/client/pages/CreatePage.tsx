import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { addMyEvent } from '../lib/storage';
import type { Anonymity, Granularity } from '../../shared/types';

/** 把 <input type="date"> 的值转成北京时间当天 00:00 的 Unix 秒 */
function beijingMidnight(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 0, 0, 0) / 1000) - 8 * 3600;
}

const FIELD =
  'mt-1.5 w-full rounded-[var(--radius-btn)] border border-ink-200 px-3 py-2.5 text-base outline-none focus:border-brand-500';

const toggles: Array<{
  key: 'collectDestinations' | 'budgetEnabled' | 'coreOnly';
  label: string;
  hint: string;
}> = [
  {
    key: 'collectDestinations',
    label: '收集目的地',
    hint: '大家填想去哪，系统会跟时间一起算',
  },
  {
    key: 'budgetEnabled',
    label: '启用预算维度',
    hint: '每个目的地标个大致花销，避免「不是不想去，是太贵」',
  },
  {
    key: 'coreOnly',
    label: '核心成员模式',
    hint: '标出「必须有谁」，核心到不齐的方案会降到后面',
  },
];

export default function CreatePage() {
  const navigate = useNavigate();
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const [title, setTitle] = useState('');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [flags, setFlags] = useState({
    collectDestinations: true,
    budgetEnabled: false,
    coreOnly: false,
  });
  const [anonymity, setAnonymity] = useState<Anonymity>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!title.trim()) {
      setError('给这次活动起个名字吧');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.createEvent({
        title: title.trim(),
        rangeStart: beijingMidnight(start),
        rangeEnd: beijingMidnight(end) + 86399, // 当天 23:59:59，闭区间
        granularity,
        ...flags,
        anonymity,
      });
      addMyEvent({
        eventId: r.eventId,
        adminKey: r.adminKey,
        title: title.trim(),
        createdAt: Date.now(),
      });
      navigate(`/e/${r.eventId}/fill`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 p-5 pb-32">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">何时何地</h1>
        <p className="mt-1 text-sm text-ink-600">什么时候有空，想去哪里 —— 一起定</p>
      </header>

      <section className="space-y-4 rounded-[var(--radius-card)] border border-ink-200 bg-white p-5">
        <label className="block text-sm text-ink-600">
          活动名称
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：国庆出去玩"
            className={FIELD}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-ink-600">
            从哪天开始
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className={FIELD}
            />
          </label>
          <label className="block text-sm text-ink-600">
            到哪天结束
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={FIELD} />
          </label>
        </div>

        <fieldset className="text-sm text-ink-600">
          <legend>时间填到多细</legend>
          <div className="mt-2 flex gap-2">
            {(
              [
                ['day', '按天'],
                ['half_day', '按半天'],
              ] as [Granularity, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setGranularity(v)}
                className={[
                  'flex-1 rounded-[var(--radius-btn)] border px-3 py-2 transition',
                  granularity === v
                    ? 'border-brand-700 bg-brand-500 text-white'
                    : 'border-ink-200 hover:border-ink-400',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="space-y-3 rounded-[var(--radius-card)] border border-ink-200 bg-white p-5">
        <h2 className="text-sm font-medium text-ink-600">可选设置</h2>

        {toggles.map(({ key, label, hint }) => (
          <label key={key} className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={flags[key]}
              onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.checked }))}
              className="mt-1 h-4 w-4 accent-[var(--color-brand-600)]"
            />
            <span>
              <span className="block text-sm">{label}</span>
              <span className="block text-xs text-ink-400">{hint}</span>
            </span>
          </label>
        ))}

        <fieldset className="pt-1 text-sm text-ink-600">
          <legend>地点意愿是否匿名</legend>
          <div className="mt-2 flex gap-2">
            {(
              [
                ['open', '全实名'],
                ['vote_anonymous', '意愿匿名'],
              ] as [Anonymity, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setAnonymity(v)}
                className={[
                  'flex-1 rounded-[var(--radius-btn)] border px-3 py-2 text-sm transition',
                  anonymity === v
                    ? 'border-brand-700 bg-brand-500 text-white'
                    : 'border-ink-200 hover:border-ink-400',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-400">
            意愿匿名时，「不想去」只显示汇总不点名 —— 有些话匿名才说得出口。
          </p>
        </fieldset>
      </section>

      {error && (
        <p className="rounded-[var(--radius-btn)] bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-ink-200 bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-xl">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="w-full rounded-[var(--radius-btn)] bg-brand-600 py-3.5 text-base font-medium text-white transition active:scale-[.99] disabled:opacity-40"
          >
            {busy ? '创建中…' : '创建并开始填'}
          </button>
        </div>
      </div>
    </main>
  );
}
