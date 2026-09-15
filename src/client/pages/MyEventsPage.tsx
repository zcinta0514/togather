import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyEvents, forgetMyEvent, type MyEvent } from '../lib/storage';
import { api } from '../lib/api';

export default function MyEventsPage() {
  const [events, setEvents] = useState<MyEvent[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    setEvents(getMyEvents());
  }, []);

  async function remove(e: MyEvent) {
    if (!confirm(`删除「${e.title}」？\n\n所有人填的内容都会一起删掉，没法恢复。`)) return;
    setBusy(e.eventId);
    setError('');
    try {
      await api.removeEvent(e.eventId, { adminKey: e.adminKey });
      forgetMyEvent(e.eventId);
      setEvents(getMyEvents());
    } catch (err) {
      // 服务端删失败（比如活动已经不在了）也把本地记录清掉，
      // 否则这条会永远卡在列表里点不动
      setError(err instanceof Error ? err.message : '删除失败');
      forgetMyEvent(e.eventId);
      setEvents(getMyEvents());
    } finally {
      setBusy('');
    }
  }

  async function copyLink(e: MyEvent) {
    const link = `${location.origin}/e/${e.eventId}/fill`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(e.eventId);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      setError('复制失败，手动复制吧');
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-5 pb-16">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">我发起的活动</h1>
        <Link to="/new" className="text-sm text-brand-600 hover:underline">
          + 新建
        </Link>
      </header>

      {events.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-8 text-center">
          <p className="text-sm text-ink-600">还没有发起过活动</p>
          <Link to="/new" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
            发起第一个 →
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => (
            <li
              key={e.eventId}
              className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4"
            >
              <Link to={`/e/${e.eventId}`} className="block">
                <div className="font-medium">{e.title}</div>
                <div className="mt-1 text-xs text-ink-400">
                  发起于 {new Date(e.createdAt).toLocaleDateString('zh-CN')}
                </div>
              </Link>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => copyLink(e)}
                  className="rounded-[var(--radius-btn)] border border-ink-200 px-3 py-1.5 transition hover:border-brand-500 hover:text-brand-600"
                >
                  {copied === e.eventId ? '已复制 ✓' : '复制填写链接'}
                </button>
                <Link
                  to={`/e/${e.eventId}/final`}
                  className="rounded-[var(--radius-btn)] border border-ink-200 px-3 py-1.5 transition hover:border-brand-500 hover:text-brand-600"
                >
                  出行卡
                </Link>
                <button
                  type="button"
                  disabled={busy === e.eventId}
                  onClick={() => remove(e)}
                  className="ml-auto rounded-[var(--radius-btn)] px-3 py-1.5 text-ink-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  {busy === e.eventId ? '删除中…' : '删除'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="rounded-[var(--radius-btn)] bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <p className="pt-2 text-center text-xs text-ink-400">
        这个列表存在你自己的浏览器里 —— 换设备就看不到了。
        <br />
        想换设备管理，需要把「管理密钥」搬过去，目前还没做这个功能。
      </p>
    </main>
  );
}
