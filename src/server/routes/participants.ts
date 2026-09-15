import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { events, participants, destinations, votes } from '../schema';
import { getDb, type Env } from '../db';
import { shortId, secret, now } from '../ids';
import { slotCountFor } from '../../core/slots';
import { encodeAvailability } from '../../core/bitmap';
import type { JoinRequest, JoinResponse, SubmitRequest } from '../../shared/types';

export const participantsRoute = new Hono<{ Bindings: Env }>();

/** 加入活动：新加入或凭 token 回来改 */
participantsRoute.post('/api/events/:id/join', async (c) => {
  const db = getDb(c.env);
  const eventId = c.req.param('id');
  const body = await c.req.json<JoinRequest>();

  if (!body.name?.trim()) return c.json({ error: '名字不能为空' }, 400);

  const eventRows = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (eventRows.length === 0) return c.json({ error: '活动不存在' }, 404);

  // 带 token = 回来改的
  if (body.token) {
    const existing = await db
      .select()
      .from(participants)
      .where(eq(participants.token, body.token))
      .limit(1);
    if (existing.length > 0 && existing[0].eventId === eventId) {
      const p = existing[0];
      const newName = body.name.trim();
      if (p.name !== newName) {
        await db
          .update(participants)
          .set({ name: newName, updatedAt: now() })
          .where(eq(participants.id, p.id));
      }
      return c.json<JoinResponse>({ participantId: p.id, token: p.token, name: newName });
    }
  }

  // 重名处理：同活动里已经有人叫这个名字 → 提示换一个
  const trimmed = body.name.trim();
  const sameName = await db
    .select()
    .from(participants)
    .where(and(eq(participants.eventId, eventId), eq(participants.name, trimmed)));
  if (sameName.length > 0) {
    return c.json({ error: '这个活动里已经有人叫这个名字了，换一个吧' }, 409);
  }

  const id = shortId(8);
  const token = secret(24);
  await db.insert(participants).values({
    id,
    eventId,
    name: trimmed,
    token,
    isCore: false,
    availability: '',
    respondedAt: null,
    updatedAt: now(),
  });

  return c.json<JoinResponse>({ participantId: id, token, name: trimmed });
});

/** 提交时间与投票 */
participantsRoute.post('/api/events/:id/submit', async (c) => {
  const db = getDb(c.env);
  const eventId = c.req.param('id');
  const body = await c.req.json<SubmitRequest>();

  const rows = await db
    .select()
    .from(participants)
    .where(eq(participants.token, body.token))
    .limit(1);
  if (rows.length === 0 || rows[0].eventId !== eventId) {
    return c.json({ error: '凭证无效，请重新打开链接' }, 403);
  }
  const me = rows[0];

  const eventRows = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (eventRows.length === 0) return c.json({ error: '活动不存在' }, 404);
  const event = eventRows[0];
  const slotCount = slotCountFor(event.rangeStart, event.rangeEnd, event.granularity);

  if (!Array.isArray(body.availability) || body.availability.length !== slotCount) {
    return c.json(
      { error: `需要 ${slotCount} 个时间格，收到 ${body.availability?.length ?? 0} 个` },
      400,
    );
  }
  for (const v of body.availability) {
    if (v !== 0 && v !== 1 && v !== 2) return c.json({ error: '时间格取值必须是 0/1/2' }, 400);
  }

  const ts = now();
  await db
    .update(participants)
    .set({
      name: body.name?.trim() || me.name,
      availability: encodeAvailability(body.availability),
      respondedAt: me.respondedAt ?? ts,
      updatedAt: ts,
    })
    .where(eq(participants.id, me.id));

  // 覆盖式写入投票
  await db.delete(votes).where(eq(votes.participantId, me.id));

  const validLevels = new Set([0, 1, 2]);
  const incoming = (body.votes ?? []).filter((v) => validLevels.has(v.level));
  if (incoming.length > 0) {
    // 只保留确实属于本活动的目的地
    const dests = await db.select().from(destinations).where(eq(destinations.eventId, eventId));
    const okIds = new Set(dests.map((d) => d.id));
    const toInsert = incoming
      .filter((v) => okIds.has(v.destinationId))
      .map((v) => ({ participantId: me.id, destinationId: v.destinationId, level: v.level }));
    if (toInsert.length > 0) await db.insert(votes).values(toInsert);
  }

  return c.json({ ok: true, respondedAt: me.respondedAt ?? ts });
});
