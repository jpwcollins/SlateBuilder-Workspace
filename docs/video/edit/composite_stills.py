"""Rebuilds the three macOS stills (Open dialog, Save dialog, Mail draft) on
top of the current app.

Each still was a real screenshot of a macOS window over the app. The window
is still right, but the app behind it dates from the screenshot. This cuts
the window out of the original (kept in out/stills/original/), and lays it
over the frame of the new take at the moment the window would open, dimmed
the way macOS dims a page behind a sheet.

Run after the capture takes exist:
    python3 docs/video/edit/composite_stills.py
"""
import json, subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

VIDEO = Path(__file__).resolve().parents[1]
OUT = VIDEO / "out"
ORIG = OUT / "stills" / "original"

# still file, take, click label it follows, seconds after the click,
# window box in the original screenshot (2000 x 1125), and areas of the
# original to make unreadable (the sender's own email address).
STILLS = [
    ("s03a-open-dialog.png", "s03-load", "Choose File", 0.0, (526, 345, 1475, 812), []),
    ("s09b-save-dialog.png", "s09-notes", "Start a new notes file", 0.3, (526, 345, 1475, 812), []),
    ("s07c-removal-email.png", "s07-waitlist", "Remove from waitlist", 0.4, (563, 165, 1557, 950),
     [(636, 390, 975, 420)]),
]

def click_time(take, label):
    log = json.loads((OUT / take / f"{take}.json").read_text())
    return next(e["t"] for e in log["events"] if e.get("label") == label)

def frame(take, t):
    with tempfile.TemporaryDirectory() as d:
        png = Path(d) / "f.png"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{t:.2f}", "-i",
                        str(OUT / take / f"{take}.mp4"), "-frames:v", "1", str(png)], check=True)
        return Image.open(png).convert("RGB")

def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius, fill=255)
    return mask

def obscure(img, area):
    """Pixelate then blur, so the text can't be read or recovered."""
    region = img.crop(area)
    small = region.resize((max(1, region.width // 14), max(1, region.height // 14)), Image.BILINEAR)
    region = small.resize(region.size, Image.NEAREST).filter(ImageFilter.GaussianBlur(4))
    img.paste(region, area[:2])

for name, take, label, after, box, hide in STILLS:
    original = Image.open(ORIG / name).convert("RGB")
    for area in hide:
        obscure(original, area)
    sx = original.width
    base = frame(take, click_time(take, label) + after)
    W, H = base.size
    # Dim the page, as macOS does behind a sheet or modal window.
    base = ImageEnhance.Brightness(base).enhance(0.62)

    window = original.crop(box)
    scale = W / sx  # keep the window's size relative to the screen
    window = window.resize((round(window.width * scale), round(window.height * scale)), Image.LANCZOS)
    mask = rounded(window, round(12 * scale))
    # Centre horizontally; keep the original's vertical position.
    x = (W - window.width) // 2
    y = round(box[1] * H / original.height)

    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (x, y + 14, x + window.width, y + window.height + 14), round(12 * scale), fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    out = base.convert("RGBA")
    out.alpha_composite(shadow)
    out.paste(window, (x, y), mask)
    out.convert("RGB").save(OUT / "stills" / name)
    print("wrote", name, f"({take} at {click_time(take, label) + after:.2f}s)")
