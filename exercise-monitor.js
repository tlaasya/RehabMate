const BODY_RULES = {
  "Shoulder Flexion": { landmarks: "pose", view: "side", unit: "deg", label: "Shoulder flexion angle", measure: p => sideArmAngle(p), prompt: "Raise your arm toward the therapist-configured target only as comfortable." },
  "Shoulder Abduction": { landmarks: "pose", view: "front", unit: "deg", label: "Shoulder abduction angle", measure: p => sideArmAngle(p), prompt: "Move your arm outward toward the therapist-configured target only as comfortable." },
  "Elbow Flexion": { landmarks: "pose", view: "side", unit: "deg", label: "Elbow flexion angle", measure: p => elbowFlexion(p), prompt: "Bend your elbow gently toward the therapist-configured target." },
  "Shoulder Shrugs": { landmarks: "pose", view: "front", unit: "%", label: "Shoulder-to-ear distance relative to torso", measure: p => shoulderShrug(p), prompt: "Raise your shoulders gently toward the therapist-configured target." },
  "Shoulder Blade Squeeze": { landmarks: "pose", view: "front", unit: "%", label: "Shoulder spacing relative to hip width", measure: p => shoulderSqueeze(p), prompt: "Gently draw your shoulder blades closer as instructed." },
  "Seated Knee Extension": { landmarks: "pose", view: "side", unit: "deg", label: "Knee angle", measure: p => jointAngle(p, 23, 25, 27), prompt: "Please straighten your knee a little more, within your prescribed range." },
  "Seated Marching": { landmarks: "pose", view: "front", unit: "%", label: "Knee lift relative to torso", measure: p => seatedMarch(p), prompt: "Lift your knee gently toward the therapist-configured target." },
  "Ankle Dorsiflexion": { landmarks: "pose", view: "side", unit: "deg", label: "Ankle angle estimate", measure: p => ankleAngle(p), prompt: "Lift the front of your foot upward gently, within your prescribed range." },
  "Straight Leg Raise": { landmarks: "pose", view: "side", unit: "deg", label: "Hip flexion estimate", measure: p => invert(jointAngle(p, 11, 23, 25)), prompt: "Move your leg toward the therapist-configured target only if included in your care plan." },
  "Seated Hip Abduction": { landmarks: "pose", view: "front", unit: "%", label: "Knee displacement relative to torso", measure: p => hipAbduction(p), prompt: "Move your knee outward gently toward the therapist-configured target." },
  "Seated Arm Movement": { landmarks: "pose", view: "side", unit: "deg", label: "Shoulder flexion angle", measure: p => sideArmAngle(p), prompt: "Raise your arm gently toward the therapist-configured target." }
};

const HAND_RULES = {
  "Hand Opening and Closing": { unit: "%", label: "Finger closure relative to palm", view: "front", prompt: "Open and close your fingers slowly within your prescribed range." },
  "Finger Flexion and Extension": { unit: "deg", label: "Finger joint angle", view: "front", prompt: "Bend or straighten your fingers gently toward the therapist-configured target." },
  "Wrist Flexion and Extension": { unit: "deg", label: "Wrist angle estimate", view: "side", prompt: "Move your wrist gently toward the therapist-configured target." },
  "Forearm Rotation": { unit: "deg", label: "Palm orientation estimate", view: "front", prompt: "Please rotate your forearm gently within your prescribed range." },
  "Finger-to-Thumb Touch": { unit: "%", label: "Thumb-to-finger proximity", view: "front", prompt: "Touch your thumb toward a fingertip slowly, without forcing the movement." }
};

const HAND_EXERCISES = new Set([
  ...Object.keys(HAND_RULES), "Wrist Flexion and Extension", "Forearm Rotation", "Hand Movement"
]);
const MIN_CONFIDENCE = 0.55;
const SMOOTHING = 0.3;
const ERROR_PERSISTENCE_MS = 750;
const PROGRESS_PLATEAU_MS = 1400;

function point(points, index) {
  const value = points?.[index];
  const confidence = value?.visibility ?? value?.presence ?? 1;
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) && confidence >= MIN_CONFIDENCE
    ? { ...value, confidence }
    : null;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angle(a, b, c) {
  if (![a, b, c].every(Boolean)) return null;
  const u = { x: a.x - b.x, y: a.y - b.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  if (!denominator) return null;
  return Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / denominator))) * 180 / Math.PI;
}

function jointAngle(points, a, b, c) {
  const first = point(points, a);
  const joint = point(points, b);
  const last = point(points, c);
  return first && joint && last ? { value: angle(first, joint, last), confidence: Math.min(first.confidence, joint.confidence, last.confidence) } : null;
}

function invert(measurement) {
  return measurement ? { ...measurement, value: 180 - measurement.value } : null;
}

function sideArmAngle(points) {
  const candidates = [[11, 15], [12, 16]].map(([shoulderId, wristId]) => {
    const shoulder = point(points, shoulderId);
    const wrist = point(points, wristId);
    return shoulder && wrist ? { value: Math.atan2(Math.abs(wrist.x - shoulder.x), Math.abs(wrist.y - shoulder.y)) * 180 / Math.PI, confidence: Math.min(shoulder.confidence, wrist.confidence) } : null;
  }).filter(Boolean);
  return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
}

function elbowFlexion(points) {
  const candidates = [[11, 13, 15], [12, 14, 16]].map(([a, b, c]) => jointAngle(points, a, b, c))
    .filter(Boolean).map(item => ({ ...item, value: 180 - item.value }));
  return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
}

function shoulderShrug(points) {
  const candidates = [[11, 23, 7], [12, 24, 8]].map(([shoulderId, hipId, earId]) => {
    const shoulder = point(points, shoulderId);
    const hip = point(points, hipId);
    const ear = point(points, earId);
    const torso = shoulder && hip ? dist(shoulder, hip) : 0;
    return shoulder && hip && ear && torso > 0.05
      ? { value: 100 * (1 - dist(shoulder, ear) / torso), confidence: Math.min(shoulder.confidence, hip.confidence, ear.confidence) }
      : null;
  }).filter(Boolean);
  return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
}

function shoulderSqueeze(points) {
  const leftShoulder = point(points, 11);
  const rightShoulder = point(points, 12);
  const leftHip = point(points, 23);
  const rightHip = point(points, 24);
  if (![leftShoulder, rightShoulder, leftHip, rightHip].every(Boolean)) return null;
  const hipWidth = dist(leftHip, rightHip);
  return hipWidth > 0.03
    ? { value: 100 * (1 - dist(leftShoulder, rightShoulder) / hipWidth), confidence: Math.min(leftShoulder.confidence, rightShoulder.confidence, leftHip.confidence, rightHip.confidence) }
    : null;
}

function seatedMarch(points) {
  const candidates = [[11, 23, 25], [12, 24, 26]].map(([shoulderId, hipId, kneeId]) => {
    const shoulder = point(points, shoulderId);
    const hip = point(points, hipId);
    const knee = point(points, kneeId);
    const torso = shoulder && hip ? dist(shoulder, hip) : 0;
    return shoulder && hip && knee && torso > 0.05
      ? { value: 100 * (hip.y - knee.y) / torso, confidence: Math.min(shoulder.confidence, hip.confidence, knee.confidence) }
      : null;
  }).filter(Boolean);
  return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
}

function ankleAngle(points) {
  const candidates = [[25, 27, 31], [26, 28, 32]].map(([kneeId, ankleId, toeId]) => {
    const knee = point(points, kneeId);
    const ankle = point(points, ankleId);
    const toe = point(points, toeId);
    return knee && ankle && toe ? { value: 180 - angle(knee, ankle, toe), confidence: Math.min(knee.confidence, ankle.confidence, toe.confidence) } : null;
  }).filter(Boolean);
  return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
}

function hipAbduction(points) {
  const candidates = [[11, 23, 25], [12, 24, 26]].map(([shoulderId, hipId, kneeId]) => {
    const shoulder = point(points, shoulderId);
    const hip = point(points, hipId);
    const knee = point(points, kneeId);
    const torso = shoulder && hip ? dist(shoulder, hip) : 0;
    return shoulder && hip && knee && torso > 0.05
      ? { value: 100 * Math.abs(knee.x - hip.x) / torso, confidence: Math.min(shoulder.confidence, hip.confidence, knee.confidence) }
      : null;
  }).filter(Boolean);
  return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
}

function handMeasure(exercise, hands, scores = [], pose = null, worldHands = []) {
  const hand = hands?.[0];
  if (!hand || hand.length < 21 || hand.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const confidence = Number(scores[0]) || 0.8;
  if (confidence < MIN_CONFIDENCE) return null;
  const palm = dist(hand[0], hand[9]);
  if (palm < 0.02) return null;
  if (exercise === "Forearm Rotation") {
    const world = worldHands?.[0];
    if (!world || world.length < 18 || world.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) return null;
    const wrist = world[0];
    const index = world[5];
    const pinky = world[17];
    const a = { x: index.x - wrist.x, y: index.y - wrist.y, z: index.z - wrist.z };
    const b = { x: pinky.x - wrist.x, y: pinky.y - wrist.y, z: pinky.z - wrist.z };
    const normal = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
    const magnitude = Math.hypot(normal.x, normal.y, normal.z);
    return magnitude > 1e-6
      ? { value: Math.atan2(Math.hypot(normal.x, normal.y), Math.abs(normal.z)) * 180 / Math.PI, confidence }
      : null;
  }
  if (exercise === "Wrist Flexion and Extension") {
    const candidates = [[13, 15], [14, 16]].map(([elbowId, wristId]) => {
      const elbow = point(pose, elbowId);
      const wrist = point(pose, wristId);
      if (!elbow || !wrist) return null;
      const angleValue = angle(elbow, wrist, hand[9]);
      return Number.isFinite(angleValue)
        ? { value: 180 - angleValue, confidence: Math.min(elbow.confidence, wrist.confidence, confidence) }
        : null;
    }).filter(Boolean);
    return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
  }
  if (exercise === "Hand Opening and Closing") {
    const tips = [4, 8, 12, 16, 20];
    const roots = [2, 5, 9, 13, 17];
    const openness = tips.reduce((sum, tip, i) => sum + dist(hand[tip], hand[roots[i]]), 0) / tips.length;
    return { value: 100 * Math.max(0, Math.min(1, 1 - openness / (2 * palm))), confidence };
  }
  if (exercise === "Finger Flexion and Extension") {
    const angles = [[5, 6, 7], [9, 10, 11], [13, 14, 15], [17, 18, 19]].map(indices => angle(hand[indices[0]], hand[indices[1]], hand[indices[2]]));
    return angles.every(Number.isFinite) ? { value: 180 - angles.reduce((sum, item) => sum + item, 0) / angles.length, confidence } : null;
  }
  if (exercise === "Finger-to-Thumb Touch") {
    const nearest = Math.min(...[8, 12, 16, 20].map(tip => dist(hand[4], hand[tip])));
    return { value: 100 * Math.max(0, Math.min(1, 1 - nearest / (1.5 * palm))), confidence };
  }
  return null;
}

export function getExerciseRule(exercise) {
  return BODY_RULES[exercise] || HAND_RULES[exercise] || null;
}

export function validateTherapistSettings(exercise, settings) {
  const rule = getExerciseRule(exercise);
  const hasRange = [settings?.min, settings?.max, settings?.tolerance].some(value => String(value ?? "").trim() !== "");
  const targetReps = String(settings.targetReps ?? "").trim() ? Number(settings.targetReps) : null;
  const targetSets = String(settings.targetSets ?? "").trim() ? Number(settings.targetSets) : null;
  if (!rule && hasRange) return { valid: false, message: "This exercise has no reliable movement rule. Range classification remains unavailable; clear range values and save targets only." };
  if (targetReps !== null && (!Number.isSafeInteger(targetReps) || targetReps < 1)) {
    return { valid: false, message: "Target repetitions must be a positive whole number or left blank." };
  }
  if (targetSets !== null && (!Number.isSafeInteger(targetSets) || targetSets < 1)) {
    return { valid: false, message: "Target sets must be a positive whole number or left blank." };
  }
  if (!rule) return { valid: true, value: { targetReps, targetSets } };
  if (![settings?.min, settings?.max, settings?.tolerance].every(value => String(value ?? "").trim() !== "")) {
    return { valid: false, message: "Enter a start value, target value, and tolerance." };
  }
  const min = Number(settings.min);
  const max = Number(settings.max);
  const tolerance = Number(settings.tolerance);
  if (![min, max, tolerance].every(Number.isFinite) || min >= max || tolerance < 0 || max - min <= tolerance * 2) {
    return { valid: false, message: "Use a finite start, a larger target, and a tolerance smaller than half the range." };
  }
  return { valid: true, value: { min, max, tolerance, targetReps, targetSets } };
}

export function usesHandLandmarks(exercise) {
  return HAND_EXERCISES.has(exercise);
}

export function measureExercise(exercise, { pose = null, hands = [], handConfidence = [], handWorldLandmarks = [] } = {}) {
  const rule = getExerciseRule(exercise);
  if (!rule) return null;
  const measured = BODY_RULES[exercise] ? rule.measure(pose) : handMeasure(exercise, hands, handConfidence, pose, handWorldLandmarks);
  return measured && Number.isFinite(measured.value) && measured.confidence >= MIN_CONFIDENCE
    ? { ...measured, label: rule.label, unit: rule.unit }
    : null;
}

export function normalizePhase(values) {
  if (!Array.isArray(values) || values.length < 3 || values.some(v => !Number.isFinite(v))) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  return high - low < 1e-6 ? null : values.map(v => (v - low) / (high - low));
}

export function phaseDistance(first, second) {
  const a = normalizePhase(first);
  const b = normalizePhase(second);
  if (!a || !b) return null;
  let previous = new Array(b.length + 1).fill(Infinity);
  previous[0] = 0;
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array(b.length + 1).fill(Infinity);
    for (let j = 1; j <= b.length; j += 1) row[j] = Math.abs(a[i - 1] - b[j - 1]) + Math.min(previous[j], row[j - 1], previous[j - 1]);
    previous = row;
  }
  return previous[b.length] / (a.length + b.length);
}

export function createExerciseMonitor({ exercise, range, reference = null }) {
  const rule = getExerciseRule(exercise);
  const min = Number(range?.min);
  const max = Number(range?.max);
  const tolerance = Number(range?.tolerance);
  const configured = Boolean(rule && Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(tolerance) && max > min && tolerance >= 0 && max - min > tolerance * 2);
  let value = null;
  let phase = "awaiting-start";
  let reps = 0;
  let errors = 0;
  let candidate = "";
  let candidateSince = 0;
  let warned = "";
  let lowReturnUntil = 0;
  let lastProgressAt = 0;
  let trace = [];
  let peak = -Infinity;

  function output(status, message, extra = {}) {
    return { status, message, reps, errors, phase, value, ...extra };
  }

  function update(measurement, now = performance.now()) {
    if (!rule) return output("Tracking unavailable", "This view does not support a reliable exercise-specific movement estimate.");
    if (!configured) return output("Tracking unavailable", `A therapist must configure ${rule.label.toLowerCase()} start, target, and tolerance values before movement can be classified.`);
    if (!measurement || !Number.isFinite(measurement.value) || !Number.isFinite(measurement.confidence) || measurement.confidence < MIN_CONFIDENCE) {
      value = null; phase = "tracking-unavailable"; candidate = ""; candidateSince = 0; warned = ""; trace = []; peak = -Infinity; lastProgressAt = 0;
      return output("Tracking unavailable", "Required landmarks are missing or uncertain. Adjust the camera; this is not counted as an error.");
    }

    value = value === null ? measurement.value : value + SMOOTHING * (measurement.value - value);
    const start = min + tolerance;
    const target = max - tolerance;
    let issue = "";
    let completed = false;
    let newError = false;
    let comparison = null;

    if (phase === "ready" && now < lowReturnUntil) {
      issue = rule.prompt;
    } else if (phase === "awaiting-start" || phase === "tracking-unavailable") {
      if (value <= start) phase = "ready";
    } else if (phase === "ready" && value > start + tolerance * 0.25) {
      phase = "outbound"; trace = [value]; peak = value; lastProgressAt = now;
    } else if (phase === "outbound") {
      trace.push(value);
      const previousPeak = peak;
      peak = Math.max(peak, value);
      if (peak - previousPeak >= Math.max(0.5, tolerance * 0.08)) lastProgressAt = now;
      if (value >= target) phase = "target-reached";
      else if (value <= start) { phase = "ready"; trace = []; peak = -Infinity; lastProgressAt = 0; lowReturnUntil = now + ERROR_PERSISTENCE_MS + 120; issue = rule.prompt; }
      else if (peak - value > Math.max(2, tolerance * 0.5)) issue = rule.prompt;
      else if (now - lastProgressAt >= PROGRESS_PLATEAU_MS) issue = rule.prompt;
    } else if (phase === "target-reached" || phase === "returning") {
      trace.push(value);
      if (value <= start) {
        reps += 1; completed = true; phase = "ready"; lowReturnUntil = 0;
        if (reference?.length) {
          comparison = phaseDistance(trace, reference);
          if (Number.isFinite(comparison) && comparison > 0.22) {
            issue = "This completed movement phase differs from the approved reference pattern.";
            errors += 1; newError = true;
          }
        }
        trace = []; peak = -Infinity; lastProgressAt = 0;
      } else if (value < target) phase = "returning";
    }

    const inRange = value >= min - tolerance && value <= max + tolerance;
    if (!inRange && !["awaiting-start", "tracking-unavailable"].includes(phase) && !issue) {
      issue = "Movement is outside the therapist-configured range. Pause and check your care plan.";
    }
    if (issue) {
      if (candidate !== issue) { candidate = issue; candidateSince = now; warned = ""; }
      if (!warned && now - candidateSince >= ERROR_PERSISTENCE_MS) { errors += 1; warned = issue; newError = true; }
    } else if (!completed) { candidate = ""; candidateSince = 0; warned = ""; }

    const persistent = warned || (completed ? issue : "");
    const awaitingStart = ["awaiting-start", "tracking-unavailable"].includes(phase);
    const status = persistent ? "Incorrect movement" : awaitingStart ? "Tracking unavailable" : "Correct movement";
    const message = persistent || (awaitingStart
      ? "Move to the therapist-configured start position to begin."
      : phase === "target-reached" || phase === "returning"
        ? "Target phase reached. Return with control to complete the repetition."
        : "Landmarks are stable and the movement is within the configured range.");
    return output(status, message, { newError, completed, comparison });
  }

  return {
    update,
    getReps: () => reps,
    getErrors: () => errors,
    reset() { value = null; phase = "awaiting-start"; reps = 0; errors = 0; candidate = ""; candidateSince = 0; warned = ""; lowReturnUntil = 0; trace = []; peak = -Infinity; lastProgressAt = 0; }
  };
}
