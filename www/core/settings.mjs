// Settings schema (single source of truth for defaults, UI and explanations).
const KEY = 'ht.settings.v1';

export const HARMONY_OPTIONS = [
  ['third_above', '3rd above'], ['third_below', '3rd below'], ['fourth_above', '4th above'], ['fourth_below', '4th below'],
  ['fifth_above', '5th above'], ['fifth_below', '5th below'], ['sixth_above', '6th above'], ['sixth_below', '6th below'],
  ['octave_above', 'Octave above'], ['octave_below', 'Octave below'], ['unison', 'Unison (same notes)'],
];

export const SCHEMA = [
  { group: 'Harmony', icon: 'layers', items: [
    { id: 'harmonyType', label: 'Harmony part', type: 'choice', def: 'third_above', options: HARMONY_OPTIONS, help: 'Which harmony is written against the melody. A 3rd above is the most common.' },
    { id: 'harmonyOctave', label: 'Octave', type: 'choice', def: 'same', options: [['same', 'As written'], ['up', 'Octave up'], ['down', 'Octave down']], help: 'Moves the whole harmony part up or down an octave to suit your voice.' },
    { id: 'diatonic', label: 'Stay in key', type: 'bool', def: true, help: 'On: every harmony note is taken from the song’s scale, so it always fits the music. Off: the harmony copies the melody’s exact shape, which can land on notes that clash.' },
  ] },
  { group: 'Playback', icon: 'play', items: [
    { id: 'showHarmony', label: 'Show harmony', type: 'bool', def: true, help: 'Draws the harmony notes as coloured bars.' },
    { id: 'playVocal', label: 'Play the vocal', type: 'bool', def: true, help: 'Turn off to sing over just the music, or over silence.' },
    { id: 'playMusic', label: 'Play the music', type: 'bool', def: false, help: 'For imported songs: plays the instrumental under the vocal.' },
    { id: 'vocalVolume', label: 'Vocal volume', type: 'range', def: 0.9, min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, help: 'Loudness of the recorded or isolated vocal.' },
    { id: 'musicVolume', label: 'Music volume', type: 'range', def: 0.7, min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, help: 'Loudness of the instrumental.' },
    { id: 'takeVolume', label: 'My recording volume', type: 'range', def: 1, min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, help: 'Loudness of your own recorded take when you play it back.' },
    { id: 'recordPastEnd', label: 'Keep recording after the song ends', type: 'bool', def: false, help: 'When you sing along and record, carry on after the song finishes until you tap stop.' },
    { id: 'singAlong', label: 'Show my voice while playing', type: 'bool', def: true, help: 'Keeps the microphone on during playback so you can see yourself against the harmony.' },
  ] },
  { group: 'Home screen', icon: 'wave', items: [
    { id: 'hideAddBox', label: 'Always hide the Add vocals box', type: 'bool', def: false, help: 'Gives the live pitch the whole screen. You can still add vocals from the + button.' },
  ] },
  { group: 'Display', icon: 'eye', items: [
    { id: 'theme', label: 'Theme', type: 'choice', def: 'dark', options: [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], help: 'Dark is easiest on the eyes while singing.' },
    { id: 'labels', label: 'Note names', type: 'choice', def: 'letter', options: [['letter', 'C D E'], ['solfege', 'Do Re Mi'], ['number', '1 2 3']], help: 'How notes are named on the screen.' },
    { id: 'accidentals', label: 'Sharps or flats', type: 'choice', def: 'auto', options: [['auto', 'By key'], ['sharp', '♯'], ['flat', '♭']], help: 'Spelling of black-key notes.' },
    { id: 'barLabels', label: 'Note names on the bars', type: 'bool', def: true, help: 'Writes the note name inside each melody and harmony bar.' },
    { id: 'zoom', label: 'Notes on the Live screen', type: 'range', def: 30, min: 7, max: 30, step: 1, fmt: (v) => `${v}`, help: 'How many notes the Live screen shows at once. Fewer makes them bigger. (In a song the view zooms to fit the part by itself.)' },
    { id: 'scrollSpeed', label: 'Scroll speed', type: 'range', def: 0.5, min: 0.5, max: 2, step: 0.1, fmt: (v) => `${v.toFixed(1)}×`, help: 'How fast the notes move past.' },
    { id: 'showCents', label: 'Show cents', type: 'bool', def: true, help: 'Shows how many cents sharp or flat you are.' },
    { id: 'a4', label: 'A4 reference', type: 'range', def: 440, min: 415, max: 466, step: 1, fmt: (v) => `${v} Hz`, help: 'Tuning reference. 440 Hz is standard.' },
    { id: 'leftHanded', label: 'Left-handed layout', type: 'bool', def: false, help: 'Moves note names to the other side.' },
  ] },
  { group: 'Accessibility', icon: 'info', items: [
    { id: 'textSize', label: 'Text size', type: 'choice', def: 'normal', options: [['normal', 'Normal'], ['large', 'Large'], ['xl', 'Extra large']], help: 'Makes all text and buttons bigger.' },
    { id: 'contrast', label: 'High contrast', type: 'bool', def: false, help: 'Stronger colours and outlines.' },
    { id: 'palette', label: 'Colour-blind safe colours', type: 'choice', def: 'aurora', options: [['aurora', 'Standard'], ['cb', 'Colour-blind safe']], help: 'Colours that stay distinct for all common types of colour blindness.' },
    { id: 'reduceMotion', label: 'Reduce motion', type: 'choice', def: 'system', options: [['system', 'System'], ['on', 'On'], ['off', 'Off']], help: 'Turns off big animations.' },
    { id: 'announce', label: 'Spoken feedback', type: 'bool', def: true, help: 'With a screen reader on, announces the note you are singing.' },
    { id: 'haptics', label: 'Haptics', type: 'bool', def: true, help: 'Gentle taps on buttons.' },
    { id: 'infoButtons', label: 'Show (i) help buttons', type: 'bool', def: true, help: 'Small buttons that explain things. Turn off once you know your way around.' },
    { id: 'shortcuts', label: 'Gestures and keyboard shortcuts', type: 'action', action: 'shortcuts', help: 'Swipe from the left edge to go back, plus keyboard keys.' },
  ] },
  { group: 'Microphone', icon: 'mic', items: [
    { id: 'audioMode', label: 'Listening mode', type: 'choice', def: 'auto', options: [['auto', 'Automatic'], ['headphones', 'Headphones'], ['speaker', 'Speaker']], help: 'Automatic detects headphones. Speaker mode turns on echo cancellation.' },
    { id: 'aec', label: 'Echo cancellation on speaker', type: 'bool', def: true, help: 'Stops the app hearing its own playback when you are not wearing headphones.' },
    { id: 'playbackReject', label: 'Ignore playback bleed', type: 'bool', def: true, help: 'On speaker, ignores uncertain pitches that match the vocal being played.' },
    { id: 'inputGain', label: 'Input gain', type: 'range', def: 1, min: 0.25, max: 4, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, help: 'Boosts or reduces the microphone level.' },
    { id: 'noiseGate', label: 'Noise gate', type: 'range', def: 0.006, min: 0.001, max: 0.05, step: 0.001, fmt: (v) => `${Math.round(20 * Math.log10(v))} dB`, help: 'Sounds quieter than this are ignored. Raise it in noisy rooms.' },
    { id: 'clarity', label: 'Confidence threshold', type: 'range', def: 0.62, min: 0.4, max: 0.9, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`, help: 'How sure the detector must be before it draws a pitch.' },
    { id: 'smoothing', label: 'Smoothing', type: 'range', def: 0.35, min: 0, max: 0.85, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, help: 'Higher gives a calmer line; lower reacts faster.' },
    { id: 'octaveFix', label: 'Octave-error correction', type: 'bool', def: true, help: 'Stops the line jumping an octave on breathy or low notes.' },
    { id: 'voiceRange', label: 'Detection range', type: 'choice', def: 'full', options: [['full', 'Full (C2–C7)'], ['low', 'Low voices'], ['high', 'High voices']], help: 'Narrowing the range can steady detection.' },
    { id: 'confidentOnly', label: 'Line only when confident', type: 'bool', def: true, help: 'Hides the pitch line during breaths and noise.' },
    { id: 'reset', label: 'Reset all settings', type: 'action', action: 'reset', help: 'Restores every setting to its default. Songs are kept.' },
  ] },
];

export const DEFAULTS = Object.fromEntries(SCHEMA.flatMap((g) => g.items.filter((i) => i.type !== 'action').map((i) => [i.id, i.def])));

// v2 changed some defaults: move people still on the old default to the new one
const VERSION = 2;
const OLD_DEFAULTS = { 2: { zoom: 14, scrollSpeed: 1 } };
let current = load();
const subs = new Set();

function load() {
  let s;
  try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS, _v: VERSION }; }
  for (let v = (s._v || 1) + 1; v <= VERSION; v++) for (const [k, old] of Object.entries(OLD_DEFAULTS[v] || {})) if (s[k] === old) s[k] = DEFAULTS[k];
  s._v = VERSION;
  return s;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage blocked: keep in memory */ } }

export const settings = {
  get: (k) => current[k],
  all: () => ({ ...current }),
  set(k, v) {
    current[k] = v;
    save();
    subs.forEach((f) => f(k, v));
  },
  reset() { current = { ...DEFAULTS, _v: VERSION, onboarded: current.onboarded, micOk: current.micOk, latency: current.latency }; save(); subs.forEach((f) => f('*')); },
  on(f) { subs.add(f); return () => subs.delete(f); },
  // non-schema persisted values (onboarding, range, latency map)
  meta(k, v) { if (v === undefined) return current[k]; current[k] = v; save(); },
};

export function detectRange() {
  return { full: [62, 2100], low: [55, 700], high: [140, 2100] }[current.voiceRange] || [62, 2100];
}

export function prefersReducedMotion() {
  const v = current.reduceMotion;
  if (v === 'on') return true;
  if (v === 'off') return false;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
