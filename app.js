import { startCamera, stopCamera, isActive, getVideoElement, waitForVideoReady } from "./camera.js";
import { createPoseLandmarker, drawPose } from "./pose.js";
import { createRepCounter, angleAtShoulder } from "./exercise.js";
import { getSessions, saveSession, clearSessions } from "./storage.js";
import { renderHistory, setupHistory } from "./history.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const totalSessionsEl = $("#totalSessions");
const totalRepsEl = $("#totalReps");
const latestSessionEl = $("#latestSession");
const currentExerciseEl = $("#currentExercise");
const timerEl = $("#timer");
const repsInput = $("#reps");
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
const audioAlerts = $("#audioAlerts");
const cameraError = $("#camera-error");
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
let repCounter = createRepCounter();
let lastPoseTimestamp = -1;
let cameraBusy = false;
let formIssue = "";
let leanFrames = 0;
let highArmFrames = 0;
let audioContext = null;
let lastAlertAt = 0;

// Demo-only thresholds. Adjust only with a physiotherapist's guidance.
const FORM_CUE_SETTINGS = {
  maxTorsoLeanDegrees: 20,
  maxArmAngleDegrees: 115,
  consecutiveFramesRequired: 3,
  soundCooldownMs: 1800
};

const EXERCISE_VIDEOS = {
  "Seated Arm Movement": "videos/seated-arm-movement.mp4",
  "Hand Movement": "videos/hand-movement.mp4"
};


function setFormFeedback(message, level = "info") {
  if (!formFeedback) return;
  formFeedback.textContent = message;
  formFeedback.dataset.level = level;
}

function playFormAlert() {
  if (!audioAlerts?.checked) return;
  const now = Date.now();
  if (now - lastAlertAt < FORM_CUE_SETTINGS.soundCooldownMs) return;
  lastAlertAt = now;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.24);
  } catch (error) {
    console.warn("Audio form cue could not play:", error);
  }
}

function showFormIssue(issue) {
  if (issue && issue !== formIssue) playFormAlert();
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
  startBtn.disabled = !selectedExercise || state !== "selected";
  pauseBtn.disabled = state !== "running";
  resumeBtn.disabled = state !== "paused";
  finishBtn.disabled = !["running", "paused"].includes(state);
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
  const source = EXERCISE_VIDEOS[exerciseName];
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

  if (!source) {
    player.removeAttribute("src");
    player.load();
    note.textContent = "No demonstration video is configured for this exercise.";
    return;
  }

  // Keep the videos folder beside index.html and preserve exact filenames.
  const videoUrl = new URL(source, document.baseURI).href;
  player.src = videoUrl;
  note.textContent = `Loading demonstration: ${source}`;

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
    note.textContent = `Could not load ${source} (${reason}). Confirm the file exists in the videos folder beside index.html and run the app from localhost/Live Server.`;
    console.error("Exercise video failed to load:", videoUrl, mediaError);
  };
  player.load();
}

async function playDemoVideo() {
  const player = $("#exerciseDemo");
  const note = $("#exerciseVideoNote");
  if (!player || !EXERCISE_VIDEOS[selectedExercise]) return;
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
  selectedExercise = exercise;
  currentExerciseEl.textContent = exercise;
  repsInput.value = "0";
  repCounter.reset();
  resetFormFeedback();
  resetTimer();
  loadExerciseVideo(exercise);
  if (exercise === "Hand Movement") {
    setFormFeedback("Hand tracking shows palm and finger joint positions only. It does not assess medical correctness.", "info");
  }
  setState("selected", `${exercise} selected. Start the camera for landmarks, then press Start to begin the session and demonstration.`);
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

  const needsHands = selectedExercise === "Hand Movement";
  if (needsHands && !handLandmarker) {
    poseStatus.textContent = handModelError
      ? "Hand landmark model is unavailable. Check internet access, then reload the page."
      : "Hand landmark model is not available. You can still follow the demonstration and enter repetitions manually.";
    return;
  }
  if (!needsHands && !landmarker) {
    poseStatus.textContent = "Body-pose model is unavailable. You can still follow the demonstration and enter repetitions manually.";
    return;
  }

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
    setCanvasSize();
    const now = Math.max(performance.now(), lastPoseTimestamp + 0.001);
    lastPoseTimestamp = now;
    try {
      // Hand Movement uses hand/finger landmarks only; body-pose landmarks
      // are intentionally suppressed for that exercise.
      const result = (!needsHands && landmarker)
        ? landmarker.detectForVideo(video, now)
        : { landmarks: [] };
      const landmarks = result.landmarks || [];
      let handLandmarks = [];

      // Run the hand model for the hand-specific exercise only to reduce CPU load.
      if (needsHands && handLandmarker) {
        const handResult = handLandmarker.detectForVideo(video, now);
        handLandmarks = handResult.landmarks || [];
      }

      drawPose(canvas, landmarks, vision, handLandmarks);
      const person = landmarks[0];
      const sessionRunning = sessionState === "running";

      if (needsHands) {
        if (handLandmarks.length) {
          const handCount = handLandmarks.length;
          poseStatus.textContent = `${handCount} hand${handCount === 1 ? "" : "s"} detected. Yellow points and lines show palm and finger joints.`;
          setFormFeedback("Hand landmarks are visible. They show joint positions only and do not judge medical correctness.", "info");
        } else if (handModelError || !handLandmarker) {
          poseStatus.textContent = "Hand tracking model did not load. Check your internet connection and reload the app.";
          setFormFeedback("Hand landmark model unavailable. You can still watch the demonstration and follow your physiotherapist's plan.", "info");
        } else {
          poseStatus.textContent = "No hands detected. Bring your hand(s) fully into view, keep fingers visible, and improve lighting.";
          setFormFeedback("Keep your hands inside the camera frame. Avoid covering fingers with sleeves or objects.", "info");
        }
      } else if (person) {
        const sideCandidates = [
          { shoulder: person[11], wrist: person[15], hip: person[23] },
          { shoulder: person[12], wrist: person[16], hip: person[24] }
        ].filter(side => [side.shoulder, side.wrist, side.hip].every(point => point && (point.visibility ?? 1) >= 0.45));

        if (sessionRunning && sideCandidates.length) {
          const side = sideCandidates[0];
          const angle = angleAtShoulder(side.shoulder, side.hip, side.wrist);
          const resultCount = repCounter.update(angle, now);
          repsInput.value = String(resultCount.reps);
          poseStatus.textContent = `Body detected. Estimated repetitions: ${resultCount.reps}. This is a demo estimate, not a clinical assessment.`;
          evaluateSeatedArmForm(person);
        } else if (!sideCandidates.length) {
          poseStatus.textContent = "Body detected, but the shoulder, wrist, or hip is unclear. Adjust your camera and lighting.";
          if (sessionRunning) setFormFeedback("Tracking unclear. Keep your upper body and moving arm visible.", "info");
        } else {
          poseStatus.textContent = "Body landmarks visible. Press Start to begin repetition estimates.";
          setFormFeedback("Camera tracking is ready. Start the session to enable the demo repetition estimate and form cues.", "info");
        }
      } else {
        poseStatus.textContent = "No body detected. Move into view and improve lighting.";
        if (sessionRunning) setFormFeedback("No body detected. Move into camera view before using form cues.", "info");
      }
    } catch (error) {
      console.error("Pose detection failed:", error);
      poseStatus.textContent = "Movement tracking encountered an error. Check the browser console; manual repetition entry is still available.";
    }
  }
  if (isActive() && selectedExercise) animationFrame = requestAnimationFrame(processPoseFrame);
}

async function handleStartCamera() {
  if (cameraBusy || isActive()) return;
  if (!safetyConfirm.checked) {
    cameraError.textContent = "Please confirm the safety notice before starting the camera.";
    cameraError.hidden = false;
    return;
  }
  cameraBusy = true;
  startCameraBtn.disabled = true;
  cameraError.hidden = true;
  try {
    const result = await startCamera();
    if (!result.success) throw new Error(result.error || "Camera could not start.");
    await waitForVideoReady();
    if (!landmarker && !handLandmarker) {
      poseStatus.textContent = "Loading body and hand tracking models… keep this page online for the first load.";
      const model = await createPoseLandmarker();
      landmarker = model.landmarker;
      handLandmarker = model.handLandmarker;
      handModelError = model.handModelError;
      vision = model.vision;
    }
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
    if (isActive()) stopCamera();
  } finally {
    cameraBusy = false;
    startCameraBtn.disabled = false;
  }
}

function handleStopCamera() {
  stopPoseLoop();
  if (isActive()) stopCamera();
  canvasContext.clearRect(0, 0, canvas.width, canvas.height);
  lastPoseTimestamp = -1;
  stopCameraBtn.disabled = true;
  poseStatus.textContent = "Camera stopped. No camera video is saved by this app.";
  setFormFeedback("Camera stopped. Form cues are inactive.", "info");
}

$$('[data-exercise]').forEach(button => button.addEventListener("click", () => selectExercise(button.dataset.exercise)));
startCameraBtn.addEventListener("click", handleStartCamera);
stopCameraBtn.addEventListener("click", handleStopCamera);

startBtn.addEventListener("click", () => {
  if (!selectedExercise || sessionState !== "selected") return;
  elapsedBeforeRun = 0;
  repsInput.value = "0";
  repCounter.reset();
  resetFormFeedback();
  if (audioAlerts?.checked) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass && !audioContext) audioContext = new AudioContextClass();
      if (audioContext?.state === "suspended") audioContext.resume();
    } catch (error) {
      console.warn("Audio alerts are unavailable in this browser:", error);
    }
  }
  setState("running", "Session started. Follow your physiotherapist-approved plan; stop if you feel pain or unwell.");
  startTimer();
  void playDemoVideo();
  startPoseLoop();
});

pauseBtn.addEventListener("click", () => {
  if (sessionState !== "running") return;
  elapsedBeforeRun = getElapsedSeconds();
  stopTimer(); updateTimer();
  pauseDemoVideo();
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
  const durationSeconds = getElapsedSeconds();
  stopTimer(); stopPoseLoop(); pauseDemoVideo(true); updateTimer();
  const completedSession = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    exercise: selectedExercise,
    durationSeconds,
    reps: repetitions,
    date: new Date().toISOString(),
    quality: isActive() ? "demo camera estimate" : "manual entry"
  };
  try {
    saveSession(completedSession);
    renderHistory(); updateDashboard();
    setState("finished", `Session saved: ${formatTime(durationSeconds)} and ${repetitions} repetitions recorded.`);
    selectedExercise = "";
    currentExerciseEl.textContent = "None selected";
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
});

window.addEventListener("beforeunload", () => {
  stopTimer(); stopPoseLoop();
  if (isActive()) stopCamera();
});

setupHistory(() => { renderHistory(); updateDashboard(); });
renderHistory();
updateDashboard();
updateTimer();
setState("ready", "Choose an exercise above to begin.");
stopCameraBtn.disabled = true;
