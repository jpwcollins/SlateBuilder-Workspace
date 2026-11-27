// Section 3 · Load the waitlist (S03a–S03c). The macOS Open dialog in S03a is
// a separate short clip recorded on a real screen; here the chooser is
// answered directly.

import { runTake, BASE_URL } from "./lib.mjs";

await runTake("s03-load", async (take) => {
  const { page } = take;
  await page.goto(BASE_URL);
  await page.getByText("Load this week's waitlist").waitFor();
  await take.record();

  // "...choose the file the hospital sent" comes about 2.6 s into the line.
  await take.beat("S03a", async () => {
    await take.pointAt(page.locator('input[type="file"]').first());
    await take.sleep(1600);
    await take.chooseFile(page.locator('input[type="file"]').first(), "week-1-waitlist.csv", {
      label: "Choose File",
    });
  });

  await take.beat("S03b", async () => {
    await take.pointAt(page.getByText(/^Cases$/).first());
    await take.sleep(800);
    await take.pointAt(page.getByText(/^Overdue$/).first());
    await take.scrollTo(page.getByText("Office Snapshot").first(), { block: "start" });
  });

  await take.beat("S03c", async () => {
    await take.pointAt(page.getByLabel("Waitlist overview by benchmark bucket"));
  });
});
