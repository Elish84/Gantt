# Gantt Builder (Firebase)

## מה יש כאן
- בניית גאנט דינאמית (RTL) בדומה לעיצוב הקיים
- ניהול פרויקטים לפי משתמש (Firebase Auth)
- נושאים (Topics) + צבע
- משימות (Tasks) עם start/end או start+duration
- טבלת משימות + עריכה/מחיקה
- יצוא/יבוא CSV
- שמירה ל-Firestore

## התקנה (Firebase Console)
1) Firestore Database -> Create database
2) Authentication -> Sign-in method -> Enable Email/Password
3) Rules ל-Firestore: הדבק את הקובץ firestore.rules

## הרצה מקומית
בגלל Firebase modules (import from gstatic) צריך להריץ עם שרת סטטי:
- VSCode: Live Server
- או: python -m http.server 8080

ואז פתח:
http://localhost:8080/index.html

## מבנה נתונים ב-Firestore
users/{uid}/projects/{projectId}
שדות: name, createdAt, updatedAt, topics[], tasks[]
