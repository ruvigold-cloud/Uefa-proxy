// api/coefficients.js — Proxy למקדמי המדינות של אופ"א
// הכתובת שאומתה כעובדת: coefficientRange=OVERALL (השאר מחזירות 400).
// המפענח גנרי — מאתר לבד את רשימת המדינות, הקוד והעונות בכל מבנה תשובה.

const UEFA_BASE =
  "https://comp.uefa.com/v2/coefficients?coefficientRange=OVERALL&coefficientType=MEN_ASSOCIATION&seasonYear=2027&language=EN";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://www.uefa.com/",
  "Origin": "https://www.uefa.com",
};

// מציאת המערך הראשי (רשימת ~55 המדינות) בכל עומק
function findList(raw) {
  const q = [raw];
  while (q.length) {
    const cur = q.shift();
    if (Array.isArray(cur) && cur.length >= 20 && cur[0] && typeof cur[0] === "object")
      return cur;
    if (cur && typeof cur === "object")
      for (const v of Object.values(cur)) q.push(v);
  }
  return [];
}

// קוד מדינה: מחרוזת של 3 אותיות גדולות תחת מפתח שנשמע כמו קוד
function findCode(o) {
  const stack = [[o, 0]];
  while (stack.length) {
    const [cur, d] = stack.pop();
    if (!cur || typeof cur !== "object" || d > 3) continue;
    for (const [k, v] of Object.entries(cur)) {
      if (typeof v === "string" && /^[A-Z]{3}$/.test(v) && /code|abbr|^id$|country/i.test(k))
        return v;
      if (v && typeof v === "object") stack.push([v, d + 1]);
    }
  }
  return null;
}

// חמש עונות: מערך של 5+ ערכים מספריים (ישירים או תחת value/coefficient/points)
function findSeasons(o) {
  const stack = [[o, 0]];
  while (stack.length) {
    const [cur, d] = stack.pop();
    if (!cur || typeof cur !== "object" || d > 3) continue;
    for (const v of Object.values(cur)) {
      if (Array.isArray(v) && v.length >= 5) {
        const nums = v.map((x) =>
          typeof x === "number" ? x
          : Number(x?.value ?? x?.coefficient ?? x?.points ?? x?.totalValue ?? NaN));
        if (nums.filter(Number.isFinite).length >= 5)
          // אופ"א מחזירים מהעונה החדשה לישנה — הופכים לסדר כרונולוגי
          return nums.slice(0, 5).map((n) => (Number.isFinite(n) ? n : 0)).reverse();
      }
      if (v && typeof v === "object" && !Array.isArray(v)) stack.push([v, d + 1]);
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const countries = [];
    const seen = new Set();
    let firstRaw = null, firstList = null;

    // דפדוף: אופ"א מחזירים ~20 מדינות לעמוד — אוספים עד 4 עמודים
    for (let page = 1; page <= 6; page++) {
      const r = await fetch(`${UEFA_BASE}&pageSize=20&page=${page}`, { headers: HEADERS });
      if (!r.ok) { if (page === 1) throw new Error(`UEFA HTTP ${r.status}`); break; }
      const raw = await r.json();
      const list = findList(raw);
      if (page === 1) { firstRaw = raw; firstList = list; }
      let added = 0;
      for (const m of list) {
        const code = findCode(m);
        const seasons = findSeasons(m);
        if (!code || !seasons || seen.has(code)) continue;
        seen.add(code); added++;
        const entry = { code, seasons };
        const act = m?.member?.teamsLeft ?? m?.teamsLeft ?? m?.overallRanking?.teamsLeft;
        const tot = m?.member?.totalTeams ?? m?.totalTeams ?? m?.overallRanking?.totalTeams;
        if (Number.isFinite(act) && Number.isFinite(tot)) entry.teams = `${act}/${tot}`;
        countries.push(entry);
      }
      if (!added) break; // עמוד ריק/חוזר — סיימנו
    }

    // מצב אבחון: ?debug=1 מציג את מבנה התשובה הגולמי
    if (req.query && req.query.debug) {
      return res.status(200).json({
        topKeys: firstRaw && typeof firstRaw === "object" ? Object.keys(firstRaw) : typeof firstRaw,
        listLength: firstList ? firstList.length : 0,
        parsed: countries.length,
        firstItem: firstList ? firstList[0] : null,
      });
    }

    if (!countries.length) {
      return res.status(502).json({
        error: "parsed 0 countries",
        topKeys: firstRaw && typeof firstRaw === "object" ? Object.keys(firstRaw) : typeof firstRaw,
        firstItem: firstList ? firstList[0] : null,
      });
    }

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
    return res.status(200).json({
      updated: new Date().toISOString(),
      seasonYear: 2027,
      count: countries.length,
      countries,
    });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "" + (err.message || err) });
  }
}
