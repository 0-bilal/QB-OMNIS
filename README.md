# QB-OMNIS — لوحة التحكم بالمواقع

لوحة تتحكم في تشغيل وإطفاء مواقعك المنشورة على GitHub Pages، بتكلفة صفر.

**طريقة العمل:** عند الإطفاء، تحوّل اللوحة مصدر نشر GitHub Pages للموقع إلى فرع `maintenance` لا يحتوي إلا صفحة "الموقع مغلق حالياً". وعند التشغيل، ترجع المصدر الأصلي (فرع أو GitHub Actions) كما كان. هذا إغلاق حقيقي: ملفات الموقع لا تُرسل للزوار إطلاقاً.

## الملفات

| الملف | الوظيفة |
|---|---|
| `index.html`, `style.css`, `app.js` | لوحة التحكم |
| `firebase-config.js` | إعدادات Firebase ومعرّفك (تعدّله مرة واحدة) |
| `maintenance-template.js` | تصميم صفحة الإغلاق |
| `lock.js` | سكربت الإغلاق الفوري (اختياري) للمواقع الفرعية |
| `firestore.rules` | قواعد أمان قاعدة البيانات |

## خطوات الإعداد

### 1. إنشاء مشروع Firebase
1. افتح [console.firebase.google.com](https://console.firebase.google.com) وأنشئ مشروعاً جديداً (يمكن إيقاف Google Analytics).
2. من **Build ← Firestore Database** اضغط **Create database**، واختر موقعاً قريباً، وابدأ بـ **production mode**.
3. من **Build ← Authentication ← Get started**، فعّل مزوّد **Google**.
4. في **Authentication ← Settings ← Authorized domains** أضف: `0-bilal.github.io`
5. من **Project settings ← Your apps** اضغط أيقونة الويب `</>`، وسجّل تطبيقاً (بدون Firebase Hosting)، وانسخ قيم `firebaseConfig` إلى ملف `firebase-config.js`.

### 2. رفع اللوحة إلى GitHub
1. ارفع كل الملفات إلى مستودع `QB-OMNIS` (Add file ← Upload files).
2. في **Settings ← Pages** اختر **Deploy from a branch**، ثم `main` و `/ (root)`.
3. افتح `https://0-bilal.github.io/QB-OMNIS/`.

### 3. تحديد حسابك كمالك
1. سجّل الدخول في اللوحة بحساب Google. ستظهر رسالة "غير مصرّح" ومعها **معرّفك (UID)**.
2. ضع المعرّف في `ADMIN_UID` داخل `firebase-config.js` وارفعه من جديد.
3. ضع نفس المعرّف مكان `YOUR_ADMIN_UID` في `firestore.rules`، ثم انسخ محتوى الملف إلى **Firestore ← Rules** في Firebase واضغط **Publish**.

### 4. مفتاح GitHub
أنشئ مفتاحاً من [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new):
- **Repository access:** All repositories (أو مواقعك فقط)
- **Permissions (Read and write):** Administration، Contents، Pages، Actions
- حدّد تاريخ انتهاء

الصقه في اللوحة. يُحفظ في متصفحك فقط، **ولا ترفعه إلى GitHub أبداً**.

## الاستخدام
- **ربط بالموقع:** ينشئ فرع `maintenance` ويسجّل الموقع في Firestore.
- **إطفاء الموقع:** اكتب السبب ثم اضغط الزر. تظهر صفحة الإغلاق خلال دقيقة أو دقيقتين.
- **تحديث الرسالة:** يغيّر نص صفحة الإغلاق والموقع مغلق.
- **تشغيل الموقع:** يرجع النشر الأصلي. مواقع GitHub Actions يُعاد تشغيل آخر نشر ناجح لها تلقائياً.

> ملاحظة: GitHub يخزّن الصفحات مؤقتاً، فقد يرى بعض الزوار النسخة السابقة حتى 10 دقائق.

## الإغلاق الفوري (اختياري)
لإغلاق الموقع **فوراً** عند الزوار الحاليين، أضف هذا السطر داخل `<head>` في كل موقع فرعي، مع وضع اسم المستودع:

```html
<script type="module" src="https://0-bilal.github.io/QB-OMNIS/lock.js?site=اسم-المستودع"></script>
```

في مشاريع React/Vite ضعه في ملف `index.html` الرئيسي للمشروع.
