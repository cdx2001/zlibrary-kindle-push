import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
for(const key of ['API_TOKEN','SMTP_USER','SMTP_AUTH_CODE','KINDLE_EMAIL']) {
  console.log(`Configure ${key} using Wrangler's private input prompt.`);
  const result=spawnSync(process.execPath,[cli,'secret','put',key],{cwd:root,stdio:'inherit',shell:false});
  if(result.error || result.status!==0)process.exit(result.status||1);
}
