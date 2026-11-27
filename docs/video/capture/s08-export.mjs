// Section 8 · Export (S08a), plus the still for S08b: the exported PDF is
// saved next to the footage and its first page rendered as a PNG.

import path from "node:path";
import { execFileSync } from "node:child_process";
import { runTake, loadWaitlist, VIDEO_DIR } from "./lib.mjs";

const outDir = path.join(VIDEO_DIR, "out", "s08-export");

await runTake("s08-export", async (take) => {
  const { page } = take;
  await loadWaitlist(page);
  await page.getByLabel("Number of slates").selectOption("3");
  await page.getByRole("button", { name: /^Suggested slates/ }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await take.record();

  await take.beat("S08a", async () => {
    const download = page.waitForEvent("download");
    await take.click(page.getByRole("button", { name: "Export all slates (PDF)" }), { label: "Export all slates (PDF)" });
    const file = path.join(outDir, "slates.pdf");
    await (await download).saveAs(file);
    // First page as a still for S08b. sips renders page one of a PDF.
    execFileSync("sips", ["-s", "format", "png", "-Z", "2200", file, "--out", path.join(outDir, "slates-page-1.png")], {
      stdio: "ignore",
    });
    console.log("  PDF and page-1 still saved");
  }, { tail: 1.2 });
});
