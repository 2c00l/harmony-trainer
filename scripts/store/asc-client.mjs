import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

// Uses the owner's existing App Store Connect credentials. Never log the key or JWT.
const credentials=join(homedir(),'.appstoreconnect');
export async function asc(method,path,body){
 if(!path.startsWith('/v1/')&&!path.startsWith('/v2/'))throw Error('Expected an App Store Connect API path.');
 const keyId=process.env.ASC_KEY_ID||'59TLDRYTXN';
 const issuer=process.env.ASC_ISSUER_ID||JSON.parse(await readFile(join(credentials,'config.json'),'utf8')).issuerId;
 const key=process.env.ASC_KEY_CONTENT||await readFile(join(credentials,'private_keys',`AuthKey_${keyId}.p8`),'utf8');
 const now=Math.floor(Date.now()/1000),b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const unsigned=b64({alg:'ES256',kid:keyId,typ:'JWT'})+'.'+b64({iss:issuer,iat:now-30,exp:now+600,aud:'appstoreconnect-v1'});
 const token=unsigned+'.'+crypto.sign('sha256',Buffer.from(unsigned),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const response=await fetch('https://api.appstoreconnect.apple.com'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(`${method} ${path}: ${response.status} ${JSON.stringify(result.errors||[])}`);
 return result;
}
