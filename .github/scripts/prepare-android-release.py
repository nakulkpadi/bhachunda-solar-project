from pathlib import Path
import os, re, hashlib, json, zipfile, shutil, datetime

source = Path("android-apk")
out = Path("publish")
out.mkdir(exist_ok=True)
apks=list(source.glob("Bhachunda-ERP-*.apk"))
assert len(apks)==1, "Expected exactly one tested APK"
apk=apks[0]
expected = (source / "SHA256SUMS.txt").read_text().split()[0]
actual = hashlib.sha256(apk.read_bytes()).hexdigest()
assert actual == expected, "APK checksum differs from the tested build"
with zipfile.ZipFile(apk) as z:
    names = set(z.namelist())
    assert {"AndroidManifest.xml", "classes.dex", "assets/survey-map.svg"} <= names
info = (source / "package-info.txt").read_text()
assert "package: name='com.bhachunda.erp'" in info
version = re.search(r"versionName='([^']+)'", info).group(1)
assert re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version)
assert "sdkVersion:'26'" in info
assert "targetSdkVersion:'35'" in info
signature = (source / "signature.txt").read_text()
assert "Verifies" in signature
cert_sha = re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)", signature).group(1)
expected_signer="c5558fce47d1aa0f358eec23f5153660a0de1296295ffb7fbf9034a02bbdeaf1"
if cert_sha.lower()!=expected_signer:
    with open(os.environ["GITHUB_OUTPUT"],"a") as output:
        output.write("ready=false\n")
    print("Android update publication paused: configure the original production signing certificate in repository Actions secrets.")
    raise SystemExit(0)
with open(os.environ["GITHUB_OUTPUT"],"a") as output:
    output.write("ready=true\n")
sha = os.environ["BUILD_SHA"]
assert re.fullmatch(r"[0-9a-f]{40}", sha)
repository = os.environ["GITHUB_REPOSITORY"]
run_id = os.environ["BUILD_RUN_ID"]
assert run_id.isdigit()
tag = "android-v" + version
name = "Bhachunda-ERP-" + version + ".apk"
shutil.copyfile(apk, out / name)
shutil.copyfile(source / "signature.txt", out / "signature.txt")
shutil.copyfile(source / "signing-backup.cms", out / "Bhachunda-ERP-Signing-Backup.cms")
shutil.copyfile("erp-foundation/apps/android/signing-backup-certificate.pem", out / "signing-backup-certificate.pem")
manifest = {
    "app": "Bhachunda Solar ERP", "package": "com.bhachunda.erp",
    "version": version, "minimum_android": "8.0", "target_sdk": 35,
    "apk_sha256": actual, "signer_certificate_sha256": cert_sha,
    "apk_bytes": apk.stat().st_size, "source_commit": sha,
    "verified_build": f"https://github.com/{repository}/actions/runs/{run_id}",
    "created_utc": datetime.datetime.now(datetime.timezone.utc).isoformat()
}
(out / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
install = """BHACHUNDA SOLAR ERP — ANDROID
Install the APK on Android 8 or newer. If Android asks, allow installation
from the app you used to download this file. Sign in with your existing ERP
email and password. New accounts require administrator approval.

The application has native Android screens for survey records, prefilled
consent entry, documents, the full CAD map, reports and user management.
It uses the existing Supabase project and Google Drive integration.
It refreshes while open roughly every five seconds and after a saved change.
Internet is required for live data and writes. Automatic Drive folder repair
is paused. Private KYC uploads require the existing Drive root to be Restricted.

Verification: unit/API checks, native Android emulator tests, signature
verification, and installation of the exact release APK on Android 15.
These checks used fixtures. A real approved user's sign-in, Drive uploads
and invitation email delivery have not been tested with this release.

UPDATES / SIGNING BACKUP — PROJECT OWNER
Bhachunda-ERP-Signing-Backup.cms is an encrypted copy of the release keystore
and its password. It contains no readable signing key. Keep your private
apk-backup-decryption-key.pem separately; it was saved privately during setup.
Do not publish that private recovery key, the decrypted keystore or password.

With OpenSSL and that private recovery key, restore the signing backup:
openssl cms -decrypt -binary -inform DER -in Bhachunda-ERP-Signing-Backup.cms -recip signing-backup-certificate.pem -inkey apk-backup-decryption-key.pem -out signing-backup.tar
Extract signing-backup.tar into a private directory. It contains
release-signing.p12 and keystore-password.txt. Retain these for all updates.

Before building the next version, the owner must put the P12 file's base64
value into the GitHub Actions secret ANDROID_KEYSTORE_BASE64, and its password
into ANDROID_KEYSTORE_PASSWORD. Use the same signing key for future updates.
Increase Android versionName and versionCode before publishing a new version.
"""
(out / "INSTALL.txt").write_text(install)
files = sorted(p for p in out.iterdir() if p.is_file())
(out / "SHA256SUMS.txt").write_text("".join(hashlib.sha256(p.read_bytes()).hexdigest() + "  " + p.name + "\n" for p in files))
bundle = out / ("Bhachunda-ERP-Android-" + version + ".zip")
with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as z:
    for p in files + [out / "SHA256SUMS.txt"]:
        z.write(p, p.name)
notes = f"""Native Android ERP for Bhavanipar, Bitta and Vandh Timbo.

Install **{name}** on Android 8 or newer and sign in with your existing approved ERP account. The app includes native survey details, prefilled consent entry, document upload/viewing, the complete CAD map, Patel Infra reports and role-based access. Live data refreshes while the app is open, roughly every five seconds and after saving.

The exact signed APK passed Android 15 installation and launch checks after unit/API and native emulator checks. Real-account sign-in, Drive uploads and invitation email delivery remain unverified. Automatic Drive folder repair remains paused.

Build: https://github.com/{repository}/actions/runs/{run_id}
Source: {sha}
APK SHA-256: {actual}

The owner should retain the encrypted signing backup and the separately saved private recovery key for future updates. See INSTALL.txt.
"""
(out / "RELEASE-NOTES.md").write_text(notes)
with open(os.environ["GITHUB_OUTPUT"], "a") as output:
    output.write(f"tag={tag}\napk={name}\nsha256={actual}\n")
print(json.dumps({"version": version, "apk_bytes": apk.stat().st_size, "sha256": actual, "signer_sha256": cert_sha, "verified_source": sha}))

