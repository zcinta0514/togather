import app from './index';
import type { Env } from './db';

/**
 * Cloudflare Pages（高级模式）的入口。
 *
 * Pages 要求 _worker.js 导出 `{ fetch }` 这样的对象。
 * Hono 实例本身有 .fetch 方法，直接 export default app 也许能用，
 * 但显式包一层不依赖这个假设 —— 契约写在代码里，比猜框架行为可靠。
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
