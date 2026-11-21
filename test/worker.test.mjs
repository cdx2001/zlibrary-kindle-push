import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

const source = await readFile(new URL('../.test/build/worker.js', import.meta.url),'utf8');
await writeFile(new URL('../.test/testable-worker.mjs', import.meta.url),source.replace("import { connect } from 'cloudflare:sockets';", 'const connect = (...args) => globalThis.TEST_CONNECT(...args);'));
const { default: worker, MailSender, SMTPClient, makeMime, validateEpub, readLimited, readExactUpload, uploadSize, configurationWarnings, renderUserscript } = await import('../.test/testable-worker.mjs');
const fixture = new Uint8Array(await readFile(new URL('./fixtures/sample.epub', import.meta.url)));
const large = new Uint8Array(await readFile(new URL('../.test/large.epub', import.meta.url)));
const env = { API_TOKEN:'TEST_ONLY_'+'x'.repeat(50), SMTP_USER:'test@126.com', SMTP_AUTH_CODE:'dummy-auth-code', KINDLE_EMAIL:'test@kindle.com' };
let calls = 0, last;
function mock(options={}) {
  let controller, closedResolve, body=false;
  const chunks=[];
  const queue = text => {
    const encoded = new TextEncoder().encode(text);
    if (options.fragment) {
      for(let i=0;i<encoded.length;i+=3) controller.enqueue(encoded.slice(i,i+3));
    } else controller.enqueue(encoded);
  };
  const commands=[], attachmentHash=createHash('sha256');let attachmentBytes=0;
  const socket={
    opened:Promise.resolve({}), closed:new Promise(r=>closedResolve=r),
    readable:new ReadableStream({start(c){controller=c;queue('220 test server\r\n');}}),
    writable:new WritableStream({write(bytes){
      const s=new TextDecoder().decode(bytes);if(options.capture!==false||!body||s==='.\r\n')commands.push(s);
      if(body){
        if(s==='.\r\n'){
          body=false;
          if(options.dropCommit){controller.close();return;}
          queue(options.rejectCommit?'554 sender policy failure\r\n':'250 queued\r\n');
        }else {
          if(options.capture!==false)chunks.push(s);
          if(/^[A-Za-z0-9+/=\r\n]+$/.test(s)){const b=Buffer.from(s,'base64');attachmentHash.update(b);attachmentBytes+=b.length;}
        }
      }else if(s.startsWith('EHLO '))queue('250-test server\r\n'+(options.noAuth?'':'250-AUTH '+(options.login?'LOGIN':'PLAIN LOGIN')+'\r\n')+'250 SIZE '+(options.tiny?100:(options.maxSize||10000000))+'\r\n');
      else if(s==='AUTH PLAIN\r\n'||s==='AUTH LOGIN\r\n')queue('334 challenge\r\n');
      else if(options.login&&s===Buffer.from(env.SMTP_USER).toString('base64')+'\r\n')queue('334 password\r\n');
      else if(s===Buffer.from(env.SMTP_AUTH_CODE).toString('base64')+'\r\n'||s===Buffer.from('\0'+env.SMTP_USER+'\0'+env.SMTP_AUTH_CODE).toString('base64')+'\r\n')queue(options.rejectAuth?'535 dummy-auth-code user test@126.com\r\n':'235 authenticated\r\n');
      else if(s.startsWith('MAIL FROM:'))queue('250 sender ok\r\n');
      else if(s.startsWith('RCPT TO:'))queue(options.rejectRcpt?'550 no such user\r\n':'250 recipient ok\r\n');
      else if(s==='DATA\r\n'){body=true;queue('354 continue\r\n');}
      else if(s==='QUIT\r\n'){if(options.dropQuit)controller.close();else queue('221 bye\r\n');}
      else throw new Error('Unexpected command (dummy credentials only)');
    }}),
    close(){try{controller.close();}catch{}closedResolve();return Promise.resolve();},
    commands,chunks,attachmentHash,get attachmentBytes(){return attachmentBytes;},
  };
  return socket;
}
function setup(options={}) {
  calls=0;
  const actor=new MailSender({},env);
  env.MAIL_SENDER={idFromName:name=>name,get:id=>{assert.equal(id,'personal-mailbox-v2');return actor;}};
  globalThis.TEST_CONNECT=(address,opts)=>{calls++;assert.deepEqual(address,{hostname:'smtp.126.com',port:465});assert.equal(opts.secureTransport,'on');return last=mock(options);};
}
async function request(path,options={},secrets=env){
  const headers={Authorization:'Bearer '+env.API_TOKEN,...options.headers};
  if(path==='/push' && !('X-File-Size' in headers) && options.body?.byteLength) headers['X-File-Size']=String(options.body.byteLength);
  const r=await worker.fetch(new Request('https://demo.example'+path,{method:'POST',...options,headers}),secrets);
  return {status:r.status,body:await r.json()};
}
test('unauthenticated and wrong-token requests never connect',async()=>{
  setup();
  for(const authorization of ['','Bearer wrong']){
    const r=await request('/smtp-auth',{headers:{Authorization:authorization}});assert.equal(r.status,401);
  }assert.equal(calls,0);
});
test('routes, HTTPS, methods and configuration are guarded',async()=>{
  setup();assert.equal((await request('/smtp-check')).status,404);
  assert.equal((await request('/smtp-test',{method:'GET'})).status,405);
  assert.equal((await request('/smtp-auth?token=bad')).status,400);
  assert.equal((await request('/smtp-auth',{}, {...env,SMTP_USER:'bad\r\nuser@126.com'})).status,503);
  assert.equal((await worker.fetch(new Request('http://example.com/'),env)).status,400);
  assert.equal(calls,0);
});
test('PLAIN auth with fragmented multiline replies does not send mail',async()=>{
  setup({fragment:true});const r=await request('/smtp-auth');assert.equal(r.status,200);assert.equal(r.body.mechanism,'PLAIN');assert.equal(r.body.smtpCode,235);
  assert(!last.commands.some(x=>/MAIL FROM|RCPT TO|DATA/.test(x)));
});
test('LOGIN-only server supported',async()=>{
  setup({login:true});const r=await request('/smtp-auth');assert.equal(r.body.mechanism,'LOGIN');assert.equal(r.body.ok,true);
});
test('empty HTTP POST stream is accepted for auth',async()=>{
  setup();const body=new ReadableStream({start(c){c.close();}});
  const r=await request('/smtp-auth',{body,duplex:'half'});assert.equal(r.body.status,'authenticated');
});
test('auth errors are sanitized and no unsupported mechanism fallback',async()=>{
  setup({rejectAuth:true});const r=await request('/smtp-auth');assert.equal(r.body.smtpCode,535);assert.equal(r.body.stage,'auth');
  assert(!JSON.stringify(r).includes(env.SMTP_AUTH_CODE));assert(!JSON.stringify(r).includes(env.SMTP_USER));
  setup({noAuth:true});assert.equal((await request('/smtp-auth')).body.error,'SMTP_AUTH_UNSUPPORTED');
});
test('ordinary test email goes only to self',async()=>{
  setup();const r=await request('/smtp-test');assert.equal(r.body.status,'smtp_accepted');assert(last.commands.includes('RCPT TO:<test@126.com>\r\n'));
  assert(!last.commands.includes('RCPT TO:<test@kindle.com>\r\n'));
});
test('EPUB validation rejects HTML, normal ZIP, truncation, fake headers, traversal and encrypted zip',()=>{
  validateEpub(fixture);validateEpub(large);
  for(const bad of [new TextEncoder().encode('<html>login</html>'),fixture.slice(0,-1),new Uint8Array(200)])assert.throws(()=>validateEpub(bad));
  const encrypted=fixture.slice();encrypted[6]|=1;assert.throws(()=>validateEpub(encrypted));
  const fake=fixture.slice();fake[38]=120;assert.throws(()=>validateEpub(fake));
  const badCentral=fixture.slice();const dv=new DataView(badCentral.buffer);dv.setUint32(badCentral.length-6,0xffffffff,true);assert.throws(()=>validateEpub(badCentral));
});
test('bounded upload stops chunked body above limit',async()=>{
  let cancel=false;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(8));c.enqueue(new Uint8Array(8));},cancel(){cancel=true;}});
  await assert.rejects(readLimited(new Request('https://test',{method:'POST',body:stream,duplex:'half'}),10),{code:'FILE_TOO_LARGE'});assert(cancel);
});
test('file type, size, name checks happen before SMTP',async()=>{
  setup();
  assert.equal((await request('/push',{body:fixture,headers:{'Content-Type':'text/html'}})).status,415);
  assert.equal((await request('/push',{body:fixture,headers:{'Content-Type':'application/epub+zip','X-Filename':'evil%0D%0ABcc%3A.epub'}})).status,400);
  assert.equal((await request('/push',{body:fixture,headers:{'Content-Type':'application/epub+zip','X-File-Size':'50000001'}})).status,413);
  assert.equal(calls,0);
});
test('MIME 2.7MB roundtrip has exact size, RFC2045 line limits, UTF8 name',async()=>{
  const mime=makeMime(env.SMTP_USER,env.KINDLE_EMAIL,'中文测试-📖.epub',large,'fixed-id');
  const text=[...mime.chunks()].join('');assert.equal(Buffer.byteLength(text),mime.size);
  assert(!text.replaceAll('\r\n','').includes('\n'));
  for(const line of text.split('\r\n'))assert(line.length<=998);
  const part=text.split('Content-Disposition:')[1].split('\r\n\r\n')[1].split('\r\n--')[0];
  for(const line of part.trim().split('\r\n'))assert(line.length<=76);
  assert.deepEqual(new Uint8Array(Buffer.from(part,'base64')),large);
  await writeFile(new URL('../.test/mime-test.eml',import.meta.url),text);
});
test('push accepted only after DATA 250; fixed Kindle recipient',async()=>{
  setup();const r=await request('/push',{body:fixture,headers:{'Content-Type':'application/epub+zip','X-Filename':encodeURIComponent('测试.epub')}});
  assert.equal(r.body.status,'smtp_accepted');assert.equal(r.body.deliveredToKindle,false);assert(last.commands.includes('RCPT TO:<test@kindle.com>\r\n'));
});
test('server SIZE/RCPT rejection stops before transmission',async()=>{
  setup({tiny:true});assert.equal((await request('/smtp-test')).body.error,'SMTP_MESSAGE_TOO_LARGE');assert.equal(last.chunks.length,0);
  setup({rejectRcpt:true});const r=await request('/smtp-test');assert.equal(r.body.smtpCode,550);assert.equal(last.chunks.length,0);
});
test('lost final reply is UNKNOWN and explicit 554 is rejection',async()=>{
  setup({dropCommit:true});assert.equal((await request('/smtp-test')).body.error,'DELIVERY_UNKNOWN_DO_NOT_RETRY');assert.equal(calls,1);
  setup({rejectCommit:true});const r=await request('/smtp-test');assert.equal(r.body.error,'SMTP_REJECTED');assert.equal(r.body.smtpCode,554);
});
test('QUIT failure after accepted DATA does not report send failure',async()=>{
  setup({dropQuit:true});assert.equal((await request('/smtp-test')).body.status,'smtp_accepted');
});
test('timeout and malformed reply are bounded',async()=>{
  const socket=mock();const client=new SMTPClient(socket,10);
  await client.reply();await assert.rejects(client.reply(),{code:'SMTP_TIMEOUT'});client.close();
  const bad=mock();const c=new SMTPClient(bad);c.buffer='250-test\r\n550 wrong-code\r\n';await assert.rejects(c.reply(),{code:'SMTP_BAD_REPLY'});c.close();
});
test('panel is no-store and CSP protected; JS syntax valid',async()=>{
  const r=await worker.fetch(new Request('https://demo.example/panel'),env);
  assert.equal(r.headers.get('Cache-Control'),'no-store');assert(r.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
  const html=await r.text();new vm.Script(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);assert(!html.includes(env.API_TOKEN));
});
test('v2 limits prove namespace binding and distinguish MB from MiB',async()=>{
  setup();const r=await request('/limits');assert.equal(r.body.maxFileBytes,50000000);assert.equal(r.body.engine,'durable-object-sqlite');assert.equal(calls,0);
  assert.equal((await request('/limits',{}, {...env,MAIL_SENDER:undefined})).body.error,'DURABLE_OBJECT_BINDING_MISSING');
  assert.equal(uploadSize(new Request('https://test',{headers:{'X-File-Size':'50000000'}})),50000000);
  assert.throws(()=>uploadSize(new Request('https://test',{headers:{'X-File-Size':'50000001'}})),{code:'FILE_TOO_LARGE'});
  assert.throws(()=>uploadSize(new Request('https://test',{headers:{'X-File-Size':'52428800'}})),{code:'FILE_TOO_LARGE'});
});
test('exact upload catches both lying size directions and missing size',async()=>{
  for(const size of ['3','5'])await assert.rejects(readExactUpload(new Request('https://test',{method:'POST',body:new Uint8Array(4),headers:{'X-File-Size':size}})),{code:'FILE_SIZE_MISMATCH'});
  await assert.rejects(readExactUpload(new Request('https://test',{method:'POST',body:new Uint8Array(4)})),{code:'FILE_SIZE_REQUIRED'});
  const stalled=new Request('https://test',{method:'POST',headers:{'X-File-Size':'4'},body:new ReadableStream({}),duplex:'half'});
  await assert.rejects(readExactUpload(stalled,10),{code:'UPLOAD_TIMEOUT'});
});
test('single object serializes requests and stays usable after rejected upload',async()=>{
  setup();let release;
  const body=new ReadableStream({start(c){release=()=>{c.enqueue(fixture);c.close();};}});
  const first=request('/push',{body,duplex:'half',headers:{'Content-Type':'application/epub+zip','X-File-Size':String(fixture.length)}});
  await new Promise(r=>setTimeout(r,10));
  assert.equal((await request('/limits')).body.busy,true);
  assert.equal((await request('/smtp-test')).body.error,'BUSY_ONE_BOOK_AT_A_TIME');
  release();assert.equal((await first).body.status,'smtp_accepted');
  assert.equal((await request('/limits')).body.busy,false);
  await request('/push',{body:fixture.slice(0,100),headers:{'Content-Type':'application/epub+zip'}});
  assert.equal((await request('/smtp-auth')).body.status,'authenticated');
});
test('full 50,000,000-byte streamed upload and SMTP MIME decode match SHA256',async()=>{
  setup({capture:false,maxSize:80000000});
  const path=new URL('../.test/50mb.epub',import.meta.url);
  const expected=createHash('sha256');for await(const b of createReadStream(path))expected.update(b);
  const body=Readable.toWeb(createReadStream(path,{highWaterMark:65536}),{strategy:{highWaterMark:2,size:()=>1}});
  const r=await request('/push',{body,duplex:'half',headers:{'Content-Type':'application/epub+zip','X-File-Size':'50000000','X-Filename':encodeURIComponent('50MB测试.epub')}});
  assert.equal(r.status,200);assert.equal(r.body.status,'smtp_accepted');assert.equal(r.body.attachmentBytes,50000000);
  assert(r.body.messageBytes>68000000&&r.body.messageBytes<69000000);
  assert.equal(last.attachmentBytes,50000000);assert.equal(last.attachmentHash.digest('hex'),expected.digest('hex'));
});
test('50 MB file respects a smaller advertised SMTP SIZE and never starts DATA',async()=>{
  setup({capture:false,maxSize:50000000});
  const body=Readable.toWeb(createReadStream(new URL('../.test/50mb.epub',import.meta.url),{highWaterMark:65536}),{strategy:{highWaterMark:2,size:()=>1}});
  const r=await request('/push',{body,duplex:'half',headers:{'Content-Type':'application/epub+zip','X-File-Size':'50000000'}});
  assert.equal(r.status,413);assert.equal(r.body.error,'SMTP_MESSAGE_TOO_LARGE');assert(!last.commands.includes('DATA\r\n'));
});
async function testUserscript(serviceMax=50000000){
  const elements=[],hosts=new Map(),requests=[];
  const title={textContent:'合法测试书',insertAdjacentElement(_,e){hosts.set(e.id,e);}};
  const anchor={isConnected:true,textContent:'下载 EPUB',className:'',title:'',getClientRects:()=>[{}],closest:()=>null,getAttribute:()=>'/dl/ordinary-token'};
  const document={body:{append(){}},querySelector:selector=>selector==='h1'?title:null,
    querySelectorAll:()=>[anchor],getElementById:id=>hosts.get(id),
    createElement:tag=>{const e={tag,attachShadow:()=>({append(){}})};elements.push(e);return e;}};
  const data=new Blob([fixture],{type:'application/epub+zip'});
  const context={location:new URL('https://books.example/book/123/name'),document,URL,Blob,TextDecoder,Uint8Array,DataView,
    alert(){},prompt(){throw new Error('Unexpected prompt');},setTimeout,clearTimeout,
    getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1'}),MutationObserver:class{observe(){}},
    GM_getValue:key=>key==='enabledOrigins'?['https://books.example']:key==='apiToken'?env.API_TOKEN:undefined,
    GM_registerMenuCommand(){},GM_setValue(){},GM_deleteValue(){},
    GM_xmlhttpRequest:options=>{
      requests.push(options);
      queueMicrotask(()=>{
        if(options.url.endsWith('/limits'))options.onload({status:200,responseText:JSON.stringify({ok:true,engine:'durable-object-sqlite',maxFileBytes:serviceMax,busy:false})});
        else if(options.url.includes('/dl/')){
          assert(!options.headers.Authorization);assert.equal(options.responseType,'blob');
          options.onload({status:200,response:data,responseHeaders:'Content-Type: application/epub+zip',finalUrl:options.url});
        }else if(options.url.endsWith('/push')){
          assert.equal(options.data,data);assert.equal(options.headers['X-File-Size'],String(fixture.length));assert.equal(options.headers.Authorization,'Bearer '+env.API_TOKEN);
          options.onload({status:200,responseText:'{"ok":true,"status":"smtp_accepted"}'});
        }else throw new Error('Unexpected URL');
      });return {abort(){}};
    }};
  vm.createContext(context);vm.runInContext(await readFile(new URL('../.test/kindle-push.user.js',import.meta.url),'utf8'),context);
  await elements.find(e=>e.tag==='button').onclick({isTrusted:true});return requests;
}
test('userscript performs preflight, downloads Blob without API token, uploads Blob with exact size',async()=>{
  const requests=await testUserscript();assert.equal(requests.length,3);
});
test('userscript stops before download when backend still has old size cap',async()=>{
  const requests=await testUserscript(5242880);assert.equal(requests.length,1);
});

async function setupOnboarding({enabled=false,configured=false}={}) {
  const elements=[],hosts=new Map(),writes=[];let reloads=0,requests=0;
  const title={textContent:'A book',insertAdjacentElement(_,e){hosts.set(e.id,e);}};
  const document={body:{append(){}},querySelector:s=>s==='h1'?title:null,querySelectorAll:()=>[],getElementById:id=>hosts.get(id),
    createElement:tag=>{const e={tag,attachShadow:()=>({append(){}})};elements.push(e);return e;}};
  const location=new URL('https://books.example/book/123/title');location.reload=()=>reloads++;
  const context={document,location,URL,Blob,TextDecoder,Uint8Array,DataView,setTimeout,clearTimeout,
    alert(){},MutationObserver:class{observe(){}},GM_registerMenuCommand(){},GM_deleteValue(){},
    GM_getValue:(key,fallback)=>key==='enabledOrigins'?(enabled?[location.origin]:[]):key==='apiToken'?(configured?env.API_TOKEN:''):fallback,
    GM_setValue:(key,value)=>writes.push({key,value}),GM_xmlhttpRequest(){requests++;throw new Error('Onboarding must not download or send');}};
  vm.createContext(context);vm.runInContext(await readFile(new URL('../.test/kindle-push.user.js',import.meta.url),'utf8'),context);
  return {elements,writes,get reloads(){return reloads;},get requests(){return requests;}};
}
test('new install displays opt-in on book page without network; only trusted click enables origin',async()=>{
  const ui=await setupOnboarding(),button=ui.elements.find(e=>e.tag==='button');
  assert.equal(button.textContent,'在此站启用 Kindle 推送');assert.equal(ui.requests,0);
  button.onclick({isTrusted:false});assert.equal(ui.writes.length,0);
  button.onclick({isTrusted:true});assert.equal(ui.writes[0].key,'enabledOrigins');
  assert.equal(ui.writes[0].value.length,1);assert.equal(ui.writes[0].value[0],'https://books.example');
  assert.equal(ui.reloads,1);assert.equal(ui.requests,0);
});
test('enabled site without token displays settings link and disabled send button',async()=>{
  const ui=await setupOnboarding({enabled:true}),button=ui.elements.find(e=>e.tag==='button'),link=ui.elements.find(e=>e.tag==='a');
  assert.equal(button.disabled,true);assert.equal(link.href,'https://demo.example/panel');assert.equal(ui.requests,0);
});
test('installation source binds only to the current HTTPS service, without secrets',async()=>{
  for(const origin of ['https://reader-one.workers.dev','https://library.example']) {
    const r=await worker.fetch(new Request(origin+'/kindle-push.user.js'),env);
    const js=await r.text();assert.equal(r.status,200);new vm.Script(js);
    assert(js.includes("const SERVICE = '"+origin+"'"));assert(js.includes(origin+'/kindle-push.user.js'));
    assert(!js.includes(env.API_TOKEN));assert(!js.includes('__SERVICE_ORIGIN__'));
  }
  for(const origin of ['http://library.example','https://library.example/path','https://library.example/#x'])assert.throws(()=>renderUserscript(origin));
  const landing=await worker.fetch(new Request('https://library.example/'),env);
  assert.equal(landing.headers.get('Location'),'https://library.example/setup');
  assert.equal((await worker.fetch(new Request('https://library.example/setup'),env)).status,200);
});
test('mailbox similarity is an authenticated warning, not a sender ban or secret disclosure',async()=>{
  assert(configurationWarnings({SMTP_USER:'reader_2026@126.com',KINDLE_EMAIL:'reader_2026_kindle@kindle.com'}).includes('MAILBOX_PREFIX_SIMILAR'));
  assert.equal(configurationWarnings({SMTP_USER:'reader_2026@126.com',KINDLE_EMAIL:'q7m9v2n8r4p6@kindle.com'}).length,0);
  setup();const r=await request('/limits');assert.equal(r.status,200);assert(r.body.configurationWarnings.includes('MAILBOX_PREFIX_SIMILAR'));
  assert(!JSON.stringify(r.body).includes(env.SMTP_USER));assert(!JSON.stringify(r.body).includes(env.KINDLE_EMAIL));assert.equal(calls,0);
});
