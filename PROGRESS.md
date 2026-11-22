# Harmony Trainer: progress

Working title: Harmony Trainer · package/bundle `com.studymusictheory.harmonytrainer` · web slug `harmony-trainer`

## Phases
- [ ] 1. Setup, architecture, C++ DSP core + tests, live monitor (IN PROGRESS)
- [ ] 2. Record, segment, editable target bars, harmony generation, partial regions
- [ ] 3. Overdub layers, route handling, latency calibration, scoring + summaries
- [ ] 4. Trainer content, history, streaks
- [ ] 5. Settings, onboarding, themes, accessibility, polish
- [ ] 6. Audio + video export
- [ ] 7. Stem separation + import
- [ ] 8. Web pages, store listings, screenshots, signed builds, TestFlight + Play internal

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

## Next step
Phase 2: project studio screen (record melody → analyse → edit bars → harmony regions → sing/overdub → layers).
