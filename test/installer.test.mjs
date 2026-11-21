import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {build} from '../scripts/build.mjs';
const source=await fs.readFile(new URL('../.test/public-installer.user.js',import.meta.url),'utf8');
const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
function harness({origin='',page=pkg.repository.url.replace(/\.git$/,'')}={}){
  const values={serviceOrigin:origin,apiToken:'OLD_PRIVATE_TEST_ONLY',enabledOrigins:[]},menus=new Map(),elements=[],opens=[],deletes=[],alerts=[];
  let answer=null;
  const element=tag=>{const e={tag,style:{},value:'',append(){},setAttribute(){},attachShadow(){return {append(){}}}};elements.push(e);return e;};
  const ctx={URL,document:{createElement:element,body:{prepend(){},append(){}},getElementById(){return null;},querySelector(){return null;}},location:new URL(page),
    window:{open:(...args)=>opens.push(args)},MutationObserver:class{observe(){}},
    GM_getValue:(k,d)=>values[k]??d,GM_setValue:(k,v)=>values[k]=v,GM_deleteValue:k=>{deletes.push(k);delete values[k];},
    GM_registerMenuCommand:(label,fn)=>menus.set(label,fn),GM_xmlhttpRequest(){throw new Error('Installer must never make HTTP requests');},
    prompt:()=>answer,alert:s=>alerts.push(s)};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {values,menus,elements,opens,deletes,alerts,connect(value){answer=value;menus.get('Kindle：连接或更换自己的 Cloudflare 服务')();}};
}
test('public installer is reproducible from shared sources and contains no fixed service',async()=>{
  const {installer}=await build({outputDir:'.test/reproducible'});
  const artifact=(await fs.readFile(new URL('../install/zlibrary-kindle-push.user.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  assert.equal(artifact,installer);assert(!installer.includes('__SERVICE_ORIGIN__'));assert(!installer.includes('__PROJECT_URL__'));
  assert(installer.includes('raw.githubusercontent.com/'));new vm.Script(installer);
});
test('public installer offers connection on repository without exposing or using old token',()=>{
  const h=harness();assert(h.elements.some(e=>e.id==='zlibrary-kindle-connect'));
  assert(h.elements.every(e=>!String(e.value).includes('OLD_PRIVATE')));assert.equal(h.opens.length,0);assert.equal(h.deletes.length,0);
});
test('installer rejects unsafe or secret-bearing service URLs without storage changes',()=>{
  const h=harness();for(const value of ['http://service.example','javascript:alert(1)','https://u:p@service.example','https://service.example/?token=secret','https://service.example/#secret','https://service.example/book/1'])h.connect(value);
  assert.equal(h.opens.length,0);assert.equal(h.values.serviceOrigin,'');assert.equal(h.deletes.length,0);assert.equal(h.alerts.length,6);
});
test('connecting a new service saves only origin, clears old token, opens own setup',()=>{
  const h=harness();h.connect(' https://mine.example/setup ');
  assert.equal(h.values.serviceOrigin,'https://mine.example');assert.equal(h.values.apiToken,undefined);
  assert.deepEqual(h.opens,[['https://mine.example/setup','_blank','noopener,noreferrer']]);
});
test('reconnecting same origin preserves token, changing origin clears it',()=>{
  const h=harness({origin:'https://mine.example',page:'https://books.example/'});
  h.connect('https://mine.example/panel');assert.equal(h.values.apiToken,'OLD_PRIVATE_TEST_ONLY');
  h.connect('https://new.example');assert.equal(h.values.apiToken,undefined);
  h.values.apiToken='NEW_SERVICE_PRIVATE_TEST_ONLY';h.connect('https://mine.example');assert.equal(h.values.apiToken,undefined);
});
test('stale setup tab never sends the new service token to the previous service',async()=>{
  const h=harness({origin:'https://mine.example',page:'https://mine.example/setup'});
  h.values.serviceOrigin='https://new.example';h.values.apiToken='NEW_SERVICE_PRIVATE_TEST_ONLY_'+'x'.repeat(32);
  const save=h.elements.find(e=>e.tag==='button');await save.onclick({isTrusted:true});
  assert(h.elements.some(e=>String(e.textContent).includes('服务地址已更换')));
  assert.equal(h.values.apiToken,'NEW_SERVICE_PRIVATE_TEST_ONLY_'+'x'.repeat(32));
});
test('connection card requires trusted click and does not silently trust a setup URL',()=>{
  const h=harness({page:'https://mine.example/setup'}),input=h.elements.find(e=>e.tag==='input'),button=h.elements.find(e=>e.tag==='button');
  assert.equal(input.value,'https://mine.example');assert.equal(h.values.serviceOrigin,'');
  button.onclick({isTrusted:false});assert.equal(h.opens.length,0);
  button.onclick({isTrusted:true});assert.equal(h.values.serviceOrigin,'https://mine.example');assert.equal(h.opens.length,1);
});
