# RehabMate

RehabMate is a browser-based home exercise support prototype. It reuses the existing camera stream and MediaPipe Tasks Vision body/hand models, and includes 15 exercise demonstrations plus the original seated-arm and hand sessions.

## Run

No npm or package installation is required. MediaPipe JavaScript/WASM and model files load from their configured CDNs, so the first model load needs internet access.

From the project folder in VS Code, either run `index.html` with Live Server or use:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. Do not use a `file://` URL; browser camera access requires localhost or HTTPS.

Run the automated movement/configuration tests with:

```powershell
node --test .\tests\monitor.test.mjs
```

## Exercise videos

The exercise cards and shared reference player use exact paths in `EXERCISE_VIDEOS` in `app.js`. The uploaded names contain some typos and double `.mp4` suffixes; keep them as-is or update the matching map entry if you rename a file. Every category selection loads its corresponding clip into the player. The original **Hand Movement** choice uses the uploaded Hand Opening and Closing demonstration.

## Monitoring workflow

1. Select a category and exercise. The session panel shows its instructions and matching reference video.
2. Open **Therapist tracking settings** and enter the start value, target value, tolerance, target repetitions, and target sets provided by the treating therapist. No movement range is prescribed by the app. Settings are isolated per exercise and can be reset individually.
3. Camera monitoring is optional. Confirm the safety notice, select **Start camera**, and allow permission. Camera frames stay in the browser.
4. Start, pause/resume, and stop the session from the shared controls. A complete supported start-to-target-to-start cycle is required to add an automatic repetition.
5. To compare a reference, confirm therapist approval and select **Analyze reference phases**. The app samples the selected exercise video, extracts one full movement cycle using the configured range, then uses normalized phase distance rather than clip timestamps.
6. Mute warning tones or enable Voice feedback. Speech requires browser Web Speech support and is unlocked by a user action.

## Supported estimates and limits

- Body-pose estimates are available for shoulder flexion/abduction, elbow flexion, shoulder shrugs, shoulder-blade approximation, seated knee extension/marching, ankle dorsiflexion, straight-leg raise, and seated hip abduction.
- Hand estimates are available for hand opening/closing, finger flexion/extension, finger-to-thumb proximity, and wrist flexion/extension when both hand and forearm landmarks are visible.
- Forearm rotation uses MediaPipe hand-world landmarks and remains unavailable when those 3D points are absent or unreliable. Other unsupported views also report **Tracking unavailable**.
- These are experimental geometry heuristics, not clinically validated form assessment. Camera position, occlusion, lighting, patient-specific movement, and reference-video framing affect results. A visible “Correct movement” status does not guarantee correct or safe performance.
- The Shoulder Flexion clip yielded a complete cycle with diagnostic-only bounds matching its observed feature range (11–25°, tolerance 2°); these are not clinical recommendations. The initial validation bounds were mismatched. The Seated Hip Abduction clip measured 7.5–14.0% knee displacement but did not reach its configured target after the start, and the knees are not reliably visible. Replace it with a therapist-approved front-view clip showing both hips and knees through a full outward-and-return cycle. Neither exercise is compared until the therapist's range is entered and reference analysis succeeds.
- Therapist ranges and targets are stored only in localStorage in this browser. Session history is also local and is not a remote database.
- Stop if you feel pain or unwell and follow your care team's instructions. RehabMate does not diagnose conditions or prescribe exercises.

## Test checklist

- Click each category; confirm the correct five exercises and video load for each card.
- Deny camera permission or use a device without a camera; confirm the error text and manual timer/repetition workflow remain available.
- Allow permission, start a supported exercise, and check the live video/landmark overlay. Test with a clear view matching the exercise's indicated front/side setup.
- Enter therapist-approved ranges; verify the monitor stays unavailable until configuration and landmarks are valid.
- With a test clip containing a complete cycle, approve and analyze its reference; verify the status reports whether a complete reference phase was found.
- Hold a supported metric below its configured target for at least the persistence interval; check the visual correction, warning cooldown, mute button, and optional voice feedback.
- Verify incomplete movement and missing landmarks do not add reps; complete a full cycle to check one rep is added. Stop and confirm the summary includes reps, sets, targets, warning count, and reference-comparison state.
- Stop the camera and verify its permission indicator turns off; select another exercise and ensure the correct video appears.

Camera hardware, patient-specific camera angles/ranges, real clinical reference clips, audible output, and speech behavior should be tested manually in the intended browser/device. The browser-based synthetic monitor tests do not validate clinical accuracy.