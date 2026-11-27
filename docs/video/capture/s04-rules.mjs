// Section 4 · OR dates (S04a–S04b): the dates first, then the default case
// lengths folded beneath them, ending on "View suggested slates".

import { runTake, loadWaitlist } from "./lib.mjs";

await runTake("s04-rules", async (take) => {
  const { page } = take;
  await loadWaitlist(page);
  await take.record();

  await take.beat("S04a", async () => {
    await take.scrollTo(page.getByText("OR dates", { exact: true }), { block: "start" });
    await take.select(page.getByLabel("Number of slates"), "3", { label: "Number of slates: 3" });
    const dates = page.locator('input[type="date"]');
    for (const i of [0, 1, 2]) {
      await take.pointAt(dates.nth(i), { ms: 500 });
      await take.sleep(300);
    }
  });

  await take.beat("S04b", async () => {
    await take.click(page.getByRole("button", { name: /Default case lengths/ }), {
      label: "Default case lengths",
    });
    await take.sleep(300);
    for (const label of ["Hysteroscopy", "Laparoscopy", "Hysterectomy", "Other – minor", "Other – intermediate", "Other – major"]) {
      await take.pointAt(page.getByLabel(label, { exact: true }), { ms: 420 });
      await take.sleep(300);
    }
    await take.pointAt(page.getByRole("button", { name: "View suggested slates →" }));
  });
});
