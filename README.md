# KDB Intelligent

面向 Gen2/Gen3 电池后台的 TypeScript SDK 和命令行工具。支持状态查询、Excel 导出、4G/蓝牙命令控制，以及参数读取与设置；不包含 OTA/系统升级。

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

### 面向自然语言 Agent 的统一入口

新项目建议使用 `battery`（中文别名 `电池`）命令族。它保留旧命令兼容性，但查询默认输出精简、稳定的 JSON，且未指定通道时默认使用 4G：

```bash
# 状态：编号、代际、4G、注册、模式、故障、充放电和最近上报
npm run --silent kdb -- battery status -b 40457BDE
npm run --silent kdb -- 电池 状态 -b 40457BDE --detail

# 当前模式；Gen3 返回 normal/test/lock/emergency 和中文名称
npm run --silent kdb -- battery mode get -b 40457BDE

# 中文命令别名；首次只预览，第二次明确确认才下发
npm run --silent kdb -- battery command send 锁电模式 -b 40457BDE
npm run --silent kdb -- battery command send 锁电模式 -b 40457BDE --confirm '<confirmationToken>'

# 参数可用 ID、别名、名称或关键词定位
npm run --silent kdb -- battery parameter find "极柱高温" -b 40457BDE
npm run --silent kdb -- battery parameter get "极柱高温触发阈值" -b 40457BDE
```

`--detail` 返回完整业务定义/基础信息；`battery status --raw` 返回完整后台对象。中文模式值支持“正常模式”“测试模式”“锁电模式”“应急模式”。命令结果需单独查询：Gen3 使用发送结果的 `sessionId`，Gen2 使用命令名匹配最近下发/回执日志：

```bash
npm run --silent kdb -- command result -b 40457BDE --session-id <sessionId>
npm run --silent kdb -- command result -b 959F1FDC --command 关机
```

`SENT` 表示后台接受 4G 下发，`ACKNOWLEDGED` 表示收到协议回执，均不等于物理效果已验证；`QUEUED_FOR_APP` 表示蓝牙任务等待手机 App；`PENDING` 表示尚无可匹配结果。

### 显式目标批量操作

批量操作只能通过重复的 `--battery-id` 或本地 `--battery-file <txt/csv>` 指定目标；文件可一行一个编号或逗号分隔。空项/重复项会跳过，单次最多 100 块，且不能混合 Gen2/Gen3。批量控制和参数写入只支持 4G，不支持“全部在线”等动态范围。

```bash
npm run --silent kdb -- batch status --battery-file targets.txt
npm run --silent kdb -- batch command send 关机 --battery-file targets.txt
# 取得完整预检和 confirmationToken 后，必须由用户明确确认：
npm run --silent kdb -- batch command send 关机 --battery-file targets.txt --confirm '<confirmationToken>'

npm run --silent kdb -- batch parameter read "极柱高温触发阈值" --battery-file targets.txt
npm run --silent kdb -- batch parameter write "极柱高温触发阈值" 81 --battery-file targets.txt
npm run --silent kdb -- batch export realtime --battery-file targets.txt --output-dir out/batch --hours 24
```

批量控制/写入预览会列出全部目标与逐块预检。任一块预检或确认后的复检失败时，整个批次不会下发；参数写入确认令牌还绑定每块电池的旧值、新值与参数定义。

查询一个电池的基础状态和最新上报：

```bash
npm run kdb -- status --battery-id 62413828
```

对于 Gen3，`status.summary.workingModeStatus` 表示最新实时上报的运行模式：`0` 正常、`1` 测试、`2` 锁电、`3` 应急；完整原始实时上报位于 `latestRealtime`。

查询当前是否可以直接下发命令（只读，不会发送探测命令）：

```bash
npm run kdb -- command-ready --battery-id 62413828
# 简写
npm run kdb -- ready -b 62413828
```

可以下发时进程退出码为 `0`；离线、不存在或网络状态未知时退出码为 `2`，因此可以直接用于脚本判断：

```bash
if npm run --silent kdb -- ready -b 62413828; then
  echo "可以继续执行下发"
else
  echo "当前不可下发"
fi
```

添加 `--json` 可获得适合程序处理的结构化结果。判定依据是后台电池基础表的 `lte4g_status`：`1` 在线、`2` 离线；同时查询设备注册表并显示注册信息。该状态由后台心跳任务维护，真正发送命令时后台还会再次检查实时 Netty 通道。

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

## 命令控制（4G 与蓝牙）

先列出当前电池、当前通道可用的命令：

```bash
npm run kdb -- command list -b 62413828 --channel 4g
npm run kdb -- command list -b 8F9AE708 --channel bluetooth
```

下发采用两步确认。第一次只返回 `confirmationToken`，不会写入后台；复制该令牌并以完全相同参数重复调用，才会真正下发：

```bash
# 第一次：预览（不会下发）
npm run kdb -- command send reboot -b 62413828 --channel 4g

# 第二次：执行（令牌有效期 5 分钟）
npm run kdb -- command send reboot -b 62413828 --channel 4g --confirm '<confirmationToken>'
```

Gen2 覆盖旧/新 4G 协议的仓储、复位、加热、强启、工作模式、锁定、解锁、关机等命令，以及后台实际支持的蓝牙复位、强启、智能加热、锁定、解锁、关机。Gen3 覆盖模式、功耗、电源、加热、充电限制、清除故障/极值、入库锁定等全部非 OTA 命令。4G 在提交前会检查当前可下发状态；蓝牙操作会进入网站任务队列，必须由手机 App 连接到电池后执行，因此 `QUEUED_FOR_APP` 不等同于设备已执行成功。

## 参数读取与设置（4G 与蓝牙）

参数可用 ID、英文名或别名定位：

```bash
npm run kdb -- parameter list -b 62413828
npm run kdb -- parameter read 12 -b 62413828 --channel 4g
npm run kdb -- parameter read --all -b 62413828 --channel 4g
```

写入同样必须先预览。CLI 会先读取旧值（或使用已确认的 `--current-value`），校验参数为 `RW`、数据类型和最小/最大值，再把旧值与新值绑定到确认令牌：

```bash
# 预览：会读取旧值，但不会设置
npm run kdb -- parameter write 12 42 -b 62413828 --channel 4g

# 执行：必须使用上一步返回的令牌
npm run kdb -- parameter write 12 42 -b 62413828 --channel 4g --confirm '<confirmationToken>'
```

Gen3 蓝牙参数读取会等待网站任务回填一小段时间；若手机尚未连接，结果为 `QUEUED_FOR_APP`。Gen2 蓝牙后台只保存 App 回传的原始报文，无法提供结构化的旧值回填；先通过 App/原始回报确认旧值后，使用 `--current-value <旧值>` 发起写入预览。两代蓝牙写入均只表示任务已排队，不表示参数已生效。

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

返回值同时包含：

- `summary`：跨 Gen2/Gen3 统一的常用状态字段。
- `details`：网站电池基础表返回的完整字段；Gen2 按电池管理 Excel 的 48 列、Gen3 按 55 列建模。
- `detailFieldLabels`：`details` 的字段名与网站 Excel 中文表头映射。
- `latestReport`：最新上报记录的完整原始字段。
- `latestRealtime`：Gen3 最新 Cycle01 实时上报，包含 `workingModeStatus`（`0` 正常、`1` 测试、`2` 锁电、`3` 应急）。
- `base/latest`：保留原有分页结构，兼容已有调用。

为保证结构稳定，`details` 会把后台省略的已知字段补为 `null`，同时保留后台返回的额外字段。

低层通用导出仍可通过 `exportExcel()` 使用，适合直接传递后台查询条件。

控制与参数 SDK：

```ts
import { createKdbClients, controlBatteryCommand, writeBatteryParameter } from "kdb_intelligent"

const clients = await createKdbClients()
const preview = await controlBatteryCommand({
  clients, batteryId: "62413828", channel: "4g", command: "reboot",
})
// 将 preview.confirmationToken 交由明确的人工/调用方确认后再传回。

const parameterPreview = await writeBatteryParameter({
  clients, batteryId: "62413828", channel: "4g", selector: "12", value: "42",
})
```

## 开发验证

```bash
npm run typecheck
npm test
```

`src/test/` 中的旧脚本会连接真实后台，不属于离线单元测试，运行前请确认 Token 和目标环境。

## OpenClaw Skill 维护

OpenClaw 的自然语言调用说明位于根目录 [SKILL.md](SKILL.md)。修改 CLI 命令、选项、默认值、输出结构、退出码、导出类型或安全行为时，必须在同一次变更中同步更新 `SKILL.md`，并运行 `npm test` 验证核心命令仍被覆盖。
