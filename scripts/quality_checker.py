#!/usr/bin/env python3
"""
Media Quality Checker
Scans movie and series directories with ffprobe and flags files with:
  - Low resolution (configurable threshold)
  - Bad/legacy video codecs (xvid, divx, mpeg2, etc.)
  - Low video bitrate (configurable, 1080p reference)
  - Low audio bitrate (configurable)
  - Missing audio stream
  - Corrupt/unreadable files

Results are cached by file mtime+size. Cache auto-invalidates when settings change.
"""

import os
import json
import threading
import subprocess
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

_script_dir = Path(__file__).parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

OUTPUT_PATH = _script_dir / "quality_report.json"
CACHE_PATH = _script_dir / "quality_cache.json"
SETTINGS_PATH = _script_dir / "quality_settings.json"

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts"}

BAD_CODECS = {"mpeg1video", "mpeg2video", "h263", "xvid", "divx", "wmv1", "wmv2", "rv10", "rv20", "msmpeg4v2", "msmpeg4v3"}
EFFICIENT_CODECS = {"hevc", "h265", "x265", "av1", "vp9"}

# Scaling ratios relative to 1080p threshold
VIDEO_BITRATE_RATIOS = {2160: 4.0, 1080: 1.0, 720: 0.4, 0: 0.2}


def load_settings():
    try:
        return json.loads(SETTINGS_PATH.read_text())
    except Exception:
        return {}


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


def check_file(path, resolution_threshold=720, video_bitrate_1080p=0, audio_bitrate_min=0):
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
    if height and height < resolution_threshold:
        issues.append(f"low_resolution:{width}x{height}")

    def _to_int(v):
        s = str(v or "")
        return int(s) if s.lstrip("-").isdigit() else 0

    if video_bitrate_1080p > 0 and height:
        ratio = next(r for h, r in sorted(VIDEO_BITRATE_RATIOS.items(), reverse=True) if height >= h)
        threshold = int(video_bitrate_1080p * ratio)
        if codec in EFFICIENT_CODECS:
            threshold //= 2
        video_bitrate = _to_int(video.get("bit_rate") or fmt.get("bit_rate")) // 1000
        if video_bitrate > 0 and video_bitrate < threshold:
            issues.append(f"low_video_bitrate:{video_bitrate}kbps")

    if not audio:
        issues.append("no_audio_stream")
    elif audio_bitrate_min > 0:
        audio_bitrate = _to_int(audio.get("bit_rate")) // 1000
        if audio_bitrate > 0 and audio_bitrate < audio_bitrate_min:
            issues.append(f"low_audio_bitrate:{audio_bitrate}kbps")

    return issues


WORKERS = min(os.cpu_count() or 4, 8)


def scan_directories(roots, label, cache, total_files, scanned_so_far, settings):
    resolution_threshold = settings["resolution_threshold"]
    video_bitrate_1080p = settings["video_bitrate_1080p"]
    audio_bitrate_min = settings["audio_bitrate_min"]

    files = []
    for root in roots:
        root = Path(root)
        if not root.exists():
            print(f"  ! Skipping missing root: {root}", flush=True)
            continue
        files += [(root, p) for p in root.rglob("*") if p.suffix.lower() in VIDEO_EXTENSIONS]
    files.sort(key=lambda x: x[1])

    print(f"  Found {len(files)} {label} files", flush=True)

    lock = threading.Lock()
    counter = [scanned_so_far]
    results = []

    def process(root, f):
        key = cache_key(f)
        path_str = str(f)
        entry = cache.get(path_str)
        if entry and entry["key"] == key:
            issues = entry["issues"]
        else:
            issues = check_file(f, resolution_threshold, video_bitrate_1080p, audio_bitrate_min)
            with lock:
                cache[path_str] = {"key": key, "issues": issues}
        with lock:
            counter[0] += 1
            print(f"[PROGRESS] quality {counter[0]}/{total_files}", flush=True)
        if issues:
            return {"path": str(f.relative_to(root)), "full_path": path_str, "issues": issues}
        return None

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = [executor.submit(process, root, f) for root, f in files]
        for future in as_completed(futures):
            result = future.result()
            if result:
                results.append(result)

    return results, len(files)


def main():
    movies_roots = [p.strip() for p in os.environ.get("MOVIES_ROOTS", "").split(",") if p.strip()]
    series_roots = [p.strip() for p in os.environ.get("SERIES_ROOTS", "").split(",") if p.strip()]

    if not movies_roots and not series_roots:
        print("ERROR: No MOVIES_ROOTS or SERIES_ROOTS set in .env")
        raise SystemExit(1)

    raw = load_settings()
    settings = {
        "resolution_threshold": int(raw.get("resolution_threshold", 720)),
        "video_bitrate_1080p": int(raw.get("video_bitrate_1080p", 0)),
        "audio_bitrate_min": int(raw.get("audio_bitrate_min", 0)),
    }
    print(
        f"Quality settings: resolution <{settings['resolution_threshold']}p"
        + (f", video <{settings['video_bitrate_1080p']}kbps@1080p" if settings["video_bitrate_1080p"] else "")
        + (f", audio <{settings['audio_bitrate_min']}kbps" if settings["audio_bitrate_min"] else ""),
        flush=True,
    )

    cache = load_cache()
    if cache.get("_settings") != settings:
        print("Settings changed — clearing per-file cache for fresh scan.", flush=True)
        cache = {}
    cache["_settings"] = settings

    all_roots = [(Path(r), "movie") for r in movies_roots] + [(Path(r), "series") for r in series_roots]
    total = sum(
        sum(1 for p in root.rglob("*") if p.suffix.lower() in VIDEO_EXTENSIONS)
        for root, _ in all_roots if root.exists()
    )

    print(f"Quality checker: scanning {total} files", flush=True)

    report = {"movies": [], "series": [], "generated": datetime.now().isoformat()}
    scanned = 0

    print("Checking movies...", flush=True)
    movie_results, n = scan_directories(movies_roots, "movie", cache, total, scanned, settings)
    report["movies"] = movie_results
    scanned += n

    print("Checking series...", flush=True)
    series_results, n = scan_directories(series_roots, "series", cache, total, scanned, settings)
    report["series"] = series_results

    save_cache(cache)

    with open(OUTPUT_PATH, "w") as f:
        json.dump(report, f, indent=2)

    issues_total = len(report["movies"]) + len(report["series"])
    print(f"{issues_total} quality issues found across {total} files", flush=True)


if __name__ == "__main__":
    main()
