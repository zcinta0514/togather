// 所有类型在这里定义一次，前后端都从这里 import。
// 任何地方需要新类型，加到这里，不要在别处重复定义。

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
  rangeStart: number; // Unix 秒（UTC）
  rangeEnd: number; // Unix 秒（UTC），闭区间
  timezone: string; // IANA 名，如 Asia/Shanghai
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
  availability: string; // base64 编码的位图
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
  /** 这个人对该目的地「最多愿意为这趟花多少」（人民币元），选填。 */
  budgetAmount: number | null;
}

/** 一个目的地的预算意愿统计（只统计已回应参与者提交的金额）。 */
export interface BudgetStats {
  median: number;
  average: number;
  min: number;
  max: number;
  filledCount: number;
  totalCount: number;
  sampleSmall: boolean;
}

/**
 * 定案 —— 存进 events.finalized_plan 的 JSON。
 *
 * 目的地名称和参加人姓名**冗余存一份快照**，不靠 ID 现查。
 * 理由：定案是「拍板」，出行卡要稳定。如果之后有人改了答案、
 * 或者目的地被删掉，已定案的卡片不该跟着变或显示不出来。
 */
export interface FinalizedPlan {
  destinationId: string;
  destinationName: string;
  /** 时间窗口的起止（闭区间）。窗口可能比行程长 —— 见 daysNeeded */
  startSlot: number;
  endSlot: number;
  /**
   * 这趟实际要几天。
   *
   * 窗口和行程长度是两回事：莫干山要 2 天，但 10/5–10/7 三天里任意两天都能成行，
   * 方案列表为了不刷屏会把这样的窗口合并成一段。
   * 所以卡片必须把「多长的窗口」和「玩几天」分开说，
   * 否则 2 天的行程会显示成 3 天。
   */
  daysNeeded: number;
  attendeeIds: string[];
  attendeeNames: string[];
  finalizedAt: number;
}

export interface FinalizeRequest {
  adminKey: string;
  destinationId: string;
  startSlot: number;
}

export interface UnfinalizeRequest {
  adminKey: string;
}

export interface SetCoreRequest {
  adminKey: string;
  isCore: boolean;
}

/**
 * 对外暴露的参与者信息 —— 刻意不含 token。
 *
 * token 是认领身份的凭证，拿到它就能冒充别人提交。
 * 所以接口响应里必须剥掉，绝不能整个 ParticipantRow 直接返回。
 */
export interface PublicParticipant {
  id: string;
  name: string;
  isCore: boolean;
  availability: string;
  respondedAt: number | null;
}

// ---------- API 契约 ----------

export interface CreateEventRequest {
  title: string;
  rangeStart: number;
  rangeEnd: number;
  granularity: Granularity;
  collectDestinations: boolean;
  budgetEnabled: boolean;
  anonymity: Anonymity;
}

export interface CreateEventResponse {
  eventId: string;
  adminKey: string; // 只在创建时返回一次
}

export interface EventDetailResponse {
  event: EventRow;
  slotCount: number;
  participants: PublicParticipant[];
  destinations: DestinationRow[];
  /**
   * 投票明细。
   *
   * 【意愿匿名时这里只会有你自己那几条】—— 传入自己的 token 才能拿到。
   * 匿名不能只靠界面不显示：数据还在响应里的话，谁都能按 F12 看到
   * 谁投了「不想去」，那这个设置就白设了。
   */
  votes: VoteRow[];
}

export interface JoinRequest {
  name: string;
  token?: string; // 带 token 表示是回来改的
}

export interface JoinResponse {
  participantId: string;
  token: string;
  name: string;
}

export interface SubmitRequest {
  token: string;
  name: string;
  availability: AvailabilityLevel[]; // 长度必须 === slotCount
  votes: Array<{ destinationId: string; level: VoteLevel; budgetAmount?: number | null }>;
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
  endSlot: number; // 闭区间
  attendeeIds: string[];
  weakCount: number;
  /**
   * 来不了的人及原因。
   *
   * 意愿匿名时，reason 为 'unwilling' 的条目会被服务端**整条删掉**
   * （只留 busy 那些），数量改由 unwillingCount 给出。
   * 「不想去」是这个设置唯一要保护的东西，让它在响应里出现就等于没设。
   */
  missing: Array<{ participantId: string; name: string; reason: 'busy' | 'unwilling' }>;
  /** 有多少人「不想去」。匿名时 missing 里查不到，只能看这个数 */
  unwillingCount: number;
  blocked: boolean;
  blockedReason?: string;
  /** 该目的地的预算意愿统计；未启用预算或没有任何金额时为 null。 */
  budgetStats: BudgetStats | null;
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

/** 结果页一次加载所需的活动详情与计算结果。投票明细不返回，结果页不需要它。 */
export type ResultsPageDetail = Omit<EventDetailResponse, 'votes'>;

export interface ResultsPageResponse {
  detail: ResultsPageDetail;
  results: ResultsResponse;
}

// ---------- 常量 ----------

export const GRANULARITY_SECONDS: Record<Granularity, number> = {
  day: 86400,
  half_day: 43200,
};

/** 单个活动的槽位上限，防止有人建个 10 年的活动把服务器算爆 */
export const MAX_SLOTS = 180;

/**
 * 单人、单目的地可填写的预算上限（人民币元）。
 *
 * 这不是产品建议价，只是输入防护：避免异常大数污染平均值，
 * 同时保证最多 200 人参与时求和仍远低于 JS 安全整数上限。
 */
export const MAX_BUDGET_AMOUNT = 100_000_000;
