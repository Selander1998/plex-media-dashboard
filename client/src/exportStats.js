const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function rr(ctx, x, y, w, h, r) {
	const [tl, tr, br, bl] = typeof r === "number" ? [r, r, r, r] : r;
	ctx.beginPath();
	ctx.moveTo(x + tl, y);
	ctx.lineTo(x + w - tr, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
	ctx.lineTo(x + w, y + h - br);
	ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
	ctx.lineTo(x + bl, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
	ctx.lineTo(x, y + tl);
	ctx.quadraticCurveTo(x, y, x + tl, y);
	ctx.closePath();
}

function fmtBytes(b) {
	if (!b) return "0 B";
	if (b >= 1e15) return (b / 1e15).toFixed(1) + " PB";
	if (b >= 1e12) return (b / 1e12).toFixed(1) + " TB";
	if (b >= 1e9)  return (b / 1e9).toFixed(1)  + " GB";
	if (b >= 1e6)  return (b / 1e6).toFixed(0)  + " MB";
	return b + " B";
}

function drawInfoBar(ctx, CX, y, rowW, BH, items, SANS) {
	ctx.fillStyle = "#161b22";
	rr(ctx, CX, y, rowW, BH, 10);
	ctx.fill();
	ctx.strokeStyle = "#30363d";
	ctx.lineWidth = 1;
	rr(ctx, CX, y, rowW, BH, 10);
	ctx.stroke();

	const secW = rowW / items.length;
	const maxTextW = secW - 20;

	items.forEach((s, i) => {
		const cx = CX + i * secW + secW / 2;

		if (i > 0) {
			ctx.strokeStyle = "#30363d";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(CX + i * secW, y + 12);
			ctx.lineTo(CX + i * secW, y + BH - 12);
			ctx.stroke();
		}

		ctx.font = `bold 18px ${SANS}`;
		ctx.fillStyle = s.color || "#e6edf3";
		ctx.textAlign = "center";
		ctx.fillText(s.value, cx, y + BH / 2 - 2, maxTextW);

		ctx.font = `11px ${SANS}`;
		ctx.fillStyle = "#8b949e";
		ctx.fillText(s.label, cx, y + BH / 2 + 16, maxTextW);
	});
}

export function exportStatsCard(report, locale = "en-US", t = (k) => k) {
	const W      = 900;
	const MARGIN = 57;
	const GAP    = 14;
	const BH     = 68;   // info bar height
	const CY     = 94;   // main cards top
	const CH     = 112;  // main card height

	// ── Stats ─────────────────────────────────────────────────────────────────
	const movies   = report?.movies?.total ?? 0;
	const shows    = report?.series?.total_shows ?? 0;
	const seasons  = report?.series?.total_seasons ?? 0;
	const episodes = report?.series?.total_episodes ?? 0;
	const movSize  = report?.movies?.total_size ?? 0;
	const serSize  = report?.series?.total_size ?? 0;

	const totalFiles   = movies + episodes;
	const movPct       = totalFiles > 0 ? Math.round((movies / totalFiles) * 100) : 0;
	const tvPct        = 100 - movPct;
	const avgMovSize   = movies > 0 ? movSize / movies : 0;
	const avgEpSize    = episodes > 0 ? serSize / episodes : 0;
	const avgEps       = shows > 0 ? Math.round(episodes / shows) : 0;
	const avgSeasons   = shows > 0 ? (seasons / shows).toFixed(1) : "0";
	const avgEpsSeason = seasons > 0 ? Math.round(episodes / seasons) : 0;

	const totalMinutes = movies * 120 + episodes * 45;
	const watchDays    = Math.floor(totalMinutes / (60 * 24));
	const watchYears   = (watchDays / 365).toFixed(1);
	const bingeVal     = watchDays > 365
		? t("stat_card_days_years", { d: watchDays.toLocaleString(locale), y: watchYears })
		: t("stat_card_days", { n: watchDays.toLocaleString(locale) });

	const at8hMonths = totalMinutes / (8 * 60 * 30.5);
	const at8hVal    = at8hMonths >= 12
		? t("stat_card_at_8h_years",  { n: (at8hMonths / 12).toFixed(1) })
		: t("stat_card_at_8h_months", { n: at8hMonths.toFixed(1) });

	const weekends    = Math.round(totalMinutes / (48 * 60));
	const workYears   = (totalMinutes / (2080 * 60)).toFixed(1);

	const missingMov    = report?.movies?.missing?.length ?? 0;
	const missingArr    = report?.series?.missing ?? [];
	const missingEp     = missingArr.filter((m) => m.type === "episode").length;
	const missingSeason = missingArr.filter((m) => m.type === "season_missing").length;
	const affectedShows = new Set(missingArr.map((m) => m.show)).size;
	const wishlist      = missingMov + new Set(missingArr.map((m) => m.show)).size;
	const hasMissing    = missingMov > 0 || missingEp > 0 || missingSeason > 0;

	// ── Dynamic canvas height ─────────────────────────────────────────────────
	let H = CY + CH + GAP + BH + GAP + BH + GAP + BH + 32;
	if (hasMissing)  H += GAP + BH;
	if (wishlist > 0) H += GAP + 44;

	const canvas = document.createElement("canvas");
	canvas.width  = W * 2;
	canvas.height = H * 2;
	const ctx = canvas.getContext("2d");
	ctx.scale(2, 2);

	const rowW = W - MARGIN * 2;

	// ── Background ────────────────────────────────────────────────────────────
	ctx.fillStyle = "#0d1117";
	rr(ctx, 0, 0, W, H, 16);
	ctx.fill();

	ctx.fillStyle = "#1c2128";
	for (let x = 36; x < W; x += 36)
		for (let y = 36; y < H; y += 36) {
			ctx.beginPath();
			ctx.arc(x, y, 1, 0, Math.PI * 2);
			ctx.fill();
		}

	// ── Top gradient bar ──────────────────────────────────────────────────────
	const grad = ctx.createLinearGradient(0, 0, W, 0);
	grad.addColorStop(0,   "#6366f1");
	grad.addColorStop(0.5, "#8b5cf6");
	grad.addColorStop(1,   "#06b6d4");
	ctx.fillStyle = grad;
	rr(ctx, 0, 0, W, 5, [16, 16, 0, 0]);
	ctx.fill();

	// ── Title ─────────────────────────────────────────────────────────────────
	ctx.font = `bold 28px ${SANS}`;
	ctx.fillStyle = "#e6edf3";
	ctx.textAlign = "left";
	ctx.fillText(t("stat_card_title"), MARGIN, 56);

	ctx.font = `13px ${SANS}`;
	ctx.fillStyle = "#484f58";
	ctx.fillText(
		new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }),
		MARGIN, 76,
	);

	// ── Row 1: main stat cards (Movies | TV Shows | Seasons | Episodes) ───────
	const STATS = [
		{ label: t("stat_card_movies"),   value: movies.toLocaleString(locale),   color: "#6366f1" },
		{ label: t("stat_card_shows"),    value: shows.toLocaleString(locale),    color: "#a371f7" },
		{ label: t("stat_card_seasons"),  value: seasons.toLocaleString(locale),  color: "#8b5cf6" },
		{ label: t("stat_card_episodes"), value: episodes.toLocaleString(locale), color: "#58a6ff" },
	];
	const CW = Math.floor((rowW - 3 * GAP) / 4);

	// TV group bracket
	ctx.fillStyle = "#ffffff07";
	rr(ctx, MARGIN + CW + GAP - 4, CY - 4, CW * 3 + GAP * 2 + 8, CH + 8, 13);
	ctx.fill();
	ctx.font = `bold 9px ${SANS}`;
	ctx.fillStyle = "#8b5cf688";
	ctx.textAlign = "center";
	ctx.fillText("TV", MARGIN + CW + GAP + (CW * 3 + GAP * 2) / 2, CY - 8);

	STATS.forEach((s, i) => {
		const x = MARGIN + i * (CW + GAP);
		ctx.fillStyle = "#161b22";
		rr(ctx, x, CY, CW, CH, 10);
		ctx.fill();
		ctx.strokeStyle = "#30363d";
		ctx.lineWidth = 1;
		rr(ctx, x, CY, CW, CH, 10);
		ctx.stroke();
		ctx.fillStyle = s.color + "22";
		rr(ctx, x + 1, CY + CH - 32, CW - 2, 31, [0, 0, 9, 9]);
		ctx.fill();
		ctx.font = `bold 34px ${SANS}`;
		ctx.fillStyle = "#e6edf3";
		ctx.textAlign = "center";
		ctx.fillText(s.value, x + CW / 2, CY + 54);
		ctx.font = `bold 11px ${SANS}`;
		ctx.fillStyle = s.color;
		ctx.fillText(s.label.toUpperCase(), x + CW / 2, CY + 88);
	});

	let nextY = CY + CH + GAP;

	// ── Row 2: Storage breakdown ──────────────────────────────────────────────
	drawInfoBar(ctx, MARGIN, nextY, rowW, BH, [
		{ value: fmtBytes(movSize),    label: t("stat_card_movie_storage"),  color: "#6366f1" },
		{ value: fmtBytes(serSize),    label: t("stat_card_series_storage"), color: "#a371f7" },
		{ value: fmtBytes(avgMovSize), label: t("stat_card_avg_movie_size"), color: "#8b949e" },
		{ value: fmtBytes(avgEpSize),  label: t("stat_card_avg_ep_size"),    color: "#8b949e" },
	], SANS);
	nextY += BH + GAP;

	// ── Row 3: Time investment ────────────────────────────────────────────────
	drawInfoBar(ctx, MARGIN, nextY, rowW, BH, [
		{ value: bingeVal,                                                       label: t("stat_card_binge"),      color: "#f0883e" },
		{ value: at8hVal,                                                        label: t("stat_card_at_8h_label"),color: "#f0883e" },
		{ value: t("stat_card_weekends_val",   { n: weekends.toLocaleString(locale) }), label: t("stat_card_weekends"),   color: "#e3b341" },
		{ value: t("stat_card_work_years_val", { n: workYears }),                label: t("stat_card_work_years"), color: "#e3b341" },
	], SANS);
	nextY += BH + GAP;

	// ── Row 4: TV details + file split ────────────────────────────────────────
	drawInfoBar(ctx, MARGIN, nextY, rowW, BH, [
		{ value: t("stat_card_eps_per_show",    { n: avgEps.toLocaleString(locale) }),       label: t("stat_card_avg_eps"),        color: "#58a6ff" },
		{ value: t("stat_card_seasons_per_show",{ n: avgSeasons }),                          label: t("stat_card_avg_seasons"),    color: "#58a6ff" },
		{ value: t("stat_card_eps_per_season",  { n: avgEpsSeason.toLocaleString(locale) }), label: t("stat_card_avg_eps_season"), color: "#58a6ff" },
		{ value: t("stat_card_file_split",      { m: movPct, tv: tvPct }),                   label: t("stat_card_files"),          color: "#8b949e" },
	], SANS);
	nextY += BH + GAP;

	// ── Row 5: Completeness (conditional) ────────────────────────────────────
	if (hasMissing) {
		drawInfoBar(ctx, MARGIN, nextY, rowW, BH, [
			{ value: missingMov.toLocaleString(locale),    label: t("stat_card_missing_movies"),   color: "#f85149" },
			{ value: missingEp.toLocaleString(locale),     label: t("stat_card_missing_eps"),      color: "#e3b341" },
			{ value: missingSeason.toLocaleString(locale), label: t("stat_card_missing_seasons"),  color: "#e3b341" },
			{ value: affectedShows.toLocaleString(locale), label: t("stat_card_affected_shows"),   color: "#f0883e" },
		], SANS);
		nextY += BH + GAP;
	}

	// ── Hunting bar (conditional) ─────────────────────────────────────────────
	if (wishlist > 0) {
		const WH = 44;
		ctx.fillStyle = "#161b22";
		rr(ctx, MARGIN, nextY, rowW, WH, 10);
		ctx.fill();
		ctx.strokeStyle = "#3d2f2f";
		ctx.lineWidth = 1;
		rr(ctx, MARGIN, nextY, rowW, WH, 10);
		ctx.stroke();
		ctx.font = `13px ${SANS}`;
		ctx.fillStyle = "#8b949e";
		ctx.textAlign = "center";
		ctx.fillText(
			t("stat_card_hunting", { n: wishlist.toLocaleString(locale) }),
			W / 2, nextY + 27,
		);
	}

	// ── Footer ────────────────────────────────────────────────────────────────
	ctx.font = `12px ${SANS}`;
	ctx.fillStyle = "#30363d";
	ctx.textAlign = "center";
	ctx.fillText("media-dashboard", W / 2, H - 12);

	// ── Download ──────────────────────────────────────────────────────────────
	canvas.toBlob((blob) => {
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.download = "media-collection-stats.png";
		a.href = url;
		a.click();
		URL.revokeObjectURL(url);
	}, "image/png");
}
