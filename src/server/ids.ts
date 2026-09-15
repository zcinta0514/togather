// 去掉容易看错的字符（0/O、1/l/I），因为活动 ID 要念给朋友听、要手打
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/** 生成 n 位短 ID，用于活动 ID（可读性优先） */
export function shortId(n = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** 生成随机 token，用于参与者认领和管理密钥（安全性优先，允许混淆字符） */
export function secret(n = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 对管理密钥做哈希后入库，避免明文泄露 */
export async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 恒定时间比较，防时序攻击 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 当前 Unix 秒 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}
