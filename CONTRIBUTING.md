# 参与开发

先阅读 README 与 SECURITY.md。请使用有权访问的文件，不提交商业电子书、真实邮箱、密钥或原始会话日志。

1. 安装 Node.js 24.15+，执行 `npm ci`。
2. 修改 `src/` 模板，文件上限只在 `project.config.json` 修改，版本只在 `package.json` 修改。
3. 执行 `npm test`；涉及平台调用时也执行 `npm run test:runtime`。
4. 执行 `npm run check:deploy` 与 `npm run check:release -- --allow-unpublished`。
5. PR 说明具体问题、行为变化、验证方式及尚未验证的外部限制。

`dist/`、`.test/` 是生成文件，不要提交。测试 SMTP 凭据必须是虚拟值；自动化测试不得向真实地址发信。需要真实验收时，维护者先明确目标账号/收件人，再单独进行，不在 CI 中调用 SMTP。

兼容性原则：不绕过 Premium 或下载限制、不关闭 TLS 校验、不自动重试未知发送、不把邮箱授权码放到浏览器、不通过公开 API 改收件人。

当前项目以 126/465 为验证基线；新增供应商应提供官方参数依据、协议差异说明和独立验证，不只替换主机名并宣称支持。

提交贡献表示你有权提供这些内容，并同意贡献以本项目 MIT 许可证发布。
