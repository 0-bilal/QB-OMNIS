// صفحة الإغلاق التي تُنشر في فرع maintenance، وتُستخدم أيضاً في lock.js
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

export function maintenancePage({ title = "", message = "" } = {}) {
  const msg = esc(message).replace(/\n/g, "<br>");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>الموقع مغلق حالياً${title ? " · " + esc(title) : ""}</title>
<style>
  :root { --bg:#f5f6f8; --card:#fff; --text:#1b1f24; --muted:#667085; --accent:#dc2626; --ring:#fdecec; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1216; --card:#171b21; --text:#e6e9ee; --muted:#98a2b3; --accent:#f87171; --ring:#3a1717; }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center; padding: 16px;
    background: var(--bg); color: var(--text);
    font-family: "Segoe UI", Tahoma, system-ui, sans-serif; line-height: 1.7;
  }
  .card {
    max-width: 480px; width: 100%; text-align: center; background: var(--card);
    border-radius: 16px; padding: 40px 28px; box-shadow: 0 10px 30px rgba(0,0,0,.08);
  }
  .icon {
    width: 76px; height: 76px; margin: 0 auto 20px; border-radius: 50%;
    background: var(--ring); color: var(--accent); display: flex; align-items: center; justify-content: center;
  }
  h1 { margin: 0 0 12px; font-size: 1.5rem; }
  p { margin: 0; color: var(--muted); }
</style>
</head>
<body>
  <main class="card">
    <div class="icon" aria-hidden="true">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
      </svg>
    </div>
    <h1>الموقع مغلق حالياً</h1>
    <p>${msg}</p>
  </main>
</body>
</html>`;
}
