# Drive upload Edge Function

`index.ts` is the server-only implementation used by the React app. It writes
one file into the canonical Google Drive folder for the selected village and
survey number, then records its Drive ID and checksum in Supabase.

## Request

`POST /functions/v1/drive-upload` as authenticated multipart form data:

- `parcel_id` - required UUID for an existing parcel.
- `document_type_code` - required code from `document_types`.
- `owner_id` - optional UUID when the document belongs to one owner.
- `file` - one PDF, JPG, PNG or permitted office document.

## Required server-side flow

1. Verify the Supabase access token and identify the requesting user.
2. Check the user has Administrator, Data Entry or Legal access for the requested action.
3. Load the parcel and village from Supabase using a service-role client. Never trust names, folder IDs or role values supplied by the browser.
4. Validate the real file signature, MIME type, extension and configured size limit. Reject executable and active-content files.
5. Find the parcel folder in `drive_folders`, or create `Village / Survey Number` below the configured Drive root.
6. Upload with a generated filename such as `BHAVANIPAR_450_CONSENT_LETTER_2026-10-02.pdf`.
7. Store only Drive file ID, folder ID, metadata, checksum and audit record in Supabase. Do not use public "anyone with link" sharing.
8. Return a minimal document record. Do not return a Google credential, raw API response, PII or a permanent public URL.

## Server-only secrets

Set the following in Supabase Edge Function secrets. They must never be committed or sent to the frontend.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGIN` - exactly `https://nakulkpadi.github.io` for the current GitHub Pages host (no trailing slash).
- `DRIVE_ROOT_FOLDER_ID` - fallback root. A village-specific `drive_root_folder_id` takes precedence.
- `GOOGLE_DRIVE_AUTH_MODE=oauth` for a personal My Drive.
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `DRIVE_TOKEN_ENCRYPTION_KEY`

The OAuth refresh token is captured by `drive-oauth-callback` and stored
encrypted in `integration_secrets`; it is never placed in frontend code or a
repository. See `docs/PERSONAL_GOOGLE_DRIVE_OAUTH_SETUP.md`.

## Download rule

The app should request an authorized short-lived Drive access URL from a separate Edge Function. It must re-check role and parcel access before issuing the redirect or signed URL.

## Deployment checklist

1. For personal My Drive, create the Google OAuth web client and follow the
   OAuth setup guide. Do not create a service-account key for My Drive.
2. Add the OAuth secret values, `DRIVE_ROOT_FOLDER_ID` and `ALLOWED_ORIGIN` to
   Supabase Edge Function secrets. The hosted runtime has Supabase server
   credentials; never put them in the web app.
3. Deploy with JWT verification enabled. The function independently verifies
   the user token and requires an active `admin`, `data_entry` or `legal` role.
4. Permit only PDF, JPG, PNG, DOCX and XLSX uploads of 15 MB or less. Extend
   the signature verification before allowing other types.
5. If the project requires malware scanning, add a quarantine status and scan
   before marking any document as verified.

## Workspace Shared Drive alternative

When the project moves to Google Workspace, set
`GOOGLE_DRIVE_AUTH_MODE=service_account`, grant the service account access to
the Shared Drive, and set `GOOGLE_SERVICE_ACCOUNT_JSON` as an Edge Function
secret. This alternative is not the personal My Drive setup.
