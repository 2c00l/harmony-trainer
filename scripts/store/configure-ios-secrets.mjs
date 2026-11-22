import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const directory=join(homedir(),'.appstoreconnect');
const signing=JSON.parse(await readFile(new URL('../../artifacts/ios-signing.json',import.meta.url),'utf8'));
const config=JSON.parse(await readFile(join(directory,'config.json'),'utf8'));
const values={
 APPLE_TEAM_ID:signing.teamId,
 ASC_KEY_ID:'59TLDRYTXN',
 ASC_ISSUER_ID:config.issuerId,
 ASC_KEY_CONTENT:await readFile(join(directory,'private_keys','AuthKey_59TLDRYTXN.p8'),'utf8'),
 IOS_CERT_P12:(await readFile(join(directory,'smt-dist.p12'))).toString('base64'),
 IOS_CERT_PASSWORD:(await readFile(join(directory,'smt-dist.p12.pass'),'utf8')).trim(),
 IOS_PROFILE_B64:(await readFile(join(directory,'harmony-trainer-appstore.mobileprovision'))).toString('base64')
};
for(const [name,value] of Object.entries(values)){
 const result=spawnSync('gh',['secret','set',name,'--repo','2c00l/harmony-trainer'],{input:value,encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error('Could not configure '+name+': '+result.stderr);
 console.log('Configured '+name);
}
