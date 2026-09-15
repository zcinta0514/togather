import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { events, participants, destinations, votes } from '../schema';
import { getDb, type Env } from '../db';
import { shortId, secret, now } from '../ids';
import { slotCountFor } from '../../core/slots';
import { encodeAvailability } from '../../core/bitmap';
import type { JoinRequest, JoinResponse, SubmitRequest, VoteLevel } from '../../shared/types';

export const participantsRoute = new Hono<{ Bindings: Env }>();

/** 名字长度上限。够写「张三」「王小明」甚至「隔壁老王」，挡住的是 1MB 的标题 */
const MAX_NAME = 24;

/** 单个活动的人数上限。群里约个活动远远用不到，挡住的是脚本刷链接 */
const MAX_PARTICIPANTS = 200;

/**
 * 这个名字在活动里有没有被别人占了。
 * 排除掉 excludeId 自己 —— 自己改回自己的名字不算冲突。
 */
async function nameTaken(
  db: ReturnType<typeof getDb>,
  eventId: string,
  name: string,
  excludeId: string,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(participants)
    .where(and(eq(participants.eventId, eventId), eq(participants.name, name)));
  return rows.some((r) => r.id !== excludeId);
}

/** 加入活动：新加入或凭 token 回来改 */
participantsRoute.post('/api/events/:id/join', async (c) => {
  const db = getDb(c.env);
  const eventId = c.req.param('id');
  const body = await c.req.json<JoinRequest>();

  const trimmed = body.name?.trim() ?? '';
  if (!trimmed) return c.json({ error: '名字不能为空' }, 400);
  if (trimmed.length > MAX_NAME) {
    return c.json({ error: `名字太长了，最多 ${MAX_NAME} 个字` }, 400);
  }

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
      // 改名也要查重。只在「新加入」那条路上查的话，改个名就绕过去了 ——
      // 群里会出现两个同名的人，发起人分不清谁是谁，催人的时候也点错。
      if (p.name !== trimmed && (await nameTaken(db, eventId, trimmed, p.id))) {
        return c.json({ error: '这个活动里已经有人叫这个名字了，换一个吧' }, 409);
      }
      if (p.name !== trimmed) {
        await db
          .update(participants)
          .set({ name: trimmed, updatedAt: now() })
          .where(eq(participants.id, p.id));
      }
      return c.json<JoinResponse>({ participantId: p.id, token: p.token, name: trimmed });
    }
  }

  // 重名处理：同活动里已经有人叫这个名字 → 提示换一个
  if (await nameTaken(db, eventId, trimmed, '')) {
    return c.json({ error: '这个活动里已经有人叫这个名字了，换一个吧' }, 409);
  }

  // 人数上限。参与者数量直接决定方案计算的规模（每个「人×目的地」
  // 都要算一遍可行窗口），而活动链接是公开的 —— 不封顶的话，
  // 一个脚本对着链接反复加入就能把结果页拖垮。
  const existingCount = await db
    .select()
    .from(participants)
    .where(eq(participants.eventId, eventId));
  if (existingCount.length >= MAX_PARTICIPANTS) {
    return c.json({ error: `这个活动的人已经满了（最多 ${MAX_PARTICIPANTS} 人）` }, 400);
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

  // 提交时也能改名（填写页的名字输入框是可编辑的）。
  // 这条路径同样要查重和限长 —— 否则它就成了绕过前面两道检查的后门。
  const nextName = body.name?.trim() || me.name;
  if (nextName.length > MAX_NAME) {
    return c.json({ error: `名字太长了，最多 ${MAX_NAME} 个字` }, 400);
  }
  if (nextName !== me.name && (await nameTaken(db, eventId, nextName, me.id))) {
    return c.json({ error: '这个活动里已经有人叫这个名字了，换一个吧' }, 409);
  }

  const ts = now();
  await db
    .update(participants)
    .set({
      name: nextName,
      availability: encodeAvailability(body.availability),
      respondedAt: me.respondedAt ?? ts,
      updatedAt: ts,
    })
    .where(eq(participants.id, me.id));

  // 覆盖式写入投票。
  //
  // 这里有两个坑，都会让人「静默地变成哪个地方都不想去」：
  //
  // ① 同一个目的地出现两次。表上 (participant_id, destination_id) 是主键，
  //    重复的 destinationId 会让整个 insert 被拒 —— 而 delete 已经执行过了，
  //    于是这个人的票全没了、时间却还在。
  //    所以先按目的地归并，后来的覆盖先前的。
  // ② delete 和 insert 是两条独立的语句。放在同一个 batch 里，
  //    要么都生效要么都不生效，不会停在「票已删、还没插」的中间态。
  const validLevels = new Set([0, 1, 2]);
  const dests = await db.select().from(destinations).where(eq(destinations.eventId, eventId));
  const okIds = new Set(dests.map((d) => d.id));

  const byDest = new Map<string, number>();
  for (const v of body.votes ?? []) {
    if (validLevels.has(v.level) && okIds.has(v.destinationId)) {
      byDest.set(v.destinationId, v.level);
    }
  }
  const toInsert = [...byDest].map(([destinationId, level]) => ({
    participantId: me.id,
    destinationId,
    level: level as VoteLevel,
  }));

  await db.batch([
    db.delete(votes).where(eq(votes.participantId, me.id)),
    ...(toInsert.length > 0 ? [db.insert(votes).values(toInsert)] : []),
  ]);

  return c.json({ ok: true, respondedAt: me.respondedAt ?? ts });
});
