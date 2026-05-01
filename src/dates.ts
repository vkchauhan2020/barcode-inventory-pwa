import type { InventoryRecord } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ShelfLifeStatus = 'valid' | 'near-expiry' | 'expired';

export interface ShelfLifeInfo {
  remainingDays: number;
  totalShelfLifeDays: number | null;
  status: ShelfLifeStatus;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function parseLocalDate(value: string): Date | null {
  const parts = parseDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(parts.year, parts.month - 1, parts.day);
}

export function todayLocalDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function daysBetweenDates(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY);
}

export function formatDateDot(value?: string): string {
  if (!value) {
    return '';
  }

  const parts = parseDateParts(value);
  if (!parts) {
    return value;
  }

  return `${pad(parts.day)}.${pad(parts.month)}.${parts.year}`;
}

export function formatDateTimeDot(value: string): string {
  const date = new Date(value);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function createShortCsvTimestamp(now = new Date()): string {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}`;
}

export function getShelfLifeInfo(record: InventoryRecord, thresholdDays: number, today = todayLocalDate()): ShelfLifeInfo {
  const expiryDate = parseLocalDate(record.bestBeforeDate);
  const manufacturingDate = record.manufacturingDate ? parseLocalDate(record.manufacturingDate) : null;
  const remainingDays = expiryDate ? daysBetweenDates(today, expiryDate) : 0;
  const totalShelfLifeDays = expiryDate && manufacturingDate ? daysBetweenDates(manufacturingDate, expiryDate) : null;

  let status: ShelfLifeStatus = 'valid';
  if (remainingDays < 0) {
    status = 'expired';
  } else if (remainingDays <= thresholdDays) {
    status = 'near-expiry';
  }

  return {
    remainingDays,
    totalShelfLifeDays,
    status,
  };
}

export function formatShelfLifeStatus(status: ShelfLifeStatus): string {
  if (status === 'expired') {
    return 'Expired';
  }
  if (status === 'near-expiry') {
    return 'Near Expiry';
  }
  return 'Valid';
}
