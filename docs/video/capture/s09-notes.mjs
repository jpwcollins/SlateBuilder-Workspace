// Section 9 · Save and restore your notes (S09a, S09c, S09e). S09b is the
// macOS Save dialog, recorded separately on a real screen; S09d is a card.
//
// The File System Access pickers open native macOS dialogs that a headless
// browser cannot show, so they are replaced in the page with stand-ins that
// keep the file in memory. Everything else -- encryption, linking, autosave,
// loading -- is the app's own code running unchanged. The saved notes file is
// written next to the footage so it can be inspected.

import fs from "node:fs";
import path from "node:path";
import { runTake, loadWaitlist, card, slate, addDays, VIDEO_DIR } from "./lib.mjs";

const PASSPHRASE = "harbour-velvet-spoon-orbit";

const PICKER_STANDINS = () => {
  // Files live in sessionStorage so they survive Clear screen, which reloads
  // the page; a real file on disk would.
  const KEY = "__standin_files";
  const load = () => JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
  const store = (name, text) => sessionStorage.setItem(KEY, JSON.stringify({ ...load(), [name]: text, __last: name }));
  // A class, so the handle can be stored in IndexedDB as the app does
  // (structured clone keeps the data and drops the methods).
  class StandInHandle {
    constructor(name) {
      this.kind = "file";
      this.name = name;
    }
    async getFile() {
      return new File([load()[this.name] ?? ""], this.name, { type: "application/json" });
    }
    async createWritable() {
      let buffer = "";
      const name = this.name;
      return {
        write: async (data) => { buffer = typeof data === "string" ? data : await new Blob([data]).text(); },
        close: async () => { store(name, buffer); },
      };
    }
    async queryPermission() { return "granted"; }
    async requestPermission() { return "granted"; }
  }
  window.showSaveFilePicker = async (options) => new StandInHandle(options?.suggestedName ?? "notes.sbnotes");
  window.showOpenFilePicker = async () => {
    const last = load().__last;
    return last ? [new StandInHandle(last)] : [];
  };
  window.__standinFiles = load;
};

await runTake("s09-notes", async (take) => {
  const { page } = take;
  await page.addInitScript(PICKER_STANDINS);
  await loadWaitlist(page);
  await page.getByLabel("Number of slates").selectOption("3");
  // Off camera: this week's notes, made the way an office would.
  await page.getByRole("button", { name: /^Suggested slates/ }).click();
  const priya = card(page, "Priya Natarajan").getByLabel("Duration (min)");
  await priya.fill("210");
  await priya.press("Tab");
  await card(page, "Amara Okafor").getByLabel("OSA").check();
  const date = (await slate(page, 1).innerText()).match(/on (\d{4}-\d{2}-\d{2})/)[1];
  const grace = card(page, "Grace Whitfield").getByLabel("Patient unavailable until");
  await grace.fill(addDays(date, 3));
  // She leaves the slate as soon as the date lands, taking the field with her.
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: /^Setup/ }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await take.record();

  await take.beat("S09a", async () => {
    await take.scrollTo(page.getByText("Restore your notes"), { block: "start" });
    await take.click(page.getByRole("button", { name: "Create a new notes file" }), {
      label: "Create a new notes file",
    });
  });

  // The macOS Save dialog is cut in here in the edit (recorded separately).
  await take.beat("S09b", async () => {
    await page.getByText(/^Linked to /).first().waitFor();
    await take.pointAt(page.getByText(/^Linked to /).first());
  });

  await take.beat("S09c", async () => {
    await take.scrollTo(page.getByText("Before you finish: save your notes"), { block: "start" });
    await take.type(page.getByLabel("Who is saving (initials or role)"), "MOA", { label: "Who is saving" });
    const pass = page.getByLabel(/^Passphrase \(at least/);
    await take.type(pass, "Summer2026!!", { label: "weak passphrase" });
    await take.sleep(1600);
    await take.type(pass, PASSPHRASE, { label: "strong passphrase", delay: 55 });
    await take.sleep(900);
    await take.type(page.getByLabel("Confirm passphrase"), PASSPHRASE, { label: "confirm passphrase", delay: 40 });
    await take.click(page.getByRole("button", { name: "Save notes file" }), { label: "Save notes file" });
    await page.getByText(/Notes saved/).first().waitFor();
    await take.pointAt(page.getByText(/Notes saved/).first());
  }, { tail: 1.2 });

  // S09d, the "One week later" card, sits between these in the edit.
  await take.beat("S09e", async () => {
    await take.click(page.getByRole("button", { name: "Clear screen" }), { label: "Clear screen" });
    await take.sleep(800);
    await take.chooseFile(page.locator('input[type="file"]').first(), "week-2-waitlist.csv", {
      label: "load week 2",
    });
    await take.scrollTo(page.getByText("Restore your notes"), { block: "start" });
    // A week later the office points the app at its notes file again.
    const useExisting = page.getByRole("button", { name: "use one you already have" });
    if (await useExisting.isVisible()) {
      await take.click(useExisting, { label: "use one you already have" });
      await take.sleep(500);
    }
    await take.type(page.getByLabel("Passphrase for this file"), PASSPHRASE, { label: "passphrase", delay: 40 });
    await take.click(page.getByRole("button", { name: "Load notes" }), { label: "Load notes" });
    const status = page.getByText(/now carry notes/).first();
    await status.waitFor();
    await take.pointAt(status);
  }, { tail: 2 });

  const files = await page.evaluate(() => window.__standinFiles());
  for (const [name, text] of Object.entries(files)) {
    if (name === "__last") continue;
    fs.writeFileSync(path.join(VIDEO_DIR, "out", "s09-notes", name), text);
    console.log(`  notes file written: ${name}`);
  }
});
