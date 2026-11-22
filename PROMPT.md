# Harmony Trainer: full build spec

You are building a new mobile app for Android and iOS from scratch, autonomously. The owner cannot code. Make sensible decisions yourself, record them in DECISIONS.md, and keep going. Track progress in PROGRESS.md (phases, done/not done, next step) and update it after every meaningful step so the work can resume after a crash or restart. If PROGRESS.md exists when you start, resume from it.

## What the app is
A singing trainer built around real-time pitch visualisation, with harmony training as its headline feature. The user records a melody, then sings a harmony over their own recording against generated target bars, and gets scored. It must feel original and premium. Do not copy the name, UI, colours, icons or assets of any existing app (e.g. Nail the Pitch). Propose 5 original app names in DECISIONS.md and use the working title "Harmony Trainer" until the owner picks one.

## Pricing and publishing
- Android: free (no ads, no IAP).
- iOS: paid upfront, 4.99 GBP price tier, no IAP.
- Publishing credentials for Google Play and App Store Connect are already configured on this machine. Find and reuse them; check other app projects under the user folder (e.g. the StudyMusicTheory app) for existing signing/publishing setup and conventions.
- Bundle/package ID: com.studymusictheory.<appname> (choose a clean slug from the working title).
- Privacy policy and data deletion pages: create them as static pages for studymusictheory.com at /<appslug>/privacy and /<appslug>/delete-data. Find the studymusictheory.com site project on this machine and add them there following its existing structure and deploy method. If you cannot find or deploy it, generate the HTML files in ./web/ and note in PROGRESS.md exactly what the owner must do.
- Data: all audio and processing stays on device. No accounts, no analytics, no tracking. Microphone is the only permission. Write accurate permission strings, Play Data Safety answers and App Store privacy labels to match.
- Final goal of this session: signed builds uploaded to TestFlight and the Google Play internal testing track, with full store listings prepared (descriptions, keywords, screenshots generated from the real app, feature graphic, icon). Do NOT submit for public App Store review or promote to Play production. Stop there and report; the owner will test and then instruct you to release.

## Architecture (recommended; deviate only with a reason logged in DECISIONS.md)
- UI: Flutter, with all pitch graphics drawn in CustomPainter or a GPU-backed equivalent, targeting a steady 60fps (120fps on ProMotion/high refresh devices).
- Shared C++ DSP core via FFI: pitch detection (YIN or McLeod/MPM with octave-error correction and confidence gating), note segmentation, key detection, harmony generation, scoring. Unit test it on synthetic sine/vocal-like signals.
- Native audio I/O: iOS AVAudioEngine (use voice-processing I/O for speaker mode echo cancellation); Android Oboe (low latency, AEC effect for speaker mode).
- Stem separation (later phase): on-device only, no server. iOS Core ML, Android ONNX Runtime or TFLite. Use a permissively licensed model (Demucs/HTDemucs or Spleeter); verify the weights' licence allows commercial use and log it. Provide Fast and Quality modes. Download the model on first use if bundling makes the app too large.
- Video export: on-device. Render the piano roll offscreen frame by frame and encode with AVAssetWriter / MediaCodec plus mixed audio. 9:16 vertical by default.

## Core loop (build this first, make it excellent)
1. Live monitor: scrolling piano roll, note names on the left, user's pitch as a smooth interpolated glowing line, cents-off readout, current note big and clear.
2. Record Take 1 (melody). Optional count-in and metronome, optional key/tempo settings, or free-time.
3. Analyse: pitch track to notes (handle slides, vibrato, scoops; merge/split rules), snap to the nearest note in the detected key, detect the key (let the user confirm or change it). Show the result as editable target bars: the user can drag a bar's pitch, split, merge, delete, or nudge timing.
4. Choose harmony: 3rd above, 3rd below, 6th below, 5th above, octave, unison, or custom interval; always diatonic to the key (correct major/minor 3rds by scale degree). Optional "chord-aware" mode where the user picks or confirms a simple chord per bar and the harmony prefers chord tones.
5. Partial harmonising: the user selects regions on the timeline (drag to select bars or phrases) and sets each region to harmony type X, unison, or rest. Changing the harmony instantly regenerates the target bars for those regions only.
6. Take 2+: Take 1 plays back with its own mute/solo/volume. Target bars show the harmony. The mic scores only the new take.
7. Layers: save good takes as layers (up to at least 4). Each layer has a colour, volume, mute/solo and can itself be the base for another harmony. A mixer view and a stacked view where all layers' pitch lines show at once in different colours.
8. Playback and export: play the stacked harmony, export audio (WAV/M4A) and video.

## Mic isolation and latency
- Headphones are the default and recommended mode. Detect the audio route; if on the speaker during overdub, show a clear but dismissable notice.
- Speaker mode: enable platform echo cancellation. Additionally, since the app knows the playback pitch, down-weight detected pitches that match the playback within a tight tolerance when the user's own confidence is low.
- Latency calibration wizard (tap-along or loopback click), stored per audio route, with separate offsets for wired and Bluetooth. Apply the offset to scoring and to aligning recorded layers.

## Scoring (with tolerance)
- Per note: pitch accuracy in cents and timing accuracy at onset; ignore the first ~80ms of each note for scoops (configurable).
- Default tolerances: Perfect within ±15 cents, Good within ±35, OK within ±50, Miss outside (all configurable, plus Easy/Normal/Hard/Pro presets).
- Visual feedback: target bars fill in colour as you hold them in tune, a glow when perfect, a subtle particle burst on a perfect hold, haptics optional.
- Take summary: overall score, % notes hit, average cents drift (sharp/flat tendency), timing tendency (early/late), worst 3 notes highlighted, and a "practice this bit" button that loops those bars.
- History: scores per song/exercise over time, a trouble-note heatmap across the user's range, and practice streaks.

## Trainer content (beyond harmony)
- Range finder: guided low and high slides, shows range and an approximate voice type, then used to auto-transpose exercises into the user's range.
- Warm-ups: sirens with a guide curve, five-note scales, arpeggios, lip-trill/hum guides, stepping up and down by semitone.
- Pitch matching: app plays a tone, user matches it; adaptive difficulty.
- Interval sing-back: app plays a root, user sings the named interval above/below.
- Sustain/stability: hold a note; score steadiness and show a drift graph.
- Vibrato analysis: rate (Hz) and depth (cents) with a target band.
- Drone mode: a tonic drone for free tuning practice.
- Harmony lessons: a short progressive course (unison, then drones, 3rds, 6ths, 5ths, moving lines, partial harmony, stacking 3 parts), each with an explanation, a demo and a scored exercise. All demo melodies must be original or public domain; never include copyrighted songs.
- Practice tools everywhere: A-B loop, slow-down without pitch change, transpose, count-in, metronome.
- Later phase: import your own audio file, stem-separate the vocal on device, extract the melody to editable target bars, and harmonise over the instrumental. The user supplies their own files; the app ships none.

## Settings
Great defaults so a beginner never needs settings, plus a deep Settings area grouped clearly: Audio (input, route, calibration, AEC, input gain, noise gate), Pitch detection (algorithm sensitivity, smoothing, confidence threshold, octave-error correction), Display (scroll speed, zoom, note names/solfege/numbers, sharps/flats, A4 reference 415-466 Hz, colour themes, show cents, show the line only when confident, left-handed layout), Scoring (tolerances, presets, scoop ignore, timing weight), Harmony (default interval, diatonic vs chromatic, chord-aware on/off), Recording (count-in, metronome sound/volume, max layers, file format), Haptics, and reset to defaults. Each setting has a one-line explanation.

## Graphics and feel
This must look and feel top tier, the thing people screenshot. Dark-first design with a light theme. Smooth, physically pleasing motion; no jank. The pitch line is anti-aliased, with a short fading trail and a soft glow whose intensity reflects accuracy. Target bars are rounded capsules with clear colour states. Each layer has a distinct, accessible colour (colour-blind safe palette option). Crisp typography, generous spacing, satisfying micro-animations, an onboarding that gets the user singing within 30 seconds (mic permission, headphone tip, quick range check). Design an original icon and brand. Before shipping, review every screen in screenshots on small and large phones and tablets and fix anything that looks off.

## Quality bar
- Test on emulators/simulators for both platforms plus DSP unit tests. Profile frame times on the live monitor and keep them inside budget.
- Pitch detection must be stable on low male and high female voices, with octave errors rare. Build a test harness with synthetic and recorded vocal samples.
- Handle interruptions (calls, route changes, backgrounding) without crashing or losing takes. Autosave projects.
- Accessibility: dynamic type, screen-reader labels, sufficient contrast.

## Phases
1. Project setup, architecture, DSP core with tests, live monitor with polished graphics.
2. Record, segment, editable target bars, harmony generation, partial regions.
3. Overdub layers, headphone/speaker handling, latency calibration, scoring and summaries.
4. Trainer content (range, warm-ups, matching, intervals, sustain, vibrato, drone, lessons), history and streaks.
5. Settings, onboarding, themes, accessibility, full visual polish pass.
6. Audio and video export.
7. On-device stem separation and import flow.
8. Privacy/deletion pages on studymusictheory.com, store listings, screenshots, signed builds, upload to TestFlight and the Play internal track. Then stop and write a final report in PROGRESS.md: what is done, what to test, known issues, and the exact one-line instruction the owner can give to release publicly.
