use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const STORE_VERSION: u8 = 1;
const STORE_FILE_NAME: &str = "journal-store.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillReflection {
    score: u8,
    note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSkills {
    pausing: SkillReflection,
    listening: SkillReflection,
    questioning: SkillReflection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingEntry {
    id: String,
    date: String,
    name: String,
    skills: MeetingSkills,
    successes: String,
    misses: String,
    overall_score: u8,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingEntryInput {
    id: Option<String>,
    date: String,
    name: String,
    skills: MeetingSkills,
    successes: String,
    misses: String,
    overall_score: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JournalStore {
    version: u8,
    meetings: Vec<MeetingEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditorPreference {
    label: String,
    open_with: String,
}

impl Default for JournalStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            meetings: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandError {
    code: String,
    message: String,
}

type CommandResult<T> = Result<T, CommandError>;

impl CommandError {
    fn validation(message: impl Into<String>) -> Self {
        Self {
            code: "validation_error".into(),
            message: message.into(),
        }
    }

    fn storage(message: impl Into<String>) -> Self {
        Self {
            code: "storage_error".into(),
            message: message.into(),
        }
    }

    fn data(message: impl Into<String>) -> Self {
        Self {
            code: "data_error".into(),
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: "not_found".into(),
            message: message.into(),
        }
    }
}

#[tauri::command]
fn load_journal(app: AppHandle) -> CommandResult<JournalStore> {
    let path = journal_store_path(&app)?;
    load_journal_from_path(&path)
}

#[tauri::command]
fn upsert_meeting(app: AppHandle, input: MeetingEntryInput) -> CommandResult<MeetingEntry> {
    validate_meeting_input(&input)?;

    let path = journal_store_path(&app)?;
    let mut store = load_journal_from_path(&path)?;
    let now = Utc::now().to_rfc3339();
    let meeting = if let Some(id) = input.id.as_ref() {
        let existing = store
            .meetings
            .iter_mut()
            .find(|meeting| meeting.id == *id)
            .ok_or_else(|| CommandError::not_found("Meeting entry not found."))?;

        let created_at = existing.created_at.clone();
        let updated = materialize_meeting(input, created_at, now);
        *existing = updated.clone();
        updated
    } else {
        let created = materialize_meeting(input, now.clone(), now);
        store.meetings.push(created.clone());
        created
    };

    store
        .meetings
        .sort_by(|left, right| left.date.cmp(&right.date).then(left.created_at.cmp(&right.created_at)));
    write_journal_to_path(&path, &store)?;

    Ok(meeting)
}

#[tauri::command]
fn delete_meeting(app: AppHandle, id: String) -> CommandResult<()> {
    if id.trim().is_empty() {
        return Err(CommandError::validation("Meeting id is required."));
    }

    let path = journal_store_path(&app)?;
    let mut store = load_journal_from_path(&path)?;
    let original_len = store.meetings.len();
    store.meetings.retain(|meeting| meeting.id != id);

    if store.meetings.len() == original_len {
        return Err(CommandError::not_found("Meeting entry not found."));
    }

    write_journal_to_path(&path, &store)?;
    Ok(())
}

#[tauri::command]
fn get_journal_path(app: AppHandle) -> CommandResult<String> {
    let path = journal_store_path(&app)?;

    if !path.exists() {
        write_journal_to_path(&path, &JournalStore::default())?;
    }

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn reset_journal(app: AppHandle) -> CommandResult<JournalStore> {
    let path = journal_store_path(&app)?;
    let store = JournalStore::default();
    write_journal_to_path(&path, &store)?;
    Ok(store)
}

#[tauri::command]
fn get_editor_preference() -> Option<EditorPreference> {
    detect_vscode()
}

fn materialize_meeting(input: MeetingEntryInput, created_at: String, updated_at: String) -> MeetingEntry {
    MeetingEntry {
        id: input.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        date: input.date,
        name: normalize_display_name(&input.name),
        skills: MeetingSkills {
            pausing: normalize_skill(input.skills.pausing),
            listening: normalize_skill(input.skills.listening),
            questioning: normalize_skill(input.skills.questioning),
        },
        successes: normalize_text(&input.successes),
        misses: normalize_text(&input.misses),
        overall_score: input.overall_score,
        created_at,
        updated_at,
    }
}

fn normalize_skill(skill: SkillReflection) -> SkillReflection {
    SkillReflection {
        score: skill.score,
        note: normalize_text(&skill.note),
    }
}

fn normalize_display_name(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_text(value: &str) -> String {
    value.trim().to_string()
}

fn validate_meeting_input(input: &MeetingEntryInput) -> CommandResult<()> {
    if input.date.trim().is_empty() {
        return Err(CommandError::validation("Meeting date is required."));
    }

    if chrono::NaiveDate::parse_from_str(input.date.trim(), "%Y-%m-%d").is_err() {
        return Err(CommandError::validation(
            "Meeting date must use the format YYYY-MM-DD.",
        ));
    }

    if normalize_display_name(&input.name).is_empty() {
        return Err(CommandError::validation("Meeting name is required."));
    }

    validate_score(input.overall_score, "Overall score")?;
    validate_skill(&input.skills.pausing, "Pausing")?;
    validate_skill(&input.skills.listening, "Listening")?;
    validate_skill(&input.skills.questioning, "Questioning")?;

    Ok(())
}

fn validate_skill(skill: &SkillReflection, label: &str) -> CommandResult<()> {
    validate_score(skill.score, label)
}

fn validate_score(score: u8, label: &str) -> CommandResult<()> {
    if !(1..=5).contains(&score) {
        return Err(CommandError::validation(format!(
            "{label} score must be between 1 and 5."
        )));
    }

    Ok(())
}

fn journal_store_path(app: &AppHandle) -> CommandResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| CommandError::storage(format!("Unable to resolve app data directory: {error}")))?;

    fs::create_dir_all(&dir)
        .map_err(|error| CommandError::storage(format!("Unable to create app data directory: {error}")))?;

    Ok(dir.join(STORE_FILE_NAME))
}

fn load_journal_from_path(path: &Path) -> CommandResult<JournalStore> {
    if !path.exists() {
        return Ok(JournalStore::default());
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| CommandError::storage(format!("Unable to read journal data: {error}")))?;

    let mut store: JournalStore = serde_json::from_str(&contents)
        .map_err(|error| CommandError::data(format!("Journal data is malformed: {error}")))?;

    if store.version != STORE_VERSION {
        return Err(CommandError::data(format!(
            "Unsupported journal data version: {}",
            store.version
        )));
    }

    store
        .meetings
        .sort_by(|left, right| left.date.cmp(&right.date).then(left.created_at.cmp(&right.created_at)));

    Ok(store)
}

fn write_journal_to_path(path: &Path, store: &JournalStore) -> CommandResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            CommandError::storage(format!("Unable to prepare journal storage directory: {error}"))
        })?;
    }

    let serialized = serde_json::to_string_pretty(store)
        .map_err(|error| CommandError::storage(format!("Unable to serialize journal data: {error}")))?;
    let tmp_path = path.with_extension("tmp");

    fs::write(&tmp_path, serialized)
        .map_err(|error| CommandError::storage(format!("Unable to write journal data: {error}")))?;
    fs::rename(&tmp_path, path)
        .map_err(|error| CommandError::storage(format!("Unable to finalize journal data: {error}")))?;

    Ok(())
}

fn detect_vscode() -> Option<EditorPreference> {
    if cfg!(target_os = "macos") {
        let app_locations = [
            "/Applications/Visual Studio Code.app",
            "/Applications/Visual Studio Code - Insiders.app",
            "/System/Applications/Visual Studio Code.app",
        ];

        if app_locations.iter().any(|path| Path::new(path).exists()) {
            return Some(EditorPreference {
                label: "VS Code".into(),
                open_with: "Visual Studio Code".into(),
            });
        }
    }

    let command_names: &[&str] = if cfg!(target_os = "windows") {
        &["code.cmd", "code.exe", "code"]
    } else {
        &["code"]
    };

    for command in command_names {
        if command_available(command) {
            return Some(EditorPreference {
                label: "VS Code".into(),
                open_with: (*command).into(),
            });
        }
    }

    None
}

fn command_available(command: &str) -> bool {
    Command::new(command)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;

    fn meeting_input(name: &str, date: &str, score: u8) -> MeetingEntryInput {
        MeetingEntryInput {
            id: None,
            date: date.to_string(),
            name: name.to_string(),
            skills: MeetingSkills {
                pausing: SkillReflection {
                    score,
                    note: "Paused and let others finish".into(),
                },
                listening: SkillReflection {
                    score: 4,
                    note: "Summarised key points".into(),
                },
                questioning: SkillReflection {
                    score: 5,
                    note: "Used clarifying questions".into(),
                },
            },
            successes: "Held the room well".into(),
            misses: "Interrupted once".into(),
            overall_score: score,
        }
    }

    #[test]
    fn rejects_missing_required_fields() {
        let invalid = MeetingEntryInput {
            name: "   ".into(),
            date: "".into(),
            ..meeting_input("Weekly sync", "2026-04-06", 3)
        };

        let error = validate_meeting_input(&invalid).unwrap_err();
        assert_eq!(error.code, "validation_error");
    }

    #[test]
    fn rejects_out_of_range_scores() {
        let invalid = meeting_input("Retro", "2026-04-06", 6);
        let error = validate_meeting_input(&invalid).unwrap_err();
        assert_eq!(error.code, "validation_error");
        assert!(error.message.contains("Overall score"));
    }

    #[test]
    fn creates_empty_store_when_file_is_missing() {
        let path = std::env::temp_dir().join(format!("mjournal-test-{}.json", Uuid::new_v4()));
        let store = load_journal_from_path(&path).unwrap();
        assert_eq!(store, JournalStore::default());
    }

    #[test]
    fn writes_and_reads_store() {
        let path = std::env::temp_dir().join(format!("mjournal-write-{}.json", Uuid::new_v4()));
        let meeting = materialize_meeting(
            meeting_input("1:1", "2026-04-06", 4),
            Utc::now().to_rfc3339(),
            Utc::now().to_rfc3339(),
        );
        let store = JournalStore {
            version: STORE_VERSION,
            meetings: vec![meeting.clone()],
        };

        write_journal_to_path(&path, &store).unwrap();
        let loaded = load_journal_from_path(&path).unwrap();
        assert_eq!(loaded.meetings, vec![meeting]);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn reset_store_serializes_default_document() {
        let path = std::env::temp_dir().join(format!("mjournal-reset-{}.json", Uuid::new_v4()));
        write_journal_to_path(&path, &JournalStore::default()).unwrap();
        let loaded = load_journal_from_path(&path).unwrap();

        assert_eq!(loaded, JournalStore::default());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn normalizes_meeting_names_for_trend_matching() {
        assert_eq!(
            normalize_display_name("  Weekly   Design   Sync "),
            "Weekly Design Sync"
        );
    }

    #[test]
    fn normalizes_notes_to_empty_strings() {
        let meeting = materialize_meeting(
            MeetingEntryInput {
                misses: "   ".into(),
                successes: "  ".into(),
                skills: MeetingSkills {
                    pausing: SkillReflection {
                        score: 3,
                        note: " ".into(),
                    },
                    listening: SkillReflection {
                        score: 4,
                        note: "\n".into(),
                    },
                    questioning: SkillReflection {
                        score: 5,
                        note: "\t".into(),
                    },
                },
                ..meeting_input("Team Check-In", "2026-04-07", 4)
            },
            Utc::now().to_rfc3339(),
            Utc::now().to_rfc3339(),
        );

        assert_eq!(meeting.successes, "");
        assert_eq!(meeting.misses, "");
        assert_eq!(meeting.skills.pausing.note, "");
    }

    #[test]
    fn parses_iso_timestamps_used_for_sorting() {
        let earlier = DateTime::parse_from_rfc3339("2026-04-01T09:00:00Z").unwrap();
        let later = DateTime::parse_from_rfc3339("2026-04-01T10:00:00Z").unwrap();

        assert!(earlier < later);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_journal,
            upsert_meeting,
            delete_meeting,
            get_journal_path,
            reset_journal,
            get_editor_preference
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
