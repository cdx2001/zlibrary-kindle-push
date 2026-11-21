  // Included only in the public installer. No service address or secret is shared.
  function installerServiceIsCurrent(origin) {
    return GM_getValue('serviceOrigin', '') === origin;
  }
  function resolveService() {
    const project = '__PROJECT_URL__';
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
