(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const marker=$('kindle-push-extension-status');
  const tabs=[...document.querySelectorAll('[data-step]')];
  let current=0,extensionConfirmed=false,lastReady=false;
  $('service-url').textContent=location.origin;
  function showStep(index,focus=true) {
    current=index;
    for(let i=0;i<4;i++) {
      $('step-'+i).hidden=i!==index;
      if(i===index)tabs[i].setAttribute('aria-current','step');else tabs[i].removeAttribute('aria-current');
    }
    if(focus)$('heading-'+index).focus();
  }
  function sync() {
    const version=marker.getAttribute('data-script-version');
    const ready=version==='__VERSION__';
    const verified=ready&&marker.getAttribute('data-token-state')==='verified';
    const siteReady=verified&&marker.getAttribute('data-site-ready')==='true';
    const done=[extensionConfirmed||ready,ready,verified,siteReady];
    const labels=[ready?'脚本已运行':extensionConfirmed?'你已确认':'等待确认',ready?'已检测到 __VERSION__':version?'请更新脚本':'等待检测',verified?'已验证并保存':'等待验证',siteReady?'网站已启用':'等待启用'];
    tabs.forEach((tab,i)=>{tab.classList.toggle('done',done[i]);$('progress-'+i).textContent=labels[i];});
    $('next-connection').disabled=!ready;$('next-site').disabled=!verified;
    if(ready&&!lastReady&&current<2)showStep(2,false);
    lastReady=ready;
    return ready;
  }
  tabs.forEach(tab=>tab.addEventListener('click',()=>showStep(Number(tab.dataset.step))));
  $('confirm-extension').onclick=()=>{extensionConfirmed=true;sync();showStep(1);};
  $('next-connection').onclick=()=>showStep(2);
  $('next-site').onclick=()=>showStep(3);
  $('reload-page').onclick=()=>location.reload();
  $('check-script').onclick=()=>{
    const ready=sync();
    $('script-check-note').textContent=ready?'已检测到正式脚本，可以继续。':'尚未收到当前版本的脚本响应。请确认暴力猴和正式脚本均已启用，再点击“刷新本页”；这不代表暴力猴一定未安装。';
  };
  new MutationObserver(sync).observe(marker,{attributes:true,attributeFilter:['data-script-version','data-token-state','data-site-ready']});
  window.addEventListener('focus',sync);sync();
  $('copy-script').onclick=async()=>{
    const status=$('copy-status'),source=$('script-source');
    try {
      const r=await fetch('/kindle-push.user.js',{cache:'no-store'});if(!r.ok)throw new Error();source.value=await r.text();
      try{await navigator.clipboard.writeText(source.value);status.textContent='已复制。请到暴力猴“＋”新建脚本，全选替换后保存，再刷新本页。';}
      catch{source.hidden=false;source.focus();source.select();status.textContent='请手动复制下方选中的全文，到暴力猴新建脚本中全选替换并保存。';}
    } catch {status.textContent='脚本读取失败，请重试安装链接。';}
  };
  const controls=['limits','auth','mail','push'].map($);
  async function run(path,file) {
    const token=$('token').value,out=$('result');
    if(!token){out.textContent='请在第 3 步的输入框临时填写 API_TOKEN，工具不会读取扩展保存的令牌。';showStep(2);return;}
    if(file&&file.size>__MAX_BYTES__){out.textContent='文件超过 __MAX_MB__ MB（__MAX_BYTES_LABEL__ 字节）。';return;}
    controls.forEach(b=>b.disabled=true);out.textContent='处理中，请保持页面打开…';
    const control=new AbortController(),timer=setTimeout(()=>control.abort(),900000);
    try {
      const headers={Authorization:'Bearer '+token};if(file){headers['Content-Type']='application/epub+zip';headers['X-Filename']=encodeURIComponent(file.name);headers['X-File-Size']=String(file.size);}
      const r=await fetch(path,{method:'POST',headers,body:file||undefined,signal:control.signal,redirect:'error',cache:'no-store'});
      const text=await r.text();try{out.textContent='HTTP '+r.status+'\n'+JSON.stringify(JSON.parse(text),null,2);}catch{out.textContent='HTTP '+r.status+'：非 JSON 响应。发送结果未知，请检查邮箱和 Kindle，不要直接重试。';}
    }catch{out.textContent='连接中断或超时，发送结果可能未知。先检查收件箱/Kindle，不自动重试。';}
    finally{clearTimeout(timer);controls.forEach(b=>b.disabled=false);}
  }
  $('limits').onclick=()=>run('/limits');$('auth').onclick=()=>run('/smtp-auth');$('mail').onclick=()=>run('/smtp-test');
  $('push').onclick=()=>{const f=$('file').files[0];if(f)run('/push',f);else $('result').textContent='请先选择 EPUB 文件。';};
})();
