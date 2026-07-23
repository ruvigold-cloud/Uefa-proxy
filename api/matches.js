// api/matches.js — Proxy למשחקי שלושת המפעלים
// מנסה כמה בסיסי-כתובת ופרמטרים עד שנמצא השילוב שאופ"א מקבלים.

const COMP_IDS = [1, 14, 2019]; // אלופות, אירופית, קונפרנס
const COMP = { 1: "cl", 14: "el", 2019: "ecl" };

const BASES = [
  "https://match.uefa.com/v5/matches",
  "https://match.uefa.com/v3/matches",
  "https://comp.uefa.com/v2/matches",
  "https://match.uefa.com/v2/matches",
];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://www.uefa.com/",
  "Origin": "https://www.uefa.com",
};

const ROUND_HE = [
  [/first qualifying/i, "סיבוב מקדמות ראשון"],
  [/second qualifying/i, "סיבוב מקדמות שני"],
  [/third qualifying/i, "סיבוב מקדמות שלישי"],
  [/play-?off/i, "שלב הפלייאוף"],
  [/league phase|group/i, "שלב הליגה"],
  [/round of 16/i, "שמינית גמר"],
  [/quarter/i, "רבע גמר"],
  [/semi/i, "חצי גמר"],
  [/final/i, "גמר"],
];
const LEG_HE = { 1: "מקצה ראשון", 2: "מקצה שני" };
const LEG_EN = { 1: "1st leg", 2: "2nd leg" };

function roundName(m) {
  const raw =
    m?.round?.translations?.name?.EN ||
    m?.round?.metaData?.name ||
    m?.round?.name || "";
  let he = raw;
  for (const [re, h] of ROUND_HE) if (re.test(raw)) { he = h; break; }
  const legN = m?.matchAttributes?.leg ?? m?.leg ?? m?.round?.leg;
  return {
    he: LEG_HE[legN] ? `${he} • ${LEG_HE[legN]}` : he,
    en: LEG_EN[legN] ? `${raw} • ${LEG_EN[legN]}` : raw,
  };
}

function teamOf(t) {
  const name =
    t?.translations?.displayName?.EN ||
    t?.internationalName || t?.displayName || t?.name || "—";
  const code = t?.countryCode || t?.association?.id || t?.teamCountryCode || "?";
  return [name, code];
}

function extractItems(raw) {
  if (Array.isArray(raw)) return raw;
  return raw?.matches || raw?.data || raw?.items || [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const days = Math.min(Number(req.query.days) || 10, 60);
  const to = new Date(Date.now() + 864e5); // עד מחר, לתפוס גם משחקי לייב של הערב
  const from = new Date(Date.now() - days * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);

  // וריאציות פרמטרים לניסיון, לכל בסיס
  const paramVariants = (cid) => [
    `?competitionId=${cid}&seasonYear=2027&utcStartDateFrom=${iso(from)}&utcStartDateTo=${iso(to)}&limit=100&offset=0`,
    `?competitionId=${cid}&seasonYear=2027&dateFrom=${iso(from)}&dateTo=${iso(to)}&limit=100&offset=0`,
    `?competitionId=${cid}&seasonYear=2027&limit=100&offset=0`,
  ];

  const attempts = [];
  let workingBase = null, workingVariant = -1;

  // שלב 1: מציאת שילוב עובד (בודקים על ליגת האלופות)
  outer:
  for (const base of BASES) {
    const variants = paramVariants(1);
    for (let vi = 0; vi < variants.length; vi++) {
      const url = base + variants[vi];
      try {
        const r = await fetch(url, { headers: HEADERS });
        if (!r.ok) { attempts.push(`${url} -> HTTP ${r.status}`); continue; }
        const raw = await r.json();
        const items = extractItems(raw);
        if (!items.length) { attempts.push(`${url} -> ok but 0 items`); continue; }
        workingBase = base; workingVariant = vi;
        attempts.push(`${url} -> OK (${items.length} items)`);
        break outer;
      } catch (err) {
        attempts.push(`${url} -> ${String(err.message || err)}`);
      }
    }
  }

  if (!workingBase) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "no working endpoint", attempts });
  }

  // שלב 2: שליפה משלושת המפעלים עם השילוב שנמצא
  const matches = [];
  let sample = null;
  for (const cid of COMP_IDS) {
    try {
      const url = workingBase + paramVariants(cid)[workingVariant];
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) continue;
      const raw = await r.json();
      for (const m of extractItems(raw)) {
        if (!sample) sample = m;
        const hs = m?.score?.total?.home ?? m?.score?.regular?.home;
        const as = m?.score?.total?.away ?? m?.score?.regular?.away;
        if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
        const dt = (m?.kickOffTime?.date || m?.matchDate || m?.date || "").slice(0, 10);
        const stRaw = (m?.status || "").toUpperCase();
        const st = stRaw.includes("LIVE") ? "LIVE" : stRaw.includes("FINISH") ? "FT" : null;
        const min = m?.minute?.normal ?? m?.playTime?.totalTime ?? null;
        const hId = m?.homeTeam?.id ?? m?.homeTeam?.teamId ?? null;
        const aId = m?.awayTeam?.id ?? m?.awayTeam?.teamId ?? null;
        const entry = {
          ...(hId ? { hId } : {}), ...(aId ? { aId } : {}),
          ...(st ? { st } : {}), ...(min ? { min } : {}),
          c: COMP[cid],
          r: roundName(m),
          d: dt ? `${dt.slice(8, 10)}.${dt.slice(5, 7)}` : "",
          h: teamOf(m?.homeTeam),
          a: teamOf(m?.awayTeam),
          hs, as,
        };
        const ph = m?.score?.penalty?.home, pa = m?.score?.penalty?.away;
        if (Number.isFinite(ph) && Number.isFinite(pa)) {
          const winner = ph > pa ? entry.h[0] : entry.a[0];
          entry.pens = {
            he: `${ph}:${pa} בפנדלים — ${winner} עלתה`,
            en: `${ph}:${pa} on penalties — ${winner} advance`,
          };
        }
        matches.push(entry);
      }
    } catch (err) { /* מפעל אחד נכשל — ממשיכים */ }
  }

  if (req.query && req.query.debug) {
    return res.status(200).json({ attempts, parsed: matches.length, sample });
  }
  if (!matches.length) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "endpoint ok but no matches parsed", attempts, sample });
  }

  res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=900");
  return res.status(200).json({ updated: new Date().toISOString(), count: matches.length, matches });
}
