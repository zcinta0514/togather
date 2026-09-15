import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { events, participants, destinations, votes } from '../schema';
import { getDb, type Env } from '../db';
import { slotCountFor, allSlotStarts } from '../../core/slots';
import { decodeAvailability } from '../../core/bitmap';
import { buildPlans, type PlannerDestination } from '../../core/planner';
import type { ResultsResponse, VoteLevel } from '../../shared/types';

export const resultsRoute = new Hono<{ Bindings: Env }>();

resultsRoute.get('/api/events/:id/results', async (c) => {
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

  const slotCount = slotCountFor(event.rangeStart, event.rangeEnd, event.granularity);
  const destIds = new Set(destinationRows.map((d) => d.id));
  const scopedVotes = voteRows.filter((v) => destIds.has(v.destinationId));

  const plans = buildPlans({
    slotCount,
    coreOnly: event.coreOnly,
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
        scopedVotes
          .filter((v) => v.destinationId === d.id)
          .map((v) => [v.participantId, v.level as VoteLevel]),
      ),
    })),
  });

  const respondedCount = participantRows.filter((p) => p.respondedAt !== null).length;

  // 找出「一个方案都没产出」的目的地，单独说明原因，不让它们无声消失
  const plannedDestIds = new Set(plans.map((p) => p.destinationId));
  const unreachable = destinationRows
    .filter((d) => !plannedDestIds.has(d.id))
    .map((d) => ({
      destinationId: d.id,
      name: d.name,
      reason:
        d.daysNeeded > slotCount
          ? `需要 ${d.daysNeeded} 天，但活动范围只有 ${slotCount} 天`
          : '这段时间内没人能凑出足够的天数',
    }));

  return c.json<ResultsResponse>({
    plans,
    slotCount,
    respondedCount,
    totalCount: participantRows.length,
    notResponded: participantRows
      .filter((p) => p.respondedAt === null)
      .map((p) => ({ id: p.id, name: p.name })),
    slotStarts: allSlotStarts(event.rangeStart, slotCount, event.granularity),
    unreachable,
  });
});
