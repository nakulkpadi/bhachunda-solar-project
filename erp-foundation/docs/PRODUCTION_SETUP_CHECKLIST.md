# Production setup checklist

This checklist moves the packaged ERP into a real, secure environment. It is
ordered so the project can be tested without exposing landowner data or
documents.

## 1. Create the Supabase foundation

1. Open the existing `bhachunda-solar-erp` Supabase project.
2. Apply all migrations in order through the Supabase CLI. The live project
   already has its data and migrations; do not rerun the initial importer.
3. Keep email sign-up enabled for this project's public access-request page.
   New profiles default to inactive and pending. Follow
   [USER_ACCESS_SETUP.md](./USER_ACCESS_SETUP.md) for email delivery.
4. After that user has signed in once, change their row in `public.profiles`
   to `admin` in the SQL editor:

   ```sql
   update public.profiles
   set role = 'admin', is_active = true, approval_status = 'approved', approved_at = now()
   where id = 'THE_AUTH_USER_UUID';
   ```

   The existing primary administrator is already configured. Use **Users &
   access** in the ERP to invite and approve other staff as Editor, Viewer or
   Commenter. Browser clients cannot change profile privileges directly.

## 2. Configure personal Google Drive OAuth

Follow [PERSONAL_GOOGLE_DRIVE_OAUTH_SETUP.md](./PERSONAL_GOOGLE_DRIVE_OAUTH_SETUP.md).
Do not create or share a service-account JSON key for a personal My Drive.

After you add the Edge Function secrets, deploy these functions from the
`erp-foundation` directory:

```bash
supabase functions deploy drive-oauth-start
supabase functions deploy drive-oauth-callback
supabase functions deploy drive-upload
```

Keep the included `supabase/config.toml` beside the functions when deploying.
It configures the OAuth callback and CORS preflight correctly; the source code
still checks the user token and application role before a browser can start a
connection or upload a document.

Then sign in as the ERP administrator, select **Documents**, choose
**Connect personal Google Drive**, and approve the exact Google account that
owns the ERP Drive folder.

## 3. Import the Excel workbook safely

Install the importer dependency and run a dry run first:

```bash
cd scripts/import-workbook
python3 -m pip install -r requirements.txt
python3 import_workbook.py \
  --land-workbook "../../../upload/BHAVANIPAR AND BITTA FINAL SHEET (1).xlsx" \
  --patel-workbook "../../../upload/PATEL INFRA - OFFICIAL LAND FORMAT.xlsx"
```

Reconcile the totals in the report. The bundled dry-run implementation treats
green cells solely as **consent received**; it does not infer that a document
has been uploaded.

When the reconciliation is approved, add `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` only to your own terminal environment and rerun
the command with `--apply`. Use `--include-private` only if you have an
explicit, lawful need to import PAN, Aadhaar or banking data.

## 4. Configure GitHub Pages deployment

The packaged workflow is `.github/workflows/deploy-erp.yml`. The committed
`apps/web/.env.production` contains only the browser-safe Supabase URL and
publishable key—never a service-role key or Google credential. Before it can
publish the production browser app:

1. In GitHub repository **Settings → Pages**, set **Source** to **GitHub
   Actions**.
2. Commit and push the ERP folder and workflow to `main`, then check the
   **Actions** tab. The workflow publishes the Vite build to the existing
   GitHub Pages URL.

Never add a Supabase service-role key, Google client secret, refresh token, or
Drive encryption key as a GitHub variable or frontend environment value.

The React app uses relative asset paths, so it works under the existing project
Pages URL (`/bhachunda-solar-project/`).

## 5. Test before real data entry

- Confirm an `admin` can sign in and a `viewer` cannot edit.
- Upload one non-sensitive PDF, then confirm it lives in the intended Drive
  folder with restricted sharing.
- Create a consent record, refresh the Survey Map, and confirm only
  **consent received** becomes green.
- Export a filtered report and reconcile it with the selected village and
  status.
- Run the Supabase security advisors after the migration and resolve any
  warnings before staff access is expanded.
