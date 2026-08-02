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
VITE_FIREBASE_AI_MODEL=gemini-3.5-flash-lite
```

## פריסה ל-GitHub Pages

הפרויקט מוגדר לפריסה אוטומטית דרך GitHub Actions.  
הוסיפו את משתני הסביבה ב-**Settings → Secrets and variables → Actions** של ה-repo.

## זהויות והרשאות

- אין כניסת מנהל באמצעות סיסמה משותפת. מנהלים נכנסים באמצעות חשבון Firebase Authentication אישי כמו כל משתמש אחר.
- לאחר אימות הדוא״ל והסיסמה, משתמש מוסדי בוחר רק מבין המוסדות המשויכים אליו במסמך המשתמש שלו. Platform Admin נכנס באותו מסך ויכול להשאיר את בחירת המוסד ריקה.
- בחירת מוסד מוצלחת יוצרת רשומת התחברות מצומצמת תחת אותו מוסד. רק מנהל המוסד יכול לראות את 10 הרשומות האחרונות של כל איש סגל ושל עצמו; לא נשמרים סיסמה, IP, מכשיר או מיקום, והרשומות אינן ניתנות לעריכה או למחיקה מהלקוח.
- הרשאות מערכת מרכזיות מוקצות רק בצד השרת. `global_admin` דורש Firebase custom claim, וחברות במוסדות נשמרת ב-Firestore ומאומתת בשרת וב-Security Rules.
- הרשמה ציבורית מושבתת. חשבונות חדשים נוצרים בתהליך הזמנה מאושר בלבד ואינם בוחרים לעצמם תפקיד, מוסד או הרשאות.

הסיסמה המשותפת שהופיעה בעבר בקוד ובתיעוד נחשבת חשופה. יש להחליף ולבטל אותה בחשבון הישן ולבטל את כל ה-refresh tokens שלו. הסרתה מהגרסה הנוכחית אינה מוחקת אותה מהיסטוריית Git.

App Check נאכף ב־Cloud Functions. לפני שימוש בסביבת staging או production יש לרשום אפליקציית Web עם reCAPTCHA Enterprise ב־Firebase Console ולהגדיר את ה־site key כמשתנה סביבה; אין לשמור מפתחות שרת או debug tokens בריפו.

סוכן ניסוח המייל במצב ההדגמה משתמש ב־Firebase AI Logic עם Gemini Developer API, ללא Cloud Functions וללא מפתח Gemini בקוד. הוא מחזיר הצעה בלבד ואינו שולח מייל, שומר טיוטה או יוצר מעקב ללא אישור המשתמש. כדי לשמור על פרטיות במסלול החינמי, הסוכן מקבל רק את הבקשה שהמשתמש הקליד ואינו מקבל אנשי קשר, כתובות מייל, מזהי משתמשים, נתוני מוסד או מידע מהמשימה. יש להפעיל Firebase AI Logic עם Gemini Developer API ולאכוף App Check במסוף Firebase לפני השימוש. יכולת השרת המוקשחת נשמרת כאפשרות עתידית ומתועדת ב־[`functions/README.md`](functions/README.md).

## בדיקות מקומיות

```bash
npm run lint
npm --prefix functions run lint
npm run typecheck
npm run test:unit
npm run test:emulator
npm run build
```

מודל ההרשאות, ACL, תצוגת ההרשאות ותהליך ההעברה היבש מתועדים ב־[`docs/security/permissions-model.md`](docs/security/permissions-model.md). אין להריץ migration או לפרוס Functions/Rules ישירות לייצור ללא גיבוי, סביבת staging ואישור מפורש.

## בוגרים, מדדי זכאות, פורום ותמיכה

- הפיכת כיתה לבוגרים, החזרת בוגר, חישובי זכאות ואישור ידני מתבצעים רק ב־Cloud Functions ונרשמים ביומן. ה־Snapshots והתוצאות ההיסטוריות אינם נמחקים או נכתבים מחדש מהדפדפן.
- פורום בתי הספר נשמר ב־`platformForum`. במסלול Spark הקבצים המצורפים חסומים, ההודעות מוגבלות, ובקשת גישה נכתבת ישירות תחת כללים מצומצמים: מנהל מוסד מבקש עבור עובד משויך ורק Platform Admin מאשר ויוצר חברות אטומית. חברות בפורום אינה מעניקה חברות במוסד.
- ממשק Platform Admin הוא ממשק תמיכה מוגבל. הוא מציג ספריות מוסדות ואנשי צוות ופעולות תמיכה בלבד; כללי האבטחה חוסמים ממנו מידע פדגוגי ומידע אישי גם כאשר מזהה המסמך ידוע.
- פעולות Platform Admin רגישות דורשות MFA, התחברות אחרונה וסיבה כתובה. תהליך ה־bootstrap מתועד ב־[`docs/security/platform-admin-bootstrap.md`](docs/security/platform-admin-bootstrap.md).
