# Zoko-Master — מערכת ניהול מוסדות חינוך

תוכנה לניהול מוסדות חינוך: צוותים, לוחות שנה, משימות, קבצים, הודעות ועוד.

## טכנולוגיות

- **React 19** + **Vite**
- **Firebase** (Authentication, Firestore, Storage)
- **React Router v7**

## התקנה מקומית

נדרש Node.js 20.19 ומעלה.

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
```

## פריסה ל-GitHub Pages

הפרויקט מוגדר לפריסה אוטומטית דרך GitHub Actions.  
הוסיפו את משתני הסביבה ב-**Settings → Secrets and variables → Actions** של ה-repo.

## יצירת מנהל מערכת

אין סיסמת מנהל שמוטמעת בקוד הלקוח. צרו משתמש Email/Password ב-Firebase
Authentication, צרו עבור אותו UID מסמך באוסף `users`, והגדירו בו
`role: "global_admin"`. מנהלים ומשתמשים נכנסים מאותו טופס התחברות.

> אם גרסה ישנה של האפליקציה כבר הייתה בשימוש, מחקו ממסמכי `users` את השדות
> `_authPassword` ו-`_pendingPassword`. גרסה זו אינה קוראת או שומרת סיסמאות
> ב-Firestore; איפוס סיסמה מתבצע באמצעות קישור האיפוס של Firebase.
> בנוסף, אפסו מיד את סיסמת חשבון המנהל הישן, מכיוון שהסיסמה הקודמת הופיעה
> בקוד ובהיסטוריית Git ולכן יש להתייחס אליה כסיסמה שנחשפה.

## בדיקות

```bash
npm run lint
npm run build
# או את שניהם יחד:
npm run check
```
