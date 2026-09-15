import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { events, participants } from './schema';
import { getDb, type Env } from './db';
import { slotRangeLabel } from '../core/slots';
import type { FinalizedPlan } from '../shared/types';

/**
 * index.html 里包裹默认分享标签的标记。
 *
 * 原来是个空占位符，结果是：/e/* 有卡片，但 /new、/my 这些
 * 不走 Worker 的页面一个标签都没有。改成包裹【默认值】，
 * Worker 只负责把这一段换成活动专属的 —— 不参与时也有兜底。
 */
const OG_START = '<!--OG_START-->';
const OG_END = '<!--OG_END-->';

/**
 * 缓存的 index.html 模板。
 *
 * 每个 /e/* 请求都要拿它来注入标签，每次都去 ASSETS 取一遍没必要。
 * Workers 的 isolate 在每次部署后会重建，所以不存在版本过期的问题。
 */
let indexTemplate: string | null = null;

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface OgData {
  title: string;
  description: string;
  url: string;
  image: string;
}

function renderTags(d: OgData): string {
  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="何时何地" />`,
    `<meta property="og:title" content="${escapeAttr(d.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(d.description)}" />`,
    `<meta property="og:url" content="${escapeAttr(d.url)}" />`,
    `<meta property="og:image" content="${escapeAttr(d.image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n    ');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把默认标签整段换成这个页面专属的，顺便把 <title> 也换掉 */
function inject(template: string, d: OgData, pageTitle: string): string {
  const tags = renderTags(d);
  const pattern = new RegExp(`${escapeRe(OG_START)}[\\s\\S]*?${escapeRe(OG_END)}`);

  const out = pattern.test(template)
    ? template.replace(pattern, `${OG_START}\n    ${tags}\n    ${OG_END}`)
    : template.replace('</head>', `  ${tags}\n  </head>`);

  return out.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(pageTitle)}</title>`);
}

/** 从 /e/k3n8p2 或 /e/k3n8p2/fill 里取出活动 ID */
function eventIdFromPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'e' || !parts[1]) return null;
  // 只接受短 ID 的字符集，避免奇怪路径也去查库
  return /^[0-9a-z]{4,16}$/.test(parts[1]) ? parts[1] : null;
}

/**
 * 服务前端的 HTML，并在 /e/* 上注入活动相关的分享卡片标签。
 *
 * 为什么必须服务端做：微信抓取分享卡片时读的是**服务端返回的原始 HTML**，
 * 不会执行 JS。所以纯前端的 SPA 贴到微信里只会显示一行光秃秃的网址。
 */
export async function serveSpaWithOg(c: Context<{ Bindings: Env }>): Promise<Response> {
  const assets = c.env.ASSETS;
  if (!assets) return c.notFound();

  if (indexTemplate === null) {
    const res = await assets.fetch(new URL('/index.html', c.req.url).toString());
    indexTemplate = await res.text();
  }

  const url = new URL(c.req.url);
  const origin = url.origin;
  const generic: OgData = {
    title: '何时何地',
    description: '什么时候有空，想去哪里 —— 一起定',
    url: origin,
    image: `${origin}/og.png`,
  };

  const id = eventIdFromPath(url.pathname);
  if (!id) {
    return html(inject(indexTemplate, generic, '何时何地'));
  }

  try {
    const db = getDb(c.env);
    const rows = await db.select().from(events).where(eq(events.id, id)).limit(1);
    if (rows.length === 0) {
      // 活动不存在也让前端去处理，别在这里给 404 ——
      // 用户可能只是拼错了，前端会显示得比一个裸 404 友好
      return html(inject(indexTemplate, generic, '何时何地'));
    }
    const event = rows[0];

    const people = await db.select().from(participants).where(eq(participants.eventId, id));
    const responded = people.filter((p) => p.respondedAt !== null).length;

    // 已定案的活动，卡片直接说结果 —— 比「还差 2 人没填」有用得多
    let description = '点开涂一下你哪几天有空';
    const finalized = parsePlan(event.finalizedPlan);
    if (finalized) {
      const range = slotRangeLabel(
        event.rangeStart,
        finalized.startSlot,
        finalized.endSlot,
        event.granularity,
      );
      description = `✓ 已定：${range} · ${finalized.destinationName}`;
    } else if (people.length > 0) {
      description = `已填 ${responded}/${people.length} 人 · 点开涂一下你哪几天有空`;
    }

    return html(
      inject(
        indexTemplate,
        {
          title: event.title,
          description,
          url: `${origin}/e/${id}`,
          image: `${origin}/og.png`,
        },
        `${event.title} · 何时何地`,
      ),
    );
  } catch {
    // 查库失败也不能让页面打不开 —— 分享卡片是锦上添花，页面本身是刚需
    return html(inject(indexTemplate, generic, '何时何地'));
  }
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 分享卡片的标签要能被重新抓取，但不必每次请求都重新查库。
      // 微信自己会缓存得很久，这个 Cache-Control 主要给其他爬虫看。
      'Cache-Control': 'public, max-age=300',
    },
  });
}

function parsePlan(raw: string | null): FinalizedPlan | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FinalizedPlan;
  } catch {
    return null;
  }
}
