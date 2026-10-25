import type { AlertEvent } from "../types";

export interface AlertEventGroup {
  key: string;
  symbol: string;
  latest: AlertEvent;
  events: AlertEvent[];
  count: number;
  unreadCount: number;
  summary: string;
}

export interface AlertDayStats {
  total: number;
  processed: number;
  unread: number;
  groupCount: number;
  processingRate: number;
  mostActive: { symbol: string; count: number } | null;
}

function normalizedMessage(event: AlertEvent) {
  return event.message
    .replace(event.name, "")
    .replace(/（现价[^）]*）/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function groupSummary(events: AlertEvent[]) {
  const latest = events[0];
  if (events.length <= 1) return latest.message;
  const oldest = events[events.length - 1];
  const minutes = Math.max(1, Math.round((latest.at - oldest.at) / 60_000));
  const messages = [...new Set(events.map(normalizedMessage).filter(Boolean))];
  const detail =
    messages.length === 1
      ? messages[0]
      : `${messages.slice(0, 2).join(" / ")}${messages.length > 2 ? ` 等 ${messages.length} 类` : ""}`;
  return `${latest.name} ${minutes} 分钟内 ${events.length} 次触发：${detail}`;
}

export function groupAlertEvents(events: AlertEvent[], windowMs = 5 * 60_000) {
  const groups: AlertEventGroup[] = [];
  const sorted = [...events].sort((a, b) => b.at - a.at);
  for (const event of sorted) {
    const current = groups.find(
      (group) => group.symbol === event.symbol && group.latest.at - event.at <= windowMs,
    );
    if (current) {
      current.events.push(event);
      current.count += 1;
      if (!event.read) current.unreadCount += 1;
    } else {
      groups.push({
        key: event.id,
        symbol: event.symbol,
        latest: event,
        events: [event],
        count: 1,
        unreadCount: event.read ? 0 : 1,
        summary: event.message,
      });
    }
  }
  for (const group of groups) group.summary = groupSummary(group.events);
  return groups;
}

export function getAlertDayStats(
  events: AlertEvent[],
  groups: AlertEventGroup[],
  now = new Date(),
): AlertDayStats {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = events.filter((event) => event.at >= start.getTime());
  const unread = today.filter((event) => !event.read).length;
  const todayIds = new Set(today.map((event) => event.id));
  const activeCounts = new Map<string, number>();
  for (const event of today) activeCounts.set(event.symbol, (activeCounts.get(event.symbol) ?? 0) + 1);
  const mostActive = [...activeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    total: today.length,
    processed: today.length - unread,
    unread,
    groupCount: groups.filter((group) => todayIds.has(group.latest.id)).length,
    processingRate: today.length ? ((today.length - unread) / today.length) * 100 : 100,
    mostActive: mostActive ? { symbol: mostActive[0], count: mostActive[1] } : null,
  };
}
