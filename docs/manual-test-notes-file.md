# Manual test: the notes file

## Why this exists

Three things in SlateBuilder for Offices cannot be tested automatically, because
the browser will only open a file picker in response to a real human click and
deliberately refuses to let a script stand in for one:

1. **Writing to a linked file in place** — the behaviour that stops an office
   ending up with six notes files whose only difference is a timestamp.
2. **Re-reading before saving** — the protection that stops one person's save
   erasing a colleague's work on a shared file.
3. **Remembering the linked file across a browser restart** — whether the link
   survives closing Chrome, and what the office sees when it asks for
   permission again.

These are the newest code in the app, and since asynchronous working between
surgeon and MOA is a requirement rather than a convenience, they are
load-bearing. Everything around them is covered by automated tests; this is the
part a person has to click through. It takes about fifteen minutes, once.

## Before you start

- **Use fabricated data only.** `docs/test-waitlist.csv` in this repository is
  twelve invented patients with obviously fake PHNs. Do not run this script
  against a real waitlist: it involves deliberately creating stale files and
  conflicting saves.
- **Use Chrome or Edge.** File linking does not exist in Safari or Firefox;
  Test 7 covers what those browsers do instead.
- **The page must be on `https://` or `http://localhost`.** Browsers withhold
  the file-linking API over plain `http://`, so an office served the app from
  an internal `http://` address gets the download fallback no matter which
  browser it uses. If you are testing the real deployment, check the address
  bar says `https`.
- **Make a folder for this**, e.g. `Desktop/slatebuilder-test`. Keeping every
  file from this script in one place makes the "is there exactly one file?"
  checks trivial.
- **Start unlinked.** The app remembers a linked notes file across restarts, on
  purpose, so a computer that has used SlateBuilder before will already be
  linked to something. While it is, the app hides the option to create a new
  file — there is nothing to choose, since it already has one. Step 1.0
  clears that.
- Passphrase to use throughout: `slatebuilder-test-2026` (must be at least 12
  characters). The rule it should obey: **once per file, per browser session** — asked when the
  file is created, and again whenever it is opened afresh (after a restart, in a second tab, on
  another machine). It should **never** be asked in order to save a file that is already open.
  Being asked to save is itself a finding.

Record the result of each numbered check. If one fails, note the exact wording
of the message on screen and which step you were on — the wording identifies
the code path.

---

## Test 1 — Create a linked file and write to it in place

| # | Do this | Expect |
|---|---------|--------|
| 1.0 | Look at **2 · Restore your notes** before doing anything else. If it shows a blue **Linked to … .sbnotes** chip, click **Unlink**. | The card now reads **Recommended: link one notes file on this computer**, with **Create a new notes file** and **use one you already have**. If instead it shows an amber *"This browser cannot save straight to a folder"*, stop — see *Before you start*: you are not on Chrome/Edge, or not on `https://` or `http://localhost`. |
| 1.1 | Open the app. On **Setup**, upload `docs/test-waitlist.csv`. | `✓ 12 patients loaded`, and below it exactly: **Read as: 12 patients · 9 past target · longest by 58 weeks · median 10 weeks past target.** No red or amber panel above the tabs. |
| 1.2 | In **2 · Restore your notes**, click **Create a new notes file**. | A native save dialog opens. |
| 1.3 | Save it into your test folder as `office-notes.sbnotes`. | Message: *"Notes will be saved to office-notes.sbnotes from now on, replacing it each time rather than adding another copy."* A blue chip reads **Linked to office-notes.sbnotes**. |
| 1.4 | Go to **Priority waitlist**. Set an unavailable-until date on **Testcase Charlie**, and change **Testcase Golf**'s case length to 75 minutes. | Both changes show on the cards. |
| 1.5 | Back on **Setup**, find **Before you finish: save your notes**. Enter initials (e.g. `MOA`), the passphrase twice, and click **Save notes file**. | *"Saved revision 1 to office-notes.sbnotes — notes for 2 patients."* The two passphrase boxes disappear and the heading becomes **Your notes are saving themselves**. |
| 1.6 | **Look in the folder.** | Exactly one file: `office-notes.sbnotes`. **Nothing in Downloads.** |
| 1.7 | Change **Testcase Lima**'s case length **from the Priority waitlist**, not from a slate. Do not go back to Setup. Watch the top bar. | It reads **Unsaved notes** for a second or two, then **Notes saved** with the time. No passphrase is asked for. |
| 1.8 | **Look in the folder again.** | Still exactly one file. This is the point of the test: the new revision replaced the old rather than sitting beside it. |
| 1.8a | Type a case length digit by digit — `8`, then `85`, then `90` — pausing under a second between keys. | One save at the end, not one per keystroke: the bar stays on **Unsaved notes** through the typing and flips to **Notes saved** once you stop. |
| 1.9 | Make a copy of the file now and call it `stale-copy.sbnotes`, in the same folder. Test 5 needs it. | Two files, one of which is your deliberate decoy. |
| 1.10 | Go to **Suggested slates** and change a case length there. | The top bar behaves the same way from this tab. Saving is no longer something only Setup can do. |

**Fails if** step 1.6 or 1.8 shows more than one `.sbnotes` file, or anything
lands in Downloads. That means the link is not being used and every save is
creating a new copy — the exact problem the feature exists to prevent.

---

## Test 2 — The link survives a browser restart

| # | Do this | Expect |
|---|---------|--------|
| 2.1 | **Quit Chrome completely** — not just the tab. Reopen it and go back to the app. | The **Linked to office-notes.sbnotes** chip is there without you choosing anything. |
| 2.2 | Upload `docs/test-waitlist.csv` again. | `✓ 12 patients loaded`. |
| 2.3 | Enter the passphrase in **2 · Restore your notes** and click **Load notes**. | Chrome may ask permission to view the file — allow it. Then a green message naming the revision and how many patients' notes came back. This is the one time this session the passphrase is needed. |
| 2.3a | Make any change and wait. | It saves itself, with no further passphrase. Opening the file is what unlocked it for the session. |
| 2.4 | Check **Priority waitlist**. | Charlie's unavailable date, Golf at 75 minutes, and Lima's change are all back. |

**Fails if** the chip is missing at 2.1 (the link was not remembered), or 2.3
says *"Could not read the notes file on this computer"* (permission was refused
or the link is stale). Note which, and whether you saw a permission prompt.

---

## Test 3 — Two people, one file

The most important test here. It checks that when someone saves to the shared
file while you have it open, your save merges their work in instead of wiping
it out. Two tabs of the same browser reproduce this faithfully: each tab keeps
its own idea of what revision the file is at, which is exactly what differs
between two people's computers.

| # | Do this | Expect |
|---|---------|--------|
| 3.1 | Leave your current tab open. Call it **Tab A**. Open the app in a **second tab** — **Tab B**. | Tab B already shows **Linked to office-notes.sbnotes**. |
| 3.2 | In **Tab B**: upload the test waitlist, enter the passphrase, **Load notes**. | The three notes from Test 1 appear. |
| 3.3 | In **Tab B**: set an unavailable date on **Testcase Echo**. Wait for the top bar to read **Notes saved**. | It saves itself — no passphrase, no button. |
| 3.4 | Switch to **Tab A** and **do not reload it**. It still believes the file is at the revision it last wrote. Set an unavailable date on **Testcase Kilo**. | The change shows on Kilo's card. |
| 3.5 | Wait for Tab A to save itself, then look at the **Setup** tab. | A message appears even though nobody asked for the save: *"**Someone had saved to this file since you opened it, so 1 of their changes was merged in rather than overwritten.**"* A merge is the one thing an automatic save still speaks up about. |
| 3.6 | Reload Tab A, upload the waitlist, load the notes. | **Both** Echo (saved from Tab B) and Kilo (saved from Tab A) have their dates, along with Charlie, Golf and Lima. |

**Fails if** the sentence about merging never appears at 3.5, or if Echo's date
is missing at 3.6. Either means one person's save destroyed another's, which is
the worst outcome this feature can produce. Stop and report it.

---

## Test 4 — Everyday saving after a conflict

| # | Do this | Expect |
|---|---------|--------|
| 4.1 | Close Tab B. In Tab A, change any case length and let it save itself. | The top bar returns to **Notes saved** with **no** merge message — nothing else had touched the file. |
| 4.2 | Look in the folder. | Still `office-notes.sbnotes` and `stale-copy.sbnotes`, nothing more. |

---

## Test 5 — Loading an old copy by mistake

`stale-copy.sbnotes` is the revision-2 file you set aside. This is the
version-drift case: someone opens last week's copy from a different folder.

| # | Do this | Expect |
|---|---------|--------|
| 5.1 | In **2 · Restore your notes**, use the **Notes file** picker to select `stale-copy.sbnotes`. Enter the passphrase. Click **Load notes**. | A confirmation dialog: *"This file is revision 2, but revision 5 has already been used on this computer. It may be an older copy…"* |
| 5.2 | Click **Cancel**. | Nothing loads; the screen is unchanged. |
| 5.3 | Repeat and click **OK** this time. | It loads, and the notes you have are kept — merging keeps whichever entry is newer per patient, so nothing from revision 5 is lost. |

**Fails if** no warning appears at 5.1, or if 5.3 silently discards the newer
notes.

---

## Test 6 — Passphrase and wrong-file handling

| # | Do this | Expect |
|---|---------|--------|
| 6.1 | Try to load `office-notes.sbnotes` with the passphrase `wrong-passphrase-1`. | A clear red error. No crash, no blank screen. |
| 6.2 | Try to load `docs/test-waitlist.csv` as a notes file. | *"That file is not a SlateBuilder notes file."* |
| 6.3 | Unlink, then try to save with a passphrase of 5 characters. | It refuses and asks for at least 12. The rule applies where the passphrase is set — at creation. |
| 6.4 | Try to save with two passphrases that differ. | *"The two passphrases do not match."* |
| 6.5 | Link `office-notes.sbnotes` via **use one you already have**, but do **not** load it. Make a change and let it try to save. | It refuses rather than overwriting: *"…was last written with a different passphrase. Load it under that passphrase before saving…"*. Check the file's timestamp in the folder — it must be **unchanged**. |

---

## Test 7 — The browsers that cannot link

| # | Do this | Expect |
|---|---------|--------|
| 7.1 | Open the app in **Safari or Firefox** and upload the test waitlist. | In **2 · Restore your notes**, an amber note: *"This browser cannot save straight to a folder…"*. No **Create a new notes file** button. |
| 7.2 | Add a note and save. | The file appears in **Downloads**, named `slatebuilder-notes-r001-<date>…`. The message ends with advice to keep the file and passphrase safe. |
| 7.3 | Load that downloaded file back in. | The notes return. |

This confirms the fallback works, so an office on the wrong browser degrades to
downloads rather than losing the feature.

---

## Test 8 — Unlinking

| # | Do this | Expect |
|---|---------|--------|
| 8.1 | Back in Chrome, click **Unlink** on the blue chip. | *"No longer linked to a file. Saving will download a copy instead."* |
| 8.2 | Save. | A file appears in **Downloads**, and `office-notes.sbnotes` in your test folder is **unchanged**. |
| 8.3 | Reload the page. | Still unlinked — the link is genuinely forgotten, not just hidden. |
| 8.4 | After unlinking, make a change and wait five seconds. | **Nothing saves on its own.** The top bar shows **Unsaved notes** with a button, and the passphrase boxes are back on Setup. Autosave belongs to a linked file; without one it would drop a fresh file into Downloads every few seconds. |

---

## Afterwards

Delete the test folder and the downloaded test files. Nothing in this script
uses real patient data, but leaving `.sbnotes` files around sets a bad
precedent for a tool whose main privacy claim is that nothing persists unless
you deliberately save it.

If every check passed, the three previously unexercised paths — in-place
writing, conflict merging, and link persistence — are confirmed working on real
hardware, which is the gap automated testing cannot close.
