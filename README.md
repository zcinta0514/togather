# 何时何地 · Togather

朋友约着出去玩，各自填「什么时候有空」和「想去哪里」，系统直接算出几个能执行的方案。

**线上地址：https://heshihedi.pages.dev**

英文名 **Togather** = together（一起）+ gather（聚）。
中文名用于界面，英文名用于网址和代码。

> ⚠️ **部署目标是 Cloudflare Pages，不是 Workers。**
> `*.workers.dev` 在中国大陆被墙（TCP 层就连不上），`*.pages.dev` 没有。
> 详见设计文档 §11.1。

---

## 本地跑起来

```bash
npm install
cp .dev.vars.example .dev.vars   # 首次
npm run db:migrate:local         # 首次，建表
npm run dev                      # 打开终端里显示的地址
```

## 常用命令

| 命令 | 干什么 |
|---|---|
| `npm run dev` | 本地开发（前端 + 后端 + 本地数据库一起起） |
| `npm test` | 跑核心算法、预算统计等单元测试 |
| `npm run demo` | 用设计文档 §3.1 那个反例跑一遍算法，看证据 |
| `npm run smoke` | 端到端冒烟测试（需先 `npm run dev`） |
| `npm run typecheck` | 类型检查 |
| `npm run deploy:pages` | **构建并部署到线上**（认准这个，见下方说明） |
| `npm run deploy` | 部署成独立 Worker（注意：`workers.dev` 国内打不开） |

## 代码结构

```
src/core/      核心算法（纯函数，不碰网络和数据库，有测试）
src/server/    后端接口（Hono on Cloudflare Workers）
src/client/    界面（React + Tailwind）
src/shared/    前后端共用的类型，唯一真源
migrations/    数据库表结构
scripts/       演示和冒烟测试脚本
```

**`src/core/` 是最该先看的地方。** 那个目录里是产品的立身之本——
「目的地 × 时间」的交叉方案矩阵。它不依赖任何框架，用 `npm run demo`
就能看到它在真实数据上算出什么。
预算统计也在这一层做纯函数计算：个人预算上限只是意愿参考，不代表目的地实际价格。

## 设计文档

- 设计文档：`docs/superpowers/specs/2026-09-15-group-scheduling-design.md`
- 实施方案：`docs/superpowers/plans/2026-09-15-mvp-core-loop.md`

## 三个容易踩的坑（已经踩过并修好了）

**⓿ 部署必须用 `npm run deploy:pages`，不能用 `npm run deploy`。**
`deploy` 部署成独立 Worker，网址是 `*.workers.dev` —— 那个域名在国内被墙。
`deploy:pages` 会：构建前端 → 把后端打成 `_worker.js` → 删掉 Vite 插件留下的
配置重定向 → 临时换上 Pages 配置 → 部署 → 换回配置。
每一步都有原因，拆开手动跑会踩坑，细节见设计文档 §11.2。


**① 不要把 `/e/*` 加进 `wrangler.jsonc` 的 `run_worker_first`。**
加了之后，朋友在微信里点开活动链接（一次完整页面加载）会被 Worker 截住，
而 Worker 没有 `/e/*` 的路由，于是返回 JSON 404。前端路由跳转看不出来，
只有完整页面加载才触发——而微信里点链接恰恰就是完整加载。

**② 时间网格的拖拽连涂必须用组件内部的即时值，不能读 props。**
一次拖拽会在极短时间内连发多个 `pointermove`，每次都读 props 里的旧数组，
后一次会覆盖前一次，表现是「划过去只涂上了最后一格」。
