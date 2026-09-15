import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getName, setName, getParticipation, setParticipation } from '../lib/storage';
import { decodeAvailability } from '../../core/bitmap';
import { allSlotStarts } from '../../core/slots';
import TimeGrid from '../components/TimeGrid';
import DestinationPicker from '../components/DestinationPicker';
import type { AvailabilityLevel, EventDetailResponse, VoteLevel } from '../../shared/types';

export default function FillPage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<EventDetailResponse | null>(null);
  const [name, setNameState] = useState(getName() || search.get('name') || '');
  const [availability, setAvailability] = useState<AvailabilityLevel[]>([]);
  const [votes, setVotes] = useState<Record<string, VoteLevel>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.getEvent(id);
        if (!alive) return;
        setDetail(d);

        // 之前填过就把答案捞回来 —— 免注册的前提下，
        // localStorage 里的 participantId 就是我们能用的认领方式
        const me = getParticipation(id);
        const mine = me ? d.participants.find((p) => p.id === me.participantId) : undefined;

        setAvailability(
          mine && mine.availability
            ? (decodeAvailability(mine.availability, d.slotCount) as AvailabilityLevel[])
            : (new Array(d.slotCount).fill(0) as AvailabilityLevel[]),
        );

        if (me) {
          setNameState(mine?.name ?? me.name);
          const myVotes = Object.fromEntries(
            d.votes.filter((v) => v.participantId === me.participantId).map((v) => [v.destinationId, v.level]),
          ) as Record<string, VoteLevel>;
          setVotes(myVotes);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const filledDays = useMemo(() => availability.filter((v) => v > 0).length, [availability]);

  const slotStarts = useMemo(
    () =>
      detail
        ? allSlotStarts(detail.event.rangeStart, detail.slotCount, detail.event.granularity)
        : [],
    [detail],
  );

  async function ensureJoined(): Promise<string> {
    const existing = getParticipation(id);
    if (existing) return existing.token;
    const r = await api.join(id, name.trim());
    setParticipation(id, { token: r.token, participantId: r.participantId, name: r.name });
    setName(r.name);
    return r.token;
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError('先填个名字吧');
      return;
    }
    if (filledDays === 0) {
      setError('至少涂一天你有空的时间');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const token = await ensureJoined();
      await api.submit(id, {
        token,
        name: name.trim(),
        availability,
        votes: Object.entries(votes).map(([destinationId, level]) => ({ destinationId, level })),
      });
      setDone(true);
      setTimeout(() => navigate(`/e/${id}`), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleNominate(n: string, daysNeeded: number, budgetLevel: number | null) {
    const token = await ensureJoined();
    const created = await api.nominate(id, { token, name: n, daysNeeded, budgetLevel });
    const fresh = await api.getEvent(id);
    setDetail(fresh);
    // 自己提的名，默认就是「想去」
    setVotes((v) => ({ ...v, [created.destinationId]: 2 }));
  }

  if (loading) return <main className="p-6 text-ink-400">加载中…</main>;
  if (error && !detail) return <main className="p-6 text-red-600">{error}</main>;
  if (!detail) return null;

  if (done) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <div className="rounded-[var(--radius-card)] border border-brand-300 bg-brand-100/50 p-6 text-center">
          <p className="text-lg font-medium">填好了 ✓</p>
          <p className="mt-2 text-sm text-ink-600">正在带你去看结果…</p>
        </div>
      </main>
    );
  }

  const participation = getParticipation(id);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-5 pb-32">
      <header>
        <h1 className="text-xl font-semibold">{detail.event.title}</h1>
        <p className="mt-1 text-sm text-ink-600">涂一下你什么时候有空</p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
        <label className="mb-2 block text-sm text-ink-600">
          你的名字
          <input
            value={name}
            onChange={(e) => setNameState(e.target.value)}
            placeholder="群里怎么称呼你"
            className="mt-1.5 w-full rounded-[var(--radius-btn)] border border-ink-200 px-3 py-2 text-base outline-none focus:border-brand-500"
          />
        </label>

        <TimeGrid
          slotCount={detail.slotCount}
          granularity={detail.event.granularity}
          slotStarts={slotStarts}
          value={availability}
          onChange={setAvailability}
        />

        <p className="mt-3 text-xs text-ink-400">
          已涂 {filledDays} / {detail.slotCount} 格
        </p>
      </section>

      {detail.event.collectDestinations && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-ink-600">想去哪儿</h2>
          <DestinationPicker
            destinations={detail.destinations}
            votes={votes}
            onVote={(did, lv) => setVotes((v) => ({ ...v, [did]: lv }))}
            onNominate={handleNominate}
            budgetEnabled={detail.event.budgetEnabled}
          />
        </section>
      )}

      {error && (
        <p className="rounded-[var(--radius-btn)] bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="glass-bar fixed inset-x-0 bottom-0 p-4">
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="btn-solid w-full rounded-[var(--radius-btn)] py-3.5 text-base font-medium text-white disabled:opacity-40"
          >
            {saving ? '提交中…' : participation ? '更新我的时间' : '提交'}
          </button>
        </div>
      </div>
    </main>
  );
}
