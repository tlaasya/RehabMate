import test from "node:test";
import assert from "node:assert/strict";
import {
  createExerciseMonitor,
  getExerciseRule,
  measureExercise,
  phaseDistance,
  validateTherapistSettings
} from "../exercise-monitor.js";
import { extractReferenceCycle } from "../reference.js";
import { createFeedback } from "../feedback.js";

const validSettings = {
  min: 0,
  max: 100,
  tolerance: 10,
  targetReps: 8,
  targetSets: 3
};

test("accepts finite therapist settings and preserves targets", () => {
  const result = validateTherapistSettings("Seated Knee Extension", validSettings);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { ...validSettings });
});

test("rejects missing, reversed, and overly tolerant movement ranges", () => {
  assert.equal(validateTherapistSettings("Seated Knee Extension", {}).valid, false);
  assert.equal(validateTherapistSettings("Seated Knee Extension", { ...validSettings, max: 0 }).valid, false);
  assert.equal(validateTherapistSettings("Seated Knee Extension", { ...validSettings, tolerance: 50 }).valid, false);
});

test("rejects invalid repetition and set targets and unsupported movements", () => {
  assert.equal(validateTherapistSettings("Seated Knee Extension", { ...validSettings, targetReps: 0 }).valid, false);
  assert.equal(validateTherapistSettings("Seated Knee Extension", { ...validSettings, targetSets: 1.5 }).valid, false);
  assert.equal(validateTherapistSettings("Hand Movement", validSettings).valid, false);
});

test("allows manual targets without enabling camera rules for unsupported exercises", () => {
  const result = validateTherapistSettings("Hand Movement", { targetReps: 5, targetSets: 2 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { targetReps: 5, targetSets: 2 });
  assert.equal(createExerciseMonitor({ exercise: "Hand Movement", range: result.value }).update(null).status, "Tracking unavailable");
});

test("exercises have independent rules and unavailable views stay unsupported", () => {
  assert.ok(getExerciseRule("Shoulder Flexion"));
  assert.ok(getExerciseRule("Finger Flexion and Extension"));
  assert.equal(getExerciseRule("Hand Movement"), null);
  assert.equal(measureExercise("Hand Movement", { hands: [] }), null);
});

test("counts only one complete start-target-return cycle", () => {
  const monitor = createExerciseMonitor({ exercise: "Seated Knee Extension", range: validSettings });
  let now = 0;
  let result;
  for (let index = 0; index < 8; index += 1) result = monitor.update({ value: 0, confidence: 0.95 }, now += 100);
  assert.equal(result.reps, 0);
  for (let index = 0; index < 16; index += 1) result = monitor.update({ value: 100, confidence: 0.95 }, now += 100);
  assert.equal(result.reps, 0);
  for (let index = 0; index < 24; index += 1) result = monitor.update({ value: 0, confidence: 0.95 }, now += 100);
  assert.equal(result.reps, 1);
});

test("an incomplete attempt never increments repetitions", () => {
  const monitor = createExerciseMonitor({ exercise: "Seated Knee Extension", range: validSettings });
  let now = 0;
  let result;
  for (let index = 0; index < 8; index += 1) result = monitor.update({ value: 0, confidence: 0.95 }, now += 100);
  for (let index = 0; index < 14; index += 1) result = monitor.update({ value: 50, confidence: 0.95 }, now += 100);
  for (let index = 0; index < 14; index += 1) result = monitor.update({ value: 0, confidence: 0.95 }, now += 100);
  assert.equal(result.reps, 0);
});

test("missing landmarks do not count or add a movement error", () => {
  const monitor = createExerciseMonitor({ exercise: "Seated Knee Extension", range: validSettings });
  const result = monitor.update(null, 1000);
  assert.equal(result.status, "Tracking unavailable");
  assert.equal(result.reps, 0);
  assert.equal(result.errors, 0);
  const lowConfidence = monitor.update({ value: 80, confidence: 0.2 }, 1200);
  assert.equal(lowConfidence.status, "Tracking unavailable");
  assert.equal(lowConfidence.reps, 0);
  assert.equal(lowConfidence.errors, 0);
  const confidenceMissing = monitor.update({ value: 80 }, 1400);
  assert.equal(confidenceMissing.status, "Tracking unavailable");
  assert.equal(confidenceMissing.reps, 0);
  assert.equal(confidenceMissing.errors, 0);
});

test("reference comparison accepts one complete cycle and rejects incomplete data", () => {
  const cycle = extractReferenceCycle([0, 5, 20, 55, 85, 100, 80, 40, 5, 0], validSettings);
  assert.deepEqual(cycle, [0, 5, 20, 55, 85, 100, 80, 40, 5]);
  assert.throws(() => extractReferenceCycle([0, 25, 50, 25, 0], validSettings), /Too few|complete/);
  assert.equal(phaseDistance([0, 25, 50, 25, 0], [10, 20, 30, 20, 10]), 0);
});

test("feedback cooldown suppresses repeated warning events", () => {
  const feedback = createFeedback({ isMuted: () => true, voiceEnabled: () => false, cooldownMs: 1000 });
  assert.equal(feedback.warn("same warning", 10000), true);
  assert.equal(feedback.warn("same warning", 10500), false);
  assert.equal(feedback.warn("same warning", 11000), true);
});

test("unsupported speech reports a visual-only fallback", async () => {
  const previousWindow = globalThis.window;
  const messages = [];
  try {
    globalThis.window = {};
    const feedback = createFeedback({ isMuted: () => true, voiceEnabled: () => true, onStatus: message => messages.push(message) });
    feedback.warn("Move gently", 10000);
    assert.match(messages.at(-1), /not supported/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
