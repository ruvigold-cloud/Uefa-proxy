# UEFA Proxy — הוראות פריסה

שני endpoints שמנרמלים את נתוני אופ"א עבור הדשבורד ופותרים את חסימת ה-CORS:

| נתיב | מה מחזיר | Cache |
|---|---|---|
| `/api/coefficients` | מקדמי 55 המדינות, 5 עונות לכל מדינה | 10 דק' |
| `/api/matches` | משחקי 10 הימים האחרונים בשלושת המפעלים, מנורמלים לפורמט הדשבורד | 3 דק' |

## פריסה (5 דקות)

1. התקן Vercel CLI אם אין: `npm i -g vercel`
2. מתוך תיקיית `uefa-proxy`:
   ```bash
   vercel deploy --prod
   ```
   (בפעם הראשונה — התחברות לחשבון ובחירת שם לפרויקט, למשל `uefa-proxy`)
3. קבל כתובת בסגנון `https://uefa-proxy.vercel.app`
4. בדוק בדפדפן:
   - `https://uefa-proxy.vercel.app/api/coefficients`
   - `https://uefa-proxy.vercel.app/api/matches`
5. בקובץ הדשבורד, בראש הסקריפט, מלא:
   ```js
   const PROXY_BASE = "https://uefa-proxy.vercel.app";
   ```

מרגע זה כפתור "רענון חי" מעדכן גם את הדירוג וגם את עמוד התוצאות ותרומת הקבוצות,
והחיווי בסרגל העליון יתחלף ל"חי (דירוג + משחקים)".

## אם משהו לא עובד

- **coefficients מחזיר 502** — אופ"א שינו את מבנה ה-API. פתח את
  `https://comp.uefa.com/v2/coefficients?coefficientType=MEN_ASSOCIATION&seasonYear=2027&page=1&pagesize=60&language=EN`
  בדפדפן, שלח לי את מבנה ה-JSON ואעדכן את הפרסינג.
- **matches מחזיר 502** — אותו דבר עם `match.uefa.com/v5/matches` (הנתיב הפנימי של uefa.com;
  אפשר לראות את הבקשה המדויקת ב-DevTools ‏← Network בעמוד המשחקים של uefa.com).
  הפרסינג מרוכז בקובץ אחד — הדשבורד לא מושפע משינוי שם.
- הדשבורד תמיד נופל בחן ל-snapshot המוטמע, כך שגם בתקלה שום דבר לא נשבר.

## הערות

- ה-CORS פתוח (`*`) לנוחות פיתוח; לפני שיתוף בקהילה כדאי לצמצם לדומיין שלך.
- ה-cache בקצה של Vercel שומר על מכסת הבקשות לאופ"א נמוכה גם עם הרבה משתמשים —
  אותו עיקרון בדיוק כמו ב-proxy של מחירי המניות ב-commercial-plan.

## מקורות נתונים חלופיים (חינמיים) — בעקבות הבדיקה על Flashscore

**ל-Flashscore אין API ציבורי.** האתר שייך לקבוצת Livesport והנתונים שלו מוזנים מפידים מסחריים בתשלום;
גרידה (scraping) של האתר מנוגדת לתנאי השימוש שלו ולא יציבה. במקומו, שתי חלופות חינמיות שנבדקו:

### 1. ESPN — JSON ציבורי, ללא מפתח (מומלץ כגיבוי)
```
https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions_qual/scoreboard?dates=YYYYMMDD
https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.europa_qual/scoreboard?dates=YYYYMMDD
https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.europa.conf_qual/scoreboard?dates=YYYYMMDD
```
(ולמפעלים המרכזיים: `uefa.champions`, `uefa.europa`, `uefa.europa.conf`)
מחזיר לכל משחק: קבוצות, תוצאה, סטטוס, אצטדיון ועיר. חיסרון: אין קוד מדינה (association) לקבוצות,
ולכן לצורך שיוך נקודות למדינות נדרשת טבלת מיפוי קבוצה←מדינה. ה-API של אופ"א נשאר המקור הראשי.

### 2. API-Football (api-sports.io) — חינמי עם מפתח, 100 בקשות/יום
ליגות: אלופות id=2, אירופית id=3, קונפרנס id=848 (כולל מוקדמות). מחזיר גם מדינת קבוצה.
הרשמה חינמית ב-dashboard.api-football.com, ואז:
```
GET https://v3.football.api-sports.io/fixtures?league=2&season=2026
Header: x-apisports-key: YOUR_KEY
```
עם ה-cache של Vercel (10 דק'), 100 בקשות/יום מספיקות בשפע לקהילה שלמה.
