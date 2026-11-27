// Section 3 · Load the waitlist (S03a–S03c). The macOS Open dialog in S03a is
// a still cut in after the click; here the chooser is answered directly.
// The summary appears right under the upload, so nothing scrolls away.

import { runTake, BASE_URL } from "./lib.mjs";

await runTake("s03-load", async (take) => {
  const { page } = take;
  await page.goto(BASE_URL);
  await page.getByText("Load this week's waitlist", { exact: true }).waitFor();
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
    await take.pointAt(page.getByText("Total active patients loaded"));
    await take.sleep(1200);
    await take.pointAt(page.getByText("Patients past target date"));
  });

  await take.beat("S03c", async () => {
    await take.click(page.getByRole("button", { name: /Show breakdown/ }), { label: "Show breakdown" });
    await take.sleep(400);
    await take.scrollTo(page.getByLabel("Waitlist overview by benchmark bucket"));
    await take.pointAt(page.getByLabel("Waitlist overview by benchmark bucket"));
  });
});
