"""Assembles the first-review package from the build and the source folder, writes the narration transcript
and a SHA-256 manifest of every delivered file. Copies only; nothing is re-encoded here.

    python package_review.py <build dir> <source dir> <package dir> <name>
"""
import hashlib
import json
import os
import shutil
import sys

BUILD, SOURCE, PKG, NAME = sys.argv[1:5]
os.makedirs(PKG, exist_ok=True)


def copy(src, rel):
    dst = os.path.join(PKG, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


for f in (f"{NAME}.mp4", f"{NAME}-silent-captioned.mp4", f"{NAME}.en.vtt", f"{NAME}-poster.png",
          "edit-decision-list.json", "qa-measurements.json", "captions-burnin.ass"):
    copy(os.path.join(BUILD, f), f)
for f in os.listdir(os.path.join(BUILD, "stems")):
    copy(os.path.join(BUILD, "stems", f), os.path.join("stems", f))

audio = os.path.join(SOURCE, "audio")
for f in sorted(os.listdir(os.path.join(audio, "narration-selected"))):
    copy(os.path.join(audio, "narration-selected", f), os.path.join("audio", "narration-selected", f))
for sub in ("narration-design", "narration-takes", "narration-takes-s02", "music", "music-rejected-wrong-prompt"):
    for f in sorted(os.listdir(os.path.join(audio, sub))):
        if f.endswith((".wav", ".json", ".png", ".txt", ".csv")):
            copy(os.path.join(audio, sub, f), os.path.join("audio", sub, f))
for f in ("installed-app-capture.webm", "capture-log.json"):
    copy(os.path.join(SOURCE, "capture", f), os.path.join("source-capture", f))
for f in sorted(os.listdir(os.path.join(SOURCE, "rehearsal"))):
    copy(os.path.join(SOURCE, "rehearsal", f), os.path.join("source-capture", "rehearsal", f))
for f in ("card-end.png", "sojourner-icon.png", "mythologiq-silver-concept.webp", "first-frame.jpg"):
    copy(os.path.join(SOURCE, "brand", f), os.path.join("brand", f))
for f in sorted(os.listdir(os.path.join(SOURCE, "brand", "opener-source"))):
    copy(os.path.join(SOURCE, "brand", "opener-source", f), os.path.join("brand", "opener-source", f))
copy(os.path.join(SOURCE, "brand", "opener", "opener.json"), os.path.join("brand", "opener", "opener.json"))
copy(os.path.join(SOURCE, "installer", "windows-SHA256SUMS.txt"), os.path.join("source-capture", "installer-windows-SHA256SUMS.txt"))

# Transcript from the edit's own placements and captions
edl = json.load(open(os.path.join(BUILD, "edit-decision-list.json"), encoding="utf-8"))
cfg_lines = {c["scene"]: c for c in edl["narration"]}


def mmss(t):
    return f"{int(t // 60)}:{t % 60:05.2f}"


rows = ["# The Right Next Step: transcript (first review cut)", "",
        "Sojourner: Employment Toolkit · Windows Alpha v1.0.0-alpha.1. Narration made in Sonic Rift 0.9.1 (Qwen3 voice design,",
        "then Qwen3 voice cloning in one designed narrator voice). Jordan Ellis and Harbor Health are fictional; all data is demo data.",
        "", "| Time | Picture (installed Windows app) | Narration |", "|---|---|---|",
        f"| 0:00.00 | MythologIQ Labs opener (silent) | |"]
PICTURE = {"S01": "Target Tracks: Practice operations (target) and Patient services (current)",
           "S02": "Practice operations track: roles, then where Jordan can work, work mode, arrangement",
           "S03": "Find Jobs: the fictional Harbor Health Practice Operations Coordinator listing; Opportunity assessment: "
                  "Eligibility unclear, Evidence partial, Career aligned, Preferences mixed; blocker: hands-on Epic EHR experience (no confirmed support)",
           "S04": "Career Evidence: four confirmed facts (BLS credential, dental front desk role, referral backlog achievement, patient services role)",
           "S05": "Evidence coverage (3 supported, 1 transferable, 2 gaps) > Prepare resume > Create truthful draft > Truth Gate passed > Export verified PDF",
           "S06": "Applications: the job tracked as Interested; Application details: the exported PDF under Resume versions; a follow-up "
                  "\"Ask Harbor Health about Epic training\" added and saved",
           "S07": "The saved follow-up and the linked resume version",
           "S08": "End card: Sojourner, Employment Toolkit, Windows Alpha v1.0.0-alpha.1, release URL, fictional-data note"}
for scene in ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08"]:
    p = cfg_lines[scene]
    text = " ".join(c["text"] for c in edl["captions"] if p["at"] - 0.05 <= c["start"] <= p["ends"] + 0.05)
    rows.append(f"| {mmss(p['at'])} | {PICTURE[scene]} | {text} |")
rows += ["", "On-screen notes (edit overlays, bottom of the sidebar): " +
         "; ".join(f"{mmss(o['film'][0])}–{mmss(o['film'][1])} \"{o['text']}\"" for o in edl["overlays"]), ""]
open(os.path.join(PKG, "transcript.md"), "w", encoding="utf-8", newline="\n").write("\n".join(rows))

manifest = []
for root, _dirs, files in os.walk(PKG):
    for f in sorted(files):
        if f in ("SHA256SUMS.txt", "MANIFEST.json"):
            continue
        path = os.path.join(root, f)
        h = hashlib.sha256(open(path, "rb").read()).hexdigest()
        manifest.append({"path": os.path.relpath(path, PKG).replace("\\", "/"), "bytes": os.path.getsize(path), "sha256": h})
manifest.sort(key=lambda m: m["path"])
open(os.path.join(PKG, "SHA256SUMS.txt"), "w", encoding="utf-8", newline="\n").write(
    "".join(f"{m['sha256']}  {m['path']}\n" for m in manifest))
json.dump(manifest, open(os.path.join(PKG, "MANIFEST.json"), "w", encoding="utf-8"), indent=1)
print(len(manifest), "files")
