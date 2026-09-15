import { useState } from 'react';
import type { DestinationRow, VoteLevel } from '../../shared/types';

const LABELS: Record<VoteLevel, string> = { 2: '想去', 1: '都行', 0: '不想去' };
const ORDER: VoteLevel[] = [2, 1, 0];

interface Props {
  destinations: DestinationRow[];
  votes: Record<string, VoteLevel>;
  onVote: (destinationId: string, level: VoteLevel) => void;
  onNominate: (name: string, daysNeeded: number) => Promise<void>;
  budgetEnabled: boolean;
}

export default function DestinationPicker({
  destinations,
  votes,
  onVote,
  onNominate,
  budgetEnabled,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submitNew() {
    if (!name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await onNominate(name.trim(), days);
      setName('');
      setDays(2);
      setAdding(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '提名失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {destinations.length === 0 && !adding && (
        <p className="text-sm text-ink-400">还没人提名地方 —— 你可以是第一个</p>
      )}

      {destinations.map((d) => {
        const cur = votes[d.id];
        return (
          <div key={d.id} className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="font-medium">{d.name}</span>
              <span className="shrink-0 text-xs text-ink-400">
                需要 {d.daysNeeded} 天
                {budgetEnabled && d.budgetLevel ? ` · 预算第 ${d.budgetLevel} 档` : ''}
              </span>
            </div>
            <div className="flex gap-2">
              {ORDER.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => onVote(d.id, lv)}
                  className={[
                    'flex-1 rounded-[var(--radius-btn)] border px-3 py-2 text-sm transition',
                    cur === lv
                      ? lv === 2
                        ? 'border-brand-700 bg-brand-500 text-white'
                        : lv === 1
                          ? 'border-ink-400 bg-ink-100 text-ink-900'
                          : 'border-ink-400 bg-ink-200 text-ink-600'
                      : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400',
                  ].join(' ')}
                >
                  {LABELS[lv]}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {adding ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-brand-300 bg-brand-100/40 p-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="想去哪儿？"
            className="mb-3 w-full rounded-[var(--radius-btn)] border border-ink-200 px-3 py-2 text-base outline-none focus:border-brand-500"
          />
          <label className="mb-3 flex items-center text-xs text-ink-600">
            大概要去几天
            <input
              type="number"
              min={1}
              max={60}
              value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
              className="ml-2 w-16 rounded border border-ink-200 px-2 py-1 text-sm"
            />
          </label>
          {err && <p className="mb-2 text-xs text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitNew}
              disabled={busy || !name.trim()}
              className="rounded-[var(--radius-btn)] bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy ? '提交中…' : '加上'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setErr('');
              }}
              className="rounded-[var(--radius-btn)] border border-ink-200 px-4 py-2 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full rounded-[var(--radius-card)] border border-dashed border-ink-400 py-3 text-sm text-ink-600 transition hover:border-brand-500 hover:text-brand-600"
        >
          + 提一个自己想去的地方
        </button>
      )}
    </div>
  );
}
