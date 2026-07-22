# KDB Copilot Desktop

独立于根目录 CLI 的 Electron + React 桌面应用。

```bash
cd desktop
npm install
npm run dev
```

首次启动在设置页填写 DeepSeek API Key。安装版自带网页 API 的 `kdb.toml` 模板；若要使用本地历史库，请在设置中选择你自己的 KDB 配置根目录（其中应有 `config/kdb.toml` 与未提交的 `config/kdb.local.toml`）。桌面端在启动前会构建根目录 SDK，但不会修改根目录的依赖清单。

构建安装包：

```bash
npm run dist:mac
npm run dist:win
```

`dist:mac` 输出未签名的 arm64 DMG；发布给其他机器前需要按你的 Apple 开发者证书进行签名和公证。
