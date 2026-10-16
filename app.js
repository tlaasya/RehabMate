import { startCamera, stopCamera, isActive, waitForVideoReady } from "./camera.js";
import { createPoseLandmarker, drawPose, closePoseLandmarkers } from "./pose.js?monitoring-cleanup";
import { angleAtShoulder } from "./exercise.js";
import { createExerciseMonitor, getExerciseRule, measureExercise, usesHandLandmarks, validateTherapistSettings } from "./exercise-monitor.js?monitoring-v1";
import { createFeedback } from "./feedback.js?feedback-v1";
import { analyzeReference } from "./reference.js?reference-cycles-v1";
import { getSessions, saveSession } from "./storage.js";
import { renderHistory, setupHistory } from "./history.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const totalSessionsEl = $("#totalSessions");
const totalRepsEl = $("#totalReps");
const latestSessionEl = $("#latestSession");
const currentExerciseEl = $("#currentExercise");
const currentExerciseInstructionsEl = $("#currentExerciseInstructions");
const trackingModeEl = $("#trackingMode");
const timerEl = $("#timer");
const repsInput = $("#reps");
const completedSetsInput = $("#completedSets");
const setProgress = $("#setProgress");
const setProgressText = $("#setProgressText");
const statusEl = $("#sessionStatus");
const messageEl = $("#message");
const startBtn = $("#startBtn");
const pauseBtn = $("#pauseBtn");
const resumeBtn = $("#resumeBtn");
const finishBtn = $("#finishBtn");
const startCameraBtn = $("#startCameraBtn");
const stopCameraBtn = $("#stopCameraBtn");
const safetyConfirm = $("#safetyConfirm");
const video = $("#exercise-video");
const canvas = $("#pose-overlay");
const poseStatus = $("#poseStatus");
const formFeedback = $("#formFeedback");
const cameraError = $("#camera-error");
const voiceAlerts = $("#voiceAlerts");
const feedbackStatus = $("#feedbackStatus");
const muteFeedbackBtn = $("#muteFeedback");
const movementStatusEl = $("#movementStatus");
const movementStateEl = $("#movementState");
const correctionMessageEl = $("#correctionMessage");
const repProgress = $("#repProgress");
const repProgressText = $("#repProgressText");
const referenceFileInput = $("#referenceFile");
const referenceApproved = $("#referenceApproved");
const analyzeReferenceBtn = $("#analyzeReference");
const referenceStatus = $("#referenceStatus");
const rangeMinInput = $("#rangeMin");
const rangeMaxInput = $("#rangeMax");
const rangeToleranceInput = $("#rangeTolerance");
const targetRepsInput = $("#targetReps");
const targetSetsInput = $("#targetSets");
const rangeUnitEl = $("#rangeUnit");
const therapistSettingsHint = $("#therapistSettingsHint");
const therapistSettingsMessage = $("#therapistSettingsMessage");
const sessionSummaryEl = $("#sessionSummary");
const canvasContext = canvas.getContext("2d");

let selectedExercise = "";
let sessionState = "ready";
let elapsedBeforeRun = 0;
let startedAt = 0;
let timerInterval = null;
let animationFrame = null;
let landmarker = null;
let handLandmarker = null;
let handModelError = null;
let vision = null;
let exerciseMonitor = null;
let monitorResult = null;
let lastPoseTimestamp = -1;
let cameraBusy = false;
let referenceBusy = false;
let soundMuted = false;
let settingsDirty = false;
let missingTrackingSince = 0;
let missingTrackingPrompted = false;
let formIssue = "";
let leanFrames = 0;
let highArmFrames = 0;
const referenceMedia = new Map();
const referenceTraces = new Map();
const settingsKey = "rehabmate.therapist-settings.v1";
const exerciseSettings = loadExerciseSettings();
const feedback = createFeedback({
  isMuted: () => soundMuted,
  voiceEnabled: () => Boolean(voiceAlerts?.checked),
  onStatus: message => { if (feedbackStatus) feedbackStatus.textContent = message; }
});

// Demo-only thresholds. Adjust only with a physiotherapist's guidance.
const FORM_CUE_SETTINGS = {
  maxTorsoLeanDegrees: 20,
  maxArmAngleDegrees: 115,
  consecutiveFramesRequired: 3,
  soundCooldownMs: 1800
};

const EXERCISE_VIDEOS = {
  "Shoulder Flexion": "videos/shoulder-felxion.mp4.mp4",
  "Shoulder Abduction": "videos/shoulder-abduction.mp4.mp4",
  "Elbow Flexion": "videos/eldow-flexion.mp4.mp4",
  "Shoulder Shrugs": "videos/shoulder-shurugs.mp4.mp4",
  "Shoulder Blade Squeeze": "videos/shoulder-blade.mp4.mp4",
  "Hand Opening and Closing": "videos/hand-opening-and-closing.mp4.mp4",
  "Finger Flexion and Extension": "videos/finger-flexion-and-extension.mp4.mp4",
  "Wrist Flexion and Extension": "videos/wrist-flexion-and-extension.mp4.mp4",
  "Forearm Rotation": "videos/forearm-rotation.mp4.mp4",
  "Finger-to-Thumb Touch": "videos/finger-to-thumb-touch.mp4.mp4",
  "Seated Knee Extension": "videos/seated-knee-extension.mp4.mp4",
  "Seated Marching": "videos/seated-marching.mp4.mp4",
  "Ankle Dorsiflexion": "videos/ankle-dorsiflexion.mp4.mp4",
  "Straight Leg Raise": "videos/straight-leg-raise.mp4.mp4",
  "Seated Hip Abduction": "videos/seated-flip-abduction.mp4.mp4",
  "Seated Arm Movement": "videos/seated-arm-movement.mp4",
  "Hand Movement": "videos/hand-opening-and-closing.mp4.mp4"
};

const LEGACY_INSTRUCTIONS = {
  "Seated Arm Movement": "Practice the arm movement included in your care plan while seated and supported.",
  "Hand Movement": "Practice the hand movement assigned in your plan, at your prescribed pace."
};

const REFERENCE_REVIEW_NOTES = {
  "Shoulder Flexion": "Range review: the clip's measured feature was 11.0–24.9°. A complete cycle was extracted using diagnostic-only bounds of 11–25° (tolerance 2°); these are not clinical recommendations. Enter the treating therapist's range and analyze again before comparison.",
  "Seated Hip Abduction": "Replacement review required: the supplied clip measured 7.5–14.0% knee displacement but no target phase followed the start. The knees are not reliably visible. Provide a therapist-approved front-view clip showing both hips and knees through a full outward-and-return cycle."
};

const EXERCISE_CATEGORIES = {
  arms: { title: "Arms", exercises: [
    { name: "Shoulder Flexion", instructions: "Sit or stand supported. Raise your arm in front only through the comfortable range prescribed for you, then lower it with control." },
    { name: "Shoulder Abduction", instructions: "Move your arm out to the side only through your prescribed comfortable range, then return slowly." },
    { name: "Elbow Flexion", instructions: "Keep your upper arm near your side. Bend your elbow to bring your hand toward your shoulder, then straighten it as instructed." },
    { name: "Shoulder Shrugs", instructions: "Raise your shoulders gently toward your ears, then relax them back down without forcing the movement." },
    { name: "Shoulder Blade Squeeze", instructions: "Sit tall and gently draw your shoulder blades toward each other, then release." }
  ] },
  hands: { title: "Hands", exercises: [
    { name: "Hand Opening and Closing", instructions: "Slowly open and close your hand comfortably. Do not force your fingers or grip." },
    { name: "Finger Flexion and Extension", instructions: "Bend and straighten your fingers gently, using the range and pace from your care plan." },
    { name: "Wrist Flexion and Extension", instructions: "With your forearm supported, gently bend your wrist forward and back within your prescribed range." },
    { name: "Forearm Rotation", instructions: "Keep your elbow near your side and slowly turn your palm up and down as instructed." },
    { name: "Finger-to-Thumb Touch", instructions: "Touch your thumb to each fingertip in turn, moving slowly and comfortably." }
  ] },
  legs: { title: "Legs", exercises: [
    { name: "Seated Knee Extension", instructions: "While seated with support, slowly straighten one knee and lower your foot with control." },
    { name: "Seated Marching", instructions: "While seated upright and supported, lift one knee at a time only as high as comfortable." },
    { name: "Ankle Dorsiflexion", instructions: "With your leg supported, gently draw your toes toward your shin and relax." },
    { name: "Straight Leg Raise", instructions: "Use only if included in your care plan. Raise your supported leg through the prescribed comfortable range." },
    { name: "Seated Hip Abduction", instructions: "While seated and supported, move one knee gently outward and return it to center." }
  ] }
};

function loadExerciseSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem(settingsKey) || "{}");
    return settings && typeof settings === "object" ? settings : {};
  } catch (error) {
    console.warn("Could not load therapist settings:", error);
    return {};
  }
}

function currentSettings() {
  return exerciseSettings[selectedExercise] || {};
}

function trackingDescription(exerciseName) {
  const rule = getExerciseRule(exerciseName);
  if (!rule) return usesHandLandmarks(exerciseName)
    ? "Hand landmarks may be shown, but this view cannot reliably assess this movement."
    : "No reliable exercise-specific tracking rule is configured for this movement.";
  return `${rule.label} (${rule.unit}); therapist-approved range required.`;
}

function exerciseInstructions(exerciseName) {
  const catalogExercise = Object.values(EXERCISE_CATEGORIES)
    .flatMap(category => category.exercises)
    .find(exercise => exercise.name === exerciseName);
  return catalogExercise?.instructions || LEGACY_INSTRUCTIONS[exerciseName] || "Follow the therapist-approved instructions for this exercise.";
}

function renderExerciseCategory(categoryKey) {
  const category = EXERCISE_CATEGORIES[categoryKey];
  if (!category) return;
  $$('[data-category]').forEach(button => button.setAttribute("aria-pressed", String(button.dataset.category === categoryKey)));
  $("#exerciseListHeading").textContent = `${category.title} exercises`;
  $("#exerciseListSection").hidden = false;
  $("#exerciseList").innerHTML = category.exercises.map(exercise => `
    <article class="exercise-card">
      <div class="exercise-card-top"><span class="exercise-icon" aria-hidden="true">${categoryKey === "arms" ? "💪" : categoryKey === "hands" ? "✋" : "🦵"}</span><span class="exercise-category">${category.title}</span></div>
      <h3>${exercise.name}</h3>
      <p>${exercise.instructions}</p>
      <div class="demo-placeholder ${categoryKey === "hands" ? "demo-blue" : ""}"><span aria-hidden="true">▶</span><span>${EXERCISE_VIDEOS[exercise.name] ? "Demonstration available in session player." : "No reference video uploaded yet."}</span></div>
      <p class="exercise-tracking-note">${trackingDescription(exercise.name)}</p>
      <button class="button exercise-start" type="button" data-exercise="${exercise.name}">Select Exercise</button>
    </article>`).join("");
}

function updateRepProgress(repetitions = Number(repsInput.value) || 0) {
  const target = Number(currentSettings().targetReps);
  if (Number.isSafeInteger(target) && target > 0) {
    repProgress.max = target;
    repProgress.value = Math.min(repetitions, target);
    repProgressText.textContent = `${repetitions} of ${target} target repetitions`;
  } else {
    repProgress.max = 1;
    repProgress.value = 0;
    repProgressText.textContent = `${repetitions} repetitions · target not configured`;
  }
}

function updateSetProgress(sets = Number(completedSetsInput.value) || 0) {
  const target = Number(currentSettings().targetSets);
  if (Number.isSafeInteger(target) && target > 0) {
    setProgress.max = target;
    setProgress.value = Math.min(sets, target);
    setProgressText.textContent = `${sets} of ${target} target sets`;
  } else {
    setProgress.max = 1;
    setProgress.value = 0;
    setProgressText.textContent = `${sets} sets · target not configured`;
  }
}

function showMovementResult(result) {
  if (!result) return;
  if (movementStateEl.textContent !== result.status) movementStateEl.textContent = result.status;
  const state = result.status === "Correct movement" ? "correct" :
    result.status === "Incorrect movement" ? "incorrect" : "unavailable";
  if (movementStatusEl.dataset.state !== state) movementStatusEl.dataset.state = state;
  if (correctionMessageEl.textContent !== result.message) correctionMessageEl.textContent = result.message;
  if (result.status !== "Tracking unavailable" && Number.isSafeInteger(result.reps)) {
    repsInput.value = String(result.reps);
    updateRepProgress(result.reps);
  }
  setFormFeedback(result.message, result.status === "Incorrect movement" ? "warning" :
    result.status === "Correct movement" ? "good" : "info");
  if (result.newError) feedback.warn(result.message);
  const landmarksMissing = result.status === "Tracking unavailable" && result.message.startsWith("Required landmarks are missing");
  if (landmarksMissing && sessionState === "running") {
    if (!missingTrackingSince) missingTrackingSince = Date.now();
    if (!missingTrackingPrompted && Date.now() - missingTrackingSince >= 2000) {
      feedback.warn("Movement not detected. Please adjust your position.");
      missingTrackingPrompted = true;
    }
  } else {
    missingTrackingSince = 0;
    missingTrackingPrompted = false;
  }
}

function configureMonitor() {
  exerciseMonitor = createExerciseMonitor({
    exercise: selectedExercise,
    range: currentSettings(),
    reference: referenceTraces.get(selectedExercise) || null
  });
  monitorResult = exerciseMonitor.update(null);
  showMovementResult(monitorResult);
}

function loadSettingsIntoForm() {
  settingsDirty = false;
  therapistSettingsMessage.textContent = "";
  const rule = getExerciseRule(selectedExercise);
  const settings = currentSettings();
  rangeMinInput.value = settings.min ?? "";
  rangeMaxInput.value = settings.max ?? "";
  rangeToleranceInput.value = settings.tolerance ?? "";
  targetRepsInput.value = settings.targetReps ?? "";
  targetSetsInput.value = settings.targetSets ?? "";
  rangeUnitEl.textContent = rule?.unit || "Unavailable";
  therapistSettingsHint.textContent = rule
    ? `Configure ${rule.label.toLowerCase()} for a ${rule.view}-view camera position. Use limits supplied by the treating therapist; no default range is prescribed.`
    : "No reliable exercise-specific movement estimate is available for this exercise.";
  rangeMinInput.disabled = !rule;
  rangeMaxInput.disabled = !rule;
  rangeToleranceInput.disabled = !rule;
  updateRepProgress(0);
  updateSetProgress(0);
}

function updateReferenceControls() {
  const active = ["running", "paused"].includes(sessionState);
  analyzeReferenceBtn.disabled = !selectedExercise || !(referenceMedia.has(selectedExercise) || EXERCISE_VIDEOS[selectedExercise]) || !referenceApproved.checked || referenceBusy || active;
  referenceFileInput.disabled = active;
  referenceApproved.disabled = active;
}

function applyTherapistSettings() {
  if (["running", "paused"].includes(sessionState)) {
    therapistSettingsMessage.textContent = "Stop the active session before changing settings.";
    return;
  }
  const validation = validateTherapistSettings(selectedExercise, {
    min: rangeMinInput.value,
    max: rangeMaxInput.value,
    tolerance: rangeToleranceInput.value,
    targetReps: targetRepsInput.value,
    targetSets: targetSetsInput.value
  });
  if (!validation.valid) {
    therapistSettingsMessage.textContent = validation.message;
    return;
  }
  try {
    const nextSettings = { ...exerciseSettings, [selectedExercise]: validation.value };
    localStorage.setItem(settingsKey, JSON.stringify(nextSettings));
    exerciseSettings[selectedExercise] = validation.value;
    settingsDirty = false;
    configureMonitor();
    updateRepProgress(0);
    updateSetProgress(0);
    setState(sessionState);
    therapistSettingsMessage.textContent = "Applied in this browser. Confirm the limits with the treating therapist.";
  } catch (error) {
    therapistSettingsMessage.textContent = "Could not save settings in this browser.";
    console.error("Therapist settings could not be saved:", error);
  }
}

function resetTrackingSettings() {
  if (!selectedExercise || ["running", "paused"].includes(sessionState)) {
    therapistSettingsMessage.textContent = "Select an exercise and stop its session before resetting settings.";
    return;
  }
  try {
    const nextSettings = { ...exerciseSettings };
    delete nextSettings[selectedExercise];
    localStorage.setItem(settingsKey, JSON.stringify(nextSettings));
    delete exerciseSettings[selectedExercise];
    settingsDirty = false;
    loadSettingsIntoForm();
    configureMonitor();
    setState(sessionState);
    therapistSettingsMessage.textContent = "Settings reset for this exercise only.";
  } catch (error) {
    therapistSettingsMessage.textContent = "Could not reset settings in this browser.";
    console.error("Therapist settings could not be reset:", error);
  }
}


function setFormFeedback(message, level = "info") {
  if (!formFeedback) return;
  if (formFeedback.textContent !== message) formFeedback.textContent = message;
  if (formFeedback.dataset.level !== level) formFeedback.dataset.level = level;
}

function showFormIssue(issue) {
  if (issue && issue !== formIssue) feedback.warn(issue);
  formIssue = issue;
  if (issue) {
    setFormFeedback(issue, "warning");
  } else {
    setFormFeedback("No demo cue detected in the currently checked landmarks. This does not confirm correct form.", "good");
  }
}

function resetFormFeedback() {
  formIssue = "";
  leanFrames = 0;
  highArmFrames = 0;
  setFormFeedback("Form cues are active only for Seated Arm Movement in this demo. They do not replace a physiotherapist's instructions.", "info");
}

function evaluateSeatedArmForm(person) {
  // MediaPipe Pose landmark indices: left shoulder/wrist/hip = 11/15/23,
  // right shoulder/wrist/hip = 12/16/24. Pick the clearer visible side.
  const sides = [
    { shoulder: person[11], wrist: person[15], hip: person[23] },
    { shoulder: person[12], wrist: person[16], hip: person[24] }
  ];
  const visibleSides = sides.filter(side =>
    [side.shoulder, side.wrist, side.hip].every(point => point && (point.visibility ?? 1) >= 0.55)
  );
  if (!visibleSides.length) {
    leanFrames = 0;
    highArmFrames = 0;
    showFormIssue("");
    setFormFeedback("Keep one shoulder, wrist and hip clearly visible to the camera. The app cannot assess form while landmarks are unclear.", "info");
    return;
  }

  const side = visibleSides.sort((a, b) =>
    Math.min(b.shoulder.visibility ?? 1, b.wrist.visibility ?? 1, b.hip.visibility ?? 1) -
    Math.min(a.shoulder.visibility ?? 1, a.wrist.visibility ?? 1, a.hip.visibility ?? 1)
  )[0];
  const torsoAngle = Math.atan2(Math.abs(side.shoulder.x - side.hip.x), Math.abs(side.shoulder.y - side.hip.y)) * 180 / Math.PI;
  const armAngle = angleAtShoulder(side.shoulder, side.hip, side.wrist);

  leanFrames = torsoAngle > FORM_CUE_SETTINGS.maxTorsoLeanDegrees ? leanFrames + 1 : 0;
  highArmFrames = Number.isFinite(armAngle) && armAngle > FORM_CUE_SETTINGS.maxArmAngleDegrees ? highArmFrames + 1 : 0;

  if (leanFrames >= FORM_CUE_SETTINGS.consecutiveFramesRequired) {
    showFormIssue("Form cue: your torso appears to be leaning sideways. Pause and check your posture against your physiotherapist's instructions.");
  } else if (highArmFrames >= FORM_CUE_SETTINGS.consecutiveFramesRequired) {
    showFormIssue("Form cue: your arm appears to be raised beyond this demo's configured range. Move only within your prescribed comfortable range.");
  } else if (formIssue) {
    formIssue = "";
    setFormFeedback("The previous demo cue has cleared. This does not confirm the full exercise technique is correct.", "good");
  } else {
    setFormFeedback("Tracking visible. The app is checking simple demo cues only; it cannot verify the full exercise technique.", "info");
  }
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function getElapsedSeconds() {
  return sessionState === "running"
    ? elapsedBeforeRun + Math.floor((Date.now() - startedAt) / 1000)
    : elapsedBeforeRun;
}

function updateTimer() { timerEl.textContent = formatTime(getElapsedSeconds()); }
function setMessage(message) { messageEl.textContent = message; }

function setState(state, message) {
  sessionState = state;
  statusEl.textContent = state === "running" ? "In progress" :
    state === "paused" ? "Paused" : state === "finished" ? "Completed" :
    state === "selected" ? "Exercise selected" : "Ready";
  statusEl.dataset.state = state;
  startBtn.disabled = !selectedExercise || state !== "selected" || settingsDirty;
  pauseBtn.disabled = state !== "running";
  resumeBtn.disabled = state !== "paused";
  finishBtn.disabled = !["running", "paused"].includes(state);
  $("#saveTrackingSettings").disabled = !selectedExercise || ["running", "paused"].includes(state);
  $("#resetTrackingSettings").disabled = !selectedExercise || ["running", "paused"].includes(state);
  updateReferenceControls();
  if (message) setMessage(message);
}

function stopTimer() {
  if (timerInterval !== null) clearInterval(timerInterval);
  timerInterval = null;
}

function stopPoseLoop() {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
}

function resetTimer() {
  stopTimer(); elapsedBeforeRun = 0; startedAt = 0; timerEl.textContent = "00:00";
}

function startTimer() {
  startedAt = Date.now();
  stopTimer();
  timerInterval = setInterval(updateTimer, 250);
  updateTimer();
}

function updateDashboard() {
  const sessions = getSessions();
  totalSessionsEl.textContent = String(sessions.length);
  totalRepsEl.textContent = String(sessions.reduce((sum, item) => sum + (Number(item.reps) || 0), 0));
  latestSessionEl.textContent = sessions.length ? (sessions[0].exercise || "Practice session") : "No sessions yet";
}

function loadExerciseVideo(exerciseName) {
  const uploaded = referenceMedia.get(exerciseName);
  const source = EXERCISE_VIDEOS[exerciseName];
  const videoUrl = uploaded?.url || (source ? new URL(source, document.baseURI).href : "");
  const player = $("#exerciseDemo");
  const note = $("#exerciseVideoNote");
  if (!player || !note) return;

  player.pause();
  player.loop = true;
  player.playsInline = true;
  player.controls = true;
  player.onerror = null;
  player.onloadedmetadata = null;
  player.oncanplay = null;

  if (!videoUrl) {
    player.removeAttribute("src");
    player.load();
    note.textContent = "No demonstration video is configured for this exercise.";
    referenceStatus.textContent = "Upload an approved reference clip for this exercise to compare movement phases.";
    updateReferenceControls();
    return;
  }

  player.src = videoUrl;
  note.textContent = uploaded ? `Loading reference: ${uploaded.name}` : `Loading demonstration: ${source}`;
  referenceStatus.textContent = referenceTraces.has(exerciseName)
    ? `Reference phase sequence ready (${referenceTraces.get(exerciseName).length} samples).`
    : REFERENCE_REVIEW_NOTES[exerciseName] || "Confirm therapist approval before analyzing reference movement phases.";
  updateReferenceControls();

  player.onloadedmetadata = () => {
    const duration = Number.isFinite(player.duration) ? ` (${formatTime(player.duration)} long)` : "";
    note.textContent = `Video ready${duration}. Press Start to play the demonstration alongside your session, or use the video controls.`;
  };

  player.oncanplay = () => {
    if (note.textContent.startsWith("Loading demonstration:")) {
      note.textContent = "Video is ready. Press Start to play it alongside your session.";
    }
  };

  player.onerror = () => {
    const mediaError = player.error;
    const reason = mediaError?.code === 2 ? "network/file access error" :
      mediaError?.code === 3 ? "video decoding error" :
      mediaError?.code === 4 ? "unsupported format or missing file" : "unknown media error";
    note.textContent = `Could not load ${uploaded?.name || source} (${reason}). Choose a supported video file or confirm the file is available.`;
    referenceStatus.textContent = note.textContent;
    console.error("Exercise video failed to load:", videoUrl, mediaError);
  };
  player.load();
}

async function ensurePoseModels() {
  if (!landmarker && !handLandmarker) {
    poseStatus.textContent = "Loading body and hand landmark models; the first load needs internet access.";
    const model = await createPoseLandmarker();
    landmarker = model.landmarker;
    handLandmarker = model.handLandmarker;
    handModelError = model.handModelError;
    vision = model.vision;
  }
  return { landmarker, handLandmarker, handModelError, vision };
}

function releasePoseModels() {
  closePoseLandmarkers(landmarker, handLandmarker);
  landmarker = null;
  handLandmarker = null;
  handModelError = null;
  vision = null;
}

function handleReferenceFileChange() {
  const file = referenceFileInput.files?.[0];
  if (!selectedExercise || !file) return;
  if (["running", "paused"].includes(sessionState)) {
    referenceStatus.textContent = "Stop the current session before changing its reference video.";
    referenceFileInput.value = "";
    return;
  }
  const previous = referenceMedia.get(selectedExercise);
  if (previous?.url.startsWith("blob:")) URL.revokeObjectURL(previous.url);
  referenceMedia.set(selectedExercise, { url: URL.createObjectURL(file), name: file.name });
  referenceTraces.delete(selectedExercise);
  referenceApproved.checked = false;
  loadExerciseVideo(selectedExercise);
  referenceStatus.textContent = "Reference loaded locally. Confirm therapist approval before phase analysis.";
  configureMonitor();
  updateReferenceControls();
}

async function handleAnalyzeReference() {
  if (referenceBusy || !selectedExercise) return;
  if (!referenceApproved.checked) {
    referenceStatus.textContent = "Confirm therapist approval before analyzing this reference.";
    return;
  }
  if (["running", "paused"].includes(sessionState)) {
    referenceStatus.textContent = "Stop the active session before analyzing a reference.";
    return;
  }
  if (!getExerciseRule(selectedExercise)) {
    referenceStatus.textContent = "This exercise has no reliable camera rule for reference analysis.";
    return;
  }
  const range = currentSettings();
  if (![range.min, range.max, range.tolerance].every(value => Number.isFinite(Number(value))) || Number(range.min) >= Number(range.max)) {
    referenceStatus.textContent = "Apply therapist-approved start, target, and tolerance values before analyzing a reference cycle.";
    return;
  }
  const player = $("#exerciseDemo");
  if (!player || player.readyState < HTMLMediaElement.HAVE_METADATA) {
    referenceStatus.textContent = "Wait for the reference video to load before analysis.";
    return;
  }
  referenceBusy = true;
  updateReferenceControls();
  stopPoseLoop();
  try {
    const models = await ensurePoseModels();
    const trace = await analyzeReference(player, selectedExercise, range, models, (current, total, valid) => {
      referenceStatus.textContent = `Analyzing movement phases: ${current}/${total} samples, ${valid} reliable landmarks.`;
    });
    referenceTraces.set(selectedExercise, trace);
    configureMonitor();
    referenceStatus.textContent = `Reference phase sequence ready (${trace.length} reliable samples). It will be compared by movement phase, not clip time.`;
  } catch (error) {
    referenceStatus.textContent = error.message || "Reference analysis is unavailable for this video or camera view.";
    console.error("Reference analysis failed:", error);
  } finally {
    referenceBusy = false;
    if (!isActive()) {
      releasePoseModels();
      poseStatus.textContent = "Reference analysis finished. Camera is off; start it when you are ready for live tracking.";
    }
    lastPoseTimestamp = performance.now();
    updateReferenceControls();
    if (isActive() && selectedExercise) startPoseLoop();
  }
}

async function playDemoVideo() {
  const player = $("#exerciseDemo");
  const note = $("#exerciseVideoNote");
  if (!player || (!EXERCISE_VIDEOS[selectedExercise] && !referenceMedia.has(selectedExercise))) return;
  try {
    await player.play();
  } catch (error) {
    console.warn("Automatic demonstration playback was blocked:", error);
    if (note) note.textContent = "The demonstration is loaded. Press Play on the video if it did not start automatically.";
  }
}

function pauseDemoVideo(reset = false) {
  const player = $("#exerciseDemo");
  if (!player) return;
  player.pause();
  if (reset) {
    try { player.currentTime = 0; } catch (_) { /* metadata may not be ready yet */ }
  }
}

function selectExercise(exercise) {
  if (["running", "paused"].includes(sessionState)) {
    setMessage("Finish the current session before selecting another exercise.");
    return;
  }
  if (settingsDirty) {
    therapistSettingsMessage.textContent = "Apply or reset therapist settings before switching exercises; this draft is not saved.";
    return;
  }
  selectedExercise = exercise;
  currentExerciseEl.textContent = exercise;
  currentExerciseInstructionsEl.textContent = exerciseInstructions(exercise);
  trackingModeEl.textContent = trackingDescription(exercise);
  repsInput.value = "0";
  completedSetsInput.value = "0";
  referenceApproved.checked = false;
  referenceFileInput.value = "";
  resetFormFeedback();
  resetTimer();
  loadSettingsIntoForm();
  updateSetProgress(0);
  configureMonitor();
  loadExerciseVideo(exercise);
  if (exercise === "Hand Movement") {
    setFormFeedback("Hand tracking shows palm and finger joint positions only. It does not assess medical correctness.", "info");
  }
  setState("selected", `${exercise} selected. Set therapist-approved ranges, optionally analyze a reference, then start the session.`);
  if (isActive()) startPoseLoop();
  $("#exerciseSession").scrollIntoView({ behavior: "smooth", block: "start" });
}

function setCanvasSize() {
  if (!video.videoWidth || !video.videoHeight) return;
  // Avoid resetting the canvas drawing context on every camera frame.
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

function startPoseLoop() {
  if (animationFrame === null && isActive() && selectedExercise) {
    animationFrame = requestAnimationFrame(processPoseFrame);
  }
}

function processPoseFrame() {
  // Clear the current frame handle; the loop schedules the next one at the end.
  animationFrame = null;
  if (!isActive() || !selectedExercise) return;

  const needsHands = usesHandLandmarks(selectedExercise);
  const needsPose = !needsHands || selectedExercise === "Wrist Flexion and Extension";
  if (needsHands && !handLandmarker) {
    poseStatus.textContent = handModelError
      ? "Hand landmark model is unavailable. Check internet access, then reload the page."
      : "Hand landmark model is unavailable. Camera tracking cannot assess this movement.";
    if (sessionState === "running") showMovementResult(exerciseMonitor?.update(null));
    return;
  }
  if (needsPose && !landmarker) {
    poseStatus.textContent = "Body-pose model is unavailable. Camera tracking cannot assess this movement.";
    if (sessionState === "running") showMovementResult(exerciseMonitor?.update(null));
    return;
  }

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
    setCanvasSize();
    const now = Math.max(performance.now(), lastPoseTimestamp + 0.001);
    lastPoseTimestamp = now;
    try {
      // Use only the landmark family appropriate for the selected movement.
      const result = (needsPose && landmarker)
        ? landmarker.detectForVideo(video, now)
        : { landmarks: [] };
      const landmarks = result.landmarks || [];
      let handLandmarks = [];
      let handConfidence = [];
      let handWorldLandmarks = [];

      // Avoid running the second model for body exercises.
      if (needsHands && handLandmarker) {
        const handResult = handLandmarker.detectForVideo(video, now);
        handLandmarks = handResult.landmarks || [];
        handWorldLandmarks = handResult.worldLandmarks || [];
        handConfidence = (handResult.handedness || []).map(items => items?.[0]?.score ?? 0.8);
      }

      drawPose(canvas, landmarks, vision, handLandmarks);
      const person = landmarks[0];
      const sessionRunning = sessionState === "running";

      if (needsHands) {
        if (handLandmarks.length) {
          const handCount = handLandmarks.length;
          poseStatus.textContent = `${handCount} hand${handCount === 1 ? "" : "s"} detected. Yellow points and lines show palm and finger joints.`;
        } else if (handModelError || !handLandmarker) {
          poseStatus.textContent = "Hand tracking model did not load. Check your internet connection and reload the app.";
        } else {
          poseStatus.textContent = "No hands detected. Bring your hand(s) fully into view, keep fingers visible, and improve lighting.";
        }
      } else if (person) {
        poseStatus.textContent = `Body landmarks detected for ${selectedExercise}.`;
      } else {
        poseStatus.textContent = "No body detected. Move into view and improve lighting.";
      }

      if (sessionRunning) {
        const measurement = measureExercise(selectedExercise, {
          pose: person,
          hands: handLandmarks,
          handConfidence,
          handWorldLandmarks
        });
        monitorResult = exerciseMonitor?.update(measurement, now);
        showMovementResult(monitorResult);
        if (needsHands && !handLandmarks.length) correctionMessageEl.textContent = "Movement not detected. Adjust your position and bring the required hand landmarks into view.";
        if (!needsHands && !person) correctionMessageEl.textContent = "Movement not detected. Move into view and adjust the camera; this is not counted as an error.";
        if (selectedExercise === "Seated Arm Movement" && person) evaluateSeatedArmForm(person);
      }
    } catch (error) {
      console.error("Pose detection failed:", error);
      poseStatus.textContent = "Movement tracking encountered an error. Check the browser console; manual repetition entry is still available.";
    }
  }
  if (isActive() && selectedExercise) animationFrame = requestAnimationFrame(processPoseFrame);
}

async function handleStartCamera() {
  if (cameraBusy || referenceBusy || isActive()) return;
  if (!safetyConfirm.checked) {
    cameraError.textContent = "Please confirm the safety notice before starting the camera.";
    cameraError.hidden = false;
    return;
  }
  cameraBusy = true;
  startCameraBtn.disabled = true;
  startCameraBtn.textContent = "Starting camera…";
  cameraError.hidden = true;
  poseStatus.textContent = "Requesting camera permission… allow access in your browser prompt.";
  void feedback.unlock();
  try {
    const result = await startCamera();
    if (!result.success) throw new Error(result.error || "Camera could not start.");
    await waitForVideoReady();
    await ensurePoseModels();
    setCanvasSize();
    stopCameraBtn.disabled = false;
    poseStatus.textContent = handLandmarker
      ? "Camera ready. Select an exercise to show its landmarks; repetition estimates begin when you press Start."
      : "Camera ready. Body tracking is available; hand landmarks could not load. Check your internet connection for Hand Movement.";
    setMessage("Camera is ready. Choose an exercise and press Start to begin your session.");
    startPoseLoop();
  } catch (error) {
    console.error(error);
    cameraError.textContent = error.message || "Camera or movement tracking could not start.";
    cameraError.hidden = false;
    poseStatus.textContent = "Camera tracking is unavailable. You can still use the timer and enter repetitions manually.";
    if (isActive()) handleStopCamera();
  } finally {
    cameraBusy = false;
    startCameraBtn.disabled = false;
    startCameraBtn.textContent = "Start camera";
  }
}

function handleStopCamera() {
  stopPoseLoop();
  if (isActive()) stopCamera();
  releasePoseModels();
  canvasContext.clearRect(0, 0, canvas.width, canvas.height);
  lastPoseTimestamp = -1;
  stopCameraBtn.disabled = true;
  poseStatus.textContent = "Camera stopped. No camera video is saved by this app.";
  feedback.stop();
  if (selectedExercise && exerciseMonitor) {
    showMovementResult(exerciseMonitor.update(null));
    correctionMessageEl.textContent = "Camera stopped. The timer and manual repetition entry remain available.";
  }
  setFormFeedback("Camera stopped. Live tracking and form cues are inactive.", "info");
}

$("#exerciseList").addEventListener("click", event => {
  const button = event.target.closest("[data-exercise]");
  if (button) selectExercise(button.dataset.exercise);
});
$$('.legacy-exercises [data-exercise]').forEach(button => button.addEventListener("click", () => selectExercise(button.dataset.exercise)));
$$('[data-category]').forEach(button => button.addEventListener("click", () => renderExerciseCategory(button.dataset.category)));
startCameraBtn.addEventListener("click", handleStartCamera);
stopCameraBtn.addEventListener("click", handleStopCamera);
$("#saveTrackingSettings").addEventListener("click", applyTherapistSettings);
$("#resetTrackingSettings").addEventListener("click", resetTrackingSettings);
[rangeMinInput, rangeMaxInput, rangeToleranceInput, targetRepsInput, targetSetsInput].forEach(input => {
  input.addEventListener("input", () => {
    settingsDirty = true;
    therapistSettingsMessage.textContent = "Unsaved therapist settings. Apply or reset them before starting this exercise.";
    setState(sessionState);
  });
});
referenceFileInput.addEventListener("change", () => {
  const file = referenceFileInput.files?.[0];
  if (!selectedExercise || !file) return;
  if (["running", "paused"].includes(sessionState)) {
    referenceStatus.textContent = "Stop the session before replacing its reference clip.";
    referenceFileInput.value = "";
    return;
  }
  const previous = referenceMedia.get(selectedExercise);
  if (previous?.url.startsWith("blob:")) URL.revokeObjectURL(previous.url);
  referenceMedia.set(selectedExercise, { url: URL.createObjectURL(file), name: file.name });
  referenceTraces.delete(selectedExercise);
  referenceApproved.checked = false;
  loadExerciseVideo(selectedExercise);
  referenceStatus.textContent = "Reference loaded locally. Confirm therapist approval, then analyze movement phases.";
  configureMonitor();
});
referenceApproved.addEventListener("change", updateReferenceControls);
analyzeReferenceBtn.addEventListener("click", handleAnalyzeReference);
muteFeedbackBtn.addEventListener("click", () => {
  soundMuted = !soundMuted;
  muteFeedbackBtn.setAttribute("aria-pressed", String(soundMuted));
  muteFeedbackBtn.textContent = soundMuted ? "Unmute warning sounds" : "Mute warning sounds";
});
voiceAlerts.addEventListener("change", () => {
  if (!voiceAlerts.checked) {
    feedback.stop();
    feedbackStatus.textContent = "Voice feedback is off.";
  } else if (!("speechSynthesis" in window && "SpeechSynthesisUtterance" in window)) {
    feedbackStatus.textContent = "Voice feedback is not supported by this browser; visual warnings remain available.";
  } else {
    feedbackStatus.textContent = "Voice feedback is enabled; the browser may require a user gesture.";
  }
});

startBtn.addEventListener("click", () => {
  if (!selectedExercise || sessionState !== "selected") return;
  elapsedBeforeRun = 0;
  repsInput.value = "0";
  completedSetsInput.value = "0";
  configureMonitor();
  exerciseMonitor?.reset();
  monitorResult = exerciseMonitor?.update(null);
  showMovementResult(monitorResult);
  updateRepProgress(0);
  updateSetProgress(0);
  resetFormFeedback();
  void feedback.unlock();
  setState("running", "Session started. Follow your physiotherapist-approved plan; stop if you feel pain or unwell.");
  if (!isActive()) poseStatus.textContent = "Camera is off. Timer and manual repetition entry are available; live monitoring is not running.";
  startTimer();
  void playDemoVideo();
  startPoseLoop();
});

pauseBtn.addEventListener("click", () => {
  if (sessionState !== "running") return;
  elapsedBeforeRun = getElapsedSeconds();
  stopTimer(); updateTimer();
  pauseDemoVideo();
  movementStateEl.textContent = "Tracking unavailable";
  movementStatusEl.dataset.state = "unavailable";
  correctionMessageEl.textContent = "Session paused. Resume to continue live monitoring.";
  feedback.stop();
  setState("paused", "Session paused. Resume when you are ready.");
});

resumeBtn.addEventListener("click", () => {
  if (sessionState !== "paused") return;
  setState("running", "Session resumed.");
  startTimer();
  void playDemoVideo();
  startPoseLoop();
});

finishBtn.addEventListener("click", () => {
  if (!["running", "paused"].includes(sessionState)) return;
  const repetitions = Number(repsInput.value);
  if (repsInput.value.trim() === "" || !Number.isSafeInteger(repetitions) || repetitions < 0) {
    setMessage("Enter a valid non-negative whole number of repetitions.");
    repsInput.focus();
    return;
  }
  const completedSets = Number(completedSetsInput.value);
  if (completedSetsInput.value.trim() === "" || !Number.isSafeInteger(completedSets) || completedSets < 0) {
    setMessage("Enter a valid non-negative whole number of completed sets.");
    completedSetsInput.focus();
    return;
  }
  const durationSeconds = getElapsedSeconds();
  const errors = exerciseMonitor?.getErrors() || 0;
  const targetReps = Number(currentSettings().targetReps) || null;
  const targetSets = Number(currentSettings().targetSets) || null;
  const trackingUsed = isActive() && Boolean(getExerciseRule(selectedExercise)) && monitorResult?.status !== "Tracking unavailable";
  const referenceUsed = Boolean(referenceTraces.get(selectedExercise));
  stopTimer(); stopPoseLoop(); pauseDemoVideo(true); updateTimer();
  const completedSession = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    exercise: selectedExercise,
    durationSeconds,
    reps: repetitions,
    completedSets,
    targetReps,
    targetSets,
    errors,
    referenceCompared: referenceUsed,
    date: new Date().toISOString(),
    quality: trackingUsed ? "experimental camera estimate" : "manual entry"
  };
  try {
    saveSession(completedSession);
    renderHistory(); updateDashboard();
    const targetSummary = targetReps ? ` of ${targetReps} target repetitions` : " (target not set)";
    const setSummary = targetSets ? `${completedSets} of ${targetSets} target sets` : `${completedSets} sets (target not set)`;
    const trackingSummary = trackingUsed ? "experimental camera estimate" : "manual repetition entry";
    sessionSummaryEl.querySelector("p").textContent = `${selectedExercise}: ${formatTime(durationSeconds)}, ${repetitions}${targetSummary}, ${setSummary}, ${errors} movement warnings, ${trackingSummary}${referenceUsed ? ", reference phase comparison enabled" : ", no reference comparison"}.`;
    setState("finished", `Session saved: ${formatTime(durationSeconds)} and ${repetitions} repetitions recorded.`);
    selectedExercise = "";
    currentExerciseEl.textContent = "None selected";
    currentExerciseInstructionsEl.textContent = "Choose an exercise to view its instructions.";
    trackingModeEl.textContent = "Select an exercise to see tracking availability.";
    referenceApproved.checked = false;
    referenceFileInput.value = "";
    updateReferenceControls();
    $("#saveTrackingSettings").disabled = true;
    $("#resetTrackingSettings").disabled = true;
    movementStateEl.textContent = "Tracking unavailable";
    correctionMessageEl.textContent = "Select an exercise to begin another session.";
    handleStopCamera();
  } catch (error) {
    console.error("Unable to save session:", error);
    setState("paused", "Could not save the session in this browser. Check browser storage and try again.");
  }
});

repsInput.addEventListener("input", () => {
  const value = repsInput.value;
  repsInput.setCustomValidity(value !== "" && (!Number.isSafeInteger(Number(value)) || Number(value) < 0)
    ? "Enter a non-negative whole number." : "");
  updateRepProgress(Number(value) || 0);
});

completedSetsInput.addEventListener("input", () => {
  const value = completedSetsInput.value;
  completedSetsInput.setCustomValidity(value !== "" && (!Number.isSafeInteger(Number(value)) || Number(value) < 0)
    ? "Enter a non-negative whole number." : "");
  updateSetProgress(Number(value) || 0);
});

window.addEventListener("beforeunload", () => {
  stopTimer(); stopPoseLoop();
  if (isActive()) stopCamera();
  feedback.stop();
  releasePoseModels();
  for (const media of referenceMedia.values()) {
    if (media.url.startsWith("blob:")) URL.revokeObjectURL(media.url);
  }
});

setupHistory(() => { renderHistory(); updateDashboard(); });
renderHistory();
updateDashboard();
updateTimer();
setState("ready", "Choose an exercise above to begin.");
stopCameraBtn.disabled = true;
