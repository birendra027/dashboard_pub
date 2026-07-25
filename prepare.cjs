// First-run setup: create server/.env from the template with per-machine secrets.
// No dependencies (Node core only). Safe to run every start -- it is a no-op
// once server/.env already exists.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const serverDir = path.join(__dirname, "server");
const envPath = path.join(serverDir, ".env");
const templatePath = path.join(serverDir, ".env.template");

if (fs.existsSync(envPath)) process.exit(0);
if (!fs.existsSync(templatePath)) {
  console.error("prepare: server/.env.template is missing; cannot generate .env");
  process.exit(1);
}

const key = () => crypto.randomBytes(32).toString("hex");
const content = fs
  .readFileSync(templatePath, "utf8")
  .replace("__GENERATED_ON_FIRST_RUN_JWT__", key())
  .replace("__GENERATED_ON_FIRST_RUN_KEY__", key());

fs.writeFileSync(envPath, content);
console.log("Generated server/.env with fresh, machine-unique secrets.");
