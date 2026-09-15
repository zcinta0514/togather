import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { events, participants, destinations } from '../schema';
import { getDb, type Env } from '../db';
import { shortId, now } from '../ids';
import type { NominateDestinationRequest } from '../../shared/types';

export const destinationsRoute = new Hono<{ Bindings: Env }>();

/** 提名一个目的地 */
destinationsRoute.post('/api/events/:id/destinations', async (c) => {
  const db = getDb(c.env);
  const eventId = c.req.param('id');
  const body = await c.req.json<NominateDestinationRequest>();

  const rows = await db
    .select()
    .from(participants)
    .where(eq(participants.token, body.token))
    .limit(1);
  if (rows.length === 0 || rows[0].eventId !== eventId) {
    return c.json({ error: '凭证无效，请重新打开链接' }, 403);
  }

  const name = body.name?.trim();
  if (!name) return c.json({ error: '目的地名称不能为空' }, 400);
  if (!Number.isInteger(body.daysNeeded) || body.daysNeeded < 1) {
    return c.json({ error: '需要几天必须是正整数' }, 400);
  }

  const eventRows = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (eventRows.length === 0) return c.json({ error: '活动不存在' }, 404);
  if (eventRows[0].collectDestinations === false) {
    return c.json({ error: '这个活动不收集目的地' }, 400);
  }

  // 同名合并：不新建，避免「大理」和「大理 」变成两个选项
  const existing = await db.select().from(destinations).where(eq(destinations.eventId, eventId));
  const dup = existing.find((d) => d.name === name);
  if (dup) return c.json({ destinationId: dup.id, name: dup.name, merged: true });

  const id = shortId(8);
  await db.insert(destinations).values({
    id,
    eventId,
    name,
    daysNeeded: body.daysNeeded,
    budgetLevel: body.budgetLevel ?? null,
    createdBy: rows[0].id,
    createdAt: now(),
  });

  return c.json({ destinationId: id, name, merged: false });
});
