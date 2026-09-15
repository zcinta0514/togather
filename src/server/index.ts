// Worker 入口。Task 9 会在这里挂上路由，现在只是一个占位，
// 让 vite.config.ts 里的 cloudflare() 插件能正常加载配置。
import { Hono } from 'hono';
import type { Env } from './db';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, ts: Math.floor(Date.now() / 1000) }));

export default app;
