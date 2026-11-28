// Section 1 · Cold open: the hospital's list as a plain spreadsheet (S01a–S01b).
// A generic grid rendered from the week-1 file, not any particular spreadsheet
// app. The file has the hospital's export columns: SURGEON, PAT_NAME1, PHN,
// SURG_DESC, BOOK_FORM_RECEIVED_DTM, REQUEST_QUEUE, DIAGNOSIS, TIME_WAITING,
// TARGET_TIME, TARGET_PERCENT.

import fs from "node:fs";
import path from "node:path";
import { runTake, DATA_DIR, BASE_URL } from "./lib.mjs";

const rows = fs
  .readFileSync(path.join(DATA_DIR, "week-1-waitlist.csv"), "utf8")
  .trim()
  .split("\n")
  .map((line) => (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).slice(0, -1).map((cell) => cell.replace(/,$/, "").replace(/^"|"$/g, "").trim()));
const letters = "ABCDEFGHIJ";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const WAIT = 7; // TIME_WAITING
const TARGET = 8; // TARGET_TIME, e.g. "12.00 wks"
const overdue = (r) => Number(r[WAIT]) > parseFloat(r[TARGET]);

const html = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; font: 15px/1.2 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1f2933; }
  .bar { height: 44px; background: #f3f4f6; border-bottom: 1px solid #d1d5db; display: flex; align-items: center; padding: 0 16px; font-size: 14px; color: #4b5563; }
  table { border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; height: 22px; }
  th { background: #f9fafb; color: #6b7280; font-weight: 500; text-align: center; position: sticky; top: 0; }
  td.n { background: #f9fafb; color: #6b7280; text-align: center; width: 44px; }
  tr.head td { font-weight: 600; background: #f8fafc; }
  td.num { text-align: right; }
  tr.flag td.wait { background: #fde2e2; }
</style></head><body>
<div class="bar">week-1-waitlist.csv</div>
<table>
  <colgroup><col style="width:46px"><col style="width:150px"><col style="width:170px"><col style="width:110px"><col style="width:330px"><col style="width:120px"><col style="width:250px"><col style="width:100px"><col style="width:120px"><col style="width:120px"><col style="width:130px"></colgroup>
  <tr><th></th>${[...letters].map((l) => `<th>${l}</th>`).join("")}</tr>
  ${rows
    .map(
      (r, i) =>
        `<tr class="${i === 0 ? "head" : overdue(r) ? "flag" : ""}" data-name="${esc(r[1])}"><td class="n">${i + 1}</td>${r
          .map((c, j) => `<td class="${j >= WAIT && i > 0 ? "num" : ""}${j === WAIT ? " wait" : ""}">${esc(c)}</td>`)
          .join("")}</tr>`,
    )
    .join("\n")}
</table></body></html>`;

await runTake("s01-cold-open", async (take) => {
  const { page } = take;
  // Served at a URL (not setContent) so the harness's page script loads.
  await page.route("**/__waitlist-sheet", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto(`${BASE_URL}/__waitlist-sheet`);
  await take.hideCursor();
  await take.record();

  await take.beat("S01a", async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const start = performance.now();
          const step = (now) => {
            const t = Math.min(1, (now - start) / 9000);
            window.scrollTo(0, t * 420);
            if (t < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        }),
    );
  });

  await take.beat("S01b", async () => {
    await take.scrollTo('tr[data-name="Liu, Hannah"]');
  });
});
