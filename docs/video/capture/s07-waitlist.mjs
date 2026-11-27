// Section 7 · Priority Waitlist and Long-waiters (S07a–S07d).
//
// Removing a patient opens a mailto: link. Headless Chrome has no mail app to
// hand it to and simply stays on the page; the email itself appears in the
// video as a still taken from a real mail app.

import { runTake, loadWaitlist } from "./lib.mjs";

await runTake("s07-waitlist", async (take) => {
  const { page } = take;
  await loadWaitlist(page);
  await page.getByLabel("Number of slates").selectOption("3");
  await page.evaluate(() => window.scrollTo(0, 0));
  await take.record();

  await take.beat("S07a", async () => {
    await take.click(page.getByRole("button", { name: /^Priority waitlist/ }), { label: "Priority waitlist tab" });
    await take.sleep(600);
    // The list opens filtered to patients not yet slated; show everyone.
    await take.click(page.getByLabel("Not yet slated"), { label: "show slated patients too" });
    await take.sleep(500);
    await take.pointAt(page.locator("main").getByText(/^Slated/).nth(1));
  });

  await take.beat("S07b", async () => {
    await take.click(page.getByText("Wait time only", { exact: true }), { label: "Wait time only" });
    await take.sleep(1500);
    await take.click(page.getByText(/^Urgency first, then wait time/), { label: "Urgency first" });
  });

  await take.beat("S07c", async () => {
    const row = page.getByRole("button").filter({ hasText: "Rachel Goldberg" }).first();
    await take.click(row, { label: "open Rachel Goldberg" });
    await take.click(page.getByRole("button", { name: "Remove from waitlist" }), { label: "Remove from waitlist" });
    await take.sleep(1200);
    await take.pointAt(page.getByRole("button", { name: "Restore to waitlist" }));
    await take.sleep(1200);
    await take.click(page.getByRole("button", { name: "Restore to waitlist" }), { label: "Restore to waitlist" });
  });

  await take.beat("S07d", async () => {
    await take.click(page.getByRole("button", { name: /^Long-waiters/ }), { label: "Long-waiters tab" });
    await take.sleep(800);
    await take.scrollTo(page.getByText("Hannah Liu").first());
  }, { tail: 1.2 });

});
