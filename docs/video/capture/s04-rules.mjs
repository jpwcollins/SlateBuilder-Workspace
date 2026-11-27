// Section 4 · Check the scheduling rules (S04a–S04b).

import { runTake, loadWaitlist } from "./lib.mjs";

await runTake("s04-rules", async (take) => {
  const { page } = take;
  await loadWaitlist(page);
  await take.record();

  await take.beat("S04a", async () => {
    await take.scrollTo(page.getByText("Check the scheduling rules"), { block: "start" });
    for (const label of ["Hysteroscopy", "Laparoscopy", "Hysterectomy", "Other"]) {
      await take.pointAt(page.getByLabel(label, { exact: true }), { ms: 450 });
      await take.sleep(350);
    }
  });

  await take.beat("S04b", async () => {
    await take.select(page.getByLabel("Number of slates"), "3", { label: "Number of slates: 3" });
    const dates = page.locator('input[type="date"]');
    await take.pointAt(dates.nth(2));
  });
});
