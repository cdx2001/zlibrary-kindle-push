// Only temporary browser memory. No requests, storage, or URL parameters.
const names = ['API_TOKEN', 'SMTP_USER', 'SMTP_AUTH_CODE', 'KINDLE_EMAIL'];
const fields = names.map(name => document.getElementById('value-' + name));
const status = document.getElementById('parameter-status');
const say = message => { status.textContent = message; };

function problem(field) {
  const value = field.value;
  const name = field.id.slice(6);
  if (!value) return name + ' 尚未填写。';
  if (name === 'API_TOKEN' && !/^[\x21-\x7e]{32,256}$/.test(value))
    return 'API_TOKEN 需为 32–256 位可见 ASCII 字符，不能含空格；可点击生成。';
  if (name === 'SMTP_AUTH_CODE' && !/^[\x21-\x7e]{1,256}$/.test(value))
    return 'SMTP_AUTH_CODE 不能含空格或中文，长度不超过 256 位。';
  if (name.endsWith('EMAIL') || name === 'SMTP_USER') {
    if (value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value))
      return name + ' 请填写完整邮箱地址，检查空格和中文符号。';
    if (name === 'SMTP_USER' && !/@126\.com$/i.test(value))
      return 'SMTP_USER 必须是完整的 @126.com 发件地址。';
  }
  return '';
}

document.querySelectorAll('[data-toggle]').forEach(button => {
  button.addEventListener('click', () => {
    const field = document.getElementById(button.dataset.toggle);
    const hide = field.type === 'text';
    field.type = hide ? 'password' : 'text';
    button.textContent = hide ? '显示' : '隐藏';
    button.setAttribute('aria-label', (hide ? '显示 ' : '隐藏 ') + field.id.slice(6));
  });
});

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const field = document.getElementById(button.dataset.copy);
    const error = problem(field);
    if (error) { say(error); field.focus(); return; }
    try {
      await navigator.clipboard.writeText(field.value);
      say('已复制 ' + field.id.slice(6) + '；到 Cloudflare 同名输入框全选后粘贴。');
    } catch {
      field.type = 'text';
      const toggle = document.querySelector('[data-toggle="' + field.id + '"]');
      toggle.textContent = '隐藏';
      toggle.setAttribute('aria-label', '隐藏 ' + field.id.slice(6));
      field.focus(); field.select();
      say('浏览器未允许自动复制，已选中内容，请手动复制。');
    }
  });
});

document.getElementById('generate-parameter-token').addEventListener('click', () => {
  if (fields[0].value && !window.confirm('生成新值会替换这里的令牌。若已经部署，Cloudflare 和所有浏览器也必须改为新值。继续吗？')) return;
  fields[0].value = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  say('已生成 64 位 API_TOKEN。请私下保存；本页刷新后不保留。');
});
document.getElementById('check-parameters').addEventListener('click', () => {
  for (const field of fields) {
    const error = problem(field);
    if (error) { say(error); field.focus(); return; }
  }
  const warning = /@(?:free\.)?kindle\.com$/i.test(fields[3].value)
    ? '' : ' Kindle 接收邮箱域名不常见，请再次与 Amazon 设备设置核对。';
  say('四项格式检查通过。' + warning + ' 这不验证邮箱授权码是否有效，也不代表已部署；请逐项复制到 Cloudflare。');
});

function clearFields() {
  fields.forEach(field => { field.value = ''; });
  say('四项内容已清空。已复制的剪贴板内容请自行处理。');
}
document.getElementById('clear-parameters').addEventListener('click', () => {
  if (!fields.some(field => field.value) || window.confirm('清空本页四项内容？请先保存需要保留的值。')) clearFields();
});
// Also clear browser back/forward-cache copies of this document.
window.addEventListener('pagehide', clearFields);
window.addEventListener('pageshow', event => { if (event.persisted) clearFields(); });
fields.forEach(field => { field.value = ''; field.addEventListener('input', () => say('修改后可重新检查格式并复制。')); });
