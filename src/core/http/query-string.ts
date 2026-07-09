export type QueryValue = string | number | boolean | null | undefined
export type QueryObject = Record<string, QueryValue | Record<string, QueryValue>>

export function buildSearchParams(query?: QueryObject): URLSearchParams {
  const params = new URLSearchParams()
  if (!query) {
    return params
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue
    }

    if (typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) {
        if (childValue === undefined || childValue === null) {
          continue
        }
        params.set(`${key}[${childKey}]`, String(childValue))
      }
      continue
    }

    params.set(key, String(value))
  }

  return params
}

