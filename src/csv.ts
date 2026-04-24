import type { InventoryRecord } from './types';

const CSV_HEADERS = ['Barcode', 'Quantity', 'Best Before Date', 'Scanned At'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function escapeCsvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function createCsv(records: InventoryRecord[]): string {
  const rows = records.map((record) => [
    record.barcode,
    record.quantity,
    record.bestBeforeDate,
    formatLocalDateTime(record.scannedAt),
  ]);

  return [CSV_HEADERS, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

export function createCsvFilename(now = new Date()): string {
  return `inventory-scan-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}.csv`;
}
