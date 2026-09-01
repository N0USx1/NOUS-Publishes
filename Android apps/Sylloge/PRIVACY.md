# Sylloge — Privacy Policy

**Effective date: 2026-09-01**

Sylloge backs up the photos and videos on your phone to a USB drive you plug in. That is all it does, and this policy is correspondingly short.

## The short version

**Sylloge does not collect, transmit, or share any data. It cannot: the app has no network access.**

Sylloge does not request the `INTERNET` permission, so the operating system itself prevents it from sending anything anywhere. You can verify this yourself in Android Settings → Apps → Sylloge → Permissions, or by inspecting the APK. There are no analytics, no ads, no tracking, no accounts, and no third-party SDKs that phone home.

## What the app accesses, and why

| Permission | Why Sylloge needs it |
|---|---|
| All files access (`MANAGE_EXTERNAL_STORAGE`) | To find every photo and video on your phone — including folders that the system media index misses (e.g. `.nomedia` folders, some messenger folders) — and copy them to your USB drive. Files are only ever **read** from the phone and **written** to the USB drive you chose. |
| Photos and videos (`READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`) | Fallback if you prefer not to grant All files access. The app still works, seeing only what the media index sees. |
| Notifications | To show backup progress while the app is in the background. |
| Foreground service (data sync) | To keep a backup running when the screen is off. |

## What the app stores

- **On your phone**: a small local catalog (file paths, sizes, timestamps of what has been backed up — never the photos themselves). It stays in the app's private storage and is deleted when you uninstall the app.
- **On your USB drive**: your photos and videos, plus a human-readable backup log and a manifest file (`_backup/`). The drive is yours; nothing on it is accessible to us.

Nothing is stored anywhere else. We (the developer) have no servers and receive nothing.

## Diagnostics export

If something goes wrong, you can export a diagnostic report from inside the app. This is entirely optional and user-initiated: the app generates a text file (technical information only — never your photos; the first section of the file lists exactly what it contains) and opens the standard Android share sheet. **You** choose where it goes. The app itself sends nothing.

## External links

The About page contains links (source code on GitHub, an optional Ko-fi tip page). These open in your browser, outside the app. Those websites have their own privacy policies.

## Children

Sylloge is a general-purpose utility and is not directed at children.

## Changes

Any change to this policy will be published at this same address, with an updated effective date.

## Contact

Questions or concerns: open an issue at
https://github.com/N0USx1/NOUS-Publishes/issues
