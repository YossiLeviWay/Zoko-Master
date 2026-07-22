# Zoko-Master — מערכת ניהול מוסדות חינוך

תוכנה לניהול מוסדות חינוך: צוותים, לוחות שנה, משימות, קבצים, הודעות ועוד.

## טכנולוגיות

- **React 19** + **Vite**
- **Firebase** (Authentication, Firestore, Storage)
- **React Router v7**

## התקנה מקומית

```bash
npm install
```

צרו קובץ `.env.local` בתיקיית הבסיס (ראו `.env.example`), הזינו את פרטי Firebase שלכם, ואז:

```bash
npm run dev
```

## משתני סביבה

העתיקו את `.env.example` ל-`.env.local` ומלאו את הערכים:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_FUNCTIONS_REGION=europe-west1
VITE_FIREBASE_APPCHECK_SITE_KEY=...
```

## פריסה ל-GitHub Pages

הפרויקט מוגדר לפריסה אוטומטית דרך GitHub Actions.  
הוסיפו את משתני הסביבה ב-**Settings → Secrets and variables → Actions** של ה-repo.

## זהויות והרשאות

- אין כניסת מנהל באמצעות סיסמה משותפת. מנהלים נכנסים באמצעות חשבון Firebase Authentication אישי כמו כל משתמש אחר.
- הרשאות מערכת מרכזיות מוקצות רק בצד השרת. `global_admin` דורש Firebase custom claim, וחברות במוסדות נשמרת ב-Firestore ומאומתת בשרת וב-Security Rules.
- הרשמה ציבורית מושבתת. חשבונות חדשים נוצרים בתהליך הזמנה מאושר בלבד ואינם בוחרים לעצמם תפקיד, מוסד או הרשאות.

הסיסמה המשותפת שהופיעה בעבר בקוד ובתיעוד נחשבת חשופה. יש להחליף ולבטל אותה בחשבון הישן ולבטל את כל ה-refresh tokens שלו. הסרתה מהגרסה הנוכחית אינה מוחקת אותה מהיסטוריית Git.

App Check נאכף ב־Cloud Functions. לפני שימוש בסביבת staging או production יש לרשום אפליקציית Web עם reCAPTCHA Enterprise ב־Firebase Console ולהגדיר את ה־site key כמשתנה סביבה; אין לשמור מפתחות שרת או debug tokens בריפו.
