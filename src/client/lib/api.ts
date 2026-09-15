import type {
  CreateEventRequest,
  CreateEventResponse,
  EventDetailResponse,
  JoinResponse,
  SubmitRequest,
  NominateDestinationRequest,
  ResultsResponse,
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

  getEvent: (id: string) => req<EventDetailResponse>(`/api/events/${id}`),

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
};
