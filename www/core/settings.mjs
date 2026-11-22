// Settings schema (single source of truth for defaults, UI and explanations).
const KEY = 'ht.settings.v1';

export const SCHEMA = [
  { group: 'Audio', icon: 'mic', items: [
    { id: 'audioMode', label: 'Listening mode', type: 'choice', def: 'auto', options: [['auto', 'Automatic'], ['headphones', 'Headphones'], ['speaker', 'Speaker']], help: 'Automatic detects headphones. Speaker mode turns on echo cancellation.' },
    { id: 'aec', label: 'Echo cancellation on speaker', type: 'bool', def: true, help: 'Stops the app hearing its own playback when you are not wearing headphones.' },
    { id: 'playbackReject', label: 'Ignore playback bleed', type: 'bool', def: true, help: 'On speaker, discounts uncertain pitches that match what is playing.' },
    { id: 'inputGain', label: 'Input gain', type: 'range', def: 1, min: 0.25, max: 4, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, help: 'Boosts or reduces the microphone level before pitch detection.' },
    { id: 'noiseGate', label: 'Noise gate', type: 'range', def: 0.006, min: 0.001, max: 0.05, step: 0.001, fmt: (v) => `${Math.round(20 * Math.log10(v))} dB`, help: 'Sounds quieter than this are ignored. Raise it in noisy rooms.' },
    { id: 'calibrate', label: 'Latency calibration', type: 'action', action: 'calibrate', help: 'Measures your device delay so scores and layers line up.' },
  ] },
  { group: 'Pitch detection', icon: 'wave', items: [
    { id: 'clarity', label: 'Confidence threshold', type: 'range', def: 0.62, min: 0.4, max: 0.9, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`, help: 'How sure the detector must be before it draws a pitch.' },
    { id: 'smoothing', label: 'Smoothing', type: 'range', def: 0.35, min: 0, max: 0.85, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, help: 'Higher values give a calmer line; lower values react faster.' },
    { id: 'octaveFix', label: 'Octave-error correction', type: 'bool', def: true, help: 'Prevents the line jumping an octave on breathy or low notes.' },
    { id: 'voiceRange', label: 'Detection range', type: 'choice', def: 'full', options: [['full', 'Full (C2–C7)'], ['low', 'Low voices'], ['high', 'High voices']], help: 'Narrowing the range can steady detection at the extremes.' },
  ] },
  { group: 'Display', icon: 'eye', items: [
    { id: 'theme', label: 'Theme', type: 'choice', def: 'dark', options: [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], help: 'Dark is easiest on the eyes while singing.' },
    { id: 'palette', label: 'Layer colours', type: 'choice', def: 'aurora', options: [['aurora', 'Aurora'], ['cb', 'Colour-blind safe']], help: 'Colour-blind safe uses a palette distinguishable with all common colour vision types.' },
    { id: 'scrollSpeed', label: 'Scroll speed', type: 'range', def: 1, min: 0.5, max: 2, step: 0.1, fmt: (v) => `${v.toFixed(1)}×`, help: 'How fast the piano roll moves past.' },
    { id: 'zoom', label: 'Vertical zoom', type: 'range', def: 14, min: 7, max: 30, step: 1, fmt: (v) => `${v} notes`, help: 'Number of semitones visible at once.' },
    { id: 'labels', label: 'Note names', type: 'choice', def: 'letter', options: [['letter', 'C D E'], ['solfege', 'Do Re Mi'], ['number', '1 2 3']], help: 'How notes are named on the roll and in readouts.' },
    { id: 'accidentals', label: 'Sharps or flats', type: 'choice', def: 'auto', options: [['auto', 'By key'], ['sharp', '♯'], ['flat', '♭']], help: 'Spelling of black-key notes.' },
    { id: 'a4', label: 'A4 reference', type: 'range', def: 440, min: 415, max: 466, step: 1, fmt: (v) => `${v} Hz`, help: 'Tuning reference. 440 Hz is standard; 415 Hz is baroque pitch.' },
    { id: 'showCents', label: 'Show cents', type: 'bool', def: true, help: 'Displays how many cents sharp or flat you are.' },
    { id: 'confidentOnly', label: 'Line only when confident', type: 'bool', def: true, help: 'Hides the pitch line during breaths and noise.' },
    { id: 'leftHanded', label: 'Left-handed layout', type: 'bool', def: false, help: 'Moves note names and main controls to the other side.' },
    { id: 'reduceMotion', label: 'Reduce motion', type: 'choice', def: 'system', options: [['system', 'System'], ['on', 'On'], ['off', 'Off']], help: 'Turns off particle bursts and large animations.' },
  ] },
  { group: 'Scoring', icon: 'target', items: [
    { id: 'preset', label: 'Difficulty', type: 'choice', def: 'normal', options: [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['pro', 'Pro'], ['custom', 'Custom']], help: 'Sets all tolerances at once.' },
    { id: 'tolPerfect', label: 'Perfect within', type: 'range', def: 15, min: 3, max: 40, step: 1, fmt: (v) => `±${v}¢`, help: 'Cents window for a Perfect.', custom: true },
    { id: 'tolGood', label: 'Good within', type: 'range', def: 35, min: 8, max: 70, step: 1, fmt: (v) => `±${v}¢`, help: 'Cents window for a Good.', custom: true },
    { id: 'tolOk', label: 'OK within', type: 'range', def: 50, min: 15, max: 100, step: 1, fmt: (v) => `±${v}¢`, help: 'Anything further out is a Miss.', custom: true },
    { id: 'scoopIgnore', label: 'Ignore note onsets', type: 'range', def: 80, min: 0, max: 250, step: 10, fmt: (v) => `${v} ms`, help: 'Forgives scoops into a note for this long.' },
    { id: 'timingWeight', label: 'Timing weight', type: 'range', def: 0.2, min: 0, max: 0.6, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, help: 'How much starting on time counts toward the score.' },
    { id: 'octaveFree', label: 'Any octave counts', type: 'bool', def: true, help: 'Lets you sing a part an octave up or down to suit your voice.' },
  ] },
  { group: 'Harmony', icon: 'layers', items: [
    { id: 'defaultHarmony', label: 'Default harmony', type: 'choice', def: 'third_above', options: [['third_above', '3rd above'], ['third_below', '3rd below'], ['sixth_below', '6th below'], ['fifth_above', '5th above'], ['octave_below', 'Octave below'], ['unison', 'Unison']], help: 'Used when you start a new harmony part.' },
    { id: 'diatonic', label: 'Stay in key', type: 'bool', def: true, help: 'Harmony notes follow the scale, so thirds become major or minor automatically.' },
    { id: 'chordAware', label: 'Chord-aware harmony', type: 'bool', def: false, help: 'Uses a chord per bar and prefers chord tones.' },
    { id: 'guideTones', label: 'Play guide tones', type: 'bool', def: true, help: 'Plays your target notes softly so you can hear the part.' },
  ] },
  { group: 'Recording', icon: 'record', items: [
    { id: 'countIn', label: 'Count-in', type: 'choice', def: '1', options: [['0', 'Off'], ['1', '1 bar'], ['2', '2 bars']], help: 'Clicks before recording starts.' },
    { id: 'metronome', label: 'Metronome while recording', type: 'bool', def: false, help: 'Keeps a click going while you sing.' },
    { id: 'clickSound', label: 'Click sound', type: 'choice', def: 'wood', options: [['wood', 'Woodblock'], ['beep', 'Beep'], ['soft', 'Soft tick']], help: 'Sound of the metronome and count-in.' },
    { id: 'clickVolume', label: 'Click volume', type: 'range', def: 0.6, min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, help: 'Loudness of the metronome.' },
    { id: 'maxLayers', label: 'Maximum layers', type: 'range', def: 6, min: 2, max: 8, step: 1, fmt: (v) => `${v}`, help: 'How many takes a project can stack.' },
    { id: 'exportFormat', label: 'Audio export format', type: 'choice', def: 'wav', options: [['wav', 'WAV (lossless)'], ['m4a', 'M4A (smaller)']], help: 'File type used when you export audio.' },
  ] },
  { group: 'Feel', icon: 'spark', items: [
    { id: 'haptics', label: 'Haptics', type: 'bool', def: true, help: 'A gentle tap when you hold a note perfectly.' },
    { id: 'particles', label: 'Perfect-hold sparkle', type: 'bool', def: true, help: 'A small burst when you nail a note.' },
    { id: 'reset', label: 'Reset all settings', type: 'action', action: 'reset', help: 'Restores every setting to its default. Projects are kept.' },
  ] },
];

export const DEFAULTS = Object.fromEntries(SCHEMA.flatMap((g) => g.items.filter((i) => i.type !== 'action').map((i) => [i.id, i.def])));

let current = load();
const subs = new Set();

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage blocked: keep in memory */ } }

export const settings = {
  get: (k) => current[k],
  all: () => ({ ...current }),
  set(k, v) {
    current[k] = v;
    if (k === 'preset' && v !== 'custom') {
      const P = { easy: [25, 50, 80], normal: [15, 35, 50], hard: [10, 25, 40], pro: [6, 15, 28] }[v];
      [current.tolPerfect, current.tolGood, current.tolOk] = P;
    }
    if (['tolPerfect', 'tolGood', 'tolOk'].includes(k)) current.preset = 'custom';
    save();
    subs.forEach((f) => f(k, v));
  },
  reset() { current = { ...DEFAULTS, onboarded: current.onboarded, range: current.range, latency: current.latency }; save(); subs.forEach((f) => f('*')); },
  on(f) { subs.add(f); return () => subs.delete(f); },
  // non-schema persisted values (onboarding, range, latency map)
  meta(k, v) { if (v === undefined) return current[k]; current[k] = v; save(); },
};

export function scoringOpts() {
  const s = current;
  return { perfect: s.tolPerfect, good: s.tolGood, ok: s.tolOk, scoopIgnore: s.scoopIgnore / 1000, timingWeight: s.timingWeight, octaveFree: s.octaveFree };
}

export function detectRange() {
  return { full: [62, 2100], low: [55, 700], high: [140, 2100] }[current.voiceRange] || [62, 2100];
}

export function prefersReducedMotion() {
  const v = current.reduceMotion;
  if (v === 'on') return true;
  if (v === 'off') return false;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
