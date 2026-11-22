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

## Owner feedback round 2 (2026-11-22): strip back
- Removed: Train, Learn, Progress, scoring, warm-ups, lessons, drone, calibration, Mix/layers, export, Fast separation.
- App opens on Live pitch; bottom "Add vocals" box (Record my voice / Import a song), hideable (Settings → Home screen).
- Song player (/project/:id, /project/new records first): play starts instantly from the playhead; opens just before the first sung note; drag notes / slider / ±5 s to seek; tickboxes Show harmony · Play harmony (piano) · Vocal · Music.
- Harmony settings: 11 types, octave up/down, stay in key (Settings → Harmony and on-screen Harmony button).
- Piano synth (engine.mjs pianoBuffer) replaces the old guide tone.
- Live view steadiness: tracker spike/blip rejection (jumpConfirm/onsetConfirm), roll follows a 0.4 s median with dead zone.
- Playback auto-zooms to the notes around the playhead.
- Stray-note filter (dropOutliers) fixes occasional shrill wrong notes; applied to old songs on open.
- Test APK: ~/Downloads/HarmonyTrainer-1.0.0-test2.apk (verified booting to Live on emulator). Tests 19/19.

## Owner feedback round 3 (2026-11-22)
- Player dock shrinks to one slim row (stop + time) while playing or recording.
- "Play harmony" (piano guide) removed, with its setting and the P shortcut.
- Transpose −7…+7 semitones: WSOLA pitch shift in a worker (www/audio/shift-worker.mjs, dsp/stretch.mjs restored and sped up ~50×). Notes, harmony, key and labels follow. Saved per song.
- Sing along and record: red button plays the song and records you; takes saved per song (p.takes), "My take" tickbox, Takes sheet to choose/delete, R shortcut. Take pitch line drawn in coral.
- New gear icon for Settings; folder icon for My songs.
- Settings audit: scripts/settings-check.mjs checks every control saves and every value has its effect (63/63). Fixed: mic could start after leaving Live; mic now off during playback when "Show my voice" is off; spoken feedback setting now also covers the live note readout; solfège uses flat syllables (Ra, Me…) when flats are chosen.
- QA sweep clean (fixed Import button overflow at 360 px). Tests 22/22.
- Test APK: ~/Downloads/HarmonyTrainer-1.0.0-test3.apk (signed via scripts/store/build-android-release.ps1; verified on emulator).

## Owner feedback round 4 (2026-11-22)
- Import runs in the background (core/importer.mjs): slim progress bar along the bottom of every screen with time left; "Open" when ready. First import explains it (≈3 min per minute of song, everything on the phone, nothing uploaded or stored on a server). Import screen/route removed.
- Transposed audio is saved per song (p.shiftKeys, deleted with the song); mic stays ready between plays → play starts in ~40 ms.
- Export (share icon in the player): Video (9:16 MP4), Audio M4A, Audio WAV; choose Vocal / Music / My take. mp4-muxer vendored again.
- Note names on melody and harmony bars (setting "Note names on the bars", on). New defaults: scroll speed 0.5×, Live notes on screen 30 (settings migration v2 moves old defaults).
- Tests 22/22, settings check 64/64, QA clean. APK: ~/Downloads/HarmonyTrainer-1.0.0-test4.apk.
- Round 4b: "Record the melody again" in the player (replaces the melody and its audio, keeps takes, can cancel); new setting "Keep recording after the song ends" (off); clearer message after recording. Recording flows covered by scripts/flow-recording.mjs. Settings check 65/65. APK: ~/Downloads/HarmonyTrainer-1.0.0-test5.apk.

## Round 5: deep bug and usability pass (2026-11-22)
- Player top bar: back, name, key, export, ⋯ (help, settings, rename, find the notes again, record the melody again, delete). Name no longer squeezed out on small phones.
- Notes get the screen: option rows swipe sideways instead of wrapping; fold arrow hides all but play/slider (80% of the height for notes); top bar hides while playing/recording (93%). Landscape: side panel of controls; while playing the notes fill the screen with a floating stop button.
- "Find the notes again" re-analyses the stored vocal with current mic settings (no re-isolation).
- Fixed: transposition jobs mixing amounts when tapping +/− quickly (wrong audio saved); stale transposed copies left behind; deleting a song could bring it back (pending/exit autosave); seeking or tapping the notes mid-take split the take; double tap on Record; mic failure on Record gave no message; Hz readout disagreeing with the note; silent play with every part off now explains; headphones tip once per session; model download tries the CORS-enabled mirror first; video export 720p/3.5 Mbps to stay within phone memory; takes show the transpose they were sung at.
- QA now includes a seeded song, landscape and Extra-large text, and fails if the notes get <40% of the height. All clean; settings 65/65; tests 22/22.
- APK: ~/Downloads/HarmonyTrainer-1.0.0-test6.apk
