// سكربت الإغلاق الفوري وعدّاد الزيارات (اختياري) — يُضاف إلى المواقع الفرعية:
//   <script type="module" src="https://0-bilal.github.io/QB-OMNIS/lock.js?site=اسم-المستودع"></script>
//
// 1) عند إغلاق الموقع من اللوحة، يعرض صفحة الإغلاق فوراً لكل من يتصفح الموقع الآن،
//    إلى أن يكتمل الإغلاق الحقيقي من GitHub Pages خلال دقيقة أو دقيقتين.
// 2) يعدّ زيارة واحدة لكل جلسة تصفح، مفتوحاً (open) أو مغلقاً (closed)،
//    في المستند اليومي stats/{site}/days/{YYYY-MM-DD} (بتوقيت UTC).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, doc, onSnapshot, setDoc, increment,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=7";
import { maintenancePage } from "./maintenance-template.js?v=7";

const param = new URL(import.meta.url).searchParams.get("site");
const site = param || location.pathname.split("/").filter(Boolean)[0] || location.hostname;

/**
 * يعدّ الزيارة مرة واحدة لكل جلسة: التحديث والتنقل بين الصفحات لا يُحسبان مرة أخرى.
 * نفس المفتاح تستخدمه صفحة الإغلاق المنشورة، فلا تُحسب الزيارة المغلقة مرتين.
 * لا يرمي أي خطأ: العدّاد لا يؤثر على الموقع أبداً.
 */
function countVisit(db, state) {
  let key = "";
  try {
    if (navigator.webdriver) return;
    key = `qb-omnis:visit:${site}:${state}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1"); // نحجز المفتاح قبل الكتابة حتى لا تُحسب مرتين
  } catch { return; } // التخزين غير متاح: لا نعدّ حتى لا نهدر الحصة
  const release = () => { try { sessionStorage.removeItem(key); } catch {} };
  try {
    const day = new Date().toISOString().slice(0, 10);
    setDoc(doc(db, "stats", site, "days", day), { [state]: increment(1) }, { merge: true }).catch(release);
  } catch { release(); }
}

try {
  if (site && !String(firebaseConfig.apiKey).startsWith("YOUR_")) {
    // تطبيق باسم مستقل حتى لا يتعارض مع Firebase الخاص بالموقع نفسه إن وُجد
    const app = initializeApp(firebaseConfig, "qb-omnis-lock");
    const db = getFirestore(app);
    let shown = false;
    let first = true;

    onSnapshot(doc(db, "sites", site), (snap) => {
      try {
        const data = snap.data();
        const closed = !!data && data.enabled === false;
        // نعدّ بعد أول قراءة فقط، وللمواقع المسجّلة فقط (القواعد ترفض غيرها)
        if (first) { first = false; if (data) countVisit(db, closed ? "closed" : "open"); }
        if (closed && !shown) {
          shown = true;
          document.open();
          // بدون site: لا يُضاف عدّاد صفحة الإغلاق هنا، لأن lock.js عدّ الزيارة بنفسه
          document.write(maintenancePage({
            title: site,
            message: data.message || "",
            serviceName: data.serviceName || "",
            closedAt: data.lockedAt?.toDate?.() || null,
            headline: data.headline || "",
            returnAt: data.reason === "maintenance" ? (data.returnAt || "") : "",
          }));
          document.close();
        } else if (shown && data && data.enabled !== false) {
          location.reload();
        }
      } catch { /* لا نكسر الموقع أبداً */ }
    }, () => { /* عند فشل الاتصال يبقى الموقع كما هو */ });
  }
} catch { /* لا نكسر الموقع أبداً */ }
