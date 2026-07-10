# KDB Intelligent

面向 Gen2/Gen3 电池后台的 TypeScript SDK 和命令行工具。目前支持状态查询，以及电池基础信息、实时数据和多类日志的 Excel 导出。

## 安装与配置

需要 Node.js 20 或更高版本。

```bash
npm install
cp config/kdb.local.example.toml config/kdb.local.toml
npm run build
```

在 `config/kdb.local.toml` 中分别填写 Gen2、Gen3 Bearer Token。该文件已加入 `.gitignore`，不要提交到版本库。

开发期间可以通过 `npm run kdb --` 直接运行 CLI；构建后可使用 `node dist/interfaces/cli/cli.js`。如果将本包安装到其他项目或执行 `npm link`，命令名为 `kdb`。

## 一条命令导出实时数据

```bash
npm run kdb -- export realtime \
  --battery-id 8F9AE708 \
  --start "2026-07-01 00:00:00" \
  --end "2026-07-02 00:00:00"
```

CLI 会根据电池编号自动判断代际：`4/6` 开头为 Gen3，`5/8/9` 开头为 Gen2，并自动选择对应接口和时间字段。

导出最近 6 小时并指定文件名：

```bash
npm run kdb -- export realtime -b 62413828 --hours 6 -o out/realtime.xlsx
```

时间选项：

- `--start`：开始时间；不传时根据 `--hours` 计算。
- `--end`：结束时间；默认当前时间。
- `--hours`：回溯小时数，默认 24。
- 时间支持 `YYYY-MM-DD HH:mm:ss` 或标准 ISO 8601 格式。

## 其他 CLI 能力

查询一个电池的基础状态和最新上报：

```bash
npm run kdb -- status --battery-id 62413828
```

使用任意已实现的导出类型：

```bash
npm run kdb -- export batteryBase --generation gen3 --query batteryStatus=1
npm run kdb -- export nettyLog -b 8F9AE708 --hours 24
npm run kdb -- export latestBatteryTable -b 8F9AE708
```

通用导出支持以下类型：

- 两代共有：`batteryBase`
- Gen2：`latestBatteryTable`、`nettyLog`、`statusNettyLog`、`bluetoothCommandTasks`、`realtimeMsgLog`
- Gen3：`reportBatteryLog`、`cycle01MsgLog`、`statusCommandLog`

可重复使用 `--query key=value` 传顶层查询条件，使用 `--param key=value` 传 `params[key]` 条件：

```bash
npm run kdb -- export reportBatteryLog \
  -b 62413828 \
  --query orderByColumn=logTime \
  --param beginLogTime="2026-07-01 00:00:00" \
  --param endLogTime="2026-07-02 00:00:00"
```

使用 `npm run kdb -- --help` 查看完整帮助。

## SDK 使用

高层实时数据导出 API 会处理代际判断、时间范围和接口映射：

```ts
import { createKdbClients, exportBatteryRealtimeData } from "kdb_intelligent"

const clients = await createKdbClients()
const result = await exportBatteryRealtimeData({
  clients,
  batteryId: "8F9AE708",
  start: "2026-07-01 00:00:00",
  end: "2026-07-02 00:00:00",
  outputPath: "out/realtime.xlsx",
})

console.log(result.outputPath)
```

状态查询：

```ts
import { createKdbClients, queryBatteryStatusById } from "kdb_intelligent"

const clients = await createKdbClients()
const status = await queryBatteryStatusById({ clients, batteryId: "62413828" })
```

低层通用导出仍可通过 `exportExcel()` 使用，适合直接传递后台查询条件。

## 开发验证

```bash
npm run typecheck
npm test
```

`src/test/` 中的旧脚本会连接真实后台，不属于离线单元测试，运行前请确认 Token 和目标环境。
