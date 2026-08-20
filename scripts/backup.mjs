import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sources = ["data", "uploads"].filter((dir) => existsSync(path.join(root, dir)));

if (sources.length === 0) {
  console.log("Нечего архивировать: нет ни data/, ни uploads/");
  process.exit(0);
}

const backups = path.join(root, "backups");
mkdirSync(backups, { recursive: true });

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace("T", "_")
  .slice(0, 19);
const archive = path.join(backups, `pto-${stamp}.zip`);

// Compress-Archive есть в любой Windows PowerShell, отдельная зависимость не нужна.
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path ${sources.map((dir) => `'${dir}'`).join(",")} -DestinationPath '${archive}' -Force`,
  ],
  { cwd: root, stdio: "inherit" },
);

console.log(`Готово: ${path.relative(root, archive)}`);
