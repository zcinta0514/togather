import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export interface Env {
  DB: D1Database;
  /**
   * 静态资源绑定。
   *
   * 只有部署到 Cloudflare Pages（高级模式）时才存在；
   * 部署成独立 Worker 时由 assets 配置自动处理，这里是 undefined。
   */
  ASSETS?: Fetcher;
}

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
