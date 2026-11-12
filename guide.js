// ═══════════════════════════════════════════════════════════════
//  QB-OMNIS — الدليل: نقل المشاريع إلى Cloudflare Pages، والسب دومين، والإيميل
//  محتوى ثابت + تفاعل بسيط (خانات المشروع، قائمة التحقق، النسخ).
//  ⚠️ هذا الملف منشور للعامة مع اللوحة: لا تضع فيه كلمات مرور أو مفاتيح أو إيميلات شخصية.
// ═══════════════════════════════════════════════════════════════

const DOMAIN = "qb-flow.com";
const GH_USER = "0-bilal";
const PROGRESS_KEY = "qb-omnis.guide";
const FIELDS_KEY = "qb-omnis.guide.fields";

const escHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// قيم تتغير حسب المشروع المختار في أعلى الدليل
const v = (k) => `<span class="g-v" data-v="${k}"></span>`;
const host = () => `<code dir="ltr">${v("sub")}.${DOMAIN}</code>`;
const repo = () => `<code dir="ltr">${v("repo")}</code>`;
const branch = () => `<code dir="ltr">${v("branch")}</code>`;
const c = (t) => `<code dir="ltr">${t}</code>`;
const path = (...parts) => `<span class="g-path">${parts.map((p) => `<b>${p}</b>`).join("<i>←</i>")}</span>`;

// صور توضيحية (مقصوصة من لقطات حقيقية أثناء نقل duo-mobile). الإطار: برتقالي = اضغط هنا، أخضر = صحيح، أحمر = خطأ.
const IMG = "guide-img/";
const fig = (file, caption, size = "") => `
  <figure class="g-fig ${size}">
    <button type="button" class="g-zoom" data-zoom="${IMG}${file}" data-cap="${escHTML(caption.replace(/<[^>]+>/g, ""))}" aria-label="تكبير الصورة">
      <img src="${IMG}${file}" alt="${escHTML(caption.replace(/<[^>]+>/g, ""))}" loading="lazy"></button>
    <figcaption>${caption}</figcaption>
  </figure>`;

const note = (kind, html) => `<div class="g-note ${kind}"><span class="g-note-i">${{ warn: "!", info: "i", ok: "✓", stop: "✕" }[kind]}</span><div>${html}</div></div>`;
const table = (head, rows) => `<div class="g-table-wrap"><table class="g-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const codeBlock = (lines) => `<div class="g-code"><pre dir="ltr">${lines}</pre><button class="btn sm g-copy" type="button" data-copy>نسخ</button></div>`;

/** خطوة في قائمة التحقق: id ثابت (يُحفظ التقدّم به) */
const step = (id, title, body = "") => `
  <li class="g-step" data-step="${id}">
    <label class="g-tick"><input type="checkbox" data-check="${id}" aria-label="تمّت: ${escHTML(title.replace(/<[^>]+>/g, ""))}"><span></span></label>
    <div class="g-step-body"><b class="g-step-title">${title}</b>${body ? `<div class="g-step-text">${body}</div>` : ""}</div>
  </li>`;
const phase = (n, title, sub, steps, id = "") => `
  <div class="g-phase" data-phase ${id ? `id="${id}"` : ""}>
    <div class="g-phase-head"><span class="g-num">${n}</span><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ""}</div>
      <span class="g-phase-count" data-count></span></div>
    <ol class="g-steps">${steps.join("")}</ol>
  </div>`;
const section = (id, iconName, title, sub, body, { open = false, checklist = false } = {}) => `
  <details class="card g-sec" id="g-${id}" ${open ? "open" : ""} ${checklist ? 'data-checklist="' + id + '"' : ""}>
    <summary class="g-sum">
      <span class="g-sum-i" data-icon="${iconName}"></span>
      <span class="g-sum-t"><b>${title}</b><small>${sub}</small></span>
      ${checklist ? `<span class="g-prog" aria-hidden="true"><span class="g-bar"><i></i></span><span class="g-pct"></span></span>` : ""}
      <span class="g-chev" aria-hidden="true"></span>
    </summary>
    <div class="g-sec-body">${body}</div>
  </details>`;

// ───────────────────────── المحتوى ─────────────────────────

function overview() {
  return `
    <p>كل مواقعك تعمل على الدومين ${c(DOMAIN)}، وكل موقع له سب دومين مثل ${c("incube." + DOMAIN)}.
      منذ 2026-11-13 ننقل المواقع من <b>GitHub Pages</b> إلى <b>Cloudflare Pages</b>، لأنه:</p>
    <ul class="g-list">
      <li>يُخفي أن الموقع على GitHub: لا يظهر ${c("github.io")} في الـ DNS، ولا ${c("Server: GitHub.com")} في الترويسات.</li>
      <li>يسمح بأن يكون الـ repo <b>خاصاً (Private)</b> مجاناً. GitHub Pages يحتاج GitHub Pro للـ repos الخاصة.</li>
      <li>مجاني: 100 مشروع، و500 نشر شهرياً، وزوار بلا حد.</li>
    </ul>
    <h4>أين تُدار كل إعدادات؟</h4>
    ${table(["ماذا تريد؟", "أين؟"], [
      ["تجديد الدومين ودفع الاشتراك", path("Namecheap", "Domain List")],
      ["أي سجل DNS (سب دومين، إيميل)", path("Cloudflare", DOMAIN, "DNS", "Records")],
      ["مشاريع Cloudflare Pages (النشر، الفروع، السب دومين)", path("Cloudflare", "Workers &amp; Pages", "اسم المشروع")],
      ["المشاريع التي ما زالت على GitHub Pages", path("GitHub", "الـ repo", "Settings", "Pages")],
      ["إغلاق وفتح المواقع", "لوحة QB-OMNIS هذه"],
      ["الإيميل (عناوين وتوجيه)", path("Cloudflare", "Email Service", "Email Routing")],
    ])}
    ${note("stop", `<b>لا تغيّر الـ DNS من Namecheap</b>، ولا تضغط <b>Change DNS Type</b> هناك. الـ Nameservers تشير إلى Cloudflare
      (${c("ben.ns.cloudflare.com")} و${c("frida.ns.cloudflare.com")})، وتغييرها يوقف كل المواقع والإيميل معاً.`)}
    <h4>كيف تختار الدليل المناسب؟</h4>
    ${table(["حالتك", "اتبع"], [
      ["مشروع منشور على GitHub Pages وتريد نقله", `<a href="#g-migrate" data-jump>نقل مشروع إلى Cloudflare Pages</a>`],
      ["مشروع جديد لم يُنشر بعد", `<a href="#g-new" data-jump>مشروع جديد بسب دومين</a>`],
      ["تريد إغلاق موقع أو فتحه أو نشر تعديل", `<a href="#g-omnis" data-jump>QB-OMNIS مع Cloudflare</a>`],
      ["شيء لا يعمل", `<a href="#g-trouble" data-jump>حل المشاكل</a>`],
    ])}`;
}

function migrate() {
  return `
    <p>هذه هي نفس الخطوات التي نقلنا بها ${c("duo-mobile." + DOMAIN)}، مع الأخطاء التي واجهناها وحلولها.
      اكتب بيانات المشروع في الخانات أعلى الدليل، فتتعبّأ الأسماء في الخطوات. ضع ✓ على كل خطوة تنتهي منها، ويُحفظ تقدّمك لكل مشروع.</p>
    <div class="g-map" role="list" aria-label="مراحل النقل">
      ${[["0", "التحضير", "GitHub"], ["1", "مشروع Pages", "Cloudflare"], ["2", "الفروع", "Cloudflare"], ["3", "السب دومين", "GitHub وCloudflare"],
        ["4", "إخفاء GitHub", "GitHub"], ["5", "QB-OMNIS", "اللوحة وCloudflare"], ["6", "التحقق", "PowerShell"]].map(([n, t, w]) =>
        `<a role="listitem" href="#g-ph${n}" data-jump class="g-map-item"><span class="g-num">${n}</span><b>${t}</b><small>${w}</small></a>`).join('<span class="g-map-arrow" aria-hidden="true">←</span>')}
    </div>
    <div class="g-legend"><span><i class="o"></i>اضغط هنا</span><span><i class="g"></i>الوضع الصحيح</span><span><i class="r"></i>خطأ أو انتبه</span>
      <span class="muted">اضغط أي صورة لتكبيرها.</span></div>
    ${note("info", `انقل المشاريع <b>على دفعات</b>: في أول 48 ساعة من الحساب يوجد حد لعدد المشاريع الجديدة. وابدأ بالمواقع المغلقة، لأن توقفها المؤقت لا يضر.`)}

    ${phase(0, "التحضير", "قبل أن تلمس أي إعداد", [
      step("prep-branch", `اعرف <u>من أي فرع</u> ينشر GitHub الموقع الآن`,
        `افتح ${path("GitHub", v("repo"), "Settings", "Pages")} واقرأ السطر <i>Your GitHub Pages site is currently being built from the … branch</i>.
        ${fig("07-github-pages.png", "السطر المحدد يذكر الفرع الذي ينشر منه GitHub. هنا <b>maintenance</b>، أي أن الموقع مغلق.", "md")}
        ${note("warn", `إذا كان الفرع ${c("maintenance")}، فالموقع <b>مغلق من QB-OMNIS</b>، وفرعه الحقيقي هو المكتوب في بطاقته بجانب «الأصلي». في <code>duo-mobile</code> كان الفرع
          ${c("maintenance")}، فنشرت Cloudflare فرع ${c("main")} وظهر المنيو الكامل للزوار. اكتب الفرع الصحيح في خانة «الفرع الذي يُنشر الآن» أعلى الدليل.`)}`),
      step("prep-type", "تأكد من نوع المشروع",
        `${table(["نوع المشروع", "Build command", "Build output directory"], [
          ["HTML وCSS وJS عادية (index.html في الجذر)", "اتركه فارغاً", "اتركه فارغاً (الجذر)"],
          ["Vite", c("npm run build"), c("dist")],
          ["Create React App", c("npm run build"), c("build")],
          ["مشروع يحتاج سيرفر (Node أو PHP أو قاعدة بيانات)", "—", "لا يعمل على Pages"],
        ])}`),
      step("prep-paths", "تأكد أن مسارات الملفات نسبية",
        `مثل ${c("css/style.css")}، وليس ${c("/" + "اسم-المشروع" + "/css/style.css")}. في Vite اجعل ${c("base: '/'")}.`),
    ], "g-ph0")}

    ${phase(1, "إنشاء مشروع Cloudflare Pages", `ينشر نسخة تجريبية على ${v("project")}.pages.dev دون أن يمس السب دومين`, [
      step("cf-create", "افتح صفحة الإنشاء", `${path("Cloudflare", "Workers &amp; Pages", "Create")}`),
      step("cf-legacy", `اضغط <u>Continue to Pages</u> وليس Continue with GitHub`,
        `ستفتح صفحة <b>Create an app</b>، وهي طريقة <b>Workers</b> ولا نريدها. أسفل المربع، بجانب <i>Need to use the legacy Pages workflow?</i>، اضغط الرابط <b>Continue to Pages</b>.
        ${fig("01-continue-to-pages.png", "لا تضغط Continue with GitHub. اضغط الرابط الصغير <b>Continue to Pages</b> في الأسفل.", "sm")}`),
      step("cf-import", "اختر الـ repo",
        `${path("Import an existing Git repository", "Get started")}، ثم الحساب ${c(GH_USER)}، ثم ${repo()}، ثم <b>Begin setup</b>.
        ${note("info", `ربط Cloudflare بحساب GitHub تم مرة واحدة، بصلاحية <b>All repositories</b>، فلا يحتاج كل مشروع ربطاً جديداً.`)}`),
      step("cf-settings", "اضبط الإعدادات",
        `${table(["الحقل", "القيمة"], [
          ["Project name", `${c(v("project"))}. يصبح الرابط ${c(v("project") + ".pages.dev")}، <b>ولا يمكن تغييره لاحقاً</b>`],
          ["Production branch", `${branch()} ⚠️ نفس الفرع من خطوة التحضير`],
          ["Framework preset", "None (للموقع العادي)"],
          ["Build command / Build output directory", "حسب جدول نوع المشروع"],
        ])}
        ${fig("02-build-settings.png", "تحقق من <b>Production branch</b> قبل الضغط. في duo-mobile كان الصحيح <b>maintenance</b> وليس main.", "md")}`),
      step("cf-deploy", "اضغط Save and Deploy", `انتظر رسالة <b>Success! Your project is deployed</b>، وتستغرق عادة أقل من دقيقة.
        ${fig("03-deploy-success.png", "نجح النشر، والرابط التجريبي بجانب الرسالة.", "md")}`),
    ], "g-ph1")}

    ${phase(2, "ضبط الفروع والتأكد من النسخة", "حتى لا يُنشر محتوى لا تريده", [
      step("br-preview", "أوقف نشر الفروع الأخرى",
        `${path("Continue to project", "Settings", "Build", "Branch control")} ← ✏️، ثم <b>Preview branch = None</b>، ثم Save.
        ${note("warn", `بدون هذه الخطوة، كل فرع آخر يُنشر على رابط معاينة عام، مثل ${c("main." + "PROJECT.pages.dev")}، فيظهر المحتوى الحقيقي لموقع مغلق.`)}
        ${fig("05-branch-control.png", "نافذة Branch control: الفرع في الأعلى، و<b>None</b> في Preview branch.", "sm")}`),
      step("br-check", `افتح ${c(v("project") + ".pages.dev")} وتأكد أن المحتوى صحيح`,
        `يجب أن يطابق ما يظهر الآن على ${host()}. وانظر في تبويب <b>Deployments</b> إلى عمود <b>Source</b>، فهو يذكر الفرع الذي نُشر.
        ${fig("04-wrong-branch.png", "❌ الخطأ الذي حدث في duo-mobile: نُشر فرع <b>main</b> (المنيو الكامل) بدلاً من maintenance.", "lg")}`),
      step("br-fix", "إن ظهر محتوى خاطئ: غيّر الفرع وأعد النشر <small>(تخطَّ الخطوة إن كان صحيحاً)</small>",
        `<ol class="g-sub">
          <li>${path("Settings", "Build", "Branch control")}: غيّر <b>Production branch</b> إلى الفرع الصحيح، ثم Save.</li>
          <li>تغيير الفرع وحده <b>لا ينشر</b>. اعمل commit صغيراً على ذلك الفرع: افتح
            ${c(`github.com/${GH_USER}/` + "REPO" + "/edit/" + "BRANCH" + "/.nojekyll")} (أو أي ملف صغير)، أضف سطراً فارغاً، ثم <b>Commit directly to the … branch</b>.</li>
          <li>في <b>Deployments</b> تأكد أن النشر الجديد من الفرع الصحيح.</li>
        </ol>`),
      step("br-delete", "احذف أي نشر خاطئ",
        `${path("Deployments", "⋯ بجانب النشر الخاطئ", "Delete deployment")}.
        ${note("warn", `كل نشر قديم يبقى متاحاً على رابط خاص به، مثل ${c("e588eabc." + "PROJECT.pages.dev")}، حتى بعد تغيير الفرع. لذلك احذف أي نشر يحتوي محتوى لا يجب أن يظهر.`)}
        ${fig("06-deployments-fixed.png", "✅ الأخضر: النشر الصحيح من maintenance. ❌ الأحمر: النشر الخاطئ من main، فاحذفه من زر <b>⋯</b> بجانبه.", "lg")}`),
    ], "g-ph2")}

    ${phase(3, "نقل السب دومين", `من هنا يتوقف ${v("sub")}.${DOMAIN} لدقائق قليلة`, [
      step("dom-gh", "احذف السب دومين من GitHub Pages",
        `${path("GitHub", v("repo"), "Settings", "Pages", "Custom domain")} ← <b>Remove</b>.
        ${note("info", `سيحذف GitHub ملف ${c("CNAME")} من الفرع بـ commit جديد، فتنشر Cloudflare مرة أخرى. هذا طبيعي، وCloudflare لا تحتاج هذا الملف.`)}`),
      step("dom-dns", "احذف سجل DNS القديم فقط",
        `${path("Cloudflare", DOMAIN, "DNS", "Records")}: احذف <b>هذا السجل فقط</b>:
        ${table(["Type", "Name", "Content"], [[c("CNAME"), c(v("sub")), c(`${GH_USER}.github.io`)]])}
        ${note("stop", `لا تحذف أي سجل آخر: سجلات MX وDKIM وSPF للإيميل، و${c("_github-pages-challenge-" + GH_USER)}، وسجلات المواقع الأخرى.`)}`),
      step("dom-add", "أضف السب دومين في مشروع Pages",
        `${path("Workers &amp; Pages", v("project"), "Custom domains", "Set up a custom domain")}، اكتب ${host()}، ثم <b>Continue</b>، ثم <b>Activate domain</b>.
        Cloudflare تنشئ سجل الـ DNS بنفسها: ${c(v("sub") + " → " + v("project") + ".pages.dev")}، وحالته <b>Proxied</b> (برتقالي)، وهذا صحيح.`),
      step("dom-active", "انتظر حتى تصبح الحالة Active", "عادةً من دقيقة إلى بضع دقائق. حدّث الصفحة بـ F5."),
    ], "g-ph3")}

    ${phase(4, "إخفاء GitHub", "", [
      step("hide-unpublish", "أوقف GitHub Pages",
        `${path("GitHub", v("repo"), "Settings", "Pages")} ← الزر الأحمر <b>Unpublish site</b>.
        بعدها يجب أن يعطي ${c(`${GH_USER}.github.io/` + "REPO" + "/")} الخطأ 404.
        ${fig("07-github-pages.png", "زر <b>Unpublish site</b> في أعلى صفحة Pages. وCustom domain في الأسفل صار فارغاً بعد المرحلة 3.", "md")}`),
      step("hide-private", "حوّل الـ repo إلى Private",
        `${path("Settings", "General", "Danger Zone", "Change visibility", "Change to private")}، ثم أكّد الخطوات.
        ${note("ok", "Cloudflare تستمر في النشر من الـ repo الخاص، فتطبيقها على GitHub يملك الصلاحية.")}
        ${fig("08-danger-zone.png", "في آخر صفحة Settings ← General: زر <b>Change visibility</b>.", "md")}`),
    ], "g-ph4")}

    ${phase(5, "ربطه بلوحة QB-OMNIS", "حتى تغلقه وتفتحه من هنا", [
      step("om-add", "أضف الموقع من الإعدادات",
        `${path("QB-OMNIS", "الإعدادات", "مواقع Cloudflare Pages", "إضافة")}:
        ${table(["الحقل", "القيمة"], [
          ["المستودع", `${repo()}. <b>تأكد من الاختيار</b>، فالنافذة تختار أول مستودع تلقائياً`],
          ["رابط الموقع", `${c("https://" + v("sub") + "." + DOMAIN)}. اكتبه <b>بعد</b> اختيار المستودع`],
          ["فرع الموقع", "الفرع الحقيقي، عادةً main"],
          ["حالة الموقع الآن", "مغلق إن كان يعرض صفحة الإغلاق، وإلا مفتوح"],
        ])}
        اضغط <b>حفظ</b>، فتنشئ اللوحة فرع ${c("live")}.
        ${fig("09-omnis-add-cf.png", "❌ انتبه: النافذة اختارت مستودعاً آخر تلقائياً (b4kierm5)، ومعه رابط github.io. غيّر <b>المستودع</b> أولاً، ثم اكتب <b>الرابط</b>.", "sm")}`),
      step("om-card", "تحقق من بطاقة الموقع",
        `يجب أن تظهر بالحالة الصحيحة، <b>وألا</b> تظهر شارة «فرع live غير موجود». وفي GitHub يجب أن يصبح للـ repo فرع اسمه ${c("live")}.
        <div class="g-figs">
          ${fig("10-omnis-card.png", "البطاقة بعد الإضافة: <b>مغلق · اشتراك منتهٍ</b>، والرابط على qb-flow.com.", "sm")}
          ${fig("11-live-branch.png", "في GitHub ظهر فرع <b>live</b>، وصار للـ repo 3 فروع.", "md")}
        </div>`),
      step("om-branch", `غيّر Production branch في Cloudflare إلى <u>live</u>`,
        `${path("Cloudflare", v("project"), "Settings", "Build", "Branch control")} ← ✏️، ثم <b>Production branch = live</b>، وAutomatic deployments ✅، وPreview = None، ثم Save.
        ${note("stop", `الترتيب مهم: أضف الموقع في QB-OMNIS <b>قبل</b> هذه الخطوة، لأن فرع ${c("live")} يجب أن يكون موجوداً أولاً.`)}
        ${fig("05-branch-control.png", `نفس نافذة المرحلة 2. اكتب هنا ${"live"} بدلاً من الفرع القديم.`, "sm")}`),
      step("om-test", "جرّب التحكم",
        `الموقع مغلق؟ اضغط <b>تعديل</b> ثم احفظ بنفس السبب. الموقع مفتوح؟ اختر ${path("⋯", "نشر آخر تحديث")}.
        بعد دقيقة، يجب أن يظهر في ${path("Cloudflare", "Deployments")} نشر <b>Production</b> من فرع ${c("live")}.
        ${fig("12-deployments-live.png", "✅ النتيجة الصحيحة: Production من فرع <b>live</b>، والسب دومين في Domains. أسطر Preview تقول «No deployment available»، وهذا صحيح.", "lg")}`),
    ], "g-ph5")}

    ${phase(6, "التحقق النهائي", "من PowerShell على جهازك", [
      step("ver-run", "شغّل الأوامر وقارن النتائج",
        `${codeBlock(`Resolve-DnsName ${v("sub")}.${DOMAIN}
(Invoke-WebRequest https://${v("sub")}.${DOMAIN}/ -UseBasicParsing).Headers.Server
try { Invoke-WebRequest https://${GH_USER}.github.io/${v("repo")}/ -UseBasicParsing | Out-Null; "github.io still up!" } catch { "github.io -> 404 OK" }`)}
        ${table(["الأمر", "النتيجة الصحيحة"], [
          ["Resolve-DnsName", "عناوين Cloudflare (104.21.x و172.67.x)، ولا يظهر github.io"],
          ["Headers.Server", c("cloudflare")],
          ["github.io", c("github.io -> 404 OK")],
        ])}`),
      step("ver-http", "افتح الموقع في المتصفح", `افتح ${c("http://" + v("sub") + "." + DOMAIN)}: يجب أن يتحول تلقائياً إلى https، وأن يظهر القفل 🔒.`),
      step("ver-doc", "حدّث ملف التوثيق", `في ${c("qb-flow-domain-setup.md")}: جدول المشاريع، وجدول سجلات DNS، وجدول حالة النقل.`),
    ], "g-ph6")}`;
}

function newProject() {
  return `
    <p>مشروع جديد يذهب مباشرة إلى Cloudflare Pages، ولا يمر بـ GitHub Pages أبداً. يمكن أن يكون الـ repo خاصاً من البداية.</p>
    <h4>قواعد اسم السب دومين</h4>
    ${table(["القاعدة", "✅ صحيح", "❌ خطأ"], [
      ["حروف إنجليزية صغيرة", c("duo-burger"), c("Duo-Burger")],
      ["الشَّرطة بدل المسافة", c("duo-burger-mobile"), c("duo burger mobile")],
      ["لا شَرطة سفلية", c("duo-burger"), c("duo_burger")],
      ["لا يبدأ ولا ينتهي بشَرطة", c("duo-burger"), c("-duo-burger-")],
      ["الطول", "حتى 63 حرفاً", "—"],
      ["أسماء محجوزة", "—", `${c("www")} و${c("mail")} و${c("_dmarc")}، وأي اسم موجود في DNS`],
    ])}
    ${note("info", `إذا كان الرابط سيُطبع أو يوضع في QR، فالاسم القصير أفضل (${c("duo." + DOMAIN)}).`)}

    ${phase(1, "المشروع", "", [
      step("n-repo", "ارفع المشروع إلى GitHub", `في repo تحت ${c(GH_USER)}. يمكن أن يكون <b>Private</b> من البداية.`),
      step("n-create", "أنشئ مشروع Cloudflare Pages",
        `${path("Workers &amp; Pages", "Create", "Continue to Pages", "Import an existing Git repository")}، ثم اختر ${repo()}، ثم <b>Begin setup</b>.
        Project name = ${c(v("project"))}، وProduction branch = ${c("main")}، وBuild حسب نوع المشروع، ثم <b>Save and Deploy</b>.`),
      step("n-preview", "أوقف الفروع الأخرى", `${path("Settings", "Build", "Branch control")}: <b>Preview branch = None</b>.`),
      step("n-check", `تأكد أن ${c(v("project") + ".pages.dev")} يعمل`),
    ])}
    ${phase(2, "السب دومين", "", [
      step("n-dnsfree", "تأكد أن الاسم غير مستخدم",
        `${path("Cloudflare", DOMAIN, "DNS", "Records")}: ابحث عن ${c(v("sub"))}. إن وجدت سجلاً قديماً بنفس الاسم، احذفه أولاً، وإلا يرفض Cloudflare الإضافة.`),
      step("n-domain", "أضف السب دومين",
        `${path("Workers &amp; Pages", v("project"), "Custom domains", "Set up a custom domain")}، اكتب ${host()}، ثم Continue، ثم Activate domain، وانتظر <b>Active</b>.`),
    ])}
    ${phase(3, "QB-OMNIS والتحقق", "", [
      step("n-omnis", "أضفه إلى QB-OMNIS ثم غيّر الفرع إلى live",
        `نفس المرحلة 5 في <a href="#g-migrate" data-jump>دليل النقل</a>: إضافة من الإعدادات (الحالة: مفتوح)، ثم Production branch = ${c("live")}.`),
      step("n-verify", "تحقق", `نفس أوامر المرحلة 6 في دليل النقل: Server = ${c("cloudflare")}، وHTTPS يعمل.`),
    ])}`;
}

function omnis() {
  return `
    <p>اللوحة كانت تغلق المواقع بتغيير مصدر GitHub Pages. مع Cloudflare لا يمكنها تغيير إعدادات Cloudflare مباشرة من المتصفح،
      فصارت تتحكم عبر <b>فرع في GitHub</b> اسمه ${c("live")}. Cloudflare تنشر منه دائماً، وكل تغيير فيه يُنشر خلال دقيقة تقريباً.</p>
    ${table(["الفرع", "ماذا فيه", "من يكتبه"], [
      [c("main"), "الموقع الحقيقي (أو الفرع الذي اخترته)", "أنت"],
      [c("maintenance"), "صفحة الإغلاق فقط (index.html و404.html)", "اللوحة"],
      [c("live"), "<b>ما يراه الزوار</b>: يشير إلى maintenance أو إلى main", "اللوحة"],
    ])}
    ${fig("10-omnis-card.png", "بطاقة موقع على Cloudflare في اللوحة. الأزرار نفسها: فتح الموقع، وتعديل، وزر ⋯ لنشر آخر تحديث.", "sm")}
    <h4>ماذا يحدث عند كل زر؟</h4>
    ${table(["الزر", "ما تفعله اللوحة"], [
      ["إغلاق الموقع", `تكتب صفحة الإغلاق في ${c("maintenance")}، ثم تجعل ${c("live")} يشير إليها`],
      ["تعديل (والموقع مغلق)", `تعيد كتابة صفحة الإغلاق، و${c("live")} يتبعها`],
      ["فتح الموقع", `تجعل ${c("live")} يشير إلى آخر commit في ${c("main")}`],
      ["⋯ ← نشر آخر تحديث", `تنقل ${c("live")} إلى آخر commit في ${c("main")} (والموقع مفتوح)`],
    ])}
    ${note("warn", `<b>تعديلاتك على ${c("main")} لا تُنشر تلقائياً.</b> بعد أي push، ستظهر في بطاقة الموقع شارة <b>«تحديث غير منشور»</b>. اضغطها لتنشر، أو اختر ⋯ ← نشر آخر تحديث.`)}
    <h4>الفرق بين مواقع GitHub ومواقع Cloudflare في اللوحة</h4>
    ${table(["", "GitHub Pages", "Cloudflare Pages"], [
      ["شارة الفرع في البطاقة", c("فرع main"), c("Cloudflare · فرع main")],
      ["الظهور في اللوحة", "تلقائي إن كان Pages مفعّلاً", "بعد إضافته من الإعدادات"],
      ["نشر تعديل جديد", "تلقائي مع كل push", "زر «نشر آخر تحديث»"],
      ["فك الربط", "يبقى في القائمة كغير مربوط", "يختفي من القائمة، فأضفه من جديد من الإعدادات"],
    ])}
    <h4>ملاحظات مهمة</h4>
    <ul class="g-list">
      <li>مفتاح GitHub في اللوحة يجب أن يملك صلاحية على المستودعات <b>الخاصة</b> (Contents وAdministration)، وإلا لن يظهر الـ repo في نافذة الإضافة.</li>
      <li>لا تحذف فرع ${c("live")} ولا ${c("maintenance")} من GitHub.</li>
      <li>لا تغيّر Production branch في Cloudflare إلى فرع غير ${c("live")}، وإلا تتوقف أزرار اللوحة عن التأثير.</li>
      <li>صفحة الإغلاق والإغلاق الفوري يحمّلان ملفات من ${c(GH_USER + ".github.io/QB-OMNIS/")}، فيظهر في كود الصفحة أن اللوحة على GitHub. لإخفاء ذلك يجب نقل اللوحة نفسها إلى Cloudflare Pages لاحقاً.</li>
    </ul>`;
}

function legacyGitHub() {
  return `
    <p>للمشاريع التي <b>لم تُنقل بعد</b> (مثل ${c("incube")}). لا تستخدم هذه الطريقة لمشروع جديد.</p>
    ${note("warn", "تحتاج أن يكون الـ repo <b>عاماً (Public)</b>، وأن يكون GitHub Pages مفعّلاً عليه.")}
    <ol class="g-sub">
      <li>${path("GitHub", "الـ repo", "Settings", "Pages")}: Source = <b>Deploy from a branch</b>، و${c("main")} و${c("/ (root)")}، ثم Save.</li>
      <li>${path("Cloudflare", DOMAIN, "DNS", "Add record")}:
        ${table(["Type", "Name", "Target", "Proxy"], [[c("CNAME"), c("اسم-السب-دومين"), c(GH_USER + ".github.io"), "<b>DNS only</b> (رمادي) ⚠️"]])}</li>
      <li>${path("GitHub", "Settings", "Pages", "Custom domain")}: اكتب السب دومين، ثم Save. سيُنشئ GitHub ملف ${c("CNAME")} في الـ repo، <b>فلا تحذفه</b>.</li>
      <li>انتظر <b>DNS check successful</b>، ثم صدور الشهادة (حتى 15 دقيقة تقريباً)، ثم فعّل <b>Enforce HTTPS</b>.</li>
    </ol>
    ${note("info", `سجل ${c("_github-pages-challenge-" + GH_USER)} (TXT) يوثّق الدومين في GitHub، ويمنع أي حساب آخر من استخدامه. يبقى ما دام أي مشروع على GitHub Pages.`)}`;
}

function dns() {
  return `
    <p>هذه السجلات في ${path("Cloudflare", DOMAIN, "DNS", "Records")}. <b>لا تحذف أياً منها</b> إلا سجل المشروع الذي تنقله.</p>
    ${table(["Name", "Type", "يشير إلى", "Proxy", "وظيفته"], [
      [c("incube"), "CNAME", c(GH_USER + ".github.io"), "DNS only", "منيو INCUBE (ما زال على GitHub Pages)"],
      [c("duo-mobile"), "CNAME", c("duo-mobile.pages.dev"), "Proxied", "منيو DUO (Cloudflare Pages). أنشأته Cloudflare تلقائياً"],
      [c("_github-pages-challenge-" + GH_USER), "TXT", "رمز التوثيق", "—", "توثيق الدومين في GitHub"],
      [c("@"), "MX ×3", c("route1/2/3.mx.cloudflare.net"), "—", "استقبال الإيميل"],
      [c("cf2024-1._domainkey"), "TXT", c("v=DKIM1; …"), "—", "توقيع الإيميل (DKIM)"],
      [c("@"), "TXT", c("v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all"), "—", "SPF"],
    ])}
    ${note("stop", `<b>سجل SPF واحد فقط.</b> لا تضف سجلاً ثانياً يبدأ بـ ${c("v=spf1")}، لأن وجود سجلين يُبطل الاثنين. لإضافة خدمة إرسال جديدة، عدّل السجل الموجود.`)}
    ${table(["نوع المشروع", "Proxy الصحيح"], [
      ["GitHub Pages", "<b>DNS only</b> (رمادي). البرتقالي يكسر شهادة HTTPS"],
      ["Cloudflare Pages", "<b>Proxied</b> (برتقالي). تضبطه Cloudflare بنفسها"],
    ])}
    ${note("info", `تجاهل اقتراحات Cloudflare مثل «Proxying is required» أو «Visitors cannot reach www».`)}`;
}

function email() {
  return `
    <p>الإيميل ${c("info@" + DOMAIN)} مجاني: Cloudflare تستقبل الرسائل وتحوّلها إلى Gmail، وGmail يرسل باسمه.</p>
    <h4>إضافة عنوان جديد (مثل ${c("support@" + DOMAIN)})</h4>
    <ol class="g-sub">
      <li><b>الاستقبال:</b> ${path("Cloudflare", "Email Service", "Email Routing", DOMAIN, "Routing rules", "Create routing rule")}:
        Email pattern = ${c("support")}، وAction = <b>Send to an email</b> ← إيميلك في Gmail.</li>
      <li><b>الإرسال باسمه:</b> ${path("Gmail", "الإعدادات", "الحسابات والاستيراد", "الإرسال من حساب", "إضافة عنوان بريد إلكتروني آخر")}:
        ${table(["الحقل", "القيمة"], [
          ["خادم SMTP", c("smtp.gmail.com")],
          ["المنفذ", `${c("587")} مع اتصال <b>TLS</b>`],
          ["اسم المستخدم", "إيميلك في Gmail"],
          ["كلمة المرور", `<b>كلمة مرور تطبيق</b> من ${c("myaccount.google.com/apppasswords")} (16 حرفاً بلا مسافات)، وليست كلمة مرور Gmail`],
        ])}
        ثم أكّد من <b>الرابط الأول</b> في رسالة Gmail. الرابط الثاني في نفس الرسالة يلغي الطلب.</li>
    </ol>
    ${note("stop", `لا تضف العنوان الجديد في <b>Destination addresses</b>. هذه القائمة لوجهة الرسائل (Gmail) فقط.`)}
    <ul class="g-list">
      <li>اختر العنوان من خانة <b>«من»</b> عند كتابة رسالة.</li>
      <li>اختبر الاستقبال من إيميل <b>آخر</b>، وليس من نفس Gmail.</li>
      <li>Catch-all معطّل عن قصد، لتجنب السبام.</li>
    </ul>`;
}

function trouble() {
  return table(["المشكلة", "السبب المحتمل", "الحل"], [
    ["المحتوى الحقيقي ظهر على pages.dev لموقع مغلق", "Production branch خاطئ", "غيّر الفرع، واعمل commit لإعادة النشر، ثم احذف النشر الخاطئ (المرحلة 2)"],
    ["رابط نشر قديم ما زال يعرض المحتوى", "كل نشر يبقى على رابط خاص به", "Deployments ← ⋯ ← Delete deployment"],
    ["تغيير الفرع في Cloudflare لم يغيّر الموقع", "تغيير الفرع لا يبدأ نشراً", "commit جديد على الفرع، أو زر «تعديل» أو «نشر آخر تحديث» في اللوحة"],
    ["الـ repo لا يظهر في نافذة «إضافة موقع Cloudflare»", "مفتاح GitHub لا يرى المستودعات الخاصة", "حدّث المفتاح بصلاحية على كل المستودعات (Contents وAdministration)"],
    ["شارة «فرع live غير موجود»", "لم تُكمل الإضافة، أو حُذف الفرع", "الإعدادات ← مواقع Cloudflare Pages ← إضافة، بنفس البيانات"],
    ["أزرار اللوحة لا تغيّر الموقع", "Production branch في Cloudflare ليس live", "Settings ← Build ← Branch control ← live"],
    ["Cloudflare ترفض إضافة السب دومين", "يوجد سجل DNS قديم بنفس الاسم", "احذف السجل القديم من DNS ثم أعد المحاولة"],
    ["الموقع لا يفتح إطلاقاً", "الـ DNS لم ينتشر بعد", "انتظر، وافحص على dnschecker.org"],
    ["404 من GitHub (مشاريع GitHub Pages)", "Custom domain غير مكتوب، أو Pages غير مفعّل", "Settings ← Pages"],
    ["Enforce HTTPS غير قابل للضغط (GitHub)", "الشهادة لم تصدر", "انتظر حتى ساعة، وإلا احذف الدومين وأعد إضافته"],
    ["حلقة تحويل أو خطأ شهادة (GitHub)", "السحابة برتقالية", "اجعلها DNS only"],
    ["الموقع بلا تنسيق أو صور", "مسارات مطلقة", "اجعل المسارات نسبية، أو عدّل base"],
    ["رسائل info@ لا تصل", "الاختبار من نفس Gmail، أو القاعدة معطّلة", "اختبر من إيميل آخر، وراجع Routing rules"],
    ["رسائلك تذهب للسبام", "SPF مكرر أو ناقص", "سجل SPF واحد فيه Google وCloudflare"],
  ]);
}

function history() {
  return `
    ${table(["التاريخ", "ما تم"], [
      ["2026-11-13", `اكتشاف أن الـ DNS في Cloudflare وليس في Namecheap، وربط ${c("incube")} بـ GitHub Pages`],
      ["2026-11-13", "توثيق الدومين في GitHub (سجل TXT للتحقق)"],
      ["2026-11-13", "حذف 9 سجلات DNS قديمة: VPS من Contabo، وCloudflare Tunnel، وZoho Mail (بعد Export احتياطي)"],
      ["2026-11-13", `إيميل ${c("info@" + DOMAIN)}: Email Routing للاستقبال، وGmail SMTP للإرسال، وتعديل SPF`],
      ["2026-11-13", "قرار النقل إلى Cloudflare Pages، لأن GitHub Pro لا يُشترى برصيد Google Play"],
      ["2026-11-13", `ربط Cloudflare بـ GitHub (All repositories)، ونقل ${c("duo-mobile")}: نشر، وتصحيح الفرع إلى maintenance، وحذف النشر الخاطئ، ونقل الدومين، وإيقاف Pages، وجعل الـ repo خاصاً`],
      ["2026-11-13", `QB-OMNIS الإصدار 10: دعم Cloudflare عبر فرع ${c("live")}، وإضافة ${c("duo-mobile")}، وتجربة ناجحة`],
      ["2026-11-13", "QB-OMNIS الإصدار 11: هذا الدليل"],
      ["2026-11-13", "QB-OMNIS الإصدار 12: صور توضيحية من خطوات نقل duo-mobile، وخريطة المراحل"],
    ])}
    <h4>ترتيب النقل القادم</h4>
    ${table(["المشروع", "الحالة"], [
      [c("duo-mobile." + DOMAIN), "✅ منقول"],
      [c("incube." + DOMAIN) + " (QB-Dine-incube)", "⏳ التالي"],
      ["باقي المشاريع", "⏳ على دفعات"],
      ["لوحة QB-OMNIS نفسها", "⏳ اختياري، لإخفاء روابط github.io من صفحة الإغلاق"],
    ])}`;
}

function reminders() {
  return `
    <ul class="g-list">
      <li>⚠️ <b>جدّد الدومين قبل 26/01/2027</b> من ${path("Namecheap", "Domain List", "Renew")}، أو فعّل Auto-Renew. إذا انتهى الدومين يتوقف كل شيء، واسترجاعه بعد فترة السماح مكلف.</li>
      <li>احذف ${c("info@" + DOMAIN)} من ${path("Email Routing", "Destination addresses")}. أُضيف بالخطأ، ووجوده لا يؤثر.</li>
      <li>(اختياري) سجل DMARC: TXT باسم ${c("_dmarc")}، والقيمة ${c("v=DMARC1; p=none;")}. لا تستخدم ${c("p=reject")} مع الإعداد الحالي.</li>
      <li>رسائل Zoho القديمة محفوظة عند Zoho، فلا تضغط «حذف المؤسسة» هناك إلا إن كنت متأكداً.</li>
    </ul>`;
}

// ───────────────────────── العرض ─────────────────────────

export function guideHTML({ repoNames = [] } = {}) {
  return `
    <div class="page-head"><div><h1>الدليل</h1>
      <p>كل ما يلزمك لنقل المشاريع إلى Cloudflare Pages، وربط السب دومين، وإدارة الإيميل، خطوة خطوة.</p></div></div>

    <section class="card card-pad g-project" aria-labelledby="g-proj-h">
      <div class="g-project-head"><h2 id="g-proj-h">المشروع الذي تعمل عليه</h2>
        <p>تتعبّأ هذه القيم في الخطوات والأوامر، ويُحفظ تقدّم قائمة التحقق لكل سب دومين على حدة.</p></div>
      <div class="g-fields">
        <div class="field"><label for="g-sub">السب دومين</label>
          <div class="g-affix" dir="ltr"><input id="g-sub" data-field="sub" autocomplete="off" spellcheck="false"><span>.${DOMAIN}</span></div></div>
        <div class="field"><label for="g-repo">اسم الـ repo</label>
          <input id="g-repo" data-field="repo" dir="ltr" list="g-repos" autocomplete="off" spellcheck="false">
          <datalist id="g-repos">${repoNames.map((n) => `<option value="${escHTML(n)}">`).join("")}</datalist></div>
        <div class="field"><label for="g-branch">الفرع الذي يُنشر الآن</label>
          <input id="g-branch" data-field="branch" dir="ltr" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label for="g-project">اسم مشروع Cloudflare</label>
          <input id="g-project" data-field="project" dir="ltr" autocomplete="off" spellcheck="false"></div>
      </div>
      <div class="g-project-foot"><span class="muted" id="g-saved"></span>
        <button class="btn sm" type="button" id="g-reset">مسح التقدّم لهذا المشروع</button></div>
    </section>

    <nav class="g-toc" aria-label="أقسام الدليل">
      <a href="#g-overview" data-jump>نظرة عامة</a>
      <a href="#g-migrate" data-jump>نقل مشروع</a>
      <a href="#g-new" data-jump>مشروع جديد</a>
      <a href="#g-omnis" data-jump>QB-OMNIS وCloudflare</a>
      <a href="#g-legacy" data-jump>GitHub Pages (قديم)</a>
      <a href="#g-dns" data-jump>سجلات DNS</a>
      <a href="#g-email" data-jump>الإيميل</a>
      <a href="#g-trouble" data-jump>حل المشاكل</a>
      <a href="#g-history" data-jump>ما تم</a>
      <a href="#g-remind" data-jump>تذكيرات</a>
    </nav>

    ${section("overview", "info", "نظرة عامة", "الصورة الكاملة وأين يُدار كل شيء", overview(), { open: true })}
    ${section("migrate", "refresh", "نقل مشروع من GitHub Pages إلى Cloudflare Pages", "7 مراحل، بنفس ترتيب نقل duo-mobile", migrate(), { checklist: true })}
    ${section("new", "plus", "مشروع جديد بسب دومين", "مباشرة على Cloudflare Pages", newProject(), { checklist: true })}
    ${section("omnis", "power", "QB-OMNIS مع Cloudflare: فرع live", "كيف تغلق وتفتح وتنشر التحديثات", omnis())}
    ${section("legacy", "branch", "سب دومين على GitHub Pages", "الطريقة القديمة، للمشاريع التي لم تُنقل", legacyGitHub())}
    ${section("dns", "globe", "سجلات DNS الحالية", "ما يجب ألا تحذفه", dns())}
    ${section("email", "messages", "الإيميل", `info@${DOMAIN} وإضافة عناوين جديدة`, email())}
    ${section("trouble", "alert", "حل المشاكل", "الأخطاء التي واجهناها وحلولها", trouble())}
    ${section("history", "clock", "ما تم حتى الآن", "سجل التغييرات على الدومين والمواقع", history())}
    ${section("remind", "hourglass", "تذكيرات", "مهام متبقية", reminders())}`;
}

const DEFAULTS = { sub: "incube", repo: "QB-Dine-incube", branch: "main", project: "" };

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, val) { try { localStorage.setItem(k, JSON.stringify(val)); } catch {} },
};

/** تكبير صورة: طبقة فوق الصفحة، تُغلق بالضغط أو Escape */
function openLightbox(src, cap = "") {
  const prev = document.activeElement;
  const box = document.createElement("div");
  box.className = "g-lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", cap || "صورة");
  box.innerHTML = `<figure><img src="${escHTML(src)}" alt="${escHTML(cap)}">${cap ? `<figcaption>${escHTML(cap)}</figcaption>` : ""}</figure>
    <button type="button" class="btn g-lb-close" aria-label="إغلاق">✕</button>`;
  const close = () => { box.remove(); document.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
  box.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(box);
  box.querySelector(".g-lb-close").focus();
}

/** يربط التفاعل بعد إدراج guideHTML في الصفحة. icon(name) لرسم أيقونات الأقسام. */
export function bindGuide(root, { icon } = {}) {
  if (icon) root.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

  const fields = { ...DEFAULTS, ...store.get(FIELDS_KEY, {}) };
  const $in = (k) => root.querySelector(`[data-field="${k}"]`);
  const val = (k) => (k === "project" ? fields.project || fields.sub : fields[k]) || DEFAULTS[k] || "";
  const progKey = () => `${PROGRESS_KEY}.${(fields.sub || "default").toLowerCase()}`;

  const fill = () => {
    root.querySelectorAll("[data-v]").forEach((el) => { el.textContent = val(el.dataset.v); });
    // النصوص المكتوبة داخل c("…REPO…") تُستبدل كذلك
    root.querySelectorAll("code").forEach((el) => {
      if (!el.dataset.tpl) {
        if (!/REPO|BRANCH|PROJECT/.test(el.textContent)) return;
        el.dataset.tpl = el.textContent;
      }
      el.textContent = el.dataset.tpl.replace(/REPO/g, val("repo")).replace(/BRANCH/g, val("branch")).replace(/PROJECT/g, val("project"));
    });
    $in("project").placeholder = fields.sub || "";
  };

  const paint = () => {
    const done = store.get(progKey(), {});
    root.querySelectorAll("[data-check]").forEach((cb) => {
      cb.checked = !!done[cb.dataset.check];
      cb.closest(".g-step").classList.toggle("done", cb.checked);
    });
    root.querySelectorAll("[data-phase]").forEach((ph) => {
      const all = ph.querySelectorAll("[data-check]"), n = [...all].filter((x) => x.checked).length;
      ph.querySelector("[data-count]").textContent = `${n} / ${all.length}`;
      ph.classList.toggle("done", n === all.length);
    });
    root.querySelectorAll("[data-checklist]").forEach((sec) => {
      const all = sec.querySelectorAll("[data-check]"), n = [...all].filter((x) => x.checked).length;
      const pct = all.length ? Math.round((n / all.length) * 100) : 0;
      sec.querySelector(".g-bar i").style.width = `${pct}%`;
      sec.querySelector(".g-pct").textContent = `${pct}%`;
    });
    const $s = root.querySelector("#g-saved");
    if ($s) $s.textContent = `التقدّم محفوظ في هذا المتصفح لـ ${fields.sub || "؟"}.${DOMAIN}`;
  };

  Object.keys(DEFAULTS).forEach((k) => {
    const el = $in(k);
    el.value = fields[k] || "";
    el.addEventListener("input", () => {
      fields[k] = k === "sub" ? el.value.trim().toLowerCase().replace(/\s+/g, "-") : el.value.trim();
      store.set(FIELDS_KEY, fields);
      fill();
      if (k === "sub") paint();
    });
  });

  root.addEventListener("change", (e) => {
    const cb = e.target.closest("[data-check]");
    if (!cb) return;
    const done = store.get(progKey(), {});
    if (cb.checked) done[cb.dataset.check] = Date.now(); else delete done[cb.dataset.check];
    store.set(progKey(), done);
    paint();
  });

  root.addEventListener("click", (e) => {
    const zoom = e.target.closest("[data-zoom]");
    if (zoom) { openLightbox(zoom.dataset.zoom, zoom.dataset.cap); return; }
    const jump = e.target.closest("[data-jump]");
    if (jump) {
      e.preventDefault();
      const target = root.querySelector(jump.getAttribute("href"));
      if (target) {
        const sec = target.closest("details");
        if (sec) sec.open = true;
        if (target.tagName === "DETAILS") target.open = true;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      const text = copy.parentElement.querySelector("pre").textContent;
      navigator.clipboard?.writeText(text).then(() => {
        copy.textContent = "تم النسخ ✓";
        setTimeout(() => { copy.textContent = "نسخ"; }, 1600);
      });
    }
  });

  root.querySelector("#g-reset").addEventListener("click", () => {
    if (!confirm(`مسح علامات ✓ لمشروع ${fields.sub}.${DOMAIN}؟`)) return;
    store.set(progKey(), {});
    paint();
  });

  fill();
  paint();
}
