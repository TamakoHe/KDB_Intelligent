export type BatteryGeneration = "gen2" | "gen3"
export type ControlChannel = "4g" | "bluetooth"

export type BatteryCommandDefinition = {
  name: string
  label: string
  /** 用户或 OpenClaw 可直接使用的中英文业务同义词。 */
  aliases: string[]
  generation: BatteryGeneration
  channels: ControlChannel[]
  description: string
  value?: { name: string; description: string; required: boolean }
  gen2?: { fourGMsgType?: string; bluetoothOperateType?: string }
  gen3?: { msgType: string; msgSubType: string }
}

const GEN2: BatteryCommandDefinition[] = [
  { name: "upload-interval", label: "设置上报间隔", aliases: ["上报间隔", "设置上报间隔"], generation: "gen2", channels: ["4g"], description: "设置 4G 数据上报间隔，后台限制最大 655 秒", value: { name: "seconds", description: "1~655 秒", required: true }, gen2: { fourGMsgType: "1" } },
  { name: "enter-storage", label: "进入仓储/运输模式", aliases: ["进入仓运", "进入仓储", "仓运模式"], generation: "gen2", channels: ["4g"], description: "旧协议命令", gen2: { fourGMsgType: "2" } },
  { name: "exit-storage", label: "退出仓储/运输模式", aliases: ["退出仓运", "退出仓储"], generation: "gen2", channels: ["4g"], description: "旧协议命令", gen2: { fourGMsgType: "3" } },
  { name: "reset", label: "复位", aliases: ["复位", "重置"], generation: "gen2", channels: ["4g", "bluetooth"], description: "复位电池", gen2: { fourGMsgType: "5", bluetoothOperateType: "02" } },
  { name: "wechat-log-toggle", label: "切换微信日志", aliases: ["微信日志"], generation: "gen2", channels: ["4g"], description: "切换后台微信日志标志", gen2: { fourGMsgType: "6" } },
  { name: "heat", label: "加热", aliases: ["加热"], generation: "gen2", channels: ["4g"], description: "触发旧协议加热命令", gen2: { fourGMsgType: "7" } },
  { name: "force-start", label: "强制启动", aliases: ["强启", "强制启动"], generation: "gen2", channels: ["4g", "bluetooth"], description: "强制启动电池", gen2: { fourGMsgType: "8", bluetoothOperateType: "03" } },
  { name: "work-mode-toggle", label: "切换系统工作模式", aliases: ["工作模式", "切换工作模式"], generation: "gen2", channels: ["4g"], description: "切换旧协议系统工作模式", gen2: { fourGMsgType: "9" } },
  { name: "smart-heat-toggle", label: "切换智能加热", aliases: ["智能加热", "切换智能加热"], generation: "gen2", channels: ["bluetooth"], description: "蓝牙协议切换智能加热", gen2: { bluetoothOperateType: "04" } },
  { name: "lock", label: "锁定", aliases: ["锁电", "锁定"], generation: "gen2", channels: ["4g", "bluetooth"], description: "锁定电池", gen2: { fourGMsgType: "10", bluetoothOperateType: "05" } },
  { name: "unlock", label: "解锁", aliases: ["解锁"], generation: "gen2", channels: ["4g", "bluetooth"], description: "解锁电池", gen2: { fourGMsgType: "11", bluetoothOperateType: "06" } },
  { name: "shutdown", label: "关机", aliases: ["关机", "关闭电池"], generation: "gen2", channels: ["4g", "bluetooth"], description: "关闭电池", gen2: { fourGMsgType: "12", bluetoothOperateType: "07" } },
]

const gen3 = (name: string, label: string, aliases: string[], msgType: string, msgSubType: string, description = label): BatteryCommandDefinition => ({
  name, label, aliases, generation: "gen3", channels: ["4g", "bluetooth"], description, gen3: { msgType, msgSubType },
})

const GEN3: BatteryCommandDefinition[] = [
  gen3("mode-normal", "普通模式", ["正常模式", "普通模式"], "00", "00"), gen3("mode-test", "测试模式", ["测试模式"], "00", "01"),
  gen3("mode-lock", "锁电模式", ["锁电模式", "锁车模式", "锁电"], "00", "02"), gen3("mode-emergency", "应急模式", ["应急模式", "紧急模式", "应急"], "00", "03"),
  gen3("speed-full", "全速模式", ["全速模式"], "01", "00"), gen3("speed-low-1", "低功耗一级", ["低功耗1", "低功耗一级"], "01", "01"),
  gen3("speed-low-2", "低功耗二级", ["低功耗2", "低功耗二级"], "01", "02"), gen3("speed-low-3", "低功耗三级", ["低功耗3", "低功耗三级"], "01", "03"),
  gen3("shutdown", "关机", ["关机", "关闭电池"], "10", "00"), gen3("reboot", "重启", ["重启"], "10", "01"),
  gen3("force-start", "强制启动", ["强启", "强制启动"], "10", "02"), gen3("clear-faults", "清除故障", ["清故障", "清除故障"], "10", "03"),
  gen3("heat-start", "启动加热", ["启动加热", "开启加热"], "10", "04"), gen3("heat-stop", "停止加热", ["停止加热", "关闭加热"], "10", "05"),
  gen3("smart-heat-on", "开启智能加热", ["开启智能加热"], "10", "06"), gen3("smart-heat-off", "关闭智能加热", ["关闭智能加热"], "10", "07"),
  gen3("charge-limit-on", "开启充电限制", ["开启充电限制", "开启充电限流"], "10", "08"), gen3("charge-limit-off", "关闭充电限制", ["关闭充电限制", "关闭充电限流"], "10", "09"),
  gen3("format-switch", "格式切换", ["格式切换"], "10", "0A"), gen3("heat-test", "加热测试", ["加热测试"], "10", "0B"),
  gen3("clear-extrema", "清除极值", ["清除极值"], "10", "0C"), gen3("storage-lock", "仓储锁定", ["仓储锁定", "锁电入库"], "10", "0D"),
]

export const BATTERY_COMMANDS = [...GEN2, ...GEN3]

export function listBatteryCommands(generation: BatteryGeneration, channel?: ControlChannel): BatteryCommandDefinition[] {
  return BATTERY_COMMANDS.filter((item) => item.generation === generation && (!channel || item.channels.includes(channel)))
}

export function resolveBatteryCommand(generation: BatteryGeneration, channel: ControlChannel, name: string): BatteryCommandDefinition {
  const normalized = name.trim().toLowerCase()
  const command = listBatteryCommands(generation, channel).find((item) =>
    item.name.toLowerCase() === normalized || item.label.toLowerCase() === normalized || item.aliases.some((alias) => alias.toLowerCase() === normalized),
  )
  if (!command) throw new Error(`${generation}/${channel} 不支持命令 ${name}；请先运行 command list`)
  return command
}
