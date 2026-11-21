import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function validateSettings(settings) {
  if (!settings || Object.keys(settings).some(k=>k!=='maxFileMB') ||
      !Number.isInteger(settings.maxFileMB) || settings.maxFileMB < 1 || settings.maxFileMB > 50) {
    throw new Error('project.config.json must contain only maxFileMB: integer 1–50. Do not put secrets here.');
  }
  return settings;
}
export async function build({settings:override,outputDir='dist'}={}) {
  const settings=validateSettings(override ?? JSON.parse(await fs.readFile(path.join(root,'project.config.json'),'utf8')));
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw new Error('Use a numeric major.minor.patch package version.');
  const max=settings.maxFileMB*1_000_000;
  const values={__VERSION__:pkg.version,__MAX_MB__:String(settings.maxFileMB),__MAX_BYTES__:String(max),
    __MAX_BYTES_LABEL__:max.toLocaleString('en-US'),__MIME_MB__:(max*4/3*78/76/1e6).toFixed(1)};
  const expand=s=>s.replace(/\r\n/g,'\n').replace(/__(?:VERSION|MAX_MB|MAX_BYTES|MAX_BYTES_LABEL|MIME_MB)__/g,key=>values[key]);
  const script=expand(await fs.readFile(path.join(root,'src/userscript.template.js'),'utf8'));
  const repository=pkg.repository?.url?.replace(/\.git$/,'');
  if(!/^https:\/\/github\.com\/[a-z0-9-]+\/[a-z0-9._-]+$/i.test(repository||''))throw new Error('Set a GitHub repository using release:prepare before building.');
  const installerUrl=repository.replace('https://github.com/','https://raw.githubusercontent.com/')+'/main/install/zlibrary-kindle-push.user.js';
  const prefix=expand(await fs.readFile(path.join(root,'src/installer-prefix.js'),'utf8')).replaceAll('__PROJECT_URL__',repository);
  const serviceLine="  const SERVICE = '__SERVICE_ORIGIN__';";
  if(!script.includes(serviceLine))throw new Error('Missing installer service insertion point');
  const installer=script.replace(serviceLine,()=>prefix+"\n  const SERVICE = resolveService();\n  if (!SERVICE) return;")
    .replace(/^\/\/ @downloadURL.*$/m,'// @downloadURL  '+installerUrl)
    .replace(/^\/\/ @homepageURL.*$/m,'// @homepageURL  '+repository);
  if(installer.includes('__SERVICE_ORIGIN__'))throw new Error('Unresolved installer placeholder');
  const setupJs=expand(await fs.readFile(path.join(root,'src/setup.js'),'utf8'));
  const setupHtml=expand(await fs.readFile(path.join(root,'src/setup.html'),'utf8')).replace('__SETUP_SCRIPT__',()=>setupJs.replace(/<\/script/gi,'<\\/script'));
  let worker=expand(await fs.readFile(path.join(root,'src/worker.template.js'),'utf8'));
  worker+='\nconst SETUP_HTML = '+JSON.stringify(setupHtml)+';\n';
  worker+='\n// Generated from src/userscript.template.js. No credentials are embedded.\nconst USERSCRIPT_TEMPLATE = '+JSON.stringify(script)+';\n';
  worker+=`export function renderUserscript(origin) {
    const url=new URL(origin);
    if(url.protocol!=='https:' || url.origin!==origin || !/^[a-z0-9.-]+$/i.test(url.hostname))throw new Error('Invalid service origin');
    return USERSCRIPT_TEMPLATE.replaceAll('__SERVICE_ORIGIN__', origin);
  }\n`;
  await fs.mkdir(path.join(root,outputDir),{recursive:true});
  await fs.writeFile(path.join(root,outputDir,'worker.js'),worker);
  if(outputDir==='dist'){
    await fs.mkdir(path.join(root,'install'),{recursive:true});
    await fs.writeFile(path.join(root,'install/zlibrary-kindle-push.user.js'),installer);
  }
  return {script,installer,worker,settings,version:pkg.version,setupHtml};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await build();console.log(`Built v${result.version}; ${result.settings.maxFileMB} MB. Service origin is detected at runtime.`);
}
