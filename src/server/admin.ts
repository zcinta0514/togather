import { eq } from 'drizzle-orm';
import { events } from './schema';
import { getDb, type Env } from './db';
import { hashKey, timingSafeEqual } from './ids';
import type { EventRow } from '../shared/types';

/**
 * 校验管理密钥。
 *
 * 密钥在创建活动时生成、只返回一次，库里只存哈希。
 * 比对用恒定时间比较，避免通过响应耗时推断出密钥内容。
 *
 * 返回活动行表示通过，返回 null 表示密钥错误或活动不存在 ——
 * 调用方【不应该】区分这两种情况给不同的错误信息，
 * 否则等于告诉攻击者「这个活动 ID 是存在的」。
 */
export async function verifyAdmin(
  env: Env,
  eventId: string,
  adminKey: string,
): Promise<EventRow | null> {
  if (!adminKey) return null;

  const db = getDb(env);
  const rows = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (rows.length === 0) return null;

  const provided = await hashKey(adminKey);
  return timingSafeEqual(provided, rows[0].adminKeyHash) ? rows[0] : null;
}

/** 统一的「没权限」响应，故意不区分密钥错和活动不存在 */
export const FORBIDDEN = { error: '管理密钥无效' };
