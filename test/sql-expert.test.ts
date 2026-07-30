import assert from "node:assert/strict"
import test from "node:test"
import { validateReadOnlySql } from "../desktop/src/main/sql-expert.js"

test("专家 SQL 只允许本地 schema 的单条 SELECT", () => {
  validateReadOnlySql("SELECT * FROM `kadianbao`.`kdb_battery_base` LIMIT 10")
  validateReadOnlySql("WITH x AS (SELECT 1 AS n) SELECT * FROM x")
  for (const sql of [
    "DELETE FROM kadianbao.kdb_battery_base",
    "SELECT 1; DROP TABLE kadianbao.kdb_battery_base",
    "SELECT * FROM other_schema.secret_table",
    "SELECT * FROM unqualified_table",
    "SELECT LOAD_FILE('/tmp/a')",
    "SELECT 1 -- comment",
  ]) assert.throws(() => validateReadOnlySql(sql))
})
