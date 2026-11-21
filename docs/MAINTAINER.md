# 维护者：审阅、发布与一键部署验收

本文给项目维护者。普通使用者只需 README 的部署按钮和设置步骤。

## 当前交付状态

源码、配置、文档、CI 和 MIT 已整理为独立项目。项目仓库为 [cdx2001/zlibrary-kindle-push](https://github.com/cdx2001/zlibrary-kindle-push)，README 部署按钮已指向该仓库。发布源码不会自动更新原有线上服务；每位使用者在自己的 Cloudflare 账号完成部署。真实的新用户部署验收范围见 docs/VALIDATION.md。

## 审阅重点

1. 阅读 README：尤其四个 Secrets、邮箱前缀建议、白名单、50 MB 限制、安装流程。
2. 看 `project.config.json`：文件上限集中维护；默认无需使用者修改。
3. 看 `wrangler.jsonc`：只部署一个 Worker 和 SQLite Durable Object，保留 migration 标签。
4. 看 `.dev.vars.example` 和 `package.json.cloudflare.bindings`：空值秘密名称及部署表单的解释。
5. 看 SECURITY.md：没有把“开源”或“SMTP 250”描述成数据无风险/已入库保证。
6. 看 docs/VALIDATION.md：区分历史用户实测、本地自动测试和尚未完成的新仓库一键部署验收。

## 本地检查

```sh
npm ci
npm test
npm run test:runtime
npm run check:deploy
npm run check:release -- --allow-unpublished
```

测试不会读取个人业务密钥，不连接真实 SMTP。`check:deploy` 是 dry-run，不创建或更新线上资源。GitHub CI 同样只做本地检查，不配置 Cloudflare 部署凭据。

## 填入仓库地址（不上传）

确定准备使用的 GitHub 账号和仓库名称，例如 `your-name/zlibrary-kindle-push`，执行：

```sh
npm run release:prepare -- your-name/zlibrary-kindle-push
npm run check:release
```

此命令更新 README 的部署与安装链接、移除审阅占位提示、更新 package.json 的 repository/bugs 元数据，并重新构建公开安装包；**不创建仓库，不执行 git push，也不部署 Cloudflare**。不改业务域名，因为服务地址会在运行时自动识别。

只在你确认要发布后，使用 GitHub 网页或自己的 Git 客户端创建公开仓库并上传此目录中的发布文件。不要上传上一级目录——那是自用项目的工作目录，不属于开源仓库。

`scripts/release-files.mjs` 列出发布白名单。不要上传 `node_modules`、`dist`、`.test`、`.wrangler`、本机环境文件、真实测试日志或邮箱退信截图。`.gitignore` 不会自动清除已经提交过的秘密；首次提交前必须检查暂存区。

## 公开后必须做的一次新用户验收

公开仓库和 Cloudflare/GitHub 授权是部署按钮的前提。未公开前只能完成配置、构建和运行时检查，不能声称新用户一键部署已端到端实测。

1. 使用未部署过该模板的测试账号/项目，点击 README 的按钮。
2. 确认它创建使用者自己的仓库副本，目标 Worker 名称正确。
3. 确认四个 Secret 字段出现且描述正确；无默认共享令牌，填写私下保存的测试凭据。
4. 确认构建使用 Node 24（`.node-version`），执行 `npm run build` 和 `npm run deploy`。
5. 确认 Free 计划可用、无需购买升级；`MAIL_SENDER` 自动绑定到 SQLite `MailSender`。
6. 打开生产网址，验证 `/setup`、脚本安装地址自动指向此测试实例，不指向维护者地址。
7. 按向导四步安装暴力猴和 Z-Library → Kindle Push，验证并保存；确认仅登录、不发邮件，然后在可选工具中测试普通邮件和原创小书。实际在 Kindle 打开后才记录通过。
8. Windows 与 Android 分别完成向导并在有权访问的 Z-Library 详情页推送。旧名脚本先停用，新版重新配置，确认没有重复按钮；测试镜像换域名后的启用行为。
9. 检查错误提示与退信，记录实际使用版本和字节数，不保存密钥或完整邮件对话。

Cloudflare 一键按钮支持公开 GitHub/GitLab 仓库并自动配置资源；本项目按官方规范接入，不使用虚假的仓库 URL 或额外托管服务。[官方按钮文档](https://developers.cloudflare.com/workers/platform/deploy-buttons/)

## 版本与回滚

版本号在 `package.json` 维护（同步 lockfile 的版本元数据），执行 `npm run build` 并提交生成的 `install/zlibrary-kindle-push.user.js`，否则可重复构建测试会失败；更新 CHANGELOG。升级依赖后提交 lockfile 并运行所有检查。当前 `miniflare` 固定到 Wrangler 对应的已测试版本（含 beta 标签），它仅是开发/测试依赖，不是生产 SMTP 依赖；升级时应一起核对其 API。

更新既有实例前等待 busy:false，记录旧部署版本。回滚到旧代码时保留已创建的 DO 绑定和迁移历史，不为了“清理”添加删除类 migration；也不要在有请求时切换代码。回滚后的脚本版本与上限需要重新核对。

公开安装包使用 main 分支更新地址。验证 README 的暴力猴按钮指向 Mozilla 官方页面，安装按钮返回带 userscript 元数据的正式脚本。Windows/Android 的真实扩展安装弹窗仍需浏览器验收；自动测试不代替这一步。
