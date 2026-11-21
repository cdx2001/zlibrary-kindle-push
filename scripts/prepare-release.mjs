import fs from 'node:fs/promises';
import path from 'node:path';
import { root, build } from './build.mjs';
const repo=process.argv[2];
if(!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo||'') || /^OWNER\//i.test(repo)) {
  console.error('Usage: npm run release:prepare -- github-owner/repository-name');process.exit(1);
}
const url='https://github.com/'+repo;
const file=path.join(root,'README.md');
let readme=await fs.readFile(file,'utf8');
readme=readme.replace(/https:\/\/deploy\.workers\.cloudflare\.com\/\?url=https:\/\/github\.com\/[^\s)"'<>]+/g,'https://deploy.workers.cloudflare.com/?url='+url);
readme=readme.replace(/https:\/\/raw\.githubusercontent\.com\/[^/\s]+\/[^/\s]+\/main\/install\/zlibrary-kindle-push\.user\.js/g,url.replace('https://github.com/','https://raw.githubusercontent.com/')+'/main/install/zlibrary-kindle-push.user.js');
readme=readme.replace(/<!-- REVIEW-NOTICE-BEGIN -->[\s\S]*?<!-- REVIEW-NOTICE-END -->\s*/,'');
await fs.writeFile(file,readme);
const pkgPath=path.join(root,'package.json'),pkg=JSON.parse(await fs.readFile(pkgPath,'utf8'));
pkg.repository={type:'git',url:url+'.git'};pkg.bugs={url:url+'/issues'};
await fs.writeFile(pkgPath,JSON.stringify(pkg,null,2)+'\n');
await build();
console.log('Prepared deploy button and package metadata for '+url+'. No repository was created, pushed, or deployed.');
