import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { events, participants, destinations, votes } from '../schema';
import { getDb, type Env } from '../db';
import { shortId, secret, hashKey, now } from '../ids';
import { slotCountFor, rawSlotCount, slotsPerDay } from '../../core/slots';
import { MAX_SLOTS } from '../../shared/types';
import type {
  CreateEventRequest,
  CreateEventResponse,
  EventDetailResponse,
  Granularity,
  VoteLevel,
} from '../../shared/types';

export const eventsRoute = new Hono<{ Bindings: Env }>();

const VALID_GRANULARITY: Granularity[] = ['day', 'half_day'];

/** 活动名称上限。够写「国庆出去玩」「部门团建」了，挡住的是 1MB 的标题 */
const MAX_TITLE = 40;

/** 建活动 */
eventsRoute.post('/api/events', async (c) => {
  const body = await c.req.json<CreateEventRequest>();

  const title = body.title?.trim() ?? '';
  if (!title) return c.json({ error: '活动名称不能为空' }, 400);
  if (title.length > MAX_TITLE) {
    return c.json({ error: `活动名称太长了，最多 ${MAX_TITLE} 个字` }, 400);
  }
  if (!Number.isFinite(body.rangeStart) || !Number.isFinite(body.rangeEnd)) {
    return c.json({ error: '时间范围不合法' }, 400);
  }
  if (body.rangeEnd < body.rangeStart) return c.json({ error: '结束日期不能早于开始日期' }, 400);
  if (!VALID_GRANULARITY.includes(body.granularity)) {
    return c.json({ error: '时间粒度不合法' }, 400);
  }
  const slotCount = slotCountFor(body.rangeStart, body.rangeEnd, body.granularity);
  if (slotCount < 1) return c.json({ error: '时间范围太短' }, 400);

  // 超出槽位预算必须报错，不能默默截断。
  //
  // 截断的话：活动对外写着「到 12/31」，界面只画到 6/29，两处都没提示。
  // 八月才有空的人根本没法表达 —— 填不满一格就提交不了，于是他要么
  // 交不上，要么随便涂一天（假数据），而假数据会直接进方案计算。
  // 必须用 rawSlotCount：slotCountFor 已经把结果压到 180 了，比不出超限。
  const perDay = slotsPerDay(body.granularity);
  const raw = rawSlotCount(body.rangeStart, body.rangeEnd, body.granularity);
  if (raw > MAX_SLOTS) {
    return c.json(
      {
        error: `时间范围太长了：${
          body.granularity === 'day' ? '按天' : '按半天'
        }最多 ${MAX_SLOTS / perDay} 天，当前是 ${Math.ceil(raw / perDay)} 天`,
      },
      400,
    );
  }

  const db = getDb(c.env);
  const id = shortId(6);
  const adminKey = secret(32);

  await db.insert(events).values({
    id,
    title,
    rangeStart: body.rangeStart,
    rangeEnd: body.rangeEnd,
    timezone: 'Asia/Shanghai',
    granularity: body.granularity,
    collectDestinations: body.collectDestinations ?? true,
    budgetEnabled: body.budgetEnabled ?? false,
    // coreOnly 是早期设计留下的字段，现在已经不用了 ——
    // 核心成员只看 participants[].isCore，不再需要单独开关。
    // 列还留着（去掉要写迁移，收益不大），但永远存 false。
    coreOnly: false,
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

  const [participantRows, destinationRows] = await Promise.all([
    db.select().from(participants).where(eq(participants.eventId, id)),
    db.select().from(destinations).where(eq(destinations.eventId, id)),
  ]);

  // 投票按目的地 id 在 SQL 里筛，不要 select 全表再在 JS 里过滤 ——
  // 那样每次打开结果页都要把【所有活动】的票读出来，成本随整个库增长，
  // 而这个链接是公开的，谁都能刷。
  const destIds = destinationRows.map((d) => d.id);
  const voteRows = destIds.length
    ? await db.select().from(votes).where(inArray(votes.destinationId, destIds))
    : [];

  // level 出库是 number，收窄成 VoteLevel
  let scopedVotes = voteRows.map((v) => ({ ...v, level: v.level as VoteLevel }));

  // 意愿匿名：只回传请求者自己的票。
  //
  // 这个设置原先只在界面上生效 —— 数据照样整包返回，谁都能按 F12
  // 看到谁投了「不想去」。而「不想去」正是它唯一要保护的东西。
  // 现在服务端直接不发：没有 token，或者 token 不是这个活动的人，就只拿到空的。
  if (event.anonymity === 'vote_anonymous') {
    const token = c.req.query('token');
    const mine = token ? participantRows.find((p) => p.token === token) : undefined;
    scopedVotes = mine ? scopedVotes.filter((v) => v.participantId === mine.id) : [];
  }

  return c.json<EventDetailResponse>({
    // 管理密钥哈希绝不出现在响应里
    event: { ...event, adminKeyHash: '' },
    slotCount: slotCountFor(event.rangeStart, event.rangeEnd, event.granularity),
    // token 也绝不能出现 —— 拿到它就能冒充别人提交
    participants: participantRows.map((p) => ({
      id: p.id,
      name: p.name,
      isCore: p.isCore,
      availability: p.availability,
      respondedAt: p.respondedAt,
    })),
    destinations: destinationRows,
    votes: scopedVotes,
  });
});
