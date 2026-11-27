# Dummy data for the demo video

Fictional patients only. Every PHN is a made-up 99900xxxxx number, and the surgeon is
"Dr Jane".

- `week-1-waitlist.csv` — 40 patients in the hospital's export format (PAT_NAME1, PHN,
  SURGEON, DIAGNOSIS, TARGET_TIME, TIME_WAITING in weeks). Eight are over target, spread across
  the 2w–26w classes, so Slate 1 fills with over-target cases and the Long-waiters tab has
  something to show.
- `week-2-waitlist.csv` — the same list one week later: every wait one week longer, Claire
  Dubois removed (her surgery is done), and a new urgent referral, Ava Robinson.

The notes file used in section 9 is not stored here. It is produced by the app itself during
the recording, so it is always in the current format.
