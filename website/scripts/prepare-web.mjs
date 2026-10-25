import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
await rm('public',{recursive:true,force:true});
await mkdir('public',{recursive:true});
await cp('web','public',{recursive:true});
console.log('Prepared map assets.');

try{const local=await readFile('.env.local','utf8');await writeFile('.dev.vars',local,{mode:0o600});}catch(error){if(error.code!=='ENOENT')throw error;}
