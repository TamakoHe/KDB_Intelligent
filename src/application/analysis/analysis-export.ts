import ExcelJS from "exceljs"
import { mkdir } from "node:fs/promises"
import path from "node:path"

export async function writeAnalysisWorkbook(args: { outputPath: string; rows: Record<string, unknown>[]; title?: string }): Promise<{ outputPath: string; rowCount: number }> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(args.title ?? "analysis")
  const columns = [...new Set(args.rows.flatMap((row) => Object.keys(row)))]
  sheet.columns = columns.map((key) => ({ header: key, key, width: Math.min(42, Math.max(12, key.length + 2)) }))
  for (const row of args.rows) sheet.addRow(Object.fromEntries(columns.map((key) => [key, row[key] ?? ""])))
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  await mkdir(path.dirname(args.outputPath), { recursive: true })
  await workbook.xlsx.writeFile(args.outputPath)
  return { outputPath: args.outputPath, rowCount: args.rows.length }
}
