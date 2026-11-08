// QB-OMNIS — تحديث صفحة الزائر تلقائياً عند فتح الموقع، بدون Ctrl+Shift+R.
//
// المشكلة: GitHub Pages يرسل الصفحات مع Cache-Control: max-age=600، فيعرض المتصفح
// النسخة المحفوظة (صفحة الإغلاق) حتى 10 دقائق بعد فتح الموقع. كما أن GitHub يحتاج
// دقيقة تقريباً ليبني الموقع الأصلي من جديد بعد الفتح.
//
// الحل: نسأل الخادم مباشرة (cache: "reload" يتجاوز النسخة المحفوظة ويستبدلها)،
// ونكرر حتى يصبح ما يُنشر على هذا الرابط هو الموقع الأصلي، ثم نعيد تحميل الصفحة.
// يستخدمه lock.js وصفحة الإغلاق المنشورة في فرع maintenance.

/** علامة صفحة الإغلاق: الوسم الجديد، أو عدّاد الزيارات في الصفحات المنشورة قبل الإصدار 8 */
export const MAINT_MARK = /<meta name="qb-omnis" content="maintenance"|qb-omnis-visits/;

let running = false;

/**
 * ينتظر حتى يصبح ما ينشره الخادم على هذا الرابط مناسباً (isReady)، ثم يعيد تحميل الصفحة.
 * المحاولات: بعد 0 ثم 2 ثم 3 ثم 4.5 ثوانٍ… حتى 30 ثانية بين المحاولات، ولمدة 10 دقائق كحد أقصى.
 * لا يرمي أي خطأ.
 * @param {(html: string) => boolean} isReady
 */
export async function reloadWhen(isReady, { maxMs = 10 * 60 * 1000 } = {}) {
  if (running) return;
  running = true;
  const start = Date.now();
  let delay = 2000;
  try {
    while (Date.now() - start < maxMs) {
      try {
        const res = await fetch(location.href, { cache: "reload", credentials: "same-origin" });
        if (res.status < 500 && isReady(await res.text())) {
          location.reload();
          return;
        }
      } catch { /* الشبكة غير متاحة: نعيد المحاولة */ }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 30000);
    }
  } catch { /* لا نكسر الصفحة أبداً */ } finally {
    running = false;
  }
}

/** يعيد التحميل عندما يعود الموقع الأصلي (أي عندما لا تكون الصفحة المنشورة صفحة الإغلاق). */
export const reloadWhenOpen = () => reloadWhen((html) => !MAINT_MARK.test(html));
