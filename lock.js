// سكربت الإغلاق الفوري (اختياري) — يُضاف إلى المواقع الفرعية:
//   <script type="module" src="https://0-bilal.github.io/QB-OMNIS/lock.js?site=اسم-المستودع"></script>
//
// عند إطفاء الموقع من اللوحة، يعرض صفحة الإغلاق فوراً لكل من يتصفح الموقع الآن،
// إلى أن يكتمل الإغلاق الحقيقي من GitHub Pages خلال دقيقة أو دقيقتين.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { maintenancePage } from "./maintenance-template.js";

const param = new URL(import.meta.url).searchParams.get("site");
const site = param || location.pathname.split("/").filter(Boolean)[0] || location.hostname;

if (site && !String(firebaseConfig.apiKey).startsWith("YOUR_")) {
  // تطبيق باسم مستقل حتى لا يتعارض مع Firebase الخاص بالموقع نفسه إن وُجد
  const app = initializeApp(firebaseConfig, "qb-omnis-lock");
  const db = getFirestore(app);
  let shown = false;

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
      }));
      document.close();
    } else if (shown && data && data.enabled !== false) {
      location.reload();
    }
  }, () => { /* عند فشل الاتصال يبقى الموقع كما هو */ });
}
