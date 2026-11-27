// Section 5 · Suggested slates (storyboard shots S05a–S05g).
//   node docs/video/capture/s05-slates.mjs

import { openTake, loadWaitlist, slate, card } from "./lib.mjs";

const take = await openTake("s05-slates");
const { page } = take;

try {
  // Set-up, not filmed: this week's list, three OR dates, Setup tab at the top.
  await loadWaitlist(page);
  await page.getByLabel("Number of slates").selectOption("3");
  await page.evaluate(() => window.scrollTo(0, 0));

  await take.record();

  await take.beat("S05a", async () => {
    await take.click(page.getByRole("button", { name: /^Suggested slates/ }), {
      label: "Suggested slates tab",
    });
    await take.scrollTo(slate(page, 1), { block: "start" });
    await take.pointAt(card(page, "Priya Natarajan").getByText("FIFO", { exact: true }));
  });

  await take.beat("S05b", async () => {
    await take.pointAt(slate(page, 1).getByText(/min free|^Full$/).first());
  });

  await take.beat("S05c", async () => {
    const duration = card(page, "Priya Natarajan").getByLabel("Duration (min)");
    await take.type(duration, "210", { label: "Priya Natarajan duration" });
    await take.pointAt(slate(page, 1).getByText(/min free|^Full$/).first());
  });

  await take.beat("S05d", async () => {
    // Unavailable until three days after Slate 1, so she moves to a later slate.
    const header = await slate(page, 1).innerText();
    const date = header.match(/(\d{4}-\d{2}-\d{2})/)[1];
    const until = new Date(`${date}T12:00:00`);
    until.setDate(until.getDate() + 3);
    const value = until.toISOString().slice(0, 10);
    await take.click(card(page, "Grace Whitfield").locator("summary"), { label: "Grace Whitfield controls" });
    const field = card(page, "Grace Whitfield").getByLabel("Patient unavailable until");
    await take.setValue(field, value, { label: "Grace Whitfield unavailable" });
    // The later slates are full, so she returns to the waitlist and the next
    // patient in line takes the time on Slate 1.
    await take.sleep(700);
    const last = slate(page, 1).locator('[draggable="true"]').filter({ hasText: "Duration (min)" }).last();
    await take.scrollTo(last);
    await take.pointAt(last.getByText(/^Patient (?!unavailable)/));
  });

  await take.beat("S05e", async () => {
    await take.scrollTo(slate(page, 1), { block: "start" });
    const cards = slate(page, 1).locator('[draggable="true"]').filter({ hasText: "Duration (min)" });
    const n = await cards.count();
    await take.drag(cards.nth(n - 1).getByText(/^Patient (?!unavailable)/), cards.nth(n - 2), {
      label: "reorder Slate 1",
      offsetY: -40,
    });
  });

  await take.beat("S05f", async () => {
    await take.click(slate(page, 1).getByRole("button", { name: /Lock slate/ }), { label: "Lock Slate 1" });
  });

  await take.beat("S05g", async () => {
    await take.click(page.getByRole("button", { name: "Optimize Utilization" }), {
      label: "Optimize Utilization",
    });
    // Slates 2 and 3 are already full, so nothing moves; the alert saying so
    // becomes a caption in the edit.
    await take.sleep(600);
    await take.pointAt(slate(page, 2).getByText(/min free|^Full$/).first());
    await take.sleep(1200);
    await take.pointAt(slate(page, 3).getByText(/min free|^Full$/).first());
  }, { tail: 2 });

  await take.finish();
} catch (error) {
  await page.screenshot({ path: "docs/video/out/s05-slates/failure.png" }).catch(() => {});
  console.error(error);
  await take.finish().catch(() => {});
  process.exit(1);
}
