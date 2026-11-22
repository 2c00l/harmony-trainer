# Harmony Trainer: progress

Working title: Harmony Trainer · package/bundle `com.studymusictheory.harmonytrainer` · web slug `harmony-trainer`

## Phases
- [x] 1. Setup, architecture, DSP core + tests, live monitor
- [x] 2. Record, segment, editable target bars, harmony generation, partial regions
- [x] 3. Overdub layers, route handling (native AudioRoute plugin), latency calibration, scoring + summaries
- [x] 4. Trainers (range, warm-ups, match, intervals, sustain, vibrato, drone), 8-lesson course, history/streaks/heatmap
- [x] 5. Settings (schema-driven, every item explained), onboarding, themes (dark/light/colour-blind), a11y basics
- [x] 6. Audio (WAV/M4A) + 9:16 video export (WebCodecs H.264+AAC → MP4; MediaRecorder fallback)
- [x] 7. Import + on-device separation (Fast DSP / Quality Spleeter ONNX via onnxruntime-web, model downloaded on first use)
- [ ] 8. Web pages (DONE, staged in web/ + artifacts/harmony-trainer-web-pages.zip), store listings, screenshots, signed builds, uploads (IN PROGRESS)

## Environment findings (2026-11-22)
- Windows 11, no Mac. iOS builds via GitHub Actions macOS runner + fastlane (pattern from ~/Projects/studymusictheory-android-complete/.github/workflows/ios.yml and ios/App/fastlane/Fastfile).
- ASC API key: ~/.appstoreconnect/private_keys/AuthKey_*.p8, config.json; scripts to reuse: ~/Projects/quiztarot/scripts/asc*.mjs.
- Play: service account ~/Keystores/play-service-account.json; script ~/Projects/quiztarot/scripts/play-publish.mjs; console bot play-console-bot.mjs for no-API bits.
- Flutter installed to ~/dev-tools/flutter (3.50.1). Android SDK at %LOCALAPPDATA%/Android/Sdk. JDK 21 = Android Studio JBR.
- Disk: ~28 GB free on C: (tight).

## Done so far
- Stack switched to Capacitor 8 + vanilla ES modules (owner: reuse existing setup) → DECISIONS.md D1. Flutter/Zig downloads abandoned.
- DSP core (www/dsp): FFT-MPM pitch + octave fix + tracker, segmentation, key detection, diatonic/chord-aware harmony, regions, scoring (+live), stability, vibrato, WSOLA stretch/pitch-shift. `npm test` → 17/17 pass (synthetic low-male/high-female vowels, weak-f0, noise).
- Audio engine (worklet capture, live pitch, recording/alignment, synced playback w/ loop/rate, guide tones, metronome, drone).
- UI shell, design system, roll renderer, SingView, home, monitor (verified end-to-end in headless Chrome with fake-mic WAV: artifacts/monitor.png).
- Test tooling: scripts/serve.mjs (port 4190), scripts/shot.mjs (Chrome + fake mic). NOTE: in Git Bash export MSYS_NO_PATHCONV=1 before passing /routes.

## Native
- Android: android/ (Capacitor), upload key ~/Keystores/harmony-trainer-upload.keystore (+ .secret DPAPI, + certificate .pem). Release build: scripts/store/build-android-release.ps1. Emulator AVD `ht-test` (port 5584, -gpu host). Native check: scripts/android-check.mjs → artifacts/android/.
- iOS: ios/ (Capacitor SPM), AppDelegate.swift holds audio session + AudioRoute plugin + AppViewController. PrivacyInfo.xcprivacy added. Needs Mac CI build.

## 2026-11-22 later: owner feedback round
- Owner: don't worry about GitHub billing; prep only. Repo 2c00l/harmony-trainer (private) pushed, iOS secrets set, workflow `.github/workflows/ios-release.yml`.
  When Actions minutes are available: `gh workflow run ios-release.yml -f upload=true` (needs the App Store Connect app record first).
- Deep bug hunt fixes: repeated-note onset timing, loop-pass scoring (take + live fill), concurrent startMic leak, iOS audio unlock on gesture,
  sink node leak, loop padding desync, speaker-bleed rejecting the singer's correct note, back/leave during a recording now keeps the take,
  5-min recording cap, no control changes mid-take, lesson preview freezing, count-in display in trainers, slider redraw mid-drag, drone/key crash,
  misleading "centred" stat with no hits.
- Streamlined UX: Home = one action + projects + "More ways to practise"; studio lands on Harmony after recording (key sheet only if ambiguous);
  tabs Harmony · Sing · Mix · Notes; extras behind "More" and "Practice tools" sheets.
- Accessibility: text size (L/XL), high contrast, colour-blind palette, reduce motion, spoken feedback (live region), perfect-note chime,
  swipe between tabs / edge-swipe back, keyboard shortcuts (? lists them), focus-trapped sheets with Esc, (i) help buttons (can be hidden in Settings).
- Test APK for the owner's phone: ~/Downloads/HarmonyTrainer-1.0.0-test.apk (release-signed with the upload key, versionCode 1).

## Next step
Waiting on owner: (1) OK to accept Play declarations + create Play app record (form pre-filled in the automation Chrome);
(2) sign in to App Store Connect in the automation Chrome (or create the app record); (3) GitHub Actions minutes for iOS builds.
Then: Play internal upload + listing, iOS build + TestFlight, store screenshots (pipeline: scripts/store/shots.mjs), web pages upload (artifacts/harmony-trainer-web-pages.zip → studymusictheory.com public_html).
