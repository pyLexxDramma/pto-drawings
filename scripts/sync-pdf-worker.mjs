import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("pdfjs-dist/package.json");
const p = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
console.log("installed", p.version);
const workerPkg = pkgPath.replace(
  "package.json",
  "legacy/build/pdf.worker.min.mjs",
);
const workerPub = "public/pdf.worker.min.mjs";
const a = fs.readFileSync(workerPkg);
fs.writeFileSync(workerPub, a);
console.log("copied legacy worker", a.length, "→ public/pdf.worker.min.mjs");
