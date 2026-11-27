// Section 10 · Close (S10a). S10b is the end card, made in Matte.

import { runTake, loadWaitlist } from "./lib.mjs";

await runTake("s10-close", async (take) => {
  const { page } = take;
  await loadWaitlist(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await take.record();

  await take.beat("S10a", async () => {
    await take.click(page.getByRole("button", { name: "Clear screen" }), { label: "Clear screen" });
    await take.sleep(600);
    await take.pointAt(page.getByText("Load this week's waitlist"));
  }, { tail: 1.5 });
});
