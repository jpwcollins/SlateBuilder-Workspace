// Section 6 · Booking order and accountability (S06a–S06d).
//
// Every slate starts full, so before filming one case on Slate 2 is
// shortened to leave room for a patient to be dragged in by hand.

import { runTake, loadWaitlist, slate, card } from "./lib.mjs";

// The red panel at the top of the slates tab listing anyone moved without a reason.
const redPanel = (page) =>
  page.locator("div").filter({ has: page.getByText(/^\d+ patients? (was|were) moved by hand with no reason recorded$/) }).last();
const reasonDialog = (page) => page.getByRole("dialog", { name: "Why was this patient moved?" });

await runTake("s06-booking-order", async (take) => {
  const { page } = take;
  await loadWaitlist(page);
  await page.getByLabel("Number of slates").selectOption("3");
  await page.getByRole("button", { name: /^Suggested slates/ }).click();
  // Off camera: Amara Okafor's case is quicker than the default, leaving 60
  // minutes free on Slate 2.
  const amara = card(page, "Amara Okafor").getByLabel("Duration (min)");
  await amara.fill("120");
  await amara.press("Tab");
  // Off camera: fold away Slates 1 and 3 so Slate 2 sits just above the
  // Priority Waitlist panel, and open the panel, searched to one patient.
  for (const n of [1, 3]) {
    await slate(page, n).getByRole("button").first().click();
  }
  const panelToggle = page.getByRole("button", { name: /Priority Waitlist/ });
  if ((await panelToggle.innerText()).includes("Show")) await panelToggle.click();
  await page.getByPlaceholder("Search name, code or procedure…").fill("Anika");
  await page.evaluate(() => window.scrollTo(0, 0));
  await take.record();

  await take.beat("S06a", async () => {
    await take.scrollTo(page.getByText("Booking order", { exact: true }), { block: "start" });
    for (const mark of ["FIFO", "Optimization", "Clinical", "No reason"]) {
      await take.pointAt(page.getByText(mark, { exact: true }).first(), { ms: 450 });
      await take.sleep(300);
    }
  });

  await take.beat("S06b", async () => {
    const row = page.locator('[draggable="true"]').filter({ hasText: "Anika Sharma" }).first();
    const target = slate(page, 2).locator('[draggable="true"]').filter({ hasText: "Duration (min)" }).last();
    await take.scrollTo(row, { block: "center" });
    await take.drag(row, target, { label: "drag Anika Sharma onto Slate 2", ms: 1400 });
    await reasonDialog(page).waitFor();
    await take.select(reasonDialog(page).getByLabel("Reason"), "clinical_urgency", { label: "Reason: Clinical urgency" });
    await take.click(reasonDialog(page).getByRole("button", { name: "Done" }), { label: "Done" });
    await take.pointAt(card(page, "Anika Sharma").getByText("Clinical", { exact: true }));
  });

  await take.beat("S06c", async () => {
    await take.click(card(page, "Leila Haddad").getByRole("button", { name: "Remove from suggested slates" }), {
      label: "hold back Leila Haddad",
    });
    await reasonDialog(page).waitFor();
    await take.sleep(900);
    await take.click(reasonDialog(page).getByRole("button", { name: "Skip for now" }), { label: "Skip for now" });
    await take.scrollTo(redPanel(page), { block: "start" });
    await take.pointAt(redPanel(page).getByText(/moved by hand with no reason recorded/));
    await take.sleep(900);
    await take.pointAt(slate(page, 2).getByText(/held back, no reason recorded/).first());
  });

  await take.beat("S06d", async () => {
    await take.select(redPanel(page).getByLabel("Reason"), "patient_deferred", {
      label: "Reason: patient deferred",
    });
  }, { tail: 1.5 });
});
