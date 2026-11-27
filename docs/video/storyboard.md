# SlateBuilder for Offices — demo & training video

**Storyboard and voiceover script** · draft 1 · 2026-11-26

- **Length:** about 4:30 (~640 words of voiceover at ~145 words per minute)
- **Audience:** MOAs and surgeons in an office receiving the hospital's weekly waitlist
- **Surgeon on screen:** "Dr Jane" (the SURGEON column of the dummy data). No practice name.
- **Data:** `docs/video/data/week-1-waitlist.csv` (40 patients, 8 over target) and
  `week-2-waitlist.csv` (the same list a week later: everyone one week older, Claire Dubois
  removed after her surgery, one new urgent referral, Ava Robinson)
- **Voice:** ElevenLabs, your cloned voice. One audio file per shot, named by shot ID
  (`S03a.mp3`), so each take can be timed to its line.
- **Edit:** Matte. 16:9, 1920×1080 export. Frameless screen layout on a soft background, with
  a MacBook Pro frame for the opening and closing shots only.

## How each shot is captured

| Code | Method |
|---|---|
| **PW** | Playwright script drives Chromium against the local build, 1920×1080 at 2× pixel density. A drawn pointer glides to each target and ripples on click. The script logs each click's time and position for placing zooms in Matte. |
| **PW-stub** | As PW, but the file pickers are replaced in the page with in-memory stand-ins, so the app behaves exactly as in Chrome without a macOS dialog appearing. |
| **CU** | A few seconds recorded on your real screen with computer use: the macOS dialogs a page cannot show. |
| **Still** | A single image, held, with a slow push-in in Matte. |
| **Card** | Title or text card built in Matte. |

Timings are targets. The final cut follows the voiceover.

---

## 0 · Title card · 0:00–0:05

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S00 | **SlateBuilder.ca**, with a line beneath: "All patient and provider data in this video is simulated." | Card | — |

> No voiceover — music only.

## 1 · Cold open: the problem · 0:05–0:25

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S01a | The week-1 waitlist as a plain spreadsheet: 40 rows, columns PAT_NAME1 to TIME_WAITING. Slow scroll down. | PW (a spreadsheet-style page rendered from the CSV) | Slow push-in on the TARGET_TIME and TIME_WAITING columns |
| S01b | Hold on a few rows where TIME_WAITING is well past TARGET_TIME (Hannah Liu, 26w target, 38 weeks waiting). | PW | Tighter on those rows |

> **VO S01a:** Every week, the hospital sends your office its surgical waitlist. Forty patients, each with a target time, and some of them already past it.
>
> **VO S01b:** And every week, someone has to decide who goes on the next OR slate — and be able to explain why.

## 2 · What SlateBuilder is · 0:20–0:38

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S02a | Card: "SlateBuilder for Offices". | Card | — |
| S02b | The empty Setup tab in a MacBook frame. Pointer rests on "On this device only" in the top bar. | PW, framed in Matte | Device eases in, then camera settles on the top bar |

> **VO S02a:** SlateBuilder turns that list into suggested slates and a priority waitlist, in a few minutes.
>
> **VO S02b:** It runs entirely in your web browser. There's no account and no server: the waitlist never leaves this computer. Use Google Chrome or Microsoft Edge.

## 3 · Load the waitlist · 0:38–1:02

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S03a | Pointer clicks "Choose File" in step 1. Cut to the macOS Open dialog (still: `s03a-open-dialog.png`) with `week-1-waitlist.csv` selected in "Office – confidential". | Still, then PW (file loads) | Zoom on step 1 |
| S03b | The summary appears right under the upload: "✓ 40 patients loaded", then Cases 40 · Overdue 8 · Urgent 11 · Workload 51.5h. | PW | Zoom on the four numbers |
| S03c | Click "Show breakdown ▸": the Waitlist overview histogram opens. | PW | Zoom on the histogram |

> **VO S03a:** Start on the Setup tab. In step one, choose the file the hospital sent — Excel or CSV.
>
> **VO S03b:** The snapshot tells you where you stand: forty patients, eight of them already past their target.
>
> **VO S03c:** And the overview shows where the pressure is building, class by class.

## 4 · OR dates · 1:02–1:20

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S04a | Step 3 "OR dates": "Number of slates" changes from 2 to 3 and the third date appears, with "View suggested slates →" beside them. | PW | Zoom on the dates |
| S04b | Open "Default case lengths… Edit ▸": the four defaults. Pointer ends on "View suggested slates →". | PW | Zoom on the case lengths |

> **VO S04a:** Step three sets your OR dates. Choose up to three, and check them against your actual OR days.
>
> **VO S04b:** Case lengths start from four defaults by procedure type, and you can adjust any single case later. Each case is followed by a thirty-minute turnaround, and a slate holds seven cases at most.

*(Step 2, restoring notes, is skipped here and covered in section 9.)*

## 5 · Suggested slates · 1:20–2:15

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S05a | Click the "Suggested slates" tab. Slate 1: four over-target cases, each marked FIFO. | PW | Zoom on the Slate 1 header and first two cards |
| S05b | The capacity bar and "Utilization" figure. | PW | Zoom on the bar |
| S05c | On Priya Natarajan's card, change Duration (min) from 180 to 210. The schedule times and capacity bar update. | PW | Zoom on the card, then the bar |
| S05d | On Grace Whitfield's card, set "Patient unavailable until" to a date after Slate 1. She leaves Slate 1 (the later slates are full, so she returns to the waitlist) and the next patient in line takes the freed time. | PW | Zoom on the date field, then on Beatriz's new card |
| S05e | Drag the last case on Slate 1 up one place. | PW | Zoom on the slate |
| S05f | Click "Lock slate" on Slate 1. | PW | Zoom on the button and the locked state |
| S05g | Click "Optimize Utilization". Both unlocked slates are already full, so nothing is reshuffled; the message (shown as a caption) says so and names the overdue patient still waiting. | PW | Pull back to show the slates, then zoom on the summary |

> **VO S05a:** The Suggested slates tab is where the work happens. Patients who are past their target go on first, most overdue first, so the longest waits are never bumped.
>
> **VO S05b:** The rest of the time is filled to complete as many cases as possible. The bar shows how full each day is, turnarounds included.
>
> **VO S05c:** If you know a case will run long, change its length here, and the day reschedules around it.
>
> **VO S05d:** If a patient can't come until a certain date, enter it. They come off any slate before then, and the time goes to the next patient in line.
>
> **VO S05e:** Drag to set the running order.
>
> **VO S05f:** When a slate is final, lock it. Nothing is added to it or taken off.
>
> **VO S05g:** Optimize Utilization fills any free time on the unlocked slates from the waitlist, highest priority first. Slates that are already full are left as they are, and it tells you who is still waiting.

## 6 · Booking order and accountability · 2:15–2:52

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S06a | The four booking-order marks on the cards: FIFO, Optimization, Clinical, No reason. | PW | Zoom across the legend |
| S06b | Drag Chloe Bergstrom (within target) from the Priority Waitlist panel onto Slate 2. The reason prompt appears; choose "Clinical urgency". Her card shows the Clinical mark. | PW | Zoom on the prompt, then her card |
| S06c | Click "Remove from suggested slates" on an over-target patient on Slate 2. Skip the reason prompt. A red panel appears at the top of the tab, "1 patient was moved by hand with no reason recorded", and Slate 2 shows "1 higher-ranked patient held back, no reason recorded". | PW | Zoom on the red panel, then the slate line |
| S06d | Choose "Patient deferred or declined the date" in the red panel. The panel clears. | PW | Zoom on the panel |

> **VO S06a:** Every case carries a mark: was it booked in priority order, and if not, why.
>
> **VO S06b:** Move someone ahead of the queue by hand and SlateBuilder asks for the reason. A clinical reason is recorded on the case and printed on the slate.
>
> **VO S06c:** Hold back a patient without a reason, and it stays visible until one is recorded.
>
> **VO S06d:** So every out-of-order booking has an explanation behind it.

## 7 · Priority Waitlist and Long-waiters · 2:52–3:22

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S07a | Click the "Priority waitlist" tab. The ranked list with Slated and Waiting status. | PW | Slow scroll |
| S07b | Toggle the priority rule to "Wait time only" and back. The order changes. | PW | Zoom on the toggle, then the top rows |
| S07c | Remove Rachel Goldberg with the trash icon. Cut to the pre-filled email to the booking office. Back in the app, her row is greyed and struck through; click "Restore to waitlist". | PW + Still (`s07c-removal-email.png`; blur the From line) | Zoom on the row; push-in on the email |
| S07d | Click the "Long-waiters" tab: over-target patients grouped by urgency class, most overdue first. | PW | Slow push-in on the list |

> **VO S07a:** The Priority waitlist ranks every patient, with who's already slated and who's still waiting.
>
> **VO S07b:** By default, urgency comes first, then time waited. You can rank by wait time alone.
>
> **VO S07c:** If a patient no longer needs surgery, remove them here. SlateBuilder drafts the email to the booking office for you. The row stays visible, so the removal is on the record — and it can be undone.
>
> **VO S07d:** Long-waiters lists everyone past their target, so nobody waiting too long goes unnoticed.

## 8 · Export · 3:22–3:42

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S08a | Back on Suggested slates, click "Export all slates (PDF)". | PW | Zoom on the button |
| S08b | One PDF page: Dr Jane and the date at the top, case codes instead of names, the booking-order marks with the key at the foot. | Still (rendered PDF page) | Slow pan down the page |

> **VO S08a:** When the slates are ready, export them.
>
> **VO S08b:** Each slate prints on one page, with case codes instead of names, the booking-order marks, and room for notes. A separate name key is there when you need it — keep it confidential.

## 9 · Save and restore your notes · 3:42–4:20

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S09a | Setup tab, step 2 "Notes file": click "Start a new notes file". | PW-stub | Zoom on step 2 |
| S09b | The macOS Save dialog (still: `s09b-save-dialog.png`), in a folder named "Office – confidential", with Chrome's line "Warning: this site can see edits you make" at the top. Back in the app, step 2 reads "New notes file: slatebuilder-notes-….sbnotes". | Still, then PW-stub | — |
| S09c | Type `Summer2026!!` as the passphrase: the strength bar goes red ("Too easy to guess"). Replace it with `harbour-velvet-spoon-orbit`: the bar goes green. Confirm, "MOA" in "Who is saving", then "Create notes file". The card reads "✓ Saving to slatebuilder-notes-….sbnotes". | PW-stub | Zoom on the passphrase field and strength bar, then the status |
| S09d | Card: "One week later". | Card | — |
| S09e | Click "Clear screen". Load `week-2-waitlist.csv`. Step 2 now only asks for the passphrase: enter it and click "Unlock and load notes". The message reports how many patients on this week's list now carry notes. | PW-stub | Zoom on the status message |

> **VO S09a:** Your notes are worth keeping from week to week: unavailable dates, case lengths, flags, reasons. The first time, start a new notes file on this computer.
>
> **VO S09b:** Pick a folder that doesn't sync to a personal cloud. Chrome will mention that SlateBuilder can edit this file — that's how it saves your notes for you.
>
> **VO S09c:** Lock it with a passphrase — four or five random words joined by hyphens works best. From then on, your notes save themselves.
>
> **VO S09d:** *(no voiceover — music only)*
>
> **VO S09e:** Next week, load the new list and unlock your notes file with its passphrase. Each note finds its patient again, and anyone no longer on the list is left behind.

## 10 · Close · 4:20–4:35

| Shot | On screen | Capture | Zoom / motion |
|---|---|---|---|
| S10a | Pointer clicks "Clear screen"; the app empties. | PW | Pull back to the MacBook frame |
| S10b | End card: "SlateBuilder for Offices", **slatebuilder.ca**, "User guide: in the app". | Card | — |

> **VO S10a:** Before you step away, clear the screen. Your saved notes aren't affected.
>
> **VO S10b:** That's SlateBuilder, at slatebuilder.ca. The full user guide is one click away in the app.

## Music, mix and export

The edit is a Matte project (`~/Movies/SlateBuilder Demo v2.matte`) laid out from
`edit/edl.json`, with the voiceover as one track (`edit/vo-track.wav`).

- **After a re-record.** Run `capture/record-all.mjs`, then `edit/build_edl.py`, then
  `edit/rebuild_matte.py <project.matte> <old edl.json>` with the project closed in Matte.
  It keeps the clip, text and canvas styling and redoes the timing: each zoom moves with
  its voiceover line, and close zooms are re-aimed where the pointer rests in the new take
  (the takes log those positions). Captions for browser alerts are set in the script.
  Then check the edit with Matte's review and contact sheets before exporting.

- **Music.** "Clear Path", generated in ElevenLabs for the earlier 4:53.8 cut. The source
  file lives in `out/music/clear-path.mp3`, which isn't committed. When the video runs longer
  than the music, the script slows it very slightly to fit (1.1% for the 4:57.4 cut).
- **Ducking.** `edit/mix_audio.sh <music.mp3>` makes `out/music/music-bed.wav`: the
  music sits at −23 dB under the voice (about 15 dB below speech), comes up to −13 dB on the
  opening and end cards, fades in over 1 s and out over the last 2.5 s. The music bed goes on
  its own audio track in Matte, starting at 0:00.
- **Loudness.** The same script mixes voice and music into `out/music/mix.wav`, mastered to
  −16 LUFS integrated with peaks at or below −1.5 dBTP, a normal level for web video.
- **Export.** A full-length Matte export times out through the agent connection, so export
  1080p / 30 fps H.264 in one-minute ranges, join them with ffmpeg's concat demuxer, and
  mux the result with `mix.wav` (pass the joined file and an output path as the script's
  second and third arguments). The final encode is x264 CRF 18, about 75 MB.
- **Watermark.** Matte isn't licensed on this Mac, so every render carries its watermark.

---

## Open points

1. ~~Site address~~ — slatebuilder.ca.
2. ~~Music~~ — "Clear Path", made in ElevenLabs to the video's length; see *Music, mix and export*.
3. **Drag-and-drop and the reason prompt** (S05e, S06b, S06c): exact wording and timing get
   confirmed on the first Playwright run, and the VO adjusted if the screen says something
   different.
4. **Browser pop-ups.** The app uses the browser's own alert and confirm boxes in a few
   places, and the scripted browser doesn't draw them. Where the message matters, the edit
   shows it as an on-screen caption, using the exact text from the take's log:
   - S05d: "…was taken off the slate… No later slate had room, so they're back on the
     waitlist as not-yet-slated."
   - S05g: "Both unlocked slates are already full, so nothing is reshuffled."
5. **The removal email** (S07c) opens your mail app. The still comes from clicking it once in
   your real Chrome with the dummy patient; nothing is sent.
