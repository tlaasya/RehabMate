// A simple movement-state counter. It is a demo heuristic, not clinical assessment.
export function createRepCounter() {
  let state = "down";
  let reps = 0;
  let lastTransition = 0;

  return {
    update(angle, now = performance.now()) {
      if (!Number.isFinite(angle)) return { reps, state };
      // Hysteresis avoids counting small fluctuations as full repetitions.
      if (state === "down" && angle >= 55 && now - lastTransition > 500) {
        state = "up";
        lastTransition = now;
      } else if (state === "up" && angle <= 30 && now - lastTransition > 500) {
        reps += 1;
        state = "down";
        lastTransition = now;
      }
      return { reps, state };
    },
    getReps() { return reps; },
    reset() { state = "down"; reps = 0; lastTransition = 0; }
  };
}

export function angleAtShoulder(shoulder, hip, wrist) {
  if (![shoulder, hip, wrist].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const a = { x: hip.x - shoulder.x, y: hip.y - shoulder.y };
  const b = { x: wrist.x - shoulder.x, y: wrist.y - shoulder.y };
  const denom = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (!denom) return null;
  const cosine = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / denom));
  return Math.acos(cosine) * 180 / Math.PI;
}