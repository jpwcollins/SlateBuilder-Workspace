// Records every scripted section in order. Needs the production build
// served on port 3100 (the "offices-prod" preview, or SLATEBUILDER_URL).
//   node docs/video/capture/record-all.mjs            all sections
//   node docs/video/capture/record-all.mjs s05 s09    just these

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2);
const takes = fs
  .readdirSync(here)
  .filter((f) => /^s\d\d-.*\.mjs$/.test(f))
  .filter((f) => !wanted.length || wanted.some((w) => f.startsWith(w)))
  .sort();

const failed = [];
for (const file of takes) {
  console.log(`\n== ${file}`);
  const run = spawnSync(process.execPath, [path.join(here, file)], { stdio: "inherit" });
  if (run.status !== 0) failed.push(file);
}
console.log(failed.length ? `\nFailed: ${failed.join(", ")}` : `\nAll ${takes.length} takes recorded.`);
process.exitCode = failed.length ? 1 : 0;
