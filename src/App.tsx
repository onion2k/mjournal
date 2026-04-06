import { useEffect, useMemo, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import "./App.css";
import {
  addDays,
  buildCalendarDays,
  buildMeetingTrends,
  buildOverallPerformance,
  buildWeeklySummary,
  createEmptyMeeting,
  deleteMeeting,
  getEditorPreference,
  formatDate,
  formatMonth,
  formatWeekRange,
  getJournalPath,
  getErrorMessage,
  getMeetingsForDate,
  isFutureDate,
  loadJournal,
  monthKey,
  moveMonth,
  scoreOptions,
  skillLabels,
  startOfWeek,
  todayIso,
  toMeetingInput,
  resetJournal,
  upsertMeeting,
} from "./lib/journal";
import type {
  JournalStore,
  MeetingEntry,
  MeetingEntryInput,
  EditorPreference,
  MeetingTrendViewModel,
  OverallPerformanceViewModel,
  ScoreTrendPoint,
  Score,
  SkillKey,
} from "./types";

type ViewMode = "today" | "calendar" | "weekly" | "trends" | "overall" | "settings" | "editor";
type SaveState = "idle" | "saving" | "deleting";

const navigationItems: Array<{ id: Exclude<ViewMode, "editor">; label: string; description: string }> = [
  { id: "today", label: "Today", description: "Capture today's meetings" },
  { id: "calendar", label: "Calendar", description: "Browse entries by day" },
  { id: "weekly", label: "Weekly Summary", description: "Review this week's patterns" },
  { id: "overall", label: "Overall performance", description: "See long-term progress" },
  { id: "trends", label: "Meeting Trends", description: "Track recurring meetings" },
  { id: "settings", label: "Settings", description: "Manage storage and reset data" },
];

function App() {
  const [store, setStore] = useState<JournalStore>({ version: 1, meetings: [] });
  const [activeView, setActiveView] = useState<ViewMode>("today");
  const [lastBrowseView, setLastBrowseView] = useState<Exclude<ViewMode, "editor">>("today");
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [selectedMonth, setSelectedMonth] = useState(monthKey(todayIso()));
  const [selectedTrend, setSelectedTrend] = useState<string | null>(null);
  const [draft, setDraft] = useState<MeetingEntryInput | null>(null);
  const [originalDraft, setOriginalDraft] = useState<MeetingEntryInput | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Loading journal...");
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [trendQuery, setTrendQuery] = useState("");
  const [settingsBusy, setSettingsBusy] = useState<"idle" | "opening" | "resetting">("idle");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [editorPreference, setEditorPreference] = useState<EditorPreference | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    void loadJournalData();
    void loadEditorPreference();
  }, []);

  const sortedMeetings = useMemo(() => [...store.meetings], [store.meetings]);
  const todaysMeetings = useMemo(
    () => getMeetingsForDate(sortedMeetings, todayIso()),
    [sortedMeetings],
  );
  const weekSummary = useMemo(
    () => buildWeeklySummary(sortedMeetings, selectedDate),
    [selectedDate, sortedMeetings],
  );
  const overallPerformance = useMemo(() => buildOverallPerformance(sortedMeetings), [sortedMeetings]);
  const trends = useMemo(() => buildMeetingTrends(sortedMeetings), [sortedMeetings]);

  useEffect(() => {
    if (!selectedTrend && trends.length > 0) {
      setSelectedTrend(trends[0].normalizedName);
    }
    if (selectedTrend && !trends.some((trend) => trend.normalizedName === selectedTrend)) {
      setSelectedTrend(trends[0]?.normalizedName ?? null);
    }
  }, [selectedTrend, trends]);

  const filteredTrends = useMemo(() => {
    if (!trendQuery.trim()) {
      return trends;
    }

    const query = trendQuery.trim().toLowerCase();
    return trends.filter((trend) => trend.displayName.toLowerCase().includes(query));
  }, [trendQuery, trends]);

  const selectedTrendView = useMemo(
    () => filteredTrends.find((trend) => trend.normalizedName === selectedTrend) ?? filteredTrends[0] ?? null,
    [filteredTrends, selectedTrend],
  );

  const draftDirty =
    draft !== null && originalDraft !== null && JSON.stringify(draft) !== JSON.stringify(originalDraft);
  const selectedDateIsFuture = draft ? isFutureDate(draft.date) : false;

  async function loadJournalData() {
    try {
      const loaded = await loadJournal();
      setStore({
        version: loaded.version,
        meetings: loaded.meetings,
      });
      setStatusMessage("Journal ready");
      setLoadError(null);
    } catch (error) {
      setLoadError(getErrorMessage(error));
      setStatusMessage("Journal failed to load");
    } finally {
      setIsLoaded(true);
    }
  }

  async function loadEditorPreference() {
    try {
      const preference = await getEditorPreference();
      setEditorPreference(preference);
    } catch {
      setEditorPreference(null);
    }
  }

  function navigateTo(view: Exclude<ViewMode, "editor">) {
    setActiveView(view);
    setLastBrowseView(view);
    setSettingsError(null);
    setConfirmReset(false);
  }

  function openNewMeeting(date: string, sourceView: Exclude<ViewMode, "editor"> = lastBrowseView) {
    const fresh = createEmptyMeeting(date);
    setDraft(fresh);
    setOriginalDraft(fresh);
    setSelectedDate(date);
    setSelectedMonth(monthKey(date));
    setFormError(null);
    setLastBrowseView(sourceView);
    setActiveView("editor");
  }

  function openMeeting(meeting: MeetingEntry, sourceView: Exclude<ViewMode, "editor"> = lastBrowseView) {
    const nextDraft = toMeetingInput(meeting);
    setDraft(nextDraft);
    setOriginalDraft(nextDraft);
    setSelectedDate(meeting.date);
    setSelectedMonth(monthKey(meeting.date));
    setFormError(null);
    setLastBrowseView(sourceView);
    setActiveView("editor");
  }

  function leaveEditor() {
    setActiveView(lastBrowseView);
    setFormError(null);
  }

  async function openJournalFile() {
    setSettingsBusy("opening");
    setSettingsError(null);
    try {
      const path = await getJournalPath();
      await openPath(path, editorPreference?.openWith);
      setStatusMessage(
        editorPreference ? `Opened journal JSON in ${editorPreference.label}` : "Opened journal JSON file",
      );
    } catch (error) {
      setSettingsError(getErrorMessage(error));
    } finally {
      setSettingsBusy("idle");
    }
  }

  async function resetJournalData() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }

    setSettingsBusy("resetting");
    setSettingsError(null);
    try {
      const resetStore = await resetJournal();
      setStore(resetStore);
      setDraft(null);
      setOriginalDraft(null);
      setStatusMessage("Journal data reset");
      setConfirmReset(false);
    } catch (error) {
      setSettingsError(getErrorMessage(error));
    } finally {
      setSettingsBusy("idle");
    }
  }

  async function saveMeeting() {
    if (!draft) {
      return;
    }

    setSaveState("saving");
    setFormError(null);
    try {
      const saved = await upsertMeeting(draft);
      setStore((current) => {
        const others = current.meetings.filter((meeting) => meeting.id !== saved.id);
        return {
          ...current,
          meetings: [...others, saved].sort((left, right) =>
            left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt),
          ),
        };
      });
      const clean = toMeetingInput(saved);
      setDraft(clean);
      setOriginalDraft(clean);
      setSelectedDate(saved.date);
      setSelectedMonth(monthKey(saved.date));
      setStatusMessage(`Saved ${saved.name}`);
      setActiveView(lastBrowseView);
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaveState("idle");
    }
  }

  async function removeMeeting() {
    if (!draft?.id) {
      return;
    }

    setSaveState("deleting");
    setFormError(null);
    try {
      await deleteMeeting(draft.id);
      setStore((current) => ({
        ...current,
        meetings: current.meetings.filter((meeting) => meeting.id !== draft.id),
      }));
      setDraft(null);
      setOriginalDraft(null);
      setStatusMessage("Meeting deleted");
      setActiveView(lastBrowseView);
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaveState("idle");
    }
  }

  function updateDraft<K extends keyof MeetingEntryInput>(key: K, value: MeetingEntryInput[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function updateSkill(skill: SkillKey, field: "score" | "note", value: Score | string) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        skills: {
          ...current.skills,
          [skill]: {
            ...current.skills[skill],
            [field]: value,
          },
        },
      };
    });
  }

  const currentWeekLabel = formatWeekRange(startOfWeek(selectedDate));
  const calendarDays = buildCalendarDays(selectedMonth);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">mjournal</p>
          <h1>Meeting reflection journal</h1>
          <p className="muted">Week of {currentWeekLabel}</p>
        </div>
        <div className="topbar-meta">
          <div className="status-pill">{statusMessage}</div>
          <button className="primary-button" onClick={() => openNewMeeting(selectedDate)}>
            New meeting
          </button>
        </div>
      </header>

      <div className={`workspace ${activeView === "editor" ? "is-editor" : ""}`}>
        <aside className="sidebar">
          {navigationItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeView === item.id ? "is-active" : ""}`}
              onClick={() => navigateTo(item.id)}
            >
              <span>{item.label}</span>
              <small>{item.description}</small>
            </button>
          ))}

          <section className="sidebar-card">
            <p className="sidebar-card-label">Today</p>
            <strong>{formatDate(todayIso(), { weekday: "long", day: "numeric", month: "long" })}</strong>
            <span>{todaysMeetings.length} meetings logged</span>
          </section>
        </aside>

        <main className="content">
          {loadError ? (
            <section className="panel load-error">
              <h2>Journal data could not be loaded</h2>
              <p>{loadError}</p>
              <button className="primary-button" onClick={() => void loadJournalData()}>
                Retry
              </button>
            </section>
          ) : activeView === "today" ? (
            <TodayView
              meetings={todaysMeetings}
              onEdit={(meeting) => openMeeting(meeting, "today")}
              onAdd={() => openNewMeeting(todayIso(), "today")}
            />
          ) : activeView === "calendar" ? (
            <CalendarView
              calendarDays={calendarDays}
              meetings={sortedMeetings}
              selectedDate={selectedDate}
              selectedMonth={selectedMonth}
              onSelectDate={(date) => {
                setSelectedDate(date);
                setSelectedMonth(monthKey(date));
              }}
              onMoveMonth={(amount) => setSelectedMonth((current) => moveMonth(current, amount))}
              onAddMeeting={() => openNewMeeting(selectedDate, "calendar")}
              onEditMeeting={(meeting) => openMeeting(meeting, "calendar")}
            />
          ) : activeView === "weekly" ? (
            <WeeklySummaryView
              summary={weekSummary}
              onChangeWeek={(amount) => setSelectedDate((current) => addDays(startOfWeek(current), amount * 7))}
            />
          ) : activeView === "overall" ? (
            <OverallPerformanceView summary={overallPerformance} />
          ) : activeView === "settings" ? (
            <SettingsView
              settingsBusy={settingsBusy}
              settingsError={settingsError}
              editorPreference={editorPreference}
              confirmReset={confirmReset}
              onOpenJournalFile={() => void openJournalFile()}
              onResetJournal={() => void resetJournalData()}
              onCancelReset={() => setConfirmReset(false)}
            />
          ) : activeView === "trends" ? (
            <TrendView
              trends={filteredTrends}
              query={trendQuery}
              selected={selectedTrendView}
              onQueryChange={setTrendQuery}
              onSelectTrend={setSelectedTrend}
              onOpenMeeting={(meeting) => openMeeting(meeting, "trends")}
            />
          ) : (
            <MeetingEditorView
              draft={draft}
              isLoaded={isLoaded}
              draftDirty={draftDirty}
              isFutureMeeting={selectedDateIsFuture}
              formError={formError}
              saveState={saveState}
              sourceLabel={navigationItems.find((item) => item.id === lastBrowseView)?.label ?? "Back"}
              onBack={leaveEditor}
              onChangeField={updateDraft}
              onChangeSkill={updateSkill}
              onSave={() => void saveMeeting()}
              onReset={() => {
                setDraft(originalDraft);
                setFormError(null);
              }}
              onDelete={draft?.id ? () => void removeMeeting() : undefined}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function SettingsView({
  settingsBusy,
  settingsError,
  editorPreference,
  confirmReset,
  onOpenJournalFile,
  onResetJournal,
  onCancelReset,
}: {
  settingsBusy: "idle" | "opening" | "resetting";
  settingsError: string | null;
  editorPreference: EditorPreference | null;
  confirmReset: boolean;
  onOpenJournalFile: () => void;
  onResetJournal: () => void;
  onCancelReset: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Storage and reset</h2>
          <p className="muted">Open the local JSON file or clear the journal back to an empty state.</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="summary-card">
          <div className="summary-card-header">
            <h3>Journal file</h3>
            <span>Local storage</span>
          </div>
          <p className="muted">
            {editorPreference
              ? `Open the underlying JSON file directly in ${editorPreference.label}.`
              : "Open the underlying JSON file with your system default editor or viewer."}
          </p>
          <button
            className="primary-button"
            onClick={onOpenJournalFile}
            disabled={settingsBusy !== "idle"}
          >
            {settingsBusy === "opening"
              ? "Opening..."
              : editorPreference
                ? `Open in ${editorPreference.label}`
                : "Open JSON file"}
          </button>
        </section>

        <section className="summary-card settings-danger">
          <div className="summary-card-header">
            <h3>Reset journal</h3>
            <span>Destructive</span>
          </div>
          <p className="muted">
            Remove all meeting entries and return the app to a fresh state. This cannot be undone.
          </p>
          {confirmReset ? (
            <div className="settings-confirm">
              <p className="settings-confirm-copy">
                Click confirm to permanently delete all meeting entries.
              </p>
              <div className="settings-confirm-actions">
                <button
                  className="danger-button"
                  onClick={onResetJournal}
                  disabled={settingsBusy !== "idle"}
                >
                  {settingsBusy === "resetting" ? "Resetting..." : "Confirm reset"}
                </button>
                <button
                  className="secondary-button"
                  onClick={onCancelReset}
                  disabled={settingsBusy !== "idle"}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="danger-button"
              onClick={onResetJournal}
              disabled={settingsBusy !== "idle"}
            >
              Reset all data
            </button>
          )}
        </section>
      </div>

      {settingsError && <p className="form-error settings-error">{settingsError}</p>}
    </section>
  );
}

function TodayView({
  meetings,
  onEdit,
  onAdd,
}: {
  meetings: MeetingEntry[];
  onEdit: (meeting: MeetingEntry) => void;
  onAdd: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Today</p>
          <h2>{formatDate(todayIso(), { weekday: "long", day: "numeric", month: "long" })}</h2>
        </div>
        <button className="primary-button" onClick={onAdd}>
          Add today's meeting
        </button>
      </div>

      {meetings.length === 0 ? (
        <EmptyState
          title="No meetings logged today"
          description="Capture your first reflection after a meeting to start building the week."
        />
      ) : (
        <div className="meeting-list">
          {meetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} onOpen={() => onEdit(meeting)} />
          ))}
        </div>
      )}
    </section>
  );
}

function CalendarView({
  calendarDays,
  meetings,
  selectedDate,
  selectedMonth,
  onSelectDate,
  onMoveMonth,
  onAddMeeting,
  onEditMeeting,
}: {
  calendarDays: Array<{ iso: string; inMonth: boolean; day: number }>;
  meetings: MeetingEntry[];
  selectedDate: string;
  selectedMonth: string;
  onSelectDate: (date: string) => void;
  onMoveMonth: (amount: number) => void;
  onAddMeeting: () => void;
  onEditMeeting: (meeting: MeetingEntry) => void;
}) {
  const meetingsForSelectedDay = getMeetingsForDate(meetings, selectedDate);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Calendar</p>
          <h2>{formatMonth(selectedMonth)}</h2>
        </div>
        <div className="toolbar">
          <button className="secondary-button" onClick={() => onMoveMonth(-1)}>
            Previous
          </button>
          <button className="secondary-button" onClick={() => onMoveMonth(1)}>
            Next
          </button>
          <button className="primary-button" onClick={onAddMeeting}>
            Add on {formatDate(selectedDate, { day: "numeric", month: "short" })}
          </button>
        </div>
      </div>

      <div className="calendar-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div key={label} className="calendar-weekday">
            {label}
          </div>
        ))}
        {calendarDays.map((day) => {
          const dayMeetings = getMeetingsForDate(meetings, day.iso);
          const averageScore = dayMeetings.length
            ? dayMeetings.reduce((sum, meeting) => sum + meeting.overallScore, 0) / dayMeetings.length
            : null;
          return (
            <button
              key={day.iso}
              className={`calendar-day ${day.inMonth ? "" : "is-dim"} ${
                dayMeetings.length > 4
                  ? "has-many-entries"
                  : dayMeetings.length > 0
                    ? "has-entries"
                    : ""
              } ${day.iso === selectedDate ? "is-selected" : ""}`}
              onClick={() => onSelectDate(day.iso)}
            >
              <span className="calendar-day-number">{day.day}</span>
              <span className="calendar-day-meta">{dayMeetings.length} meetings</span>
              <span className="calendar-day-score">
                {averageScore ? `${averageScore.toFixed(1)}/5` : "No score"}
              </span>
            </button>
          );
        })}
      </div>

      <section className="day-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Selected day</p>
            <h3>{formatDate(selectedDate, { weekday: "long", day: "numeric", month: "long" })}</h3>
          </div>
        </div>
        {meetingsForSelectedDay.length === 0 ? (
          <EmptyState
            title="No meetings on this day"
            description="Use the Add action to create a reflection for the selected date."
          />
        ) : (
          <div className="meeting-list">
            {meetingsForSelectedDay.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} onOpen={() => onEditMeeting(meeting)} />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function WeeklySummaryView({
  summary,
  onChangeWeek,
}: {
  summary: ReturnType<typeof buildWeeklySummary>;
  onChangeWeek: (amount: number) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Weekly Summary</p>
          <h2>{formatWeekRange(summary.weekStart)}</h2>
        </div>
        <div className="toolbar">
          <button className="secondary-button" onClick={() => onChangeWeek(-1)}>
            Previous week
          </button>
          <button className="secondary-button" onClick={() => onChangeWeek(1)}>
            Next week
          </button>
        </div>
      </div>

      <div className="summary-grid summary-grid-stats">
        <MetricCard label="Meetings" value={`${summary.meetingCount}`} accent="neutral" />
        <MetricCard
          label="Average score"
          value={summary.averageOverallScore ? `${summary.averageOverallScore.toFixed(1)}/5` : "No data"}
          accent="neutral"
        />
        <MetricCard
          label="Strongest skill"
          value={summary.strongestSkill ? skillLabels[summary.strongestSkill] : "No data"}
          accent="positive"
        />
        <MetricCard
          label="Needs attention"
          value={summary.weakestSkill ? skillLabels[summary.weakestSkill] : "No data"}
          accent="caution"
        />
      </div>

      <div className="summary-columns summary-columns-primary">
        <section className="summary-card">
          <div className="summary-card-header">
            <h3>Generated notes</h3>
            <span>{summary.meetingCount > 0 ? "Auto summary" : "Empty week"}</span>
          </div>
          <ul className="summary-lines summary-notes-list">
            {summary.summaryLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="summary-card">
          <div className="summary-card-header">
            <h3>Skill averages</h3>
            <span>Across this week</span>
          </div>
          <div className="skill-average-list">
            {(["pausing", "listening", "questioning"] as SkillKey[]).map((skill) => (
              <div key={skill} className="skill-average-row">
                <div className="skill-average-copy">
                  <span>{skillLabels[skill]}</span>
                  <small>
                    {summary.averageSkills[skill] !== null ? "Observed this week" : "No entries yet"}
                  </small>
                </div>
                <strong className="skill-average-value">
                  {summary.averageSkills[skill] !== null
                    ? `${summary.averageSkills[skill]?.toFixed(1)}/5`
                    : "No data"}
                </strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="summary-columns">
        <section className="summary-card">
          <div className="summary-card-header">
            <h3>Highest-scoring meetings</h3>
            <span>Best reflections</span>
          </div>
          {summary.topMeetings.length === 0 ? (
            <p className="muted">No meetings in this week yet.</p>
          ) : (
            <ul className="summary-meeting-list">
              {summary.topMeetings.map((meeting) => (
                <li key={meeting.id} className="summary-meeting-row">
                  <div className="summary-meeting-copy">
                    <strong>{meeting.name}</strong>
                    <small>{formatDate(meeting.date, { day: "numeric", month: "short" })}</small>
                  </div>
                  <span className="summary-meeting-score">{meeting.overallScore}/5</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="summary-card">
          <div className="summary-card-header">
            <h3>Lowest-scoring meetings</h3>
            <span>Most to revisit</span>
          </div>
          {summary.meetingCount < 2 ? (
            <p className="muted">Add at least two meetings this week to compare weaker sessions.</p>
          ) : summary.bottomMeetings.length === 0 ? (
            <p className="muted">No meetings in this week yet.</p>
          ) : (
            <ul className="summary-meeting-list">
              {summary.bottomMeetings.map((meeting) => (
                <li key={meeting.id} className="summary-meeting-row">
                  <div className="summary-meeting-copy">
                    <strong>{meeting.name}</strong>
                    <small>{formatDate(meeting.date, { day: "numeric", month: "short" })}</small>
                  </div>
                  <span className="summary-meeting-score">{meeting.overallScore}/5</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function TrendView({
  trends,
  query,
  selected,
  onQueryChange,
  onSelectTrend,
  onOpenMeeting,
}: {
  trends: MeetingTrendViewModel[];
  query: string;
  selected: MeetingTrendViewModel | null;
  onQueryChange: (value: string) => void;
  onSelectTrend: (value: string) => void;
  onOpenMeeting: (meeting: MeetingEntry) => void;
}) {
  return (
    <section className="panel trends-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Meeting Trends</p>
          <h2>Recurring meetings</h2>
        </div>
      </div>

      {trends.length === 0 ? (
        <EmptyState
          title="No repeated meeting names yet"
          description="Log the same meeting across multiple dates to unlock the trend view."
        />
      ) : (
        <div className="trends-layout">
          <div className="trend-list-panel">
            <div className="summary-card trend-search-card">
              <div className="summary-card-header">
                <h3>Recurring meetings</h3>
                <span>{trends.length} tracked</span>
              </div>
              <input
                value={query}
                onChange={(event) => onQueryChange(event.currentTarget.value)}
                placeholder="Search meeting names"
              />
            </div>
            <div className="trend-list">
              {trends.map((trend) => (
                <button
                  key={trend.normalizedName}
                  className={`trend-list-item ${
                    selected?.normalizedName === trend.normalizedName ? "is-active" : ""
                  }`}
                  onClick={() => onSelectTrend(trend.normalizedName)}
                >
                  <div className="trend-list-copy">
                    <strong>{trend.displayName}</strong>
                    <small>{trend.entries.length} entries logged</small>
                  </div>
                  <div className="trend-list-meta">
                    <span className="trend-list-score">{trend.averageOverallScore.toFixed(1)}/5</span>
                    <span className={`trend-direction trend-${trend.direction}`}>{trend.direction}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selected ? (
            <div className="trend-detail">
              <div className="panel-header trend-detail-header">
                <div>
                  <p className="eyebrow">Selected trend</p>
                  <h3>{selected.displayName}</h3>
                  <p className="muted">Historical view across repeated meetings with the same name.</p>
                </div>
                <span className={`trend-direction trend-${selected.direction}`}>{selected.direction}</span>
              </div>

              <div className="summary-grid summary-grid-stats">
                <MetricCard
                  label="Average score"
                  value={`${selected.averageOverallScore.toFixed(1)}/5`}
                  accent="neutral"
                />
                <MetricCard
                  label="Pausing"
                  value={`${selected.averageSkills.pausing.toFixed(1)}/5`}
                  accent="neutral"
                />
                <MetricCard
                  label="Listening"
                  value={`${selected.averageSkills.listening.toFixed(1)}/5`}
                  accent="positive"
                />
                <MetricCard
                  label="Questioning"
                  value={`${selected.averageSkills.questioning.toFixed(1)}/5`}
                  accent="caution"
                />
              </div>

              <section className="summary-card">
                <div className="summary-card-header">
                  <h3>Score trend</h3>
                  <span>Overall score by meeting</span>
                </div>
                <TrendChart points={selected.entries.map((entry) => ({
                  id: entry.id,
                  label: formatDate(entry.date, { day: "numeric", month: "short" }),
                  value: entry.overallScore,
                  caption: `P ${entry.skills.pausing.score} · L ${entry.skills.listening.score} · Q ${entry.skills.questioning.score}`,
                }))} />
              </section>

              <section className="summary-card">
                <div className="summary-card-header">
                  <h3>Meeting timeline</h3>
                  <span>{selected.entries.length} sessions</span>
                </div>
                <div className="timeline trend-timeline">
                  {selected.entries.map((meeting) => (
                    <button key={meeting.id} className="timeline-row" onClick={() => onOpenMeeting(meeting)}>
                      <div className="timeline-row-copy">
                        <strong>{formatDate(meeting.date)}</strong>
                        <small>
                          P {meeting.skills.pausing.score} · L {meeting.skills.listening.score} · Q{" "}
                          {meeting.skills.questioning.score}
                        </small>
                      </div>
                      <span className="summary-meeting-score">{meeting.overallScore}/5</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <EmptyState title="No trend selected" description="Choose a recurring meeting from the list." />
          )}
        </div>
      )}
    </section>
  );
}

function OverallPerformanceView({ summary }: { summary: OverallPerformanceViewModel }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Overall performance</p>
          <h2>All meeting data</h2>
        </div>
      </div>

      <div className="summary-grid summary-grid-stats">
        <MetricCard label="Total meetings" value={`${summary.totalMeetings}`} accent="neutral" />
        <MetricCard
          label="Average score"
          value={summary.averageOverallScore !== null ? `${summary.averageOverallScore.toFixed(1)}/5` : "No data"}
          accent="neutral"
        />
        <MetricCard
          label="Strongest skill"
          value={summary.strongestSkill ? skillLabels[summary.strongestSkill] : "No data"}
          accent="positive"
        />
        <MetricCard
          label="Recurring series"
          value={`${summary.recurringMeetingCount}`}
          accent="caution"
        />
      </div>

      <div className="summary-columns summary-columns-primary">
        <section className="summary-card">
          <div className="summary-card-header">
            <h3>Performance overview</h3>
            <span>Across all meetings</span>
          </div>
          <ul className="summary-lines summary-notes-list">
            {summary.summaryLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="summary-card">
          <div className="summary-card-header">
            <h3>Skill averages</h3>
            <span>Long-term baseline</span>
          </div>
          <div className="skill-average-list">
            {(["pausing", "listening", "questioning"] as SkillKey[]).map((skill) => (
              <div key={skill} className="skill-average-row">
                <div className="skill-average-copy">
                  <span>{skillLabels[skill]}</span>
                  <small>
                    {summary.averageSkills[skill] !== null ? "Across all entries" : "No entries yet"}
                  </small>
                </div>
                <strong className="skill-average-value">
                  {summary.averageSkills[skill] !== null
                    ? `${summary.averageSkills[skill]?.toFixed(1)}/5`
                    : "No data"}
                </strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="summary-card overall-trend-card">
        <div className="summary-card-header">
          <h3>Weekly trend</h3>
          <span>Average score by week</span>
        </div>
        {summary.trendPoints.length === 0 ? (
          <p className="muted">Log meetings across several dates to see your overall trend line.</p>
        ) : (
          <TrendChart points={summary.trendPoints} />
        )}
      </section>
    </section>
  );
}

function MeetingEditorView({
  draft,
  isLoaded,
  draftDirty,
  isFutureMeeting,
  formError,
  saveState,
  sourceLabel,
  onBack,
  onChangeField,
  onChangeSkill,
  onSave,
  onReset,
  onDelete,
}: {
  draft: MeetingEntryInput | null;
  isLoaded: boolean;
  draftDirty: boolean;
  isFutureMeeting: boolean;
  formError: string | null;
  saveState: SaveState;
  sourceLabel: string;
  onBack: () => void;
  onChangeField: <K extends keyof MeetingEntryInput>(key: K, value: MeetingEntryInput[K]) => void;
  onChangeSkill: (skill: SkillKey, field: "score" | "note", value: Score | string) => void;
  onSave: () => void;
  onReset: () => void;
  onDelete?: () => void;
}) {
  if (!isLoaded) {
    return (
      <section className="panel">
        <EmptyState title="Loading editor" description="Your meeting form will be ready in a moment." />
      </section>
    );
  }

  if (!draft) {
    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Meeting editor</p>
            <h2>No meeting selected</h2>
          </div>
          <button className="secondary-button" onClick={onBack}>
            Back to {sourceLabel}
          </button>
        </div>
        <EmptyState
          title="Start a reflection"
          description="Use the add actions from Today or Calendar to begin a new meeting entry."
        />
      </section>
    );
  }

  return (
    <section className="panel editor-page">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Meeting editor</p>
          <h2>{draft.id ? "Edit reflection" : "New reflection"}</h2>
          <p className="muted">
            {isFutureMeeting
              ? "This meeting is scheduled in the future. Add the name and date now, then return later to complete the reflection."
              : "Capture what happened in the meeting and what to improve next time."}
          </p>
        </div>
        <div className="editor-page-actions">
          {draftDirty && <span className="warning-chip">Unsaved changes</span>}
          <button className="secondary-button" onClick={onBack}>
            Back to {sourceLabel}
          </button>
        </div>
      </div>

      <div className="editor-form">
        <label className="field">
          <span>Meeting name</span>
          <input
            value={draft.name}
            onChange={(event) => onChangeField("name", event.currentTarget.value)}
            placeholder="e.g. Weekly design sync"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              value={draft.date}
              onChange={(event) => onChangeField("date", event.currentTarget.value)}
            />
          </label>

          <label className="field">
            <span>Overall score</span>
            <select
              value={draft.overallScore}
              onChange={(event) => onChangeField("overallScore", Number(event.currentTarget.value) as Score)}
              disabled={isFutureMeeting}
            >
              {scoreOptions.map((score) => (
                <option key={score} value={score}>
                  {score}/5
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="skill-grid skill-grid-wide">
          {(["pausing", "listening", "questioning"] as SkillKey[]).map((skill) => (
            <section
              key={skill}
              className={`skill-card skill-card-${skill} ${isFutureMeeting ? "is-disabled" : ""}`}
            >
              <div className="skill-card-header">
                <h3>{skillLabels[skill]}</h3>
                <select
                  value={draft.skills[skill].score}
                  onChange={(event) =>
                    onChangeSkill(skill, "score", Number(event.currentTarget.value) as Score)
                  }
                  disabled={isFutureMeeting}
                >
                  {scoreOptions.map((score) => (
                    <option key={score} value={score}>
                      {score}/5
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={5}
                value={draft.skills[skill].note}
                onChange={(event) => onChangeSkill(skill, "note", event.currentTarget.value)}
                placeholder={`What stood out about ${skillLabels[skill].toLowerCase()}?`}
                disabled={isFutureMeeting}
              />
            </section>
          ))}
        </div>

        <div className="reflection-grid">
          <label className={`field reflection success ${isFutureMeeting ? "is-disabled" : ""}`}>
            <span>Successes</span>
            <textarea
              rows={6}
              value={draft.successes}
              onChange={(event) => onChangeField("successes", event.currentTarget.value)}
              placeholder="What went well in this meeting?"
              disabled={isFutureMeeting}
            />
          </label>

          <label className={`field reflection misses ${isFutureMeeting ? "is-disabled" : ""}`}>
            <span>Misses</span>
            <textarea
              rows={6}
              value={draft.misses}
              onChange={(event) => onChangeField("misses", event.currentTarget.value)}
              placeholder="What would you handle differently next time?"
              disabled={isFutureMeeting}
            />
          </label>
        </div>

        {isFutureMeeting && (
          <p className="scheduled-note">
            Future meetings are excluded from weekly summaries, recurring-meeting trends, and overall performance until their date arrives.
          </p>
        )}

        {formError && <p className="form-error">{formError}</p>}

        <div className="editor-actions">
          <button className="primary-button" onClick={onSave} disabled={saveState !== "idle"}>
            {saveState === "saving" ? "Saving..." : "Save meeting"}
          </button>
          <button className="secondary-button" onClick={onReset} disabled={!draftDirty || saveState !== "idle"}>
            Reset changes
          </button>
          {onDelete && (
            <button className="danger-button" onClick={onDelete} disabled={saveState !== "idle"}>
              {saveState === "deleting" ? "Deleting..." : "Delete"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function MeetingCard({ meeting, onOpen }: { meeting: MeetingEntry; onOpen: () => void }) {
  return (
    <button className="meeting-card" onClick={onOpen}>
      <div className="meeting-card-header">
        <div>
          <p className="meeting-card-date">{formatDate(meeting.date)}</p>
          <h3>{meeting.name}</h3>
        </div>
        <span className="score-badge">{meeting.overallScore}/5</span>
      </div>
      <div className="skill-badges">
        <span>P {meeting.skills.pausing.score}</span>
        <span>L {meeting.skills.listening.score}</span>
        <span>Q {meeting.skills.questioning.score}</span>
      </div>
      <p className="meeting-card-copy">{meeting.successes || meeting.misses || "No notes yet."}</p>
    </button>
  );
}

function MetricCard({
  label,
  value,
  accent = "neutral",
}: {
  label: string;
  value: string;
  accent?: "neutral" | "positive" | "caution";
}) {
  return (
    <article className={`metric-card metric-card-${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function TrendChart({ points }: { points: ScoreTrendPoint[] }) {
  const width = 720;
  const height = 220;
  const padding = { top: 20, right: 20, bottom: 36, left: 28 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const chartPoints = points.map((point, index) => {
    const x =
      points.length === 1
        ? padding.left + innerWidth / 2
        : padding.left + (innerWidth / (points.length - 1)) * index;
    const y = padding.top + ((5 - point.value) / 4) * innerHeight;
    return { x, y, point };
  });

  const path = chartPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const gridValues = [1, 2, 3, 4, 5];

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Meeting trend chart">
        {gridValues.map((value) => {
          const y = padding.top + ((5 - value) / 4) * innerHeight;
          return (
            <g key={value}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                className="trend-chart-grid"
              />
              <text x={8} y={y + 4} className="trend-chart-axis">
                {value}
              </text>
            </g>
          );
        })}

        <path d={path} className="trend-chart-line" />

        {chartPoints.map((point) => (
          <g key={point.point.id}>
            <circle cx={point.x} cy={point.y} r={5} className="trend-chart-point" />
            <text x={point.x} y={height - 12} textAnchor="middle" className="trend-chart-axis">
              {point.point.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="trend-chart-legend">
        {points.map((point) => (
          <div key={point.id} className="trend-chart-legend-item">
            <strong>{point.label}</strong>
            <span>{point.caption}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <section className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </section>
  );
}

export default App;
