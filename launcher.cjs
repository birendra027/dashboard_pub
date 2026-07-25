"use strict";
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const ROOT = __dirname;
const BRANCH = "main";
const REPO_SLUG = "birendra027/dashboard_pub"; // e.g. owner/repo, for git-free ZIP updates
const API_PORT = 4000;
const CLIENT_PORT = 3000;
const SERVER_DIR = path.join(ROOT, "server");
const LOG_DIR = path.join(ROOT, "logs");
const PID_FILE = path.join(ROOT, ".plugboard.pids");
const mode = (process.argv[2] || "start").toLowerCase();

fs.mkdirSync(LOG_DIR, { recursive: true });
function log(msg) {
  try { fs.appendFileSync(path.join(LOG_DIR, "launcher.log"), "[" + new Date().toISOString() + "] " + msg + "\n"); } catch (e) {}
  console.log(msg);
}
function ok(r) { return r && r.status === 0; }

// Kill a previously started instance (API + UI and their children) via the pidfile.
function killTracked() {
  if (!fs.existsSync(PID_FILE)) return;
  let pids = [];
  try { pids = JSON.parse(fs.readFileSync(PID_FILE, "utf8")); } catch (e) {}
  for (const pid of pids) {
    if (pid) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  }
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
}

// Pull the latest published build. Local state (.env, dev.db, node_modules,
// logs) is always preserved. Uses git when available, otherwise falls back to a
// git-free download of the release ZIP from GitHub.
function hasGit() {
  return fs.existsSync(path.join(ROOT, ".git")) && ok(spawnSync("git", ["--version"], { stdio: "ignore" }));
}
function localVersion() {
  const f = path.join(ROOT, "VERSION");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "";
}
function selfUpdate() {
  if (hasGit()) {
    log("Checking for updates (git)...");
    if (ok(spawnSync("git", ["fetch", "--quiet", "origin", BRANCH], { cwd: ROOT }))) {
      spawnSync("git", ["reset", "--hard", "origin/" + BRANCH, "--quiet"], { cwd: ROOT });
    }
    return;
  }
  selfUpdateZip();
}
// Git-free update: curl.exe + tar.exe ship with Windows 10/11. If either is
// missing, or the machine is offline, we keep the current version silently.
function selfUpdateZip() {
  if (!REPO_SLUG) return;
  if (!ok(spawnSync("curl", ["--version"], { stdio: "ignore" }))) return;
  const rawVersion = "https://raw.githubusercontent.com/" + REPO_SLUG + "/" + BRANCH + "/VERSION";
  const res = spawnSync("curl", ["-fsSL", rawVersion], { encoding: "utf8" });
  if (res.status !== 0 || !res.stdout) return; // offline or not found -> keep current
  const remote = res.stdout.trim();
  if (!remote || remote === localVersion()) return; // already up to date
  log("Downloading update " + remote + " (no git)...");
  const zipUrl = "https://codeload.github.com/" + REPO_SLUG + "/zip/refs/heads/" + BRANCH;
  const tmpZip = path.join(os.tmpdir(), "plugboard-update-" + Date.now() + ".zip");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugboard-"));
  try {
    if (!ok(spawnSync("curl", ["-fsSL", "-o", tmpZip, zipUrl], { stdio: "ignore" }))) { log("Update download failed; keeping current version."); return; }
    if (!ok(spawnSync("tar", ["-xf", tmpZip, "-C", tmpDir], { stdio: "ignore" }))) { log("Update extract failed; keeping current version."); return; }
    const subs = fs.readdirSync(tmpDir).map((n) => path.join(tmpDir, n)).filter((p) => fs.statSync(p).isDirectory());
    if (!subs.length) { log("Update archive was empty; keeping current version."); return; }
    // The archive contains only tracked files (no .env/dev.db/node_modules/logs),
    // so copying it over the app overwrites code while leaving local state intact.
    fs.cpSync(subs[0], ROOT, { recursive: true, force: true });
    log("Updated to " + remote + ".");
  } catch (e) {
    log("Update failed: " + e.message + " (keeping current version).");
  } finally {
    try { fs.rmSync(tmpZip, { force: true }); } catch (e) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}

function versionChanged() {
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "");
  return read(path.join(ROOT, "VERSION")) !== read(path.join(ROOT, ".installed_version"));
}

function serverSetup() {
  log("Installing / updating the app (first run or update can take a minute)...");
  if (!ok(spawnSync("npm", ["install", "--omit=dev"], { cwd: SERVER_DIR, stdio: "inherit", shell: true }))) {
    log("ERROR: server dependency install failed (see logs\\launcher.log)."); process.exit(1);
  }
  if (!ok(spawnSync("npm", ["run", "db:setup"], { cwd: SERVER_DIR, stdio: "inherit", shell: true }))) {
    log("ERROR: database setup failed (see logs\\launcher.log)."); process.exit(1);
  }
  const v = path.join(ROOT, "VERSION");
  if (fs.existsSync(v)) fs.copyFileSync(v, path.join(ROOT, ".installed_version"));
}

// Build any installed plugin sub-app that has not been set up yet. Runs every
// launch (cheap when present) so a store-installed plugin is ready next start.
function pluginAppsSetup() {
  const dir = path.join(ROOT, "plugins");
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const appDir = path.join(dir, name, "app");
    if (fs.existsSync(path.join(appDir, "package.json")) && !fs.existsSync(path.join(appDir, "node_modules"))) {
      log("Setting up plugin " + name + " (first use)...");
      if (!ok(spawnSync("npm", ["ci", "--omit=dev"], { cwd: appDir, stdio: "inherit", shell: true }))) {
        spawnSync("npm", ["install", "--omit=dev"], { cwd: appDir, stdio: "inherit", shell: true });
      }
    }
  }
}

function startService(name, args, cwd, extraEnv) {
  const out = fs.openSync(path.join(LOG_DIR, name + ".log"), "a");
  const child = spawn(process.execPath, args, {
    cwd: cwd,
    env: Object.assign({}, process.env, { NODE_ENV: "production" }, extraEnv || {}),
    detached: true,        // survives launcher exit
    windowsHide: true,     // no console window
    stdio: ["ignore", out, out],
  });
  child.unref();
  return child.pid;
}

function openBrowserWhenReady() {
  const url = "http://localhost:" + CLIENT_PORT;
  let tries = 0;
  const timer = setInterval(() => {
    const req = http.get({ host: "127.0.0.1", port: CLIENT_PORT, path: "/" }, (res) => {
      res.destroy(); clearInterval(timer);
      spawnSync("cmd", ["/c", "start", "", url], { windowsHide: true });
      log("Opened " + url); process.exit(0);
    });
    req.on("error", () => { if (++tries > 30) { clearInterval(timer); log("UI slow to start; open " + url + " manually."); process.exit(0); } });
    req.setTimeout(1000, () => req.destroy());
  }, 1000);
}

// --- run ---
killTracked(); // stop any running instance first, so Start also acts as a clean Restart
if (mode === "stop") { log("PlugBoard stopped."); process.exit(0); }

selfUpdate();
if (!ok(spawnSync(process.execPath, [path.join(ROOT, "prepare.cjs")], { stdio: "inherit" }))) {
  log("ERROR: configuration step failed."); process.exit(1);
}
if (mode === "setup" || versionChanged()) serverSetup();
pluginAppsSetup();
if (mode === "setup") { log("Setup complete."); process.exit(0); }

const apiPid = startService("api", [path.join("dist", "index.js")], SERVER_DIR, {});
const uiPid = startService("ui", ["serve-client.cjs"], ROOT, { API_PORT: String(API_PORT), CLIENT_PORT: String(CLIENT_PORT) });
fs.writeFileSync(PID_FILE, JSON.stringify([apiPid, uiPid]));
log("Started PlugBoard (API pid " + apiPid + ", UI pid " + uiPid + ").");
openBrowserWhenReady();
