import { getSessions, clearSessions } from "./storage.js";

const $ = selector => document.querySelector(selector);
const formatDuration = seconds => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

export function renderHistory() {
  const sessions = getSessions();
  const totalReps = sessions.reduce((sum, item) => sum + (Number(item.reps ?? item.repetitions) || 0), 0);
  const totalSeconds = sessions.reduce((sum, item) => sum + (Number(item.durationSeconds ?? item.duration) || 0), 0);
  const sessionsEl = $("#totalSessions");
  const repsEl = $("#totalReps");
  const latestEl = $("#latestSession");
  if (sessionsEl) sessionsEl.textContent = String(sessions.length);
  if (repsEl) repsEl.textContent = String(totalReps);
  if (latestEl) latestEl.textContent = sessions.length ? (sessions[0].exercise || "Practice session") : "No sessions yet";

  const list = $("#history");
  if (!list) return;
  list.replaceChildren();
  const header = document.createElement("div");
  header.className = "history-header";
  ["Exercise and date", "Duration", "Repetitions"].forEach(label => {
    const span = document.createElement("span"); span.textContent = label; header.append(span);
  });
  list.append(header);
  if (!sessions.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No sessions recorded yet."; list.append(empty); return;
  }
  sessions.forEach(session => {
    const row = document.createElement("div"); row.className = "history-item";
    const exercise = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = session.exercise || "Practice session";
    const date = new Date(session.date);
    const dateEl = document.createElement("small");
    dateEl.textContent = Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    exercise.append(title, dateEl);
    const duration = document.createElement("span"); duration.textContent = formatDuration(session.durationSeconds ?? session.duration);
    const reps = document.createElement("span"); reps.textContent = String(Number(session.reps ?? session.repetitions) || 0);
    row.append(exercise, duration, reps); list.append(row);
  });
}

export function setupHistory(onChanged) {
  const clearButton = $("#clear-history");
  if (!clearButton) return;
  clearButton.addEventListener("click", () => {
    if (!getSessions().length) return;
    if (window.confirm("Clear all saved session summaries from this browser?")) {
      clearSessions(); renderHistory(); onChanged?.();
    }
  });
}
