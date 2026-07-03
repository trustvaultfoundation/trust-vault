// CSV + real .xlsx export for dashboard widgets. SheetJS is dynamically imported
// so it's only fetched when someone actually exports (write-only — we never parse
// untrusted spreadsheets, so the xlsx parse advisories don't apply).

import type { TableData } from "./dashboard";

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, table: TableData): void {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [table.columns, ...table.rows].map((r) => r.map(esc).join(",")).join("\r\n");
  // BOM so Excel reads UTF-8 correctly.
  triggerDownload(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
}

export async function downloadXlsx(filename: string, table: TableData): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([table.columns, ...table.rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  triggerDownload(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${filename}.xlsx`
  );
}
