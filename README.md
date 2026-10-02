# ☀️ Bachunda Sub Station Solar Project

A modern, responsive, and secure digital portal built to streamline data logging, land management records, and area conversions for the Bachunda Sub Station Solar Project.

---

## ERP rebuild package

The new Supabase-based ERP is ready in
[`erp-foundation/`](./erp-foundation/). It includes the React web application,
database migration, Excel importer, protected personal Google Drive OAuth
upload flow, reporting filters, and CAD-backed survey map.

The legacy Firebase pages remain untouched until the new database migration,
Drive OAuth setup, and staging import are approved. Start with
[`erp-foundation/README.md`](./erp-foundation/README.md) and the
[production checklist](./erp-foundation/docs/PRODUCTION_SETUP_CHECKLIST.md).

---

## 🚀 Live Demo
Access the live deployment here:  
👉 **[https://nakulkpadi.github.io/bhachunda-solar-project/](https://nakulkpadi.github.io/bhachunda-solar-project/)**

---

## 🛠️ Key Features

*   **Centralized Project Database**: Real-time land record tracking synced seamlessly with **Firebase Firestore**. Includes admin-authenticated toggle layers for full data CRUD operations (Create, Read, Update, Delete).
*   **Automatic Date Logging**: Tracks and stamps the exact creation date automatically whenever a new registry log is entered.
*   **Lease Rent & Area Calculators**: Fully integrated computational tools allowing quick land dimension conversions across multiple local and standard metrics.
*   **Document Dossier System**: Instant inline links to digital asset folders and verification tracking (PAN & Aadhaar validation badges).
*   **Clean UI/UX Architecture**: Crafted using premium design primitives, featuring responsive grid layouts, status-tracking indicators, and native clean-print compatibility for exporting data PDFs.

---

## 🔒 Security Configuration

This project is hardened against public script manipulation using multi-tiered web safeguards:
1.  **Application Restrictions**: The Firebase API key is strictly bound via Google Cloud HTTP referrers, meaning it will exclusively execute when requests originate from the designated GitHub Pages domain:
    `https://nakulkpadi.github.io/bhachunda-solar-project/*`
2.  **GitHub Advanced Security**: Active analysis running via automated **CodeQL code scanning** checks and background **Dependabot alerts** ensuring dependency graphs remain free of structural vulnerabilities.

---

## 📁 Repository Structure

```text
├── index.html          # Main landing portal and dashboard grid
├── database.html       # Land records management panel with Firestore sync
├── calculator.html     # Native dynamic area metric converter
├── logo.png            # Project branding asset
└── banner.jpg          # Clean energy hero section graphic
