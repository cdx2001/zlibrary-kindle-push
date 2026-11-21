import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from './build.mjs';
import { releaseFiles } from './release-files.mjs';
const allowUnpublished=process.argv.includes('--allow-unpublished');
let failed=false;
const report=(file,reason)=>{console.error(file+': '+reason);failed=true;};
const files=await releaseFiles();
for(const file of files) {
  if(file.endsWith('.epub')){if(file!=='test/fixtures/sample.epub')report(file,'Only the original small fixture is allowed');continue;}
  if(/(?:^|\/)(?:\.env|\.dev\.vars)(?:$|\.)/.test(file)&&!file.endsWith('.example'))report(file,'Private environment file');
  if(/\.(?:log|eml|pem|key)$/i.test(file))report(file,'Private/log file type');
  const text=await fs.readFile(path.join(root,file),'utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))report(file,'Private key material');
  if(/[A-Z]:[\\/]Users[\\/]/i.test(text))report(file,'Personal machine path');
  if(file==='.dev.vars.example' && text.split(/\r?\n/).some(s=>s&&!s.startsWith('#')&&!/^[A-Z_]+=$/.test(s)))report(file,'Example must have empty secret values');
}
const readme=await fs.readFile(path.join(root,'README.md'),'utf8');
if(!allowUnpublished&&readme.includes('https://github.com/OWNER/'))report('README.md','Set actual repository with npm run release:prepare before publishing');
if(failed)process.exit(1);
console.log(`Release file checks passed (${files.length} files). ${allowUnpublished?'Unpublished repository placeholder allowed.':'Deploy button configured.'} Manual privacy review is still required.`);
