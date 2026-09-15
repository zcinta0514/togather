import { GRANULARITY_SECONDS, type Granularity } from '../shared/types';
import { slotStartAt } from './slots';

export interface IcsInput {
  eventId: string;
  title: string;
  destinationName: string;
  rangeStart: number; // Unix 秒
  startSlot: number;
  endSlot: number; // 闭区间
  granularity: Granularity;
  attendeeNames: string[];
  url: string;
  now: number; // Unix 秒，固定传入以便测试可重复
}

/** 每行最多 75 字节（规范是 75 个八位组，中文一个字 3 字节） */
const MAX_LINE_BYTES = 75;

/** Unix 秒 → UTC 的基本格式 YYYYMMDDTHHMMSSZ */
function toUtcBasic(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/**
 * Unix 秒 → 北京时间的日期 YYYYMMDD。
 *
 * 全天事件不带时区，所以必须给「用户眼中的那一天」。
 * 直接取 UTC 日期会在北京时间凌晨出错误 —— 10/1 00:00 北京是
 * 9/30 16:00 UTC，取 UTC 日期会变成 9/30。
 */
function toBeijingDate(ts: number): string {
  const d = new Date((ts + 8 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

/** 转义 iCalendar 的 TEXT 值：反斜杠、分号、逗号、换行 */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * 按 75 字节折行。
 *
 * 不能按字符数折 —— 中文一个字 3 字节，按字符数 75 会到 225 字节，
 * 超过规范上限，某些日历客户端会截断或报错。
 * 也不能把多字节字符从中间劈开，所以按码点逐个累加字节数。
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_LINE_BYTES) return line;

  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  // 续行以一个空格开头，那个空格也占 1 字节，所以第一行能用 75，后续只能用 74
  let limit = MAX_LINE_BYTES;

  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (curBytes + size > limit) {
      out.push(cur);
      cur = ch;
      curBytes = size;
      limit = MAX_LINE_BYTES - 1;
    } else {
      cur += ch;
      curBytes += size;
    }
  }
  if (cur) out.push(cur);

  return out.join('\r\n ');
}

/**
 * 生成一个 .ics 日历文件。
 *
 * 按天粒度用【全天事件】；按半天用定时事件。
 * 理由：「出去玩几天」在日历上就该是一条贯穿整天的条，
 * 而不是一个「下午 3 点开始」的精确时刻。
 */
export function buildIcs(input: IcsInput): string {
  const { eventId, title, destinationName, rangeStart, startSlot, endSlot, granularity } = input;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Togather//heshihedi//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:togather-${eventId}-${startSlot}@heshihedi.pages.dev`,
    `DTSTAMP:${toUtcBasic(input.now)}`,
  ];

  if (granularity === 'day') {
    // 全天事件：DTEND 是【开区间】，必须写结束日的后一天。
    // 写成结束日本身会少一天 —— 这是 iCalendar 最容易踩的坑。
    const endExclusive = slotStartAt(rangeStart, endSlot + 1, granularity);
    lines.push(`DTSTART;VALUE=DATE:${toBeijingDate(slotStartAt(rangeStart, startSlot, granularity))}`);
    lines.push(`DTEND;VALUE=DATE:${toBeijingDate(endExclusive)}`);
  } else {
    const startTs = slotStartAt(rangeStart, startSlot, granularity);
    const endTs = slotStartAt(rangeStart, endSlot + 1, granularity);
    void GRANULARITY_SECONDS;
    lines.push(`DTSTART:${toUtcBasic(startTs)}`);
    lines.push(`DTEND:${toUtcBasic(endTs)}`);
  }

  lines.push(`SUMMARY:${escapeText(`${title} · ${destinationName}`)}`);
  lines.push(`LOCATION:${escapeText(destinationName)}`);
  lines.push(
    `DESCRIPTION:${escapeText(
      `参加：${input.attendeeNames.join('、')}\n查看活动：${input.url}`,
    )}`,
  );
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.map(foldLine).join('\r\n') + '\r\n';
}
