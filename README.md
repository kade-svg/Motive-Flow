# Motive Flow

A standalone, responsive Motive Flow web app. This package does **not** require the Motive Labs product site or a server/database.

## What is included

- Local sign-in / account creation
- Password hashes stored locally in the browser
- Device-local tasks, projects, notes, and focus sessions
- Light, dark, and system themes
- JSON export/import backups
- Responsive phone-first UI
- PWA manifest and service worker for supported hosted installs

## Run

For a quick local test, open `index.html` in a modern browser. Your account and Flow data are stored in that browser's local storage.

For PWA/offline-install behavior, serve this folder over a local/static HTTP(S) host and open `index.html` through that address.

## Important

There is no cloud account system in this build. A Motive Flow account only exists on the device/browser where it is created. Use **Settings → Export backup** to move your Flow data to another device.
