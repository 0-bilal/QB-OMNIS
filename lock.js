// سكربت الإغلاق الفوري وعدّاد الزيارات (اختياري) — يُضاف إلى المواقع الفرعية:
//   <script type="module" src="https://0-bilal.github.io/QB-OMNIS/lock.js?site=اسم-المستودع"></script>
//
// 1) عند إغلاق الموقع من اللوحة، يعرض صفحة الإغلاق فوراً لكل من يتصفح الموقع الآن،
//    إلى أن يكتمل الإغلاق الحقيقي من GitHub Pages خلال دقيقة أو دقيقتين.
// 2) يعدّ زيارة واحدة لكل جلسة تصفح (عدّاد يومي في Firestore تعرضه اللوحة).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, doc, onSnapshot, setDoc, increment,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=4";
import { maintenancePage } from "./maintenance-template.js?v=4";

const param = new URL(import.meta.url).searchParams.get("site");
const site = param || location.pathname.split("/").filter(Boolean)[0] || location.hostname;

/** يزيد عدّاد الزيارات مرة واحدة لكل جلسة. المفتاح اليومي = رقم اليوم منذ 1970 (UTC). */
function countVisit(db) {
  const key = `qb-omnis.visit.${site}`;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* نعدّ على أي حال */ }
  const day = `d${Math.floor(Date.now() / 86400000)}`;
  setDoc(doc(db, "visits", site), { total: increment(1), [day]: increment(1) }, { merge: true })
    .catch(() => { /* العدّاد اختياري: لا نؤثر على الموقع إن فشل */ });
}

if (site && !String(firebaseConfig.apiKey).startsWith("YOUR_")) {
  // تطبيق باسم مستقل حتى لا يتعارض مع Firebase الخاص بالموقع نفسه إن وُجد
  const app = initializeApp(firebaseConfig, "qb-omnis-lock");
  const db = getFirestore(app);
  let shown = false;
  let counted = false;

  onSnapshot(doc(db, "sites", site), (snap) => {
    const data = snap.data();
    if (data && data.enabled === false && !shown) {
      shown = true;
      document.open();
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
    } else if (!shown && !counted && data) {
      counted = true;
      countVisit(db);
    }
  }, () => { /* عند فشل الاتصال يبقى الموقع كما هو */ });
}
