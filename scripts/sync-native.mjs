import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const result=spawnSync(process.execPath,[resolve(root,'node_modules/@capacitor/cli/bin/capacitor'),'sync'],{cwd:root,stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
// Capacitor generates Windows separators in local SPM package paths on Windows.
// Swift paths must remain valid when the project is opened on macOS.
const file=resolve(root,'ios/App/CapApp-SPM/Package.swift');
const text=await readFile(file,'utf8');
await writeFile(file,text.replace(/path: "([^"\n]+)"/g,(_,path)=>`path: "${path.replaceAll('\\','/')}"`));
console.log('Native assets synced; local Swift package paths normalised for macOS.');
