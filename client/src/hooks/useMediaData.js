import { useState, useEffect, useCallback, useRef } from "react";
import { useLang } from "../LangContext.jsx";
import { diskStatus } from "../components/Watchlist.jsx";

const seriesKey = (m) => `${m.show}|${m.type}|${m.season}|${m.episode ?? 0}`;

export function useMediaData() {
	const { t } = useLang();
	const tRef = useRef(t);
	tRef.current = t;

	const [report, setReport] = useState(null);
	const [reportError, setReportError] = useState(null);
	const [watchlist, setWatchlist] = useState(null);
	const [watchlistError, setWatchlistError] = useState(null);
	const [blockedTitles, setBlockedTitles] = useState(new Set());
	const [newItems, setNewItems] = useState({
		watchlist: new Set(),
		movies: new Set(),
		series: new Set(),
	});
	const prevDataRef = useRef(null);

	const loadData = useCallback(async () => {
		try {
			const [rRes, wRes, bRes] = await Promise.all([
				fetch("/api/report"),
				fetch("/api/watchlist"),
				fetch("/api/blacklist"),
			]);
			const [rData, wData, bData] = await Promise.all([rRes.json(), wRes.json(), bRes.json()]);
			setBlockedTitles(new Set(Array.isArray(bData) ? bData : []));

			if (prevDataRef.current) {
				const prev = prevDataRef.current;
				const prevWL = new Set(prev.watchlist?.items?.map((i) => i.title) ?? []);
				const prevMovies = new Set(prev.report?.movies?.missing?.map((m) => m.tmdb_id ?? m.title) ?? []);
				const prevSeries = new Set(prev.report?.series?.missing?.map(seriesKey) ?? []);
				setNewItems({
					watchlist: new Set(
						(wData.items ?? [])
							.filter((i) => !prevWL.has(i.title))
							.filter((i) => diskStatus(i, rData) !== "complete")
							.map((i) => i.title),
					),
					movies: new Set(
						(rData.movies?.missing ?? [])
							.filter((m) => !prevMovies.has(m.tmdb_id ?? m.title))
							.map((m) => m.tmdb_id ?? m.title),
					),
					series: new Set((rData.series?.missing ?? []).filter((m) => !prevSeries.has(seriesKey(m))).map(seriesKey)),
				});
			}

			prevDataRef.current = { report: rData, watchlist: wData };
			setReport(rData);
			setReportError(null);
			setWatchlist(wData);
			setWatchlistError(null);
		} catch {
			setReportError(tRef.current("error_load_report"));
			setWatchlistError(tRef.current("error_load_watchlist"));
		}
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	return {
		report,
		reportError,
		watchlist,
		watchlistError,
		blockedTitles,
		setBlockedTitles,
		newItems,
		loadData,
	};
}
