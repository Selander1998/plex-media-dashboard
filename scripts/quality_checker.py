#!/usr/bin/env python3
"""
Media Quality Checker
Scans movie and series directories with ffprobe and flags files with:
  - Low resolution (below 720p)
  - Bad/legacy video codecs (xvid, divx, mpeg2, etc.)
  - Low video bitrate for resolution
  - Low audio bitrate or missing audio
  - Corrupt/unreadable files

Results are cached by file mtime+size so repeat runs only scan changed files.
"""

import os
import json
import subprocess
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

_script_dir = Path(__file__).parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

OUTPUT_PATH = _script_dir / "quality_report.json"
CACHE_PATH = _script_dir / "quality_cache.json"

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts"}

BAD_CODECS = {"mpeg1video", "mpeg2video", "h263", "xvid", "divx", "wmv1", "wmv2", "rv10", "rv20", "msmpeg4v2", "msmpeg4v3"}

# Thresholds in kbps for x264/AVC; halved automatically for efficient codecs (x265/HEVC, AV1, VP9)
BITRATE_THRESHOLDS = {2160: 8000, 1080: 2000, 720: 800, 0: 400}
EFFICIENT_CODECS = {"hevc", "h265", "x265", "av1", "vp9"}


def load_cache():
    try:
        return json.loads(CACHE_PATH.read_text())
    except Exception:
        return {}


def save_cache(cache):
    CACHE_PATH.write_text(json.dumps(cache, indent=2))


def cache_key(path):
    st = path.stat()
    return f"{st.st_mtime:.0f}:{st.st_size}"


def ffprobe(path):
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return None, "ffprobe error"
        return json.loads(result.stdout), None
    except subprocess.TimeoutExpired:
        return None, "timed out"
    except Exception as e:
        return None, str(e)


def check_file(path):
    data, err = ffprobe(path)
    if err or not data:
        return ["corrupt_or_unreadable"]

    streams = data.get("streams", [])
    fmt = data.get("format", {})
    issues = []

    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    if not video:
        return ["no_video_stream"]

    codec = video.get("codec_name", "").lower()
    if codec in BAD_CODECS:
        issues.append(f"bad_codec:{codec}")

    width = video.get("width", 0)
    height = video.get("height", 0)
    if height and height < 480:
        issues.append(f"low_resolution:{width}x{height}")

    video_bitrate = int(video.get("bit_rate", 0) or fmt.get("bit_rate", 0) or 0) // 1000
    if video_bitrate > 0:
        threshold = next(t for h, t in sorted(BITRATE_THRESHOLDS.items(), reverse=True) if height >= h)
        if codec in EFFICIENT_CODECS:
            threshold //= 2
        if video_bitrate < threshold:
            issues.append(f"low_video_bitrate:{video_bitrate}kbps")

    if not audio:
        issues.append("no_audio_stream")
    else:
        audio_bitrate = int(audio.get("bit_rate", 0) or 0) // 1000
        if audio_bitrate > 0 and audio_bitrate < 64:
            issues.append(f"low_audio_bitrate:{audio_bitrate}kbps")

    return issues


def scan_directories(roots, label, cache, total_files, scanned_so_far):
    results = []
    files = []
    for root in roots:
        root = Path(root)
        if not root.exists():
            print(f"  ! Skipping missing root: {root}", flush=True)
            continue
        files += [(root, p) for p in root.rglob("*") if p.suffix.lower() in VIDEO_EXTENSIONS]

    print(f"  Found {len(files)} {label} files", flush=True)

    for i, (root, f) in enumerate(sorted(files)):
        idx = scanned_so_far + i + 1
        print(f"[PROGRESS] quality {idx}/{total_files}", flush=True)

        key = cache_key(f)
        path_str = str(f)

        if path_str in cache and cache[path_str]["key"] == key:
            issues = cache[path_str]["issues"]
        else:
            issues = check_file(f)
            cache[path_str] = {"key": key, "issues": issues}

        if issues:
            rel = str(f.relative_to(root))
            results.append({"path": rel, "full_path": path_str, "issues": issues})

    return results, len(files)


def main():
    movies_roots = [p.strip() for p in os.environ.get("MOVIES_ROOTS", "").split(",") if p.strip()]
    series_roots = [p.strip() for p in os.environ.get("SERIES_ROOTS", "").split(",") if p.strip()]

    if not movies_roots and not series_roots:
        print("ERROR: No MOVIES_ROOTS or SERIES_ROOTS set in .env")
        raise SystemExit(1)

    cache = load_cache()

    # Count total files first for progress reporting
    all_roots = [(Path(r), "movie") for r in movies_roots] + [(Path(r), "series") for r in series_roots]
    total = sum(
        sum(1 for p in root.rglob("*") if p.suffix.lower() in VIDEO_EXTENSIONS)
        for root, _ in all_roots if root.exists()
    )

    print(f"Quality checker: scanning {total} files", flush=True)

    report = {"movies": [], "series": [], "generated": datetime.now().isoformat()}
    scanned = 0

    print("Checking movies...", flush=True)
    movie_results, n = scan_directories(movies_roots, "movie", cache, total, scanned)
    report["movies"] = movie_results
    scanned += n

    print("Checking series...", flush=True)
    series_results, n = scan_directories(series_roots, "series", cache, total, scanned)
    report["series"] = series_results

    save_cache(cache)

    with open(OUTPUT_PATH, "w") as f:
        json.dump(report, f, indent=2)

    issues_total = len(report["movies"]) + len(report["series"])
    print(f"{issues_total} quality issues found across {total} files", flush=True)


if __name__ == "__main__":
    main()
