// api/coefficients.js — Proxy למקדמי המדינות של אופ"א
// מנסה כמה וריאציות של כתובת ה-API עד שאחת מצליחה (הפרמטרים של אופ"א השתנו בעבר).

const CANDIDATES = [
  "https://comp.uefa.com/v2/coefficients?coefficientType=MEN_ASSOCIATION&seasonYear=2027",
  "https://comp.uefa.com/v2/coefficients?coefficientType=MEN_ASSOCIATION&seasonYear=2027&pageSize=60&page=1&language=EN",
  "https://comp.uefa.com/v2/coefficients?coefficientRange=OVERALL&coefficientType=MEN_ASSOCIATION&seasonYear=2027&language=EN",
  "https://comp.uefa.com/v2/coefficients?coefficientType=MEN_ASSOCIATION&seasonYear=2026",
];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://www.uefa.com/",
  "Origin": "https://www.uefa.com",
};

function parseCountries(raw) {
  const list =
    raw?.data?.coefficientsList ||
    raw?.coefficientsList ||
    (Array.isArray(raw?.data) ? raw.data : null) ||
    (Array.isArray(raw) ? raw : []);
  const countries = [];
  for (const m of list) {
    const code =
      m?.member?.countryCode || m?.member?.id || m?.countryCode || null;
    const per = m?.seasonCoefficients || m?.coefficients || null;
    if (!code || !Array.isArray(per) || per.length < 5) continue;
    const last5 = per.slice(-5).map((s) => {
      const v = Number(s?.value ?? s?.coefficient ?? s);
      return Number.isFinite(v) ? v : 0;
    });
    const entry = { code, seasons: last5 };
    const act = m?.member?.teamsLeft ?? m?.teamsLeft;
    const tot = m?.member?.totalTeams ?? m?.totalTeams;
    if (Number.isFinite(act) && Number.isFinite(tot)) entry.teams = `${act}/${tot}`;
    countries.push(entry);
  }
  return countries;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const attempts = [];
  for (const url of CANDIDATES) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) { attempts.push(`${url} -> HTTP ${r.status}`); continue; }
      const raw = await r.json();
      const countries = parseCountries(raw);
      if (!countries.length) { attempts.push(`${url} -> ok but 0 parsed`); continue; }
      res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
      return res.status(200).json({
        updated: new Date().toISOString(),
        seasonYear: 2027,
        source: url,
        countries,
      });
    } catch (err) {
      attempts.push(`${url} -> ${String(err.message || err)}`);
    }
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(502).json({ error: "all candidates failed", attempts });
}
