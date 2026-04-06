import { describe, expect, it } from "vitest";
import {
  buildMeetingTrends,
  buildOverallPerformance,
  buildWeeklySummary,
  isFutureDate,
  normalizeMeetingName,
  startOfWeek,
} from "./journal";
import type { MeetingEntry } from "../types";

function makeMeeting(
  id: string,
  date: string,
  name: string,
  overallScore: 1 | 2 | 3 | 4 | 5,
): MeetingEntry {
  return {
    id,
    date,
    name,
    overallScore,
    successes: "",
    misses: "",
    createdAt: `${date}T09:00:00Z`,
    updatedAt: `${date}T09:00:00Z`,
    skills: {
      pausing: { score: overallScore, note: "" },
      listening: { score: 4, note: "" },
      questioning: { score: 5, note: "" },
    },
  };
}

describe("journal helpers", () => {
  it("uses Monday as the start of the week", () => {
    expect(startOfWeek("2026-04-12")).toBe("2026-04-06");
    expect(startOfWeek("2026-04-06")).toBe("2026-04-06");
  });

  it("builds a weekly summary from meeting scores", () => {
    const meetings = [
      makeMeeting("1", "2026-03-16", "Weekly Design Sync", 5),
      makeMeeting("2", "2026-03-17", "Client Review", 3),
      makeMeeting("3", "2026-03-20", "Retro", 4),
    ];

    const summary = buildWeeklySummary(meetings, "2026-03-19");

    expect(summary.meetingCount).toBe(3);
    expect(summary.averageOverallScore).toBe(4);
    expect(summary.strongestSkill).toBe("questioning");
    expect(summary.weakestSkill).toBe("pausing");
    expect(summary.topMeetings[0]?.name).toBe("Weekly Design Sync");
  });

  it("groups repeated meeting names into trends", () => {
    const meetings = [
      makeMeeting("1", "2026-02-25", " Weekly   Design Sync ", 2),
      makeMeeting("2", "2026-03-04", "weekly design sync", 4),
      makeMeeting("3", "2026-03-11", "Weekly Design Sync", 5),
      makeMeeting("4", "2026-03-09", "1:1", 4),
    ];

    const trends = buildMeetingTrends(meetings);

    expect(normalizeMeetingName(" Weekly   Design Sync ")).toBe("weekly design sync");
    expect(trends).toHaveLength(1);
    expect(trends[0]?.entries).toHaveLength(3);
    expect(trends[0]?.direction).toBe("improving");
    expect(trends[0]?.averageOverallScore).toBeCloseTo(11 / 3, 5);
  });

  it("treats dates after today as future meetings", () => {
    expect(isFutureDate("2099-01-01")).toBe(true);
    expect(isFutureDate("2000-01-01")).toBe(false);
  });

  it("excludes future meetings from summaries and trends", () => {
    const meetings = [
      makeMeeting("1", "2026-04-06", "Weekly Design Sync", 4),
      makeMeeting("2", "2099-01-06", "Weekly Design Sync", 1),
      makeMeeting("3", "2099-01-07", "Planning", 5),
    ];

    const weeklySummary = buildWeeklySummary(meetings, "2026-04-06");
    const trends = buildMeetingTrends(meetings);
    const overall = buildOverallPerformance(meetings);

    expect(weeklySummary.meetingCount).toBe(1);
    expect(weeklySummary.averageOverallScore).toBe(4);
    expect(trends).toHaveLength(0);
    expect(overall.totalMeetings).toBe(1);
    expect(overall.averageOverallScore).toBe(4);
    expect(overall.recurringMeetingCount).toBe(0);
  });
});
