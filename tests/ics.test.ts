import { describe, it, expect } from 'vitest';
import { buildIcs } from '../src/core/ics';

const RANGE_START = Math.floor(Date.UTC(2025, 9, 1) / 1000) - 8 * 3600; // 10/1 00:00 北京时间

const base = {
  eventId: 'k3n8p2',
  title: '国庆出去玩',
  destinationName: '莫干山',
  rangeStart: RANGE_START,
  attendeeNames: ['小王', '小李', '小张', '小赵'],
  url: 'https://heshihedi.pages.dev/e/k3n8p2',
  now: 1757937600, // 固定，保证测试可重复
};

describe('buildIcs — 全天事件（按天粒度）', () => {
  const ics = buildIcs({ ...base, startSlot: 4, endSlot: 6, granularity: 'day' });

  it('DTSTART 是开始那天（北京时间的日期）', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20251005');
  });

  it('DTEND 是结束日的【后一天】—— iCalendar 的结束是开区间', () => {
    // 10/5–10/7 三天，DTEND 必须写 10/8。写成 10/7 会少一天。
    expect(ics).toContain('DTEND;VALUE=DATE:20251008');
    expect(ics).not.toContain('DTEND;VALUE=DATE:20251007');
  });

  it('用 CRLF 换行（规范要求，不是 LF）', () => {
    expect(ics).toContain('\r\n');
    expect(ics.split('\r\n').length).toBeGreaterThan(10);
  });

  it('首尾完整', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('包含标题、地点、参加人', () => {
    expect(ics).toContain('SUMMARY:国庆出去玩 · 莫干山');
    expect(ics).toContain('LOCATION:莫干山');
    expect(ics).toContain('小王');
  });

  it('UID 稳定且带活动 ID', () => {
    const again = buildIcs({ ...base, startSlot: 4, endSlot: 6, granularity: 'day' });
    const uid = ics.match(/UID:([^\r\n]+)/)?.[1];
    const uid2 = again.match(/UID:([^\r\n]+)/)?.[1];
    expect(uid).toBeDefined();
    expect(uid).toBe(uid2); // 同样的输入产生同样的 UID，重复导入不会变成两条
    expect(uid).toContain('k3n8p2');
  });
});

describe('buildIcs — 定时事件（按半天粒度）', () => {
  const ics = buildIcs({ ...base, startSlot: 0, endSlot: 1, granularity: 'half_day' });

  it('用 UTC 时间戳，不用 VALUE=DATE', () => {
    expect(ics).not.toContain('VALUE=DATE');
    // 10/1 00:00 北京 = 9/30 16:00 UTC
    expect(ics).toContain('DTSTART:20250930T160000Z');
  });

  it('DTEND 覆盖到最后一格结束', () => {
    // 两格 = 一整天，结束在 10/1 24:00 北京 = 10/1 16:00 UTC
    expect(ics).toContain('DTEND:20251001T160000Z');
  });
});

describe('buildIcs — 转义与折行', () => {
  it('把逗号、分号、反斜杠转义', () => {
    const ics = buildIcs({
      ...base,
      title: '吃饭, 聊天; 顺便\\散步',
      destinationName: '莫干山',
      startSlot: 0,
      endSlot: 0,
      granularity: 'day',
    });
    expect(ics).toContain('SUMMARY:吃饭\\, 聊天\\; 顺便\\\\散步 · 莫干山');
  });

  it('超过 75 字节的行被折行（中文一个字 3 字节，很容易超）', () => {
    const ics = buildIcs({
      ...base,
      attendeeNames: Array.from({ length: 40 }, (_, i) => `参加者${i}`),
      startSlot: 0,
      endSlot: 0,
      granularity: 'day',
    });
    const lines = ics.split('\r\n');
    const over = lines.filter((l) => new TextEncoder().encode(l).length > 75);
    expect(over).toEqual([]);
    // 折行后的续行以空格开头
    expect(lines.some((l) => l.startsWith(' ') && l.trim().length > 0)).toBe(true);
  });

  it('折行后内容还能拼回原样', () => {
    const names = Array.from({ length: 40 }, (_, i) => `参加者${i}`);
    const ics = buildIcs({
      ...base,
      attendeeNames: names,
      startSlot: 0,
      endSlot: 0,
      granularity: 'day',
    });
    // 把折行拼回去（CRLF + 空格 还原成空）
    const unfolded = ics.replace(/\r\n /g, '');
    for (const n of names) expect(unfolded).toContain(n);
  });

  it('描述里的换行符被转义成 \\n，不会破坏结构', () => {
    const ics = buildIcs({ ...base, startSlot: 0, endSlot: 0, granularity: 'day' });
    const descLines = ics.split('\r\n').filter((l) => l.startsWith('DESCRIPTION'));
    expect(descLines.length).toBe(1);
  });
});

describe('buildIcs — 跨月跨年', () => {
  it('12/30 出发、1/2 结束能正确跨年', () => {
    const start = Math.floor(Date.UTC(2025, 11, 30) / 1000) - 8 * 3600;
    const ics = buildIcs({
      ...base,
      rangeStart: start,
      startSlot: 0,
      endSlot: 3,
      granularity: 'day',
    });
    expect(ics).toContain('DTSTART;VALUE=DATE:20251230');
    expect(ics).toContain('DTEND;VALUE=DATE:20260103');
  });
});
