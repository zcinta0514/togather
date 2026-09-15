// D1 客户端。Task 7 会补上 schema 后这里会挂 drizzle。
export interface Env {
  DB: D1Database;
  ADMIN_SECRET: string;
}
