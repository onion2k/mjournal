import { invoke } from "@tauri-apps/api/core";
import type {
  EditorPreference,
  JournalCommandError,
  JournalStore,
  MeetingEntry,
  MeetingEntryInput,
  MeetingTrendViewModel,
  OverallPerformanceViewModel,
  Score,
  ScoreTrendPoint,
  SkillKey,
  WeeklySummaryViewModel,
} from "../types";

const scoreOptions: Score[] = [1, 2, 3, 4, 5];

export { scoreOptions };

export const skillLabels: Record<SkillKey, string> = {
  pausing: "Pausing",
  listening: "Listening",
  questioning: "Questioning",
};

export function createEmptyMeeting(date: string): MeetingEntryInput {
  return {
    date,
    name: "",
    overallScore: 3,
    successes: "",
    misses: "",
    skills: {
      pausing: { score: 3, note: "" },
      listening: { score: 3, note: "" },
      questioning: { score: 3, note: "" },
    },
  };
}

export function toMeetingInput(meeting: MeetingEntry): MeetingEntryInput {
  return {
    id: meeting.id,
    date: meeting.date,
    name: meeting.name,
    overallScore: meeting.overallScore,
    successes: meeting.successes,
    misses: meeting.misses,
    skills: {
      pausing: { ...meeting.skills.pausing },
      listening: { ...meeting.skills.listening },
      questioning: { ...meeting.skills.questioning },
    },
  };
}

export async function loadJournal(): Promise<JournalStore> {
  return invoke<JournalStore>("load_journal");
}

export async function upsertMeeting(input: MeetingEntryInput): Promise<MeetingEntry> {
  return invoke<MeetingEntry>("upsert_meeting", { input });
}

export async function deleteMeeting(id: string): Promise<void> {
  return invoke("delete_meeting", { id });
}

export async function getJournalPath(): Promise<string> {
  return invoke<string>("get_journal_path");
}

export async function resetJournal(): Promise<JournalStore> {
  return invoke<JournalStore>("reset_journal");
}

export async function getEditorPreference(): Promise<EditorPreference | null> {
  return invoke<EditorPreference | null>("get_editor_preference");
}

export function getErrorMessage(error: unknown): string {
  if (isCommandError(error)) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

function isCommandError(value: unknown): value is JournalCommandError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<JournalCommandError>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

export function todayIso(): string {
  return localDateToIso(new Date());
}

export function localDateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions): string {
  return parseIsoDate(value).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...options,
  });
}

export function formatMonth(value: string): string {
  return parseIsoDate(`${value}-01`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export function formatWeekRange(weekStart: string): string {
  const weekEnd = addDays(weekStart, 6);
  return `${formatDate(weekStart, {
    day: "numeric",
    month: "short",
  })} - ${formatDate(weekEnd, {
    day: "numeric",
    month: "short",
  })}`;
}

export function isFutureDate(value: string): boolean {
  return value > todayIso();
}

export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + days);
  return localDateToIso(date);
}

export function startOfWeek(value: string): string {
  const date = parseIsoDate(value);
  const day = date.getDay();
  const distance = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + distance);
  return localDateToIso(date);
}

export function monthKey(value: string): string {
  const date = parseIsoDate(value);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

export function moveMonth(value: string, amount: number): string {
  const [year, month] = value.split("-").map(Number);
  const next = new Date(year, month - 1 + amount, 1, 12);
  return `${next.getFullYear()}-${`${next.getMonth() + 1}`.padStart(2, "0")}`;
}

export function buildCalendarDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1, 12);
  const leading = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - leading);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      iso: localDateToIso(date),
      inMonth: date.getMonth() === monthNumber - 1,
      day: date.getDate(),
    };
  });
}

export function normalizeMeetingName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function sortMeetings(meetings: MeetingEntry[]): MeetingEntry[] {
  return [...meetings].sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    if (byDate !== 0) {
      return byDate;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function getMeetingsForDate(meetings: MeetingEntry[], date: string): MeetingEntry[] {
  return sortMeetings(meetings).filter((meeting) => meeting.date === date);
}

export function buildWeeklySummary(
  meetings: MeetingEntry[],
  anchorDate: string,
): WeeklySummaryViewModel {
  const weekStart = startOfWeek(anchorDate);
  const weekEnd = addDays(weekStart, 6);
  const weeklyMeetings = analyticalMeetings(meetings).filter(
    (meeting) => meeting.date >= weekStart && meeting.date <= weekEnd,
  );

  const averageOverallScore = weeklyMeetings.length
    ? average(weeklyMeetings.map((meeting) => meeting.overallScore))
    : null;

  const averageSkills = {
    pausing: weeklyMeetings.length
      ? average(weeklyMeetings.map((meeting) => meeting.skills.pausing.score))
      : null,
    listening: weeklyMeetings.length
      ? average(weeklyMeetings.map((meeting) => meeting.skills.listening.score))
      : null,
    questioning: weeklyMeetings.length
      ? average(weeklyMeetings.map((meeting) => meeting.skills.questioning.score))
      : null,
  };

  const skillEntries = Object.entries(averageSkills).filter(
    (entry): entry is [SkillKey, number] => entry[1] !== null,
  );
  const strongestSkill = skillEntries.length
    ? [...skillEntries].sort((left, right) => right[1] - left[1])[0][0]
    : null;
  const weakestSkill = skillEntries.length
    ? [...skillEntries].sort((left, right) => left[1] - right[1])[0][0]
    : null;

  const rankedMeetings = [...weeklyMeetings].sort(
    (left, right) => right.overallScore - left.overallScore || left.date.localeCompare(right.date),
  );

  const summaryLines =
    weeklyMeetings.length === 0
      ? [
          "No meetings were logged for this week.",
          "Use the Today or Calendar view to capture your next reflection.",
        ]
      : [
          `${weeklyMeetings.length} meetings logged between ${formatDate(weekStart, {
            day: "numeric",
            month: "short",
          })} and ${formatDate(weekEnd, { day: "numeric", month: "short" })}.`,
          averageOverallScore !== null
            ? `Average meeting quality landed at ${averageOverallScore.toFixed(1)}/5.`
            : "No average score available yet.",
          strongestSkill && weakestSkill
            ? `Strongest habit: ${skillLabels[strongestSkill]}. Most attention needed: ${skillLabels[weakestSkill]}.`
            : "Complete more entries to surface strongest and weakest skills.",
        ];

  return {
    weekStart,
    weekEnd,
    meetingCount: weeklyMeetings.length,
    averageOverallScore,
    averageSkills,
    strongestSkill,
    weakestSkill,
    topMeetings: rankedMeetings.slice(0, 3),
    bottomMeetings: [...rankedMeetings].reverse().slice(0, 3),
    summaryLines,
  };
}

export function buildMeetingTrends(meetings: MeetingEntry[]): MeetingTrendViewModel[] {
  const grouped = new Map<string, MeetingEntry[]>();

  for (const meeting of analyticalMeetings(meetings)) {
    const key = normalizeMeetingName(meeting.name);
    if (!key) {
      continue;
    }

    const bucket = grouped.get(key) ?? [];
    bucket.push(meeting);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([normalizedName, entries]) => {
      const sorted = sortMeetings(entries);
      const averageOverallScore = average(sorted.map((entry) => entry.overallScore));
      const averageSkills = {
        pausing: average(sorted.map((entry) => entry.skills.pausing.score)),
        listening: average(sorted.map((entry) => entry.skills.listening.score)),
        questioning: average(sorted.map((entry) => entry.skills.questioning.score)),
      };
      const splitIndex = Math.max(1, Math.floor(sorted.length / 2));
      const earlyAverage = average(sorted.slice(0, splitIndex).map((entry) => entry.overallScore));
      const lateAverage = average(sorted.slice(splitIndex).map((entry) => entry.overallScore));
      const direction: MeetingTrendViewModel["direction"] =
        lateAverage - earlyAverage >= 0.35
          ? "improving"
          : lateAverage - earlyAverage <= -0.35
            ? "declining"
            : "steady";

      return {
        normalizedName,
        displayName: sorted[0].name,
        entries: sorted,
        averageOverallScore,
        averageSkills,
        direction,
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function buildOverallPerformance(meetings: MeetingEntry[]): OverallPerformanceViewModel {
  const sorted = analyticalMeetings(meetings);
  const averageOverallScore = sorted.length ? average(sorted.map((meeting) => meeting.overallScore)) : null;
  const averageSkills = {
    pausing: sorted.length ? average(sorted.map((meeting) => meeting.skills.pausing.score)) : null,
    listening: sorted.length ? average(sorted.map((meeting) => meeting.skills.listening.score)) : null,
    questioning: sorted.length ? average(sorted.map((meeting) => meeting.skills.questioning.score)) : null,
  };

  const skillEntries = Object.entries(averageSkills).filter(
    (entry): entry is [SkillKey, number] => entry[1] !== null,
  );
  const strongestSkill = skillEntries.length
    ? [...skillEntries].sort((left, right) => right[1] - left[1])[0][0]
    : null;
  const weakestSkill = skillEntries.length
    ? [...skillEntries].sort((left, right) => left[1] - right[1])[0][0]
    : null;

  const recurringMeetingCount = buildMeetingTrends(sorted).length;
  const trendPoints = buildWeeklyTrendPoints(sorted);

  const summaryLines =
    sorted.length === 0
      ? [
          "No meetings have been logged yet.",
          "Start with a reflection after your next meeting to unlock the performance overview.",
        ]
      : [
          `${sorted.length} meetings logged across ${trendPoints.length} active weeks.`,
          averageOverallScore !== null
            ? `Average overall score is ${averageOverallScore.toFixed(1)}/5 across all recorded meetings.`
            : "No average overall score available yet.",
          strongestSkill && weakestSkill
            ? `Most consistent habit: ${skillLabels[strongestSkill]}. Biggest growth area: ${skillLabels[weakestSkill]}.`
            : "Log more meetings to surface stronger long-term patterns.",
          recurringMeetingCount > 0
            ? `${recurringMeetingCount} recurring meeting series are now available in the trends view.`
            : "Repeated meeting names will appear in the trends view once logged more than once.",
        ];

  return {
    totalMeetings: sorted.length,
    averageOverallScore,
    averageSkills,
    strongestSkill,
    weakestSkill,
    recurringMeetingCount,
    summaryLines,
    trendPoints,
  };
}

function buildWeeklyTrendPoints(meetings: MeetingEntry[]): ScoreTrendPoint[] {
  const buckets = new Map<string, MeetingEntry[]>();

  for (const meeting of meetings) {
    const weekStart = startOfWeek(meeting.date);
    const weekEntries = buckets.get(weekStart) ?? [];
    weekEntries.push(meeting);
    buckets.set(weekStart, weekEntries);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, entries]) => ({
      id: weekStart,
      label: formatDate(weekStart, { day: "numeric", month: "short" }),
      value: average(entries.map((entry) => entry.overallScore)),
      caption: `${entries.length} meetings`,
    }));
}

function analyticalMeetings(meetings: MeetingEntry[]): MeetingEntry[] {
  return sortMeetings(meetings).filter((meeting) => !isFutureDate(meeting.date));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
