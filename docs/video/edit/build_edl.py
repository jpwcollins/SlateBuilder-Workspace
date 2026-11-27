"""Lays out the demo video: which footage, stills and cards go where, and when
each voiceover line starts. Writes edl.json and a single voiceover track
(vo-track.wav) with every line at its place, for import into Matte.

Run after the capture takes and the voiceover files exist:
    python3 docs/video/edit/build_edl.py
"""
import json, subprocess
from pathlib import Path

VIDEO = Path(__file__).resolve().parents[1]
OUT = VIDEO / "out"
W, H = 1920, 1080

def take(name):
    return json.loads((OUT / name / f"{name}.json").read_text())

def vo_len(shot):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(OUT / "vo" / f"{shot}.mp3")],
                       capture_output=True, text=True, check=True)
    return float(r.stdout)

items, vo, zooms, captions = [], {}, [], []
t = 0.0  # timeline cursor

TAIL = 0.9  # each take ends on a 1.5 s hold; keep 0.6 s of it

def end_of(name):
    return take(name)["duration"] - TAIL

def click_time(name, label):
    return next(e["t"] for e in take(name)["events"] if e.get("label") == label)

def footage(name, src_in, src_out, *, framed=False):
    global t
    items.append({"kind": "video", "file": str(OUT / name / f"{name}.mp4"), "take": name,
                  "src_in": round(src_in, 3), "src_out": round(src_out, 3),
                  "start": round(t, 3), "framed": framed})
    start = t
    t += src_out - src_in
    return start - src_in  # offset: timeline = source + offset (for this piece)

def still(path, dur, label):
    global t
    items.append({"kind": "image", "file": str(path), "start": round(t, 3), "duration": round(dur, 3), "label": label})
    s = t
    t += dur
    return s

def card(text, dur, sub=None):
    global t
    items.append({"kind": "card", "text": text, "sub": sub, "start": round(t, 3), "duration": round(dur, 3)})
    s = t
    t += dur
    return s

def beats_events(name, offset, lo, hi):
    """Place the take's voiceover lines and click zooms that fall in [lo, hi)."""
    d = take(name)
    for b in d["beats"]:
        if lo <= b["start"] < hi:
            vo[b["id"]] = round(b["start"] + offset, 3)
    for e in d["events"]:
        if e["type"] == "click" and lo <= e["t"] < hi and e.get("x") is not None:
            zooms.append({"take": name, "label": e["label"], "time": round(e["t"] + offset, 3),
                          "x": round(e["x"] / W, 3), "y": round(e["y"] / H, 3)})
        if e["type"] == "dialog" and lo <= e["t"] < hi and e.get("kind") == "alert":
            captions.append({"time": round(e["t"] + offset, 3), "text": e["message"]})

# 0 Opening title: the site, and that every patient and provider is simulated
card("SlateBuilder.ca", 5.0, "All patient and provider data in this video is simulated.")
# 1 Cold open
d = take("s01-cold-open"); off = footage("s01-cold-open", 0, end_of("s01-cold-open")); beats_events("s01-cold-open", off, 0, 1e9)
# 2 Title card, then the empty app in an iMac frame
vo["S02a"] = round(t + 0.6, 3); card("SlateBuilder for Offices", vo_len("S02a") + 1.4, "Suggested OR slates and a priority waitlist, in your browser")
d = take("s02-intro"); off = footage("s02-intro", 0, end_of("s02-intro"), framed=True); beats_events("s02-intro", off, 0, 1e9)
# 3 Load: footage to just after "Choose File", the Open dialog, then the rest
d = take("s03-load"); cut = click_time("s03-load", "Choose File") + 0.25
off = footage("s03-load", 0, cut); beats_events("s03-load", off, 0, cut)
still(VIDEO / "out" / "stills" / "s03a-open-dialog.png", 2.6, "Open dialog")
off = footage("s03-load", cut, end_of("s03-load")); beats_events("s03-load", off, cut, 1e9)
# 4 Rules
d = take("s04-rules"); off = footage("s04-rules", 0, end_of("s04-rules")); beats_events("s04-rules", off, 0, 1e9)
# 5 Slates
d = take("s05-slates"); off = footage("s05-slates", 0, end_of("s05-slates")); beats_events("s05-slates", off, 0, 1e9)
# 6 Booking order
d = take("s06-booking-order"); off = footage("s06-booking-order", 0, end_of("s06-booking-order")); beats_events("s06-booking-order", off, 0, 1e9)
# 7 Waitlist: the removal email cut in just after "Remove from waitlist"
d = take("s07-waitlist"); cut = click_time("s07-waitlist", "Remove from waitlist") + 0.27
off = footage("s07-waitlist", 0, cut); beats_events("s07-waitlist", off, 0, cut)
still(VIDEO / "out" / "stills" / "s07c-removal-email.png", 3.6, "Removal email")
off = footage("s07-waitlist", cut, end_of("s07-waitlist")); beats_events("s07-waitlist", off, cut, 1e9)
# 8 Export, then the PDF page
d = take("s08-export"); off = footage("s08-export", 0, d["duration"] - 0.6); beats_events("s08-export", off, 0, 1e9)
vo["S08b"] = round(t + 0.5, 3); still(OUT / "s08-export" / "slates-page-1.png", vo_len("S08b") + 1.4, "Slate PDF")
# 9 Notes: the click on "Create a new notes file" lands as S09a ends; the Save
# dialog follows with S09b's line over it, then the app shows the linked file.
d = take("s09-notes"); bt = {b["id"]: b["start"] for b in d["beats"]}
cut = click_time("s09-notes", "Start a new notes file") + 0.25
off = footage("s09-notes", 0, cut); beats_events("s09-notes", off, 0, cut)
vo["S09b"] = round(t + 0.35, 3)
still(VIDEO / "out" / "stills" / "s09b-save-dialog.png", 0.35 + vo_len("S09b") + 0.5, "Save dialog")
off = footage("s09-notes", cut + 0.3, cut + 2.3)  # "Linked to …" for a moment
off = footage("s09-notes", bt["S09c"] - 0.3, bt["S09e"] - 0.2); beats_events("s09-notes", off, bt["S09c"] - 0.3, bt["S09e"] - 0.2)
card("One week later", 2.4)
off = footage("s09-notes", bt["S09e"] - 0.2, end_of("s09-notes")); beats_events("s09-notes", off, bt["S09e"] - 0.2, 1e9)
# 10 Close, then the end card
d = take("s10-close"); off = footage("s10-close", 0, end_of("s10-close"), framed=True); beats_events("s10-close", off, 0, 1e9)
vo["S10b"] = round(t + 0.6, 3); card("SlateBuilder for Offices", vo_len("S10b") + 2.4, "slatebuilder.ca")

total = round(t, 3)
missing = [s for s in [p.stem for p in (OUT / "vo").glob("S*.mp3")] if s not in vo]
assert not missing, f"voiceover lines with no place: {missing}"

# Check no two lines overlap.
order = sorted(vo.items(), key=lambda kv: kv[1])
overlaps = []
for (a, ta), (b, tb) in zip(order, order[1:]):
    if ta + vo_len(a) > tb - 0.15:
        overlaps.append((a, b, round(ta + vo_len(a) - tb, 2)))

# Every line should finish before the next shot changes the subject.
for shot, start in order:
    end = start + vo_len(shot)
    nxt = [it["start"] for it in items if it["start"] > start]
    if nxt and end > min(nxt) + 0.8:
        print(f"note: {shot} runs {end - min(nxt):.1f}s into the next shot")

(Path(__file__).parent / "edl.json").write_text(json.dumps(
    {"total": total, "items": items, "vo": dict(order), "zooms": zooms, "captions": captions}, indent=2))

# One voiceover track, every line at its place.
inputs, filters = [], []
for i, (shot, start) in enumerate(order):
    inputs += ["-i", str(OUT / "vo" / f"{shot}.mp3")]
    ms = int(round(start * 1000))
    filters.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=mono,adelay={ms}[a{i}]")
mix = "".join(f"[a{i}]" for i in range(len(order)))
filters.append(f"{mix}amix=inputs={len(order)}:normalize=0,apad=whole_dur={total}[out]")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(filters),
                "-map", "[out]", "-t", str(total), str(Path(__file__).parent / "vo-track.wav")], check=True)

print(f"total {total}s, {len(items)} items, {len(vo)} lines, {len(zooms)} click points")
print("overlapping lines:", overlaps or "none")
for it in items:
    print(f"  {it['start']:7.2f}  {it['kind']:5}  {it.get('take') or it.get('label') or it.get('text')}"
          + (f"  src {it['src_in']}-{it['src_out']}" if it['kind'] == 'video' else f"  {it['duration']}s"))
