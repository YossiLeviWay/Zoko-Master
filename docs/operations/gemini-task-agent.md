# חיבור סוכן המשימות ל-Gemini

מפתח Gemini אינו נשמר בקוד, בקובצי `VITE_*` או בדפדפן. הפונקציה
`draftTaskWithAgent` מקבלת גישה רק ל-Secret הייעודי בזמן ריצה.

1. בטלו או מחקו ב-Google AI Studio כל מפתח שנחשף בצילום מסך, בצ'אט או בלוגים.
2. צרו מפתח חדש ומוגבל לפרויקט ול-Gemini API.
3. מהשורש הריצו `firebase functions:secrets:set GEMINI_API_KEY` והדביקו את המפתח החדש בהנחיה האינטראקטיבית.
4. פרסו עם `firebase deploy --only functions:draftTaskWithAgent`.

אפשר לשנות מודל באמצעות פרמטר Cloud Functions בשם `GEMINI_TASK_MODEL`.
ברירת המחדל היא `gemini-flash-latest`. הסוכן אינו שומר משימה בעצמו; הוא מחזיר
טיוטה מובנית, והמשתמש חייב לאשר אותה במסך המשימות.
