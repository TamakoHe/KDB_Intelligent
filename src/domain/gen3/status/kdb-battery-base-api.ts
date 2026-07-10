import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen3BatteryBaseRow = {
  id?: number
  batteryId?: string
  batteryDataId?: string
  serialNumber?: string
  bluetoothName?: string
  bluetoothMac?: string
  bluetoothIp?: string
  batteryType?: number
  description?: string
  lte4gStatus?: string
  lte4gNum?: number
  lte4gTime?: string
  bluetoothStatus?: string
  bluetoothNum?: number
  bluetoothTime?: string
  batteryStatus?: number
  faultStatus?: number
  chargeDischargeStatus?: number
  hardwareVersion?: string
  bootVersion?: string
  appVersion?: string
  plantInformation?: string
  voltagePlatform?: string
  capacitySpecifications?: string
  functionCode?: string
  salesModel?: string
  uploadInterval?: number
  agnetId?: number
  agentName?: string
  centerDepotId?: number
  centerDepotName?: string
  batteryLabel?: string
  dataVersion?: number
  businessManagerId?: number
  businessManagerName?: string
  useTime?: number
  errorId?: number
  wenxinLog?: number
  jwProvince?: string
  jwCity?: string
  jwArea?: string
  jwVillage?: string
  warrantyStartTime?: string
  warrantyEndTime?: string
  warrantyStatus?: number
  storageTime?: string
  deliveryTime?: string
  arrivalDealerTime?: string
  accountType?: number
  goodsAccountType?: number
  accountSubType?: number
  iccid?: string
  bluetoothLog?: number
  errorVideos?: number
  batteryModelName?: string
  batteryModelSales?: string
  installType?: string
  snCode?: string
  [key: string]: unknown
}

/** 与网站“电池管理数据”Excel 导出列对应；不包含内部数据库 id 与未导出的 goodsAccountType。 */
export const GEN3_BATTERY_BASE_FIELD_LABELS = {
  batteryId: "电池编号",
  batteryDataId: "电池简编码",
  serialNumber: "产品系列号",
  bluetoothName: "蓝牙名称",
  bluetoothMac: "蓝牙mac地址",
  bluetoothIp: "蓝牙ip地址",
  batteryType: "电池类型",
  description: "描述信息",
  lte4gStatus: "网络连接状态",
  lte4gNum: "网络连接次数",
  lte4gTime: "网络连接时间",
  bluetoothStatus: "蓝牙连接状态",
  bluetoothNum: "蓝牙连接次数",
  bluetoothTime: "蓝牙连接时间",
  batteryStatus: "电池状态",
  faultStatus: "运行状态",
  chargeDischargeStatus: "充放电状态",
  hardwareVersion: "硬件版本号",
  bootVersion: "Boot版本号",
  appVersion: "App版本号",
  plantInformation: "工厂信息",
  voltagePlatform: "电压平台",
  capacitySpecifications: "容量规格",
  functionCode: "功能代号",
  salesModel: "销售模式",
  uploadInterval: "上传时间间隔",
  agnetId: "代理id",
  agentName: "代理名字",
  centerDepotId: "中心仓库id",
  centerDepotName: "中心仓库名",
  batteryLabel: "电池标签",
  dataVersion: "数据版本",
  businessManagerId: "业务经理ID",
  businessManagerName: "业务经理名字",
  useTime: "电池使用时长",
  errorId: "异常数据id",
  wenxinLog: "微信日志",
  jwProvince: "经纬省",
  jwCity: "经纬市",
  jwArea: "经纬区",
  jwVillage: "经纬镇",
  warrantyStartTime: "质保开始时间",
  warrantyEndTime: "质保到期时间",
  warrantyStatus: "质保状态",
  storageTime: "入库时间",
  deliveryTime: "出库时间",
  accountType: "账务类型",
  accountSubType: "账务子类型",
  iccid: "物联网网卡卡号",
  bluetoothLog: "蓝牙日志",
  errorVideos: "看错误视频",
  batteryModelName: "电池型号",
  batteryModelSales: "销售型号",
  installType: "安装类型",
  snCode: "SN码",
} as const

export function listGen3BatteryBase(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen3BatteryBaseRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen3BatteryBaseRow>>({
    path: "/managekdb/kdbBatteryBase/list",
    method: "GET",
    query,
    timeoutMs: 180000,
  })
}

export function exportGen3BatteryBase(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  return client.requestArrayBuffer({
    path: "/managekdb/kdbBatteryBase/export",
    method: "POST",
    query,
    timeoutMs: 180000,
  })
}
