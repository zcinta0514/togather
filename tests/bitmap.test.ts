import { describe, it, expect } from 'vitest';
import { encodeAvailability, decodeAvailability } from '../src/core/bitmap';
import type { AvailabilityLevel } from '../src/shared/types';

describe('encodeAvailability / decodeAvailability', () => {
  it('往返后完全一致', () => {
    const levels: AvailabilityLevel[] = [0, 1, 2, 2, 0, 1];
    const b64 = encodeAvailability(levels);
    expect(decodeAvailability(b64, 6)).toEqual(levels);
  });

  it('空数组往返后是空数组', () => {
    const b64 = encodeAvailability([]);
    expect(decodeAvailability(b64, 0)).toEqual([]);
  });

  it('全 0 往返正确', () => {
    const levels: AvailabilityLevel[] = [0, 0, 0, 0];
    expect(decodeAvailability(encodeAvailability(levels), 4)).toEqual(levels);
  });

  it('全 2 往返正确', () => {
    const levels: AvailabilityLevel[] = [2, 2, 2, 2, 2];
    expect(decodeAvailability(encodeAvailability(levels), 5)).toEqual(levels);
  });

  it('100 格往返正确', () => {
    const levels = Array.from({ length: 100 }, (_, i) => ((i * 7) % 3) as AvailabilityLevel);
    expect(decodeAvailability(encodeAvailability(levels), 100)).toEqual(levels);
  });

  it('180 格（槽位上限）往返正确', () => {
    const levels = Array.from({ length: 180 }, (_, i) => (i % 3) as AvailabilityLevel);
    expect(decodeAvailability(encodeAvailability(levels), 180)).toEqual(levels);
  });

  it('189 格这种非 4 的整数倍也正确（末尾有填充位）', () => {
    const levels = Array.from({ length: 189 }, (_, i) => (i % 3) as AvailabilityLevel);
    expect(decodeAvailability(encodeAvailability(levels), 189)).toEqual(levels);
  });

  it('请求的槽位数多于编码内容时，缺失部分补 0', () => {
    const b64 = encodeAvailability([2, 2]);
    expect(decodeAvailability(b64, 4)).toEqual([2, 2, 0, 0]);
  });

  it('空字符串解码成全 0，不抛异常', () => {
    expect(decodeAvailability('', 3)).toEqual([0, 0, 0]);
  });

  it('180 格编码后不超过 48 字节（base64 后 64 字符）', () => {
    const levels = Array.from({ length: 180 }, () => 2 as AvailabilityLevel);
    const b64 = encodeAvailability(levels);
    expect(b64.length).toBeLessThanOrEqual(64);
  });
});
