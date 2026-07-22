# KDB Copilot Desktop

独立于根目录 CLI 的 Electron + React 桌面应用。

```bash
cd desktop
npm install
npm run dev
```

首次启动在设置页填写 DeepSeek API Key。应用会把 `kdb.toml` 与 `kdb.local.toml` 模板复制到自身用户数据目录；在设置中选择“编辑应用内 KDB 配置”即可填写网页 Token 与本地历史库连接。桌面端不会读取或修改外部项目配置，也不会修改根目录 CLI 的依赖清单。

构建安装包：

```bash
npm run dist:mac
npm run dist:win
```

`dist:mac` 输出未签名的 arm64 DMG；发布给其他机器前需要按你的 Apple 开发者证书进行签名和公证。
