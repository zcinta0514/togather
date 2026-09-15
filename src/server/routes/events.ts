import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { events, participants, destinations, votes } from '../schema';
import { getDb, type Env } from '../db';
import { shortId, secret, hashKey, now } from '../ids';
import { slotCountFor } from '../../core/slots';
import type {
  CreateEventRequest,
  CreateEventResponse,
  EventDetailResponse,
  Granularity,
  VoteLevel,
} from '../../shared/types';

export const eventsRoute = new Hono<{ Bindings: Env }>();

const VALID_GRANULARITY: Granularity[] = ['day', 'half_day'];

/** 建活动 */
eventsRoute.post('/api/events', async (c) => {
  const body = await c.req.json<CreateEventRequest>();

  if (!body.title?.trim()) return c.json({ error: '活动名称不能为空' }, 400);
  if (!Number.isFinite(body.rangeStart) || !Number.isFinite(body.rangeEnd)) {
    return c.json({ error: '时间范围不合法' }, 400);
  }
  if (body.rangeEnd < body.rangeStart) return c.json({ error: '结束日期不能早于开始日期' }, 400);
  if (!VALID_GRANULARITY.includes(body.granularity)) {
    return c.json({ error: '时间粒度不合法' }, 400);
  }
  const slotCount = slotCountFor(body.rangeStart, body.rangeEnd, body.granularity);
  if (slotCount < 1) return c.json({ error: '时间范围太短' }, 400);

  const db = getDb(c.env);
  const id = shortId(6);
  const adminKey = secret(32);

  await db.insert(events).values({
    id,
    title: body.title.trim(),
    rangeStart: body.rangeStart,
    rangeEnd: body.rangeEnd,
    timezone: 'Asia/Shanghai',
    granularity: body.granularity,
    collectDestinations: body.collectDestinations ?? true,
    budgetEnabled: body.budgetEnabled ?? false,
    coreOnly: body.coreOnly ?? false,
    anonymity: body.anonymity ?? 'open',
    adminKeyHash: await hashKey(adminKey),
    finalizedPlan: null,
    createdAt: now(),
  });

  return c.json<CreateEventResponse>({ eventId: id, adminKey });
});

/** 读活动全貌（参与者、目的地、投票） */
eventsRoute.get('/api/events/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');

  const eventRows = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (eventRows.length === 0) return c.json({ error: '活动不存在' }, 404);
  const event = eventRows[0];

  const [participantRows, destinationRows, voteRows] = await Promise.all([
    db.select().from(participants).where(eq(participants.eventId, id)),
    db.select().from(destinations).where(eq(destinations.eventId, id)),
    db.select().from(votes),
  ]);

  // 只保留属于本活动的投票；level 出库是 number，收窄成 VoteLevel
  const destIds = new Set(destinationRows.map((d) => d.id));
  const scopedVotes = voteRows
    .filter((v) => destIds.has(v.destinationId))
    .map((v) => ({ ...v, level: v.level as VoteLevel }));

  return c.json<EventDetailResponse>({
    // 管理密钥哈希绝不出现在响应里
    event: { ...event, adminKeyHash: '' },
    slotCount: slotCountFor(event.rangeStart, event.rangeEnd, event.granularity),
    participants: participantRows,
    destinations: destinationRows,
    votes: scopedVotes,
  });
});
