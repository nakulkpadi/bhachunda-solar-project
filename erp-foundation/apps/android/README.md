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

Session tokens are AES-GCM encrypted with an Android Keystore key. Passwords are never persisted. Automatic backup/device transfer is disabled. Business data stays in memory; protected temporary files are app-private, removed on logout/access changes and on app startup. Approved ERP screens prevent screenshots. This version has no offline write queue: edits require a successful live connection, and failed requests never show a saved confirmation. Concurrent consent changes are checked before overwriting. The server still provides the final permission checks.

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
