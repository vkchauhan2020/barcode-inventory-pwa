import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
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

type NativeBarcodeDetectorResult = {
  rawValue?: string;
};

type NativeBarcodeDetector = {
  detect: (source: HTMLVideoElement) => Promise<NativeBarcodeDetectorResult[]>;
};

type NativeBarcodeDetectorConstructor = new (options?: { formats?: string[] }) => NativeBarcodeDetector;

declare global {
  interface Window {
    BarcodeDetector?: NativeBarcodeDetectorConstructor;
  }
}

const BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.CODABAR,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.PDF_417,
];

const NATIVE_BARCODE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'itf',
  'qr_code',
  'data_matrix',
  'pdf417',
];

const REAR_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function formatDisplayDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function createScannerHints(): Map<DecodeHintType, unknown> {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

function getScannerErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Camera permission was blocked. Allow camera access in Chrome settings, then tap Scan.';
    }
    if (error.name === 'NotFoundError') {
      return 'No camera was found on this device.';
    }
    if (error.name === 'NotReadableError') {
      return 'The camera is busy in another app. Close it there, then tap Scan again.';
    }
  }

  return 'Camera scanning is unavailable. You can enter the barcode manually.';
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
  const scannerHintTimerRef = useRef<number | null>(null);

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
      clearScannerHintTimer();
    };
  }, []);

  function clearScannerHintTimer() {
    if (scannerHintTimerRef.current !== null) {
      window.clearTimeout(scannerHintTimerRef.current);
      scannerHintTimerRef.current = null;
    }
  }

  function armScannerHintTimer() {
    clearScannerHintTimer();
    scannerHintTimerRef.current = window.setTimeout(() => {
      if (!handledBarcodeRef.current) {
        setScannerMessage('Still looking. Use the rear camera, good light, and fill the red line with the barcode.');
      }
    }, 7000);
  }

  function handleCapturedBarcode(barcodeValue: string) {
    const barcode = barcodeValue.trim();
    if (!barcode || handledBarcodeRef.current) {
      return;
    }

    handledBarcodeRef.current = true;
    clearScannerHintTimer();
    controlsRef.current?.stop();
    setPendingBarcode(barcode);
    setQuantity('1');
    setBestBeforeDate('');
    setScannerState('paused');
    setScannerMessage('Barcode captured');
  }

  async function startNativeScanner(video: HTMLVideoElement): Promise<boolean> {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }

    let detector: NativeBarcodeDetector;
    try {
      detector = new window.BarcodeDetector({ formats: NATIVE_BARCODE_FORMATS });
    } catch {
      return false;
    }

    const stream = await navigator.mediaDevices.getUserMedia(REAR_CAMERA_CONSTRAINTS);
    let stopped = false;
    let detecting = false;
    const intervalMs = 220;

    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play();

    const timer = window.setInterval(() => {
      if (stopped || detecting || handledBarcodeRef.current || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      detecting = true;
      detector
        .detect(video)
        .then((barcodes) => {
          const barcode = barcodes.find((candidate) => candidate.rawValue?.trim());
          if (barcode?.rawValue) {
            handleCapturedBarcode(barcode.rawValue);
          }
        })
        .catch(() => {
          setScannerMessage('Scanner is open, but detection had trouble. Try holding the barcode flatter.');
        })
        .finally(() => {
          detecting = false;
        });
    }, intervalMs);

    controlsRef.current = {
      stop: () => {
        stopped = true;
        window.clearInterval(timer);
        stream.getTracks().forEach((track) => track.stop());
        if (video.srcObject === stream) {
          video.srcObject = null;
        }
      },
    };

    return true;
  }

  async function startZxingScanner(video: HTMLVideoElement) {
    scannerRef.current = new BrowserMultiFormatReader(createScannerHints(), {
      delayBetweenScanAttempts: 150,
      delayBetweenScanSuccess: 500,
      tryPlayVideoTimeout: 8000,
    });
    controlsRef.current = await scannerRef.current.decodeFromConstraints(REAR_CAMERA_CONSTRAINTS, video, (result, error) => {
      if (result) {
        handleCapturedBarcode(result.getText());
        return;
      }

      if (error && error.name !== 'NotFoundException' && error.name !== 'ChecksumException') {
        setScannerMessage('Scanner is open, but this barcode is hard to read. Try better light or manual entry.');
      }
    });
  }

  async function startScanner() {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    setScannerState('starting');
    setScannerMessage('Opening rear camera...');
    setNotice('');
    clearScannerHintTimer();
    handledBarcodeRef.current = false;

    try {
      controlsRef.current?.stop();
      const nativeScannerStarted = await startNativeScanner(video);
      if (!nativeScannerStarted) {
        await startZxingScanner(video);
      }
      setScannerState('scanning');
      setScannerMessage('Point the rear camera at a barcode');
      armScannerHintTimer();
    } catch (error) {
      setScannerState('error');
      setScannerMessage(getScannerErrorMessage(error));
    }
  }

  function stopScanner() {
    clearScannerHintTimer();
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
    clearScannerHintTimer();
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
    const fileShareData: ShareData = {
      title: 'Inventory scan',
      text: `${records.length} inventory records in CSV format.`,
      files: [file],
    };
    const textShareData: ShareData = {
      title: filename,
      text: csv,
    };

    try {
      if (navigator.canShare?.(fileShareData)) {
        await navigator.share(fileShareData);
        setNotice('CSV shared from your phone.');
        return;
      }

      if (navigator.share) {
        await navigator.share(textShareData);
        setNotice('CSV text shared. If you need an attachment, use the download button and attach it in your email app.');
        return;
      }

      downloadCsv(csv, filename);
      setNotice('CSV file sharing is unavailable here, so the CSV was downloaded.');
    } catch (error) {
      if (isAbortError(error)) {
        setNotice('Sharing was cancelled.');
        return;
      }

      try {
        if (navigator.share) {
          await navigator.share(textShareData);
          setNotice('CSV text shared. If you need an attachment, use the download button and attach it in your email app.');
          return;
        }
      } catch (textShareError) {
        if (isAbortError(textShareError)) {
          setNotice('Sharing was cancelled.');
          return;
        }
      }

      if (hasRecords) {
        downloadCsv(csv, filename);
        setNotice('This browser could not share the CSV file, so it was downloaded.');
      } else {
        setNotice('Sharing did not complete.');
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
    clearScannerHintTimer();
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
