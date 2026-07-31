PlugBoard (packaged build)
==========================

A pluggable dashboard platform. This module contains NO source code -
only the compiled application (server obfuscated, browser UI minified,
no source maps).

Requirements:
  - Windows 10/11
  - Internet (to auto-update, install dependencies, and reach the
    authentication connector)
  - Node.js v20 or newer (installed automatically if it is
    missing or too old; an older Node already on the machine is left
    alone, PlugBoard just uses the newer one)

To run:      double-click  Start-PlugBoard.vbs
To restart:  double-click  Restart-PlugBoard.vbs
To stop:     double-click  Stop-PlugBoard.vbs

There are NO command windows: the API and UI run hidden in the
background. Each launch pulls the latest published build (if you cloned
this with git), installs anything new, then opens
  http://localhost:3000
in your browser. Start also restarts cleanly (it stops the previous run
first), so you never have to close windows by hand.

Closing the app:
  Just close the dashboard browser tab. A few seconds later PlugBoard
  stops completely on its own (API, UI, and any running plugin apps).
  Refreshing the page does NOT stop it. To use it again, run
  Start-PlugBoard.vbs.

Staying up to date:
  If you obtained this by `git clone`, every launch auto-updates to the
  latest build. Your local data is preserved: server\.env, server\dev.db
  and node_modules are never touched by the update.
  If you just copied the folder (no .git), it runs but does not auto-update.

Troubleshooting:
  - Logs are in the logs\ folder (launcher.log, api.log, ui.log).
  - Setup-Dependencies.bat forces a reinstall and shows progress.
  - "Node.js v... is too old": run Setup-Dependencies.bat and approve
    the administrator prompt so it can install Node.js v20 LTS.

Notes:
  - Sign-in is handled by the configured authentication connector
    (server\.env -> AUTH_SERVICE_URL). Accounts are created there.
  - server\.env is generated on first run with secrets unique to THIS
    machine. It is never published. Keep it private; back it up.
  - server\dev.db is the local database (dashboards, widgets, plugin
    data). Back it up to preserve your layouts.
