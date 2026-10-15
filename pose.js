const TASKS_VERSION = "0.10.14";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Fallback hand connections keep the finger skeleton visible even if the
// installed Tasks Vision bundle does not expose HAND_CONNECTIONS.
const HAND_CONNECTIONS_FALLBACK = [
  [0,1],[1,2],[2,3],[3,4],       // thumb
  [0,5],[5,6],[6,7],[7,8],       // index finger
  [5,9],[9,10],[10,11],[11,12],  // middle finger
  [9,13],[13,14],[14,15],[15,16],// ring finger
  [13,17],[17,18],[18,19],[19,20],// little finger
  [0,17]                         // palm edge
];

export async function createPoseLandmarker() {
  const vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/+esm`);
  const fileset = await vision.FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`
  );

  // Keep the two models independent: a hand-tracking task can still work for
  // Hand Movement if the full-body Pose model fails to initialize.
  let landmarker = null;
  let poseModelError = null;
  try {
    landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45
    });
  } catch (error) {
    poseModelError = error;
    console.warn("Body pose model could not be loaded.", error);
  }

  let handLandmarker = null;
  let handModelError = null;
  try {
    handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45
    });
  } catch (error) {
    handModelError = error;
    console.warn("Hand landmark model could not be loaded.", error);
  }

  if (!landmarker && !handLandmarker) {
    throw new Error("Neither the body-pose nor hand-landmark model could load. Check your internet connection and reload the app.");
  }
  return { landmarker, handLandmarker, poseModelError, handModelError, vision };
}

function visible(point, threshold = 0.35) {
  return point && (point.visibility ?? point.presence ?? 1) >= threshold;
}

function drawConnections(ctx, points, connections, width, height, threshold = 0.35) {
  if (!connections) return;
  for (const connection of connections) {
    const startIndex = Array.isArray(connection) ? connection[0] : connection.start;
    const endIndex = Array.isArray(connection) ? connection[1] : connection.end;
    const start = points[startIndex];
    const end = points[endIndex];
    if (!visible(start, threshold) || !visible(end, threshold)) continue;
    ctx.beginPath();
    ctx.moveTo(start.x * width, start.y * height);
    ctx.lineTo(end.x * width, end.y * height);
    ctx.stroke();
  }
}

export function drawPose(canvas, landmarks, vision, handLandmarks = []) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const bodyPoints = landmarks?.[0];
  if (bodyPoints) {
    ctx.lineWidth = Math.max(2, canvas.width / 240);
    ctx.strokeStyle = "#5eead4";
    ctx.fillStyle = "#f8fffe";
    drawConnections(ctx, bodyPoints, vision.PoseLandmarker?.POSE_CONNECTIONS, canvas.width, canvas.height, 0.45);
    for (const point of bodyPoints) {
      if (!visible(point, 0.45)) continue;
      ctx.beginPath();
      ctx.arc(point.x * canvas.width, point.y * canvas.height, Math.max(2, canvas.width / 150), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Yellow points and lines show the 21 landmarks on each detected hand.
  if (handLandmarks?.length) {
    ctx.lineWidth = Math.max(2, canvas.width / 280);
    ctx.strokeStyle = "#fbbf24";
    ctx.fillStyle = "#fff7d6";
    const handConnections = vision.HandLandmarker?.HAND_CONNECTIONS || HAND_CONNECTIONS_FALLBACK;
    for (const hand of handLandmarks) {
      drawConnections(ctx, hand, handConnections, canvas.width, canvas.height, 0.1);
      for (const point of hand) {
        if (!point) continue;
        ctx.beginPath();
        ctx.arc(point.x * canvas.width, point.y * canvas.height, Math.max(2.5, canvas.width / 170), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
