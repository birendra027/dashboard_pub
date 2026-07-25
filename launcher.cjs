"use strict";
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = __dirname;
const BRANCH = "main";
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

// Pull the latest published build. Only tracked files move; the gitignored
// .env / dev.db / node_modules / logs are left untouched.
function selfUpdate() {
  if (!fs.existsSync(path.join(ROOT, ".git"))) return;
  if (!ok(spawnSync("git", ["--version"], { stdio: "ignore" }))) return;
  log("Checking for updates...");
  if (ok(spawnSync("git", ["fetch", "--quiet", "origin", BRANCH], { cwd: ROOT }))) {
    spawnSync("git", ["reset", "--hard", "origin/" + BRANCH, "--quiet"], { cwd: ROOT });
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
