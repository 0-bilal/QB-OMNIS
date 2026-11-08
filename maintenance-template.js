// صفحة الإغلاق التي تُنشر في فرع maintenance، وتُستخدم أيضاً في lock.js
// التصميم: شاشة مقسومة — رسالة الإغلاق (أبيض) + هوية برمجيات QB (داكن)

// ───── بيانات الناشر (عدّلها هنا عند الحاجة) ─────
const PUBLISHER = {
  name: "برمجيات QB",
  whatsappDisplay: "053-838-1612",
  whatsappLink: "https://wa.me/966538381612",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

function formatDate(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return "";
  try { return date.toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" }); }
  catch { return date.toISOString().slice(0, 10); }
}

const LOGO = `<svg class="logo" dir="ltr" role="img" aria-label="شعار ${PUBLISHER.name}" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#1f6feb"/><text x="32" y="38.4" direction="ltr" unicode-bidi="bidi-override" style="direction:ltr;unicode-bidi:bidi-override" text-anchor="middle" font-family="'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="800" font-size="17" letter-spacing="-0.5"><tspan fill="#cae8ff">&lt;</tspan><tspan fill="#ffffff">QB</tspan><tspan fill="#cae8ff">/&gt;</tspan></text></svg>`;

const FAVICON = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#1f6feb"/><g fill="none" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="#cae8ff" d="M22 21 11 32l11 11"/><path stroke="#fff" d="M37 17l-10 30"/><path stroke="#cae8ff" d="M42 21l11 11-11 11"/></g></svg>`);

const ICON = {
  lock: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  globe: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  calendar: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  info: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  chat: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
};

/**
 * @param {object} o
 * @param {string} o.title        اسم المستودع (احتياطي لاسم الخدمة)
 * @param {string} o.message      سبب الإغلاق
 * @param {string} [o.serviceName] اسم الخدمة الظاهر للزوار
 * @param {Date|string} [o.closedAt] تاريخ الإغلاق
 */
export function maintenancePage({ title = "", message = "", serviceName = "", closedAt = null } = {}) {
  const service = esc(serviceName || title);
  const msg = esc(message).replace(/\n/g, "<br>");
  const date = esc(formatDate(closedAt));
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0d1117">
<title>الموقع مغلق حالياً${service ? " · " + service : ""}</title>
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@500;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    min-height: 100vh; display: flex; flex-wrap: wrap;
    font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, system-ui, sans-serif; line-height: 1.7;
  }
  .mono { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  /* ── رسالة الإغلاق ── */
  .main {
    flex: 1.35 1 460px; min-width: 0; padding: 132px 8% 48px; background: #fff; color: #1f2328;
    display: flex; flex-direction: column; gap: 32px;
  }
  .head { display: flex; align-items: center; gap: 12px; min-height: 56px; }
  .lock {
    width: 40px; height: 40px; border-radius: 10px; flex: none; display: grid; place-items: center;
    background: #ffebe9; border: 1px solid #ffcecb; color: #d1242f;
  }
  .pill {
    display: inline-flex; align-items: center; gap: 6px; padding: 2px 12px; border-radius: 999px;
    border: 1px solid #ffcecb; background: #fff5f5; color: #cf222e; font-size: 13px; font-weight: 600;
  }
  .pill i { width: 8px; height: 8px; border-radius: 50%; background: #cf222e; }
  .body { display: flex; flex-direction: column; gap: 32px; max-width: 580px; }
  h1 { margin: 0; font-size: 48px; font-weight: 700; line-height: 1.2; letter-spacing: -.5px; }
  figure { margin: 0; display: flex; flex-direction: column; gap: 16px; }
  .quote-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .quote-mark { font-family: Georgia, "Times New Roman", serif; font-size: 72px; line-height: 1; height: 44px; color: #d0d7de; font-style: italic; }
  .service {
    display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px 6px 12px; border-radius: 999px;
    background: #f6f8fa; border: 1px solid #d0d7de; color: #656d76; font-size: 13px;
  }
  .service strong { color: #1f2328; font-size: 16px; font-weight: 700; }
  blockquote { margin: 0; font-size: 26px; font-weight: 500; line-height: 1.6; color: #1f2328; overflow-wrap: anywhere; }
  figcaption { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: #656d76; font-size: 14px; }
  figcaption .dot { width: 4px; height: 4px; border-radius: 50%; background: #d0d7de; }
  figcaption .when { display: inline-flex; align-items: center; gap: 6px; }
  .note {
    margin: auto 0 0; padding-top: 20px; border-top: 1px solid #d8dee4;
    display: flex; align-items: flex-start; gap: 8px; color: #656d76; font-size: 14px;
  }
  .note svg { flex: none; margin-top: 4px; }

  /* ── برمجيات QB ── */
  .brand {
    flex: 1 1 380px; min-width: 0; padding: 132px 6% 48px; background: #0d1117; color: #e6edf3;
    display: flex; flex-direction: column; gap: 32px; position: relative; overflow: hidden;
  }
  .brand > * { position: relative; }
  .brand .watermark {
    position: absolute; bottom: -40px; left: -30px; font-size: 220px; font-weight: 800; line-height: 1;
    color: #161b22; pointer-events: none; user-select: none; transform: rotate(-12deg);
  }
  .lockup { display: flex; align-items: center; gap: 14px; min-height: 56px; }
  .logo { width: 52px; height: 52px; flex: none; }
  .lockup b { display: block; font-size: 20px; line-height: 1.3; }
  .lockup small { display: block; color: #8d96a0; font-size: 11px; font-weight: 500; letter-spacing: 3px; direction: ltr; text-align: right; }
  .about { margin: 0; color: #9198a1; font-size: 17px; line-height: 1.8; }
  .about strong { color: #e6edf3; }
  .contact { display: flex; flex-direction: column; gap: 8px; }
  .contact > span { color: #8d96a0; font-size: 12px; font-weight: 600; }
  .wa {
    display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 0 18px; border-radius: 10px;
    border: 1px solid #2ea043; background: #238636; color: #fff; font-size: 15px; font-weight: 600; text-decoration: none;
    transition: background-color .15s;
  }
  .wa:hover { background: #2ea043; }
  .wa:focus-visible { outline: 3px solid #4493f8; outline-offset: 2px; }
  .wa .label { flex-grow: 1; }
  .wa .num { font-size: 13px; font-weight: 500; direction: ltr; }
  .copy { margin: auto 0 0; padding-top: 20px; border-top: 1px solid #21262d; color: #8d96a0; font-size: 12px; }

  /* ── الهاتف ── */
  @media (max-width: 760px) {
    body { flex-direction: column; flex-wrap: nowrap; }
    .main, .brand { flex: none; padding: 32px 24px; gap: 24px; }
    .brand { flex-grow: 1; }
    .head, .lockup { min-height: 0; }
    .lock { width: 36px; height: 36px; border-radius: 9px; }
    .body { gap: 20px; }
    h1 { font-size: 32px; line-height: 1.25; letter-spacing: -.3px; }
    figure { gap: 12px; }
    .quote-row { gap: 12px; }
    .quote-mark { font-size: 56px; height: 34px; }
    .service { padding: 4px 12px 4px 10px; font-size: 12px; }
    .service strong { font-size: 15px; }
    blockquote { font-size: 20px; }
    figcaption { font-size: 13px; gap: 6px; }
    .note { padding-top: 16px; font-size: 13px; }
    .brand .watermark { font-size: 150px; bottom: -16px; left: -59px; transform: rotate(-4deg); }
    .logo { width: 44px; height: 44px; }
    .lockup b { font-size: 18px; }
    .lockup small { font-size: 10px; }
    .about { font-size: 15px; }
    .wa { padding: 0 16px; }
    .wa .num { font-size: 12px; }
    .copy { padding-top: 16px; }
  }
</style>
</head>
<body>
  <main class="main">
    <div class="head">
      <span class="lock">${ICON.lock}</span>
      <span class="pill"><i aria-hidden="true"></i>الموقع متوقف</span>
    </div>

    <div class="body">
      <h1>تم إغلاق هذا الموقع</h1>
      <figure>
        <div class="quote-row">
          <span class="quote-mark" aria-hidden="true">”</span>
          ${service ? `<span class="service">${ICON.globe}الخدمة: <strong>${service}</strong></span>` : ""}
        </div>
        ${msg ? `<blockquote>${msg}</blockquote>` : ""}
        <figcaption>
          <span>— إدارة الموقع</span>
          ${date ? `<span class="dot" aria-hidden="true"></span><span class="when">${ICON.calendar}${date}</span>` : ""}
        </figcaption>
      </figure>
    </div>

    <p class="note">${ICON.info}<span>إذا كنت صاحب الموقع، تواصل مع مزوّد الخدمة لإعادة تشغيله.</span></p>
  </main>

  <aside class="brand">
    <span class="watermark mono" aria-hidden="true" dir="ltr">&lt;/&gt;</span>
    <div class="lockup">
      ${LOGO}
      <div><b>${PUBLISHER.name}</b><small class="mono">QB SOFTWARE</small></div>
    </div>
    <p class="about">هذا الموقع يعمل بنظام تقدّمه <strong>${PUBLISHER.name}</strong>، وقد تم إيقافه حالياً. يرجى التواصل مع الناشر للعمل على إعادة تفعيله.</p>
    <div class="contact">
      <span>تواصل مع الناشر</span>
      <a class="wa" href="${PUBLISHER.whatsappLink}" target="_blank" rel="noopener">
        ${ICON.chat}<span class="label">تواصل عبر واتساب</span><span class="num mono">${PUBLISHER.whatsappDisplay}</span>
      </a>
    </div>
    <p class="copy">© ${PUBLISHER.name} · جميع الحقوق محفوظة</p>
  </aside>
</body>
</html>`;
}
