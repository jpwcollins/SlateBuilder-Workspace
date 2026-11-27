// Section 2 · What SlateBuilder is (S02b). S02a is a title card made in Matte.

import { runTake, BASE_URL } from "./lib.mjs";

await runTake("s02-intro", async (take) => {
  const { page } = take;
  await page.goto(BASE_URL);
  await page.getByText("Load this week's waitlist").waitFor();
  await take.record();

  await take.beat("S02b", async () => {
    await take.sleep(1500);
    await take.pointAt(page.getByText("Load this week's waitlist"));
  });
});
