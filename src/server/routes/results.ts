import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { events, participants, destinations, votes } from '../schema';
import { getDb, type Env } from '../db';
import { slotCountFor, allSlotStarts, slotsPerDay, slotsForDays } from '../../core/slots';
import { decodeAvailability } from '../../core/bitmap';
import { buildPlans, type PlannerDestination } from '../../core/planner';
import { calculateBudgetStats, protectBudgetStats } from '../../core/budget';
import type { ResultsPageResponse, ResultsResponse, VoteLevel } from '../../shared/types';

export const resultsRoute = new Hono<{ Bindings: Env }>();

resultsRoute.get('/api/events/:id/results', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');

  const eventRows = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (eventRows.length === 0) return c.json({ error: '活动不存在' }, 404);
  const event = eventRows[0];

  const [participantRows, destinationRows] = await Promise.all([
    db.select().from(participants).where(eq(participants.eventId, id)),
    db.select().from(destinations).where(eq(destinations.eventId, id)),
  ]);

  // 在 SQL 里按目的地筛投票，不要 select 全表再在 JS 里过滤 ——
  // 那样每次刷新结果页都要读出【所有活动】的票，成本随整个库增长。
  const destIds = destinationRows.map((d) => d.id);
  const scopedVotes = destIds.length
    ? await db.select().from(votes).where(inArray(votes.destinationId, destIds))
    : [];
  const votesByDestination = new Map<string, typeof scopedVotes>();
  for (const vote of scopedVotes) {
    const list = votesByDestination.get(vote.destinationId);
    if (list) list.push(vote);
    else votesByDestination.set(vote.destinationId, [vote]);
  }

  const slotCount = slotCountFor(event.rangeStart, event.rangeEnd, event.granularity);
  const perDay = slotsPerDay(event.granularity);
  const respondedIds = new Set(
    participantRows.filter((p) => p.respondedAt !== null).map((p) => p.id),
  );
  const respondedCount = respondedIds.size;

  const plans = buildPlans({
    slotCount,
    slotsPerDay: perDay,
    participants: participantRows.map((p) => ({
      id: p.id,
      name: p.name,
      isCore: p.isCore,
      availability: decodeAvailability(p.availability, slotCount),
      responded: p.respondedAt !== null,
    })),
    destinations: destinationRows.map<PlannerDestination>((d) => ({
      id: d.id,
      name: d.name,
      daysNeeded: d.daysNeeded,
      budgetLevel: d.budgetLevel,
      votes: Object.fromEntries(
        (votesByDestination.get(d.id) ?? []).map((v) => [v.participantId, v.level as VoteLevel]),
      ),
      budgetStats: event.budgetEnabled
        ? protectBudgetStats(
            calculateBudgetStats(
              (votesByDestination.get(d.id) ?? [])
                .filter((v) => respondedIds.has(v.participantId) && v.level >= 1)
                .map((v) => v.budgetAmount),
              respondedCount,
            ),
            event.anonymity,
          )
        : null,
    })),
  });

  // 找出「一个方案都没产出」的目的地，单独说明原因，不让它们无声消失。
  //
  // 比较的必须是槽位数对槽位数：slotCount 是格数，daysNeeded 是天数，
  // 按半天粒度时两者差一倍。原来拿天数直接跟格数比大小，
  // 一个 3 天的活动（6 格）配一个「要 4 天」的目的地会被判成「放得下」。
  const rangeDays = Math.floor(slotCount / perDay);
  const plannedDestIds = new Set(plans.map((p) => p.destinationId));
  const unreachable = destinationRows
    .filter((d) => !plannedDestIds.has(d.id))
    .map((d) => ({
      destinationId: d.id,
      name: d.name,
      reason:
        slotsForDays(d.daysNeeded, event.granularity) > slotCount
          ? `需要 ${d.daysNeeded} 天，但活动范围只有 ${rangeDays} 天`
          : `这段时间里没人能空出连续的 ${d.daysNeeded} 天`,
    }));

  // 意愿匿名：「不想去」必须从响应里【整条消失】，不能只是界面不显示。
  //
  // 界面上不点名、数据里照样带着人名的话，谁都能按 F12 看到谁不想去 ——
  // 而「有些话匿名才说得出口」正是这个设置存在的唯一理由。
  // 人名单删掉之后，界面靠 unwillingCount 显示「另有 N 人不想去」。
  //
  // 注意只删 unwilling：busy 是「那天没空」这个事实，不是意见，可以点名，
  // 而且组织者需要知道差的是谁。
  const anonymous = event.anonymity === 'vote_anonymous';
  const safePlans = anonymous
    ? plans.map((p) => ({ ...p, missing: p.missing.filter((m) => m.reason !== 'unwilling') }))
    : plans;

  const result: ResultsResponse = {
    plans: safePlans,
    slotCount,
    respondedCount,
    totalCount: participantRows.length,
    notResponded: participantRows
      .filter((p) => p.respondedAt === null)
      .map((p) => ({ id: p.id, name: p.name })),
    slotStarts: allSlotStarts(event.rangeStart, slotCount, event.granularity),
    unreachable,
  };

  if (c.req.query('view') === 'page') {
    const page: ResultsPageResponse = {
      detail: {
        event: { ...event, adminKeyHash: '' },
        slotCount,
        participants: participantRows.map((p) => ({
          id: p.id,
          name: p.name,
          isCore: p.isCore,
          availability: p.availability,
          respondedAt: p.respondedAt,
        })),
        destinations: destinationRows,
      },
      results: result,
    };
    return c.json<ResultsPageResponse>(page);
  }

  return c.json<ResultsResponse>(result);
});
