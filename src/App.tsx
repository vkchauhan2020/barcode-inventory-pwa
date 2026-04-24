import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import {
  CalendarDays,
  Camera,
  Download,
  Keyboard,
  Play,
  Plus,
  Share2,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { addInventoryRecord, clearInventoryRecords, deleteInventoryRecord, getInventoryRecords } from './storage';
import { createCsv, createCsvFilename } from './csv';
import type { InventoryRecord } from './types';

type ScannerState = 'idle' | 'starting' | 'scanning' | 'paused' | 'error';

function createRecord(barcode: string, quantity: number, bestBeforeDate: string): InventoryRecord {
  return {
    id: crypto.randomUUID(),
    barcode,
    quantity,
    bestBeforeDate,
    scannedAt: new Date().toISOString(),
  };
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatDisplayDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function App() {
  const [records, setRecords] = useState<InventoryRecord[]>([]);
  const [scannerState, setScannerState] = useState<ScannerState>('idle');
  const [scannerMessage, setScannerMessage] = useState('Ready to scan');
  const [pendingBarcode, setPendingBarcode] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [bestBeforeDate, setBestBeforeDate] = useState('');
  const [notice, setNotice] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const scannerRef = useRef<BrowserMultiFormatReader | null>(null);
  const handledBarcodeRef = useRef(false);

  const hasRecords = records.length > 0;
  const totalQuantity = useMemo(() => records.reduce((sum, record) => sum + record.quantity, 0), [records]);

  useEffect(() => {
    getInventoryRecords()
      .then(setRecords)
      .catch(() => setNotice('Could not load saved records from this phone.'));
  }, []);

  useEffect(() => {
    return () => {
      controlsRef.current?.stop();
    };
  }, []);

  async function startScanner() {
    if (!videoRef.current) {
      return;
    }

    setScannerState('starting');
    setScannerMessage('Opening camera...');
    setNotice('');
    handledBarcodeRef.current = false;

    try {
      controlsRef.current?.stop();
      scannerRef.current = new BrowserMultiFormatReader();
      controlsRef.current = await scannerRef.current.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result) => {
          if (!result || handledBarcodeRef.current) {
            return;
          }

          const barcode = result.getText().trim();
          if (!barcode) {
            return;
          }

          handledBarcodeRef.current = true;
          controlsRef.current?.stop();
          setPendingBarcode(barcode);
          setQuantity('1');
          setBestBeforeDate('');
          setScannerState('paused');
          setScannerMessage('Barcode captured');
        },
      );
      setScannerState('scanning');
      setScannerMessage('Point the camera at a barcode');
    } catch {
      setScannerState('error');
      setScannerMessage('Camera scanning is unavailable. You can enter the barcode manually.');
    }
  }

  function stopScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    handledBarcodeRef.current = false;
    setScannerState('idle');
    setScannerMessage('Scanner stopped');
  }

  function beginManualEntry() {
    const barcode = manualBarcode.trim();
    if (!barcode) {
      setNotice('Enter a barcode number first.');
      return;
    }

    controlsRef.current?.stop();
    handledBarcodeRef.current = true;
    setPendingBarcode(barcode);
    setManualBarcode('');
    setQuantity('1');
    setBestBeforeDate('');
    setScannerState('paused');
    setScannerMessage('Manual barcode ready');
  }

  async function savePendingRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedQuantity = Number(quantity);

    if (!pendingBarcode.trim()) {
      setNotice('Scan or enter a barcode before saving.');
      return;
    }

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setNotice('Quantity must be greater than zero.');
      return;
    }

    if (!bestBeforeDate) {
      setNotice('Choose the best-before date before saving.');
      return;
    }

    const record = createRecord(pendingBarcode.trim(), parsedQuantity, bestBeforeDate);
    try {
      await addInventoryRecord(record);
      setRecords((current) => [record, ...current]);
      setPendingBarcode('');
      setNotice('Saved. Ready for the next scan.');
      await startScanner();
    } catch {
      setNotice('Could not save this record on the phone.');
    }
  }

  async function removeRecord(id: string) {
    await deleteInventoryRecord(id);
    setRecords((current) => current.filter((record) => record.id !== id));
  }

  async function clearRecords() {
    if (!hasRecords || !window.confirm('Delete all saved inventory records from this phone?')) {
      return;
    }
    await clearInventoryRecords();
    setRecords([]);
    setNotice('All local records were deleted.');
  }

  async function shareCsv() {
    if (!hasRecords) {
      setNotice('Add at least one record before exporting.');
      return;
    }

    const csv = createCsv(records);
    const filename = createCsvFilename();
    const file = new File([csv], filename, { type: 'text/csv;charset=utf-8' });
    const shareData = {
      title: 'Inventory scan',
      text: 'Inventory scan CSV',
      files: [file],
    };

    try {
      if (navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        setNotice('CSV shared from your phone.');
      } else {
        downloadCsv(csv, filename);
        setNotice('Sharing files is unavailable here, so the CSV was downloaded.');
      }
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') {
        downloadCsv(csv, filename);
        setNotice('Sharing did not complete, so the CSV was downloaded.');
      }
    }
  }

  function exportCsv() {
    if (!hasRecords) {
      setNotice('Add at least one record before exporting.');
      return;
    }
    downloadCsv(createCsv(records), createCsvFilename());
    setNotice('CSV downloaded.');
  }

  function cancelPendingRecord() {
    setPendingBarcode('');
    setQuantity('1');
    setBestBeforeDate('');
    setScannerState('idle');
    setScannerMessage('Ready to scan');
    handledBarcodeRef.current = false;
  }

  return (
    <main className="app-shell">
      <section className="top-panel" aria-label="Scanner">
        <div className="app-title">
          <div>
            <p className="eyebrow">Phone inventory</p>
            <h1>Barcode Inventory</h1>
          </div>
          <div className="record-count" aria-label={`${records.length} records`}>
            <span>{records.length}</span>
            records
          </div>
        </div>

        <div className="scanner-frame">
          <video ref={videoRef} className="scanner-video" muted playsInline aria-label="Camera preview" />
          <div className="scan-line" aria-hidden="true" />
          <div className="scanner-status">
            <Camera size={18} aria-hidden="true" />
            <span>{scannerMessage}</span>
          </div>
        </div>

        <div className="toolbar">
          {scannerState === 'scanning' || scannerState === 'starting' ? (
            <button type="button" className="secondary-button" onClick={stopScanner}>
              <Square size={18} aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={startScanner}>
              <Play size={18} aria-hidden="true" />
              Scan
            </button>
          )}
          <button type="button" className="secondary-button" onClick={shareCsv} disabled={!hasRecords}>
            <Share2 size={18} aria-hidden="true" />
            Share CSV
          </button>
          <button type="button" className="icon-button" onClick={exportCsv} disabled={!hasRecords} aria-label="Download CSV">
            <Download size={20} aria-hidden="true" />
          </button>
        </div>

        <form className="manual-entry" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="manualBarcode">Manual barcode</label>
          <div className="inline-control">
            <input
              id="manualBarcode"
              inputMode="numeric"
              autoComplete="off"
              value={manualBarcode}
              onChange={(event) => setManualBarcode(event.target.value)}
              placeholder="Type barcode"
            />
            <button type="button" className="icon-button" onClick={beginManualEntry} aria-label="Use manual barcode">
              <Keyboard size={20} aria-hidden="true" />
            </button>
          </div>
        </form>
      </section>

      {pendingBarcode && (
        <section className="entry-panel" aria-label="Captured barcode details">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Captured barcode</p>
              <h2>{pendingBarcode}</h2>
            </div>
            <button type="button" className="icon-button" onClick={cancelPendingRecord} aria-label="Cancel captured barcode">
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <form className="entry-form" onSubmit={savePendingRecord}>
            <label htmlFor="quantity">Quantity</label>
            <input
              id="quantity"
              type="number"
              min="0.01"
              step="any"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />

            <label htmlFor="bestBeforeDate">Best-before date</label>
            <div className="date-input-wrap">
              <CalendarDays size={18} aria-hidden="true" />
              <input
                id="bestBeforeDate"
                type="date"
                value={bestBeforeDate}
                onChange={(event) => setBestBeforeDate(event.target.value)}
                required
              />
            </div>

            <button type="submit" className="primary-button full-width">
              <Plus size={18} aria-hidden="true" />
              Save item
            </button>
          </form>
        </section>
      )}

      {notice && <p className="notice">{notice}</p>}

      <section className="summary-strip" aria-label="Inventory summary">
        <div>
          <span>{records.length}</span>
          lines
        </div>
        <div>
          <span>{totalQuantity}</span>
          units
        </div>
        <button type="button" className="text-button" onClick={clearRecords} disabled={!hasRecords}>
          <Trash2 size={17} aria-hidden="true" />
          Clear
        </button>
      </section>

      <section className="records-section" aria-label="Saved records">
        <div className="section-heading">
          <h2>Saved Items</h2>
        </div>

        {records.length === 0 ? (
          <div className="empty-state">
            <Camera size={30} aria-hidden="true" />
            <p>No saved items yet.</p>
          </div>
        ) : (
          <div className="record-list">
            {records.map((record) => (
              <article className="record-card" key={record.id}>
                <div>
                  <p className="barcode-value">{record.barcode}</p>
                  <p className="record-meta">Best before {record.bestBeforeDate}</p>
                  <p className="record-meta">{formatDisplayDateTime(record.scannedAt)}</p>
                </div>
                <div className="record-actions">
                  <span className="quantity-pill">{record.quantity}</span>
                  <button
                    type="button"
                    className="icon-button small"
                    onClick={() => void removeRecord(record.id)}
                    aria-label={`Delete barcode ${record.barcode}`}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
