const STORAGE_KEY = "rehabmate.sessions.v1";

export function getSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === "object") : [];
  } catch (error) {
    console.warn("Could not read saved RehabMate sessions:", error);
    return [];
  }
}

export function saveSession(session) {
  const sessions = getSessions();
  sessions.unshift(session);
  // Keep a small local history for this demo.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 100)));
  return getSessions();
}

export function clearSessions() {
  localStorage.removeItem(STORAGE_KEY);
}