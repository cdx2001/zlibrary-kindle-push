# Z-Library → Kindle Push

从 **Z-Library 书籍详情页**，将你有权使用的 EPUB 一键推送到 Kindle。使用 Cloudflare Workers + SQLite Durable Object + 126 SMTP，无需购买服务器；正常安装无需改代码或复制脚本。

<p>
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/cdx2001/zlibrary-kindle-push" target="_blank" rel="noopener noreferrer"><img src="tools/assets/deploy.svg" width="232" height="48" alt="1 部署到 Cloudflare"></a>
  <a href="https://addons.mozilla.org/firefox/addon/violentmonkey/" target="_blank" rel="noopener noreferrer"><img src="tools/assets/violentmonkey.svg" width="232" height="48" alt="2 安装暴力猴"></a>
  <a href="https://raw.githubusercontent.com/cdx2001/zlibrary-kindle-push/main/install/zlibrary-kindle-push.user.js" target="_blank" rel="noopener noreferrer"><img src="tools/assets/userscript.svg" width="232" height="48" alt="3 安装推送脚本"></a>
</p>

**[打开在线安装与四参数配置页](https://cdx2001.github.io/zlibrary-kindle-push/)** · **[直接生成 API_TOKEN](https://cdx2001.github.io/zlibrary-kindle-push/token-generator.html)**

三个按钮均为 232 × 48。在线配置页的链接默认新标签页打开；GitHub README 可能过滤 `target` 属性，如需新开请用在线页，或右键“在新标签页中打开”。

**在 Firefox 中依次点击上面三个按钮，已有的步骤可跳过。** 浏览器的安装确认仍需本人点击；扩展装好后，还要安装推送脚本并连接自己的服务。

| 支持范围 | 说明 |
| --- | --- |
| 浏览器 | Windows Firefox、支持暴力猴的 Android Firefox；各自安装和配置，不支持 iOS |
| 文件 | EPUB，最大 **50,000,000 字节（50 MB，不是 50 MiB）**；一次一本，也支持本地上传 |
| 免费条件 | 使用 Workers Free 与 SQLite Durable Object，在账号共享免费配额内运行；超额可能失败，Paid 账号按其套餐计费 |
| 使用边界 | 只用原有普通下载入口，不绕过会员、验证码或下载次数限制，不提供书籍资源或镜像清单 |

## 快速开始

### 1. 依次取得四个参数

下面四项是部署的核心。请先私下保存，再按**完全相同的名称**填写到 Cloudflare；不要贴到 GitHub 或聊天中。

**① `API_TOKEN`：由你自己生成的访问令牌**

1. 打开 **[API_TOKEN 生成器](https://cdx2001.github.io/zlibrary-kindle-push/token-generator.html)**，无需下载 HTML。
2. 点击 **生成新令牌 → 复制令牌**，得到 64 位随机字符串，并保存在自己的密码管理器中。
3. 部署时填入 `API_TOKEN`；之后浏览器连接服务时使用同一个值。它**不是 Cloudflare 账号 API Token**，不需要去 Cloudflare 申请。生成器只在本机生成，不上传、不持久保存令牌；刷新即清空。

**② `SMTP_USER`：完整的 126 发件邮箱**

1. 打开 **[126 邮箱（mail.126.com）](https://mail.126.com/)**，登录用于发信的账号；没有账号则从该页“注册新账号”进入。
2. 查看邮箱页面显示的当前账号，复制包含 `@126.com` 的完整地址，例如 `你的账号@126.com`。
3. 把这个地址填入 `SMTP_USER`。它不是密码，稍后 Amazon 白名单也要填这个地址。

**③ `SMTP_AUTH_CODE`：126 客户端授权码**

1. 仍在 **[126 邮箱](https://mail.126.com/)**，进入 **设置 → POP3/SMTP/IMAP**。
2. 开启包含 SMTP 的客户端服务，按提示完成手机或安全验证；已开启时选择 **新增授权密码/授权码**。
3. 复制页面新生成的客户端授权码，填入 `SMTP_AUTH_CODE`，并私下保存。它通常只显示一次，**不是网页登录密码**，必须与 `SMTP_USER` 属于同一个账号。[网易官方操作说明](https://help.mail.126.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac2a5feb28b66796d3b)

**④ `KINDLE_EMAIL`：Kindle 接收邮箱**

1. 打开 **[Amazon 管理内容和设备（美国站）](https://www.amazon.com/hz/mycd/myx)**；若设备注册在其他地区，使用对应站点：[日本站](https://www.amazon.co.jp/hz/mycd/myx) / [英国站](https://www.amazon.co.uk/hz/mycd/myx)。登录与 Kindle 相同的账号。
2. 进入 **偏好设置 / Preferences → 个人文档设置 / Personal Document Settings → 发送至 Kindle 电子邮箱设置**。
3. 找到接收设备或 App，复制其完整接收邮箱，填入 `KINDLE_EMAIL`。这是 Kindle 接收地址，**不是 Amazon 登录邮箱**。
4. 在同页 **已认可的发件人电子邮箱列表**中添加第 ② 步的完整 126 地址，否则可能无法收书。若菜单不同，从 Amazon“账号 → 管理您的内容和设备”进入。[Amazon 官方邮件说明](https://digprjsurvey.amazon.com/csad/help/node/G7NECT4B4ZWHQ8WV)

**Kindle 地址的 `@` 前缀建议独立、难猜，不照搬发件邮箱。** 例如不建议两个地址都以 `reader_2026@` 开头；这不是禁止所有相同字符，也不保证免于 Amazon 邮件确认。改地址后同步更新 `KINDLE_EMAIL`。[示例与说明](docs/SETUP.md#2-设置-kindle-邮箱和白名单)

### 2. 把四个值部署到 Cloudflare

1. 打开 **[一键部署入口](https://deploy.workers.cloudflare.com/?url=https://github.com/cdx2001/zlibrary-kindle-push)**，按提示登录自己的 Cloudflare 和 GitHub；在表单中分别填写 `API_TOKEN`、`SMTP_USER`、`SMTP_AUTH_CODE`、`KINDLE_EMAIL`。
2. 如果没有四个字段，打开 **[Cloudflare 控制台](https://dash.cloudflare.com/)** → **Workers & Pages → 你的 Worker → Settings → Variables and Secrets → Add**。类型选 **Secret**，Name 填参数名，Value 填刚才取得的值；逐项添加后保存并部署。具体 Worker 页面需从自己的账号进入，没有所有人通用的直达链接。
3. 若出现 **Failed to get repository contents**，返回创建应用首页，改用 **连接 GitHub / 导入自己账号仓库**，授权并选择 `cdx2001/zlibrary-kindle-push`、分支 `main`，不再重复粘贴公开仓库 URL。
4. 构建参数如需填写：仓库根目录、Node.js 24.15+、构建 `npm run build`、部署 `npm run deploy`；绑定由项目配置提供。
5. 部署成功后，在 Worker 的 **访问 / Visit** 或域名区域复制 `https://你的服务.你的子域.workers.dev`。这是下一步脚本要连接的**服务网址**，不是 GitHub 或 Z-Library 网址。这里的示例不可直接使用。[完整部署说明](docs/SETUP.md#5-一键部署到-cloudflare)

### 3. 安装、连接并启用网站

1. 在实际使用的 Firefox 点击顶部 **安装暴力猴**，进入官方商店确认添加；再点击 **安装推送脚本**，在暴力猴中确认安装。
2. 返回本仓库刷新，顶部会出现连接栏。填入自己的 Worker 网址，点 **连接我的服务，继续配置**；也可直接打开自己的 `/setup` 页面并确认预填网址。**仓库页面只填网址，不填令牌。**
3. 在自己的服务页面输入 `API_TOKEN`，点 **验证连接并保存**。服务和 SMTP 登录验证成功后才保存到本机；**此步骤不发邮件**。已有保存值时可留空验证。
4. 点 **继续启用书籍网站**，填写自己正常使用的 Z-Library HTTPS 书籍详情页网址，点 **启用此站并打开书籍页**。
5. 在书籍页点 **推送 EPUB 到 Kindle**，等待同步。首次先用一份小 EPUB，实际在 Kindle 打开确认。

没有连接栏时，刷新页面或使用暴力猴菜单 **Kindle：连接或更换自己的 Cloudflare 服务**。也可全程使用自己服务的四步向导；它提供的脚本已绑定当前服务，与公开安装包任选其一。电脑和手机须分别配置。[Windows / Android 详细安装及备用方法](docs/SETUP.md#7-安装与配置详解)

## 日常使用与限制

- 发送期间保持页面打开，安卓尽量让 Firefox 留在前台；换站点域名或镜像后重新启用。启用网站不会自动下载或发信。
- 下载入口无法识别时，用脚本菜单选择页面原有的普通 EPUB 链接；需要验证码或站内操作时，正常下载后在自己 `/setup` 页的 **手动上传与邮件排错** 中上传。
- **50 MB 是程序上限，不是投递保证**：编码后整封邮件约 68.4 MB，仍受 126 和 Amazon 限制。SMTP 返回 `250` / `smtp_accepted` 只表示 126 接收，不能证明 Kindle 入库；`deliveredToKindle:false` 表示无法确认。
- 超时或结果未知时，先查邮箱和 Kindle，**不要直接重复发送**。本项目不自动重试，不去除 DRM，ZIP 检查也不等于完整 EPUB 校验。

## 配置与更新

- **邮箱、授权码、令牌**：在 Cloudflare Secrets 修改并部署。换发件邮箱还要更新 Amazon 白名单；换 API_TOKEN 后每台浏览器重新保存。
- **更换服务**：公开脚本的连接菜单会清除旧令牌，随后在新服务验证；不会把旧令牌发给新服务。浏览器只保存服务地址、令牌和启用站点，不保存邮箱授权码。
- **文件上限**：`project.config.json` 中的 `maxFileMB`，范围 1–50；改后重新构建、部署，并安装该实例生成的脚本。
- **升级**：同步项目后重新部署 Worker、更新脚本；仅更新 GitHub 不会更新未连接自动构建的 Worker。旧的“下载测试 0.1”或“Kindle Push — 普通 EPUB 下载推送”需停用，再配置本版，避免重复按钮。升级旧实例要保留原 Worker 名、Secrets、绑定和迁移历史。[升级与停用详情](docs/SETUP.md#修改更新和停用)

## 常见问题

| 现象 | 先检查 |
| --- | --- |
| 安装链接只显示代码 / 没有推送按钮 | 是否在 Firefox、暴力猴与正式脚本是否启用；刷新页面，连接自己的服务并启用当前站点 |
| 401 / `UNAUTHORIZED` | 浏览器中的 API_TOKEN 是否与 Cloudflare 一致 |
| SMTP 登录 535 | SMTP 是否开启、完整发件地址与客户端授权码是否正确 |
| 413 / 文件过大 | 原文件上限及 SMTP 公布的整封邮件 SIZE；50 MiB 已超过默认上限 |
| 返回 250 但未收书 | Amazon 白名单、验证邮件、退信、垃圾箱及 Kindle 账号/联网同步；不能只凭 E999 判断超限 |

更多错误码、绑定缺失、安装备用方法和[小测试书验收](docs/SETUP.md#9-手动上传与首次收书验收可选)，见[完整指南](docs/SETUP.md)与[排错表](docs/SETUP.md#常见问题)。

## 开发与文档

普通使用者不需要 Node.js 或 Git。开发使用 Node.js 24.15+：

```sh
npm ci
npm run build
npm test
npm run test:runtime
npm run check:deploy
```

测试不发送真实邮件；`check:deploy` 仅打包检查。修改源码后须提交构建生成的 `install/zlibrary-kindle-push.user.js`；不要提交 `dist/`、密钥或真实测试日志。

[完整使用指南](docs/SETUP.md) · [架构与 API](docs/ARCHITECTURE.md) · [维护与发布](docs/MAINTAINER.md) · [验证范围](docs/VALIDATION.md) · [安全说明](SECURITY.md) · [参与开发](CONTRIBUTING.md)

[MIT 许可证](LICENSE)。非 Z-Library、Amazon、网易、Mozilla、Violentmonkey 或 Cloudflare 官方项目。
