# Z-Library → Kindle Push

从 **Z-Library 书籍详情页**，将你有权使用的 EPUB 一键推送到 Kindle。使用 Cloudflare Workers + 126 SMTP，在免费配额内运行，无需购买服务器。

## [开始配置 →](https://cdx2001.github.io/zlibrary-kindle-push/)

打开配置页，按引导完成 **四个参数准备 → 部署服务 → 安装暴力猴和推送脚本 → 连接使用**。所需网页、API_TOKEN 生成器和操作步骤都在其中，正常安装无需修改代码或复制脚本。

## 支持范围

| 项目 | 说明 |
| --- | --- |
| 浏览器 | Windows Firefox、支持暴力猴的 Android Firefox；分别安装和配置，不支持 iOS |
| 文件 | EPUB，最大 **50,000,000 字节（50 MB）**，一次一本；也支持本地上传 |
| 免费条件 | Workers Free + SQLite Durable Object，在账号共享免费配额内运行；超额可能失败，Paid 账号按其套餐计费 |
| 下载入口 | 只使用原有普通下载入口，不绕过会员、验证码或下载次数限制 |

## 使用提醒

- **50 MB 是程序上限，不是投递保证。** SMTP 接收后，还需 Amazon 转换及 Kindle 同步；首次用小 EPUB 实际收书验证。
- 发送期间保持页面打开。超时或结果未知时先查邮箱和 Kindle，不要直接重复发送。
- 只连接自己的服务，私下保存令牌与邮箱授权码，不提交 GitHub 或公开分享。

<details>
<summary>排错、开发与项目说明</summary>

[完整指南与排错](docs/SETUP.md) · [架构与 API](docs/ARCHITECTURE.md) · [维护与发布](docs/MAINTAINER.md) · [验证范围](docs/VALIDATION.md) · [安全说明](SECURITY.md) · [参与开发](CONTRIBUTING.md)

</details>

[MIT 许可证](LICENSE)。非 Z-Library、Amazon、网易、Mozilla、Violentmonkey 或 Cloudflare 官方项目。
