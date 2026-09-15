const K_NAME = 'hh_name';
const K_MY_EVENTS = 'hh_my_events';
const K_PARTICIPATION = 'hh_participation';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 无痕模式或存储已满，忽略 —— 不能因为存不了就让页面挂掉
  }
}

/** 记住名字，下次填别的活动不用重打 */
export const getName = () => read<string>(K_NAME, '');
export const setName = (n: string) => write(K_NAME, n);

export interface MyEvent {
  eventId: string;
  adminKey: string;
  title: string;
  createdAt: number;
}

export function addMyEvent(e: MyEvent) {
  const list = read<MyEvent[]>(K_MY_EVENTS, []).filter((x) => x.eventId !== e.eventId);
  write(K_MY_EVENTS, [e, ...list]);
}
export const getMyEvents = () => read<MyEvent[]>(K_MY_EVENTS, []);

/** 取出本机保存的某活动的管理密钥；不是本机发起的返回 null */
export function getAdminKey(eventId: string): string | null {
  return getMyEvents().find((e) => e.eventId === eventId)?.adminKey ?? null;
}

/** 移除本地记录（不是删除服务端活动） */
export function forgetMyEvent(eventId: string) {
  write(
    K_MY_EVENTS,
    getMyEvents().filter((e) => e.eventId !== eventId),
  );
}

export interface Participation {
  token: string;
  participantId: string;
  name: string;
}

export function getParticipation(eventId: string): Participation | null {
  return read<Record<string, Participation>>(K_PARTICIPATION, {})[eventId] ?? null;
}

export function setParticipation(eventId: string, p: Participation) {
  const all = read<Record<string, Participation>>(K_PARTICIPATION, {});
  all[eventId] = p;
  write(K_PARTICIPATION, all);
}
