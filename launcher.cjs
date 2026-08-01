"use strict";
// Second line of defence behind bootstrap.cmd's Node gate: refuse to run on a
// Node too old for npm/Prisma instead of failing later with a cryptic
// SyntaxError from inside a dependency. Deliberately ES5 (var, no arrows, no
// destructuring) so an ancient Node reaches this message rather than choking on
// the syntax below it.
var NODE_MIN = 24;
var nodeMajor = parseInt(String(process.versions.node).split(".")[0], 10);
if (!(nodeMajor >= NODE_MIN)) {
  var tooOld =
    "PlugBoard needs Node.js v" + NODE_MIN + " or newer, but this is v" + process.versions.node + " (" + process.execPath + ").\n" +
    "Close this window, then run Setup-Dependencies.bat and let it install the current Node.js LTS.";
  try {
    require("fs").appendFileSync(
      require("path").join(__dirname, "logs", "launcher.log"),
      "[" + new Date().toISOString() + "] " + tooOld.replace(/\n/g, " ") + "\n"
    );
  } catch (e) {}
  console.error(tooOld);
  process.exit(1);
}

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
    if (pid) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  }
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
}

// Pull the latest published build. Local state (.env, dev.db, node_modules,
// logs) is always preserved. Uses git when available, otherwise falls back to a
// git-free download of the release ZIP from GitHub.
function hasGit() {
  return fs.existsSync(path.join(ROOT, ".git")) && ok(spawnSync("git", ["--version"], { stdio: "ignore", windowsHide: true }));
}
function localVersion() {
  const f = path.join(ROOT, "VERSION");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "";
}
function selfUpdate() {
  if (hasGit()) {
    log("Checking for updates (git)...");
    if (ok(spawnSync("git", ["fetch", "--quiet", "origin", BRANCH], { cwd: ROOT, windowsHide: true }))) {
      spawnSync("git", ["reset", "--hard", "origin/" + BRANCH, "--quiet"], { cwd: ROOT, windowsHide: true });
    }
    return;
  }
  selfUpdateZip();
}
// Git-free update: curl.exe + tar.exe ship with Windows 10/11. If either is
// missing, or the machine is offline, we keep the current version silently.
function selfUpdateZip() {
  if (!REPO_SLUG) return;
  if (!ok(spawnSync("curl", ["--version"], { stdio: "ignore", windowsHide: true }))) return;
  const rawVersion = "https://raw.githubusercontent.com/" + REPO_SLUG + "/" + BRANCH + "/VERSION";
  const res = spawnSync("curl", ["-fsSL", rawVersion], { encoding: "utf8", windowsHide: true });
  if (res.status !== 0 || !res.stdout) return; // offline or not found -> keep current
  const remote = res.stdout.trim();
  if (!remote || remote === localVersion()) return; // already up to date
  log("Downloading update " + remote + " (no git)...");
  const zipUrl = "https://codeload.github.com/" + REPO_SLUG + "/zip/refs/heads/" + BRANCH;
  const tmpZip = path.join(os.tmpdir(), "plugboard-update-" + Date.now() + ".zip");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugboard-"));
  try {
    if (!ok(spawnSync("curl", ["-fsSL", "-o", tmpZip, zipUrl], { stdio: "ignore", windowsHide: true }))) { log("Update download failed; keeping current version."); return; }
    if (!ok(spawnSync("tar", ["-xf", tmpZip, "-C", tmpDir], { stdio: "ignore", windowsHide: true }))) { log("Update extract failed; keeping current version."); return; }
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
  // node_modules but no .installed_version means the last setup never finished
  // — classically because an ancient Node/npm was on PATH and left a tree this
  // npm would otherwise have to reconcile. Start that case from scratch.
  const modules = path.join(SERVER_DIR, "node_modules");
  if (fs.existsSync(modules) && !fs.existsSync(path.join(ROOT, ".installed_version"))) {
    log("Previous install did not complete - clearing server\\node_modules for a clean install.");
    try { fs.rmSync(modules, { recursive: true, force: true }); } catch (e) { log("Could not clear node_modules: " + e.message); }
  }
  if (!ok(spawnSync("npm", ["install", "--omit=dev"], { cwd: SERVER_DIR, stdio: "inherit", shell: true, windowsHide: true }))) {
    log("ERROR: server dependency install failed (see logs\\launcher.log)."); process.exit(1);
  }
  if (!ok(spawnSync("npm", ["run", "db:setup"], { cwd: SERVER_DIR, stdio: "inherit", shell: true, windowsHide: true }))) {
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
      if (!ok(spawnSync("npm", ["ci", "--omit=dev"], { cwd: appDir, stdio: "inherit", shell: true, windowsHide: true }))) {
        spawnSync("npm", ["install", "--omit=dev"], { cwd: appDir, stdio: "inherit", shell: true, windowsHide: true });
      }
    }
  }
}

// This launcher is a persistent SUPERVISOR: it stays alive and owns the API and
// UI as children (NOT detached), so they inherit its hidden console (no popup
// windows) and can all be stopped together by killing this process tree.
const children = [];
function startService(name, args, cwd, extraEnv) {
  const out = fs.openSync(path.join(LOG_DIR, name + ".log"), "a");
  const child = spawn(process.execPath, args, {
    cwd: cwd,
    env: Object.assign({}, process.env, { NODE_ENV: "production" }, extraEnv || {}),
    windowsHide: true, // hidden; inherits the supervisor's hidden console
    stdio: ["ignore", out, out],
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdownAll(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Shutting down (" + reason + ")...");
  for (const c of children) { try { c.kill(); } catch (e) {} }
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
  // Kill our whole tree to also stop plugin apps the API spawned.
  spawnSync("taskkill", ["/PID", String(process.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  process.exit(0);
}

function openBrowserWhenReady() {
  const url = "http://localhost:" + CLIENT_PORT;
  let tries = 0;
  const timer = setInterval(() => {
    const req = http.get({ host: "127.0.0.1", port: CLIENT_PORT, path: "/" }, (res) => {
      res.destroy(); clearInterval(timer);
      spawnSync("cmd", ["/c", "start", "", url], { windowsHide: true });
      log("Opened " + url);
    });
    req.on("error", () => { if (++tries > 30) { clearInterval(timer); log("UI slow to start; open " + url + " manually."); } });
    req.setTimeout(1000, () => req.destroy());
  }, 1000);
}

// --- run ---
killTracked(); // stop any running instance first, so Start also acts as a clean Restart
if (mode === "stop") { log("PlugBoard stopped."); process.exit(0); }

selfUpdate();
if (!ok(spawnSync(process.execPath, [path.join(ROOT, "prepare.cjs")], { stdio: "inherit", windowsHide: true }))) {
  log("ERROR: configuration step failed."); process.exit(1);
}
if (mode === "setup" || versionChanged()) serverSetup();
pluginAppsSetup();
if (mode === "setup") { log("Setup complete."); process.exit(0); }

// The pidfile holds the supervisor's own pid; killing its tree stops everything.
fs.writeFileSync(PID_FILE, JSON.stringify([process.pid]));
let api;
function startApi() {
  api = startService("api", [path.join("dist", "index.js")], SERVER_DIR, {});
  api.on("exit", function (code) {
    // Exit code 42 = the app asked to restart (e.g. after installing a plugin).
    // Respawn the API ONLY; the UI host stays up so the browser tab is preserved
    // (no new tab). Any other exit is a real stop/crash -> take everything down.
    if (code === 42 && !shuttingDown) {
      log("API requested a restart; respawning (UI host + browser tab stay up).");
      setTimeout(startApi, 300);
    } else {
      shutdownAll("API stopped");
    }
  });
}
startApi();
// The UI host receives our pid so it can stop the whole app when the browser closes.
const ui = startService("ui", ["serve-client.cjs"], ROOT, {
  API_PORT: String(API_PORT),
  CLIENT_PORT: String(CLIENT_PORT),
  SUPERVISOR_PID: String(process.pid),
});
log("Started PlugBoard supervisor (pid " + process.pid + ", API " + api.pid + ", UI " + ui.pid + ").");
ui.on("exit", () => shutdownAll("UI stopped"));
openBrowserWhenReady();
// The non-detached children keep this process alive; it exits via shutdownAll.
