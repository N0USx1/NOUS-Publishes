# Sylloge

Fully automated offline tool to backup photos from an Android phone into a USB drive (OTG).

- **NO ads, NO internet permission needed.** The app cannot go online at all — the build
  fails if any network permission sneaks into the manifest, and you can verify the
  installed app yourself in Android's app info → permissions.
- **DOES NOT delete your phone files.** Same-name files with different content are
  saved as `~2` copies.
- Incremental: files already on the drive are skipped; interrupted runs resume where
  they left off, nothing is sent twice.
- The drive stays self-describing: photos keep their original folder structure, plus a
  human-readable `manifest.csv` and per-day logs — readable on any computer without the app.

## Install

Download `Sylloge-0.9.0.apk` and install it (you may need to allow installs from unknown
sources). Requires Android 11+.

On first run the app asks for **All files access** (`MANAGE_EXTERNAL_STORAGE`) — this is
what lets it see every photo folder, including ones hidden from the system gallery.


> The bundled APK is signed with a development key. A Play Store release with a proper
> signing key is planned.

## Build from source

Open this folder in Android Studio, or:

```
./gradlew :androidApp:assembleRelease
```

## Feedback

Use the in-app "Export error report" button — it exports a diagnostic file (no photos
inside, plain text you can read yourself) and opens the
[issues page](https://github.com/N0USx1/NOUS-Publishes/issues).

## Support

If Sylloge saved your photos, you can [buy me a coffee](https://ko-fi.com/nnnous). ☕
