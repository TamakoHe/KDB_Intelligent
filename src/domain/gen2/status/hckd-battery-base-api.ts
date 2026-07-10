import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen2BatteryBaseRow = {
  batteryId?: string
  serialNumber?: string
  batteryDataId?: string
  goodsId?: number
  bluetoothName?: string
  bluetoothMac?: string
  bluetoothIp?: string
  lockStatus?: number
  relationUserId?: string
  batteryType?: number
  description?: string
  batteryStatus?: string
  lte4gStatus?: string
  lte4gNum?: number
  lte4gTime?: string
  bluetoothStatus?: string
  bluetoothNum?: number
  bluetoothTime?: string
  batteryVersion?: string
  uploadInterval?: number
  agnetId?: number
  agentName?: string
  centerDepotId?: number
  centerDepotName?: string
  batteryLabel?: string
  dataVersion?: number
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
  accountSubType?: number
  iccid?: string
  batteryModelName?: string
  batteryModelSales?: string
  installType?: string
  snCode?: string
  useType?: string
  relevanceBatteryId?: string
  [key: string]: unknown
}

/** 与网站“电池管理数据”Excel 导出列对应；后端原字段 agnetId 保留其既有拼写。 */
export const GEN2_BATTERY_BASE_FIELD_LABELS = {
  batteryId: "电池唯一编号",
  serialNumber: "产品系列号",
  batteryDataId: "电池编码",
  goodsId: "电池商品ID",
  bluetoothName: "蓝牙名称",
  bluetoothMac: "蓝牙mac地址",
  bluetoothIp: "蓝牙ip地址",
  lockStatus: "锁定状态",
  relationUserId: "关联用户ID",
  batteryType: "电池类型",
  description: "描述信息",
  lte4gStatus: "网络连接状态",
  lte4gNum: "网络连接次数",
  lte4gTime: "网络连接时间",
  bluetoothStatus: "蓝牙连接状态",
  bluetoothNum: "蓝牙连接次数",
  bluetoothTime: "蓝牙连接时间",
  batteryStatus: "电池状态",
  batteryVersion: "电池版本",
  uploadInterval: "上传时间间隔",
  agnetId: "代理id",
  agentName: "代理名字",
  centerDepotId: "中心仓库id",
  centerDepotName: "中心仓库名",
  batteryLabel: "电池标签",
  dataVersion: "数据版本",
  useTime: "电池使用时长",
  errorId: "异常数据id",
  wenxinLog: "电池使用时长",
  jwProvince: "经纬省",
  jwCity: "经纬市",
  jwArea: "经纬区",
  jwVillage: "经纬镇",
  warrantyStartTime: "质保开始时间",
  warrantyEndTime: "质保到期时间",
  warrantyStatus: "质保状态",
  storageTime: "入库时间",
  deliveryTime: "出库时间",
  arrivalDealerTime: "到经销商时间",
  accountType: "账务类型",
  accountSubType: "账务子类型",
  iccid: "物联网网卡卡号",
  batteryModelName: "电池型号",
  batteryModelSales: "销售型号",
  installType: "安装类型",
  snCode: "SN码",
  useType: "使用类型",
  relevanceBatteryId: "关联电池编码",
} as const satisfies Record<keyof Omit<Gen2BatteryBaseRow, number>, string>

export function listGen2BatteryBase(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen2BatteryBaseRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen2BatteryBaseRow>>({
    path: "/hckd/hckdBatteryBase/list",
    method: "GET",
    query,
    timeoutMs: 180000,
  })
}

export function exportGen2BatteryBase(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  return client.requestArrayBuffer({
    path: "/hckd/hckdBatteryBase/export",
    method: "POST",
    query,
    timeoutMs: 180000,
  })
}
