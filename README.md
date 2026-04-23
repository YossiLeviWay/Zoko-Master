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
```

## פריסה ל-GitHub Pages

הפרויקט מוגדר לפריסה אוטומטית דרך GitHub Actions.  
הוסיפו את משתני הסביבה ב-**Settings → Secrets and variables → Actions** של ה-repo.

## כניסת אדמין

סיסמת האדמין המוגדרת: `123qwe123`  
ניתן לשנות את `GLOBAL_ADMIN_PASSWORD` ב-[src/contexts/AuthContext.jsx](src/contexts/AuthContext.jsx).
