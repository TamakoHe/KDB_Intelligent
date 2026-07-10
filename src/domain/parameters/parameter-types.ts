export type ParameterDefinition = {
  id?: number
  parameterId?: number | string
  parameterPower?: string
  parameterDataType?: string
  parameterEventId?: string
  parameterDefault?: string
  parameterMax?: string
  parameterMin?: string
  parameterAddress?: string
  parameterCharacteristic?: string
  characteristic?: string
  parameterAlias?: string
  parameterName?: string
  parameterUnit?: string
  parameterExplain?: string
  parameterStatus?: number
  status?: number
  serialNumber?: number | string
  [key: string]: unknown
}

export function parameterValue(row: ParameterDefinition): string | undefined {
  const value = row.parameterDefault
  return value === undefined || value === null ? undefined : String(value)
}

export function assertWritable(row: ParameterDefinition): void {
  if (String(row.parameterPower ?? "").toUpperCase() !== "RW") {
    throw new Error(`参数 ${row.parameterName ?? row.parameterId} 为只读，不能修改`)
  }
}

export function validateParameterValue(row: ParameterDefinition, raw: string): void {
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`参数值必须是数字: ${raw}`)
  const min = row.parameterMin === undefined ? undefined : Number(row.parameterMin)
  const max = row.parameterMax === undefined ? undefined : Number(row.parameterMax)
  if (Number.isFinite(min) && value < min!) throw new Error(`参数值 ${raw} 小于允许最小值 ${row.parameterMin}`)
  if (Number.isFinite(max) && value > max!) throw new Error(`参数值 ${raw} 大于允许最大值 ${row.parameterMax}`)
  const type = String(row.parameterDataType ?? "")
  if ((type === "I32" || type === "U32") && !Number.isInteger(value)) throw new Error(`${type} 参数必须使用整数`)
  if (type === "I32" && (value < -2147483648 || value > 2147483647)) throw new Error("I32 参数超出 32 位有符号整数范围")
  if (type === "U32" && (value < 0 || value > 4294967295)) throw new Error("U32 参数超出 32 位无符号整数范围")
}

export function resolveParameter(rows: ParameterDefinition[], selector: string): ParameterDefinition {
  const text = selector.trim()
  const exact = rows.filter((row) =>
    [row.parameterId, row.parameterName, row.parameterAlias]
      .filter((value) => value !== undefined && value !== null)
      .some((value) => String(value).toLowerCase() === text.toLowerCase()),
  )
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) throw new Error(`参数选择器 ${selector} 匹配到多个参数，请改用 parameterId`)
  const normalized = text.toLowerCase()
  const keyword = rows.filter((row) =>
    [row.parameterName, row.parameterAlias]
      .filter((value) => value !== undefined && value !== null)
      .some((value) => String(value).toLowerCase().includes(normalized)),
  )
  if (keyword.length === 1) return keyword[0]!
  if (keyword.length > 1) throw new Error(`参数关键词 ${selector} 匹配到多个参数，请改用完整名称、别名或 parameterId`)
  throw new Error(`找不到参数 ${selector}；请先运行 parameter list`)
}
