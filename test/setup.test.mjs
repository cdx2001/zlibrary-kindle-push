import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const script=await fs.readFile(new URL('../.test/kindle-push.user.js',import.meta.url),'utf8');
const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
const dummyToken='LOCAL_ONLY_'+'x'.repeat(48);
function harness({saved='',rejectLimits=false,rejectSMTP=false}={}) {
  const elements=new Map(),requests=[],writes=[],opened=[];
  const values={apiToken:saved,enabledOrigins:[]};
  function element(id){const attrs=new Map(),events={};return {id,isConnected:true,value:'',disabled:true,textContent:'',events,
    setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k),addEventListener:(k,fn)=>events[k]=fn};}
  for(const id of ['kindle-push-extension-status','connection-status','save-token','token','open-book','site-status','book-url'])elements.set(id,element(id));
  const document={getElementById:id=>elements.get(id),createElement:()=>element('new'),body:{append(){}}};
  const ctx={document,location:new URL('https://demo.example/setup'),window:{open:(...args)=>opened.push(args)},
    URL,Blob,TextDecoder,Uint8Array,DataView,setTimeout,clearTimeout,alert(){},
    GM_getValue:(key,otherwise)=>values[key]??otherwise,GM_setValue:(key,value)=>{values[key]=value;writes.push(key);},GM_deleteValue:key=>delete values[key],GM_registerMenuCommand(){},
    GM_xmlhttpRequest:opts=>{
      requests.push(opts);assert.equal(opts.method,'POST');assert.equal(new URL(opts.url).origin,'https://demo.example');
      queueMicrotask(()=>{
        if(opts.url.endsWith('/limits'))opts.onload(rejectLimits?{status:401,responseText:'{"ok":false,"error":"UNAUTHORIZED"}'}:{status:200,responseText:JSON.stringify({ok:true,engine:'durable-object-sqlite',maxFileBytes:50000000,busy:false})});
        else if(opts.url.endsWith('/smtp-auth'))opts.onload(rejectSMTP?{status:502,responseText:'{"ok":false,"error":"SMTP_REJECTED","smtpCode":535}'}:{status:200,responseText:'{"ok":true,"status":"authenticated","smtpCode":235}'});
        else throw new Error('Setup must not download books or send mail');
      });return {abort(){}};
    }};
  vm.createContext(ctx);vm.runInContext(script,ctx);
  return {get:id=>elements.get(id),requests,writes,opened,values};
}
test('setup reports script presence but never reads saved token into page or auto-connects',()=>{
  const h=harness({saved:dummyToken});
  assert.equal(h.get('kindle-push-extension-status').getAttribute('data-script-version'),pkg.version);
  assert.equal(h.get('kindle-push-extension-status').getAttribute('data-token-state'),'saved');
  assert.equal(h.get('token').value,'');assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
});
test('setup ignores untrusted save and rejects invalid token without network',async()=>{
  const h=harness();h.get('token').value=dummyToken;
  await h.get('save-token').onclick({isTrusted:false});assert.equal(h.requests.length,0);
  h.get('token').value='short';await h.get('save-token').onclick({isTrusted:true});assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
});
test('bad API token stops before SMTP and preserves previously saved value',async()=>{
  const h=harness({saved:dummyToken,rejectLimits:true});h.get('token').value='WRONG_'+'y'.repeat(40);
  await h.get('save-token').onclick({isTrusted:true});assert.equal(h.requests.length,1);assert.equal(h.values.apiToken,dummyToken);assert.equal(h.writes.length,0);
  assert(h.get('connection-status').textContent.includes('令牌不匹配'));assert.equal(h.get('open-book').disabled,true);
});
test('failed SMTP auth does not save a new token or mark setup verified',async()=>{
  const h=harness({rejectSMTP:true});h.get('token').value=dummyToken;
  await h.get('save-token').onclick({isTrusted:true});assert.equal(h.requests.length,2);assert.equal(h.writes.length,0);
  assert.equal(h.get('kindle-push-extension-status').getAttribute('data-token-state'),'missing');assert(h.get('connection-status').textContent.includes('535'));
});
test('successful setup verifies limits and SMTP, then saves and clears page input without sending',async()=>{
  const h=harness();h.get('token').value=dummyToken;
  await h.get('save-token').onclick({isTrusted:true});
  assert.deepEqual(h.requests.map(x=>new URL(x.url).pathname),['/limits','/smtp-auth']);
  assert.equal(h.values.apiToken,dummyToken);assert.equal(h.get('token').value,'');assert.equal(h.get('open-book').disabled,false);
  assert.equal(h.get('kindle-push-extension-status').getAttribute('data-token-state'),'verified');
});
test('site onboarding requires verification and trusted click; saves only HTTPS origin, never sends',async()=>{
  const h=harness();h.get('book-url').value='https://books.example/book/7?session=not-saved';
  h.get('open-book').onclick({isTrusted:true});assert.equal(h.opened.length,0);
  h.get('token').value=dummyToken;await h.get('save-token').onclick({isTrusted:true});
  for(const url of ['javascript:alert(1)','http://books.example/book/7','https://user:pass@books.example/book/7','https://demo.example/setup']){
    h.get('book-url').value=url;h.get('open-book').onclick({isTrusted:true});assert.equal(h.opened.length,0);
  }
  h.get('book-url').value='https://books.example/book/7?session=not-saved';
  h.get('open-book').onclick({isTrusted:false});assert.equal(h.opened.length,0);
  h.get('open-book').onclick({isTrusted:true});assert.equal(h.values.enabledOrigins.length,1);assert.equal(h.values.enabledOrigins[0],'https://books.example');
  assert.equal(h.opened[0][2],'noopener,noreferrer');assert.equal(h.requests.length,2);
  h.get('token').events.input();assert.equal(h.get('open-book').disabled,true);
});
