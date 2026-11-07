// إعدادات Firebase — انسخها من: Firebase Console ← Project settings ← Your apps ← Web app
// هذه القيم ليست سرية؛ الحماية الحقيقية تأتي من قواعد Firestore (firestore.rules).
export const firebaseConfig = {
  apiKey: "AIzaSyCqgztIehi0CQpgUO49O6Z97HKYZg_jqL8",
  authDomain: "qb-omnis.firebaseapp.com",
  projectId: "qb-omnis",
  storageBucket: "qb-omnis.firebasestorage.app",
  messagingSenderId: "979548825680",
  appId: "1:979548825680:web:80f291e9891d609d400955",
};

// معرّف حسابك (UID) في Firebase — يظهر لك في اللوحة بعد أول تسجيل دخول.
// ضع نفس القيمة أيضاً في firestore.rules
export const ADMIN_UID = "KZFk5qzmPHXrn046WGfkcmgSygy2";

// اسم مستودع لوحة التحكم نفسها، حتى لا يظهر في القائمة ولا يُغلق بالخطأ.
export const DASHBOARD_REPO = "QB-OMNIS";
