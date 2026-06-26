"""Print a human-readable summary report and save the JSON output file."""

import json
from datetime import datetime, timezone


def print_report(report_data):
	print("\n" + "═" * 60)
	print("  SUMMARY REPORT")
	print("═" * 60)

	missing_movies = report_data["movies"]["missing"]
	multiple_movies = report_data["movies"]["multiple_videos"]
	unneeded_movies = report_data["movies"]["unneeded_files"]

	missing_series = report_data["series"]["missing"]
	multiple_series = report_data["series"]["multiple_videos"]
	unneeded_series = report_data["series"]["unneeded_files"]

	if not any([missing_movies, multiple_movies, unneeded_movies, missing_series, multiple_series, unneeded_series]):
		print("\n  ✓ Everything looks great! No gaps or issues found.\n")
		return

	if missing_movies:
		print(f"\n  Missing movies ({len(missing_movies)}):")
		for m in missing_movies:
			print(f"    • {m['title']} ({m['year']})  [{m['collection']}]")

	seasons_missing = [e for e in missing_series if e["type"] == "season_missing"]
	eps_missing = [e for e in missing_series if e["type"] == "episode"]

	if seasons_missing:
		print(f"\n  Missing entire seasons ({len(seasons_missing)}):")
		for s in seasons_missing:
			print(f"    • {s['show']}  Season {s['season']:02d}  (premiered {s['first_air_date']})")

	if eps_missing:
		print(f"\n  Missing episodes ({len(eps_missing)}):")
		by_show = {}
		for e in eps_missing:
			by_show.setdefault(e["show"], {}).setdefault(e["season"], []).append(e["episode"])
		for show in sorted(by_show):
			for sn in sorted(by_show[show]):
				season_label = f"S{sn:02d}" if isinstance(sn, int) and sn > 0 else "absolute"
				print(f"    • {show}  {season_label}  ep {sorted(by_show[show][sn])}")

	if multiple_movies:
		print(f"\n  Movies with multiple video files ({len(multiple_movies)}):")
		for m in multiple_movies:
			names = [f["name"] if isinstance(f, dict) else f for f in m["files"]]
			print(f"    • {m['folder']}: {', '.join(names)}")

	if multiple_series:
		print(f"\n  Series with multiple videos per episode ({len(multiple_series)}):")
		for m in multiple_series:
			season_label = f"S{m['season']:02d}" if isinstance(m['season'], int) and m['season'] > 0 else "absolute"
			names = [f["name"] if isinstance(f, dict) else f for f in m["files"]]
			ep = m['episode']
			ep_label = "-".join(f"E{e:02d}" for e in ep) if isinstance(ep, list) else f"E{ep:02d}"
			print(f"    • {m['show']} {season_label}{ep_label}: {', '.join(names)}")

	if unneeded_movies:
		print(f"\n  Movies with unneeded files ({len(unneeded_movies)}):")
		for m in unneeded_movies:
			print(f"    • {m['folder']}: {', '.join(m['files'])}")

	if unneeded_series:
		print(f"\n  Series with unneeded files ({len(unneeded_series)}):")
		for s in unneeded_series:
			print(f"    • {s['file']}")

	print()


def save_report(report_data, out_path):
	report_data["generated"] = datetime.now(timezone.utc).isoformat()
	with open(out_path, "w") as f:
		json.dump(report_data, f, indent=2)
	print("  ✓ Report saved")
