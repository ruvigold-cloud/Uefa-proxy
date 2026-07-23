// api/coefficients.js — Proxy למקדמי המדינות של אופ"א
// מחזיר JSON מנורמל: { updated, seasonYear, countries: [{ code, seasons:[5], teams? }] }
// הדשבורד קורא לזה במקום לפנות ישירות ל-comp.uefa.com (שחסום ל-CORS מדפדפן).

const UEFA_URL =
  "https://comp.uefa.com/v2/coefficients" +
  "?coefficientType=MEN_ASSOCIATION&seasonYear=2027&page=1&pagesize=60&language=EN";

export default async function handler(req, res) {
  // CORS — פתוח לכולם; אפשר לצמצם לדומיין שלך בהמשך
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const r = await fetch(UEFA_URL, {
      headers: {
        // אופ"א מחזירים 403 לבקשות ללא User-Agent סביר
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://www.uefa.com/",
        "Origin": "https://www.uefa.com",
      },
    });
    if (!r.ok) throw new Error(`UEFA HTTP ${r.status}`);
    const raw = await r.json();

    // מבנה התשובה של אופ"א השתנה בעבר — תומכים בכמה צורות
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
      // מס' קבוצות (פעילות/משתתפות) אם קיים בתשובה
      const act = m?.member?.teamsLeft ?? m?.teamsLeft;
      const tot = m?.member?.totalTeams ?? m?.totalTeams;
      if (Number.isFinite(act) && Number.isFinite(tot)) entry.teams = `${act}/${tot}`;
      countries.push(entry);
    }

    if (!countries.length) throw new Error("no countries parsed");

    // Cache בקצה של Vercel: 10 דקות + הגשה ישנה בזמן רענון
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
    return res.status(200).json({
      updated: new Date().toISOString(),
      seasonYear: 2027,
      countries,
    });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: String(err.message || err) });
  }
}
