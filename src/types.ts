export type Score = 1 | 2 | 3 | 4 | 5;

export type SkillKey = "pausing" | "listening" | "questioning";

export interface SkillReflection {
  score: Score;
  note: string;
}

export interface MeetingSkills {
  pausing: SkillReflection;
  listening: SkillReflection;
  questioning: SkillReflection;
}

export interface MeetingEntry {
  id: string;
  date: string;
  name: string;
  skills: MeetingSkills;
  successes: string;
  misses: string;
  overallScore: Score;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingEntryInput {
  id?: string;
  date: string;
  name: string;
  skills: MeetingSkills;
  successes: string;
  misses: string;
  overallScore: Score;
}

export interface JournalStore {
  version: number;
  meetings: MeetingEntry[];
}

export interface JournalCommandError {
  code: string;
  message: string;
}

export interface EditorPreference {
  label: string;
  openWith: string;
}

export interface WeeklySummaryViewModel {
  weekStart: string;
  weekEnd: string;
  meetingCount: number;
  averageOverallScore: number | null;
  averageSkills: Record<SkillKey, number | null>;
  strongestSkill: SkillKey | null;
  weakestSkill: SkillKey | null;
  topMeetings: MeetingEntry[];
  bottomMeetings: MeetingEntry[];
  summaryLines: string[];
}

export interface MeetingTrendViewModel {
  normalizedName: string;
  displayName: string;
  entries: MeetingEntry[];
  averageOverallScore: number;
  averageSkills: Record<SkillKey, number>;
  direction: "improving" | "steady" | "declining";
}

export interface ScoreTrendPoint {
  id: string;
  label: string;
  value: number;
  caption: string;
}

export interface OverallPerformanceViewModel {
  totalMeetings: number;
  averageOverallScore: number | null;
  averageSkills: Record<SkillKey, number | null>;
  strongestSkill: SkillKey | null;
  weakestSkill: SkillKey | null;
  recurringMeetingCount: number;
  summaryLines: string[];
  trendPoints: ScoreTrendPoint[];
}
