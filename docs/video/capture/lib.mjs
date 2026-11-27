// Recording harness for the SlateBuilder demo video.
//
// Drives a real Chromium against the production build and records it at
// 1920x1080 using Chrome's own screencast (about 48 frames a second while
// things move), rather than Playwright's built-in recorder, which only writes
// low-bitrate WebM.
//
// SCALE and SLOW are kept for a 4K version if one is ever wanted: SCALE 2
// renders a 3840x2160 window with the page CSS-zoomed 2x (headless Chrome
// ignores device pixel ratio in screencast frames), and SLOW films in slow
// motion to make up for the screencast's ~12 fps at that size. At 1080p both
// stay at 1.
//
// An automated browser has no visible pointer, so one is drawn into the page:
// it glides to each target, and real mouse events follow it, so hover states
// and drag-and-drop behave exactly as they would for a person.
//
// Each take writes, under docs/video/out/<take>/:
//   <take>.mp4     the footage, 1920x1080, 30 fps
//   <take>.json    when each voiceover beat starts, and every click, drag and
//                  confirmation dialog, in seconds of footage, for the edit

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const VIDEO_DIR = path.resolve(here, "..");
export const DATA_DIR = path.join(VIDEO_DIR, "data");
export const BASE_URL = process.env.SLATEBUILDER_URL ?? "http://localhost:3100";

const WIDTH = 1920;
const HEIGHT = 1080;
const SCALE = 1;
const FPS = 30;
const WORDS_PER_SECOND = 145 / 60;

// ---- Voiceover lengths --------------------------------------------------
//
// Each beat holds for as long as its line takes to say. Once the recorded
// voiceover exists (out/vo/<shot>.mp3) its real length is used; until then,
// an estimate from the storyboard's word count.

function voiceoverSeconds() {
  const seconds = {};
  for (const [id, words] of Object.entries(voiceoverWords())) {
    const file = path.join(VIDEO_DIR, "out", "vo", `${id}.mp3`);
    if (fs.existsSync(file)) {
      const out = execFileSync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
      ]).toString();
      seconds[id] = { seconds: Number(out), source: "recorded" };
    } else {
      seconds[id] = { seconds: words / WORDS_PER_SECOND, source: "estimate" };
    }
  }
  return seconds;
}

function voiceoverWords() {
  const text = fs.readFileSync(path.join(VIDEO_DIR, "storyboard.md"), "utf8");
  const words = {};
  for (const m of text.matchAll(/^> \*\*VO (S\d+[a-z]):\*\* (.+)$/gm)) {
    const line = m[2].replace(/\*\(.*?\)\*/g, "").trim();
    words[m[1]] = line ? line.split(/\s+/).length : 0;
  }
  return words;
}

// ---- In-page helpers: zoom, the drawn pointer, eased scrolling ------------

function pageScript(slow) {
  return `
(() => {
  const Z = ${SCALE}, S = ${slow};
  const zoom = () => { if (document.documentElement) document.documentElement.style.zoom = String(Z); };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const tween = (ms, onStep) => new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / (ms * S));
      onStep(ease(t));
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  const install = () => {
    zoom();
    if (document.getElementById("__demo_cursor")) return;
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M5 3 L5 22 L10 17.5 L13.5 25 L17 23.5 L13.5 16 L20 16 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {
      position: "fixed", left: "0", top: "0", width: "28px", height: "28px",
      marginLeft: "-5px", marginTop: "-3px", zIndex: "2147483647",
      pointerEvents: "none", transform: "translate(960px, 700px)",
      transition: "scale " + 120 * S + "ms ease", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.35))",
    });
    document.documentElement.appendChild(c);
    const state = { x: 960 * Z, y: 700 * Z };
    const place = (x, y) => {
      state.x = x; state.y = y;
      c.style.transform = "translate(" + x / Z + "px," + y / Z + "px)";
    };
    window.__demo = {
      get: () => ({ ...state }),
      place,
      glide: (x, y, ms) => {
        const x0 = state.x, y0 = state.y;
        return tween(ms, (k) => place(x0 + (x - x0) * k, y0 + (y - y0) * k));
      },
      press: (down) => { c.style.scale = down ? "0.85" : "1"; },
      ripple: () => {
        const r = document.createElement("div");
        Object.assign(r.style, {
          position: "fixed", left: state.x / Z - 18 + "px", top: state.y / Z - 18 + "px",
          width: "36px", height: "36px", borderRadius: "50%",
          border: "3px solid rgba(37, 99, 235, .85)", zIndex: "2147483646",
          pointerEvents: "none", transform: "scale(.3)", opacity: "1",
          transition: "transform " + 450 * S + "ms ease-out, opacity " + 450 * S + "ms ease-out",
        });
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => { r.style.transform = "scale(1.4)"; r.style.opacity = "0"; });
        setTimeout(() => r.remove(), 500 * S);
      },
      // Scroll so that el sits at "start" (below the app's fixed top bar) or
      // "center", eased, at the slowed pace. Smooth scrollIntoView cannot be
      // slowed, so scrolling is done here instead.
      scrollTo: (el, block, ms) => {
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight / Z;
        const y0 = window.scrollY;
        const offset = block === "start" ? rect.top - 150 : rect.top + rect.height / 2 - vh / 2;
        const max = document.documentElement.scrollHeight - vh;
        const y1 = Math.max(0, Math.min(max, y0 + offset));
        if (Math.abs(y1 - y0) < 2) return Promise.resolve();
        return tween(ms, (k) => window.scrollTo(0, y0 + (y1 - y0) * k));
      },
    };
  };
  zoom();
  if (document.readyState !== "loading") install();
  document.addEventListener("DOMContentLoaded", install);
})();
`;
}

// ---- A take ---------------------------------------------------------------

export async function openTake(name, { slow = 1 } = {}) {
  const outDir = path.join(VIDEO_DIR, "out", name);
  const framesDir = path.join(outDir, "frames");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH * SCALE, height: HEIGHT * SCALE },
    deviceScaleFactor: 1,
    locale: "en-CA",
    timezoneId: "America/Vancouver",
    colorScheme: "light",
  });
  await context.addInitScript(pageScript(slow));
  const page = await context.newPage();
  page.setDefaultTimeout(15_000 * slow);

  const lines = voiceoverSeconds();
  const log = { take: name, slow, beats: [], events: [] };
  const frames = [];
  let cdp = null;
  let t0 = null;
  let recording = false;

  // Seconds of finished footage since the first frame.
  const now = () => (t0 === null ? 0 : (Date.now() / 1000 - t0) / slow);
  // Waits are given in footage time and stretched for the slow-motion take.
  const sleep = (ms) => page.waitForTimeout(ms * (recording ? slow : 1));

  // The app asks for confirmation with window.confirm (Optimize Utilization,
  // Clear screen). A person would click OK; headless Chrome never draws the
  // dialog, so the footage simply continues. Logged so the edit can show the
  // question as a caption if it matters.
  page.on("dialog", async (dialog) => {
    log.events.push({ type: "dialog", kind: dialog.type(), t: +now().toFixed(2), message: dialog.message() });
    await dialog.accept();
  });

  const locate = (target) => (typeof target === "string" ? page.locator(target) : target);

  const take = {
    page,
    sleep,

    /** Start filming. Everything before this is set-up, not footage. */
    async record() {
      cdp = await context.newCDPSession(page);
      // Slow the app's own CSS transitions and animations to match.
      await cdp.send("Animation.enable");
      await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / slow });
      cdp.on("Page.screencastFrame", async (f) => {
        const file = path.join(framesDir, `${String(frames.length).padStart(6, "0")}.jpg`);
        fs.writeFileSync(file, Buffer.from(f.data, "base64"));
        frames.push({ file, ts: f.metadata.timestamp });
        if (t0 === null) t0 = f.metadata.timestamp;
        try {
          await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
        } catch {
          // the session is closing
        }
      });
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 90,
        maxWidth: WIDTH * SCALE,
        maxHeight: HEIGHT * SCALE,
        everyNthFrame: 1,
      });
      recording = true;
      // Force a first frame, then a moment of stillness before anything moves.
      await page.evaluate(() => window.__demo.place(window.__demo.get().x, window.__demo.get().y));
      await sleep(800);
    },

    /**
     * One voiceover beat: runs the actions, then holds until the beat's line
     * (from the storyboard) has had time to be spoken, plus `tail` seconds.
     */
    async beat(id, actions = async () => {}, { tail = 0.6 } = {}) {
      if (!(id in lines)) throw new Error(`No voiceover line ${id} in storyboard.md`);
      const start = now();
      log.beats.push({ id, start: +start.toFixed(2), voiceover: +lines[id].seconds.toFixed(2), source: lines[id].source });
      console.log(`  ${id}  ${start.toFixed(1)}s`);
      await actions();
      const spoken = lines[id].seconds + tail;
      const left = spoken - (now() - start);
      if (left > 0) await sleep(left * 1000);
    },

    /** How long a voiceover line runs, in seconds of footage. */
    lineSeconds(id) {
      return lines[id].seconds;
    },

    /** Seconds of footage since the current beat started. */
    sinceBeat() {
      const last = log.beats[log.beats.length - 1];
      return last ? now() - last.start : 0;
    },

    async pointAt(target, { ms } = {}) {
      const box = await this._box(target);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await this._glide(x, y, ms);
      return { x, y };
    },

    async click(target, { ms, label } = {}) {
      const { x, y } = await this.pointAt(target, { ms });
      await sleep(180);
      await page.evaluate(() => { window.__demo.press(true); window.__demo.ripple(); });
      log.events.push({ type: "click", label, t: +now().toFixed(2), x: Math.round(x), y: Math.round(y) });
      await page.mouse.click(x, y);
      await sleep(120);
      await page.evaluate(() => window.__demo.press(false));
      await sleep(150);
    },

    /** Click a field, clear it, and type at a person's pace. */
    async type(target, text, { label, delay = 70 } = {}) {
      await this.click(target, { label });
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.type(text, { delay: delay * (recording ? slow : 1) });
      await page.keyboard.press("Tab");
    },

    /** Fill a field there is no comfortable way to type into (a date). */
    async setValue(target, value, { label } = {}) {
      await this.click(target, { label });
      await locate(target).fill(value);
      await page.keyboard.press("Tab");
    },

    /** Choose an option in a <select>. The menu itself is never drawn headless. */
    async select(target, value, { label } = {}) {
      await this.click(target, { label });
      await locate(target).selectOption(value);
      await sleep(300);
    },

    /** Click a file button and answer its chooser with a file from data/. */
    async chooseFile(target, file, { label } = {}) {
      const chooser = page.waitForEvent("filechooser");
      await this.click(target, { label });
      await (await chooser).setFiles(path.join(DATA_DIR, file));
      await sleep(400);
    },

    async hideCursor() {
      await page.evaluate(() => { document.getElementById("__demo_cursor").style.display = "none"; });
    },

    /** Drag from one element to another, the pointer travelling with it. */
    async drag(from, to, { ms = 1100, label, offsetY = 0 } = {}) {
      const a = await this.pointAt(from);
      const bBox = await this._box(to, { scroll: false });
      const b = { x: bBox.x + bBox.width / 2, y: bBox.y + bBox.height / 2 + offsetY * SCALE };
      await sleep(150);
      log.events.push({ type: "drag", label, t: +now().toFixed(2), from: a, to: b });
      await page.evaluate(() => window.__demo.press(true));
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      const steps = Math.max(12, Math.round(ms / 30));
      for (let i = 1; i <= steps; i += 1) {
        const k = i / steps;
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const x = a.x + (b.x - a.x) * e;
        const y = a.y + (b.y - a.y) * e;
        await page.mouse.move(x, y);
        await page.evaluate(([px, py]) => window.__demo.place(px, py), [x, y]);
        await sleep(ms / steps);
      }
      await page.mouse.up();
      await page.evaluate(() => window.__demo.press(false));
      await sleep(300);
    },

    /** Scroll an element to "start" (just below the top bar) or "center". */
    async scrollTo(target, { block = "center", ms = 800 } = {}) {
      await locate(target).first().evaluate((el, [b, d]) => window.__demo.scrollTo(el, b, d), [block, ms]);
      await sleep(150);
    },

    async _box(target, { scroll = true } = {}) {
      const loc = locate(target);
      await loc.waitFor({ state: "visible" });
      let box = await loc.boundingBox();
      if (!box) throw new Error(`Not visible: ${loc}`);
      // The app's top bar stays fixed over the first ~150px; anything under it
      // or off screen is brought to the middle first, at the slowed pace.
      if (scroll && (box.y < 150 * SCALE || box.y + box.height > (HEIGHT - 40) * SCALE)) {
        await this.scrollTo(loc);
        box = await loc.boundingBox();
      }
      return box;
    },

    async _glide(x, y, ms) {
      const from = await page.evaluate(() => window.__demo.get());
      const dist = Math.hypot(x - from.x, y - from.y) / SCALE;
      const duration = ms ?? Math.min(1100, Math.max(350, dist * 0.9));
      await page.evaluate(([px, py, d]) => window.__demo.glide(px, py, d), [x, y, duration]);
      await page.mouse.move(x, y);
    },

    /** Stop, encode the frames to MP4, and write the timing log. */
    async finish({ hold = 1.5 } = {}) {
      let endTs = null;
      if (recording) {
        await sleep(hold * 1000);
        endTs = Date.now() / 1000;
        await cdp.send("Page.stopScreencast");
      }
      await browser.close();
      if (!frames.length) throw new Error("No frames were captured.");
      frames.sort((a, b) => a.ts - b.ts);
      const first = frames[0].ts;
      const lastTs = frames[frames.length - 1].ts;
      // A still page sends no frames, so the last one is held to the real end.
      endTs = Math.max(endTs ?? lastTs + 0.5, lastTs + 0.1);
      log.duration = +((endTs - first) / slow).toFixed(2);

      // Lay the uneven screencast frames onto a constant 30 fps timeline in
      // footage time: each output frame shows the latest screencast frame at
      // that moment. (Handing ffmpeg the uneven durations directly stretches
      // every frame shorter than 1/25 s.)
      const seqDir = path.join(outDir, "seq");
      fs.mkdirSync(seqDir);
      const total = Math.ceil(log.duration * FPS);
      let src = 0;
      for (let k = 0; k < total; k += 1) {
        const t = first + (k / FPS) * slow;
        while (src + 1 < frames.length && frames[src + 1].ts <= t) src += 1;
        fs.linkSync(frames[src].file, path.join(seqDir, `${String(k).padStart(6, "0")}.jpg`));
      }
      const mp4 = path.join(outDir, `${name}.mp4`);
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(seqDir, "%06d.jpg"),
        "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
        "-movflags", "+faststart", mp4,
      ]);
      fs.rmSync(seqDir, { recursive: true, force: true });
      fs.rmSync(framesDir, { recursive: true, force: true });
      fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(log, null, 2) + "\n");
      console.log(
        `  -> ${path.relative(process.cwd(), mp4)} (${log.duration}s, ` +
          `${(frames.length / log.duration).toFixed(0)} captured frames per second of footage)`,
      );
      return { mp4, log };
    },
  };
  return take;
}

/** The page with this week's waitlist loaded, ready to film. */
export async function loadWaitlist(page, file = "week-1-waitlist.csv") {
  await page.goto(BASE_URL);
  await page.locator('input[type="file"]').first().setInputFiles(path.join(DATA_DIR, file));
  await page.waitForFunction(() => /Cases\s*\d+/.test(document.body.innerText));
}

export function slate(page, n) {
  return page
    .getByText(new RegExp(`^Slate ${n}$`, "i"))
    .first()
    .locator(
      'xpath=ancestor::*[.//button[contains(., "Lock slate") or contains(., "Unlock")] and .//*[@draggable="true"]][1]',
    );
}

export function card(page, patient) {
  return page.locator('[draggable="true"]').filter({ hasText: patient }).filter({ hasText: "Duration (min)" });
}

/** A slate card's flags, availability and remove controls sit behind a toggle. */
export async function openCardControls(cardLocator) {
  const details = cardLocator.locator("details");
  if (!(await details.evaluate((d) => d.open))) await details.locator("summary").click();
}

/**
 * Open a take, run it, encode it. On failure, saves a screenshot of the
 * moment it failed next to the partial footage and sets a failing exit code.
 */
export async function runTake(name, body, options) {
  const take = await openTake(name, options);
  try {
    await body(take);
    await take.finish();
  } catch (error) {
    await take.page
      .screenshot({ path: path.join(VIDEO_DIR, "out", name, "failure.png") })
      .catch(() => {});
    console.error(error);
    await take.finish().catch(() => {});
    process.exitCode = 1;
  }
}

/** A yyyy-mm-dd date moved by a number of days. */
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
