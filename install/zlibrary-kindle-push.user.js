// ==UserScript==
// @name         Z-Library → Kindle Push
// @namespace    personal.kindle.push
// @version      3.2.0
// @downloadURL  https://raw.githubusercontent.com/cdx2001/zlibrary-kindle-push/main/install/zlibrary-kindle-push.user.js
// @homepageURL  https://github.com/cdx2001/zlibrary-kindle-push
// @description  Z-Library EPUB 推送到 Kindle；Windows/Android Firefox + Violentmonkey；仅使用有权访问的普通下载入口
// @match        https://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      *
// @inject-into  content
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  // The broad match/connect permits changing legitimate book-site/download hosts.
  // A local setup prompt may appear on book detail pages. Network requests require
  // enabling this exact origin and a separate trusted push-button click.
  // Included only in the public installer. No service address or secret is shared.
  function installerServiceIsCurrent(origin) {
    return GM_getValue('serviceOrigin', '') === origin;
  }
  function resolveService() {
    const project = 'https://github.com/cdx2001/zlibrary-kindle-push';
    function parseService(value) {
      try {
        const url = new URL(String(value).trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
            !['/', '/setup', '/panel'].includes(url.pathname) || !/^[a-z0-9.-]+$/i.test(url.hostname)) return '';
        return url.origin;
      } catch { return ''; }
    }
    const stored = parseService(GM_getValue('serviceOrigin', ''));
    function connect(value) {
      const origin = parseService(value);
      if (!origin) return false;
      // Never carry a credential from one service to a newly selected service.
      if (origin !== parseService(GM_getValue('serviceOrigin', ''))) GM_deleteValue('apiToken');
      GM_setValue('serviceOrigin', origin);
      window.open(origin + '/setup', '_blank', 'noopener,noreferrer');
      return true;
    }
    GM_registerMenuCommand('Kindle：连接或更换自己的 Cloudflare 服务', () => {
      const value = prompt('填写自己的 HTTPS Worker 网址，不要填写 API_TOKEN 或邮箱授权码。更换服务会清除本机旧令牌。', stored);
      if (value !== null && !connect(value)) alert('请填写 HTTPS 服务根网址或 /setup 页面，不带账号密码、查询参数或 # 片段。');
    });
    const projectUrl = new URL(project);
    const onProject = location.origin === projectUrl.origin &&
      (location.pathname === projectUrl.pathname || location.pathname.startsWith(projectUrl.pathname + '/'));
    const onSetup = ['/setup', '/panel'].includes(location.pathname);
    if (!stored && (onProject || onSetup)) {
      const box = document.createElement('section');
      box.id = 'zlibrary-kindle-connect';
      // Shadow DOM keeps the connection form separate from the host page styles.
      const shadow = box.attachShadow({mode:'closed'});
      const inner = document.createElement('div');
      Object.assign(inner.style, {background:'#f1f7f9',color:'#173c4c',padding:'20px',margin:'16px',border:'1px solid #aac8d3',borderRadius:'8px',font:'16px/1.6 system-ui,sans-serif'});
      const title = document.createElement('strong');title.textContent = 'Z-Library → Kindle Push 已安装';
      const note = document.createElement('p');note.textContent = '最后连接你自己的 Cloudflare 服务。这里只填写网址；访问令牌稍后在自己的服务页面填写。';
      const label = document.createElement('label');label.textContent = '你的 Worker HTTPS 网址';
      const input = document.createElement('input');input.type = 'url';input.placeholder = 'https://你的服务.workers.dev';input.autocomplete = 'off';input.id = 'zlibrary-service-url';label.htmlFor = input.id;
      if (onSetup && !onProject) input.value = location.origin;
      Object.assign(input.style, {display:'block',boxSizing:'border-box',width:'100%',maxWidth:'620px',padding:'12px',margin:'8px 0',font:'inherit',color:'#173c4c',background:'white',border:'1px solid #8da8b4',borderRadius:'4px'});
      const button = document.createElement('button');button.type='button';button.textContent = '连接我的服务，继续配置';
      Object.assign(button.style,{padding:'12px 18px',background:'#176378',color:'white',border:'0',borderRadius:'4px',font:'inherit',cursor:'pointer'});
      const status = document.createElement('p');status.setAttribute('role','status');
      button.onclick = event => {
        if (!event.isTrusted) return;
        if (!connect(input.value)) {status.textContent = '网址不正确。请使用 HTTPS 根网址或 /setup，不要附带令牌、查询参数或账号密码。';return;}
        status.textContent = '已保存服务网址，并请求打开配置页。若没有新标签页，请手动打开这个服务的 /setup 页面。';
      };
      inner.append(title,note,label,input,button,status);shadow.append(inner);document.body.prepend(box);
    }
    return stored;
  }

  const SERVICE = resolveService();
  if (!SERVICE) return;
  const MAX = 50000000; // 50 decimal MB; this version uses Workers + 126 only.
  const origins = GM_getValue('enabledOrigins', []);
  const enabled = origins.includes(location.origin);
  let busy = false, selectedLink = null, lastDownload = null, output, pushButton;

  function notice(message) {
    if (output) output.textContent = message;
    else alert(message);
  }
  function token() {
    const value = GM_getValue('apiToken', '');
    if (!value) throw new Error('请先点击“打开推送设置”，在自己的服务页面保存 API_TOKEN，再刷新本页。');
    return value;
  }
  // Configure the token on your own Worker origin, away from book-site page scripts.
  GM_registerMenuCommand('Kindle：打开安装与连接向导', () => {
    window.open(SERVICE+'/setup','_blank','noopener,noreferrer');
  });
  GM_registerMenuCommand('Kindle：清除本机 API_TOKEN', () => { GM_deleteValue('apiToken'); alert('已清除。'); if(location.origin===SERVICE)location.reload(); });
  GM_registerMenuCommand(enabled ? 'Kindle：停用当前站点' : 'Kindle：启用当前书籍站点', () => {
    if (location.origin === SERVICE) { alert('这里是测试服务。请到你正常使用的书籍详情页启用。'); return; }
    GM_setValue('enabledOrigins', enabled ? origins.filter(x => x !== location.origin) : [...origins, location.origin]);
    location.reload();
  });
  if (location.origin === SERVICE && ['/panel', '/setup'].includes(location.pathname)) {
    const status = document.getElementById('kindle-push-extension-status') || document.createElement('p');
    status.id = 'kindle-push-extension-status';
    status.textContent = '正式推送脚本 3.2.0 已在本浏览器运行。';
    status.setAttribute('data-script-version','3.2.0');
    status.setAttribute('data-token-state',GM_getValue('apiToken','')?'saved':'missing');
    status.setAttribute('data-site-ready','false');
    if (!status.isConnected) document.body.append(status);
    const connection = document.getElementById('connection-status') || status;
    connection.textContent = GM_getValue('apiToken','')?'本机已有保存的令牌，可留空直接验证；不会将已保存的令牌回填到网页。':'请输入部署时保存的 API_TOKEN，然后验证连接。';
    const save = document.getElementById('save-token') || document.createElement('button');
    save.type = 'button';
    save.textContent = '验证连接并保存'; save.disabled = false;
    const input = document.getElementById('token');
    const openBook = document.getElementById('open-book');
    const siteStatus = document.getElementById('site-status');
    let verified=false,checking=false;
    const invalidate=()=>{
      verified=false;if(openBook)openBook.disabled=true;
      status.setAttribute('data-token-state',GM_getValue('apiToken','')?'saved':'missing');
      status.setAttribute('data-site-ready','false');
      if(siteStatus)siteStatus.textContent='先在第 3 步验证连接。';
    };
    if(input)input.addEventListener('input',invalidate);
    if (!save.isConnected) {
      if (input?.parentElement) input.parentElement.insertAdjacentElement('afterend',save);
      else document.body.append(save);
    }
    const check=async(path,value)=>{
      const r=await gm({method:'POST',url:SERVICE+path,anonymous:true,headers:{Authorization:'Bearer '+value},responseType:'text',timeout:30000});
      let body;
      try{body=JSON.parse(r.responseText||r.response);}catch{throw new Error('服务没有返回有效结果，请检查部署和网址。');}
      if(r.status!==200||!body.ok){
        const code=typeof body.error==='string'?body.error:'HTTP_'+r.status;
        if(code==='UNAUTHORIZED')throw new Error('访问令牌不匹配，请使用部署时保存的 API_TOKEN。');
        if(/^CONFIG_MISSING_/.test(code))throw new Error('Cloudflare 缺少配置：'+code.slice(15)+'，请补齐 Secret 后再验证。');
        if(code==='BUSY_ONE_BOOK_AT_A_TIME')throw new Error('服务正在处理另一本书，请等完成后再验证。');
        // Display only expected identifiers, never arbitrary response bodies or credentials.
        const safeCode=/^[A-Z0-9_]{1,80}$/.test(code)?code:'SERVICE_ERROR';
        throw new Error('连接未通过：'+safeCode+(Number.isInteger(body.smtpCode)?'（SMTP '+body.smtpCode+'）':'')+'。请检查服务或邮箱配置。');
      }
      return body;
    };
    save.onclick = async event => {
      if (!event.isTrusted) return;
      if(checking)return;
      const value=input?.value||GM_getValue('apiToken','');
      invalidate();
      if(!/^[\x21-\x7e]{32,256}$/.test(value)){connection.textContent='请填写 32–256 位、不含空格的 API_TOKEN，不要填写邮箱授权码。';return;}
      checking=true;save.disabled=true;if(input)input.disabled=true;status.setAttribute('data-setup-busy','true');
      connection.textContent='正在检查服务和邮箱登录，不会发邮件…';
      try {
        const limits=await check('/limits',value);
        if(limits.engine!=='durable-object-sqlite'||limits.maxFileBytes<MAX)throw new Error('服务与脚本版本不匹配，请从自己的最新服务重新安装脚本。');
        if(limits.busy)throw new Error('服务正在处理另一本书，请等完成后再验证。');
        const auth=await check('/smtp-auth',value);
        if(auth.status!=='authenticated'||auth.smtpCode!==235)throw new Error('邮箱登录未确认，请检查 SMTP 配置。');
        if(typeof installerServiceIsCurrent==='function'&&!installerServiceIsCurrent(SERVICE))throw new Error('服务地址已更换，请关闭旧设置页并打开新服务。');
        GM_setValue('apiToken',value);verified=true;if(input)input.value='';
        connection.textContent='连接已验证，令牌已保存到本机油猴。现在可以启用书籍网站。';
        if(limits.configurationWarnings?.includes('MAILBOX_PREFIX_SIMILAR'))connection.textContent+=' 提醒：Kindle 与发件邮箱前缀相似，建议使用独立、难猜的 Kindle 前缀。';
        if(limits.configurationWarnings?.includes('CHECK_KINDLE_ADDRESS_DOMAIN'))connection.textContent+=' 提醒：请核对 Kindle 接收邮箱，避免误填登录邮箱。';
        if(openBook)openBook.disabled=false;
        if(siteStatus)siteStatus.textContent='连接已就绪。填入书籍详情页网址后启用此站。';
        status.setAttribute('data-token-state','verified');
      }catch(e){connection.textContent=e.message+' 未保存新值，也未发送邮件。';}
      finally{checking=false;save.disabled=false;if(input)input.disabled=false;status.setAttribute('data-setup-busy','false');}
    };
    if(openBook)openBook.onclick=event=>{
      if(!event.isTrusted||!verified)return;
      let url;
      try{url=new URL(document.getElementById('book-url').value);if(url.protocol!=='https:'||url.username||url.password||url.origin===SERVICE)throw new Error();}
      catch{siteStatus.textContent='请填写正常的 HTTPS 书籍详情页网址，不要填设置页、带账号密码的网址或非网页链接。';return;}
      GM_setValue('enabledOrigins',[...new Set([...GM_getValue('enabledOrigins',[]),url.origin])]);
      status.setAttribute('data-site-ready','true');
      siteStatus.textContent='已启用 '+url.origin+'，并请求打开新标签页。请在书籍页点击推送；若没有新标签页，手动打开原网址即可。';
      window.open(url.href,'_blank','noopener,noreferrer');
    };
    return;
  }

  const restricted = /premium|fast[\s_-]*download|会员|高速|付费|捐赠|donat|limit[\s_-]*exceeded|限额|次数用尽/i;
  function ordinaryLink(anchor, auto = true) {
    if (!anchor || !anchor.isConnected || !anchor.getClientRects().length) return false;
    const style = getComputedStyle(anchor);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
    if (anchor.closest('[hidden],[inert],[aria-disabled="true"],.disabled')) return false;
    let url;
    try { url = new URL(anchor.getAttribute('href'), location.href); } catch { return false; }
    if (url.protocol !== 'https:' || url.username || url.password || url.href === location.href) return false;
    if (restricted.test(anchor.textContent + ' ' + anchor.className + ' ' + anchor.title + ' ' + url.pathname + ' ' + url.search)) return false;
    // No undocumented endpoints. This simply identifies actual rendered ordinary /dl/ anchors.
    return !auto || /^\/dl\//i.test(url.pathname);
  }
  function candidates() {
    return [...document.querySelectorAll('a[href]')].filter(a => ordinaryLink(a));
  }
  function chosen() {
    if (selectedLink && ordinaryLink(selectedLink, false)) return selectedLink;
    const options = candidates();
    if (options.length === 1) return options[0];
    throw new Error(options.length ? '检测到多个下载入口。请用脚本菜单“选择本页普通下载入口”，明确选择普通 EPUB 下载。' : '未识别到唯一普通下载链接。请用脚本菜单选择可见普通下载入口；若按钮没有实际链接，请手动正常下载，再到 Worker /panel 上传。');
  }
  GM_registerMenuCommand('Kindle：选择本页普通下载入口', () => {
    if (!enabled) { notice('请先点击书籍页上的“在此站启用 Kindle 推送”。'); return; }
    if (busy) return;
    notice('请点击页面原有的普通 EPUB 下载链接。本次只选中，不下载。不要选择 Premium 或高速入口。');
    const capture = event => {
      const anchor = event.target.closest?.('a[href]');
      if (!anchor) return;
      event.preventDefault(); event.stopImmediatePropagation();
      document.removeEventListener('click', capture, true);
      if (!event.isTrusted || !ordinaryLink(anchor, false)) { notice('此链接不符合可见 HTTPS 普通下载入口条件。'); return; }
      selectedLink = anchor; mount();
      notice('已选择当前页普通入口。点击“推送 EPUB 到 Kindle”开始。');
    };
    document.addEventListener('click', capture, true);
    setTimeout(() => document.removeEventListener('click', capture, true), 30000);
  });

  function gm(options, max = 0) {
    if(typeof installerServiceIsCurrent==='function'&&!installerServiceIsCurrent(SERVICE))return Promise.reject(new Error('服务地址已更换，请刷新书籍页或打开新服务设置页。'));
    return new Promise((resolve, reject) => {
      let handle, stopped = false;
      handle = GM_xmlhttpRequest({ ...options,
        onprogress: e => {
          if (max && (e.loaded > max || (e.lengthComputable && e.total > max))) {
            stopped = true; handle.abort(); reject(new Error('下载超过 50 MB（50,000,000 字节），已停止。'));
          }
        },
        onload: resolve,
        onerror: () => reject(new Error('网络请求失败。若已开始上传，发送结果未知；请先检查收件箱和 Kindle，不要直接重试。')),
        ontimeout: () => reject(new Error('请求超时。若已开始上传，发送结果未知；不要直接重试。')),
        onabort: () => { if (!stopped) reject(new Error('请求已中止，发送结果可能未知。')); },
      });
    });
  }
  function looksLikeEpub(bytes) {
    if (bytes.length < 58) return false;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return v.getUint32(0, true) === 0x04034b50 && v.getUint16(8, true) === 0 &&
      v.getUint16(26, true) === 8 && v.getUint16(28, true) === 0 &&
      new TextDecoder().decode(bytes.subarray(30, 58)) === 'mimetypeapplication/epub+zip';
  }
  function filename() {
    const title = document.querySelector('h1')?.textContent || 'book';
    return title.replace(/[\x00-\x1f\x7f/\\]/g, ' ').trim().slice(0, 110).replace(/\.epub$/i, '') + '.epub';
  }
  async function download() {
    const anchor = chosen();
    // Resolve the existing href verbatim; do not invent tokens or switch endpoints/hosts.
    const url = new URL(anchor.getAttribute('href'), location.href).href;
    const headers = {};
    // Cookies are supplied by Firefox/Violentmonkey under its cookie/container policies.
    // No worker token, email auth code, or copied Cookie header goes to the book site.
    const response = await gm({ method: 'GET', url, headers, anonymous: false,
      responseType: 'blob', timeout: 600000 }, MAX);
    if (response.status !== 200) throw new Error('普通下载返回 HTTP ' + response.status + '。请在原站检查登录、额度或验证码；脚本不会重试或绕过。');
    if (response.finalUrl && !response.finalUrl.startsWith('https://')) throw new Error('下载被重定向到非 HTTPS 地址，已停止。');
    const type = /^content-type:\s*([^;\r\n]+)/im.exec(response.responseHeaders)?.[1].trim().toLowerCase();
    if (type && !['application/epub+zip', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed'].includes(type)) {
      throw new Error('普通下载没有返回 EPUB 文件，可能是登录/限制页面。请回原站处理。');
    }
    const data = response.response;
    if (!data || typeof data.size !== 'number' || !data.size || data.size > MAX || typeof data.slice !== 'function') throw new Error('文件为空、过大或二进制下载失败。');
    // Check only the short signature locally. The service validates the entire ZIP directory.
    // Keep the download as a Blob instead of another whole-file ArrayBuffer/Base64 string.
    const bytes = new Uint8Array(await data.slice(0, 58).arrayBuffer());
    if (!looksLikeEpub(bytes)) throw new Error('文件不是规范 EPUB；HTML 页面和普通 ZIP 不会上传。');
    return { data, name: filename() };
  }
  async function preflight() {
    const r = await gm({ method: 'POST', url: SERVICE + '/limits', anonymous: true,
      headers: { Authorization: 'Bearer ' + token() }, responseType: 'text', timeout: 30000 });
    let result;
    try { result = JSON.parse(r.responseText || r.response); } catch { throw new Error('服务版本检查失败。请先部署 50 MB 版及其绑定，并在 /panel 检查。'); }
    if (r.status !== 200 || !result.ok) throw new Error('服务检查失败：' + (result.error || ('HTTP ' + r.status)));
    if (result.engine !== 'durable-object-sqlite' || result.maxFileBytes < MAX) throw new Error('服务尚未升级到 50 MB 版；已停止，未消耗下载额度。');
    if (result.busy) throw new Error('服务正在处理另一本书，请等完成后再操作。');
  }
  async function upload(file) {
    const value = token();
    const response = await gm({ method: 'POST', url: SERVICE + '/push', anonymous: true,
      headers: { Authorization: 'Bearer ' + value, 'Content-Type': 'application/epub+zip',
        'X-Filename': encodeURIComponent(file.name), 'X-File-Size': String(file.data.size) },
      data: file.data, responseType: 'text', timeout: 900000,
      upload: { onprogress: e => {
        if (e.lengthComputable) notice('上传 ' + Math.round(e.loaded / e.total * 100) + '%；上传完成后还需等待 126 接收邮件，请保持页面打开。');
      } } });
    let result;
    try { result = JSON.parse(response.responseText || response.response); }
    catch { throw new Error('接口返回非 JSON（HTTP ' + response.status + '）。发送结果未知，请检查平台错误与邮箱；不要直接重试。'); }
    if (response.status !== 200 || !result.ok) {
      throw new Error((result.error || 'HTTP ' + response.status) + (result.stage ? '；阶段：' + result.stage : '') +
        (result.smtpCode ? '；SMTP：' + result.smtpCode : '') + '。不自动重试。');
    }
    notice('邮件服务已接收 EPUB，尚未确认 Kindle 入库。请等待同步并检查邮箱中的 Amazon 确认/退信。');
  }
  async function push(event) {
    if (!enabled || busy || !event.isTrusted) return;
    busy = true; pushButton.disabled = true;
    try {
      token(); // Check before consuming any download allowance.
      notice('正在检查 50 MB 服务是否就绪…');
      await preflight();
      lastDownload = null; // Release the previous book before starting another large download.
      notice('正在读取本页普通下载入口，请保持 Firefox 在前台…');
      const file = await download();
      lastDownload = file; // Retain for manual save; never automatically download/send again.
      notice('EPUB 已取得，正在上传并发送。请保持页面打开…');
      await upload(file);
    } catch (e) { notice(e.message); }
    finally { busy = false; pushButton.disabled = false; }
  }
  GM_registerMenuCommand('Kindle：保存刚才已下载的 EPUB', () => {
    if (!lastDownload) { notice('本页尚无已下载文件。'); return; }
    const url = URL.createObjectURL(lastDownload.data);
    const a = document.createElement('a'); a.href = url; a.download = lastDownload.name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    notice('已请求保存。若手机浏览器不支持此保存方式，请使用原站普通下载按钮。');
  });
  function mount() {
    if (document.getElementById('kindle-push-personal')) return;
    // Show setup even before opt-in, but only on a likely book detail page.
    const heading = document.querySelector('h1');
    if (!selectedLink && (!heading || (!/^\/book\/[^/]+/i.test(location.pathname) && !candidates().some(a => /epub/i.test(a.textContent))))) return;
    const host = document.createElement('div'); host.id = 'kindle-push-personal';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{display:block;margin:16px 0}button{font:16px system-ui;padding:12px 18px;background:#154b3d;color:white;border:0;border-radius:8px;cursor:pointer;min-height:44px}button:disabled{opacity:.55}p{font:14px/1.6 system-ui;white-space:pre-wrap;overflow-wrap:anywhere;color:#444;max-width:650px}';
    pushButton = document.createElement('button'); pushButton.type = 'button';
    output = document.createElement('p');
    const settings = document.createElement('a'); settings.href = SERVICE + '/panel'; settings.target = '_blank'; settings.rel = 'noopener noreferrer'; settings.textContent = '打开推送设置';
    if (!enabled) {
      pushButton.textContent = '在此站启用 Kindle 推送';
      pushButton.onclick = event => {
        if (!event.isTrusted) return;
        GM_setValue('enabledOrigins', [...new Set([...origins, location.origin])]);
        location.reload();
      };
      output.textContent = '正式脚本 3.2.0 已运行。先启用本站；此步骤不会下载书籍或发送邮件。';
    } else {
      pushButton.textContent = '推送 EPUB 到 Kindle'; pushButton.onclick = push;
      const configured = !!GM_getValue('apiToken', '');
      pushButton.disabled = !configured;
      output.textContent = configured ? '仅使用本页普通下载入口 · 最大 50 MB · 一次一本 · 不自动重试' : '还未设置本机令牌。请点击“打开推送设置”，保存已有 API_TOKEN 后返回刷新。';
    }
    root.append(style, pushButton, output, settings);
    if (heading) heading.insertAdjacentElement('afterend', host); else document.body.append(host);
  }
  mount();
  // Low-cost observer for late-rendered detail headings; never starts a request.
  let scheduled = false;
  new MutationObserver(() => { if (!scheduled) { scheduled = true; setTimeout(() => { scheduled = false; mount(); }, 300); } })
    .observe(document.body, { childList: true, subtree: true });
})();
