import type { InventoryRecord } from './types';
import {
  createShortCsvTimestamp,
  formatDateDot,
  formatDateTimeDot,
  formatShelfLifeStatus,
  getShelfLifeInfo,
} from './dates';

const CSV_HEADERS = [
  'Barcode',
  'Quantity',
  'Manufacturing Date',
  'Expiry Date',
  'Remaining Shelf Life %',
  'Remaining Shelf Life Days',
  'Total Shelf Life Days',
  'Status',
  'Scanned At',
];

function escapeCsvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function createCsv(records: InventoryRecord[], nearExpiryThresholdPercent: number): string {
  const rows = records.map((record) => {
    const shelfLife = getShelfLifeInfo(record, nearExpiryThresholdPercent);

    return [
      record.barcode,
      record.quantity,
      formatDateDot(record.manufacturingDate),
      formatDateDot(record.bestBeforeDate),
      shelfLife.remainingShelfLifePercent ?? '',
      shelfLife.remainingDays,
      shelfLife.totalShelfLifeDays ?? '',
      formatShelfLifeStatus(shelfLife.status),
      formatDateTimeDot(record.scannedAt),
    ];
  });

  return [CSV_HEADERS, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

export function createCsvFilename(now = new Date()): string {
  return `inv-${createShortCsvTimestamp(now)}.csv`;
}
