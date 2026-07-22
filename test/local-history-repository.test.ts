import assert from "node:assert/strict"
import test from "node:test"
import {
  LocalHistoryRepository,
  createLocalHistoryRepository,
  detailTable,
  normalizeBatteryId,
} from "../src/domain/local/local-history-repository.js"
import { assertApiOnlySource, parseDataSource } from "../src/core/data-source.js"

test("本地历史分表只由严格的电池编号和代际白名单生成", () => {
  assert.equal(normalizeBatteryId(" 623b1c10 "), "623B1C10")
  assert.equal(
    detailTable("gen3", "623B1C10"),
    "`kadianbao-battery06`.`kdb_cycle06_msg_log_623b1c10`",
  )
  assert.equal(
    detailTable("gen3", "423B1C10"),
    "`kadianbao-battery04`.`kdb_cycle04_msg_log_423b1c10`",
  )
  assert.equal(
    detailTable("gen2", "8F9AE708"),
    "`newenergy-battery`.`hckd_lihe_msg_log_8f9ae708`",
  )
  assert.throws(() => normalizeBatteryId("623B1C10; DROP TABLE x"), /8 位十六进制/)
  assert.throws(() => detailTable("gen3", "523B1C10"), /不支持编号前缀/)
})

test("本地实时历史查询使用参数化时间边界，latest 不扫描所有按电池分表", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = []
  const repository = new LocalHistoryRepository({
    query: async (sql, values) => {
      calls.push({ sql, values })
      return [[{ battery_id: "623B1C10", log_time: "2026-05-15 13:45:57" }], undefined] as any
    },
  })

  const rows = await repository.listRealtime({
    generation: "gen3",
    batteryId: "623b1c10",
    start: "2026-05-15 13:45:52",
    end: "2026-05-15 15:45:52",
    maxRows: 20_000,
  })
  assert.equal(rows[0]?.batteryId, "623B1C10")
  assert.match(calls[0]!.sql, /kdb_cycle06_msg_log_623b1c10/)
  assert.match(calls[0]!.sql, /`log_time` >= \? AND `log_time` <= \?/)
  assert.match(calls[0]!.sql, /ORDER BY `log_time` ASC LIMIT \?/)
  assert.deepEqual(calls[0]!.values, ["2026-05-15 13:45:52", "2026-05-15 15:45:52", 20_000])

  await repository.listExport({ generation: "gen2", type: "latestBatteryTable", batteryId: "8f9ae708" })
  assert.match(calls[1]!.sql, /hckd_lihe_msg_log_8f9ae708/)
  assert.match(calls[1]!.sql, /ORDER BY `log_time` DESC LIMIT 1/)
  assert.doesNotMatch(calls[1]!.sql, /WHERE/)

  await repository.listParameterDefinitions({ generation: "gen3", search: "温度" })
  assert.match(calls[2]!.sql, /`kadianbao`\.`kdb_parameter_base`/)
  assert.match(calls[2]!.sql, /`parameter_name` LIKE \?/)
  assert.deepEqual(calls[2]!.values, ["%温度%"])

  await repository.listFirmwares({ generation: "gen2", firmwareVersion: "470", firmwareName: "正式" })
  assert.match(calls[3]!.sql, /`newenergy`\.`hckd_firmware_base`/)
  assert.match(calls[3]!.sql, /`firmware_version` = \? AND `firmware_name` LIKE \?/)
  assert.deepEqual(calls[3]!.values, ["470", "%正式%"])
})

test("本地库未配置时只在 local/auto 路径报错，API-only 来源约束明确", () => {
  assert.throws(() => createLocalHistoryRepository({} as any), /未配置 \[database\.local\]/)
  assert.equal(parseDataSource(undefined), undefined)
  assert.equal(parseDataSource("auto"), "auto")
  assert.throws(() => parseDataSource("sql"), /只支持 api、local 或 auto/)
  assert.doesNotThrow(() => assertApiOnlySource("api", "ready"))
  assert.throws(() => assertApiOnlySource("local", "ready"), /仅支持 --source api/)
})
