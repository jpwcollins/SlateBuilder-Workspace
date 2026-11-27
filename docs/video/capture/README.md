# Recording the demo video

Each storyboard section with screen footage has a script here (`s01-…` to `s10-…`). The
scripts drive Chromium through the real app with the dummy data in `../data/`, draw a pointer,
and pause on each shot for as long as its voiceover line in `../storyboard.md` takes to read.

## Run

1. Build the offices app and serve the production build on port 3100. In Claude Code, that's
   the `offices-prod` preview. Otherwise:
   `npm run build -w @slatebuilder/offices && npx next start apps/slatebuilder-for-offices -p 3100`
2. Record:
   - `node docs/video/capture/record-all.mjs` records everything (about 6 minutes).
   - `node docs/video/capture/record-all.mjs s05 s09` records only those sections.

Each take is written to `docs/video/out/<take>/` (gitignored):

- `<take>.mp4`: 1920×1080, 30 fps.
- `<take>.json`: when each voiceover line starts, and the time and position of every click,
  drag and browser pop-up, for placing zooms and captions in Matte.
- extras: `s08-export/slates.pdf` and `slates-page-1.png` (the S08b still), and
  `s09-notes/*.sbnotes` (the encrypted notes file the take created).

Needs Playwright (a root dev dependency) with its Chromium (`npx playwright install
chromium`), and ffmpeg (`brew install ffmpeg`).

## What isn't scripted

- **macOS dialogs:** the Open dialog (S03a) and the Save dialog (S09b). Record a few seconds of
  each on a real screen.
- **The removal email (S07c):** a still of the pre-filled draft in a real mail app.
- **Title and end cards** (S02a, S09d, S10b): made in Matte.
- **Browser pop-ups:** headless Chrome doesn't draw `alert`/`confirm` boxes. The take accepts
  them and logs their text, so the edit can show one as a caption where it matters (S05d).

## Retiming to the real voiceover

Pauses are estimated at 145 words per minute. Once the ElevenLabs files exist, the edit can
stretch or trim the still stretches in Matte to fit. Alternatively, update the storyboard
lines and re-record.
