# Security & Stability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply 12 targeted security, stability, accessibility, and UX fixes to the barcode inventory PWA without changing any existing user-facing behaviour.

**Architecture:** All changes are isolated to existing files — no new files, no new dependencies. Each task is self-contained and committed independently. The app is a fully client-side React 19 + TypeScript PWA; there is no backend, no auth, and no external API calls.

**Tech Stack:** React 19, TypeScript (strict), Vite 7, ZXing barcode library, IndexedDB (via custom storage.ts), GitHub Actions CI, deployed to GitHub Pages.

---

## File Map

| File | Tasks that touch it |
|------|-------------------|
| `src/csv.ts` | Task 1 |
| `src/dates.ts` | Task 2 |
| `index.html` | Task 3 |
| `src/App.tsx` | Tasks 4, 5, 6, 7, 8, 9 |
| `.github/workflows/deploy-pages.yml` | Task 10 |

---

## Task 1: CSV Formula Injection Prevention

**Files:**
- Modify: `src/csv.ts:22-28`

**What & why:** Spreadsheet apps (Excel, Google Sheets) treat cells starting with `=`, `+`, `-`, `@` as formulas. A barcode value like `=CMD|'/c calc'!A1` would execute when opened. The fix prepends a tab character `\t` to any such cell — spreadsheet apps then treat it as plain text, CSV parsers are unaffected.

- [ ] **Step 1: Open `src/csv.ts` and replace `escapeCsvCell`**

  Replace lines 22–28 with:

  ```typescript
  function escapeCsvCell(value: string | number): string {
    const text = String(value);
    const needsFormulaPrefix = /^[=+\-@]/.test(text);
    const escaped = /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    return needsFormulaPrefix ? `\t${escaped}` : escaped;
  }
  ```

- [ ] **Step 2: Verify the build still passes**

  ```bash
  cd c:/Python_Projects_v01/Codex/WebApp
  npx tsc --noEmit
  ```

  Expected: no errors printed.

- [ ] **Step 3: Commit**

  ```bash
  git add src/csv.ts
  git commit -m "security: prevent CSV formula injection with tab prefix"
  ```

---

## Task 2: Calendar Date Validation

**Files:**
- Modify: `src/dates.ts:18-28`

**What & why:** The regex `^\d{4}-\d{2}-\d{2}$` passes structurally valid but impossible dates like `2025-02-30`. After the regex match, verify the parsed numbers round-trip through a `Date` object to catch those cases. All existing callers already handle a `null` return from `parseDateParts`.

- [ ] **Step 1: Open `src/dates.ts` and replace `parseDateParts`**

  Replace lines 18–29 with:

  ```typescript
  function parseDateParts(value: string): { year: number; month: number; day: number } | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
      return null;
    }

    return { year, month, day };
  }
  ```

- [ ] **Step 2: Verify the build still passes**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no errors printed.

- [ ] **Step 3: Commit**

  ```bash
  git add src/dates.ts
  git commit -m "fix: reject impossible calendar dates like 2025-02-30"
  ```

---

## Task 3: Security Meta Tags in index.html

**Files:**
- Modify: `index.html:3-10` (inside `<head>`)

**What & why:**
- **CSP:** Blocks execution of any script not from the same origin. `unsafe-inline` is required because Vite injects a small inline bootstrap snippet. `blob:` and `data:` are required for the camera video stream and preview frames.
- **Referrer-Policy:** Stops the browser sending the page URL as a `Referer` header when navigating away or loading any resource.

- [ ] **Step 1: Open `index.html` and add two meta tags inside `<head>` after the existing meta tags (after line 8, before `<title>`)**

  The `<head>` block should look like this after the edit:

  ```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#194b5f" />
    <meta name="description" content="Scan barcodes, record quantities and best-before dates, and export inventory as CSV." />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self';" />
    <meta name="referrer" content="no-referrer" />
    <link rel="manifest" href="./manifest.webmanifest" />
    <link rel="icon" href="./icon.svg" type="image/svg+xml" />
    <title>Barcode Inventory</title>
  </head>
  ```

- [ ] **Step 2: Build the app and confirm it loads without CSP violations**

  ```bash
  npm run build
  ```

  Expected: build completes with no errors. Then open `dist/index.html` in a browser (or run `npm run preview`) and check the browser console — there must be zero CSP violation errors.

- [ ] **Step 3: Commit**

  ```bash
  git add index.html
  git commit -m "security: add CSP and referrer-policy meta tags"
  ```

---

## Task 4: crypto.randomUUID() Fallback

**Files:**
- Modify: `src/App.tsx:82-96` (the `createRecord` function and top of file)

**What & why:** `crypto.randomUUID()` throws a `TypeError` on older Android WebViews that ship without it, crashing record creation. A small inline fallback generates a compliant UUID v4 using `Math.random()` for those cases.

- [ ] **Step 1: Open `src/App.tsx` and add a `generateId` helper immediately before `createRecord` (before line 82)**

  Insert this function:

  ```typescript
  function generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const random = (Math.random() * 16) | 0;
      return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
    });
  }
  ```

- [ ] **Step 2: In `createRecord` (line 89), replace `crypto.randomUUID()` with `generateId()`**

  Change:
  ```typescript
  id: crypto.randomUUID(),
  ```
  To:
  ```typescript
  id: generateId(),
  ```

- [ ] **Step 3: Type-check**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "fix: add crypto.randomUUID fallback for older Android WebViews"
  ```

---

## Task 5: Delete Error Handling

**Files:**
- Modify: `src/App.tsx:413-416` (the `removeRecord` function)

**What & why:** Currently, if `deleteInventoryRecord` throws, the UI removes the record from state anyway — leaving the display out of sync with actual storage. The fix wraps the call in try/catch: on failure the record stays in state and an error notice is shown.

- [ ] **Step 1: Open `src/App.tsx` and replace the `removeRecord` function (lines 413–416)**

  Replace:
  ```typescript
  async function removeRecord(id: string) {
    await deleteInventoryRecord(id);
    setRecords((current) => current.filter((record) => record.id !== id));
  }
  ```

  With:
  ```typescript
  async function removeRecord(id: string) {
    try {
      await deleteInventoryRecord(id);
      setRecords((current) => current.filter((record) => record.id !== id));
    } catch {
      setNotice('Could not delete this record. Please try again.');
    }
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "fix: handle delete errors without desyncing UI state"
  ```

---

## Task 6: Save Loading State

**Files:**
- Modify: `src/App.tsx` — state declaration area (~line 163) and `savePendingRecord` (~line 372) and the Save button (~line 641)

**What & why:** The Save button gives no feedback during the IndexedDB write. On a slow phone, users may tap again causing double-submit. An `isSaving` flag disables the button and changes its label to "Saving…" for the duration of the write.

- [ ] **Step 1: Add `isSaving` state — insert after the `notice` state declaration (after line 163)**

  Add this line:
  ```typescript
  const [isSaving, setIsSaving] = useState(false);
  ```

- [ ] **Step 2: Update `savePendingRecord` to set `isSaving` around the async write**

  Replace the `try` block inside `savePendingRecord` (lines 402–410):

  ```typescript
  setIsSaving(true);
  try {
    await addInventoryRecord(record);
    setRecords((current) => [record, ...current]);
    setPendingBarcode('');
    setNotice('Saved. Ready for the next scan.');
    await startScanner();
  } catch {
    setNotice('Could not save this record on the phone.');
  } finally {
    setIsSaving(false);
  }
  ```

- [ ] **Step 3: Update the Save button (~line 641) to reflect loading state**

  Replace:
  ```tsx
  <button type="submit" className="primary-button full-width">
    <Plus size={18} aria-hidden="true" />
    Save item
  </button>
  ```

  With:
  ```tsx
  <button type="submit" className="primary-button full-width" disabled={isSaving}>
    <Plus size={18} aria-hidden="true" />
    {isSaving ? 'Saving…' : 'Save item'}
  </button>
  ```

- [ ] **Step 4: Type-check**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "ux: show saving state and disable button during record write"
  ```

---

## Task 7: Specific Camera Error Messages

**Files:**
- Modify: `src/App.tsx:128-142` (the `getScannerErrorMessage` function)

**What & why:** All camera errors currently fall through to the same generic message. Specific `DOMException` names map to clear, actionable messages. An `OverconstrainedError` case is added for completeness. The existing `NotAllowedError`, `NotFoundError`, and `NotReadableError` branches are already present — add `OverconstrainedError` and verify the existing ones are correct.

- [ ] **Step 1: Open `src/App.tsx` and check `getScannerErrorMessage` at lines 128–142**

  The existing function already handles `NotAllowedError`, `NotFoundError`, and `NotReadableError`. Add `OverconstrainedError` before the final return:

  ```typescript
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
      if (error.name === 'OverconstrainedError') {
        return 'The camera does not support the required resolution. Try a different browser.';
      }
    }

    return 'Camera scanning is unavailable. You can enter the barcode manually.';
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "ux: add OverconstrainedError camera message"
  ```

---

## Task 8: aria-live Region for Notices

**Files:**
- Modify: `src/App.tsx:649` (the notice paragraph)

**What & why:** The `notice` element updates silently — screen readers don't announce changes because there's no live region. Adding `aria-live="polite"` and `aria-atomic="true"` tells screen readers to announce the full updated text after the current speech finishes.

The notice `<p>` is only rendered when `notice` is non-empty, which means the live region appears and disappears from the DOM. To ensure screen readers always have the live region available to observe, render the element unconditionally (empty string when no notice) and let CSS hide it visually when empty.

- [ ] **Step 1: Open `src/App.tsx` and replace the notice render at line 649**

  Replace:
  ```tsx
  {notice && <p className="notice">{notice}</p>}
  ```

  With:
  ```tsx
  <p className="notice" aria-live="polite" aria-atomic="true">
    {notice}
  </p>
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "a11y: add aria-live region to notice element"
  ```

---

## Task 9: Descriptive Pill aria-labels

**Files:**
- Modify: `src/App.tsx:651-672` (the summary strip section)

**What & why:** The summary strip shows counts as `"0 near"` and `"1 expired"` — these are ambiguous out of context for screen readers. Adding `aria-label` on each `<div>` provides full context like "0 items near expiry" while keeping visible text short.

- [ ] **Step 1: Open `src/App.tsx` and replace the summary strip section (lines 651–671)**

  Replace:
  ```tsx
  <section className="summary-strip" aria-label="Inventory summary">
    <div>
      <span>{records.length}</span>
      lines
    </div>
    <div>
      <span>{totalQuantity}</span>
      units
    </div>
    <div>
      <span>{shelfLifeCounts['near-expiry']}</span>
      near
    </div>
    <div>
      <span>{shelfLifeCounts.expired}</span>
      expired
    </div>
    <button type="button" className="text-button" onClick={clearRecords} disabled={!hasRecords}>
      <Trash2 size={17} aria-hidden="true" />
      Clear
    </button>
  </section>
  ```

  With:
  ```tsx
  <section className="summary-strip" aria-label="Inventory summary">
    <div aria-label={`${records.length} lines`}>
      <span aria-hidden="true">{records.length}</span>
      <span aria-hidden="true">lines</span>
    </div>
    <div aria-label={`${totalQuantity} units`}>
      <span aria-hidden="true">{totalQuantity}</span>
      <span aria-hidden="true">units</span>
    </div>
    <div aria-label={`${shelfLifeCounts['near-expiry']} items near expiry`}>
      <span aria-hidden="true">{shelfLifeCounts['near-expiry']}</span>
      <span aria-hidden="true">near</span>
    </div>
    <div aria-label={`${shelfLifeCounts.expired} items expired`}>
      <span aria-hidden="true">{shelfLifeCounts.expired}</span>
      <span aria-hidden="true">expired</span>
    </div>
    <button type="button" className="text-button" onClick={clearRecords} disabled={!hasRecords}>
      <Trash2 size={17} aria-hidden="true" />
      Clear
    </button>
  </section>
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "a11y: add descriptive aria-labels to summary strip pills"
  ```

---

## Task 10: Add tsc Type-Check Step to CI

**Files:**
- Modify: `.github/workflows/deploy-pages.yml:33-35` (between Install and Build steps)

**What & why:** Vite's build transpiles TypeScript without type-checking — type errors silently reach production. Adding `npx tsc --noEmit` as a CI step before the build causes the pipeline to fail on any type error, blocking bad deploys.

- [ ] **Step 1: Open `.github/workflows/deploy-pages.yml` and add a Type-check step between Install and Build**

  Replace:
  ```yaml
        - name: Install dependencies
          run: npm ci

        - name: Build
          run: npm run build
  ```

  With:
  ```yaml
        - name: Install dependencies
          run: npm ci

        - name: Type-check
          run: npx tsc --noEmit

        - name: Build
          run: npm run build
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add .github/workflows/deploy-pages.yml
  git commit -m "ci: add TypeScript type-check step before build"
  ```

---

## Self-Review Checklist

**Spec coverage:**
- [x] 1a CSV formula injection → Task 1
- [x] 1b CSP meta tag → Task 3
- [x] 1c crypto.randomUUID fallback → Task 4
- [x] 1d Referrer-Policy meta tag → Task 3
- [x] 2a Delete error handling → Task 5
- [x] 2b Share/download dedup — already resolved: `downloadCsv` helper exists at line 98–108 in current code; no duplication remains
- [x] 2c shelfLifeCounts memoization — already implemented: line 179–190 uses `useMemo`; no action needed
- [x] 2d Date validation → Task 2
- [x] 3a aria-live notices → Task 8
- [x] 3b Descriptive pill labels → Task 9
- [x] 3c Keyboard scan toggle — already a native `<button>` (lines 534, 539); Space and Enter both work natively; no action needed
- [x] 4a Save loading state → Task 6
- [x] 4b Specific camera errors → Task 7
- [x] 5a tsc in CI → Task 10

**Placeholder scan:** No TBDs, TODOs, or vague steps. Every step has exact code.

**Type consistency:** All type names (`InventoryRecord`, `ShelfLifeStatus`, `ScannerState`) are used as-is from existing code. No new types introduced.
