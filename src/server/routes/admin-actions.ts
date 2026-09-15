import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { events, participants, destinations, votes } from '../schema';
import { getDb, type Env } from '../db';
import { verifyAdmin, FORBIDDEN } from '../admin';
import { now } from '../ids';
import { slotCountFor, slotsPerDay, slotsForDays } from '../../core/slots';
import { decodeAvailability } from '../../core/bitmap';
import { buildPlans } from '../../core/planner';
import type { VoteLevel } from '../../shared/types';
import type {
  FinalizedPlan,
  FinalizeRequest,
  UnfinalizeRequest,
  SetCoreRequest,
} from '../../shared/types';

/**
 * 只有发起人（持管理密钥）能做的操作：
 * 定案 / 撤销定案 / 标记核心成员 / 删除活动。
 */
export const adminActionsRoute = new Hono<{ Bindings: Env }>();

/** 定案：锁定最终方案，生成一张稳定的出行卡快照 */
adminActionsRoute.post('/api/events/:id/finalize', async (c) => {
  const eventId = c.req.param('id');
  const body = await c.req.json<FinalizeRequest>();

  const event = await verifyAdmin(c.env, eventId, body.adminKey);
  if (!event) return c.json(FORBIDDEN, 403);

  const db = getDb(c.env);
  const destRows = await db
    .select()
    .from(destinations)
    .where(eq(destinations.id, body.destinationId))
    .limit(1);

  // 目的地必须属于这个活动 —— 否则可以拿别的活动的地点来定案
  if (destRows.length === 0 || destRows[0].eventId !== eventId) {
    return c.json({ error: '目的地不存在' }, 404);
  }
  const dest = destRows[0];

  if (!Number.isInteger(body.startSlot) || body.startSlot < 0) {
    return c.json({ error: '时间槽位不合法' }, 400);
  }

  // daysNeeded 是天数，槽位号是格数 —— 按半天粒度时一格只有半天。
  // 直接相加会把要定案的窗口截短一半，下面的「包含」匹配于是匹配不上，
  // 表现是点了「定这个」却报「这个时段凑不出可行方案」。
  const endSlot = body.startSlot + slotsForDays(dest.daysNeeded, event.granularity) - 1;
  const slotCount = slotCountFor(event.rangeStart, event.rangeEnd, event.granularity);

  // 服务端重算一遍，拿真正能来的人 ——
  // 不能直接信客户端传上来的名单，也不能拿全部参与者充数。
  // 只要这个目的地的票 —— 不要 select 全表再过滤，
  // 那样每次定案都要把整个库的票读一遍，而这里是在写路径上
  const [participantRows, voteRows] = await Promise.all([
    db.select().from(participants).where(eq(participants.eventId, eventId)),
    db.select().from(votes).where(eq(votes.destinationId, dest.id)),
  ]);

  const plans = buildPlans({
    slotCount,
    slotsPerDay: slotsPerDay(event.granularity),
    participants: participantRows.map((p) => ({
      id: p.id,
      name: p.name,
      isCore: p.isCore,
      availability: decodeAvailability(p.availability, slotCount),
      responded: p.respondedAt !== null,
    })),
    destinations: [
      {
        id: dest.id,
        name: dest.name,
        daysNeeded: dest.daysNeeded,
        budgetLevel: dest.budgetLevel,
        votes: Object.fromEntries(
          voteRows
            .filter((v) => v.destinationId === dest.id)
            .map((v) => [v.participantId, v.level as VoteLevel]),
        ),
      },
    ],
  });

  // 找覆盖了所请求时段的那个方案。
  // 方案列表里的窗口可能被合并过（比如 10/5–10/7 合成一段），
  // 所以用「包含」而不是「相等」来匹配。
  const match = plans.find(
    (p) =>
      p.destinationId === dest.id && p.startSlot <= body.startSlot && p.endSlot >= endSlot,
  );
  if (!match) {
    return c.json({ error: '这个时段凑不出可行方案，先刷新看看最新结果' }, 409);
  }

  const nameById = new Map(participantRows.map((p) => [p.id, p.name]));
  const plan: FinalizedPlan = {
    destinationId: dest.id,
    destinationName: dest.name,
    // 存【窗口】而不是用户点的那一格 —— 用户看到的是窗口（可能是合并过的），
    // 卡片就该显示同一个东西，不能偷偷截成前两天。
    startSlot: match.startSlot,
    endSlot: match.endSlot,
    daysNeeded: dest.daysNeeded,
    attendeeIds: match.attendeeIds,
    attendeeNames: match.attendeeIds.map((id) => nameById.get(id) ?? '未知'),
    finalizedAt: now(),
  };

  await db
    .update(events)
    .set({ finalizedPlan: JSON.stringify(plan) })
    .where(eq(events.id, eventId));

  return c.json({ ok: true, plan });
});

/** 撤销定案 —— 万一要改主意，路还在 */
adminActionsRoute.post('/api/events/:id/unfinalize', async (c) => {
  const eventId = c.req.param('id');
  const body = await c.req.json<UnfinalizeRequest>();

  const event = await verifyAdmin(c.env, eventId, body.adminKey);
  if (!event) return c.json(FORBIDDEN, 403);

  const db = getDb(c.env);
  await db.update(events).set({ finalizedPlan: null }).where(eq(events.id, eventId));

  return c.json({ ok: true });
});

/**
 * 标记 / 取消核心成员。
 *
 * 只有发起人能改 —— 核心不核心是群体共识，不该由个人自封
 * （四个人全自封「我必须到」就等于没有核心）。
 */
adminActionsRoute.patch('/api/events/:id/participants/:pid', async (c) => {
  const eventId = c.req.param('id');
  const pid = c.req.param('pid');
  const body = await c.req.json<SetCoreRequest>();

  const event = await verifyAdmin(c.env, eventId, body.adminKey);
  if (!event) return c.json(FORBIDDEN, 403);

  const db = getDb(c.env);
  const rows = await db.select().from(participants).where(eq(participants.id, pid)).limit(1);
  if (rows.length === 0 || rows[0].eventId !== eventId) {
    return c.json({ error: '参与者不存在' }, 404);
  }

  await db
    .update(participants)
    .set({ isCore: body.isCore === true, updatedAt: now() })
    .where(eq(participants.id, pid));

  return c.json({ ok: true, isCore: body.isCore === true });
});

/**
 * 删除活动。
 *
 * 参与者、目的地、投票都是外键 cascade，删活动会一起清掉。
 * 用 POST 而不是 DELETE —— 带 body 的 DELETE 会被一些代理和客户端丢掉。
 */
adminActionsRoute.post('/api/events/:id/delete', async (c) => {
  const eventId = c.req.param('id');
  const body = await c.req.json<UnfinalizeRequest>();

  const event = await verifyAdmin(c.env, eventId, body.adminKey);
  if (!event) return c.json(FORBIDDEN, 403);

  const db = getDb(c.env);
  await db.delete(events).where(eq(events.id, eventId));

  return c.json({ ok: true });
});
