PlugBoard (packaged build)
==========================

A pluggable dashboard platform. This module contains NO source code -
only the compiled application (server obfuscated, browser UI minified,
no source maps).

Requirements:
  - Windows 10/11
  - Internet (to auto-update, install dependencies, and reach the
    authentication connector)
  (Node.js is installed automatically if it is missing.)

To run:
  Double-click  Start-PlugBoard.bat
    - pulls the latest published build (if you cloned this with git)
    - installs Node.js if needed (Windows will ask for permission)
    - on first run (and after each update) installs dependencies and
      syncs the local database
    - starts the API and UI, then opens http://localhost:3000

Staying up to date:
  If you obtained this by `git clone`, every launch auto-updates to the
  latest published build. Your local data is preserved: server\.env,
  server\dev.db and node_modules are never touched by the update.
  If you just copied the folder (no .git), it runs but does not auto-update.

The two minimized windows are the running services (API + UI).
Close both to stop PlugBoard.

Notes:
  - Sign-in is handled by the configured authentication connector
    (server\.env -> AUTH_SERVICE_URL). Accounts are created there.
  - server\.env is generated on first run with secrets unique to THIS
    machine. It is never published. Keep it private; back it up.
  - server\dev.db is the local database (dashboards, widgets, plugin
    data). Back it up to preserve your layouts.
  - Some plugins launch their own bundled app on a local port the first
    time you start them from the dashboard.
