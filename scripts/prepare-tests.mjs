import fs from 'node:fs/promises';
import path from 'node:path';
import { build, root } from './build.mjs';
// Exercise the supported ceiling independently of the owner's production limit.
// Tests never overwrite dist/ or change project.config.json.
const {script,installer}=await build({settings:{maxFileMB:50},outputDir:'.test/build'});
await fs.mkdir(path.join(root,'.test'),{recursive:true});
await fs.writeFile(path.join(root,'.test/kindle-push.user.js'),script.replaceAll('__SERVICE_ORIGIN__','https://demo.example'));
await fs.writeFile(path.join(root,'.test/public-installer.user.js'),installer);
// Create large ZIP transport fixtures locally. They are not reading/Kindle-conversion samples.
const small=await fs.readFile(path.join(root,'test/fixtures/sample.epub'));
function paddedZip(size) {
  const pad=size-small.length;
  const end=small.length-22;
  if(pad<0||small.readUInt32LE(end)!==0x06054b50)throw new Error('Bad test fixture');
  const central=small.readUInt32LE(end+16);
  const result=Buffer.alloc(size);
  small.copy(result,0,0,central);
  small.copy(result,central+pad,central);
  // ZIP permits bytes outside member records. Used ONLY to exercise transport size.
  result.writeUInt32LE(central+pad,size-6);
  return result;
}
await fs.writeFile(path.join(root,'.test/large.epub'),paddedZip(2709830));
await fs.writeFile(path.join(root,'.test/50mb.epub'),paddedZip(50000000));
