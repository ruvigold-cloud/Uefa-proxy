// api/matches.js — Proxy למשחקי שלושת המפעלים (אלופות/אירופית/קונפרנס)
// מחזיר JSON מנורמל בדיוק בפורמט של מערך MATCHES בדשבורד:
// { updated, matches: [{ c, r, d, h:[שם,קוד], a:[שם,קוד], hs, as, pens? }] }
//
// הערה: הנתיב match.uefa.com/v5/matches הוא ה-API הפנימי של uefa.com.
// אם אופ"א ישנו אותו — זה המקום היחיד שצריך לעדכן; הדשבורד לא מושפע.

const COMP = {
  1:    { key: "cl",  he: "ליגת האלופות" },
  14:   { key: "el",  he: "הליגה האירופית" },
  2019: { key: "ecl", he: "קונפרנס ליג" },
};

// תרגום שמות סיבובים נפוצים; מחזירים אובייקט דו-לשוני {he,en}
const ROUND_HE = [
  [/first qualifying/i,  "סיבוב מקדמות ראשון"],
  [/second qualifying/i, "סיבוב מקדמות שני"],
  [/third qualifying/i,  "סיבוב מקדמות שלישי"],
  [/play-?off/i,         "שלב הפלייאוף"],
  [/league phase|group/i,"שלב הליגה"],
  [/round of 16/i,       "שמינית גמר"],
  [/quarter/i,           "רבע גמר"],
  [/semi/i,              "חצי גמר"],
  [/final/i,             "גמר"],
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
  const legN = m?.matchAttributes?.leg ?? m?.leg;
  return {
    he: LEG_HE[legN] ? `${he} • ${LEG_HE[legN]}` : he,
    en: LEG_EN[legN] ? `${raw} • ${LEG_EN[legN]}` : raw,
  };
}

function teamOf(t) {
  const name =
    t?.translations?.displayName?.EN ||
    t?.internationalName || t?.displayName || t?.name || "—";
  const code = t?.countryCode || t?.association?.id || "?";
  return [name, code];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  // חלון ברירת מחדל: 10 הימים האחרונים (המחזורים האחרונים בכל מפעל)
  const days = Math.min(Number(req.query.days) || 10, 60);
  const to = new Date();
  const from = new Date(to.getTime() - days * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);

  const url =
    "https://match.uefa.com/v5/matches" +
    `?competitionId=1,14,2019&seasonYear=2027` +
    `&utcStartDateFrom=${iso(from)}&utcStartDateTo=${iso(to)}` +
    `&status=FINISHED,LIVE&order=DESC&limit=200&offset=0`;

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://www.uefa.com/",
        "Origin": "https://www.uefa.com",
      },
    });
    if (!r.ok) throw new Error(`UEFA HTTP ${r.status}`);
    const raw = await r.json();
    const items = Array.isArray(raw) ? raw : raw?.matches || raw?.data || [];

    const matches = [];
    for (const m of items) {
      const comp = COMP[Number(m?.competition?.id ?? m?.competitionId)];
      if (!comp) continue;
      const hs = m?.score?.total?.home ?? m?.score?.regular?.home;
      const as = m?.score?.total?.away ?? m?.score?.regular?.away;
      if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
      const dt = (m?.kickOffTime?.date || m?.matchDate || "").slice(0, 10);
      const stRaw = (m?.status || "").toUpperCase();
      const st = stRaw.includes("LIVE") ? "LIVE" : stRaw.includes("FINISH") ? "FT" : null;
      const min = m?.minute?.normal ?? m?.playTime?.totalTime ?? null;
      const hId = m?.homeTeam?.id ?? m?.homeTeam?.teamId ?? null;
      const aId = m?.awayTeam?.id ?? m?.awayTeam?.teamId ?? null;
      const entry = {
        ...(hId ? { hId } : {}), ...(aId ? { aId } : {}),
        ...(st ? { st } : {}), ...(min ? { min } : {}),
        c: comp.key,
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

    if (!matches.length) throw new Error("no matches parsed");

    // Cache: 3 דקות בזמן משחקים חיים, עם הגשה ישנה ברקע
    res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=900");
    return res.status(200).json({ updated: new Date().toISOString(), matches });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: String(err.message || err) });
  }
}
