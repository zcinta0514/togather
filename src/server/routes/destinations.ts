import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { events, participants, destinations } from '../schema';
import { getDb, type Env } from '../db';
import { shortId, now } from '../ids';
import { MAX_SLOTS } from '../../shared/types';
import type { NominateDestinationRequest } from '../../shared/types';

export const destinationsRoute = new Hono<{ Bindings: Env }>();

/** 目的地名称上限 */
const MAX_DEST_NAME = 30;

/**
 * 一个活动最多提名多少个目的地。
 * 方案计算量跟目的地数量成正比（每个「人×目的地」都要算一遍可行窗口），
 * 而且结果页要一个个渲染 —— 不设上限的话，一个脚本就能把结果页拖垮。
 */
const MAX_DESTINATIONS = 20;

/**
 * 预算档位的合法取值（见设计文档 §5）。
 * ⚠️ 第三份计划要把预算从「三档」改成「具体金额（元）」，
 * 到时候这个集合和 vote/DestinationRow.budgetLevel 的含义都要一起改。
 */
const VALID_BUDGET_LEVELS = [1, 2, 3];

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
  if (name.length > MAX_DEST_NAME) {
    return c.json({ error: `目的地名称太长了，最多 ${MAX_DEST_NAME} 个字` }, 400);
  }
  if (!Number.isInteger(body.daysNeeded) || body.daysNeeded < 1) {
    return c.json({ error: '需要几天必须是正整数' }, 400);
  }
  // 不封顶的话 Number.isInteger(1e21) 也会放行 —— 那个数存进去之后
  // 每次算方案都要为它跑一遍滑动窗口，而它永远不可能成行
  if (body.daysNeeded > MAX_SLOTS) {
    return c.json({ error: `需要几天最多填 ${MAX_SLOTS}` }, 400);
  }
  if (body.budgetLevel != null && !VALID_BUDGET_LEVELS.includes(body.budgetLevel)) {
    return c.json({ error: '预算档位不合法' }, 400);
  }

  const eventRows = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (eventRows.length === 0) return c.json({ error: '活动不存在' }, 404);
  if (eventRows[0].collectDestinations === false) {
    return c.json({ error: '这个活动不收集目的地' }, 400);
  }

  // 同名合并：不新建，避免「大理」和「大理 」变成两个选项。
  // 合并的判断放在数量上限【之前】—— 已经提名过的人再点一次应当照常合并，
  // 不能因为名额满了就被拒绝。
  const existing = await db.select().from(destinations).where(eq(destinations.eventId, eventId));
  const dup = existing.find((d) => d.name === name);
  if (dup) return c.json({ destinationId: dup.id, name: dup.name, merged: true });

  if (existing.length >= MAX_DESTINATIONS) {
    return c.json({ error: `一个活动最多 ${MAX_DESTINATIONS} 个目的地` }, 400);
  }

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
