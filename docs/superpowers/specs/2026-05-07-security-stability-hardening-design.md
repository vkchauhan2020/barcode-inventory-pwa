---
name: Security & Stability Hardening (Option A)
description: Targeted fixes for high/medium severity security, stability, accessibility, UX, and CI issues in the barcode inventory PWA
type: project
---

# Security & Stability Hardening — Design Spec

**Date:** 2026-05-07  
**Scope:** Option A — focused pass on high/medium severity issues only  
**App:** Barcode Inventory PWA (React 19 + TypeScript + Vite + IndexedDB, deployed to GitHub Pages)  
**Constraint:** No new dependencies. No behavioral changes to existing features. Duplicate barcodes remain allowed by design (same product, different batches/expiry dates).

---

## 1. Security Fixes

### 1a. CSV Formula Injection — `src/csv.ts:22`

**Problem:** Cells starting with `=`, `+`, `-`, or `@` are treated as formulas by Excel/Google Sheets. A barcode or product name containing `=CMD|'/c calc'!A1` would execute on open.

**Fix:** In `escapeCell`, after the existing quote-escaping logic, prefix any cell value that starts with `=`, `+`, `-`, or `@` with a tab character (`\t`). Tab-prefixed cells are treated as plain text by spreadsheet apps but parse cleanly in CSV readers.

**Files:** `src/csv.ts`

---

### 1b. Content Security Policy — `index.html`

**Problem:** No CSP is defined. Any injected script (via a compromised dependency or XSS vector) runs unchecked.

**Fix:** Add a `<meta http-equiv="Content-Security-Policy">` tag with:
- `default-src 'self'` — blocks all external resources by default
- `img-src 'self' blob: data:` — required for camera preview frames
- `media-src 'self' blob:` — required for the `<video>` camera stream
- `worker-src 'self'` — required for the service worker
- `script-src 'self' 'unsafe-inline'` — Vite inlines a small bootstrap snippet; needed unless build is ejected

**Files:** `index.html`

---

### 1c. `crypto.randomUUID()` Fallback — `src/App.tsx:89`

**Problem:** `crypto.randomUUID()` is unavailable in some older Android WebViews. The call throws a TypeError, crashing record creation entirely.

**Fix:** Extract a `generateId()` helper that tries `crypto.randomUUID()` first and falls back to a `Math.random()`-based UUID v4 string for environments that lack it.

**Files:** `src/App.tsx`

---

### 1d. Referrer Policy Meta Tag — `index.html`

**Problem:** The browser may send a `Referer` header with navigation requests, leaking the GitHub Pages URL to third-party resources.

**Fix:** Add `<meta name="referrer" content="no-referrer">` to suppress referrer headers entirely. This is safe for a fully self-contained app with no external API calls.

**Files:** `index.html`

---

## 2. Code Quality / Stability

### 2a. Delete Error Handling — `src/App.tsx:414`

**Problem:** `deleteInventoryRecord` is called with no error handling. If the IndexedDB operation fails, the record is silently removed from UI state but persists in storage — leaving the UI out of sync.

**Fix:** Wrap the delete call in try/catch. On failure:
1. Do **not** update local state (record stays visible in UI).
2. Display an error notice ("Failed to delete item. Please try again.") using the existing notice system.

**Files:** `src/App.tsx`

---

### 2b. Deduplicate Share/Download Fallback — `src/App.tsx:461-486`

**Problem:** The CSV download logic is written twice — once in the happy path and once in the error handler — with ~20 lines of duplication. Any change must be made in both places.

**Fix:** Extract a `downloadCsv(blob: Blob, filename: string): void` helper function. Both the primary share path and the error fallback call this helper. Remove the duplicated block.

**Files:** `src/App.tsx`

---

### 2c. Memoize `shelfLifeCounts` — `src/App.tsx:179-190`

**Problem:** `shelfLifeCounts` (the expired/near-expiry/ok bucket counts) is recomputed on every render, including renders triggered by unrelated state like the barcode input field changing.

**Fix:** Wrap the computation in `useMemo` with `[records, threshold]` as dependencies. The value only recomputes when records or threshold actually change.

**Files:** `src/App.tsx`

---

### 2d. Calendar Date Validation — `src/dates.ts:19`

**Problem:** The existing regex `^\d{4}-\d{2}-\d{2}$` accepts structurally valid but impossible dates like `2025-02-30` or `2025-13-01`.

**Fix:** After the regex match, construct a `Date` object from the parsed year/month/day and verify it round-trips correctly (i.e., `date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day`). Return `null` for dates that fail this check. All callers already handle `null` returns.

**Files:** `src/dates.ts`

---

## 3. Accessibility

### 3a. `aria-live` Region for Notices — `src/App.tsx:649`

**Problem:** Status messages (save success, errors, scanner state changes) update silently. Screen readers do not announce them because the container has no live region role.

**Fix:** Add `aria-live="polite"` and `aria-atomic="true"` to the notice container element. `polite` waits for current speech to finish before announcing; `atomic` reads the full updated text, not just the changed portion.

**Files:** `src/App.tsx`

---

### 3b. Descriptive Pill Labels — `src/App.tsx:654-662`

**Problem:** Shelf-life count pills display text like "0 near" which is ambiguous to screen readers without surrounding context.

**Fix:** Add `aria-label` attributes to each pill: e.g., `aria-label="0 items near expiry"`, `aria-label="1 item expired"`, `aria-label="5 items ok"`. Visible text stays short; screen readers get the full phrase.

**Files:** `src/App.tsx`

---

### 3c. Keyboard Shortcut for Scan Toggle — `src/App.tsx:520`

**Problem:** The Scan/Stop camera button is only operable by mouse or touch. Keyboard users cannot trigger it without tabbing to the button and pressing Enter (which works), but Space — the standard button activation key — may not be wired through correctly given the custom button handler.

**Fix:** Ensure the Scan/Stop button element is a native `<button>` (not a `<div>` with `onClick`) so Space and Enter both activate it by default. Verify existing implementation; patch if it's not a semantic button.

**Files:** `src/App.tsx`

---

## 4. UX

### 4a. Save Loading State — `src/App.tsx:372`

**Problem:** Tapping Save gives no feedback during the IndexedDB write. On slow devices, users may tap again, causing double submissions.

**Fix:** Add an `isSaving: boolean` state variable. Set to `true` immediately before `addInventoryRecord`, set to `false` in `finally`. While `isSaving` is true: disable the Save button and replace its label with "Saving…". This prevents double-submit and gives clear feedback.

**Files:** `src/App.tsx`

---

### 4b. Specific Camera Error Messages — `src/App.tsx:141`

**Problem:** All camera errors show the same generic message, leaving users unable to self-diagnose.

**Fix:** Branch on the error `name` property:
- `NotAllowedError` → "Camera permission denied. Please allow camera access in your browser settings."
- `NotFoundError` → "No camera found on this device."
- `NotReadableError` → "Camera is in use by another app. Close other apps and try again."
- `OverconstrainedError` → "Camera does not support the required resolution."
- Default → existing generic message as final fallback.

**Files:** `src/App.tsx`

---

## 5. CI/CD

### 5a. Type-Check Step Before Deploy — `.github/workflows/deploy-pages.yml`

**Problem:** The deploy pipeline runs `npm run build` but Vite's build does not fail on TypeScript type errors by default (it transpiles only). Type errors can reach production silently.

**Fix:** Add a `npx tsc --noEmit` step that runs **before** the build step. If TypeScript reports any errors, the workflow fails and deploy is blocked. This requires no new tooling (TypeScript is already a dev dependency).

**Files:** `.github/workflows/deploy-pages.yml`

---

## Files Changed

| File | Changes |
|------|---------|
| `src/csv.ts` | Formula injection prefix |
| `src/dates.ts` | Calendar date round-trip validation |
| `src/App.tsx` | UUID fallback, delete error handling, share dedup, shelfLifeCounts memo, aria-live, pill aria-labels, scan keyboard, save loading state, camera error messages |
| `index.html` | CSP meta tag, referrer policy meta tag |
| `.github/workflows/deploy-pages.yml` | `tsc --noEmit` step before build |

## Out of Scope

- Search/filter records
- Undo delete
- Batch delete
- Offline/online indicator
- Full test suite
- New dependencies
- Duplicate barcode prevention (intentional feature — same product multiple batches)
