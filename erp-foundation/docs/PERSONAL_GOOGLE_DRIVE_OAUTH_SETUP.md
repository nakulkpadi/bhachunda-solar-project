# Connect a personal Google Drive

## Use OAuth for My Drive

This project uses Google OAuth 2.0 for a personal **My Drive**. Do not use a
service-account JSON key for this setup: a service account is not your personal
Google account and does not have My Drive storage quota. OAuth lets the project
upload as the Google account that owns the project folder.

The web app never sees the Google password, OAuth client secret or refresh
token. The one-time consent flow stores an encrypted refresh token in the
private `integration_secrets` table; the encryption key remains in Supabase
Edge Function secrets.

## 1. Prepare one Drive root folder

1. In the personal Google Drive that will hold the project records, create a
   folder such as `Bhachunda Solar ERP`.
2. Open that folder and copy its ID from the end of its URL. For example, the
   ID in `https://drive.google.com/drive/folders/ABC123` is `ABC123`.
3. Keep all survey folders inside this root. The app will create folders such
   as `bhavanipar-450` automatically.

## 2. Create the Google Cloud API configuration

1. Open the Google Cloud console and create a project, for example
   `Bhachunda Solar ERP`.
2. In **APIs & Services → Library**, enable **Google Drive API**.
3. In **Google Auth Platform / OAuth consent screen**, provide your support
   email and add the Google account that owns the Drive folder as a test user
   while the app is being configured.
4. Add the Google Drive scope
   `https://www.googleapis.com/auth/drive`. The app needs this scope because
   it must use an existing folder in your personal My Drive and retain access
   for future automated uploads.
5. In **Credentials**, create an **OAuth client ID** of type **Web
   application**. Add exactly this authorised redirect URI:

   ```text
   https://YOUR-SUPABASE-PROJECT.supabase.co/functions/v1/drive-oauth-callback
   ```

   Replace `YOUR-SUPABASE-PROJECT` with the project URL shown in the Supabase
   dashboard. Do not use the GitHub Pages URL as the redirect URI.
6. Copy the OAuth client ID and client secret to a safe place. Do not send
   either value in chat and do not put them in the frontend `.env.local` file.

## 3. Configure Supabase Edge Function secrets

In **Supabase Dashboard → Edge Functions → Secrets**, add these values:

```text
GOOGLE_DRIVE_AUTH_MODE=oauth
GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret
DRIVE_ROOT_FOLDER_ID=the-folder-id-from-step-1
ALLOWED_ORIGIN=https://nakulkpadi.github.io
DRIVE_TOKEN_ENCRYPTION_KEY=a-random-32-byte-base64-secret
```

Generate `DRIVE_TOKEN_ENCRYPTION_KEY` once on your own computer, for example:

```bash
openssl rand -base64 32
```

Keep that encryption key permanently. Losing it means the saved Drive refresh
token cannot be decrypted and the connection must be re-authorised.

## 4. Deploy and connect

After deploying the three Edge Functions below, sign in to the ERP using an
account whose `profiles.role` is `admin`. Open **Documents** and select
**Connect personal Google Drive**. Google will show its consent page; choose
the exact Google account that owns the Drive root folder and approve it.

```bash
supabase functions deploy drive-oauth-start
supabase functions deploy drive-oauth-callback
supabase functions deploy drive-upload
```

The supplied `supabase/config.toml` intentionally turns off Supabase's legacy
gateway JWT check. This is required for the OAuth redirect and browser CORS
preflight to reach the handler. It does **not** make uploads or connection
requests public: the `drive-oauth-start` and `drive-upload` handlers validate
the Supabase user token and role themselves, while the callback accepts only a
single-use state record that expires after ten minutes.

The callback page confirms the connection without exposing the refresh token.
Then test one PDF upload for a non-sensitive test survey and confirm all of the
following:

- The folder appears below the Drive root.
- The file appears inside that survey folder.
- The `parcel_documents` row has a Drive file ID.
- Drive sharing is still restricted; do not use “Anyone with the link”.

## Access boundary

Google OAuth scopes are account-wide, even though this ERP code only writes
inside `DRIVE_ROOT_FOLDER_ID`. If granting that scope to the personal Google
account is not acceptable, use a dedicated Google account for project records
or a Google Workspace Shared Drive instead. Never reuse a Drive token outside
the Edge Functions.

## Existing consent documents

Existing files are not automatically assumed to belong to a survey only
because an Excel cell is green. Green means consent received. Reconcile the
existing Drive files against village and survey number, then import their Drive
IDs through a reviewed migration before marking document rows as uploaded.
