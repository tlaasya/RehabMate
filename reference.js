import { getExerciseRule, measureExercise, usesHandLandmarks } from "./exercise-monitor.js?monitoring-v1";

function seekTo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.02) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Reference video seek timed out.")); }, 4000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeek);
      video.removeEventListener("error", onError);
    };
    const onSeek = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("Reference video could not be decoded.")); };
    video.addEventListener("seeked", onSeek, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}

export function extractReferenceCycle(trace, range, unit = "units") {
  if (!Array.isArray(trace) || trace.length < 6) {
    throw new Error("Too few reliable landmarks were found. Use a clear full-view reference clip.");
  }
  const min = Number(range?.min);
  const max = Number(range?.max);
  const tolerance = Number(range?.tolerance);
  if (![min, max, tolerance].every(Number.isFinite) || min >= max || tolerance < 0 || max - min <= tolerance * 2) {
    throw new Error("Set therapist-approved start, target, and tolerance values before analyzing a reference cycle.");
  }
  const startLimit = min + tolerance;
  const targetLimit = max - tolerance;
  const startIndex = trace.findIndex(value => value <= startLimit);
  const targetIndex = startIndex < 0 ? -1 : trace.findIndex((value, index) => index > startIndex && value >= targetLimit);
  const endIndex = targetIndex < 0 ? -1 : trace.findIndex((value, index) => index > targetIndex && value <= startLimit);
  const observedMin = Math.min(...trace);
  const observedMax = Math.max(...trace);
  if (startIndex < 0) throw new Error(`No reliable reference sample reached the configured start (at or below ${startLimit} ${unit}). Observed range: ${observedMin.toFixed(1)}–${observedMax.toFixed(1)} ${unit}.`);
  if (targetIndex < 0) throw new Error(`The reference did not reach the configured target (at or above ${targetLimit} ${unit}) after its start. Observed range: ${observedMin.toFixed(1)}–${observedMax.toFixed(1)} ${unit}.`);
  if (endIndex < 0) throw new Error(`The reference reached its target but did not return to the configured start (at or below ${startLimit} ${unit}).`);
  const cycle = trace.slice(startIndex, endIndex + 1);
  if (cycle.length < 6 || Math.max(...cycle) - Math.min(...cycle) < 1) {
    throw new Error("The reference movement phase is too short or too small to compare reliably.");
  }
  return cycle;
}

export async function analyzeReference(video, exercise, range, models, onProgress = () => {}) {
  if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA || !Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error("Wait for the reference video to finish loading before analysis.");
  }
  const needsHands = usesHandLandmarks(exercise);
  const needsPose = !needsHands || exercise === "Wrist Flexion and Extension";
  if (needsHands ? !models.handLandmarker : !models.landmarker) {
    throw new Error(needsHands ? "Hand landmark model is unavailable." : "Body-pose model is unavailable.");
  }
  if (needsPose && !models.landmarker) throw new Error("Body-pose model is unavailable for this exercise view.");
  const wasPlaying = !video.paused;
  const initialTime = video.currentTime;
  const sampleCount = Math.min(40, Math.max(12, Math.ceil(video.duration * 2)));
  const trace = [];
  let timestamp = performance.now();
  video.pause();
  try {
    for (let index = 0; index < sampleCount; index += 1) {
      await seekTo(video, video.duration * (index + 0.5) / sampleCount);
      timestamp += 34;
      let pose = null;
      let hands = [];
      let handConfidence = [];
      let handWorldLandmarks = [];
      if (needsHands) {
        const detected = models.handLandmarker.detectForVideo(video, timestamp);
        hands = detected.landmarks || [];
        handWorldLandmarks = detected.worldLandmarks || [];
        handConfidence = (detected.handedness || []).map(items => items?.[0]?.score ?? 0.8);
      }
      if (needsPose) {
        const detected = models.landmarker.detectForVideo(video, timestamp);
        pose = detected.landmarks?.[0] || null;
      }
      const measurement = measureExercise(exercise, { pose, hands, handConfidence, handWorldLandmarks });
      if (measurement) trace.push(measurement.value);
      onProgress(index + 1, sampleCount, trace.length);
    }
  } finally {
    try { await seekTo(video, Math.min(initialTime, Math.max(0, video.duration - 0.05))); } catch (_) { /* Preserve the player if its position cannot be restored. */ }
    if (wasPlaying) void video.play().catch(() => {});
  }
  return extractReferenceCycle(trace, range, getExerciseRule(exercise)?.unit || "units");
}
