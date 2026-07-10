export type DateTimeInput = string | Date

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

export function formatLocalDateTime(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new Error("无效的日期时间")
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export function parseDateTime(value: DateTimeInput, label: string): Date {
  if (value instanceof Date) {
    const copy = new Date(value.getTime())
    if (!Number.isFinite(copy.getTime())) throw new Error(`${label} 不是有效时间`)
    return copy
  }

  const text = value.trim()
  if (!text) throw new Error(`${label} 不能为空`)

  const sqlLike = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  const date = sqlLike
    ? new Date(
        Number(sqlLike[1]),
        Number(sqlLike[2]) - 1,
        Number(sqlLike[3]),
        Number(sqlLike[4]),
        Number(sqlLike[5]),
        Number(sqlLike[6] ?? "0"),
      )
    : new Date(text)

  if (!Number.isFinite(date.getTime())) throw new Error(`${label} 不是有效时间: ${value}`)
  if (
    sqlLike &&
    (date.getFullYear() !== Number(sqlLike[1]) ||
      date.getMonth() !== Number(sqlLike[2]) - 1 ||
      date.getDate() !== Number(sqlLike[3]) ||
      date.getHours() !== Number(sqlLike[4]) ||
      date.getMinutes() !== Number(sqlLike[5]) ||
      date.getSeconds() !== Number(sqlLike[6] ?? "0"))
  ) {
    throw new Error(`${label} 不是有效时间: ${value}`)
  }
  return date
}

export function resolveTimeRange(args: {
  start?: DateTimeInput
  end?: DateTimeInput
  hours?: number
}): { start: Date; end: Date; startText: string; endText: string } {
  const end = args.end === undefined ? new Date() : parseDateTime(args.end, "结束时间")
  const hours = args.hours ?? 24
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("hours 必须是大于 0 的数字")
  const start =
    args.start === undefined
      ? new Date(end.getTime() - hours * 60 * 60 * 1000)
      : parseDateTime(args.start, "开始时间")

  if (start.getTime() >= end.getTime()) throw new Error("开始时间必须早于结束时间")
  return {
    start,
    end,
    startText: formatLocalDateTime(start),
    endText: formatLocalDateTime(end),
  }
}
