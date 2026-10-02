# Bhachunda Solar ERP - Implementation Foundation

This folder is the safe starting point for replacing the current Firebase pages. It does not contain production credentials, customer documents or a Firebase export.

## Included now

- A Supabase PostgreSQL schema for parcel, owner, consent, document, legal, payment, map and import records.
- Row Level Security foundations for Administrator, Data Entry, Legal, Finance and Viewer roles.
- Google OAuth Edge Functions for protected personal-Drive uploads, with a
  service-account option reserved for a Workspace Shared Drive.
- A React ERP browser app with live Supabase reads, filterable reports, CSV
  export, consent workflow entry, Drive document upload and an SVG survey map.
- A GitHub Pages workflow that builds the React app once production variables
  have been configured.

## Before a live deployment

1. Apply the migration, invite the first staff user, and give that user the
   `admin` role. See `docs/PRODUCTION_SETUP_CHECKLIST.md`.
2. Create the Supabase project and save its URL and anonymous key only in the browser environment configuration.
2. Keep the Supabase server secret and Google OAuth client secret in Supabase
   Edge Function secrets only. For a personal My Drive, follow
   `docs/PERSONAL_GOOGLE_DRIVE_OAUTH_SETUP.md` rather than creating a service
   account key.
3. Disable open self-sign-up and invite the initial staff users.
4. Attach the CAD map, select the Drive root folder or Shared Drive, and assign staff roles.
5. Run the workbook import in a staging Supabase project, reconcile the counts, and only then migrate Firebase data.

## Foundation layout

```text
erp-foundation/
  supabase/
    config.toml         # Edge Function authentication configuration
    migrations/        # Run every migration in order through the CLI or dashboard
    functions/          # Edge Function contracts and shared server-only code
  scripts/
    import-workbook/    # Import and reconciliation specification
    cad-map/            # DWG-to-interactive-map build script
  web-prototype/        # Review-only interface prototype with no backend calls
  apps/web/              # Production React + Supabase browser app
```

## Prototype review

Open `web-prototype/index.html` in a browser or serve this folder with any static HTTP server. It uses only synthetic, non-sensitive preview data. It is not the production React application.

## Run the React app locally

```bash
cd apps/web
cp .env.example .env.local
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local
npm install
npm run dev
```

`VITE_SUPABASE_PUBLISHABLE_KEY` is safe for the browser. It is not the
Supabase service-role key.

## Deployment and Drive setup

- [Production setup checklist](docs/PRODUCTION_SETUP_CHECKLIST.md)
- [Personal Google Drive OAuth setup](docs/PERSONAL_GOOGLE_DRIVE_OAUTH_SETUP.md)
- [Workbook importer](scripts/import-workbook/README.md)
- [CAD map build notes](scripts/cad-map/README.md)

## Security boundary

- Do not put a Google service-account credential, Supabase service-role key, Firebase key, PAN, Aadhaar or bank value in frontend source code.
- The browser may use only the Supabase URL and anonymous key. RLS protects the database.
- Drive upload, file lookup, report generation and document download authorization belong in Supabase Edge Functions.
- Store Drive file IDs and restricted links in the database. Never make landowner documents public by enabling "anyone with the link" access.
