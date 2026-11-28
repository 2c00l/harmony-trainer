import test from 'node:test';
import assert from 'node:assert/strict';
let id = 0;
async function load(value) {
  let stored = JSON.stringify(value);
  globalThis.localStorage = { getItem: () => stored, setItem: (_,v) => { stored = v; } };
  return (await import(`../www/core/settings.mjs?settings-test=${id++}`)).settings;
}
test('existing default volumes and Android call processing migrate; custom levels and data stay intact', async () => {
  const old = await load({ _v:2, vocalVolume:.9, musicVolume:.7, takeVolume:1, aec:true, onboarded:true, micOk:true, latency:{wired:.05} });
  assert.equal(old.get('vocalVolume'),.35); assert.equal(old.get('musicVolume'),.5); assert.equal(old.get('takeVolume'),1.25); assert.equal(old.get('aec'),false);
  assert.equal(old.meta('micOk'),true); assert.deepEqual(old.meta('latency'),{wired:.05});
  const custom = await load({ _v:2, vocalVolume:.6, musicVolume:0, takeVolume:1.5, aec:false });
  assert.equal(custom.get('vocalVolume'),.6); assert.equal(custom.get('musicVolume'),0); assert.equal(custom.get('takeVolume'),1.5);
  custom.set('vocalVolume',.45);
  const again = (await import(`../www/core/settings.mjs?settings-test=${id++}`)).settings;
  assert.equal(again.get('vocalVolume'),.45);
  again.reset(); assert.equal(again.get('vocalVolume'),.35); assert.equal(again.get('aec'),false);
});
