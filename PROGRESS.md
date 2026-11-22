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

## Next step
Phase 8: store screenshots, Play app record + internal upload, iOS bundle/profile/app record, GitHub repo + iOS CI → TestFlight.
