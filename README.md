# Barcode Inventory PWA

Mobile-first barcode inventory app for Android phones.

## Features

- Camera barcode scanning
- Prompt-per-scan quantity and best-before date entry
- Manual barcode fallback
- Phone-local IndexedDB storage
- CSV download
- Android share sheet support for sending CSV files through email apps
- Installable PWA manifest and service worker

## Development

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

Deploy the generated `dist/` directory to HTTPS hosting, such as GitHub Pages, for camera access on Android.
