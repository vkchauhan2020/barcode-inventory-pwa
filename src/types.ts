export interface InventoryRecord {
  id: string;
  barcode: string;
  quantity: number;
  manufacturingDate?: string;
  bestBeforeDate: string;
  scannedAt: string;
}
