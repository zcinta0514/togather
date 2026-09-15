import type { AvailabilityLevel } from '../shared/types';

/**
 * 把可用性数组编码成 base64 位图。每格占 2 bit（0/1/2）。
 *
 * 为什么不用 JSON：一个 180 格的活动，JSON 要 ~360 字符，
 * 位图只要 45 字节（base64 后 60 字符）。而且解码后可以直接做位运算。
 */
export function encodeAvailability(levels: AvailabilityLevel[]): string {
  const bytes = new Uint8Array(Math.ceil(levels.length / 4));
  for (let i = 0; i < levels.length; i++) {
    const byteIndex = i >> 2; // i / 4
    const shift = (i & 3) * 2; // (i % 4) * 2
    bytes[byteIndex] |= (levels[i] & 0b11) << shift;
  }
  return bytesToBase64(bytes);
}

/**
 * 解码位图。requestedCount 是期望的槽位数。
 * 位图比 requestedCount 短时，缺失部分补 0（视为「不行」）——
 * 这样即使活动的时间范围被改过，旧数据也不会让页面崩掉。
 */
export function decodeAvailability(b64: string, requestedCount: number): AvailabilityLevel[] {
  const bytes = base64ToBytes(b64);
  const out: AvailabilityLevel[] = new Array(requestedCount);
  for (let i = 0; i < requestedCount; i++) {
    const byteIndex = i >> 2;
    const shift = (i & 3) * 2;
    const raw = byteIndex < bytes.length ? bytes[byteIndex] : 0;
    out[i] = ((raw >> shift) & 0b11) as AvailabilityLevel;
  }
  return out;
}

// Workers 和浏览器都有 btoa/atob，但只接受 latin1 字符串，需要手动转。
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
