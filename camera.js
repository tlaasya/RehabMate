let videoElement = null;
let mediaStream = null;
let isCameraActive = false;
let videoReadyPromise = null;
let videoReadyResolve = null;
let videoReadyReject = null;

const ERROR_MESSAGES = {
  PERMISSION_DENIED: 'Camera access was denied. Please allow camera access in your browser settings and reload the page.',
  NOT_FOUND: 'No camera found. Please connect a camera and try again.',
  NOT_ALLOWED: 'Camera access is blocked. Check browser permissions or site settings.',
  NOT_READABLE: 'Camera is in use by another application. Please close other apps using the camera.',
  OVERCONSTRAINED: 'Camera does not meet requirements. Try a different camera.',
  SECURITY_ERROR: 'Camera access requires a secure context (HTTPS or localhost).',
  UNKNOWN: 'An unexpected error occurred while accessing the camera.',
  NO_VIDEO_ELEMENT: 'Video element with ID "exercise-video" not found in the DOM.',
  ALREADY_ACTIVE: 'Camera is already active.',
  NOT_ACTIVE: 'Camera is not active.'
};

function getVideoElementFromDOM() {
  const element = document.getElementById('exercise-video');
  if (!element) {
    return null;
  }
  if (!(element instanceof HTMLVideoElement)) {
    return null;
  }
  return element;
}

function createVideoReadyPromise() {
  videoReadyPromise = new Promise((resolve, reject) => {
    videoReadyResolve = resolve;
    videoReadyReject = reject;
  });
  return videoReadyPromise;
}

function handleVideoLoadedMetadata() {
  if (videoReadyResolve) {
    videoReadyResolve({
      videoWidth: videoElement.videoWidth,
      videoHeight: videoElement.videoHeight
    });
    videoReadyResolve = null;
    videoReadyReject = null;
  }
}

function handleVideoError(event) {
  if (videoReadyReject) {
    videoReadyReject(new Error('Video playback failed'));
    videoReadyResolve = null;
    videoReadyReject = null;
  }
}

function showError(message) {
  const errorContainer = document.getElementById('camera-error') || createErrorContainer();
  errorContainer.textContent = message;
  errorContainer.style.display = 'block';
  errorContainer.setAttribute('role', 'alert');
}

function hideError() {
  const errorContainer = document.getElementById('camera-error');
  if (errorContainer) {
    errorContainer.style.display = 'none';
    errorContainer.textContent = '';
  }
}

function createErrorContainer() {
  const container = document.createElement('div');
  container.id = 'camera-error';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #dc3545;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 90vw;
    text-align: center;
    z-index: 1000;
    display: none;
  `;
  document.body.appendChild(container);
  return container;
}

function mapError(error) {
  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return ERROR_MESSAGES.PERMISSION_DENIED;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return ERROR_MESSAGES.NOT_FOUND;
    case 'NotReadableError':
    case 'TrackStartError':
      return ERROR_MESSAGES.NOT_READABLE;
    case 'OverconstrainedError':
      return ERROR_MESSAGES.OVERCONSTRAINED;
    case 'SecurityError':
      return ERROR_MESSAGES.SECURITY_ERROR;
    case 'AbortError':
      return ERROR_MESSAGES.UNKNOWN;
    default:
      return ERROR_MESSAGES.UNKNOWN;
  }
}

function stopAllTracks() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      track.stop();
    });
    mediaStream = null;
  }
}

function cleanupVideoElement() {
  if (videoElement) {
    videoElement.removeEventListener('loadedmetadata', handleVideoLoadedMetadata);
    videoElement.removeEventListener('error', handleVideoError);
    videoElement.srcObject = null;
    videoElement.pause();
    videoElement = null;
  }
}

export async function startCamera() {
  hideError();

  if (isCameraActive) {
    showError(ERROR_MESSAGES.ALREADY_ACTIVE);
    return { success: false, error: ERROR_MESSAGES.ALREADY_ACTIVE };
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError(ERROR_MESSAGES.SECURITY_ERROR);
    return { success: false, error: ERROR_MESSAGES.SECURITY_ERROR };
  }

  videoElement = getVideoElementFromDOM();
  if (!videoElement) {
    showError(ERROR_MESSAGES.NO_VIDEO_ELEMENT);
    return { success: false, error: ERROR_MESSAGES.NO_VIDEO_ELEMENT };
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: false
    });

    // Create the readiness promise before listeners can fire, otherwise a fast
    // loadedmetadata event can occur before the promise exists and hang callers.
    createVideoReadyPromise();
    videoElement.srcObject = mediaStream;
    videoElement.addEventListener('loadedmetadata', handleVideoLoadedMetadata, { once: true });
    videoElement.addEventListener('error', handleVideoError, { once: true });

    await videoElement.play();
    isCameraActive = true;

    // Some browsers may already have metadata by the time play() resolves.
    if (videoElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
      handleVideoLoadedMetadata();
    }
    await videoReadyPromise;
    return { success: true };
  } catch (error) {
    const message = mapError(error);
    showError(message);
    stopAllTracks();
    cleanupVideoElement();
    isCameraActive = false;
    return { success: false, error: message };
  }
}

export function stopCamera() {
  hideError();

  if (!isCameraActive) {
    return { success: false, error: ERROR_MESSAGES.NOT_ACTIVE };
  }

  stopAllTracks();
  cleanupVideoElement();
  isCameraActive = false;

  if (videoReadyReject) {
    videoReadyReject(new Error('Camera stopped'));
    videoReadyResolve = null;
    videoReadyReject = null;
  }
  videoReadyPromise = null;

  return { success: true };
}

export function getVideoElement() {
  return videoElement;
}

export async function waitForVideoReady() {
  if (!isCameraActive || !videoReadyPromise) {
    throw new Error('Camera not started. Call startCamera() first.');
  }
  return videoReadyPromise;
}

export function isActive() {
  return isCameraActive;
}