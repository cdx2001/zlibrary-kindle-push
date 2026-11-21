import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from './build.mjs';
export async function releaseFiles() {
  const files=[];
  const names=['README.md','LICENSE','SECURITY.md','CONTRIBUTING.md','CHANGELOG.md','package.json','package-lock.json','project.config.json','wrangler.jsonc','.dev.vars.example','.gitignore','.gitattributes','.node-version'];
  const visit=async relative=>{
    const full=path.join(root,relative),stat=await fs.lstat(full);
    if(stat.isSymbolicLink())throw new Error('Do not release symlinks: '+relative);
    if(stat.isDirectory()){for(const name of await fs.readdir(full))await visit(path.join(relative,name));}
    else files.push(relative.replaceAll('\\','/'));
  };
  for(const item of [...names,'src','scripts','test','docs','tools','install','.github'])await visit(item);
  return files.sort();
}
