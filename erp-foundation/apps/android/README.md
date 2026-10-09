# Bhachunda ERP for Android

Native Kotlin and Jetpack Compose application for the existing Bhachunda Solar ERP. No WebView, PWA launcher, browser wrapper or JavaScript runtime is used. The full CAD geometry is rendered with Android Canvas.

## Included

- Native sign-in, registration, password reset and approval waiting screen.
- Live, foreground synchronization every five seconds using the existing Supabase Auth, REST views and protected Edge Functions. Sync pauses when the app is backgrounded. Changes and document uploads use the existing ERP records and Google Drive account.
- Survey search and filters, complete land/project/owner/legal details, prefilled consent entry, acquisition stage and survey field editing, owner identity/bank entry, survey notes.
- All 990 CAD boundaries and 1,074 labels, native pinch/double-tap zoom, pan, mouse-wheel zoom, fit map, survey finder and parcel selection. Only received consent is green; unlinked CAD boundaries are identified honestly.
- Drive document selection, upload, existing-file linking, protected download, native PDF/image preview, save and Android sharing.
- Filtered CSV and original backend-generated Patel Infra XLSX reports. Confidential Patel reports and user administration require an approved administrator.
- Administrator invitations and approval with Editor, Viewer and Commenter roles. New accounts remain pending. Existing server RLS/role checks continue to govern every request.

## Privacy and access

Session tokens are AES-GCM encrypted with an Android Keystore key. Passwords are never persisted. Automatic backup/device transfer is disabled. Business data stays in memory; protected temporary files are app-private, removed on logout/access changes and on app startup. Screens containing survey/owner details, files, reports and user administration prevent screenshots; the overview and map allow them. This version has no offline write queue: edits require a successful live connection, and failed requests never show a saved confirmation. Concurrent consent changes are checked before overwriting. The server still provides the final permission checks.

The same Drive privacy configuration applies to the web and Android apps. Existing public Drive links remain public until the owner restricts their sharing. The app preserves the server's block on private KYC uploads into publicly shared folders.

## Build and checks

Pinned tooling: Java 17, Gradle 8.11.1, Android Gradle Plugin 8.9.2, Kotlin/Compose compiler 2.1.20, compile/target SDK 35, minimum SDK 26 (Android 8). Browser-safe Supabase configuration is read from the existing web `.env.production`; the build rejects server/service-role keys.

Run with Gradle 8.11.1 and Android SDK 35:

```sh
gradle :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
gradle :app:connectedDebugAndroidTest
```

The GitHub workflow builds and runs native UI/map/encrypted-session tests on an Android 15 emulator, signs a non-debuggable release, verifies the signature, then installs and launches that exact release APK on a clean emulator. Live authenticated account/invitation delivery tests require an approved account and working project email delivery; they are not replaced by fixture tests.

## Preserve the signing identity for updates

The first build creates a new release signing identity. Only its encrypted backup is uploaded by CI; the private recovery key is kept separately with the project owner. Preserve the delivered `release-signing.p12` and `keystore-password.txt` securely. They are required to install later versions over the existing app without uninstalling it.

For later builds, set repository Actions secrets `ANDROID_KEYSTORE_BASE64` (base64 of that PKCS12 file) and `ANDROID_KEYSTORE_PASSWORD` (the saved password). The alias is `bhachunda-erp`. Increase `versionCode` for each update. Never commit the keystore, its password or the backup decryption key to GitHub.

Folder repair is not automatically run by the app or its build. Existing folder work remains paused until requested.

# Unsigned consent generator

Version 1.0.1 adds the generator under More → Consent generator for approved Administrators and Editors. Village, survey, khata, area and owner names prefill from the ERP. Save the form as a separate Supabase draft, then save, share or print its English/Gujarati PDF. Draft PDFs use a separate document category and a targeted child of the survey's existing Other folder. Bulk Drive folder setup and repair are not started.

Generated forms never write to `consent_records`, change map colours, record a signature, or confirm the token payment described by the original legal template. The owner still needs to sign; received consent is recorded through the existing receipt entry.

Android updates must use the original production certificate. The publisher checks its SHA-256 fingerprint before release. Configure `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` in repository Actions secrets using the existing signing backup. A build with another certificate is tested but publication is paused so it cannot replace the installed app.

## Isolated validation branch (9 October 2026)

The `erp-apk-validation-20261009` branch runs `.github/workflows/validate-erp-apk.yml` without deploying the web app, Edge Functions or database. It does not request signing secrets, build a release, publish an APK or call folder setup/repair. Emulator tests use synthetic records and no authenticated business account.

Configuration precedence is process environment, then `android.properties` if present, otherwise the historical web `.env.production`. Copy `android.properties.example` to `android.properties` for a separate staging project. Provide only public Supabase client settings: `ERP_SUPABASE_URL`, `ERP_SUPABASE_PUBLISHABLE_KEY` (or legacy `ERP_SUPABASE_ANON_KEY`), and optional `ERP_WEB_URL`. Do not package a service-role key. Production release builds still require the original Supabase project.

Debug APKs use `com.bhachunda.erp.debug` and version name `1.0.1-debug`, so they install alongside the original production app. GitHub validation falls back to the repository's existing public production client configuration, but makes no live authenticated data requests. An owner who logs into this debug build will access the real ERP; its data writes require the normal server permissions. There is no offline queue. This build is not a production update, and authenticated sync/upload/email operations remain unverified until tested deliberately with an authorized account.

Survey rows and map bindings now use ordered, cancellable pagination and continue after short pages. A later-page error aborts the refresh instead of publishing an incomplete list. Offset pagination is not a transactional snapshot; simultaneous insert/delete operations can still change page boundaries, and the next foreground refresh reconciles them. This should be replaced by cursor/snapshot pagination if project scale or concurrent imports make that necessary.

Fresh build/test results belong in the validation report; older successful CI evidence is not proof that these changes pass.
