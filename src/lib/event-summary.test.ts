import { describe, expect, it } from "vitest";
import type { AlertEvent } from "../types";
import { getAlertDayStats, groupAlertEvents } from "./event-summary";

function event(id: string, at: number, patch: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id,
    ruleId: "rule_1",
    symbol: "sh600519",
    name: "贵州茅台",
    message: "贵州茅台 触发提醒（现价 1,330.00）",
    price: 1330,
    at,
    read: false,
    ...patch,
  };
}

describe("alert event summaries", () => {
  it("merges the same symbol inside a five-minute window", () => {
    const now = new Date("2026-10-24T12:00:00+08:00").getTime();
    const events = [
      event("3", now),
      event("2", now - 60_000),
      event("1", now - 120_000),
      event("older", now - 360_000),
    ];
    const groups = groupAlertEvents(events);
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(3);
    expect(groups[0].summary).toContain("3 次触发");
    expect(groups[0].summary).toContain("触发提醒");
  });

  it("calculates processed, unread and active-symbol statistics", () => {
    const now = new Date("2026-10-24T12:00:00+08:00");
    const events = [
      event("1", now.getTime(), { read: true }),
      event("2", now.getTime() - 1000),
      event("3", now.getTime() - 2000, { symbol: "sz300750", name: "宁德时代" }),
    ];
    const groups = groupAlertEvents(events);
    const stats = getAlertDayStats(events, groups, now);
    expect(stats.total).toBe(3);
    expect(stats.processed).toBe(1);
    expect(stats.unread).toBe(2);
    expect(stats.processingRate).toBeCloseTo(33.333, 2);
    expect(stats.groupCount).toBe(2);
    expect(stats.mostActive?.symbol).toBe("sh600519");
  });
});
