import { Hono } from 'hono';
import type { Env } from './db';
import { eventsRoute } from './routes/events';
import { participantsRoute } from './routes/participants';
import { destinationsRoute } from './routes/destinations';
import { resultsRoute } from './routes/results';
import { adminActionsRoute } from './routes/admin-actions';
import { serveSpaWithOg } from './og';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, ts: Math.floor(Date.now() / 1000) }));

/**
 * 活动页要注入分享卡片标签，所以必须由 Worker 先接住。
 *
 * ⚠️ 注意这里只拦 GET。静态资源（/assets/*、/og.png）走的是别的路径，
 * 不受影响 —— 上次把 /e/* 交给 Worker 却忘了放行静态资源，
 * 结果整站 522（见设计文档 §11.2）。
 */
app.get('/e/*', serveSpaWithOg);

app.route('/', eventsRoute);
app.route('/', participantsRoute);
app.route('/', destinationsRoute);
app.route('/', resultsRoute);
app.route('/', adminActionsRoute);

/**
 * 兜底路由。
 *
 * 两种部署形态的行为不一样：
 *
 * - 独立 Worker：静态资源由 wrangler 的 assets 配置处理，Worker 根本收不到
 *   那些请求，所以这里只需要管 API 的 404。
 * - Cloudflare Pages（高级模式）：Worker 负责【所有】请求，包括静态文件，
 *   所以非 API 的请求要交还给 ASSETS；静态资源里找不到的（比如 /e/xxx
 *   这种前端路由）再回退到 index.html。
 */
app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: '接口不存在' }, 404);

  if (c.env.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status !== 404) return res;
    // SPA 回退：让前端路由（/e/xxx、/new）也能直接打开
    return c.env.ASSETS.fetch(new URL('/index.html', c.req.url).toString());
  }

  return c.json({ error: '接口不存在' }, 404);
});

export default app;
