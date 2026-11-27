#!/usr/bin/env bash
# Music bed and final audio mix for the demo video.
#
#   1. music-bed.wav: the backing track, ducked under the voiceover.
#   2. mix.wav: voice track + music bed, mastered to -16 LUFS for the web.
#   3. With a picture-only export joined from Matte, mux it with mix.wav.
#
# Usage:
#   edit/mix_audio.sh <music.mp3>                  # makes out/music/music-bed.wav and mix.wav
#   edit/mix_audio.sh <music.mp3> <picture.mp4> <final.mp4>
#
# Run from docs/video. The timings come from edit/edl.json: the music ducks as the
# first voiceover line starts and comes back up when the last one ends. If the
# music is shorter than the video it is slowed very slightly to fit (a few
# percent at most is inaudible).

set -euo pipefail

MUSIC=${1:?music file}
PICTURE=${2:-}
FINAL=${3:-}

read -r TOTAL VOICE_IN_END VOICE_OUT < <(python3 - <<'PY'
import json, subprocess
e = json.load(open("edit/edl.json"))
def length(shot):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", f"out/vo/{shot}.mp3"], capture_output=True, text=True, check=True)
    return float(r.stdout)
vo = e["vo"]
first = min(vo, key=vo.get); last = max(vo, key=vo.get)
print(e["total"], vo[first], round(vo[last] + length(last), 3))
PY
)
UNDER=-23           # music gain under the voice, dB (about 15 dB below speech)
OPEN=-13            # music gain on the title and end cards, dB
VOICE_IN=$(python3 -c "print(round($VOICE_IN_END - 0.8, 3))")   # start ducking here
VOICE_OUT_END=$(python3 -c "print(round($VOICE_OUT + 0.8, 3))")
FADE_OUT=2.48       # final fade, ending at TOTAL

MUSIC_LEN=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MUSIC")
TEMPO=$(python3 -c "print(min(1.0, round($MUSIC_LEN / $TOTAL, 5)))")
echo "video ${TOTAL}s, music ${MUSIC_LEN}s, tempo $TEMPO, voice ${VOICE_IN_END}-${VOICE_OUT}s"

mkdir -p out/music
FADE_START=$(python3 -c "print(round($TOTAL - $FADE_OUT, 3))")

gain="if(lt(t,$VOICE_IN),$OPEN,\
if(lt(t,$VOICE_IN_END),$OPEN+($UNDER-($OPEN))*(t-$VOICE_IN)/($VOICE_IN_END-$VOICE_IN),\
if(lt(t,$VOICE_OUT),$UNDER,\
if(lt(t,$VOICE_OUT_END),$UNDER+($OPEN-($UNDER))*(t-$VOICE_OUT)/($VOICE_OUT_END-$VOICE_OUT),$OPEN))))"

ffmpeg -y -hide_banner -loglevel error -i "$MUSIC" \
  -af "atempo=$TEMPO,volume='pow(10,($gain)/20)':eval=frame,afade=t=in:d=1.0,afade=t=out:st=$FADE_START:d=$FADE_OUT,atrim=0:$TOTAL" \
  out/music/music-bed.wav

ffmpeg -y -hide_banner -loglevel error -i edit/vo-track.wav -i out/music/music-bed.wav \
  -filter_complex "[0][1]amix=inputs=2:normalize=0:duration=longest,atrim=0:$TOTAL,loudnorm=I=-16:TP=-1.5:LRA=11" \
  -ar 48000 out/music/mix.wav

echo "wrote out/music/music-bed.wav and out/music/mix.wav"

if [[ -n "$PICTURE" && -n "$FINAL" ]]; then
  ffmpeg -y -hide_banner -loglevel error -i "$PICTURE" -i out/music/mix.wav \
    -map 0:v -map 1:a -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
    -c:a aac -b:a 192k -movflags +faststart -shortest "$FINAL"
  echo "wrote $FINAL"
fi
