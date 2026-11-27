# Decisions

## Current branding (2026-11-27)

The owner chose **PitchSense: Sing in Tune**, replacing Pitchline because that name was already in use. Store titles and native app labels use the full name; prose uses PitchSense. Version 1.0.2 carries the rename. Keep the existing `com.studymusictheory.pitchline` package/bundle ID, signing profiles and stored-data keys for update compatibility. Use `https://studymusictheory.com/pitchsense/` for new links and maintain updated pages under `/pitchline/` for existing installations and store links.

## D1 — Stack: Capacitor 8 + web (not Flutter + C++ FFI)
The owner said to reuse what is already set up rather than follow PROMPT.md literally. Every shipped app on this machine (StudyMusicTheory, Football Tactics Academy, QuizTarot, BCT…) is Capacitor 8 around vanilla ES modules. Football Tactics Academy has exactly this app's pricing model (Android free, iOS paid upfront), plus working scripts for signing, the iOS CI build, ASC/Play uploads, screenshot capture and policy pages. The machine has no Flutter, C++ compiler or Mac, and ~28 GB of free disk.
- UI: vanilla ES modules, no build step. Pitch graphics use Canvas 2D at devicePixelRatio and are drawn on requestAnimationFrame, so they run at the display refresh rate (60/120 Hz).
- DSP: pure JS modules (`www/dsp/*.mjs`), unit-tested with `node --test` on synthetic signals. They replace the C++ core. The FFT-based McLeod NSDF is fast enough in JS: a 2048-sample window takes well under 1 ms.
- Audio I/O: Web Audio. An AudioWorklet captures mic blocks with sample-accurate frame stamps. `getUserMedia` constraints handle echo cancellation (on in speaker mode, off with headphones) and noise suppression (always off, because it damages pitch).
- Native extras: a small local Capacitor plugin (`AudioRoute`) detects headphones, Bluetooth and speaker on Android and iOS.
- Trade-off: WebView audio latency is higher than Oboe/AVAudioEngine. The latency calibration wizard compensates for scoring and layer alignment. Real-time display latency (~30–80 ms) is acceptable for a pitch line.

## D2 — IDs and slugs
- Package/bundle: `com.studymusictheory.harmonytrainer`
- Web slug: `harmony-trainer` → studymusictheory.com/harmony-trainer/privacy and /delete-data

## D3 — App name candidates (owner to pick; working title "Harmony Trainer")
1. **Thirdline**: sing the line a third away.
2. **Vocalayer**: stack your own voice in layers.
3. **Duet Self**: harmonise with yourself.
4. **Overtune**: tune over your own takes.
5. **Chorusmith**: craft harmony parts by ear.

## D4 — Brand
Original palette: deep ink background (#0B0F1A), aurora accents (teal #3EE6C1, violet #8B7CFF, coral #FF7A6B, amber #FFC857). The icon is two offset glowing pitch curves over a capsule bar. It does not resemble any existing singing app.

## D5 — Storage
Projects and audio go in IndexedDB (Float32 PCM per take) with `navigator.storage.persist()`. Settings go in localStorage. There is no network access at all. Projects autosave after every edit and every finished take.
