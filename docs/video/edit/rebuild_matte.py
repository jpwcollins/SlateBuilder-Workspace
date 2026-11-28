"""Rebuilds the Matte project's timeline from edl.json after a re-record.

The finished edit's look (clip styling, text styles, canvas) lives in the
Matte project; what changes on a re-record is timing and, when the app's layout
changes, where things are on screen. This keeps the look and redoes the rest:

  * picture track: one clip per edl item, styled like the existing clips;
  * cards and captions: retimed, using the existing text clips as styles;
  * zooms: each existing zoom moves with the voiceover line it sat under. A
    close zoom (scale above 1.2) is re-aimed at where the pointer rests in the
    new take at that moment; gentle push-ins keep their framing;
  * voice and music tracks run the new length.

Usage (Matte closed, or the project not open in it):
    python3 docs/video/edit/rebuild_matte.py <project.matte> <old-edl.json>

<old-edl.json> is the edl.json the project was built from (e.g. from git).
"""
import copy, json, subprocess, sys, uuid
from pathlib import Path

VIDEO = Path(__file__).resolve().parents[1]
OUT = VIDEO / "out"
W, H = 1920, 1080

project_dir = Path(sys.argv[1])
old_edl = json.loads(Path(sys.argv[2]).read_text())
edl = json.loads((VIDEO / "edit" / "edl.json").read_text())
proj = json.loads((project_dir / "project.json").read_text())

# Captions: the browser's alerts aren't drawn, so the edit says what happened
# in a few words. Keyed by the voiceover line the alert falls under.
CAPTIONS = {
    "S05d": "Unavailable until after Dec 18, Grace moves off that slate",
    "S05g": "Both unlocked slates are already full, so nothing is reshuffled",
}
CAPTION_LEN = 6.6
# Image items whose picture differs from the edl's file.
IMAGE_SWAP = {"slates-page-1.png": "slates-page-1-white.png"}
# Stills rebuilt by composite_stills.py, framed for the full screen.
COMPOSITED_STILLS = {"s03a-open-dialog.png", "s09b-save-dialog.png", "s07c-removal-email.png"}

def new_id():
    return str(uuid.uuid4()).upper()

def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return float(r.stdout)

def take_log(name):
    return json.loads((OUT / name / f"{name}.json").read_text())

# ------------------------------------------------------------------ assets
assets_by_name = {Path(a.get("externalPath", "")).name: a for a in proj["assets"]}

def asset_for(path):
    path = Path(path)
    a = assets_by_name.get(path.name)
    if a is None:
        raise SystemExit(f"no asset for {path.name}: import it into the project once first")
    if a["assetType"] in ("video", "audio"):
        a["duration"] = probe(path)
    return a

# ------------------------------------------------------------------ picture
v1 = proj["videoTracks"][0]
old_clips = v1["clips"]
asset_name = {a["id"]: Path(a.get("externalPath", "")).name for a in proj["assets"]}
template = {}
for c in old_clips:
    name = asset_name.get(c["assetID"], "")
    if c.get("playbackRate", 1) == 1:
        template.setdefault(name, c)
default_video = next(c for c in old_clips if asset_name[c["assetID"]].endswith(".mp4"))

clips = []
for it in edl["items"]:
    if it["kind"] == "card":
        continue
    name = Path(it["file"]).name
    name = IMAGE_SWAP.get(name, name)
    a = asset_for(Path(it["file"]).with_name(name))
    c = copy.deepcopy(template.get(name, default_video))
    c["id"] = new_id()
    c["assetID"] = a["id"]
    c["startTime"] = it["start"]
    c["playbackRate"] = 1
    if it["kind"] == "video":
        c["sourceIn"], c["sourceOut"] = it["src_in"], it["src_out"]
    else:
        c["sourceIn"], c["sourceOut"] = 0, it["duration"]
        if name in COMPOSITED_STILLS:
            # Already framed by composite_stills.py: show the whole image.
            crop = c["bezelSettings"]["crop"]
            crop["normalizedRect"], crop["contentOffset"] = [[0, 0], [1, 1]], [0.5, 0.5]
            c["transform3D"]["scale"] = 0.96  # the same size as the screen recordings
    clips.append(c)
v1["clips"] = clips

# ------------------------------------------------------------------ audio
for track in proj["audioTracks"]:
    for c in track["clips"]:
        a = next(x for x in proj["assets"] if x["id"] == c["assetID"])
        c["startTime"] = 0
        c["sourceIn"] = 0
        c["sourceOut"] = edl["total"]
        a["duration"] = edl["total"]

# ------------------------------------------------------------------ text
text_clips = [c for t in proj["textTracks"] for c in t["clips"]]
by_text = {c["textSettings"]["text"]: c for c in text_clips}
title_style = by_text["SlateBuilder for Offices"]
sub_style = by_text["Suggested OR slates and a priority waitlist, in your browser"]
caption_style = next(c for c in text_clips if c["textSettings"]["position"][1] > 0.9)
interstitial_style = by_text["One week later"]
track_of = {c["id"]: i for i, t in enumerate(proj["textTracks"]) for c in t["clips"]}

def text_clip(style, text, start, dur):
    c = copy.deepcopy(style)
    c["id"] = new_id()
    c["textSettings"]["text"] = text
    c["startTime"] = round(start, 3)
    c["sourceIn"], c["sourceOut"] = 0, round(dur, 3)
    return c, track_of[style["id"]]

new_text = []
for it in edl["items"]:
    if it["kind"] != "card":
        continue
    s, d = it["start"], it["duration"]
    if it["sub"]:
        # Each card keeps its own styles where it had them (the end card's
        # address sits in a pill), else the title card's.
        new_text.append(text_clip(by_text.get(it["text"], title_style), it["text"], s + 0.2, d - 0.25))
        new_text.append(text_clip(by_text.get(it["sub"], sub_style), it["sub"], s + 0.5, d - 0.55))
    else:
        new_text.append(text_clip(interstitial_style, it["text"], s + 0.05, d - 0.1))

vo = edl["vo"]
vo_order = sorted(vo.items(), key=lambda kv: kv[1])

def line_at(t, table):
    best = None
    for shot, start in sorted(table.items(), key=lambda kv: kv[1]):
        if start <= t + 0.01:
            best = shot
    return best

for cap in edl["captions"]:
    shot = line_at(cap["time"], vo)
    if shot in CAPTIONS:
        new_text.append(text_clip(caption_style, CAPTIONS.pop(shot), cap["time"] + 0.17, CAPTION_LEN))
missing = list(CAPTIONS)
assert not missing, f"no alert found for caption(s) {missing}"

for t in proj["textTracks"]:
    t["clips"] = []
for c, i in new_text:
    proj["textTracks"][i]["clips"].append(c)
proj["textClips"] = [c for c, _ in new_text]

# ------------------------------------------------------------------ zooms
videos = [it for it in edl["items"] if it["kind"] == "video"]

def pointer_near(t0, t1):
    """Where the pointer rests in the new footage between timeline t0 and t1."""
    best = None
    for it in videos:
        off = it["start"] - it["src_in"]
        for e in take_log(it["take"])["events"]:
            if e.get("type") not in ("point", "click") or e.get("x") is None:
                continue
            if not (it["src_in"] <= e["t"] <= it["src_out"]):
                continue
            tl = e["t"] + off
            if t0 <= tl <= t1:
                best = (e["x"], e["y"])  # the last place it settles
    return best

def clamp(v):
    return round(min(0.85, max(0.15, v)), 4)

fx = []
for z in proj["effectsClips"]:
    if z.get("role") != "zoomEffect":
        continue
    shot = line_at(z["startTime"], old_edl["vo"])
    if shot not in vo:
        continue
    start = vo[shot] + (z["startTime"] - old_edl["vo"][shot])
    dur = z["sourceOut"] - z["sourceIn"]
    c = copy.deepcopy(z)
    c["id"] = new_id()
    c["startTime"] = round(max(0, start), 3)
    if c.get("zoomScale", 1) > 1.2:
        p = pointer_near(start - 0.5, start + min(dur, 3.0))
        if p:
            c["zoomPanX"], c["zoomPanY"] = clamp(p[0] / W), clamp(p[1] / H)
        else:
            print(f"note: zoom under {shot} at {start:.1f}s keeps its old aim")
    fx.append(c)
proj["effectsClips"] = sorted(fx, key=lambda c: c["startTime"])

# ------------------------------------------------------------------ colours
# Match the app's palette: a cool grey-to-blue canvas behind the screen, and
# the app's ink blue for shadows and caption backgrounds.
def rgb(hexstr, opacity=1):
    h = hexstr.lstrip("#")
    return {"red": int(h[0:2], 16) / 255, "green": int(h[2:4], 16) / 255,
            "blue": int(h[4:6], 16) / 255, "opacity": opacity}

fill = proj["bezelSettings"]["backgroundFill"]
fill["gradientStartColor"] = rgb("#f3f5f8")
fill["gradientEndColor"] = rgb("#dce6fd")
fill["solidColor"] = rgb("#eef2f8")
for c in clips:
    c["bezelSettings"]["shadow"]["tintColor"] = rgb("#172447")
INK, MUTED, WHITE = rgb("#172447"), rgb("#4f5867"), rgb("#ffffff")
for c, _ in new_text:
    ts = c["textSettings"]
    if ts.get("backgroundEnabled"):
        ts["backgroundColor"] = rgb("#172447", 0.9)
    elif ts["fontSize"] >= 90:
        ts["textColor"] = INK
    elif ts["textColor"] != WHITE:
        ts["textColor"] = MUTED

(project_dir / "project.json").write_text(json.dumps(proj, indent=2))
print(f"{len(clips)} picture clips, {len(new_text)} text clips, {len(fx)} zooms, total {edl['total']}s")
