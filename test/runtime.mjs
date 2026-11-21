import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
const original=await readFile(new URL('../.test/build/worker.js',import.meta.url),'utf8');
// In this local-only integration check, replace ONLY the external SMTP call.
// Actual production upload parsing, namespace routing, ZIP validation and MIME generation run in workerd.
const script=original.replace("await runSMTP(env, url.pathname === '/smtp-auth' ? 'auth' : url.pathname === '/smtp-test' ? 'test' : 'push', filename, bytes, url.hostname)",
  `await (async()=>{const mime=makeMime(env.SMTP_USER,env.KINDLE_EMAIL,filename,bytes);let size=0,maxChunk=0;for(const chunk of mime.chunks()){const encoded=new TextEncoder().encode(chunk);size+=encoded.byteLength;maxChunk=Math.max(maxChunk,encoded.byteLength);}return {ok:true,localTestOnly:true,attachmentBytes:bytes.length,messageBytes:size,declaredMimeBytes:mime.size,maxChunk};})()`);
assert.notEqual(script,original);
const token='LOCAL_TEST_ONLY_'+'x'.repeat(40);
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-11-21',compatibilityFlags:['nodejs_compat'],
  bindings:{API_TOKEN:token,SMTP_USER:'test@126.com',SMTP_AUTH_CODE:'dummy',KINDLE_EMAIL:'test@kindle.com'},
  durableObjects:{MAIL_SENDER:{className:'MailSender',useSQLite:true}},
}));
try{
  const headers={Authorization:'Bearer '+token};
  let r=await mf.dispatchFetch('https://local.test/limits',{method:'POST',headers});
  const limits=await r.json();assert.equal(limits.engine,'durable-object-sqlite');assert.equal(limits.maxFileBytes,50000000);
  console.log('workerd SQLite binding + /limits: passed');
  const body=Readable.toWeb(createReadStream(new URL('../.test/50mb.epub',import.meta.url),{highWaterMark:65536}),{strategy:{highWaterMark:2,size:()=>1}});
  const start=performance.now();
  r=await mf.dispatchFetch('https://local.test/push',{method:'POST',headers:{...headers,'Content-Type':'application/epub+zip','X-File-Size':'50000000'},body,duplex:'half'});
  const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));assert.equal(result.attachmentBytes,50000000);assert.equal(result.messageBytes,result.declaredMimeBytes);assert(result.maxChunk<100000);
  console.log(JSON.stringify({runtime:'workerd',localOnly:true,attachmentBytes:result.attachmentBytes,messageBytes:result.messageBytes,maxEncodedChunk:result.maxChunk,elapsedMs:Math.round(performance.now()-start)}));
}finally{await mf.dispose();}
