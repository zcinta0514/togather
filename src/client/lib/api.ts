import type {
  CreateEventRequest,
  CreateEventResponse,
  EventDetailResponse,
  FinalizedPlan,
  FinalizeRequest,
  JoinResponse,
  NominateDestinationRequest,
  ResultsResponse,
  ResultsPageResponse,
  SetCoreRequest,
  SubmitRequest,
  UnfinalizeRequest,
} from '../../shared/types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `请求失败（${res.status}）`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  createEvent: (body: CreateEventRequest) =>
    req<CreateEventResponse>('/api/events', { method: 'POST', body: JSON.stringify(body) }),

  /**
   * 读活动全貌。
   *
   * 意愿匿名的活动必须带上自己的 token —— 服务端只回传你自己的票。
   * 不带也能打开页面，只是看不到自己之前投过什么。token 放请求头，
   * 避免出现在浏览器历史、访问日志和 Referer 里。
   */
  getEvent: (id: string, token?: string) =>
    req<EventDetailResponse>(`/api/events/${id}`, {
      headers: token ? { 'X-Participant-Token': token } : undefined,
    }),

  join: (id: string, name: string, token?: string) =>
    req<JoinResponse>(`/api/events/${id}/join`, {
      method: 'POST',
      body: JSON.stringify({ name, token }),
    }),

  submit: (id: string, body: SubmitRequest) =>
    req<{ ok: true; respondedAt: number }>(`/api/events/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  nominate: (id: string, body: NominateDestinationRequest) =>
    req<{ destinationId: string; name: string; merged: boolean }>(
      `/api/events/${id}/destinations`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  results: (id: string) => req<ResultsResponse>(`/api/events/${id}/results`),

  resultsPage: (id: string) =>
    req<ResultsPageResponse>(`/api/events/${id}/results?view=page`),

  finalize: (id: string, body: FinalizeRequest) =>
    req<{ ok: true; plan: FinalizedPlan }>(`/api/events/${id}/finalize`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  unfinalize: (id: string, body: UnfinalizeRequest) =>
    req<{ ok: true }>(`/api/events/${id}/unfinalize`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  setCore: (id: string, participantId: string, body: SetCoreRequest) =>
    req<{ ok: true; isCore: boolean }>(`/api/events/${id}/participants/${participantId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  removeEvent: (id: string, body: UnfinalizeRequest) =>
    req<{ ok: true }>(`/api/events/${id}/delete`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

/** 从活动行里取出已解析的定案（存的是 JSON 字符串） */
export function parseFinalizedPlan(raw: string | null): FinalizedPlan | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FinalizedPlan;
  } catch {
    return null;
  }
}
