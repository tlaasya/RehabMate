# RehabMate — Home Physiotherapy Assistant

This package contains the updated RehabMate browser prototype and the two demonstration videos you uploaded.

## Included exercise videos

- `videos/hand-movement.mp4` — the hand/wrist movement demonstration (`WhatsApp Video 2026-10-15 at 9.58.48 PM.mp4`)
- `videos/seated-arm-movement.mp4` — the seated arm movement demonstration (`WhatsApp Video 2026-10-15 at 10.10.10 PM.mp4`)

The video names and paths are already configured in `app.js`. Keep the `videos` folder next to `index.html`; do not rename the files unless you also update `EXERCISE_VIDEOS` in `app.js`.

## Run the app

1. Extract the ZIP completely.
2. Open the extracted `RehabMate_Corrected` folder in VS Code.
3. Run `index.html` with VS Code Live Server or another local web server. Do not open the file using a `file://` URL.
4. Keep an internet connection available so the MediaPipe browser modules and models can load.
5. Select **Hand Movement** or **Seated Arm Movement**.
6. For camera tracking, tick the safety confirmation, click **Start camera**, and allow browser camera permission.
7. Click **Start**. The selected demonstration video starts playing and loops alongside the live camera view. Pause and Resume control the session and demonstration together.
8. During **Hand Movement**, detected palm/finger landmarks are shown in yellow. During **Seated Arm Movement**, body landmarks are shown in teal.
9. Enter repetitions manually for Hand Movement. Seated Arm Movement uses a simple experimental estimate.
10. Click **Finish Exercise** to save the session summary to this browser.

## Layout and behavior

- Desktop: demonstration video on the left, live camera on the right.
- The Start, Pause, Resume, and Finish Exercise controls are immediately below the demonstration video.
- Smaller screens stack the panels vertically.
- The demonstration video reports a helpful message if a file is missing or cannot be decoded.

## Important limitations

- This is a browser-based prototype. Session history uses localStorage in the current browser; it is not a remote database.
- Camera frames are processed locally and are not recorded by this app.
- Hand landmarks indicate joint locations; they do not determine whether a movement is medically correct.
- The seated-arm repetition counter and audio form cues are experimental heuristics, not clinically validated assessment. Lighting, camera position, occlusion, and model error may produce inaccurate estimates or warnings.
- Follow the exercise plan prescribed by a qualified physiotherapist. Stop if you feel pain or unwell.
