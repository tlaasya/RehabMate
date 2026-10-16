export function createFeedback({ isMuted, voiceEnabled, onStatus = () => {}, cooldownMs = 4500 }) {
  let context = null;
  let lastWarningAt = 0;

  async function unlock() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        onStatus("Warning tones are not supported by this browser; visual feedback remains available.");
        return;
      }
      if (!context) context = new AudioContextClass();
      if (context?.state === "suspended") await context.resume();
      onStatus(context?.state === "running"
        ? "Warning tones are ready. Voice feedback follows its separate toggle."
        : "Warning tones are blocked; visual feedback remains available.");
    } catch (error) {
      onStatus("Warning tones could not be enabled; visual feedback remains available.");
      console.warn("Warning audio is unavailable:", error);
    }
  }

  function warn(message, now = Date.now()) {
    if (!message || now - lastWarningAt < cooldownMs) return false;
    lastWarningAt = now;
    if (!isMuted() && context?.state === "running") {
      try {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 520;
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.1, context.currentTime + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.22);
      } catch (error) {
        onStatus("Warning tone playback failed; visual feedback remains available.");
        console.warn("Warning tone could not play:", error);
      }
    }
    if (voiceEnabled() && !("speechSynthesis" in window && "SpeechSynthesisUtterance" in window)) {
      onStatus("Voice feedback is not supported by this browser; visual warnings remain available.");
    } else if (voiceEnabled()) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new window.SpeechSynthesisUtterance(message);
        utterance.rate = 0.92;
        utterance.onerror = () => onStatus("Voice feedback was blocked; visual warnings remain available.");
        utterance.onstart = () => onStatus("Voice feedback is active.");
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        onStatus("Voice feedback could not play; visual warnings remain available.");
        console.warn("Voice feedback could not play:", error);
      }
    }
    return true;
  }

  function stop() {
    if ("speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch (error) {
        console.warn("Voice feedback could not be stopped:", error);
      }
    }
  }

  return { unlock, warn, stop };
}
