# 架构与 API

## 构建与配置

`scripts/build.mjs` 读取 `package.json` 的版本及 `project.config.json` 的上限，将 Worker、userscript 模板和 setup.html/setup.js 构建成 `dist/worker.js`。userscript 作为文本内嵌，不是 Worker 运行时导入的浏览器代码。

`GET /kindle-push.user.js` 使用当前请求 origin 填入脚本的服务地址、下载地址和设置页地址；只接受合法 HTTPS origin。版本和文件上限来自同一次构建。SMTP EHLO 和 Message-ID 域名使用发起业务请求的服务 hostname，无个人主机名常量。

`wrangler.jsonc` 只声明平台配置。Secret 名称在 `secrets.required` 中声明，`.dev.vars.example` 为一键部署提供输入名称，`package.json.cloudflare.bindings` 提供表单说明。四个值从不参与公开构建或脚本生成。

## 运行时

1. 普通 Worker 先验令牌、方法、文件声明和头部，再把请求流传给固定名称的 `MailSender`。
2. Durable Object 采用 SQLite 类型以支持 Free 计划；本实现没有写入 SQLite 数据。
3. 对象 busy 锁串行处理；按受限声明大小分配一个文件缓冲区，逐块读取，防止整本分块和拼接副本同时驻留。
4. 验证 ZIP 目录与 EPUB 必要条目后，通过 `cloudflare:sockets` 建立 TLS 465。
5. 解析 SMTP 多行回复，选择 PLAIN/LOGIN；若服务器声明 SIZE，则在 DATA 前比较整封 MIME 长度。
6. 附件编码为带 CRLF 的 Base64，按小段写出，不建立一整封大邮件字符串。50 MB 测试中单个编码段最大 79,872 字节。
7. DATA 最终 250 才返回 `smtp_accepted`；提交终止标志后的回执不确定时返回未知结果，不重试。

参考：[Cloudflare TCP Socket API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)。本项目针对该 API 编写，不假设通用 SMTP 库或完整 Node 网络栈可直接在 Workers 使用。

## HTTP 接口

所有业务接口使用 HTTPS、POST，要求 `Authorization: Bearer <API_TOKEN>`；不允许 query 参数传令牌，不授予 CORS。

| 方法与路径 | 认证 | 用途 |
| --- | --- | --- |
| `GET /` | 无 | 跳转 `/setup` |
| `GET /setup`、`GET /panel` | 无 | 安装、设置与测试页面，不返回秘密 |
| `GET /kindle-push.user.js` | 无 | 当前服务对应的脚本，不含秘密 |
| `POST /limits` | 必需 | 版本、上限、busy 状态及非敏感配置提示 |
| `POST /smtp-auth` | 必需 | 仅登录，不发邮件 |
| `POST /smtp-test` | 必需 | 固定发给 SMTP_USER 自己的普通邮件 |
| `POST /push` | 必需 | 原始 EPUB 二进制；固定发给 KINDLE_EMAIL |

`/push` 请求头：

```http
Authorization: Bearer <private-token>
Content-Type: application/epub+zip
X-Filename: <encodeURIComponent(filename.epub)>
X-File-Size: <exact decimal bytes>
```

请求体是文件本身，不是 multipart/form-data、JSON、Base64 或下载 URL。Content-Length 若存在，必须和 X-File-Size 相等；没有 X-File-Size 时可用 Content-Length。最大字节数由构建配置决定。

成功返回示意：

```json
{
  "ok": true,
  "status": "smtp_accepted",
  "smtpCode": 250,
  "recipient": "kindle",
  "attachmentBytes": 2108,
  "deliveredToKindle": false
}
```

真实返回还包含 messageId、messageBytes、requestId、version、engine。不要把 messageId 当去重凭据；程序没有持久去重。

失败返回 `ok:false`、`error`，适用时带 `stage`、`smtpCode`，以及 `automaticRetry:false`。HTTP 401/411/413/415/429 分别用于鉴权、声明缺失、大小、文件格式和当前忙碌；SMTP 或连接异常可能为 502/504，平台中断为 503。

## 时间与内容限制

- 上传最长 300 秒；SMTP 单次 I/O 60 秒、总事务 480 秒；客户端整个上传/发信等待 900 秒。
- 下载请求最多等待 600 秒；限制 Blob 大小，不在浏览器端整本转成 Base64。
- 支持 ZIP 方法 0/8，最多 16,384 个目录条目；不支持 ZIP64、多卷、ZIP 加密；不解压、不校验每个条目的 CRC 或完整 OPF 语义，不做 DRM 移除。
- 当前没有多用户隔离、队列、后台补发、离线任务或收书回执系统。

## 配置警告

`MAILBOX_PREFIX_SIMILAR`：两个 @ 前缀完全相同，或较短前缀至少 4 个字符且被另一前缀包含。该规则只提供可理解的提醒，绝不是 Amazon 官方风控算法。`CHECK_KINDLE_ADDRESS_DOMAIN` 提醒核对不是常见 Kindle 域名的地址。警告不暴露邮箱，不自动修改配置或阻止发送。

## 四步向导与脚本的分工

`src/setup.html` 提供界面，`src/setup.js` 控制导航、备用安装和可选手动测试。Worker 为内联样式和脚本分配 CSP nonce；不加载第三方页面资源。

正式 userscript 通过 `data-script-version`、`data-token-state`、`data-site-ready` 等非敏感 DOM 属性向页面报告进度。它们只是显示状态，不是安全凭据；服务仍逐请求检查 Authorization。未收到脚本响应不能推断暴力猴未安装。

用户真实点击“验证连接并保存”后，脚本从输入框或私有存储取令牌，依次请求 `/limits` 和 `/smtp-auth`。全部通过才更新 GM 存储并清空输入框。不会调用 `/smtp-test` 或 `/push`，不会向书籍站点请求文件，也不会把已存令牌回填 DOM。手动测试工具只读用户临时输入的值。

启用站点需要本次连接验证通过及真实点击；只接受不含用户名/密码的 HTTPS URL，排除当前服务 origin。持久保存 origin，按用户输入的完整网址打开新页，使用 noopener/noreferrer。启用站点不会自动推送；书籍页另一次真实点击才开始下载、上传。

脚本显示名称自本版变更为 Z-Library → Kindle Push，内部 namespace 和 `/kindle-push.user.js` 地址保留。不同名称可能拥有不同私有存储；旧用户停用旧条目并重新配置，不做隐式跨脚本读取或秘密迁移。
