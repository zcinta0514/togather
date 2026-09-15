# 何时何地 · MVP 核心闭环 实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「何时何地」从零做到本地能完整跑通——建活动 → 发链接 → 朋友填时间与目的地 → 看到交叉算出的可执行方案。

**Architecture:** 单个 Cloudflare Worker 同时承载 API（Hono）和前端静态资源（Vite + React 19 SPA）。数据存 D1（SQLite），用 Drizzle ORM。核心是纯函数的「交叉方案矩阵」算法，与网络层完全解耦，可以单独测试。

**Tech Stack:** Hono · Vite · React 19 · Tailwind v4 · shadcn/ui · Cloudflare Workers + D1 · Drizzle ORM · Vitest

**范围说明：** 本计划走到「本地端到端跑通」。定案页、ICS 日历导出、我的活动页、分享卡片、部署上线属于第二份计划。

**设计依据：** `docs/superpowers/specs/2026-09-15-group-scheduling-design.md`

---

## 文件结构

先锁定职责边界。每个文件一件事。

```
何时何地/
├── package.json
├── tsconfig.json
├── tsconfig.worker.json
├── vite.config.ts
├── wrangler.jsonc                    # Worker 配置：入口、D1 绑定、静态资源
├── drizzle.config.ts
├── .dev.vars.example
├── README.md                          # 给用户看的：怎么跑、怎么改
├── migrations/
│   └── 0001_init.sql                  # 建表 SQL（手写，不用 drizzle-kit 生成）
├── src/
│   ├── shared/
│   │   └── types.ts                   # 前后端共用的类型与常量（唯一真源）
│   ├── core/                          # ★ 纯算法层：不碰网络、不碰数据库
│   │   ├── slots.ts                   # 时间轴切分与槽位换算
│   │   ├── bitmap.ts                  # 可用性位图编解码
│   │   ├── windows.ts                 # 单人的可行时间窗口
│   │   └── planner.ts                 # ★ 交叉方案矩阵
│   ├── server/
│   │   ├── index.ts                   # Worker 入口，挂载路由
│   │   ├── db.ts                      # Drizzle 客户端
│   │   ├── schema.ts                  # Drizzle 表定义
│   │   ├── ids.ts                     # 短 ID 与密钥生成
│   │   └── routes/
│   │       ├── events.ts              # 建活动、读活动
│   │       ├── participants.ts        # 加入、提交、凭 token 改
│   │       ├── destinations.ts        # 提名、投票
│   │       └── results.ts             # 调 planner 出方案
│   └── client/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx                    # 路由
│       ├── index.css                  # Tailwind + 设计令牌
│       ├── lib/
│       │   ├── api.ts                 # fetch 封装
│       │   └── storage.ts             # localStorage：名字、token、管理密钥
│       ├── pages/
│       │   ├── CreatePage.tsx
│       │   ├── FillPage.tsx
│       │   └── ResultsPage.tsx
│       └── components/
│           ├── TimeGrid.tsx           # ★ 涂抹网格
│           ├── DestinationPicker.tsx
│           ├── PlanCard.tsx
│           └── Heatmap.tsx
└── tests/
    ├── slots.test.ts
    ├── bitmap.test.ts
    ├── windows.test.ts
    └── planner.test.ts
```

**分层原则：** `src/core/` 是纯函数，输入输出都是普通对象，不 import 任何 Cloudflare / React / Drizzle 的东西。这样算法能在 Node 里用 Vitest 直接测，跑一次几百毫秒。上层出问题时可以立刻排除算法。

---

## Phase 0 · 地基

### Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `wrangler.jsonc`
- Create: `.dev.vars.example`
- Create: `README.md`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "heshihedi",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:migrate:local": "wrangler d1 migrations apply heshihedi --local",
    "deploy": "vite build && wrangler deploy"
  },
  "dependencies": {
    "hono": "^4.6.14",
    "drizzle-orm": "^0.38.4",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.1"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.0.0",
    "@cloudflare/workers-types": "^4.20241230.0",
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "drizzle-kit": "^0.30.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.2",
    "vite": "^6.0.7",
    "vitest": "^2.1.8",
    "wrangler": "^3.99.0"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `npm install`
Expected: 无报错，生成 `node_modules/` 与 `package-lock.json`

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types", "vite/client"],
    "paths": { "@/*": ["./src/*"] },
    "baseUrl": "."
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

- [ ] **Step 4: 创建 vite.config.ts**

`@cloudflare/vite-plugin` 让开发时一个 `npm run dev` 同时起 Worker、前端和本地 D1，不需要开两个终端。

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: 创建 wrangler.jsonc**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "heshihedi",
  "main": "src/server/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "assets": {
    "directory": "./dist/client",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/e/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "heshihedi",
      "database_id": "PLACEHOLDER",
      "migrations_dir": "migrations"
    }
  ]
}
```

**注意 `run_worker_first`：** 默认情况下静态资源优先，Worker 不参与。但 `/api/*` 必须走 Worker，`/e/*` 也要走 Worker（第二份计划里要做 OG 卡片注入，微信分享才有预览图）。

- [ ] **Step 6: 创建 .dev.vars.example**

```
# 复制成 .dev.vars 后填写。.dev.vars 已被 .gitignore 排除，不会提交。
# 本地开发用，随便填一个长的随机串即可。生产环境用 `wrangler secret put ADMIN_SECRET` 设置。
ADMIN_SECRET=dev-secret-change-me
```

Run: `cp .dev.vars.example .dev.vars`

- [ ] **Step 7: 创建 README.md**

```markdown
# 何时何地

朋友约着出去玩，各自填「什么时候有空」和「想去哪里」，
系统直接算出几个能执行的方案。

## 本地跑起来

```bash
npm install
cp .dev.vars.example .dev.vars    # 首次
npm run db:migrate:local          # 首次，建表
npm run dev                       # 打开终端里显示的地址
```

## 跑测试

```bash
npm test
```

## 改东西

`src/core/` 是核心算法（纯函数，有测试）。
`src/server/` 是后端接口。
`src/client/` 是界面。

## 设计文档

`docs/superpowers/specs/2026-09-15-group-scheduling-design.md`
```

- [ ] **Step 8: 提交**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts wrangler.jsonc .dev.vars.example README.md
git commit -m "chore: 项目初始化（Hono + Vite + Cloudflare Workers + D1）"
```

---

### Task 2: 共用类型

**Files:**
- Create: `src/shared/types.ts`

所有类型在这里定义一次，前后端都从这里 import。**任何地方需要新类型，加到这里，不要在别处重复定义。**

- [ ] **Step 1: 写类型定义**

```ts
// src/shared/types.ts

/** 时间粒度：按天 / 按半天 */
export type Granularity = 'day' | 'half_day';

/** 可用性：0=不行，1=勉强，2=可以 */
export type AvailabilityLevel = 0 | 1 | 2;

/** 对目的地的态度：0=不想去，1=都行，2=想去 */
export type VoteLevel = 0 | 1 | 2;

/** 匿名策略：全实名 / 时间实名+意愿匿名 */
export type Anonymity = 'open' | 'vote_anonymous';

// ---------- 数据库行（与 schema.ts 一一对应） ----------

export interface EventRow {
  id: string;
  title: string;
  rangeStart: number;        // Unix 秒（UTC）
  rangeEnd: number;          // Unix 秒（UTC），闭区间
  timezone: string;          // IANA 名，如 Asia/Shanghai
  granularity: Granularity;
  collectDestinations: boolean;
  budgetEnabled: boolean;
  coreOnly: boolean;
  anonymity: Anonymity;
  adminKeyHash: string;
  finalizedPlan: string | null;
  createdAt: number;
}

export interface ParticipantRow {
  id: string;
  eventId: string;
  name: string;
  token: string;
  isCore: boolean;
  availability: string;      // base64 编码的位图
  respondedAt: number | null;
  updatedAt: number;
}

export interface DestinationRow {
  id: string;
  eventId: string;
  name: string;
  daysNeeded: number;
  budgetLevel: number | null;
  createdBy: string;
  createdAt: number;
}

export interface VoteRow {
  participantId: string;
  destinationId: string;
  level: VoteLevel;
}

// ---------- API 契约 ----------

export interface CreateEventRequest {
  title: string;
  rangeStart: number;
  rangeEnd: number;
  granularity: Granularity;
  collectDestinations: boolean;
  budgetEnabled: boolean;
  coreOnly: boolean;
  anonymity: Anonymity;
}

export interface CreateEventResponse {
  eventId: string;
  adminKey: string;          // 只在创建时返回一次
}

export interface EventDetailResponse {
  event: EventRow;
  slotCount: number;
  participants: ParticipantRow[];
  destinations: DestinationRow[];
  votes: VoteRow[];
}

export interface JoinRequest {
  name: string;
  token?: string;            // 带 token 表示是回来改的
}

export interface JoinResponse {
  participantId: string;
  token: string;
  name: string;
}

export interface SubmitRequest {
  token: string;
  name: string;
  availability: AvailabilityLevel[];   // 长度必须 === slotCount
  votes: Array<{ destinationId: string; level: VoteLevel }>;
}

export interface NominateDestinationRequest {
  token: string;
  name: string;
  daysNeeded: number;
  budgetLevel: number | null;
}

export interface PlanDto {
  destinationId: string;
  destinationName: string;
  daysNeeded: number;
  startSlot: number;
  endSlot: number;           // 闭区间
  attendeeIds: string[];
  weakCount: number;
  missing: Array<{ participantId: string; name: string; reason: 'busy' | 'unwilling' }>;
  blocked: boolean;
  blockedReason?: string;
}

export interface ResultsResponse {
  plans: PlanDto[];
  slotCount: number;
  respondedCount: number;
  totalCount: number;
  notResponded: Array<{ id: string; name: string }>;
  /** 时间轴槽位的起止时间，供前端渲染表头 */
  slotStarts: number[];
  /** 无法成行的目的地及原因 */
  unreachable: Array<{ destinationId: string; name: string; reason: string }>;
}

// ---------- 常量 ----------

export const GRANULARITY_SECONDS: Record<Granularity, number> = {
  day: 86400,
  half_day: 43200,
};

/** 单个活动的槽位上限，防止有人建个 10 年的活动把服务器算爆 */
export const MAX_SLOTS = 180;
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/shared/types.ts
git commit -m "feat(shared): 定义前后端共用类型与 API 契约"
```

---

## Phase 1 · 核心算法（纯函数，完整 TDD）

这一阶段不碰网络和数据库。每个函数都是纯的，输入输出都是普通对象。

### Task 3: 时间轴与槽位

**Files:**
- Create: `src/core/slots.ts`
- Test: `tests/slots.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
// tests/slots.test.ts
import { describe, it, expect } from 'vitest';
import { slotCountFor, slotStartAt, slotRangeLabel } from '../src/core/slots';

const DAY = 86400;
const HALF = 43200;

describe('slotCountFor', () => {
  it('按天粒度，闭区间 10/1–10/7 是 7 格', () => {
    const start = 1759248000; // 2025-10-01 00:00 UTC
    const end = start + 6 * DAY;
    expect(slotCountFor(start, end, 'day')).toBe(7);
  });

  it('按半天粒度，一整天是 2 格', () => {
    const start = 1759248000;
    const end = start + DAY - 1; // 当天 23:59:59，和创建活动时传的一致
    expect(slotCountFor(start, end, 'half_day')).toBe(2);
  });

  it('单日按天粒度是 1 格', () => {
    const start = 1759248000;
    expect(slotCountFor(start, start, 'day')).toBe(1);
  });

  it('范围倒置时返回 0，不抛异常', () => {
    expect(slotCountFor(1000, 500, 'day')).toBe(0);
  });

  it('超过上限时截断到 MAX_SLOTS', () => {
    const start = 1759248000;
    const end = start + 999 * DAY;
    expect(slotCountFor(start, end, 'day')).toBe(180);
  });
});

describe('slotStartAt', () => {
  it('第 0 格就是起点', () => {
    const start = 1759248000;
    expect(slotStartAt(start, 0, 'day')).toBe(start);
  });

  it('第 3 格是按天粒度加 3 天', () => {
    const start = 1759248000;
    expect(slotStartAt(start, 3, 'day')).toBe(start + 3 * DAY);
  });

  it('按半天粒度第 3 格是加 1.5 天', () => {
    const start = 1759248000;
    expect(slotStartAt(start, 3, 'half_day')).toBe(start + 3 * HALF);
  });
});

describe('slotRangeLabel', () => {
  it('单格按天粒度显示为一天', () => {
    const start = 1759248000;
    expect(slotRangeLabel(start, 0, 0, 'day')).toBe('10月1日');
  });

  it('多格按天粒度显示为区间', () => {
    const start = 1759248000;
    expect(slotRangeLabel(start, 0, 6, 'day')).toBe('10月1日 – 10月7日');
  });

  it('按半天粒度区分上午下午', () => {
    const start = 1759248000;
    expect(slotRangeLabel(start, 0, 0, 'half_day')).toBe('10月1日 上午');
    expect(slotRangeLabel(start, 1, 1, 'half_day')).toBe('10月1日 下午');
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/slots.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/slots"`

- [ ] **Step 3: 实现**

```ts
// src/core/slots.ts
import { GRANULARITY_SECONDS, MAX_SLOTS, type Granularity } from '../shared/types';

/**
 * 闭区间 [rangeStart, rangeEnd] 覆盖多少个槽位。
 * 范围倒置返回 0（不抛异常，让调用方自己决定怎么处理空结果）。
 */
export function slotCountFor(
  rangeStart: number,
  rangeEnd: number,
  granularity: Granularity,
): number {
  if (rangeEnd < rangeStart) return 0;
  const unit = GRANULARITY_SECONDS[granularity];
  const span = rangeEnd - rangeStart + 1;
  return Math.min(Math.ceil(span / unit), MAX_SLOTS);
}

/** 第 index 格的起始时刻（Unix 秒）。 */
export function slotStartAt(
  rangeStart: number,
  index: number,
  granularity: Granularity,
): number {
  return rangeStart + index * GRANULARITY_SECONDS[granularity];
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const PERIODS = ['上午', '下午'];

/**
 * 槽位区间的人类可读标签。
 * 按天用「10月1日」；按半天用「10月1日 上午/下午」。
 * 固定按 Asia/Shanghai 渲染（跨时区留给二期）。
 */
export function slotRangeLabel(
  rangeStart: number,
  startSlot: number,
  endSlot: number,
  granularity: Granularity,
): string {
  const fmtDay = (ts: number) => {
    const d = new Date((ts + 8 * 3600) * 1000); // 转北京时间再取日期
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  };

  if (granularity === 'day') {
    const a = slotStartAt(rangeStart, startSlot, granularity);
    if (startSlot === endSlot) return fmtDay(a);
    const b = slotStartAt(rangeStart, endSlot, granularity);
    return `${fmtDay(a)} – ${fmtDay(b)}`;
  }

  // half_day：每格 12 小时，用「槽位序号的奇偶」判断上午/下午。
  // 不要用时间戳取模 —— rangeStart 是当天 00:00，槽位 0 才是上午。
  const slotLabel = (i: number) => {
    const ts = slotStartAt(rangeStart, i, granularity);
    const d = new Date((ts + 8 * 3600) * 1000);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${PERIODS[i % 2]}`;
  };
  return startSlot === endSlot ? slotLabel(startSlot) : `${slotLabel(startSlot)} – ${slotLabel(endSlot)}`;
}

/** 供前端渲染表头：每一格的起始时刻。 */
export function allSlotStarts(
  rangeStart: number,
  slotCount: number,
  granularity: Granularity,
): number[] {
  return Array.from({ length: slotCount }, (_, i) => slotStartAt(rangeStart, i, granularity));
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/slots.test.ts`
Expected: PASS，14 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/core/slots.ts tests/slots.test.ts
git commit -m "feat(core): 时间轴切分与槽位换算"
```

---

### Task 4: 可用性位图编解码

**Files:**
- Create: `src/core/bitmap.ts`
- Test: `tests/bitmap.test.ts`

位图把每个人的可用性压成一个 base64 串。100 个槽位只需 25 字节，比存 JSON 数组省一个数量级。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/bitmap.test.ts
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

  it('能处理 180 格（槽位上限）', () => {
    const levels = Array.from({ length: 180 }, (_, i) => ((i % 3) as AvailabilityLevel));
    expect(decodeAvailability(encodeAvailability(levels), 180)).toEqual(levels);
  });

  it('请求的槽位数多于编码内容时，缺失部分补 0', () => {
    const b64 = encodeAvailability([2, 2]);
    expect(decodeAvailability(b64, 4)).toEqual([2, 2, 0, 0]);
  });

  it('188 格这种非字节整数倍的长度也正确', () => {
    // 188 * 2 = 376 bit = 47 字节整，正好边界
    const levels = Array.from({ length: 188 }, (_, i) => ((i % 3) as AvailabilityLevel));
    expect(decodeAvailability(encodeAvailability(levels), 188)).toEqual(levels);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/bitmap.test.ts`
Expected: FAIL — 找不到模块

- [ ] **Step 3: 实现**

```ts
// src/core/bitmap.ts
import type { AvailabilityLevel } from '../shared/types';

/**
 * 把可用性数组编码成 base64 位图。每格占 2 bit（0/1/2）。
 *
 * 为什么不用 JSON：一个 180 格的活动，JSON 要 ~360 字符，
 * 位图只要 45 字节（base64 后 60 字符）。而且解码后可以直接做位运算。
 */
export function encodeAvailability(levels: AvailabilityLevel[]): string {
  const bytes = new Uint8Array(Math.ceil(levels.length / 4));
  for (let i = 0; i < levels.length; i++) {
    const byteIndex = i >> 2;          // i / 4
    const shift = (i & 3) * 2;         // (i % 4) * 2
    bytes[byteIndex] |= (levels[i] & 0b11) << shift;
  }
  return bytesToBase64(bytes);
}

/**
 * 解码位图。requestedCount 是期望的槽位数。
 * 位图比 requestedCount 短时，缺失部分补 0（视为「不行」）——
 * 这样即使活动的时间范围被改过，旧数据也不会让页面崩掉。
 */
export function decodeAvailability(b64: string, requestedCount: number): AvailabilityLevel[] {
  const bytes = base64ToBytes(b64);
  const out: AvailabilityLevel[] = new Array(requestedCount);
  for (let i = 0; i < requestedCount; i++) {
    const byteIndex = i >> 2;
    const shift = (i & 3) * 2;
    const raw = byteIndex < bytes.length ? bytes[byteIndex] : 0;
    out[i] = ((raw >> shift) & 0b11) as AvailabilityLevel;
  }
  return out;
}

// Workers 和浏览器都有 btoa/atob，但只接受 latin1 字符串，需要手动转。
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/bitmap.test.ts`
Expected: PASS，8 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/core/bitmap.ts tests/bitmap.test.ts
git commit -m "feat(core): 可用性位图编解码（每格 2 bit）"
```

---

### Task 5: 单人的可行时间窗口

**Files:**
- Create: `src/core/windows.ts`
- Test: `tests/windows.test.ts`

给定一个人的可用性数组和「需要几天」，算出他所有可行的时间窗口。

**规则：窗口内不能有「不行」(0)，但允许有「勉强」(1) —— 同时要记录有几个「勉强」。** 勉强格在排序时会被惩罚，但不直接判死。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/windows.test.ts
import { describe, it, expect } from 'vitest';
import { feasibleWindows } from '../src/core/windows';
import type { AvailabilityLevel } from '../src/shared/types';

const A = (s: string): AvailabilityLevel[] =>
  s.split('').map((c) => (c === '.' ? 0 : c === '~' ? 1 : 2) as AvailabilityLevel);

describe('feasibleWindows', () => {
  it('全空时返回空数组', () => {
    expect(feasibleWindows(A('....'), 2)).toEqual([]);
  });

  it('需要 1 格时，每个非 0 格都是一个窗口', () => {
    expect(feasibleWindows(A('2.2'), 1)).toEqual([
      { start: 0, end: 0, weakCount: 0 },
      { start: 2, end: 2, weakCount: 0 },
    ]);
  });

  it('连续可行时分出多个滑动窗口', () => {
    // '222' 需要 2 格：可以是 [0,1] 或 [1,2]
    expect(feasibleWindows(A('222'), 2)).toEqual([
      { start: 0, end: 1, weakCount: 0 },
      { start: 1, end: 2, weakCount: 0 },
    ]);
  });

  it('窗口内遇到 0 就断开', () => {
    expect(feasibleWindows(A('22.22'), 2)).toEqual([
      { start: 0, end: 1, weakCount: 0 },
      { start: 3, end: 4, weakCount: 0 },
    ]);
  });

  it('允许「勉强」但记录数量', () => {
    expect(feasibleWindows(A('2~2'), 3)).toEqual([{ start: 0, end: 2, weakCount: 1 }]);
  });

  it('全是勉强时 weakCount 等于窗口长度', () => {
    expect(feasibleWindows(A('~~~'), 3)).toEqual([{ start: 0, end: 2, weakCount: 3 }]);
  });

  it('需要长度超过数组长度时返回空', () => {
    expect(feasibleWindows(A('222'), 4)).toEqual([]);
  });

  it('需要 0 格时返回空（无意义输入）', () => {
    expect(feasibleWindows(A('222'), 0)).toEqual([]);
  });

  it('空数组返回空', () => {
    expect(feasibleWindows([], 1)).toEqual([]);
  });

  it('刚好卡在末尾的窗口被包含', () => {
    expect(feasibleWindows(A('.22'), 2)).toEqual([{ start: 1, end: 2, weakCount: 0 }]);
  });

  it('同一段连续可行区里所有滑动窗口都返回', () => {
    // '2222' 需要 2：三个窗口
    expect(feasibleWindows(A('2222'), 2)).toEqual([
      { start: 0, end: 1, weakCount: 0 },
      { start: 1, end: 2, weakCount: 0 },
      { start: 2, end: 3, weakCount: 0 },
    ]);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/windows.test.ts`
Expected: FAIL — 找不到模块

- [ ] **Step 3: 实现**

```ts
// src/core/windows.ts
import type { AvailabilityLevel } from '../shared/types';

export interface Window {
  /** 起始槽位（含） */
  start: number;
  /** 结束槽位（含） */
  end: number;
  /** 窗口内「勉强」的格数，用于排序时惩罚 */
  weakCount: number;
}

/**
 * 找出所有长度为 needSlots、且不含「不行」的连续窗口。
 *
 * 允许「勉强」是有意的：真实场景里「我那天可能有点事」不该直接判死，
 * 但要在排序时被惩罚，让更干净的时间排前面。
 *
 * 复杂度 O(n)：一次线性扫描，用滑动窗口维护 weakCount。
 */
export function feasibleWindows(
  availability: AvailabilityLevel[],
  needSlots: number,
): Window[] {
  const n = availability.length;
  if (needSlots <= 0 || needSlots > n) return [];

  const out: Window[] = [];
  let weak = 0;

  for (let i = 0; i < needSlots; i++) if (availability[i] === 1) weak++;

  const hasZero = (start: number) => {
    for (let i = start; i < start + needSlots; i++) if (availability[i] === 0) return true;
    return false;
  };

  if (!hasZero(0)) out.push({ start: 0, end: needSlots - 1, weakCount: weak });

  for (let start = 1; start + needSlots <= n; start++) {
    // 滑出左边一格
    if (availability[start - 1] === 1) weak--;
    // 滑入右边一格
    if (availability[start + needSlots - 1] === 1) weak++;
    if (!hasZero(start)) out.push({ start, end: start + needSlots - 1, weakCount: weak });
  }

  return out;
}
```

**注：** 上面的 `hasZero` 内循环让复杂度退化到 O(n·k)。第 1 步的测试能过，但如果活动很长会慢。**Step 4 之后立刻做优化**：维护一个「窗口内 0 的个数」计数。

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/windows.test.ts`
Expected: PASS，11 个测试全绿

- [ ] **Step 5: 优化成 O(n)**

把 `hasZero` 的线性扫描换成计数器：

```ts
// src/core/windows.ts（替换 feasibleWindows 的函数体）
export function feasibleWindows(
  availability: AvailabilityLevel[],
  needSlots: number,
): Window[] {
  const n = availability.length;
  if (needSlots <= 0 || needSlots > n) return [];

  const out: Window[] = [];
  let weak = 0;
  let zeros = 0;

  for (let i = 0; i < needSlots; i++) {
    if (availability[i] === 1) weak++;
    else if (availability[i] === 0) zeros++;
  }
  if (zeros === 0) out.push({ start: 0, end: needSlots - 1, weakCount: weak });

  for (let start = 1; start + needSlots <= n; start++) {
    const outIdx = start - 1;
    const inIdx = start + needSlots - 1;
    if (availability[outIdx] === 1) weak--;
    else if (availability[outIdx] === 0) zeros--;
    if (availability[inIdx] === 1) weak++;
    else if (availability[inIdx] === 0) zeros++;
    if (zeros === 0) out.push({ start, end: inIdx, weakCount: weak });
  }

  return out;
}
```

- [ ] **Step 6: 再跑一次测试，确认优化没破坏行为**

Run: `npx vitest run tests/windows.test.ts`
Expected: PASS，仍然是 11 个测试全绿

- [ ] **Step 7: 提交**

```bash
git add src/core/windows.ts tests/windows.test.ts
git commit -m "feat(core): 单人可行时间窗口（允许勉强，滑动窗口 O(n)）"
```

---

### Task 6: 交叉方案矩阵 ★

**Files:**
- Create: `src/core/planner.ts`
- Test: `tests/planner.test.ts`

**这是整个产品的核心。** 输入所有人的可用性 + 所有目的地及投票，输出可直接执行的方案列表。

关键：**不再对每个窗口暴力枚举，只把「某人的可用段边界」当作候选起点。** 理由：任何最优窗口的起点，一定落在某个人的可用段起点上——否则往前挪一格不会损失任何人，说明原来那个不是最优。这把候选数从 O(K²) 降到 O(B)。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/planner.test.ts
import { describe, it, expect } from 'vitest';
import { buildPlans } from '../src/core/planner';
import type { AvailabilityLevel, VoteLevel } from '../src/shared/types';

// 简写：'.' 或 '0' = 不行，'~' 或 '1' = 勉强，其余（'2'）= 可以
const A = (s: string): AvailabilityLevel[] =>
  s
    .split('')
    .map((c) => (c === '.' || c === '0' ? 0 : c === '~' || c === '1' ? 1 : 2) as AvailabilityLevel);

/** 造一个测试用输入 */
function makeInput(opts: {
  slotCount: number;
  people: Array<{ id: string; avail: string; core?: boolean; responded?: boolean }>;
  dests: Array<{ id: string; days: number; votes: Record<string, VoteLevel> }>;
  coreOnly?: boolean;
}) {
  return {
    slotCount: opts.slotCount,
    coreOnly: opts.coreOnly ?? false,
    participants: opts.people.map((p) => ({
      id: p.id,
      name: p.id,
      isCore: p.core ?? false,
      availability: A(p.avail),
      responded: p.responded ?? true,
    })),
    destinations: opts.dests.map((d) => ({
      id: d.id,
      name: d.id,
      daysNeeded: d.days,
      budgetLevel: null,
      votes: d.votes,
    })),
  };
}

describe('buildPlans — 设计文档 §3.1 的那个反例', () => {
  // 小王、小李：想去云南(5天)，10/1-10/7 有空
  // 小张：想去莫干山(2天)，10/5-10/7 有空
  // 小赵：想去莫干山(2天)，10/1-10/7 有空
  const input = makeInput({
    slotCount: 7,
    people: [
      { id: '小王', avail: '2222222' },
      { id: '小李', avail: '2222222' },
      { id: '小张', avail: '....222' },
      { id: '小赵', avail: '2222222' },
    ],
    dests: [
      { id: '云南', days: 5, votes: { 小王: 2, 小李: 2, 小张: 0, 小赵: 0 } },
      { id: '莫干山', days: 2, votes: { 小王: 1, 小李: 1, 小张: 2, 小赵: 2 } },
    ],
  });

  it('冠军方案是四人全到的莫干山', () => {
    const plans = buildPlans(input);
    const top = plans[0];
    expect(top.destinationName).toBe('莫干山');
    expect(top.attendeeIds.sort()).toEqual(['小张', '小赵', '小王', '小李'].sort());
  });

  it('云南方案只有 2 人，且点名小张没空、小赵不想去', () => {
    const plans = buildPlans(input);
    const yunnan = plans.find((p) => p.destinationName === '云南')!;
    expect(yunnan.attendeeIds.sort()).toEqual(['小李', '小王'].sort());
    expect(yunnan.missing).toContainEqual({ participantId: '小张', name: '小张', reason: 'busy' });
    expect(yunnan.missing).toContainEqual({ participantId: '小赵', name: '小赵', reason: 'unwilling' });
  });

  it('方案按人数降序', () => {
    const plans = buildPlans(input);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i - 1].attendeeIds.length).toBeGreaterThanOrEqual(plans[i].attendeeIds.length);
    }
  });
});

describe('buildPlans — 基础行为', () => {
  it('没人投票的目的地不出现在方案里', () => {
    const input = makeInput({
      slotCount: 4,
      people: [{ id: 'a', avail: '2222' }],
      dests: [{ id: '无人区', days: 1, votes: { a: 0 } }],
    });
    const plans = buildPlans(input);
    expect(plans.every((p) => p.destinationName !== '无人区')).toBe(true);
  });

  it('需要天数超过活动范围的目的一律不可行', () => {
    const input = makeInput({
      slotCount: 3,
      people: [{ id: 'a', avail: '222' }],
      dests: [{ id: '太远', days: 10, votes: { a: 2 } }],
    });
    expect(buildPlans(input)).toEqual([]);
  });

  it('没填的人不算进分母，也不出现在 missing 里', () => {
    const input = makeInput({
      slotCount: 2,
      people: [
        { id: 'a', avail: '22' },
        { id: 'b', avail: '00', responded: false },
      ],
      dests: [{ id: 'x', days: 1, votes: { a: 2 } }],
    });
    const top = buildPlans(input)[0];
    expect(top.attendeeIds).toEqual(['a']);
    expect(top.missing.some((m) => m.participantId === 'b')).toBe(false);
  });

  it('参与者少于 3 人时直接给并排对照，不做方案枚举', () => {
    const input = makeInput({
      slotCount: 2,
      people: [{ id: 'a', avail: '22' }],
      dests: [{ id: 'x', days: 1, votes: { a: 2 } }],
    });
    const plans = buildPlans(input);
    expect(plans).toHaveLength(1);
    expect(plans[0].blockedReason).toBe('参与者不足 3 人，直接给出对照表');
  });

  it('时间完全不重叠时，给出每人单独成行的方案，而不是抛异常或返回空', () => {
    const input = makeInput({
      slotCount: 3,
      people: [
        { id: 'a', avail: '200' },
        { id: 'b', avail: '020' },
        { id: 'c', avail: '002' },
      ],
      dests: [{ id: 'x', days: 1, votes: { a: 2, b: 2, c: 2 } }],
    });
    const plans = buildPlans(input);
    expect(plans).toHaveLength(3);
    expect(plans.every((p) => p.attendeeIds.length === 1)).toBe(true);
  });
});

describe('buildPlans — 核心成员模式', () => {
  it('核心成员没全到的方案被标记为 blocked 并沉底', () => {
    const input = makeInput({
      slotCount: 4,
      coreOnly: true,
      people: [
        { id: '核心A', avail: '2222', core: true },
        { id: '核心B', avail: '22..', core: true },   // 只有前两格有空
        { id: '路人', avail: '2222' },
      ],
      dests: [{ id: 'x', days: 2, votes: { 核心A: 2, 核心B: 2, 路人: 2 } }],
    });
    const plans = buildPlans(input);

    // [0,1] 三个人都到 → 冠军
    expect(plans[0].attendeeIds).toHaveLength(3);
    expect(plans[0].blocked).toBe(false);

    // [1,2] 和 [2,3] 核心B 来不了 → blocked，排到后面
    const blockedOnes = plans.filter((p) => p.blocked);
    expect(blockedOnes.length).toBeGreaterThan(0);
    expect(blockedOnes[0].blockedReason).toContain('核心B');
    expect(plans[0].blocked).toBe(false);
  });
});

describe('buildPlans — 排序', () => {
  it('人数相同时，「勉强」更少的方案排前面', () => {
    const input = makeInput({
      slotCount: 6,
      people: [
        { id: 'a', avail: '2~..22' },   // [0,1] 里有一格勉强；[4,5] 干净
        { id: 'b', avail: '22..22' },
        { id: 'c', avail: '22..22' },
      ],
      dests: [{ id: 'x', days: 2, votes: { a: 2, b: 2, c: 2 } }],
    });
    const plans = buildPlans(input);
    // 两个方案都是 3 人，但 [4,5] 全员「可以」，[0,1] 有一格「勉强」→ [4,5] 排前面
    expect(plans[0].startSlot).toBe(4);
    expect(plans[0].weakCount).toBe(0);
  });
});

describe('buildPlans — 砍掉被支配的方案', () => {
  it('同目的地、人数更少、且能来的人完全被包含 → 不显示', () => {
    // a、b、c 全程有空；d 只有后三天有空
    // 莫干山(2天)：[4,5] 四人全到；[0,1] 等只有 a、b、c
    // 后者的人全是前者的子集 → 被支配 → 砍掉
    const input = makeInput({
      slotCount: 7,
      people: [
        { id: 'a', avail: '2222222' },
        { id: 'b', avail: '2222222' },
        { id: 'c', avail: '2222222' },
        { id: 'd', avail: '0000222' },
      ],
      dests: [{ id: '莫干山', days: 2, votes: { a: 2, b: 2, c: 2, d: 2 } }],
    });
    const plans = buildPlans(input);
    expect(plans).toHaveLength(1);
    expect(plans[0].attendeeIds).toHaveLength(4);
  });

  it('人群不是子集时不砍 —— 换人了就是不同的方案', () => {
    // a 只有前两天有空、c 只有后两天有空 → {a,b,d} 和 {b,c,d} 互不包含
    const input = makeInput({
      slotCount: 4,
      people: [
        { id: 'a', avail: '22..' },
        { id: 'b', avail: '2222' },
        { id: 'c', avail: '..22' },
        { id: 'd', avail: '2222' },
      ],
      dests: [{ id: 'x', days: 2, votes: { a: 2, b: 2, c: 2, d: 2 } }],
    });
    const plans = buildPlans(input);
    // {a,b,d} 和 {b,c,d} 都留；{b,d} 被两者支配 → 砍掉
    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.attendeeIds.length === 3)).toBe(true);
  });

  it('目的地不同就不构成支配 —— 人少的那个必须留着', () => {
    // §3.1 反例：莫干山 3 人方案被莫干山 4 人方案支配 → 砍
    // 但云南 2 人方案是【另一个目的地】→ 必须留，它是取舍的体现
    const input = makeInput({
      slotCount: 7,
      people: [
        { id: '小王', avail: '2222222' },
        { id: '小李', avail: '2222222' },
        { id: '小张', avail: '....222' },
        { id: '小赵', avail: '2222222' },
      ],
      dests: [
        { id: '云南', days: 5, votes: { 小王: 2, 小李: 2, 小张: 0, 小赵: 0 } },
        { id: '莫干山', days: 2, votes: { 小王: 1, 小李: 1, 小张: 2, 小赵: 2 } },
      ],
    });
    const plans = buildPlans(input);
    expect(plans).toHaveLength(2);
    expect(plans[0].destinationName).toBe('莫干山');
    expect(plans[0].attendeeIds).toHaveLength(4);
    expect(plans[1].destinationName).toBe('云南');
    expect(plans[1].attendeeIds).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/planner.test.ts`
Expected: FAIL — 找不到模块

- [ ] **Step 3: 实现**

```ts
// src/core/planner.ts
import type { AvailabilityLevel, PlanDto, VoteLevel } from '../shared/types';
import { feasibleWindows, type Window } from './windows';

export interface PlannerParticipant {
  id: string;
  name: string;
  isCore: boolean;
  availability: AvailabilityLevel[];
  responded: boolean;
}

export interface PlannerDestination {
  id: string;
  name: string;
  daysNeeded: number;
  budgetLevel: number | null;
  votes: Record<string, VoteLevel>;   // participantId -> level
}

export interface PlannerInput {
  slotCount: number;
  coreOnly: boolean;
  participants: PlannerParticipant[];
  destinations: PlannerDestination[];
}

/** 少于这个人数就不做方案枚举，直接给对照表 */
const MIN_FOR_PLANNING = 3;

/** 最多返回多少个方案 */
const MAX_PLANS = 8;

/**
 * 交叉方案矩阵。
 *
 * 不再对每个窗口暴力枚举：只把「某人的可行段起点」当作候选起点。
 * 因为任何最优窗口的起点一定落在某个人的可行段起点上 ——
 * 否则往前挪一格不会损失任何人。
 */
export function buildPlans(input: PlannerInput): PlanDto[] {
  const responded = input.participants.filter((p) => p.responded);

  if (responded.length === 0) return [];
  // 边界情况：人太少时算法没有价值，直接给对照表
  if (responded.length < MIN_FOR_PLANNING) return buildSimpleComparison(input, responded);

  // 预计算：每个人对每个目的地的可行窗口，按起点索引，方便 O(1) 查
  const windowCache = new Map<string, Map<number, Window>>();
  const candidateStarts = new Set<number>();
  for (const p of responded) {
    for (const d of input.destinations) {
      const byStart = new Map<number, Window>();
      for (const w of feasibleWindows(p.availability, d.daysNeeded)) {
        byStart.set(w.start, w);
        candidateStarts.add(w.start);
      }
      windowCache.set(`${p.id}|${d.id}`, byStart);
    }
  }

  const plans: PlanDto[] = [];

  for (const d of input.destinations) {
    for (const start of candidateStarts) {
      const end = start + d.daysNeeded - 1;
      if (end >= input.slotCount) continue;

      const attendeeIds: string[] = [];
      let weakCount = 0;

      // ★ 关键：能来一个算一个，不是「全员能来才算方案」。
      //   要求全员到齐会直接抹掉 subset 视图 —— 而那正是产品的差异化所在。
      for (const p of responded) {
        if ((d.votes[p.id] ?? 0) < 1) continue;               // 不想去的不进方案
        const hit = windowCache.get(`${p.id}|${d.id}`)?.get(start);
        if (!hit) continue;                                    // 来不了的跳过，不整体失败
        attendeeIds.push(p.id);
        weakCount += hit.weakCount;
      }

      if (attendeeIds.length === 0) continue;                   // 一个都来不了 → 不成方案

      attendeeIds.sort();
      const attendeeSet = new Set(attendeeIds);

      const missing: PlanDto['missing'] = [];
      for (const p of responded) {
        if (attendeeSet.has(p.id)) continue;
        // 时间原因优先于意愿原因：确实没空比「不想去」更硬，
        // 而且两者都成立时，「没空」对组织者更有用
        const hasWindow = windowCache.get(`${p.id}|${d.id}`)?.has(start) ?? false;
        missing.push({
          participantId: p.id,
          name: p.name,
          reason: hasWindow ? 'unwilling' : 'busy',
        });
      }

      const cores = responded.filter((p) => p.isCore);
      const missingCores = cores.filter((c) => !attendeeSet.has(c.id));
      const blocked = input.coreOnly && cores.length > 0 && missingCores.length > 0;

      plans.push({
        destinationId: d.id,
        destinationName: d.name,
        daysNeeded: d.daysNeeded,
        startSlot: start,
        endSlot: end,
        attendeeIds,
        weakCount,
        missing,
        blocked,
        blockedReason: blocked
          ? `核心成员 ${missingCores.map((c) => c.name).join('、')} 到不了`
          : undefined,
      });
    }
  }

  return rankAndTrim(dropDominated(mergeAdjacent(plans)));
}

/**
 * 砍掉「被支配」的方案。
 *
 * 方案 X 被方案 Y 支配，当且仅当同时满足：
 *   1. 同一个目的地
 *   2. 受阻状态相同（核心成员到没到）
 *   3. X 的人全都包含在 Y 的人里，且 Y 人更多
 *
 * 为什么可以砍：能去 X 的人一定能去 Y，而 Y 人更多 ——
 * X 没有提供任何 Y 没有的东西，留着只会占位置、干扰视线。
 *
 * 注意这个规则【不会】砍掉「另一个目的地的人少的方案」——
 * 目的地不同就不构成支配。那种方案是取舍的体现，必须留着。
 */
function dropDominated(plans: PlanDto[]): PlanDto[] {
  const entries = plans.map((plan) => ({ plan, crowd: new Set(plan.attendeeIds) }));

  const isSubset = (a: Set<string>, b: Set<string>) => {
    for (const x of a) if (!b.has(x)) return false;
    return true;
  };

  return entries
    .filter(
      (x) =>
        !entries.some(
          (y) =>
            y.plan !== x.plan &&
            y.plan.destinationId === x.plan.destinationId &&
            y.plan.blocked === x.plan.blocked &&
            y.crowd.size > x.crowd.size &&
            isSubset(x.crowd, y.crowd),
        ),
    )
    .map((e) => e.plan);
}

/**
 * 合并相邻且「人群完全相同」的窗口。
 *
 * 必须先按 (目的地, 是否核心受阻, 人群) 分组，组内按起始槽位排序再合并 ——
 * 不能直接对排好序的列表做相邻判断：排序键里有 weakCount，
 * 会让时间上不相邻的两个窗口在列表里挨在一起，一合就错。
 */
function mergeAdjacent(plans: PlanDto[]): PlanDto[] {
  const groups = new Map<string, PlanDto[]>();
  for (const p of plans) {
    const key = `${p.destinationId}|${p.blocked}|${p.attendeeIds.join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const out: PlanDto[] = [];
  for (const [, list] of groups) {
    list.sort((a, b) => a.startSlot - b.startSlot);
    let cur: PlanDto | null = null;
    for (const p of list) {
      if (cur && p.startSlot <= cur.endSlot + 1) {
        cur.endSlot = Math.max(cur.endSlot, p.endSlot);
        // 合并后取最优子窗口的 weakCount 作为排序代理值
        cur.weakCount = Math.min(cur.weakCount, p.weakCount);
        continue;
      }
      if (cur) out.push(cur);
      cur = { ...p };
    }
    if (cur) out.push(cur);
  }
  return out;
}

/**
 * 排序 → 裁剪。
 *
 * 排序优先级（设计文档 §8.2 第 5 步）：
 *   1. 核心受阻的沉底
 *   2. 人数降序
 *   3. 勉强格数升序
 *   4. 时间更早
 */
function rankAndTrim(plans: PlanDto[]): PlanDto[] {
  const sorted = [...plans].sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
    if (a.attendeeIds.length !== b.attendeeIds.length) {
      return b.attendeeIds.length - a.attendeeIds.length;
    }
    if (a.weakCount !== b.weakCount) return a.weakCount - b.weakCount;
    return a.startSlot - b.startSlot;
  });

  // 裁到 MAX_PLANS，但保证每个目的地至少留一个方案 ——
  // 让用户能看到「换个地方会怎样」，而不是被同一个地方刷屏
  const picked: PlanDto[] = [];
  for (const p of sorted) {
    if (picked.length < MAX_PLANS) { picked.push(p); continue; }
    if (!picked.some((x) => x.destinationId === p.destinationId)) picked.push(p);
  }
  return picked;
}

/**
 * 人少时（< 3 人）不做方案枚举，直接给一张并排对照表。
 * 两三个人的时候，算法算出来的东西人脑一眼就看完了。
 */
function buildSimpleComparison(input: PlannerInput, responded: PlannerParticipant[]): PlanDto[] {
  const out: PlanDto[] = [];
  for (const d of input.destinations) {
    const willing = responded.filter((p) => (d.votes[p.id] ?? 0) >= 1);
    if (willing.length === 0) continue;

    // 找到所有人都能到的最早窗口
    const first = feasibleWindows(willing[0].availability, d.daysNeeded)[0];
    if (!first) continue;

    const attendeeIds = willing
      .filter((p) => feasibleWindows(p.availability, d.daysNeeded).some((w) => w.start === first.start))
      .map((p) => p.id);

    out.push({
      destinationId: d.id,
      destinationName: d.name,
      daysNeeded: d.daysNeeded,
      startSlot: first.start,
      endSlot: first.end,
      attendeeIds,
      weakCount: first.weakCount,
      missing: responded
        .filter((p) => !attendeeIds.includes(p.id))
        .map((p) => ({
          participantId: p.id,
          name: p.name,
          reason: (d.votes[p.id] ?? 0) >= 1 ? ('busy' as const) : ('unwilling' as const),
        })),
      blocked: false,
      blockedReason: '参与者不足 3 人，直接给出对照表',
    });
  }
  return out;
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/planner.test.ts`
Expected: PASS，全部测试通过

**如果「冠军方案是四人全到的莫干山」这条失败**，检查 `rankAndTrim` 里人数排序那行 —— 这是设计文档 §3.1 反例的直接验证，必须过。

- [ ] **Step 5: 跑全部测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/core/planner.ts tests/planner.test.ts
git commit -m "feat(core): 交叉方案矩阵 —— 目的地 x 时间的可执行方案"
```

---

## Phase 2 · 数据层

### Task 7: 数据库 schema 与迁移

**Files:**
- Create: `src/server/schema.ts`
- Create: `migrations/0001_init.sql`
- Create: `drizzle.config.ts`

- [ ] **Step 1: 写 Drizzle schema**

```ts
// src/server/schema.ts
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  rangeStart: integer('range_start').notNull(),
  rangeEnd: integer('range_end').notNull(),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),
  granularity: text('granularity', { enum: ['day', 'half_day'] }).notNull().default('day'),
  collectDestinations: integer('collect_destinations', { mode: 'boolean' }).notNull().default(true),
  budgetEnabled: integer('budget_enabled', { mode: 'boolean' }).notNull().default(false),
  coreOnly: integer('core_only', { mode: 'boolean' }).notNull().default(false),
  anonymity: text('anonymity', { enum: ['open', 'vote_anonymous'] })
    .notNull()
    .default('open'),
  adminKeyHash: text('admin_key_hash').notNull(),
  finalizedPlan: text('finalized_plan'),
  createdAt: integer('created_at').notNull(),
});

export const participants = sqliteTable(
  'participants',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    token: text('token').notNull().unique(),
    isCore: integer('is_core', { mode: 'boolean' }).notNull().default(false),
    availability: text('availability').notNull().default(''),
    respondedAt: integer('responded_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({ eventIdx: index('participants_event_idx').on(t.eventId) }),
);

export const destinations = sqliteTable(
  'destinations',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    daysNeeded: integer('days_needed').notNull(),
    budgetLevel: integer('budget_level'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({ eventIdx: index('destinations_event_idx').on(t.eventId) }),
);

export const votes = sqliteTable(
  'votes',
  {
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.participantId, t.destinationId] }) }),
);
```

- [ ] **Step 2: 手写迁移 SQL**

不用 `drizzle-kit generate`（它对 D1 的支持时有摩擦，手写更可控）。**schema.ts 和这份 SQL 必须保持一致** —— 改一个就改另一个。

```sql
-- migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS events (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  range_start          INTEGER NOT NULL,
  range_end            INTEGER NOT NULL,
  timezone             TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  granularity          TEXT NOT NULL DEFAULT 'day',
  collect_destinations INTEGER NOT NULL DEFAULT 1,
  budget_enabled       INTEGER NOT NULL DEFAULT 0,
  core_only            INTEGER NOT NULL DEFAULT 0,
  anonymity            TEXT NOT NULL DEFAULT 'open',
  admin_key_hash       TEXT NOT NULL,
  finalized_plan       TEXT,
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  is_core       INTEGER NOT NULL DEFAULT 0,
  availability  TEXT NOT NULL DEFAULT '',
  responded_at  INTEGER,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS participants_event_idx ON participants(event_id);

CREATE TABLE IF NOT EXISTS destinations (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  days_needed  INTEGER NOT NULL,
  budget_level INTEGER,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS destinations_event_idx ON destinations(event_id);

CREATE TABLE IF NOT EXISTS votes (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  level          INTEGER NOT NULL,
  PRIMARY KEY (participant_id, destination_id)
);
```

- [ ] **Step 3: 创建 drizzle.config.ts**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/schema.ts',
  out: './migrations',
});
```

- [ ] **Step 4: 跑本地迁移**

Run: `npm run db:migrate:local`
Expected: 输出 `Migrations applied`，本地 `.wrangler/state` 下生成 SQLite 文件

- [ ] **Step 5: 验证表建出来了**

Run: `npx wrangler d1 execute heshihedi --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"`
Expected: 输出包含 `destinations`、`events`、`participants`、`votes`（另有 `d1_migrations` 和 `sqlite_sequence`）

- [ ] **Step 6: 提交**

```bash
git add src/server/schema.ts migrations/0001_init.sql drizzle.config.ts
git commit -m "feat(db): D1 schema 与初始迁移"
```

---

### Task 8: 工具函数

**Files:**
- Create: `src/server/ids.ts`
- Create: `src/server/db.ts`

- [ ] **Step 1: 写短 ID 与密钥生成**

```ts
// src/server/ids.ts

// 去掉容易看错的字符（0/O、1/l/I），因为活动 ID 要念给朋友听、要手打
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/** 生成 n 位短 ID，用于活动 ID（可读性优先） */
export function shortId(n = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** 生成 32 位随机 token，用于参与者认领和管理密钥（安全性优先，允许混淆字符） */
export function secret(n = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 对管理密钥做哈希后入库，避免明文泄露 */
export async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 恒定时间比较，防时序攻击 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 当前 Unix 秒 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}
```

- [ ] **Step 2: 写数据库客户端**

```ts
// src/server/db.ts
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export interface Env {
  DB: D1Database;
  ADMIN_SECRET: string;
}

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/server/ids.ts src/server/db.ts
git commit -m "feat(server): 短 ID、密钥哈希与 D1 客户端"
```

---

## Phase 3 · 后端 API

### Task 9: Worker 骨架与健康检查

**Files:**
- Create: `src/server/index.ts`
- Create: `src/client/index.html`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/index.css`

- [ ] **Step 1: 写设计令牌与基础样式**

一期只做基础样式，玻璃质感与动效在第二份计划里。

```css
/* src/client/index.css */
@import 'tailwindcss';

@theme {
  /* 中性暖灰 —— 基底，占全页 90% 面积 */
  --color-ink-50:  #fbfaf9;
  --color-ink-100: #f4f1ee;
  --color-ink-200: #e7e2dd;
  --color-ink-400: #a8a29e;
  --color-ink-600: #57534e;
  --color-ink-900: #1c1917;

  /* 靛蓝 —— 主色，只在 CTA 和热力图上出现 */
  --color-brand-100: #e0e7ff;
  --color-brand-300: #a5b4fc;
  --color-brand-500: #6366f1;
  --color-brand-600: #4f46e5;
  --color-brand-700: #4338ca;

  /* 琥珀 —— 只做「勉强可以」这一档状态 */
  --color-warm-400: #fbbf24;
  --color-warm-600: #d97706;

  --radius-card: 16px;
  --radius-btn: 12px;
}

html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--color-ink-50);
  color: var(--color-ink-900);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
               'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
}
/* 移动优先：手机上任何横向溢出都是 bug */
* { box-sizing: border-box; }
```

- [ ] **Step 2: 写 HTML 壳**

```html
<!-- src/client/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>何时何地</title>
    <meta name="description" content="什么时候有空，想去哪里 —— 一起定" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: 写 React 入口与路由**

```tsx
// src/client/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

```tsx
// src/client/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import CreatePage from './pages/CreatePage';
import FillPage from './pages/FillPage';
import ResultsPage from './pages/ResultsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/new" replace />} />
      <Route path="/new" element={<CreatePage />} />
      <Route path="/e/:id" element={<ResultsPage />} />
      <Route path="/e/:id/fill" element={<FillPage />} />
      <Route path="*" element={<Navigate to="/new" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 4: 写三个占位页面（先让它能编译）**

```tsx
// src/client/pages/CreatePage.tsx
export default function CreatePage() { return <main>创建活动</main>; }
```
```tsx
// src/client/pages/FillPage.tsx
export default function FillPage() { return <main>填写</main>; }
```
```tsx
// src/client/pages/ResultsPage.tsx
export default function ResultsPage() { return <main>结果</main>; }
```

- [ ] **Step 5: 写 Worker 入口**

```ts
// src/server/index.ts
import { Hono } from 'hono';
import type { Env } from './db';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, ts: Math.floor(Date.now() / 1000) }));

export default app;
```

- [ ] **Step 6: 启动开发服务器并验证**

Run: `npm run dev`
Expected: 终端输出本地地址（形如 `http://localhost:5173`）

在浏览器打开该地址 `/api/health`，Expected: `{"ok":true,"ts":...}`

打开根地址，Expected: 页面显示「创建活动」

- [ ] **Step 7: 提交**

```bash
git add src/server/index.ts src/client tests
git commit -m "feat: Worker 骨架 + 前端路由骨架 + 设计令牌"
```

---

### Task 10: 活动 API

**Files:**
- Create: `src/server/routes/events.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: 写活动路由**

```ts
// src/server/routes/events.ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { events, participants, destinations, votes } from '../schema';
import { getDb, type Env } from '../db';
import { shortId, secret, hashKey, now } from '../ids';
import { slotCountFor } from '../../core/slots';
import type {
  CreateEventRequest, CreateEventResponse, EventDetailResponse, Granularity,
} from '../../shared/types';

export const eventsRoute = new Hono<{ Bindings: Env }>();

const VALID_GRANULARITY: Granularity[] = ['day', 'half_day'];

/** 建活动 */
eventsRoute.post('/api/events', async (c) => {
  const body = await c.req.json<CreateEventRequest>();

  // 校验
  if (!body.title?.trim()) return c.json({ error: '活动名称不能为空' }, 400);
  if (!Number.isFinite(body.rangeStart) || !Number.isFinite(body.rangeEnd)) {
    return c.json({ error: '时间范围不合法' }, 400);
  }
  if (body.rangeEnd < body.rangeStart) return c.json({ error: '结束日期不能早于开始日期' }, 400);
  if (!VALID_GRANULARITY.includes(body.granularity)) {
    return c.json({ error: '时间粒度不合法' }, 400);
  }
  const slotCount = slotCountFor(body.rangeStart, body.rangeEnd, body.granularity);
  if (slotCount < 1) return c.json({ error: '时间范围太短' }, 400);

  const db = getDb(c.env);
  const id = shortId(6);
  const adminKey = secret(32);

  await db.insert(events).values({
    id,
    title: body.title.trim(),
    rangeStart: body.rangeStart,
    rangeEnd: body.rangeEnd,
    timezone: 'Asia/Shanghai',
    granularity: body.granularity,
    collectDestinations: body.collectDestinations ?? true,
    budgetEnabled: body.budgetEnabled ?? false,
    coreOnly: body.coreOnly ?? false,
    anonymity: body.anonymity ?? 'open',
    adminKeyHash: await hashKey(adminKey),
    finalizedPlan: null,
    createdAt: now(),
  });

  return c.json<CreateEventResponse>({ eventId: id, adminKey });
});

/** 读活动全貌（参与者、目的地、投票） */
eventsRoute.get('/api/events/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');

  const eventRows = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (eventRows.length === 0) return c.json({ error: '活动不存在' }, 404);
  const event = eventRows[0];

  const [participantRows, destinationRows, voteRows] = await Promise.all([
    db.select().from(participants).where(eq(participants.eventId, id)),
    db.select().from(destinations).where(eq(destinations.eventId, id)),
    db.select().from(votes),
  ]);

  // 只保留属于本活动的投票
  const destIds = new Set(destinationRows.map((d) => d.id));
  const scopedVotes = voteRows.filter((v) => destIds.has(v.destinationId));

  return c.json<EventDetailResponse>({
    event,
    slotCount: slotCountFor(event.rangeStart, event.rangeEnd, event.granularity),
    participants: participantRows,
    destinations: destinationRows,
    votes: scopedVotes,
  });
});
```

**注意 `adminKeyHash` 绝不出现在任何响应里。** `EventDetailResponse` 里直接返回整个 `event` 行会带上 `adminKeyHash`。Step 2 要修掉这个问题。

- [ ] **Step 2: 从响应里剥掉管理密钥哈希**

在 `eventsRoute.get` 的返回处，把 `event` 换成脱敏版本：

```ts
// 替换 events.ts 中 return c.json<EventDetailResponse>({...}) 里的 event 字段
const { adminKeyHash: _omit, ...safeEvent } = event;

return c.json<EventDetailResponse>({
  event: safeEvent as typeof event,
  slotCount: slotCountFor(event.rangeStart, event.rangeEnd, event.granularity),
  participants: participantRows,
  destinations: destinationRows,
  votes: scopedVotes,
});
```

- [ ] **Step 3: 挂到 Worker 入口**

```ts
// src/server/index.ts（完整替换）
import { Hono } from 'hono';
import type { Env } from './db';
import { eventsRoute } from './routes/events';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, ts: Math.floor(Date.now() / 1000) }));
app.route('/', eventsRoute);

export default app;
```

- [ ] **Step 4: 手工验证建活动**

Run: `npm run dev`，然后在另一个终端：

```bash
curl -s -X POST http://localhost:5173/api/events \
  -H 'Content-Type: application/json' \
  -d '{"title":"国庆出去玩","rangeStart":1759248000,"rangeEnd":1759766400,"granularity":"day","collectDestinations":true,"budgetEnabled":false,"coreOnly":false,"anonymity":"open"}'
```

Expected: `{"eventId":"xxxxxx","adminKey":"..."}`

- [ ] **Step 5: 验证读活动，且响应里没有 adminKeyHash**

```bash
curl -s http://localhost:5173/api/events/<上一步的eventId>
```

Expected: 返回 `event`、`slotCount: 7`、空的 `participants`/`destinations`/`votes` 数组
**且 `event` 对象里没有 `adminKeyHash` 字段。**

- [ ] **Step 6: 提交**

```bash
git add src/server/routes/events.ts src/server/index.ts
git commit -m "feat(api): 建活动与读活动（响应脱敏 adminKeyHash）"
```

---

### Task 11: 参与者 API

**Files:**
- Create: `src/server/routes/participants.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: 写参与者路由**

```ts
// src/server/routes/participants.ts
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { events, participants, destinations, votes } from '../schema';
import { getDb, type Env } from '../db';
import { shortId, secret, now } from '../ids';
import { slotCountFor } from '../../core/slots';
import { encodeAvailability } from '../../core/bitmap';
import type { JoinRequest, JoinResponse, SubmitRequest } from '../../shared/types';

export const participantsRoute = new Hono<{ Bindings: Env }>();

/** 加入活动：新加入或凭 token 回来改 */
participantsRoute.post('/api/events/:id/join', async (c) => {
  const db = getDb(c.env);
  const eventId = c.req.param('id');
  const body = await c.req.json<JoinRequest>();

  if (!body.name?.trim()) return c.json({ error: '名字不能为空' }, 400);

  const eventRows = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (eventRows.length === 0) return c.json({ error: '活动不存在' }, 404);

  // 带 token = 回来改的
  if (body.token) {
    const existing = await db
      .select()
      .from(participants)
      .where(eq(participants.token, body.token))
      .limit(1);
    if (existing.length > 0 && existing[0].eventId === eventId) {
      const p = existing[0];
      if (p.name !== body.name.trim()) {
        await db
          .update(participants)
          .set({ name: body.name.trim(), updatedAt: now() })
          .where(eq(participants.id, p.id));
      }
      return c.json<JoinResponse>({ participantId: p.id, token: p.token, name: body.name.trim() });
    }
  }

  // 重名处理：同活动里已经有人叫这个名字 → 提示换一个
  const sameName = await db
    .select()
    .from(participants)
    .where(and(eq(participants.eventId, eventId), eq(participants.name, body.name.trim())));
  if (sameName.length > 0) {
    return c.json({ error: '这个活动里已经有人叫这个名字了，换一个吧' }, 409);
  }

  const id = shortId(8);
  const token = secret(24);
  await db.insert(participants).values({
    id,
    eventId,
    name: body.name.trim(),
    token,
    isCore: false,
    availability: '',
    respondedAt: null,
    updatedAt: now(),
  });

  return c.json<JoinResponse>({ participantId: id, token, name: body.name.trim() });
});

/** 提交时间与投票 */
participantsRoute.post('/api/events/:id/submit', async (c) => {
  const db = getDb(c.env);
  const eventId = c.req.param('id');
  const body = await c.req.json<SubmitRequest>();

  const rows = await db.select().from(participants).where(eq(participants.token, body.token)).limit(1);
  if (rows.length === 0 || rows[0].eventId !== eventId) {
    return c.json({ error: '凭证无效，请重新打开链接' }, 403);
  }
  const me = rows[0];

  const eventRows = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  const event = eventRows[0];
  const slotCount = slotCountFor(event.rangeStart, event.rangeEnd, event.granularity);

  if (!Array.isArray(body.availability) || body.availability.length !== slotCount) {
    return c.json({ error: `需要 ${slotCount} 个时间格，收到 ${body.availability?.length ?? 0} 个` }, 400);
  }
  for (const v of body.availability) {
    if (v !== 0 && v !== 1 && v !== 2) return c.json({ error: '时间格取值必须是 0/1/2' }, 400);
  }

  const ts = now();
  await db
    .update(participants)
    .set({
      name: body.name?.trim() || me.name,
      availability: encodeAvailability(body.availability),
      respondedAt: me.respondedAt ?? ts,
      updatedAt: ts,
    })
    .where(eq(participants.id, me.id));

  // 覆盖式写入投票
  await db.delete(votes).where(eq(votes.participantId, me.id));
  const validLevels = new Set([0, 1, 2]);
  const toInsert = (body.votes ?? [])
    .filter((v) => validLevels.has(v.level))
    .map((v) => ({ participantId: me.id, destinationId: v.destinationId, level: v.level }));
  if (toInsert.length > 0) {
    // 只保留确实属于本活动的目的地
    const dests = await db.select().from(destinations).where(eq(destinations.eventId, eventId));
    const okIds = new Set(dests.map((d) => d.id));
    await db.insert(votes).values(toInsert.filter((v) => okIds.has(v.destinationId)));
  }

  return c.json({ ok: true, respondedAt: me.respondedAt ?? ts });
});
```

- [ ] **Step 2: 挂到入口**

```ts
// src/server/index.ts
import { Hono } from 'hono';
import type { Env } from './db';
import { eventsRoute } from './routes/events';
import { participantsRoute } from './routes/participants';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, ts: Math.floor(Date.now() / 1000) }));
app.route('/', eventsRoute);
app.route('/', participantsRoute);

export default app;
```

- [ ] **Step 3: 手工验证加入**

```bash
curl -s -X POST http://localhost:5173/api/events/<eventId>/join \
  -H 'Content-Type: application/json' -d '{"name":"小王"}'
```
Expected: `{"participantId":"...","token":"...","name":"小王"}`

- [ ] **Step 4: 手工验证重名被拦**

```bash
curl -s -X POST http://localhost:5173/api/events/<eventId>/join \
  -H 'Content-Type: application/json' -d '{"name":"小王"}'
```
Expected: `{"error":"这个活动里已经有人叫这个名字了，换一个吧"}`（HTTP 409）

- [ ] **Step 5: 提交**

```bash
git add src/server/routes/participants.ts src/server/index.ts
git commit -m "feat(api): 参与者加入、重名拦截、提交时间与投票"
```

---

### Task 12: 目的地 API

**Files:**
- Create: `src/server/routes/destinations.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: 写目的地路由**

```ts
// src/server/routes/destinations.ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { events, participants, destinations } from '../schema';
import { getDb, type Env } from '../db';
import { shortId, now } from '../ids';
import type { NominateDestinationRequest } from '../../shared/types';

export const destinationsRoute = new Hono<{ Bindings: Env }>();

/** 提名一个目的地 */
destinationsRoute.post('/api/events/:id/destinations', async (c) => {
  const db = getDb(c.env);
  const eventId = c.req.param('id');
  const body = await c.req.json<NominateDestinationRequest>();

  const rows = await db.select().from(participants).where(eq(participants.token, body.token)).limit(1);
  if (rows.length === 0 || rows[0].eventId !== eventId) {
    return c.json({ error: '凭证无效，请重新打开链接' }, 403);
  }

  const name = body.name?.trim();
  if (!name) return c.json({ error: '目的地名称不能为空' }, 400);
  if (!Number.isInteger(body.daysNeeded) || body.daysNeeded < 1) {
    return c.json({ error: '需要几天必须是正整数' }, 400);
  }

  const eventRows = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  const event = eventRows[0];
  if (event.collectDestinations === false) {
    return c.json({ error: '这个活动不收集目的地' }, 400);
  }

  // 同名合并：不新建，避免「大理」「大理 」变成两个选项
  const existing = await db
    .select()
    .from(destinations)
    .where(eq(destinations.eventId, eventId));
  const dup = existing.find((d) => d.name === name);
  if (dup) {
    return c.json({ destinationId: dup.id, name: dup.name, merged: true });
  }

  const id = shortId(8);
  await db.insert(destinations).values({
    id,
    eventId,
    name,
    daysNeeded: body.daysNeeded,
    budgetLevel: body.budgetLevel ?? null,
    createdBy: rows[0].id,
    createdAt: now(),
  });

  return c.json({ destinationId: id, name, merged: false });
});
```

- [ ] **Step 2: 挂到入口**

```ts
// src/server/index.ts
import { Hono } from 'hono';
import type { Env } from './db';
import { eventsRoute } from './routes/events';
import { participantsRoute } from './routes/participants';
import { destinationsRoute } from './routes/destinations';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, ts: Math.floor(Date.now() / 1000) }));
app.route('/', eventsRoute);
app.route('/', participantsRoute);
app.route('/', destinationsRoute);

export default app;
```

- [ ] **Step 3: 手工验证提名与同名合并**

```bash
curl -s -X POST http://localhost:5173/api/events/<eventId>/destinations \
  -H 'Content-Type: application/json' \
  -d '{"token":"<小王token>","name":"云南","daysNeeded":5}'
```
Expected: `{"destinationId":"...","name":"云南","merged":false}`

再跑一次同样的命令，Expected: `{"destinationId":"<与上次相同>","name":"云南","merged":true}`

- [ ] **Step 4: 提交**

```bash
git add src/server/routes/destinations.ts src/server/index.ts
git commit -m "feat(api): 目的地提名与同名合并"
```

---

### Task 13: 结果 API

**Files:**
- Create: `src/server/routes/results.ts`
- Modify: `src/server/index.ts`

把数据库里的行喂给 `buildPlans`，返回方案列表。

- [ ] **Step 1: 写结果路由**

```ts
// src/server/routes/results.ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { events, participants, destinations, votes } from '../schema';
import { getDb, type Env } from '../db';
import { slotCountFor, allSlotStarts } from '../../core/slots';
import { decodeAvailability } from '../../core/bitmap';
import { buildPlans, type PlannerDestination } from '../../core/planner';
import type { ResultsResponse, VoteLevel } from '../../shared/types';

export const resultsRoute = new Hono<{ Bindings: Env }>();

resultsRoute.get('/api/events/:id/results', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');

  const eventRows = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (eventRows.length === 0) return c.json({ error: '活动不存在' }, 404);
  const event = eventRows[0];

  const [participantRows, destinationRows, voteRows] = await Promise.all([
    db.select().from(participants).where(eq(participants.eventId, id)),
    db.select().from(destinations).where(eq(destinations.eventId, id)),
    db.select().from(votes),
  ]);

  const slotCount = slotCountFor(event.rangeStart, event.rangeEnd, event.granularity);
  const destIds = new Set(destinationRows.map((d) => d.id));
  const scopedVotes = voteRows.filter((v) => destIds.has(v.destinationId));

  const plans = buildPlans({
    slotCount,
    coreOnly: event.coreOnly,
    participants: participantRows.map((p) => ({
      id: p.id,
      name: p.name,
      isCore: p.isCore,
      availability: decodeAvailability(p.availability, slotCount),
      responded: p.respondedAt !== null,
    })),
    destinations: destinationRows.map<PlannerDestination>((d) => ({
      id: d.id,
      name: d.name,
      daysNeeded: d.daysNeeded,
      budgetLevel: d.budgetLevel,
      votes: Object.fromEntries(
        scopedVotes
          .filter((v) => v.destinationId === d.id)
          .map((v) => [v.participantId, v.level as VoteLevel]),
      ),
    })),
  });

  const respondedCount = participantRows.filter((p) => p.respondedAt !== null).length;

  // 找出「一个方案都没产出」的目的地，单独说明原因，不让它们无声消失
  const plannedDestIds = new Set(plans.map((p) => p.destinationId));
  const unreachable = destinationRows
    .filter((d) => !plannedDestIds.has(d.id))
    .map((d) => ({
      destinationId: d.id,
      name: d.name,
      reason:
        d.daysNeeded > slotCount
          ? `需要 ${d.daysNeeded} 天，但活动范围只有 ${slotCount} 天`
          : '这段时间内没人能凑出足够的天数',
    }));

  return c.json<ResultsResponse>({
    plans,
    slotCount,
    respondedCount,
    totalCount: participantRows.length,
    notResponded: participantRows
      .filter((p) => p.respondedAt === null)
      .map((p) => ({ id: p.id, name: p.name })),
    slotStarts: allSlotStarts(event.rangeStart, slotCount, event.granularity),
    unreachable,
  });
});
```

- [ ] **Step 2: 挂到入口**

```ts
// src/server/index.ts
import { Hono } from 'hono';
import type { Env } from './db';
import { eventsRoute } from './routes/events';
import { participantsRoute } from './routes/participants';
import { destinationsRoute } from './routes/destinations';
import { resultsRoute } from './routes/results';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, ts: Math.floor(Date.now() / 1000) }));
app.route('/', eventsRoute);
app.route('/', participantsRoute);
app.route('/', destinationsRoute);
app.route('/', resultsRoute);

export default app;
```

- [ ] **Step 3: 端到端手工验证设计文档 §3.1 的反例**

建一个 7 天的活动，然后依次加入四个人并提交。用 curl：

```bash
EID=<eventId>
for n in 小王 小李 小张 小赵; do
  curl -s -X POST http://localhost:5173/api/events/$EID/join \
    -H 'Content-Type: application/json' -d "{\"name\":\"$n\"}"
done
```

记下每人返回的 token，然后逐个提交（`avail` 是 7 位 0/1/2 串）：

- 小王、小李、小赵：`2222222`
- 小张：`0000222`

```bash
# 云南（需要 5 天）
curl -s -X POST http://localhost:5173/api/events/$EID/destinations \
  -H 'Content-Type: application/json' \
  -d '{"token":"<小王token>","name":"云南","daysNeeded":5}'
# 莫干山（需要 2 天）
curl -s -X POST http://localhost:5173/api/events/$EID/destinations \
  -H 'Content-Type: application/json' \
  -d '{"token":"<小张token>","name":"莫干山","daysNeeded":2}'
```

提交示例（小王）：

```bash
curl -s -X POST http://localhost:5173/api/events/$EID/submit \
  -H 'Content-Type: application/json' \
  -d '{"token":"<小王token>","name":"小王","availability":[2,2,2,2,2,2,2],
       "votes":[{"destinationId":"<云南id>","level":2},{"destinationId":"<莫干山id>","level":1}]}'
```

四人都提交后：

```bash
curl -s http://localhost:5173/api/events/$EID/results | python -m json.tool
```

Expected:
- `plans[0].destinationName` 是 `"莫干山"`
- `plans[0].attendeeIds` 有 4 个人
- 云南方案的 `missing` 里，小张是 `busy`、小赵是 `unwilling`

**这是整个计划里最重要的一次验证。** 如果这里不对，说明核心模型没实现对。

- [ ] **Step 4: 提交**

```bash
git add src/server/routes/results.ts src/server/index.ts
git commit -m "feat(api): 结果接口 —— 接上交叉方案矩阵"
```

---

## Phase 4 · 前端

### Task 14: API 客户端与本地存储

**Files:**
- Create: `src/client/lib/api.ts`
- Create: `src/client/lib/storage.ts`

- [ ] **Step 1: 写 API 客户端**

```ts
// src/client/lib/api.ts
import type {
  CreateEventRequest, CreateEventResponse, EventDetailResponse,
  JoinResponse, SubmitRequest, NominateDestinationRequest, ResultsResponse,
} from '../../shared/types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `请求失败（${res.status}）`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  createEvent: (body: CreateEventRequest) =>
    req<CreateEventResponse>('/api/events', { method: 'POST', body: JSON.stringify(body) }),

  getEvent: (id: string) => req<EventDetailResponse>(`/api/events/${id}`),

  join: (id: string, name: string, token?: string) =>
    req<JoinResponse>(`/api/events/${id}/join`, {
      method: 'POST', body: JSON.stringify({ name, token }),
    }),

  submit: (id: string, body: SubmitRequest) =>
    req<{ ok: true; respondedAt: number }>(`/api/events/${id}/submit`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  nominate: (id: string, body: NominateDestinationRequest) =>
    req<{ destinationId: string; name: string; merged: boolean }>(
      `/api/events/${id}/destinations`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  results: (id: string) => req<ResultsResponse>(`/api/events/${id}/results`),
};
```

- [ ] **Step 2: 写本地存储**

```ts
// src/client/lib/storage.ts

const K_NAME = 'hh_name';
const K_MY_EVENTS = 'hh_my_events';      // [{ eventId, adminKey, title }]
const K_PARTICIPATION = 'hh_participation'; // { [eventId]: { token, participantId, name } }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 无痕模式，忽略 */ }
}

/** 记住名字，下次填别的活动不用重打 */
export const getName = () => read<string>(K_NAME, '');
export const setName = (n: string) => write(K_NAME, n);

export interface MyEvent { eventId: string; adminKey: string; title: string; createdAt: number }

export function addMyEvent(e: MyEvent) {
  const list = read<MyEvent[]>(K_MY_EVENTS, []).filter((x) => x.eventId !== e.eventId);
  write(K_MY_EVENTS, [e, ...list]);
}
export const getMyEvents = () => read<MyEvent[]>(K_MY_EVENTS, []);

export interface Participation { token: string; participantId: string; name: string }

export function getParticipation(eventId: string): Participation | null {
  return read<Record<string, Participation>>(K_PARTICIPATION, {})[eventId] ?? null;
}
export function setParticipation(eventId: string, p: Participation) {
  const all = read<Record<string, Participation>>(K_PARTICIPATION, {});
  all[eventId] = p;
  write(K_PARTICIPATION, all);
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/client/lib
git commit -m "feat(client): API 客户端与本地存储"
```

---

### Task 15: 时间网格组件 ★

**Files:**
- Create: `src/client/components/TimeGrid.tsx`

这是 90% 的人唯一会操作的东西，必须做到零学习成本。

关键实现点：
- **用 Pointer Events**（`setPointerCapture`），一套代码同时处理鼠标和触摸
- **`touch-action: none`** 阻止手机上的滚动手势打断涂抹
- **拖拽语义用 linear（按时间顺序）而不是矩形框选** —— 手机上矩形框选误触严重
- **三态循环**：点一下「可以」→ 再点「勉强」→ 再点「不行」

- [ ] **Step 1: 写组件**

```tsx
// src/client/components/TimeGrid.tsx
import { useCallback, useRef, useState } from 'react';
import type { AvailabilityLevel, Granularity } from '../../shared/types';

interface Props {
  slotCount: number;
  granularity: Granularity;
  slotStarts: number[];                 // 每格起始时刻（Unix 秒）
  value: AvailabilityLevel[];
  onChange: (next: AvailabilityLevel[]) => void;
  /** 只读模式：结果页看别人涂的 */
  readOnly?: boolean;
  /** 只读模式下每格显示的人数占比 0–1 */
  heat?: number[];
}

const COLORS: Record<AvailabilityLevel, string> = {
  0: 'bg-ink-100 border-ink-200',
  1: 'bg-[var(--color-warm-400)] border-[var(--color-warm-600)]',
  2: 'bg-brand-500 border-brand-700',
};

/** 北京时间下的「日」和「上午/下午」 */
function labelOf(ts: number, granularity: Granularity): { day: string; part: string } {
  const d = new Date((ts + 8 * 3600) * 1000);
  const day = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  const part = granularity === 'half_day' ? (ts % 86400 === 0 ? '上午' : '下午') : '';
  return { day, part };
}

export default function TimeGrid({
  slotCount, granularity, slotStarts, value, onChange, readOnly = false, heat,
}: Props) {
  const dragging = useRef(false);
  // 一次拖拽里所有划过的格子统一设成同一个值，
  // 否则「想要可以」的拖拽会在碰到已有的 2 时把它循环成 0
  const dragValue = useRef<AvailabilityLevel>(2);
  const [, forceRender] = useState(0);

  const apply = useCallback((index: number) => {
    if (readOnly) return;
    const next = [...value];
    if (next[index] === dragValue.current) return;
    next[index] = dragValue.current;
    onChange(next);
  }, [value, onChange, readOnly]);

  const cycle = useCallback((index: number): AvailabilityLevel => {
    const cur = value[index];
    return cur === 2 ? 1 : cur === 1 ? 0 : 2;
  }, [value]);

  const onPointerDown = (index: number) => (e: React.PointerEvent) => {
    if (readOnly) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragging.current = true;
    dragValue.current = cycle(index);
    const next = [...value];
    next[index] = dragValue.current;
    onChange(next);
    forceRender((n) => n + 1);
  };

  const onPointerEnter = (index: number) => () => {
    if (!dragging.current || readOnly) return;
    apply(index);
  };

  const stop = () => { dragging.current = false; };

  return (
    <div
      className="select-none"
      style={{ touchAction: readOnly ? 'auto' : 'none' }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
    >
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.min(slotCount, 14)}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: slotCount }, (_, i) => {
          const { day } = labelOf(slotStarts[i], granularity);
          const level = value[i] ?? 0;
          const heatPct = heat ? Math.round(heat[i] * 100) : null;
          return (
            <button
              key={i}
              type="button"
              aria-label={`${day} ${granularity === 'half_day' ? (slotStarts[i] % 86400 === 0 ? '上午' : '下午') : ''}`}
              onPointerDown={onPointerDown(i)}
              onPointerEnter={onPointerEnter(i)}
              className={[
                'relative aspect-square rounded-md border transition',
                readOnly && heat
                  ? 'border-transparent'
                  : `${COLORS[level]} ${readOnly ? '' : 'active:scale-95'}`,
                readOnly ? 'cursor-default' : 'cursor-pointer',
              ].join(' ')}
              style={
                readOnly && heat
                  ? { background: `color-mix(in srgb, var(--color-brand-500) ${heatPct}%, var(--color-ink-100))` }
                  : undefined
              }
            >
              <span className="absolute inset-x-0 -top-4 text-[10px] text-ink-400">{day}</span>
            </button>
          );
        })}
      </div>

      {!readOnly && (
        <div className="mt-6 flex flex-wrap gap-4 text-xs text-ink-600">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-brand-700 bg-brand-500" /> 可以
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-[var(--color-warm-600)] bg-[var(--color-warm-400)]" /> 勉强
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-ink-200 bg-ink-100" /> 不行
          </span>
          <span className="text-ink-400">点一下切换，按住划过去可以连涂</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 3: 手工验证涂抹**

在 `FillPage` 里临时渲染一个 `<TimeGrid>`（下一步会正式写），用 `npm run dev` 打开：
- 点一格 → 变靛蓝（可以）
- 再点 → 变琥珀（勉强）
- 再点 → 变灰（不行）
- 按住拖动 → 划过的格子全部变成同一个状态
- 手机上（或用浏览器设备模拟）拖动不会触发页面滚动

- [ ] **Step 4: 提交**

```bash
git add src/client/components/TimeGrid.tsx
git commit -m "feat(client): 涂抹式时间网格（Pointer Events + 三态循环）"
```

---

### Task 16: 填写页

**Files:**
- Create: `src/client/components/DestinationPicker.tsx`
- Create: `src/client/pages/FillPage.tsx`

- [ ] **Step 1: 写目的地选择组件**

```tsx
// src/client/components/DestinationPicker.tsx
import { useState } from 'react';
import type { DestinationRow, VoteLevel } from '../../shared/types';

const LABELS: Record<VoteLevel, string> = { 2: '想去', 1: '都行', 0: '不想去' };

interface Props {
  destinations: DestinationRow[];
  votes: Record<string, VoteLevel>;
  onVote: (destinationId: string, level: VoteLevel) => void;
  onNominate: (name: string, daysNeeded: number) => Promise<void>;
  budgetEnabled: boolean;
}

export default function DestinationPicker({
  destinations, votes, onVote, onNominate, budgetEnabled,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submitNew() {
    if (!name.trim()) return;
    setBusy(true); setErr('');
    try {
      await onNominate(name.trim(), days);
      setName(''); setDays(2); setAdding(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '提名失败');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {destinations.map((d) => {
        const cur = votes[d.id];
        return (
          <div key={d.id} className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="font-medium">{d.name}</span>
              <span className="text-xs text-ink-400">
                需要 {d.daysNeeded} 天{budgetEnabled && d.budgetLevel ? ` · 预算第 ${d.budgetLevel} 档` : ''}
              </span>
            </div>
            <div className="flex gap-2">
              {([2, 1, 0] as VoteLevel[]).map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => onVote(d.id, lv)}
                  className={[
                    'flex-1 rounded-[var(--radius-btn)] border px-3 py-2 text-sm transition',
                    cur === lv
                      ? lv === 2
                        ? 'border-brand-700 bg-brand-500 text-white'
                        : lv === 1
                          ? 'border-ink-400 bg-ink-100 text-ink-900'
                          : 'border-ink-400 bg-ink-200 text-ink-600'
                      : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400',
                  ].join(' ')}
                >
                  {LABELS[lv]}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {adding ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-brand-300 bg-brand-100/40 p-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="想去哪儿？"
            className="mb-3 w-full rounded-[var(--radius-btn)] border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <label className="mb-3 block text-xs text-ink-600">
            大概要去几天
            <input
              type="number" min={1} max={60} value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
              className="ml-2 w-16 rounded border border-ink-200 px-2 py-1 text-sm"
            />
          </label>
          {err && <p className="mb-2 text-xs text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button" onClick={submitNew} disabled={busy || !name.trim()}
              className="rounded-[var(--radius-btn)] bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy ? '提交中…' : '加上'}
            </button>
            <button
              type="button" onClick={() => { setAdding(false); setErr(''); }}
              className="rounded-[var(--radius-btn)] border border-ink-200 px-4 py-2 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button" onClick={() => setAdding(true)}
          className="w-full rounded-[var(--radius-card)] border border-dashed border-ink-400 py-3 text-sm text-ink-600 hover:border-brand-500 hover:text-brand-600"
        >
          + 提一个自己想去的地方
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 写填写页**

```tsx
// src/client/pages/FillPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getName, setName, getParticipation, setParticipation } from '../lib/storage';
import { allSlotStarts } from '../../core/slots';
import TimeGrid from '../components/TimeGrid';
import DestinationPicker from '../components/DestinationPicker';
import type {
  AvailabilityLevel, EventDetailResponse, VoteLevel,
} from '../../shared/types';

export default function FillPage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<EventDetailResponse | null>(null);
  const [name, setNameState] = useState(getName() || search.get('name') || '');
  const [availability, setAvailability] = useState<AvailabilityLevel[]>([]);
  const [votes, setVotes] = useState<Record<string, VoteLevel>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const participation = getParticipation(id);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.getEvent(id);
        if (!alive) return;
        setDetail(d);
        setAvailability(new Array(d.slotCount).fill(0) as AvailabilityLevel[]);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const slotStarts = useMemo(
    () => (detail ? allSlotStarts(detail.event.rangeStart, detail.slotCount, detail.event.granularity) : []),
    [detail],
  );

  /** 已经填了多少天才算填完 —— 提醒用户别填一半就跑 */
  const filledDays = availability.filter((v) => v > 0).length;

  async function ensureJoined(): Promise<string> {
    if (participation) return participation.token;
    const r = await api.join(id, name.trim());
    setParticipation(id, { token: r.token, participantId: r.participantId, name: r.name });
    setName(r.name);
    return r.token;
  }

  async function handleSubmit() {
    if (!name.trim()) { setError('先填个名字吧'); return; }
    if (filledDays === 0) { setError('至少涂一天你有空的时间'); return; }
    setSaving(true); setError('');
    try {
      const token = await ensureJoined();
      await api.submit(id, {
        token, name: name.trim(), availability,
        votes: Object.entries(votes).map(([destinationId, level]) => ({ destinationId, level })),
      });
      setDone(true);
      setTimeout(() => navigate(`/e/${id}`), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally { setSaving(false); }
  }

  async function handleNominate(n: string, daysNeeded: number) {
    const token = await ensureJoined();
    await api.nominate(id, { token, name: n, daysNeeded, budgetLevel: null });
    const fresh = await api.getEvent(id);
    setDetail(fresh);
  }

  if (loading) return <main className="p-6 text-ink-400">加载中…</main>;
  if (error && !detail) return <main className="p-6 text-red-600">{error}</main>;
  if (!detail) return null;

  if (done) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <div className="rounded-[var(--radius-card)] border border-brand-300 bg-brand-100/50 p-6 text-center">
          <p className="text-lg font-medium">填好了 ✓</p>
          <p className="mt-2 text-sm text-ink-600">正在带你去看结果…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-5 pb-28">
      <header>
        <h1 className="text-xl font-semibold">{detail.event.title}</h1>
        <p className="mt-1 text-sm text-ink-600">涂一下你什么时候有空</p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
        <label className="mb-3 block text-sm text-ink-600">
          你的名字
          <input
            value={name}
            onChange={(e) => setNameState(e.target.value)}
            placeholder="群里怎么称呼你"
            className="mt-1.5 w-full rounded-[var(--radius-btn)] border border-ink-200 px-3 py-2 text-base outline-none focus:border-brand-500"
          />
        </label>

        <TimeGrid
          slotCount={detail.slotCount}
          granularity={detail.event.granularity}
          slotStarts={slotStarts}
          value={availability}
          onChange={setAvailability}
        />

        <p className="mt-3 text-xs text-ink-400">
          已涂 {filledDays} / {detail.slotCount} 格
        </p>
      </section>

      {detail.event.collectDestinations && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-ink-600">想去哪儿</h2>
          <DestinationPicker
            destinations={detail.destinations}
            votes={votes}
            onVote={(did, lv) => setVotes((v) => ({ ...v, [did]: lv }))}
            onNominate={handleNominate}
            budgetEnabled={detail.event.budgetEnabled}
          />
        </section>
      )}

      {error && (
        <p className="rounded-[var(--radius-btn)] bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-ink-200 bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <button
            type="button" onClick={handleSubmit} disabled={saving}
            className="w-full rounded-[var(--radius-btn)] bg-brand-600 py-3.5 text-base font-medium text-white transition active:scale-[.99] disabled:opacity-40"
          >
            {saving ? '提交中…' : participation ? '更新我的时间' : '提交'}
          </button>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: 手工验证完整填写流程**

Run: `npm run dev`

1. 先建一个活动（用 Task 10 的 curl 或下一步的创建页）
2. 打开 `/e/<eventId>/fill`
3. 填名字、涂几天、提名一个目的地并投票、提交
4. Expected: 显示「填好了 ✓」，然后跳到 `/e/<eventId>`
5. 刷新页面再进来，Expected: 名字还在（localStorage 记住了）

- [ ] **Step 4: 提交**

```bash
git add src/client/components/DestinationPicker.tsx src/client/pages/FillPage.tsx
git commit -m "feat(client): 填写页 —— 涂时间 + 选目的地 + 免注册加入"
```

---

### Task 17: 创建页

**Files:**
- Create: `src/client/pages/CreatePage.tsx`

- [ ] **Step 1: 写创建页**

```tsx
// src/client/pages/CreatePage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { addMyEvent } from '../lib/storage';
import type { Anonymity, Granularity } from '../../shared/types';

/** 把 <input type="date"> 的值转成北京时间当天 00:00 的 Unix 秒 */
function beijingMidnight(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 0, 0, 0) / 1000) - 8 * 3600;
}

export default function CreatePage() {
  const navigate = useNavigate();
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const [title, setTitle] = useState('');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [collectDestinations, setCollect] = useState(true);
  const [budgetEnabled, setBudget] = useState(false);
  const [coreOnly, setCoreOnly] = useState(false);
  const [anonymity, setAnonymity] = useState<Anonymity>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!title.trim()) { setError('给这次活动起个名字吧'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.createEvent({
        title: title.trim(),
        rangeStart: beijingMidnight(start),
        rangeEnd: beijingMidnight(end) + 86399,   // 当天 23:59:59，闭区间
        granularity, collectDestinations, budgetEnabled, coreOnly, anonymity,
      });
      addMyEvent({ eventId: r.eventId, adminKey: r.adminKey, title: title.trim(), createdAt: Date.now() });
      navigate(`/e/${r.eventId}/fill`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally { setBusy(false); }
  }

  const field = 'mt-1.5 w-full rounded-[var(--radius-btn)] border border-ink-200 px-3 py-2.5 text-base outline-none focus:border-brand-500';

  return (
    <main className="mx-auto max-w-xl space-y-6 p-5 pb-32">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">何时何地</h1>
        <p className="mt-1 text-sm text-ink-600">什么时候有空，想去哪里 —— 一起定</p>
      </header>

      <section className="space-y-4 rounded-[var(--radius-card)] border border-ink-200 bg-white p-5">
        <label className="block text-sm text-ink-600">
          活动名称
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="例：国庆出去玩" className={field} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-ink-600">
            从哪天开始
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
          </label>
          <label className="block text-sm text-ink-600">
            到哪天结束
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
          </label>
        </div>

        <fieldset className="text-sm text-ink-600">
          <legend>时间填到多细</legend>
          <div className="mt-2 flex gap-2">
            {([['day', '按天'], ['half_day', '按半天']] as [Granularity, string][]).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setGranularity(v)}
                className={[
                  'flex-1 rounded-[var(--radius-btn)] border px-3 py-2 transition',
                  granularity === v ? 'border-brand-700 bg-brand-500 text-white' : 'border-ink-200 hover:border-ink-400',
                ].join(' ')}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="space-y-3 rounded-[var(--radius-card)] border border-ink-200 bg-white p-5">
        <h2 className="text-sm font-medium text-ink-600">可选设置</h2>

        {([
          [collectDestinations, setCollect, '收集目的地', '大家填想去哪，系统会跟时间一起算'],
          [budgetEnabled, setBudget, '启用预算维度', '每个目的地标个大致花销，避免「不是不想去，是太贵」'],
          [coreOnly, setCoreOnly, '核心成员模式', '标出「必须有谁」，核心到不齐的方案会降到后面'],
        ] as [boolean, (v: boolean) => void, string, string][]).map(([val, set, label, hint]) => (
          <label key={label} className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[var(--color-brand-600)]" />
            <span>
              <span className="block text-sm">{label}</span>
              <span className="block text-xs text-ink-400">{hint}</span>
            </span>
          </label>
        ))}

        <fieldset className="pt-1 text-sm text-ink-600">
          <legend>地点意愿是否匿名</legend>
          <div className="mt-2 flex gap-2">
            {([['open', '全实名'], ['vote_anonymous', '意愿匿名']] as [Anonymity, string][]).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setAnonymity(v)}
                className={[
                  'flex-1 rounded-[var(--radius-btn)] border px-3 py-2 text-sm transition',
                  anonymity === v ? 'border-brand-700 bg-brand-500 text-white' : 'border-ink-200 hover:border-ink-400',
                ].join(' ')}>
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-400">
            意愿匿名时，「不想去」只显示汇总不点名 —— 有些话匿名才说得出口。
          </p>
        </fieldset>
      </section>

      {error && (
        <p className="rounded-[var(--radius-btn)] bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-ink-200 bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-xl">
          <button type="button" onClick={submit} disabled={busy}
            className="w-full rounded-[var(--radius-btn)] bg-brand-600 py-3.5 text-base font-medium text-white transition active:scale-[.99] disabled:opacity-40">
            {busy ? '创建中…' : '创建并开始填'}
          </button>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: 手工验证**

Run: `npm run dev`，打开 `/new`

1. 填名称、选日期、勾几个选项、点「创建并开始填」
2. Expected: 跳到 `/e/<eventId>/fill`，页面标题是刚填的活动名
3. 打开 `/e/<eventId>`，Expected: 能看到自己已填

- [ ] **Step 3: 提交**

```bash
git add src/client/pages/CreatePage.tsx
git commit -m "feat(client): 创建页"
```

---

### Task 18: 结果页

**Files:**
- Create: `src/client/components/PlanCard.tsx`
- Create: `src/client/components/Heatmap.tsx`
- Create: `src/client/pages/ResultsPage.tsx`

这是产品交价值的地方。三个必须做对的点：
1. **冠军方案置顶高亮**，但不隐藏其他方案
2. **每个方案直接写清「差谁」**——不让用户自己对照
3. **催票按钮常驻**，显示还剩几个人没填

- [ ] **Step 1: 写方案卡片**

```tsx
// src/client/components/PlanCard.tsx
import { useMemo } from 'react';
import type { PlanDto, ParticipantRow } from '../../shared/types';
import { slotRangeLabel } from '../../core/slots';
import type { Granularity } from '../../shared/types';

interface Props {
  plan: PlanDto;
  rank: number;
  participants: ParticipantRow[];
  rangeStart: number;
  granularity: Granularity;
  anonymity: 'open' | 'vote_anonymous';
  onExpand: () => void;
}

export default function PlanCard({
  plan, rank, participants, rangeStart, granularity, anonymity, onExpand,
}: Props) {
  const nameOf = useMemo(() => {
    const m = new Map(participants.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) ?? '未知';
  }, [participants]);

  const isChampion = rank === 0 && !plan.blocked;
  const busy = plan.missing.filter((m) => m.reason === 'busy');
  const unwilling = plan.missing.filter((m) => m.reason === 'unwilling');

  return (
    <button
      type="button" onClick={onExpand}
      className={[
        'block w-full rounded-[var(--radius-card)] border p-4 text-left transition',
        isChampion
          ? 'border-brand-500 bg-brand-100/50 ring-1 ring-brand-500'
          : 'border-ink-200 bg-white hover:border-ink-400',
        plan.blocked ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {isChampion && <span className="mr-1.5">🏆</span>}
          {slotRangeLabel(rangeStart, plan.startSlot, plan.endSlot, granularity)}
          <span className="ml-2 text-ink-600">· {plan.destinationName}</span>
        </span>
        <span className={isChampion ? 'text-sm font-semibold text-brand-700' : 'text-sm text-ink-400'}>
          {plan.attendeeIds.length} 人
        </span>
      </div>

      {plan.blocked && plan.blockedReason && (
        <p className="mt-2 text-xs text-[var(--color-warm-600)]">⚠ {plan.blockedReason}</p>
      )}

      {plan.attendeeIds.length > 0 && (
        <p className="mt-2 text-xs text-ink-600">
          ✓ {plan.attendeeIds.map(nameOf).join(' · ')}
        </p>
      )}

      {(busy.length > 0 || unwilling.length > 0) && (
        <p className="mt-1 text-xs text-ink-400">
          ✕ {busy.map((m) => `${nameOf(m.participantId)}（没空）`).join('　')}
          {busy.length > 0 && unwilling.length > 0 ? '　' : ''}
          {anonymity === 'vote_anonymous'
            ? (unwilling.length > 0 ? `另有 ${unwilling.length} 人不想去` : '')
            : unwilling.map((m) => `${nameOf(m.participantId)}（不想去）`).join('　')}
        </p>
      )}

      {plan.weakCount > 0 && (
        <p className="mt-1 text-[11px] text-ink-400">其中 {plan.weakCount} 格是「勉强」</p>
      )}
    </button>
  );
}
```

- [ ] **Step 2: 写热力图组件**

```tsx
// src/client/components/Heatmap.tsx
import { useMemo } from 'react';
import type { AvailabilityLevel, ParticipantRow, Granularity } from '../../shared/types';
import { decodeAvailability } from '../../core/bitmap';

interface Props {
  participants: ParticipantRow[];
  slotCount: number;
  granularity: Granularity;
  rangeStart: number;
}

/** 只读热力图：颜色深浅 = 能来的人占比。点格子看具体是谁。 */
export default function Heatmap({ participants, slotCount, granularity, rangeStart }: Props) {
  const responded = participants.filter((p) => p.respondedAt !== null);

  const { heat, namesAt } = useMemo(() => {
    const decoded = responded.map((p) => ({
      name: p.name,
      levels: decodeAvailability(p.availability, slotCount) as AvailabilityLevel[],
    }));
    const heat: number[] = [];
    const namesAt: string[][] = [];
    for (let i = 0; i < slotCount; i++) {
      const yes = decoded.filter((d) => d.levels[i] === 2).map((d) => d.name);
      const maybe = decoded.filter((d) => d.levels[i] === 1).map((d) => d.name);
      heat.push(responded.length ? (yes.length + maybe.length * 0.5) / responded.length : 0);
      namesAt.push([...yes.map((n) => `${n} ✓`), ...maybe.map((n) => `${n} ~`)]);
    }
    return { heat, namesAt };
  }, [responded, slotCount]);

  if (responded.length === 0) {
    return <p className="text-sm text-ink-400">还没人填，热力图暂时是空的</p>;
  }

  return (
    <div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.min(slotCount, 14)}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: slotCount }, (_, i) => {
          const ts = rangeStart + i * (granularity === 'day' ? 86400 : 43200);
          const d = new Date((ts + 8 * 3600) * 1000);
          const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
          return (
            <div
              key={i}
              title={`${label}：${namesAt[i].join('、') || '没人有空'}`}
              className="relative aspect-square rounded-md"
              style={{
                background: heat[i] === 0
                  ? 'var(--color-ink-100)'
                  : `color-mix(in srgb, var(--color-brand-500) ${Math.round(heat[i] * 100)}%, var(--color-ink-100))`,
              }}
            >
              <span className="absolute inset-x-0 -top-4 text-center text-[10px] text-ink-400">{label}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-xs text-ink-400">颜色越深 = 能来的人越多。鼠标悬停看具体是谁。</p>
    </div>
  );
}
```

- [ ] **Step 3: 写结果页**

```tsx
// src/client/pages/ResultsPage.tsx
import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getParticipation } from '../lib/storage';
import PlanCard from '../components/PlanCard';
import Heatmap from '../components/Heatmap';
import type { EventDetailResponse, ResultsResponse } from '../../shared/types';

/** 默认展示几个方案，其余的折叠。列表短才看得下去。 */
const DEFAULT_VISIBLE_PLANS = 3;

export default function ResultsPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<EventDetailResponse | null>(null);
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([api.getEvent(id), api.results(id)]);
      setDetail(d); setResults(r); setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function copyNudge() {
    if (!results || !detail) return;
    const link = `${location.origin}/e/${id}/fill`;
    const names = results.notResponded.map((p) => p.name).join('、');
    const text = `${detail.event.title} 还差 ${results.notResponded.length} 个人没填（${names}）\n点开涂一下你哪几天有空 👇\n${link}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { setError('复制失败，手动复制地址栏吧'); }
  }

  if (loading) return <main className="p-6 text-ink-400">加载中…</main>;
  if (error && !detail) return <main className="p-6 text-red-600">{error}</main>;
  if (!detail || !results) return null;

  const participation = getParticipation(id);
  const progress = results.totalCount
    ? Math.round((results.respondedCount / results.totalCount) * 100)
    : 0;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-5 pb-16">
      <header className="space-y-3">
        <h1 className="text-xl font-semibold">{detail.event.title}</h1>

        <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-600">
              已填 {results.respondedCount} / {results.totalCount} 人
            </span>
            {results.notResponded.length > 0 && (
              <button type="button" onClick={copyNudge}
                className="rounded-[var(--radius-btn)] border border-ink-200 px-3 py-1.5 text-xs transition hover:border-brand-500 hover:text-brand-600">
                {copied ? '已复制 ✓' : `催剩下 ${results.notResponded.length} 人`}
              </button>
            )}
          </div>

          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-brand-500 transition-[width]"
              style={{ width: `${progress}%` }} />
          </div>

          {results.notResponded.length > 0 && (
            <p className="mt-2.5 text-xs text-ink-400">
              还没填：{results.notResponded.map((p) => p.name).join('、')}
            </p>
          )}
        </div>

        {!participation && (
          <Link to={`/e/${id}/fill`}
            className="block rounded-[var(--radius-btn)] border border-brand-300 bg-brand-100/40 px-4 py-3 text-center text-sm text-brand-700">
            你还没填，点这里涂一下你的时间 →
          </Link>
        )}
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink-600">能执行的方案</h2>

        {results.plans.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-6 text-center">
            <p className="text-sm text-ink-600">这段时间内凑不出共同时间</p>
            <p className="mt-2 text-xs text-ink-400">
              建议把时间范围放宽一点，或者再等等还没填的人
            </p>
          </div>
        ) : (
          <>
            {(showAll ? results.plans : results.plans.slice(0, DEFAULT_VISIBLE_PLANS)).map(
              (plan, i) => (
                <div key={`${plan.destinationId}-${plan.startSlot}`}>
                  <PlanCard
                    plan={plan}
                    rank={i}
                    participants={detail.participants}
                    rangeStart={detail.event.rangeStart}
                    granularity={detail.event.granularity}
                    anonymity={detail.event.anonymity}
                    onExpand={() => setExpanded(expanded === i ? null : i)}
                  />
                  {expanded === i && (
                    <div className="mt-2 rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
                      <Heatmap
                        participants={detail.participants}
                        slotCount={results.slotCount}
                        granularity={detail.event.granularity}
                        rangeStart={detail.event.rangeStart}
                      />
                    </div>
                  )}
                </div>
              ),
            )}

            {/* 默认只显示前几个，其余折叠 —— 列表短才看得下去，
                但一个都没丢，想看随时展开 */}
            {!showAll && results.plans.length > DEFAULT_VISIBLE_PLANS && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full rounded-[var(--radius-card)] border border-dashed border-ink-400 py-3 text-sm text-ink-600 transition hover:border-brand-500 hover:text-brand-600"
              >
                还有 {results.plans.length - DEFAULT_VISIBLE_PLANS} 个方案 ▾
              </button>
            )}
          </>
        )}
      </section>

      {results.unreachable.length > 0 && (
        <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-ink-600">这些地方去不了</h2>
          <ul className="space-y-1.5 text-xs text-ink-400">
            {results.unreachable.map((u) => (
              <li key={u.destinationId}>{u.name} —— {u.reason}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 4: 手工验证设计文档 §3.1 的反例在界面上正确呈现**

1. 建一个 7 天活动（10/1–10/7，按天，收集目的地）
2. 用 curl 或界面加入四个人并提交（小王、小李、小赵全 `2222222`，小张 `0000222`）
3. 云南（5 天）、莫干山（2 天），投票如测试用例
4. 打开 `/e/<eventId>`

Expected:
- 顶部显示「已填 4 / 4 人」，进度条满
- 🏆 冠军方案是「10月5日 – 10月7日 · 莫干山」，4 人
- 下面有云南的方案，2 人，写着「小张（没空）　小赵（不想去）」
- 点任一方案展开热力图

- [ ] **Step 5: 提交**

```bash
git add src/client/components/PlanCard.tsx src/client/components/Heatmap.tsx src/client/pages/ResultsPage.tsx
git commit -m "feat(client): 结果页 —— 方案列表 + 差谁说明 + 热力图 + 催票"
```

---

## Phase 5 · 验证

### Task 19: 端到端冒烟验证

**Files:** 无（只验证）

- [ ] **Step 1: 跑全部单元测试**

Run: `npm test`
Expected: 全部 PASS（slots 14 + bitmap 8 + windows 11 + planner 13）

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 3: 生产构建**

Run: `npm run build`
Expected: 构建成功，生成 `dist/client/`

- [ ] **Step 4: 完整走一遍真实流程**

用手机（或浏览器设备模拟，选 iPhone）走一遍：

1. `/new` 建活动：7 天、按天、收集目的地、全实名
2. 复制地址栏链接
3. 换个隐私窗口打开链接（模拟另一个人）
4. 填名字、涂时间、提名一个目的地、投票、提交
5. 回到第一个窗口看结果页，刷新

Expected:
- 进度条从 0/1 变成 1/2
- 手机上没有横向滚动条
- 涂格子时页面不跟着滚
- 底部提交按钮始终可见

- [ ] **Step 5: 记录问题并修**

把上面任何不符合预期的地方记下来，修掉，然后提交：

```bash
git add -A
git commit -m "fix: 端到端冒烟验证发现的问题"
```

---

## 完成标准

这个计划做完后，应该能做到：

1. ✅ 手机上打开链接，不注册就能填
2. ✅ 在网格上涂抹自己的空闲时间（三态、可拖拽连涂）
3. ✅ 提名目的地、投票、看到别人提的
4. ✅ 提交后看到**方案列表**，每个方案写清时间、地点、谁能来、差谁
5. ✅ 发起人能看到催票进度，一键复制催办话术
6. ✅ 设计文档 §3.1 的那个反例，界面上给出的答案是正确的

**还没有的（属于第二份计划）：** 定案页、出行卡、.ics 日历导出、我的活动页、OG 分享预览、部署上线、玻璃质感与动效。

---

## 自检记录

**Spec 覆盖检查：**

| 设计文档章节 | 对应任务 |
|---|---|
| §5.1 A 发起活动 | Task 10, 17 |
| §5.1 B 参与者填写 | Task 11, 15, 16 |
| §5.1 C 结果页 | Task 13, 18 |
| §5.1 D 定案与分享 | ⚠ 第二份计划 |
| §5.1 E 发起人管理 | ⚠ 第二份计划（管理密钥已在 Task 10 生成） |
| §6 核心概念 | Task 2 |
| §7 数据模型 | Task 7 |
| §8 交叉算法 | Task 3, 4, 5, 6 |
| §8.2.1 边界情况 | Task 6（6 种全覆盖） |
| §9.1 页面清单 | Task 9, 16, 17, 18 |
| §9.2 填写页交互 | Task 15, 16 |
| §9.3 结果页交互 | Task 18 |
| §10 视觉规范 | Task 1 Step 1（设计令牌）；玻璃与动效 → 第二份计划 |
| §11 技术架构 | Task 1 |
| §13 风险对策 | 组合爆炸 → Task 6；填一半跑掉 → Task 16；性能 → 第二份计划 |

**类型一致性检查：** `PlanDto`、`AvailabilityLevel`、`VoteLevel`、`Granularity`、`Anonymity` 全部只在 `src/shared/types.ts` 定义一次；`feasibleWindows` 返回的 `Window` 结构在 Task 5 定义、Task 6 消费，字段名 `start`/`end`/`weakCount` 一致；`decodeAvailability` / `encodeAvailability` 签名在 Task 4 定义、Task 13/18 消费，一致。

**占位符检查：** 无 TBD / TODO / 「类似 Task N」。每个代码步骤都是完整可粘贴的。

---

### 自检发现并已修掉的问题

写完之后拿设计文档 §3.1 的反例逐行推演了一遍，抓到三个真 bug：

**① 核心算法会抹掉 subset 视图（最严重）**
第一版 `buildPlans` 里，一旦有任何一个参与者在这个窗口没有可行时间，就 `continue` 掉整个窗口 —— 等于要求「全员到齐才算方案」。后果是：设计文档 §3.1 那个反例里，**云南方案会整个消失**，而不是显示「2 人成行」。这直接抹掉了产品的差异化所在。

修法：改成「能来一个算一个」——遍历时来不了的人 `continue` 跳过，只有一个人都来不了时才丢弃该窗口。同时新增了一条专门盯这个行为的测试（`describe('buildPlans — subset 视图')`）。

**② `missing` 的原因判断反了**
原逻辑是「投了想去但没来 = 没空；投了不想去 = 不想去」。但一个人**既没空又不想去**时，应该报 `busy`：确实没空比「不想去」更硬，对组织者也更有用。改成先判断有没有可行窗口。

**③ 窗口合并会错误合并不相邻的时间**
原 `rankAndTrim` 在**排好序**（排序键含 `weakCount`）的列表上做相邻判断。结果时间上隔了老远的两个窗口，会因为 `weakCount` 相同而挨在一起，被误判成「相邻」合并掉。修法：先按 (目的地, 是否受阻, 人群) 分组，组内按起始槽位排序，再合并。

**④ `slotRangeLabel` 的上午/下午判断用了错误的时间戳取模**，`rangeStart` 是当天 00:00 时 `ts / unit` 是个巨大的数，`% 2` 结果无意义。改成用槽位序号奇偶判断。

**⑤ `windows.ts` 第一版留有死代码块**（一个只有注释的 `if`），Step 5 会被整体替换掉，但读者可能先抄到它。已删除。

这些问题都是**在纸上推演出来的**，一个都没进到代码里 —— 这正是先写计划再动手的价值。
