"""Edits "The Right Next Step" from authentic parts only: the installed-app capture, the picked Sonic Rift
narration takes, the Sonic Rift music take, the approved opener and the end card. ffmpeg does every cut, fade and mix; this
script only computes the timeline from the capture's own marks and writes the edit decision list.

    python build_film.py <config.json>

config: {"capture": webm, "capture_log": json, "cards": dir, "opener_frames": dir, "vo": {"S01": wav, ...}, "music": wav|null,
         "out": dir, "name": "sojourner-the-right-next-step-v1-review"}
"""
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

CFG = json.load(open(sys.argv[1], encoding="utf-8-sig"))
OUT = CFG["out"]
NAME = CFG["name"]
os.makedirs(OUT, exist_ok=True)
STEMS = os.path.join(OUT, "stems")
os.makedirs(STEMS, exist_ok=True)
FONT = "C\\:/Windows/Fonts/segoeui.ttf"
FONT_B = "C\\:/Windows/Fonts/segoeuib.ttf"
RATE = 48000

OPENER = 2.6          # the approved MythologIQ Labs opener (make_opener.py); its last frames dissolve into frame 1
XF = 0.6              # picture cross-fade app > end card
END_HOLD = 4.4        # end card on screen after its cross-fade
TAGLINE_AFTER = 0.35  # S08 starts this long after the end card is fully up
MUSIC_UNDER_VO_DB = -6.0   # music dip while the narrator speaks (ramped, not gated)
MUSIC_RAMP = 0.45


def run(args):
    print(" ".join(a if " " not in a else f'"{a}"' for a in args)[:400])
    subprocess.run(args, check=True)


def probe_duration(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                                capture_output=True, text=True, check=True).stdout.strip())


def sync_end(capture):
    """End of the capture's one-second black sync frame: timeline zero of the capture log's marks."""
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", capture, "-vf", "blackdetect=d=0.4:pix_th=0.05", "-an",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    ends = [float(m) for m in re.findall(r"black_end:([0-9.]+)", err)]
    if not ends:
        raise SystemExit("no sync flash found in the capture")
    return ends[0]


log = json.load(open(CFG["capture_log"], encoding="utf-8"))
marks = log["marks"]
vo_lead = log["voLead"]
zero = sync_end(CFG["capture"])
CUT_XF = 0.4  # dissolve at each editorial cut inside the capture

# Capture segments kept, in capture time (seconds after the sync flash). Editorial cuts only remove
# navigation; nothing on screen is altered. Default: the whole take.
segments = CFG.get("segments") or [[0.0, marks["end"] + 0.5]]
seg_film = []  # film start of each segment
t = OPENER
for i, (a_in, a_out) in enumerate(segments):
    if i:
        t -= CUT_XF
    seg_film.append(t)
    t += a_out - a_in
cap_end_film = t
end_card_full = cap_end_film
total = end_card_full + END_HOLD


def film_time(c):
    """Film time of capture time c (c must fall inside a kept segment)."""
    for (a_in, a_out), f0 in zip(segments, seg_film):
        if a_in <= c <= a_out:
            return f0 + (c - a_in)
    raise SystemExit(f"capture time {c:.2f} is in a cut")


def sentence_starts(path, n_sentences):
    """Offsets (s) where each sentence of the take starts: the first voiced frame, then the ends of the
    take's n-1 longest pauses, in order."""
    a, r = sf.read(path, dtype="float32", always_2d=True)
    x = a.mean(axis=1)
    hop = int(r * 0.02)
    db = np.array([20 * np.log10(np.sqrt(np.mean(x[i:i + hop] ** 2)) + 1e-9) for i in range(0, len(x) - hop, hop)])
    voiced = db > (db.max() - 32)
    idx = np.nonzero(voiced)[0]
    pauses, start = [], None
    for i, v in enumerate(voiced):
        if not v and start is None:
            start = i
        elif v and start is not None:
            if (i - start) * 0.02 >= 0.18 and start > idx[0]:
                pauses.append(((i - start) * 0.02, i * 0.02))
            start = None
    if len(pauses) < n_sentences - 1:
        return None
    longest = sorted(pauses, reverse=True)[:n_sentences - 1]
    return [idx[0] * 0.02] + sorted(p[1] for p in longest)


# Narration placements: a line starts VO_LEAD after its scene mark, unless CFG["align"] pins one of its
# sentences to a capture mark (e.g. "Its truth check..." just before Truth Gate passed appears).
vo_files = CFG["vo"]
align = CFG.get("align", {})
placements = []
for scene in ["S01", "S02", "S03", "S04", "S05", "S06", "S07"]:
    if scene in align:
        rule = align[scene]
        n_sent = len([x for x in re.split(r"(?<=[.!?])\s+", CFG["lines"][scene]) if x.strip()])
        starts = sentence_starts(vo_files[scene], n_sent)
        if starts is None:
            raise SystemExit(f"{scene}: could not find the sentence pauses in the take")
        offset = starts[rule["sentence"] - 1]
        cap_at = marks[rule["mark"]] - rule["before"] - offset
        placements.append({"scene": scene, "file": vo_files[scene], "at": round(film_time(cap_at), 3),
                           "aligned": {**rule, "sentence_offset_s": round(offset, 3), "capture_at": round(cap_at, 3)}})
    else:
        placements.append({"scene": scene, "file": vo_files[scene], "at": round(film_time(marks[scene] + vo_lead), 3)})
placements.append({"scene": "S08", "file": vo_files["S08"], "at": round(end_card_full + TAGLINE_AFTER, 3)})
for p in placements:
    p["seconds"] = round(sf.info(p["file"]).duration, 3)
    p["ends"] = round(p["at"] + p["seconds"], 3)
for a, b in zip(placements, placements[1:]):
    if a["ends"] > b["at"] - 0.25:
        raise SystemExit(f"narration overlap: {a['scene']} ends {a['ends']} but {b['scene']} starts {b['at']}")
total = max(total, placements[-1]["ends"] + 1.2)

# --- picture -------------------------------------------------------------------------------------------
overlays = [
    # (start, end, lines) in film time; bottom of the sidebar, never over page content
    (film_time(0.0) + 0.4, film_time(marks["S02"]) - 0.3,
     ["Installed Sojourner", "Windows Alpha v1.0.0-alpha.1", "Jordan Ellis is fictional;", "all data is demo data."]),
    (film_time(marks["S06-tracked"]), film_time(marks["end"]),
     ["Status and follow-up are", "recorded by Jordan.", "Sojourner never submits", "applications to employers."]),
]
NOTE_X, NOTE_W, LINE_H = 12, 264, 25  # bottom of the sidebar, over Settings/Help (as the PWA film's captions)


def sidebar_note(start, end, lines):
    on = f"enable='between(t,{start:.3f},{end:.3f})'"
    h = 22 + LINE_H * len(lines)
    NOTE_Y = 900 - 12 - h
    out = [f"drawbox=x={NOTE_X}:y={NOTE_Y}:w={NOTE_W}:h={h}:color=0xf4fbf6@0.95:t=fill:{on}",
           f"drawbox=x={NOTE_X}:y={NOTE_Y}:w=4:h={h}:color=0x2f7a55@1:t=fill:{on}"]
    for i, line in enumerate(lines):
        safe = line.replace(":", "\:").replace("'", "’")
        out.append(f"drawtext=fontfile='{FONT_B if i == 0 else FONT}':text='{safe}':fontsize=17:fontcolor=0x10261c:"
                   f"x={NOTE_X + 18}:y={NOTE_Y + 13 + i * LINE_H}:{on}")
    return ",".join(out)


parts = [f"[0:v]scale=1600:900:flags=lanczos,setsar=1,fps=25,format=yuv420p,trim=duration={OPENER},setpts=PTS-STARTPTS,settb=1/25[op]",
         f"[1:v]fps=25,format=yuv420p,split={len(segments)}" + "".join(f"[raw{i}]" for i in range(len(segments)))]
for i, (a_in, a_out) in enumerate(segments):
    parts.append(f"[raw{i}]trim=start={zero + a_in}:end={zero + a_out},setpts=PTS-STARTPTS,settb=1/25[seg{i}]")
chain = "seg0"
for i in range(1, len(segments)):
    off = seg_film[i] - OPENER
    parts.append(f"[{chain}][seg{i}]xfade=transition=fade:duration={CUT_XF}:offset={off:.3f}[cx{i}]")
    chain = f"cx{i}"
parts.append(f"[2:v]scale=1600:900,setsar=1,fps=25,format=yuv420p,trim=duration={END_HOLD + XF + 3},setpts=PTS-STARTPTS,settb=1/25[end]")
parts.append(f"[op][{chain}]concat=n=2:v=1:a=0,settb=1/25[a]")
parts.append(f"[a][end]xfade=transition=fade:duration={XF}:offset={cap_end_film - XF:.3f}[b]")
parts.append(f"[b]{','.join(sidebar_note(*o) for o in overlays)},trim=duration={total},scale=out_range=tv,format=yuv420p[v]")
video_graph = ";".join(parts)
picture = os.path.join(OUT, "picture.mp4")
run(["ffmpeg", "-hide_banner", "-y",
     "-framerate", "30", "-i", os.path.join(CFG["opener_frames"], "o%03d.jpg"),
     "-i", CFG["capture"],
     "-loop", "1", "-framerate", "25", "-t", str(END_HOLD + XF + 3), "-i", os.path.join(CFG["cards"], "card-end.png"),
     "-filter_complex", video_graph, "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
     "-pix_fmt", "yuv420p", "-color_range", "tv", "-r", "25", picture])

# --- sound ---------------------------------------------------------------------------------------------
vo_inputs = []
vo_chains = []
for i, p in enumerate(placements):
    vo_inputs += ["-i", p["file"]]
    ms = int(round(p["at"] * 1000))
    vo_chains.append(f"[{i}:a]aresample={RATE},aformat=channel_layouts=stereo,adelay={ms}|{ms}[vo{i}]")
vo_stem = os.path.join(STEMS, "stem-narration.wav")
run(["ffmpeg", "-hide_banner", "-y", *vo_inputs, "-filter_complex",
     ";".join(vo_chains) + ";" + "".join(f"[vo{i}]" for i in range(len(placements))) +
     f"amix=inputs={len(placements)}:normalize=0,apad,atrim=duration={total}[out]",
     "-map", "[out]", "-c:a", "pcm_s24le", "-ar", str(RATE), vo_stem])


VO_OVER_MUSIC_DB = 13.0   # target: narrator this far above the bed while speaking
# Slow, gentle compression evens the take's own 17 LU range so its quiet opening stays audible.
BED_COMPRESSOR = "acompressor=threshold=0.008:ratio=3:attack=300:release=2500:makeup=3"


def rms_db(x):
    return float(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9))


def line_dips(flat_stem):
    """Per-line dip (dB) that holds the bed VO_OVER_MUSIC_DB under the narrator: an engineer's fader ride,
    measured on the flat-rendered bed stem against the narration stem (never more than 14 dB, never a boost)."""
    m, r = sf.read(flat_stem, dtype="float32", always_2d=True)
    vo, vr = sf.read(vo_stem, dtype="float32", always_2d=True)
    m, vo = m.mean(axis=1), vo.mean(axis=1)
    dips = {}
    for p in placements:
        bed_db = rms_db(m[int(p["at"] * r):int(p["ends"] * r)])
        vo_db = rms_db(vo[int(p["at"] * vr):int(p["ends"] * vr)])
        dips[p["scene"]] = round(max(-14.0, min(0.0, (vo_db - VO_OVER_MUSIC_DB) - bed_db)), 1)
    return dips


def music_gain_expr(dips):
    """Piecewise-linear gain (dB) in film time: 0 dB between lines, each line's own dip under it."""
    pts = [(0.0, 0.0)]
    for p in placements:
        g = dips.get(p["scene"], MUSIC_UNDER_VO_DB)
        a, b = p["at"] - MUSIC_RAMP, p["ends"] + 0.15
        pts += [(a, 0.0), (a + MUSIC_RAMP, g), (b, g), (b + MUSIC_RAMP, 0.0)]
    pts.sort()
    expr = "0"
    for (t0, g0), (t1, g1) in reversed(list(zip(pts, pts[1:]))):
        if t1 <= t0:
            continue
        seg = f"({g0}+({g1}-({g0}))*(t-{t0})/({t1}-{t0}))"
        expr = f"if(between(t,{t0},{t1}),{seg},{expr})"
    return expr


music_stem = None
music_info = None
if CFG.get("music"):
    music_stem = os.path.join(STEMS, "stem-music.wav")
    mlen = sf.info(CFG["music"]).duration
    music_at = CFG.get("music_at", OPENER)   # the opener is silent; the bed starts with the first app frame
    fade_out = 2.0
    used = min(mlen, total - music_at)
    ms = int(round(music_at * 1000))
    base = CFG.get("music_gain_db", -10)

    def render_bed(dips, out):
        run(["ffmpeg", "-hide_banner", "-y", "-i", CFG["music"], "-filter_complex",
             f"[0:a]aresample={RATE},aformat=channel_layouts=stereo,atrim=duration={used},"
             f"{BED_COMPRESSOR},afade=t=in:d=1.0,afade=t=out:st={used - fade_out}:d={fade_out},adelay={ms}|{ms},"
             f"volume=volume='pow(10,({music_gain_expr(dips)})/20)':eval=frame,volume={base}dB,"
             f"apad,atrim=duration={total}[out]",
             "-map", "[out]", "-c:a", "pcm_s24le", "-ar", str(RATE), out])

    flat = os.path.join(STEMS, "stem-music-flat-for-measuring.wav")
    render_bed({p["scene"]: 0.0 for p in placements}, flat)
    dips = line_dips(flat)
    os.remove(flat)
    render_bed(dips, music_stem)
    music_info = {"file": CFG["music"], "seconds": round(mlen, 2), "starts_film_s": music_at, "used_seconds": round(used, 2),
                  "base_gain_db": base, "dip_under_each_line_db": dips, "target_narration_over_music_db": VO_OVER_MUSIC_DB, "fade_in": 1.0,
                  "fade_out": fade_out, "compressor": BED_COMPRESSOR, "note": "one continuous take, never restarted; the take's own ending resolves it"}

mix = os.path.join(STEMS, "mix-premaster.wav")
if music_stem:
    run(["ffmpeg", "-hide_banner", "-y", "-i", vo_stem, "-i", music_stem, "-filter_complex",
         "[0:a][1:a]amix=inputs=2:normalize=0[out]", "-map", "[out]", "-c:a", "pcm_s24le", mix])
else:
    run(["ffmpeg", "-hide_banner", "-y", "-i", vo_stem, "-c:a", "pcm_s24le", mix])
master = os.path.join(STEMS, "mix-master.wav")
run(["ffmpeg", "-hide_banner", "-y", "-i", mix, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:print_format=summary",
     "-ar", str(RATE), "-c:a", "pcm_s24le", master])

final = os.path.join(OUT, f"{NAME}.mp4")
run(["ffmpeg", "-hide_banner", "-y", "-i", picture, "-i", master, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
     "-c:a", "aac", "-b:a", "192k", "-ar", str(RATE), "-movflags", "+faststart", "-shortest", final])

# --- captions, from the placed takes: sentence boundaries are the take's own pauses --------------------
LINES = CFG["lines"]


def sentence_cues(scene, at, path):
    text = LINES[scene]
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    a, r = sf.read(path, dtype="float32", always_2d=True)
    x = a.mean(axis=1)
    hop = int(r * 0.02)
    db = np.array([20 * np.log10(np.sqrt(np.mean(x[i:i + hop] ** 2)) + 1e-9) for i in range(0, len(x) - hop, hop)])
    voiced = db > (db.max() - 32)
    idx = np.nonzero(voiced)[0]
    first, last = idx[0] * 0.02, (idx[-1] + 1) * 0.02
    pauses = []
    run_start = None
    for i, v in enumerate(voiced):
        if not v and run_start is None:
            run_start = i
        elif v and run_start is not None:
            if (i - run_start) * 0.02 >= 0.18 and run_start * 0.02 > first:
                pauses.append(((i - run_start) * 0.02, run_start * 0.02, i * 0.02))
            run_start = None
    need = len(sentences) - 1
    bounds = sorted(sorted(pauses, reverse=True)[:need], key=lambda p: p[1]) if len(pauses) >= need else None
    cues = []
    if bounds is None:  # fall back to proportional split by characters
        total_chars = sum(len(s) for s in sentences)
        t = first
        for s in sentences:
            d = (last - first) * len(s) / total_chars
            cues.append((at + t, at + t + d, s))
            t += d
    else:
        starts = [first] + [b[2] for b in bounds]
        ends = [b[1] for b in bounds] + [last]
        cues = [(at + s0, at + e0, s) for s0, e0, s in zip(starts, ends, sentences)]
    # Short sentences shown together read better than a flicker of one-word cues
    merged = []
    for c in cues:
        if merged and (c[1] - c[0] < 1.1 or merged[-1][1] - merged[-1][0] < 1.1) and len(merged[-1][2]) + len(c[2]) < 90:
            merged[-1] = (merged[-1][0], c[1], merged[-1][2] + " " + c[2])
        else:
            merged.append(c)
    out = []
    for s0, e0, t in merged:  # a cue longer than two comfortable lines splits at its natural break
        if len(t) > 95:
            mid = len(t) // 2
            cut = min((i for i in (t.find(": "), t.rfind(", ", 0, mid + 20)) if i > 0), key=lambda i: abs(i - mid), default=t.rfind(" ", 0, mid))
            first, second = t[:cut + 1].strip(), t[cut + 1:].strip()
            split_t = s0 + (e0 - s0) * len(first) / len(t)
            out += [(s0, split_t, first), (split_t, e0, second)]
        else:
            out.append((s0, e0, t))
    return [(s, max(e, s + 1.2), t) for s, e, t in out]


cues = []
for p in placements:
    cues += sentence_cues(p["scene"], p["at"], p["file"])
for i in range(len(cues) - 1):  # never overlap the next cue
    s, e, t = cues[i]
    cues[i] = (s, min(e + 0.25, cues[i + 1][0] - 0.05), t)


def ts(t, sep="."):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}".replace(".", sep)


vtt = os.path.join(OUT, f"{NAME}.en.vtt")
with open(vtt, "w", encoding="utf-8", newline="\n") as f:
    f.write("WEBVTT\n\n")
    for n, (s, e, t) in enumerate(cues, 1):
        f.write(f"{n}\n{ts(s)} --> {ts(e)}\n{t}\n\n")
ass = os.path.join(OUT, "captions-burnin.ass")
with open(ass, "w", encoding="utf-8", newline="\n") as f:
    f.write("[Script Info]\nScriptType: v4.00+\nPlayResX: 1600\nPlayResY: 900\nWrapStyle: 0\n\n[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
            "MarginR, MarginV, Encoding\n"
            "Style: Cap,Segoe UI,34,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC0101A13,0,0,0,0,100,100,0,0,3,14,0,2,180,180,34,1\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
    for s, e, t in cues:
        f.write(f"Dialogue: 0,{ts(s)[1:-1]},{ts(e)[1:-1]},Cap,,0,0,0,,{t}\n")
silent = os.path.join(OUT, f"{NAME}-silent-captioned.mp4")
ass_arg = ass.replace("\\", "/").replace(":", "\\:")
run(["ffmpeg", "-hide_banner", "-y", "-i", picture, "-vf", f"subtitles='{ass_arg}'", "-c:v", "libx264", "-preset", "slow",
     "-crf", "17", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", silent])

poster = os.path.join(OUT, f"{NAME}-poster.png")
poster_t = film_time(marks["S03-epic"] + 1.5)
run(["ffmpeg", "-hide_banner", "-y", "-ss", f"{poster_t:.3f}", "-i", picture, "-frames:v", "1", poster])

edl = {
    "name": NAME, "fps": 25, "size": [1600, 900], "total_seconds": round(total, 3),
    "picture": [
        {"film": [0, OPENER], "source": "opener frames o000-o077.jpg (make_opener.py)",
         "note": "approved MythologIQ Labs opener; dissolves into the capture's first frame, then a straight cut"},
        *[{"film": [round(f0, 3), round(f0 + (a_out - a_in), 3)], "source": os.path.basename(CFG["capture"]),
           "capture_in": a_in, "capture_out": a_out, "source_in": round(zero + a_in, 3), "source_out": round(zero + a_out, 3),
           "transition_in": "straight cut from the opener's dissolve" if i == 0 else f"dissolve {CUT_XF}s (editorial cut)"}
          for i, ((a_in, a_out), f0) in enumerate(zip(segments, seg_film))],
        {"film": [round(end_card_full - XF, 3), round(total, 3)], "source": "card-end.png", "transition_in": f"fade {XF}s"},
    ],
    "capture_note": "installed signed app; picture never retimed, frozen or altered; cuts only remove navigation",
    "overlays": [{"film": [round(s, 3), round(e, 3)], "text": " ".join(t), "placement": "sidebar bottom"} for s, e, t in overlays],
    "narration": placements, "music": music_info,
    "capture_sync_zero_seconds": zero, "capture_marks": marks, "vo_lead": vo_lead,
    "loudness_target": {"integrated_lufs": -16, "true_peak_dbtp": -1.5},
    "poster_film_seconds": round(poster_t, 3),
    "captions": [{"start": round(s, 3), "end": round(e, 3), "text": t} for s, e, t in cues],
}
json.dump(edl, open(os.path.join(OUT, "edit-decision-list.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps({"total": round(total, 2), "zero": zero, "cues": len(cues)}))
