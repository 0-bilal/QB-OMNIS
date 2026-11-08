import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, getDocs, getDoc, doc, setDoc, deleteDoc, addDoc,
  query, orderBy, limit, serverTimestamp, where, documentId, getAggregateFromServer, sum,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ADMIN_UID, DASHBOARD_REPO } from "./firebase-config.js?v=6";
import { maintenancePage } from "./maintenance-template.js?v=6";

// رقم الإصدار: يجب أن يطابق ?v= في index.html وapp.js وlock.js
const APP_VERSION = "6";

const MAINT_BRANCH = "maintenance";
const TOKEN_KEY = "qb-omnis.github-token";
const VIEW_KEY = "qb-omnis.view";
const THEME_KEY = "qb-omnis.theme";
const SORT_KEY = "qb-omnis.sort";
const DEFAULT_MESSAGE = "هذا الموقع غير متاح حالياً. نعتذر عن الإزعاج، يرجى المحاولة لاحقاً.";
// رابط سكربت الإغلاق الفوري (lock.js بجانب اللوحة على GitHub Pages)
const LOCK_SRC = new URL("lock.js", location.href).href;
const SNIPPET_RE = /[ \t]*<script[^>]*data-qb-omnis[^>]*><\/script>[ \t]*\r?\n?/gi;
const DAY_MS = 86400000;

// ───── أسباب الإغلاق الجاهزة ─────
// headline: العنوان الكبير في صفحة الإغلاق · message: الرسالة الافتراضية للزوار
const REASONS = [
  { id: "subscription", label: "انتهى اشتراك الخدمة", short: "اشتراك منتهٍ", hint: "يدعو العميل لتجديد الاشتراك", icon: "hourglass", tone: "orange",
    headline: "انتهى اشتراك هذه الخدمة",
    message: "انتهت فترة اشتراك هذه الخدمة. لإعادة تفعيلها يرجى التواصل معنا لتجديد الاشتراك." },
  { id: "unavailable", label: "الخدمة غير متاحة حالياً", short: "غير متاحة", hint: "إيقاف مؤقت دون تفاصيل", icon: "pause", tone: "neutral",
    headline: "هذه الخدمة غير متاحة حالياً",
    message: "هذه الخدمة غير متاحة حالياً. نعتذر عن الإزعاج، يرجى المحاولة لاحقاً." },
  { id: "maintenance", label: "أعمال صيانة", short: "صيانة", hint: "مع وقت العودة المتوقع", icon: "tool", tone: "accent",
    headline: "الموقع تحت الصيانة",
    message: "نقوم حالياً بأعمال صيانة لتحسين الخدمة. سنعود قريباً، شكراً لصبركم." },
  { id: "update", label: "تحديث وتطوير", short: "تحديث", hint: "نسخة جديدة قادمة", icon: "refresh", tone: "teal",
    headline: "نعمل على نسخة جديدة",
    message: "نعمل على تحديث الموقع بإصدار جديد ومزايا أفضل. سيعود الموقع للعمل قريباً." },
  { id: "admin", label: "إيقاف إداري", short: "إيقاف إداري", hint: "بانتظار إجراء من العميل", icon: "alert", tone: "danger",
    headline: "تم إيقاف الخدمة مؤقتاً",
    message: "تم إيقاف هذه الخدمة مؤقتاً. للاستفسار يرجى التواصل مع مزود الخدمة." },
  { id: "custom", label: "سبب مخصص", short: "مغلق", hint: "اكتب رسالتك بنفسك", icon: "edit", tone: "purple",
    headline: "تم إغلاق هذا الموقع", message: "" },
];
const reasonOf = (id) => REASONS.find((r) => r.id === id) || REASONS.find((r) => r.id === "custom");

// ───── التصنيفات الافتراضية (تُعدَّل من اللوحة وتُحفظ في Firestore) ─────
const DEFAULT_CATEGORIES = [
  { id: "shops", label: "متاجر" },
  { id: "business", label: "شركات ومكاتب" },
  { id: "education", label: "تعليمي" },
  { id: "tools", label: "أدوات" },
  { id: "personal", label: "شخصي" },
];
const TONES = ["accent", "purple", "teal", "orange", "neutral", "success", "danger"];
const toneVars = (tone) => ({
  accent: ["var(--accent)", "var(--accent-soft)"],
  purple: ["var(--purple)", "var(--purple-soft)"],
  teal: ["var(--teal)", "var(--teal-soft)"],
  orange: ["var(--orange)", "var(--orange-soft)"],
  success: ["var(--success)", "var(--success-soft)"],
  danger: ["var(--danger)", "var(--danger-soft)"],
  warn: ["var(--warn)", "var(--warn-soft)"],
  neutral: ["var(--fg-2)", "var(--surface-3)"],
  muted: ["var(--muted)", "var(--surface-3)"],
}[tone] || ["var(--muted)", "var(--surface-3)"]);
const toneStyle = (tone) => { const [c, cs] = toneVars(tone); return `--c:${c};--cs:${cs}`; };

const $view = document.getElementById("view");
const $user = document.getElementById("user-area");
const $toasts = document.getElementById("toasts");
const $searchArea = document.getElementById("search-area");
const $q = document.getElementById("q");

let auth, db, currentUser = null;
let sites = [];              // [{ repo, pages, record }]
const busy = new Map();      // اسم المستودع ← { label, step, total, text }
let visits = {};             // اسم المستودع ← { days, last30, prev30, total } أو { error }
let legacyVisits = {};       // العدّاد القديم visits/{site} = { total, d<يوم>: عدد } (زيارات تشغيل فقط)
let visitsAvailable = false;
let logEntries = [];
let config = { categories: DEFAULT_CATEGORIES, templates: [] };

const ui = {
  view: "sites",        // sites | templates | log | settings
  filter: "all",        // all | on | off | unlinked
  cat: "all",
  query: "",
  sort: (() => { try { return localStorage.getItem(SORT_KEY) || "visits"; } catch { return "visits"; } })(),
  mode: (() => { try { return localStorage.getItem(VIEW_KEY) || "grid"; } catch { return "grid"; } })(),
  loadedAt: null,
};

// ───────────────────────── أدوات عامة ─────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const nf = new Intl.NumberFormat("en-US");
const fmt = (n) => (n == null ? "—" : nf.format(n));

const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

/** صيغة عربية بسيطة للعدد: 1 ساعة، 2 ساعتان، 3-10 ساعات، 11+ ساعة */
function plural(n, [one, two, few, many]) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
function duration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "أقل من دقيقة";
  if (m < 60) return plural(m, ["دقيقة", "دقيقتين", "دقائق", "دقيقة"]);
  const h = Math.round(m / 60);
  if (h < 24) return plural(h, ["ساعة", "ساعتين", "ساعات", "ساعة"]);
  const d = Math.round(h / 24);
  if (d < 30) return plural(d, ["يوم", "يومين", "أيام", "يوماً"]);
  const mo = Math.round(d / 30);
  return plural(mo, ["شهر", "شهرين", "أشهر", "شهراً"]);
}
const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
function since(v) {
  const d = toDate(v);
  if (!d || isNaN(d)) return "";
  const ms = Date.now() - d.getTime();
  if (ms < 60000) return "الآن";
  return `منذ ${duration(ms)}`;
}
const fmtDate = (v) => {
  const d = toDate(v);
  if (!d || isNaN(d)) return "";
  return d.toLocaleDateString("ar-u-nu-latn", { day: "numeric", month: "short" }) + " · " +
    d.toLocaleTimeString("ar-u-nu-latn", { hour: "numeric", minute: "2-digit" });
};

// أيقونات SVG خطّية
const ICONS = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  unlink: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/><path d="M3 3l18 18"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  logout: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M14 7l5 5-5 5M19 12H9"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9a6 6 0 0 1-6 6H6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  messages: '<path d="M4 6h16M4 12h10M4 18h7"/>',
  chart: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
const icon = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

// ───────────────────────── الإشعارات ─────────────────────────

const TOAST_KIND = {
  ok: { icon: "check", tone: "success" },
  closed: { icon: "lock", tone: "danger" },
  opened: { icon: "power", tone: "success" },
  updated: { icon: "refresh", tone: "accent" },
  info: { icon: "info", tone: "accent" },
  warn: { icon: "info", tone: "warn" },
  error: { icon: "alert", tone: "danger" },
};

/**
 * toast("نص") أو toast({ title, text, kind, actions: [{label, onClick}], sticky, duration })
 * kind: ok | closed | opened | updated | info | warn | error | progress
 * يعيد كائناً فيه update({title,text,step,total}) و close()
 */
function toast(opts, legacyKind) {
  if (typeof opts === "string") opts = { title: opts, kind: legacyKind === "error" ? "error" : legacyKind === "ok" ? "ok" : "info" };
  const { title = "", text = "", kind = "info", actions = [], sticky = false } = opts;
  const ms = opts.duration ?? (kind === "error" || kind === "warn" ? 0 : 5000);
  const el = document.createElement("div");
  const k = TOAST_KIND[kind] || TOAST_KIND.info;
  el.className = `toast ${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.style.cssText = toneStyle(k.tone);
  el.innerHTML = `
    ${kind === "progress" ? '<span class="spinner light" aria-hidden="true"></span>' : `<span class="t-icon">${icon(k.icon)}</span>`}
    <div class="t-body"><b></b><span class="t-text"></span>
      ${kind === "progress" ? '<div class="t-progress"><span style="width:8%"></span></div>' : ""}
      ${actions.length ? '<div class="t-actions"></div>' : ""}</div>
    ${kind === "progress" ? "" : `<button class="t-close" aria-label="إخفاء">${icon("x")}</button>`}
    ${ms && !sticky && kind !== "progress" ? `<span class="t-timer" style="animation-duration:${ms}ms"></span>` : ""}`;
  const set = ({ title: t, text: x, step, total }) => {
    if (t != null) el.querySelector("b").textContent = t;
    if (x != null) el.querySelector(".t-text").textContent = x;
    if (step != null && total) el.querySelector(".t-progress span").style.width = `${Math.round((step / total) * 100)}%`;
  };
  set({ title, text });
  const $actions = el.querySelector(".t-actions");
  actions.forEach((a) => {
    const b = document.createElement("button");
    b.textContent = a.label;
    b.onclick = () => { close(); a.onClick?.(); };
    $actions.appendChild(b);
  });
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector(".t-close")?.addEventListener("click", close);
  if (ms && !sticky && kind !== "progress") {
    timer = setTimeout(close, ms);
    el.addEventListener("mouseenter", () => { clearTimeout(timer); el.querySelector(".t-timer")?.style.setProperty("animation-play-state", "paused"); });
    el.addEventListener("mouseleave", () => { timer = setTimeout(close, 2000); });
  }
  $toasts.appendChild(el);
  return { update: set, close };
}

// ───────────────────────── النوافذ المنبثقة ─────────────────────────

let activeModal = null;

/** يفتح نافذة منبثقة. html = محتوى .dialog. يعيد دالة الإغلاق. */
function openModal(html, { size = "", onClose } = {}) {
  closeModal();
  closeMenu();
  const prevFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="dialog ${size}" role="dialog" aria-modal="true" aria-labelledby="dlg-h">${html}</div>`;
  const close = () => {
    if (activeModal !== modal) return;
    activeModal = null;
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") { // إبقاء التركيز داخل النافذة
      const f = [...overlay.querySelectorAll("button, a[href], input, textarea, select")].filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  const modal = { overlay, close };
  activeModal = modal;
  (overlay.querySelector("[autofocus]") || overlay.querySelector("input, textarea, .btn.primary, .btn.danger, .btn.success") || overlay.querySelector("button"))?.focus();
  return modal;
}
function closeModal() { activeModal?.close(); }

const dlgHead = ({ iconName, tone, title, text, centered = false }) => `
  <div class="dlg-head ${centered ? "centered" : ""}">
    <span class="dlg-icon" style="${toneStyle(tone)}">${icon(iconName)}</span>
    <div class="dlg-title"><h2 id="dlg-h">${title}</h2>${text ? `<p>${text}</p>` : ""}</div>
    <button class="x" data-close aria-label="إغلاق النافذة">${icon("x")}</button>
  </div>`;

/** نافذة تأكيد عامة. تعيد Promise<boolean> */
function confirmDialog({ title, text = "", body = "", iconName = "info", tone = "accent", confirmLabel = "تأكيد", confirmClass = "primary" }) {
  return new Promise((resolve) => {
    let ok = false;
    const m = openModal(`
      ${dlgHead({ iconName, tone, title, text, centered: true })}
      ${body ? `<div class="dlg-body">${body}</div>` : ""}
      <div class="dlg-foot">
        <button class="btn lg grow" data-close>إلغاء</button>
        <button class="btn lg ${confirmClass}" style="flex:2" id="dlg-ok">${confirmLabel}</button>
      </div>`, { size: "sm", onClose: () => resolve(ok) });
    m.overlay.querySelector("#dlg-ok").onclick = () => { ok = true; m.close(); };
  });
}

/** نافذة إدخال نص بسيطة. تعيد Promise<string|null> */
function promptDialog({ title, label, value = "", iconName = "edit", tone = "accent", confirmLabel = "حفظ", placeholder = "" }) {
  return new Promise((resolve) => {
    let out = null;
    const m = openModal(`
      ${dlgHead({ iconName, tone, title })}
      <div class="dlg-body"><div class="field"><label for="dlg-in">${label}</label>
        <input id="dlg-in" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autofocus></div></div>
      <div class="dlg-foot"><span class="note"></span>
        <button class="btn lg" data-close>إلغاء</button>
        <button class="btn lg primary" id="dlg-ok">${confirmLabel}</button></div>`,
    { size: "sm", onClose: () => resolve(out) });
    const $in = m.overlay.querySelector("#dlg-in");
    const done = () => { out = $in.value.trim(); m.close(); };
    m.overlay.querySelector("#dlg-ok").onclick = done;
    $in.addEventListener("keydown", (e) => { if (e.key === "Enter") done(); });
    $in.select();
  });
}

// ───────────────────────── GitHub API ─────────────────────────

async function gh(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${getToken()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function ghAll(path) {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = await gh(`${path}${sep}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

const isLocked = (s) => s.pages?.build_type === "legacy" && s.pages?.source?.branch === MAINT_BRANCH;

function describeSource(pages) {
  if (!pages) return "غير معروف";
  if (pages.build_type === "workflow") return "GitHub Actions";
  const src = pages.source || {};
  return `فرع ${src.branch}${src.path && src.path !== "/" ? " " + src.path : ""}`;
}

function originalConfig(pages) {
  if (pages.build_type === "workflow") return { build_type: "workflow" };
  return { build_type: "legacy", source: { branch: pages.source.branch, path: pages.source.path || "/" } };
}

/** ينشئ/يحدّث فرع maintenance ليحتوي صفحة الإغلاق فقط (فرع مستقل بلا تاريخ). */
async function writeMaintenanceBranch(owner, name, message, page = {}) {
  const html = maintenancePage({ title: name, message, ...page, site: name }); // site: عدّاد زيارات الإغلاق
  const files = [["index.html", html], ["404.html", html], [".nojekyll", "\n"]];
  const tree = await gh(`/repos/${owner}/${name}/git/trees`, {
    method: "POST",
    body: { tree: files.map(([path, content]) => ({ path, mode: "100644", type: "blob", content })) },
  });
  const commit = await gh(`/repos/${owner}/${name}/git/commits`, {
    method: "POST",
    body: { message: "QB-OMNIS: صفحة الإغلاق", tree: tree.sha, parents: [] },
  });
  try {
    await gh(`/repos/${owner}/${name}/git/refs/heads/${MAINT_BRANCH}`, {
      method: "PATCH", body: { sha: commit.sha, force: true },
    });
  } catch (e) {
    if (e.status !== 404 && e.status !== 422) throw e;
    await gh(`/repos/${owner}/${name}/git/refs`, {
      method: "POST", body: { ref: `refs/heads/${MAINT_BRANCH}`, sha: commit.sha },
    });
  }
}

async function requestPagesBuild(owner, name) {
  try { await gh(`/repos/${owner}/${name}/pages/builds`, { method: "POST" }); } catch { /* اختياري */ }
}

/** بعد إرجاع النشر إلى GitHub Actions نعيد تشغيل آخر عملية نشر ناجحة حتى يعود المحتوى. */
async function redeployWorkflow(owner, name, branch) {
  const runs = await gh(`/repos/${owner}/${name}/actions/runs?status=success&branch=${encodeURIComponent(branch)}&per_page=30`);
  const run = runs.workflow_runs.find((r) => !String(r.path || "").startsWith("dynamic/"));
  if (!run) return "لم أجد عملية نشر سابقة. شغّل workflow النشر يدوياً من تبويب Actions.";
  try {
    await gh(`/repos/${owner}/${name}/actions/runs/${run.id}/rerun`, { method: "POST" });
    return "";
  } catch {
    try {
      await gh(`/repos/${owner}/${name}/actions/workflows/${run.workflow_id}/dispatches`, {
        method: "POST", body: { ref: branch },
      });
      return "";
    } catch {
      return "تعذّر إعادة النشر تلقائياً. شغّل workflow النشر يدوياً من تبويب Actions أو ارفع أي تعديل.";
    }
  }
}

// ───────────────────────── الإغلاق الفوري ─────────────────────────

const snippetFor = (name) =>
  `<script type="module" data-qb-omnis src="${LOCK_SRC}?site=${encodeURIComponent(name)}"></script>`;

function b64ToText(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function addSnippet(html, name) {
  const tag = snippetFor(name);
  const m = html.match(/<head(\s[^>]*)?>/i);
  if (m) {
    const i = m.index + m[0].length;
    return `${html.slice(0, i)}\n  ${tag}${html.slice(i)}`;
  }
  return `${tag}\n${html}`;
}

/**
 * يضيف (أو يزيل) سطر سكربت الإغلاق الفوري في ملفات HTML بالمستودع، في commit واحد.
 * - النشر من فرع: كل ملفات ‎.html في مجلد النشر.
 * - GitHub Actions: ملف index.html الرئيسي (Vite) أو public/index.html (Create React App).
 */
async function setInstantLock(s, enable) {
  const owner = s.repo.owner.login, name = s.repo.name;
  const cfg = originalConfig(s.pages);
  const workflow = cfg.build_type === "workflow";
  const branch = workflow ? s.repo.default_branch : cfg.source.branch;
  const srcPath = workflow ? "/" : (cfg.source.path || "/");
  const base = srcPath === "/" ? "" : srcPath.replace(/^\/|\/$/g, "") + "/";

  const ref = await gh(`/repos/${owner}/${name}/git/ref/heads/${branch}`);
  const head = await gh(`/repos/${owner}/${name}/git/commits/${ref.object.sha}`);
  const { tree } = await gh(`/repos/${owner}/${name}/git/trees/${head.tree.sha}?recursive=1`);
  const blobs = tree.filter((t) => t.type === "blob");

  let targets;
  if (workflow) {
    const entry = blobs.find((t) => t.path === "index.html") || blobs.find((t) => t.path === "public/index.html");
    targets = entry ? [entry] : [];
  } else {
    targets = blobs.filter((t) => t.path.startsWith(base) && /\.html?$/i.test(t.path) && !/(^|\/)node_modules\//.test(t.path));
  }
  if (!targets.length) throw new Error("لم أجد ملف index.html في المستودع");
  if (targets.length > 150) throw new Error(`عدد ملفات HTML كبير جداً (${targets.length})`);

  const changes = [];
  for (const t of targets) {
    const blob = await gh(`/repos/${owner}/${name}/git/blobs/${t.sha}`);
    const html = b64ToText(blob.content);
    const has = /data-qb-omnis/i.test(html);
    let next = null;
    if (enable && !has) next = addSnippet(html, name);
    if (!enable && has) next = html.replace(SNIPPET_RE, "");
    if (next !== null && next !== html) changes.push({ path: t.path, mode: t.mode, type: "blob", content: next });
  }

  if (changes.length) {
    const newTree = await gh(`/repos/${owner}/${name}/git/trees`, {
      method: "POST", body: { base_tree: head.tree.sha, tree: changes },
    });
    const commit = await gh(`/repos/${owner}/${name}/git/commits`, {
      method: "POST",
      body: {
        message: enable ? "QB-OMNIS: تفعيل الإغلاق الفوري" : "QB-OMNIS: إزالة الإغلاق الفوري",
        tree: newTree.sha, parents: [head.sha],
      },
    });
    await gh(`/repos/${owner}/${name}/git/refs/heads/${branch}`, { method: "PATCH", body: { sha: commit.sha } });
  }
  await saveRecord(name, { instant: enable });
  return { count: changes.length, branch };
}

// ───────────────────────── Firestore ─────────────────────────

const saveRecord = (name, data) => setDoc(doc(db, "sites", name), data, { merge: true });
const saveConfig = (data) => setDoc(doc(db, "meta", "config"), data, { merge: true });

async function addLog(entry) {
  const item = { ...entry, at: new Date() };
  logEntries.unshift(item);
  logEntries = logEntries.slice(0, 50);
  try { await addDoc(collection(db, "log"), { ...entry, at: serverTimestamp() }); } catch { /* السجل اختياري */ }
}

async function loadExtras() {
  const [vSnap, lSnap, cSnap] = await Promise.allSettled([
    getDocs(collection(db, "visits")),
    getDocs(query(collection(db, "log"), orderBy("at", "desc"), limit(50))),
    getDoc(doc(db, "meta", "config")),
  ]);
  legacyVisits = vSnap.status === "fulfilled" ? Object.fromEntries(vSnap.value.docs.map((d) => [d.id, d.data()])) : {};
  logEntries = lSnap.status === "fulfilled" ? lSnap.value.docs.map((d) => d.data()) : [];
  if (cSnap.status === "fulfilled" && cSnap.value.exists()) {
    const c = cSnap.value.data();
    config = {
      categories: Array.isArray(c.categories) && c.categories.length ? c.categories : DEFAULT_CATEGORIES,
      templates: Array.isArray(c.templates) ? c.templates : [],
    };
  }
}

// ───── الزيارات: stats/{site}/days/{YYYY-MM-DD} = { open, closed } بتوقيت UTC ─────
// القراءة لكل موقع مربوط: آخر 14 مستنداً يومياً + 3 استعلامات تجميع (sum) ≈ 17 قراءة كحد أقصى.

const dayKey = (ago = 0) => new Date(Date.now() - ago * DAY_MS).toISOString().slice(0, 10);
const num = (x) => Number(x) || 0;

async function loadSiteVisits(name) {
  const days = collection(db, "stats", name, "days");
  const range = (from, to) => query(days,
    ...(from ? [where(documentId(), ">=", from)] : []),
    ...(to ? [where(documentId(), "<=", to)] : []));
  const agg = (q) => getAggregateFromServer(q, { open: sum("open"), closed: sum("closed") })
    .then((r) => ({ open: num(r.data().open), closed: num(r.data().closed) }));
  const [recent, last30, prev30, total] = await Promise.all([
    getDocs(range(dayKey(13))), agg(range(dayKey(29))), agg(range(dayKey(59), dayKey(30))), agg(days),
  ]);
  const byDay = Object.fromEntries(recent.docs.map((d) => [d.id, { open: num(d.data().open), closed: num(d.data().closed) }]));
  return { days: byDay, last30, prev30, total };
}

async function loadVisits(names) {
  const results = await Promise.allSettled(names.map(loadSiteVisits));
  visits = {};
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") visits[names[i]] = r.value;
    else { failed++; visits[names[i]] = { error: true }; }
  });
  // إن فشلت كل المواقع فغالباً قواعد Firestore الجديدة لم تُنشر بعد
  visitsAvailable = !names.length || failed < names.length;
}

// ───────────────────────── العمليات ─────────────────────────

const isLinked = (s) => !!s.record?.owner;

async function linkSite(s) {
  const owner = s.repo.owner.login, name = s.repo.name;
  await writeMaintenanceBranch(owner, name, DEFAULT_MESSAGE, { serviceName: s.record?.serviceName || "" });
  await saveRecord(name, {
    owner, repo: name,
    enabled: !isLocked(s),
    message: s.record?.message || DEFAULT_MESSAGE,
    pagesUrl: s.pages?.html_url || null,
    linkedAt: serverTimestamp(),
  });
}

/**
 * @param {object} page { message, serviceName, reason, returnAt }
 * @param {(step:number, text:string)=>void} onStep
 */
async function lockSite(s, { message, serviceName = "", reason = "custom", returnAt = "" }, onStep = () => {}) {
  const owner = s.repo.owner.login, name = s.repo.name;
  const alreadyLocked = isLocked(s);
  const headline = reasonOf(reason).headline;
  if (reason !== "maintenance") returnAt = "";
  // تاريخ الإغلاق: يبقى تاريخ أول إغلاق عند تحديث الرسالة فقط
  const closedAt = (alreadyLocked && s.record?.lockedAt?.toDate?.()) || new Date();
  // 1) Firestore أولاً: يُغلق الموقع فوراً عند الزوار (إن كان الإغلاق الفوري مفعّلاً)،
  //    ونحفظ الإعداد الأصلي قبل تغييره حتى نستطيع استرجاعه دائماً
  onStep(1, "حفظ الحالة الجديدة");
  await saveRecord(name, {
    enabled: false, message, serviceName, reason, returnAt, headline, owner, repo: name,
    ...(alreadyLocked ? {} : { original: originalConfig(s.pages), lockedAt: serverTimestamp() }),
  });
  // 2) الإغلاق الحقيقي على GitHub Pages
  try {
    onStep(2, "كتابة صفحة الإغلاق");
    await writeMaintenanceBranch(owner, name, message, { serviceName, closedAt, headline, returnAt });
    if (!alreadyLocked) {
      onStep(3, "تحويل مصدر النشر");
      await gh(`/repos/${owner}/${name}/pages`, {
        method: "PUT", body: { build_type: "legacy", source: { branch: MAINT_BRANCH, path: "/" } },
      });
    }
    await requestPagesBuild(owner, name);
  } catch (e) {
    if (!alreadyLocked) await saveRecord(name, { enabled: true }).catch(() => {});
    throw e;
  }
}

async function unlockSite(s, { redeploy = true } = {}, onStep = () => {}) {
  const owner = s.repo.owner.login, name = s.repo.name;
  const orig = s.record?.original || { build_type: "legacy", source: { branch: s.repo.default_branch, path: "/" } };
  let note = "";
  onStep(1, "إرجاع مصدر النشر الأصلي");
  if (orig.build_type === "workflow") {
    await gh(`/repos/${owner}/${name}/pages`, { method: "PUT", body: { build_type: "workflow" } });
    if (redeploy) {
      onStep(2, "إعادة تشغيل آخر عملية نشر");
      note = await redeployWorkflow(owner, name, s.repo.default_branch);
    } else {
      note = "لم تُعد عملية النشر. شغّل workflow النشر يدوياً من تبويب Actions.";
    }
  } else {
    await gh(`/repos/${owner}/${name}/pages`, { method: "PUT", body: { build_type: "legacy", source: orig.source } });
    onStep(2, "طلب إعادة البناء");
    await requestPagesBuild(owner, name);
  }
  onStep(3, "حفظ الحالة");
  await saveRecord(name, { enabled: true, unlockedAt: serverTimestamp() });
  return note;
}

// ───────────────────────── تحميل البيانات ─────────────────────────

async function loadSites() {
  $searchArea.hidden = true;
  $view.innerHTML = loadingView("جارٍ جلب المستودعات من GitHub…");
  try {
    const repos = await ghAll("/user/repos?affiliation=owner&sort=updated");
    const withPages = repos.filter((r) => r.has_pages && r.name !== DASHBOARD_REPO);
    const [snap] = await Promise.all([getDocs(collection(db, "sites")), loadExtras()]);
    const records = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    const linked = withPages.map((r) => r.name).filter((n) => records[n]?.owner);
    const visitsLoaded = loadVisits(linked).catch(() => { visitsAvailable = false; });
    sites = await Promise.all(withPages.map(async (repo) => {
      let pages = null;
      try { pages = await gh(`/repos/${repo.owner.login}/${repo.name}/pages`); }
      catch (e) { if (e.status !== 404) throw e; }
      return { repo, pages, record: records[repo.name] || null };
    }));
    await visitsLoaded;
    sites = sites.filter((s) => s.pages);
    ui.loadedAt = new Date();
    renderSites();
  } catch (e) {
    if (e.status === 401) {
      setToken("");
      toast({ kind: "error", title: "مفتاح GitHub غير صالح", text: "المفتاح منتهي أو غير صحيح. أدخل مفتاحاً جديداً." });
      renderTokenForm();
      return;
    }
    $view.innerHTML = panel({
      iconName: "alert", tone: "danger", title: "تعذّر تحميل المواقع",
      body: `<p class="center muted">${esc(e.message)}</p><button class="btn primary lg block" id="retry">${icon("refresh")} إعادة المحاولة</button>`,
    });
    document.getElementById("retry").onclick = loadSites;
  }
}

async function refreshOne(name) {
  const s = sites.find((x) => x.repo.name === name);
  if (!s) return;
  try { s.pages = await gh(`/repos/${s.repo.owner.login}/${name}/pages`); } catch {}
  const d = await getDoc(doc(db, "sites", name));
  s.record = d.exists() ? d.data() : null;
}

// ───────────────────────── بيانات العرض ─────────────────────────

function stateOf(s) {
  if (busy.has(s.repo.name)) return "busy";
  if (!isLinked(s)) return "unlinked";
  return isLocked(s) ? "off" : "on";
}

function categoryOf(s) {
  const id = s.record?.category;
  const i = config.categories.findIndex((c) => c.id === id);
  if (i < 0) return { id: "none", label: "بلا تصنيف", tone: "muted" };
  return { ...config.categories[i], tone: TONES[i % TONES.length] };
}

const today = () => Math.floor(Date.now() / DAY_MS);
/**
 * إحصاءات موقع واحد: { today, week, total } كل منها { open, closed, all }،
 * و last30 / prev30 / bars (14 يوماً) للمجموع. يُدمج العدّاد القديم (visits/{site}) كزيارات تشغيل.
 * يرجع null إن لم تُسجَّل أي زيارة بعد.
 */
function visitStats(name) {
  const v = visits[name];
  const old = legacyVisits[name];
  if ((!v || v.error) && !old) return null;
  const t = today();
  const oldDay = (i) => num(old?.[`d${t - i}`]);
  const newDay = (i) => v?.days?.[dayKey(i)] || { open: 0, closed: 0 };
  const day = (i) => { const d = newDay(i); return { open: d.open + oldDay(i), closed: d.closed }; };
  const pack = (open, closed) => ({ open, closed, all: open + closed });
  const span = (n) => {
    let open = 0, closed = 0;
    for (let i = 0; i < n; i++) { const d = day(i); open += d.open; closed += d.closed; }
    return pack(open, closed);
  };
  let old30 = 0, oldPrev = 0;
  for (let i = 0; i < 30; i++) { old30 += oldDay(i); oldPrev += oldDay(i + 30); }
  const total = pack(num(v?.total?.open) + num(old?.total), num(v?.total?.closed));
  if (!total.all) return null;
  const d0 = day(0);
  return {
    today: pack(d0.open, d0.closed),
    week: span(7),
    total,
    last30: num(v?.last30?.open) + num(v?.last30?.closed) + old30,
    prev30: num(v?.prev30?.open) + num(v?.prev30?.closed) + oldPrev,
    bars: Array.from({ length: 14 }, (_, k) => { const d = day(13 - k); return d.open + d.closed; }),
  };
}

/** جدول صغير: زيارات التشغيل والإغلاق لليوم و7 أيام والإجمالي */
function visitTable(s, stats) {
  if (!isLinked(s)) return "";
  if (visits[s.repo.name]?.error && !stats) {
    return `<p class="v-note">${icon("alert", "sm")}تعذّر جلب الزيارات. انشر قواعد Firestore الجديدة.</p>`;
  }
  const hint = s.record?.instant ? "" : `<p class="v-note">${icon("zap", "sm")}زيارات التشغيل تحتاج تفعيل الإغلاق الفوري</p>`;
  if (!stats) return `<p class="v-note">${icon("chart", "sm")}لا توجد زيارات مسجّلة بعد</p>${hint}`;
  const row = (label, cls, k) => `
    <span class="vk"><i class="dot ${cls}"></i>${label}</span>
    <b>${fmt(stats.today[k])}</b><b>${fmt(stats.week[k])}</b><b>${fmt(stats.total[k])}</b>`;
  return `
    <div class="vtable" role="group" aria-label="الزيارات حسب حالة الموقع">
      <span></span><span class="vh">اليوم</span><span class="vh">7 أيام</span><span class="vh">الإجمالي</span>
      ${row("مفتوح", "on", "open")}
      ${row("مغلق", "off", "closed")}
    </div>${hint}`;
}

function visitSummary(stats) {
  if (!stats) return "لا توجد زيارات بعد";
  return `اليوم ${fmt(stats.today.all)} · 7 أيام ${fmt(stats.week.all)} · الإجمالي ${fmt(stats.total.all)}`;
}
function visitTitle(stats) {
  if (!stats) return "";
  const f = (k) => `مفتوح ${fmt(stats[k].open)} / مغلق ${fmt(stats[k].closed)}`;
  return `اليوم: ${f("today")}\n7 أيام: ${f("week")}\nالإجمالي: ${f("total")}`;
}

const serviceOf = (s) => s.record?.serviceName || s.repo.name;
const letterOf = (s) => (serviceOf(s).trim().charAt(0) || "؟").toUpperCase();

function counts(list = sites) {
  const off = list.filter(isLocked).length;
  return {
    all: list.length,
    on: list.length - off,
    off,
    unlinked: list.filter((s) => !isLinked(s)).length,
    instant: list.filter((s) => s.record?.instant).length,
  };
}

function byCategory() {
  return sites.filter((s) => ui.cat === "all" || categoryOf(s).id === ui.cat);
}

function filteredSites() {
  const q = ui.query.trim().toLowerCase();
  const list = byCategory().filter((s) => {
    if (ui.filter === "on" && isLocked(s)) return false;
    if (ui.filter === "off" && !isLocked(s)) return false;
    if (ui.filter === "unlinked" && isLinked(s)) return false;
    if (q && ![s.repo.name, serviceOf(s), s.pages?.html_url, categoryOf(s).label].some((x) => String(x || "").toLowerCase().includes(q))) return false;
    return true;
  });
  const v30 = (s) => visitStats(s.repo.name)?.last30 ?? -1;
  const sorters = {
    visits: (a, b) => v30(b) - v30(a),
    updated: (a, b) => new Date(b.repo.pushed_at || 0) - new Date(a.repo.pushed_at || 0),
    name: (a, b) => serviceOf(a).localeCompare(serviceOf(b), "ar"),
  };
  return list.sort(sorters[ui.sort] || sorters.visits);
}

// ───────────────────────── أجزاء الواجهة ─────────────────────────

function loadingView(text) {
  return `<div class="loading-screen"><span class="spinner"></span>${esc(text)}</div>`;
}

/** صندوق للشاشات المستقلة (الدخول، المفتاح، الأخطاء) */
function panel({ iconName, tone = "accent", title, body }) {
  return `
    <div class="panel"><div class="card">
      ${iconName ? `<div class="panel-icon" style="${toneStyle(tone)};color:var(--c);background:var(--cs)">${icon(iconName)}</div>` : ""}
      <h2 class="center">${title}</h2>
      ${body}
    </div></div>`;
}

function pillFor(s) {
  const st = stateOf(s);
  if (st === "busy") return `<span class="pill busy"><span class="spinner" aria-hidden="true"></span>جارٍ التنفيذ</span>`;
  if (st === "unlinked") return `<span class="pill warn">غير مربوط</span>`;
  if (st === "off") return `<span class="pill off"><i class="dot off"></i>مغلق${s.record?.reason && s.record.reason !== "custom" ? ` · ${esc(reasonOf(s.record.reason).short)}` : ""}</span>`;
  return `<span class="pill on"><i class="dot on"></i>يعمل</span>`;
}

function sparkHTML(s, stats) {
  const st = stateOf(s);
  const bars = stats ? stats.bars : Array(14).fill(0);
  const max = Math.max(1, ...bars);
  const cls = !stats || st === "unlinked" || st === "busy" ? "idle" : st === "off" ? "off" : "";
  return `<div class="spark ${cls}" aria-hidden="true">${bars.map((b) =>
    `<span style="height:${Math.max(5, Math.round((b / max) * 100))}%"></span>`).join("")}</div>`;
}

function siteActions(s, { compact = false } = {}) {
  const name = esc(s.repo.name);
  const st = stateOf(s);
  const grow = compact ? "" : "grow";
  let main = "";
  if (st === "busy") {
    const b = busy.get(s.repo.name);
    main = `<button class="btn ${grow}" disabled><span class="spinner" aria-hidden="true"></span>${esc(b?.label || "جارٍ التنفيذ…")}</button>`;
  } else if (st === "unlinked") {
    main = `<button class="btn primary ${grow}" data-act="link" data-name="${name}">${icon("link", "sm")}ربط بالموقع</button>`;
  } else if (st === "off") {
    main = `<button class="btn success ${grow}" data-act="unlock" data-name="${name}">${icon("power", "sm")}فتح الموقع</button>
      ${compact ? "" : `<button class="btn" data-act="update" data-name="${name}">${icon("edit", "sm")}تعديل</button>`}`;
  } else {
    main = `<button class="btn danger ${grow}" data-act="lock" data-name="${name}">${icon("power", "sm")}إغلاق الموقع</button>`;
  }
  const url = s.pages?.html_url;
  return `${main}
    ${url && !compact ? `<a class="btn icon-btn" href="${esc(url)}" target="_blank" rel="noopener" aria-label="زيارة الموقع" title="زيارة الموقع">${icon("external", "sm")}</a>` : ""}
    <button class="btn icon-btn" data-act="menu" data-name="${name}" aria-label="خيارات أخرى لـ ${esc(serviceOf(s))}" aria-haspopup="menu" title="خيارات أخرى">${icon("more", "sm fill")}</button>`;
}

function siteCard(s) {
  const name = s.repo.name;
  const st = stateOf(s);
  const cat = categoryOf(s);
  const stats = visitStats(name);
  const url = s.pages?.html_url || "";
  const source = st === "off"
    ? `الأصلي: ${s.record?.original ? describeSource(s.record.original) : "غير محفوظ"}`
    : describeSource(s.pages);

  let note = "";
  if (st === "busy") {
    const b = busy.get(name);
    note = `<div class="site-note busy">${icon("clock", "sm")}<span>${b.total ? `الخطوة ${b.step} من ${b.total}: ` : ""}${esc(b.text || "")}</span></div>`;
  } else if (st === "off") {
    const r = reasonOf(s.record?.reason);
    const label = s.record?.reason ? r.label : "مغلق";
    const when = since(s.record?.lockedAt);
    const ret = s.record?.reason === "maintenance" && s.record?.returnAt ? ` · العودة المتوقعة ${esc(s.record.returnAt)}` : "";
    note = `<div class="site-note">${icon("lock", "sm")}<span><b>${esc(label)}</b>${when ? ` · ${esc(when)}` : ""}${ret}</span></div>`;
  }

  const visitsSub = stats ? `اليوم: ${fmt(stats.today.all)}` : "لا توجد زيارات بعد";

  return `
    <article class="site" data-site="${esc(name)}">
      <div class="site-body">
        <div class="site-top">
          <span class="tile" style="${toneStyle(cat.tone)}">${esc(letterOf(s))}</span>
          <div class="site-name">
            <h3 title="${esc(serviceOf(s))}">${esc(serviceOf(s))}</h3>
            ${url ? `<a class="site-url" href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : ""}
          </div>
          ${pillFor(s)}
        </div>
        <div class="chips">
          <button class="chip chip-btn" data-act="category" data-name="${esc(name)}" title="تغيير التصنيف"><span class="swatch" style="${toneStyle(cat.tone)}"></span>${esc(cat.label)}</button>
          <span class="chip">${icon("branch")}${esc(source)}</span>
          ${s.record?.instant ? `<span class="chip warn">${icon("zap")}فوري</span>` : ""}
          ${s.repo.private ? `<span class="chip">${icon("lock")}خاص</span>` : ""}
        </div>
        <div class="visits">
          <div>
            <span class="v-label">زيارات 30 يوماً</span>
            <b>${stats ? fmt(stats.last30) : "—"}</b>
            <span class="v-label">${visitsSub}</span>
          </div>
          <div style="${toneStyle(cat.tone)}">${sparkHTML(s, stats)}</div>
        </div>
        ${visitTable(s, stats)}
      </div>
      ${note}
      <div class="site-foot">${siteActions(s)}</div>
    </article>`;
}

function siteRow(s) {
  const cat = categoryOf(s);
  const stats = visitStats(s.repo.name);
  return `
    <div class="row-item" data-site="${esc(s.repo.name)}">
      <span class="tile sm" style="${toneStyle(cat.tone)}">${esc(letterOf(s))}</span>
      <div class="row-main">
        <b>${esc(serviceOf(s))}</b>
        <span>${esc(cat.label)} · <span title="${esc(visitTitle(stats))}">${isLinked(s) ? visitSummary(stats) : "لا توجد بيانات زيارات"}</span> · <span dir="ltr">${esc(s.repo.name)}</span></span>
      </div>
      ${pillFor(s)}
      <div class="row-actions">${siteActions(s, { compact: true })}</div>
    </div>`;
}

const LOG_STYLE = {
  close: ["lock", "danger"], open: ["power", "success"], update: ["edit", "accent"],
  link: ["link", "accent"], unlink: ["unlink", "neutral"], instant: ["zap", "warn"],
  category: ["tag", "purple"], service: ["edit", "neutral"],
};
function logItem(e) {
  const [ic, tone] = LOG_STYLE[e.type] || ["info", "neutral"];
  return `
    <div class="log-item">
      <span class="log-mark" style="${toneStyle(tone)}">${icon(ic)}</span>
      <div class="log-text"><b>${esc(e.title)}</b>${e.detail ? ` <span>— ${esc(e.detail)}</span>` : ""}</div>
      <span class="log-when" title="${esc(fmtDate(e.at))}">${esc(since(e.at))}</span>
    </div>`;
}

// ───────────────────────── الشاشات ─────────────────────────

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  renderUser();
}

function renderUser() {
  const themeBtn = `<button class="btn icon-btn" id="theme" aria-label="تبديل المظهر" title="تبديل المظهر">${icon(currentTheme() === "dark" ? "sun" : "moon")}</button>`;
  if (!currentUser) {
    $user.innerHTML = themeBtn;
  } else {
    const u = currentUser;
    $user.innerHTML = `${themeBtn}
      <button class="btn user-chip" id="user-menu" aria-haspopup="menu" aria-label="الحساب">
        ${u.photoURL ? `<img src="${esc(u.photoURL)}" alt="">` : `<span class="avatar-letter">${esc((u.displayName || u.email || "؟").charAt(0))}</span>`}
        <span class="name">${esc(u.displayName || u.email || "")}</span>
      </button>`;
    document.getElementById("user-menu").onclick = (e) => {
      openMenu(e.currentTarget, `
        <button data-menu="token">${icon("key")}مفتاح GitHub</button>
        <button data-menu="settings">${icon("settings")}الإعدادات</button>
        <hr>
        <button data-menu="logout" class="danger-text">${icon("logout")}تسجيل الخروج</button>`, {
        token: renderTokenForm,
        settings: () => go("settings"),
        logout: () => signOut(auth),
      });
    };
  }
  document.getElementById("theme").onclick = toggleTheme;
}

function renderSetupNeeded() {
  $view.innerHTML = panel({
    iconName: "settings",
    title: "الإعداد غير مكتمل",
    body: `<p>افتح ملف <code>firebase-config.js</code> وضع إعدادات مشروع Firebase الخاص بك، ثم ارفع الملف من جديد.</p>
      <p class="muted">الخطوات الكاملة موجودة في ملف <code>README.md</code>.</p>`,
  });
}

function renderSignIn() {
  $searchArea.hidden = true;
  $view.innerHTML = panel({
    iconName: "lock",
    title: "تسجيل الدخول إلى QB-OMNIS",
    body: `<p class="muted center">هذه اللوحة خاصة بمالكها فقط.</p>
      <button class="btn primary lg block" id="login">${icon("user")} الدخول بحساب Google</button>`,
  });
  document.getElementById("login").onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { toast({ kind: "error", title: "فشل تسجيل الدخول", text: e.message }); }
  };
}

function renderNotAdmin() {
  $searchArea.hidden = true;
  $view.innerHTML = panel({
    iconName: "alert", tone: "warn",
    title: "هذا الحساب غير مصرّح له",
    body: `<p>إذا كان هذا حسابك وتقوم بالإعداد الآن، انسخ المعرّف التالي وضعه في
        <code>ADMIN_UID</code> داخل <code>firebase-config.js</code> وفي <code>firestore.rules</code>:</p>
      <div class="row" style="flex-wrap:nowrap"><input class="ltr" id="uid" readonly value="${esc(currentUser.uid)}" aria-label="المعرّف">
        <button class="btn" id="copy-uid">${icon("copy")} نسخ</button></div>`,
  });
  document.getElementById("copy-uid").onclick = () => {
    navigator.clipboard?.writeText(currentUser.uid).then(() => toast({ kind: "ok", title: "تم نسخ المعرّف" }));
  };
}

function renderTokenForm() {
  closeModal();
  $searchArea.hidden = true;
  $view.innerHTML = panel({
    iconName: "key",
    title: "مفتاح GitHub",
    body: `<p>تحتاج اللوحة مفتاح <b>Fine-grained token</b> لتتحكم بإعدادات GitHub Pages.
        المفتاح يُحفظ في هذا المتصفح فقط ولا يُرسل إلى أي مكان غير GitHub.</p>
      <ol>
        <li>افتح <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">إنشاء مفتاح جديد</a>.</li>
        <li><b>Repository access:</b> All repositories (أو اختر مواقعك فقط).</li>
        <li><b>Permissions</b> (Read and write): Administration، Contents، Pages، Actions.</li>
        <li>حدّد تاريخ انتهاء، ثم انسخ المفتاح والصقه هنا.</li>
      </ol>
      <div class="field"><label for="token">المفتاح</label>
        <input class="ltr" id="token" type="password" placeholder="github_pat_…" autocomplete="off"></div>
      <div class="row">
        <button class="btn primary lg" id="save-token">حفظ ومتابعة</button>
        ${getToken() ? `<button class="btn lg" id="cancel-token">إلغاء</button><button class="btn lg danger-text" id="clear-token">${icon("trash")} حذف المفتاح المحفوظ</button>` : ""}
      </div>`,
  });
  const $token = document.getElementById("token");
  $token.focus();
  $token.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("save-token").click(); });
  document.getElementById("save-token").onclick = async () => {
    const t = $token.value.trim();
    if (!t) return;
    setToken(t);
    try {
      const me = await gh("/user");
      toast({ kind: "ok", title: "تم الاتصال بـ GitHub", text: `الحساب: ${me.login}` });
      renderUser();
      loadSites();
    } catch (e) {
      setToken("");
      toast({ kind: "error", title: "المفتاح غير صالح", text: e.message });
    }
  };
  const cancel = document.getElementById("cancel-token");
  if (cancel) cancel.onclick = loadSites;
  const clear = document.getElementById("clear-token");
  if (clear) clear.onclick = () => { setToken(""); renderUser(); renderTokenForm(); };
}

// ───── الهيكل والقائمة الجانبية ─────

function renderShell() {
  $view.innerHTML = `
    <div class="layout" id="dash">
      <aside class="sidebar" id="sidebar"></aside>
      <section class="content" id="content"></section>
    </div>`;
}

function renderSidebar() {
  const c = counts();
  const nav = [
    ["sites", "grid", "المواقع", c.all],
    ["templates", "messages", "رسائل الإغلاق الجاهزة", REASONS.length - 1 + config.templates.length],
    ["log", "clock", "سجل العمليات", ""],
    ["settings", "settings", "الإعدادات", ""],
  ];
  const cats = [
    { id: "all", label: "كل المواقع", tone: "neutral", n: sites.length },
    ...config.categories.map((cat, i) => ({ ...cat, tone: TONES[i % TONES.length], n: sites.filter((s) => s.record?.category === cat.id).length })),
    { id: "none", label: "بلا تصنيف", tone: "muted", n: sites.filter((s) => categoryOf(s).id === "none").length },
  ];
  document.getElementById("sidebar").innerHTML = `
    <nav class="card nav" aria-label="القائمة">
      ${nav.map(([id, ic, label, n]) => `
        <button class="nav-item" data-nav="${id}" ${ui.view === id ? 'aria-current="page"' : ""}>${icon(ic)}${label}${n !== "" ? `<span class="count">${n}</span>` : ""}</button>`).join("")}
    </nav>
    <section class="card card-pad" aria-labelledby="cats-h">
      <div class="side-title"><h2 id="cats-h">التصنيفات</h2>
        <button class="btn sm" data-act="add-category">${icon("plus", "sm")}تصنيف</button></div>
      <div style="display:flex;flex-direction:column;gap:2px">
        ${cats.map((x) => `
          <button class="cat-item" data-cat="${esc(x.id)}" aria-pressed="${ui.view === "sites" && ui.cat === x.id}">
            <span class="swatch" style="${toneStyle(x.tone)}"></span><span>${esc(x.label)}</span><span class="count">${x.n}</span></button>`).join("")}
      </div>
    </section>
    <section class="ink-card">
      <b>${icon("zap")}الإغلاق الفوري</b>
      <p>${c.instant
        ? `مفعّل على ${c.instant} من ${c.all} مواقع. تظهر صفحة الإغلاق للزائر خلال ثوانٍ، وتُعدّ زيارات التشغيل.`
        : "غير مفعّل على أي موقع. فعّله من خيارات الموقع لتظهر صفحة الإغلاق خلال ثوانٍ وتُعدّ زيارات التشغيل."}</p>
    </section>`;
}

function go(view) {
  ui.view = view;
  if (!document.getElementById("dash")) renderShell();
  renderSites();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSites() {
  renderUser();
  if (!document.getElementById("dash")) renderShell();
  $searchArea.hidden = false;
  renderSidebar();
  const views = { sites: renderSitesView, templates: renderTemplatesView, log: renderLogView, settings: renderSettingsView };
  (views[ui.view] || renderSitesView)();
}

// ───── شاشة المواقع ─────

function statCard({ label, value, cls = "", foot = "" }) {
  return `<div class="card stat"><span class="label">${label}</span><b class="value ${cls}">${value}</b>${foot}</div>`;
}

function renderStats() {
  const c = counts();
  const off = sites.filter(isLocked);
  const reasons = {};
  off.forEach((s) => { const k = reasonOf(s.record?.reason).short; reasons[k] = (reasons[k] || 0) + 1; });
  const breakdown = Object.entries(reasons).map(([k, n]) => `${k} ${n}`).join(" · ");
  let v30 = 0, p30 = 0, any = false;
  sites.forEach((s) => { const st = visitStats(s.repo.name); if (st) { any = true; v30 += st.last30; p30 += st.prev30; } });
  const trend = p30 ? Math.round(((v30 - p30) / p30) * 100) : null;
  const pctOn = c.all ? (c.on / c.all) * 100 : 0;
  const visitFoot = !visitsAvailable
    ? `<span class="foot">حدّث قواعد Firestore لعرض الزيارات</span>`
    : !any ? `<span class="foot">لا توجد زيارات مسجّلة بعد</span>`
    : trend == null ? `<span class="foot">مفتوح ومغلق معاً</span>`
    : `<span class="foot ${trend >= 0 ? "up" : "down"}">${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend)}% عن الشهر السابق</span>`;

  document.getElementById("stats").innerHTML = [
    statCard({ label: "إجمالي المواقع", value: c.all, foot: `<span class="foot">${c.all - c.unlinked} مربوطة · ${c.unlinked} غير مربوط</span>` }),
    statCard({ label: `<i class="dot on"></i>تعمل الآن`, value: c.on, cls: "tone-success",
      foot: `<div class="meter" title="${Math.round(pctOn)}%"><span class="on" style="width:${pctOn}%"></span><span class="off" style="width:${100 - pctOn}%"></span></div>` }),
    statCard({ label: `<i class="dot off"></i>مغلقة`, value: c.off, cls: "tone-danger",
      foot: `<span class="foot">${breakdown || "لا توجد مواقع مغلقة"}</span>` }),
    statCard({ label: "الزيارات · آخر 30 يوماً", value: any ? fmt(v30) : "—", foot: visitFoot }),
  ].join("");
}

function renderTabs() {
  const c = counts(byCategory());
  const tabs = [["all", "الكل"], ["on", "تعمل"], ["off", "مغلقة"], ["unlinked", "غير مربوطة"]];
  document.getElementById("tabs").innerHTML = tabs.map(([key, label]) => `
    <button class="tab" role="tab" data-filter="${key}" aria-selected="${ui.filter === key}">${label}<span class="n">${c[key]}</span></button>`).join("");
}

function renderList() {
  const $list = document.getElementById("site-list");
  if (!$list) return;
  const list = filteredSites();
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === ui.mode)));
  if (!sites.length) {
    $list.innerHTML = `<div class="empty">${icon("globe")}<h3>لا توجد مواقع</h3><p>لا توجد مستودعات فيها GitHub Pages مفعّل.</p></div>`;
    return;
  }
  if (!list.length) {
    $list.innerHTML = `<div class="empty">${icon("search")}<h3>لا توجد نتائج</h3><p>لا توجد مواقع تطابق البحث أو التصفية الحالية.</p></div>`;
    return;
  }
  $list.innerHTML = ui.mode === "grid"
    ? `<div class="grid">${list.map(siteCard).join("")}</div>`
    : `<div class="rows">${list.map(siteRow).join("")}</div>`;
}

function renderSitesView() {
  const $c = document.getElementById("content");
  if (!document.getElementById("site-list")) {
    $c.innerHTML = `
      <div class="page-head">
        <div><h1 id="page-title"></h1><p>تحكّم في تشغيل وإغلاق مواقعك، وتابع زياراتها من مكان واحد.</p></div>
        <div class="row"><span class="sync"><span class="dot"></span><span id="updated"></span></span>
          <button class="btn" id="republish-all" hidden title="إعادة نشر صفحة الإغلاق لكل المواقع المغلقة بآخر نسخة من القالب">${icon("lock")}<span></span></button>
          <button class="btn" id="reload">${icon("refresh")}تحديث</button></div>
      </div>
      <div class="stats" id="stats"></div>
      <section class="card" aria-label="المواقع">
        <div class="toolbar">
          <div class="tabs" role="tablist" aria-label="تصفية حسب الحالة" id="tabs"></div>
          <div class="tools">
            <label>ترتيب
              <select id="sort">
                <option value="visits">الأكثر زيارة</option>
                <option value="updated">آخر تحديث</option>
                <option value="name">الاسم</option>
              </select></label>
            <div class="segmented" role="group" aria-label="طريقة العرض">
              <button data-mode="grid" aria-label="بطاقات" title="بطاقات">${icon("grid")}</button>
              <button data-mode="list" aria-label="قائمة" title="قائمة">${icon("list")}</button>
            </div>
          </div>
        </div>
        <div id="site-list"></div>
      </section>
      <section class="card" aria-labelledby="log-h">
        <div class="card-head"><h2 id="log-h">آخر العمليات</h2>
          <button class="btn sm ghost" data-nav="log" style="color:var(--accent)">عرض السجل كاملاً</button></div>
        <div id="recent-log"></div>
      </section>
      <div class="footer">QB-OMNIS · ${sites.length} موقع · الإصدار ${APP_VERSION}</div>`;
    document.getElementById("reload").onclick = loadSites;
    document.getElementById("republish-all").onclick = republishAll;
    const $sort = document.getElementById("sort");
    $sort.value = ui.sort;
    $sort.onchange = () => { ui.sort = $sort.value; try { localStorage.setItem(SORT_KEY, ui.sort); } catch {} renderList(); };
  }
  const cat = ui.cat === "all" ? null : ui.cat === "none" ? "بلا تصنيف" : config.categories.find((x) => x.id === ui.cat)?.label;
  document.getElementById("page-title").textContent = cat ? `مواقعي · ${cat}` : "مواقعي";
  document.getElementById("updated").textContent = ui.loadedAt ? `آخر مزامنة ${since(ui.loadedAt)}` : "";
  const $rep = document.getElementById("republish-all");
  const nLocked = lockedLinked().length;
  $rep.hidden = !nLocked;
  $rep.disabled = lockedLinked().some((x) => busy.has(x.repo.name));
  $rep.querySelector("span").textContent = `تحديث صفحات الإغلاق (${nLocked})`;
  renderStats();
  renderTabs();
  renderList();
  document.getElementById("recent-log").innerHTML = logEntries.length
    ? logEntries.slice(0, 5).map(logItem).join("")
    : `<div class="empty" style="padding:24px">لا توجد عمليات مسجّلة بعد.</div>`;
}

// ───── الشاشات الأخرى ─────

function viewHead(title, sub, extra = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div>${extra}</div>`;
}

function renderTemplatesView() {
  const builtIn = REASONS.filter((r) => r.id !== "custom");
  document.getElementById("content").innerHTML = `
    ${viewHead("رسائل الإغلاق الجاهزة", "تظهر في نافذة الإغلاق لتختار منها بضغطة واحدة.",
      `<button class="btn primary" data-act="add-template">${icon("plus")}رسالة جديدة</button>`)}
    <section class="card">
      <div class="card-head"><h2>رسائلك المحفوظة</h2></div>
      ${config.templates.length ? config.templates.map((t) => `
        <div class="list-item">
          <span class="dlg-icon" style="${toneStyle("purple")};width:34px;height:34px;border-radius:9px">${icon("messages")}</span>
          <div class="grow"><b>${esc(t.label)}</b><p>${esc(t.message)}</p></div>
          <button class="btn sm icon-btn danger-text" data-act="del-template" data-id="${esc(t.id)}" aria-label="حذف ${esc(t.label)}">${icon("trash", "sm")}</button>
        </div>`).join("") : `<div class="empty" style="padding:28px">لا توجد رسائل محفوظة. احفظ رسالة من نافذة الإغلاق أو أضف واحدة من هنا.</div>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>الأسباب الأساسية</h2></div>
      ${builtIn.map((r) => `
        <div class="list-item">
          <span class="dlg-icon" style="${toneStyle(r.tone)};width:34px;height:34px;border-radius:9px">${icon(r.icon)}</span>
          <div class="grow"><b>${esc(r.label)}</b><span class="badge">العنوان: ${esc(r.headline)}</span><p>${esc(r.message)}</p></div>
        </div>`).join("")}
    </section>`;
}

function renderLogView() {
  document.getElementById("content").innerHTML = `
    ${viewHead("سجل العمليات", "آخر 50 عملية نُفّذت من هذه اللوحة.")}
    <section class="card">${logEntries.length ? logEntries.map(logItem).join("")
      : `<div class="empty">${icon("clock")}<h3>السجل فارغ</h3><p>ستظهر هنا عمليات الإغلاق والفتح والتحديث.</p></div>`}</section>`;
}

function renderSettingsView() {
  document.getElementById("content").innerHTML = `
    ${viewHead("الإعدادات", "مفتاح GitHub والمظهر وعدّاد الزيارات.")}
    <section class="card">
      <div class="list-item">
        <span class="dlg-icon" style="${toneStyle("accent")};width:34px;height:34px;border-radius:9px">${icon("key")}</span>
        <div class="grow"><b>مفتاح GitHub</b><p>${getToken() ? "محفوظ في هذا المتصفح فقط." : "لا يوجد مفتاح محفوظ."}</p></div>
        <button class="btn" data-act="token">تغيير المفتاح</button>
      </div>
      <div class="list-item">
        <span class="dlg-icon" style="${toneStyle("neutral")};width:34px;height:34px;border-radius:9px">${icon(currentTheme() === "dark" ? "moon" : "sun")}</span>
        <div class="grow"><b>المظهر</b><p>${currentTheme() === "dark" ? "الوضع الليلي" : "الوضع النهاري"}</p></div>
        <button class="btn" data-act="theme">تبديل</button>
      </div>
      <div class="list-item">
        <span class="dlg-icon" style="${toneStyle(visitsAvailable ? "success" : "warn")};width:34px;height:34px;border-radius:9px">${icon("chart")}</span>
        <div class="grow"><b>عدّاد الزيارات</b>
          <p>${visitsAvailable
            ? "يعمل. زيارة واحدة لكل جلسة تصفح: زيارات التشغيل في المواقع المفعّل عليها الإغلاق الفوري، وزيارات صفحة الإغلاق في كل المواقع المغلقة."
            : "غير متاح: انسخ محتوى firestore.rules الجديد إلى Firebase ← Firestore ← Rules ثم اضغط Publish."}</p></div>
      </div>
      <div class="list-item">
        <span class="dlg-icon" style="${toneStyle("muted")};width:34px;height:34px;border-radius:9px">${icon("info")}</span>
        <div class="grow"><b>الإصدار</b><p>QB-OMNIS ${APP_VERSION}</p></div>
      </div>
    </section>`;
}

// ───────────────────────── القائمة المنبثقة ─────────────────────────

let activeMenu = null;
function closeMenu() {
  if (!activeMenu) return;
  activeMenu.el.remove();
  document.removeEventListener("mousedown", activeMenu.outside, true);
  document.removeEventListener("keydown", activeMenu.key, true);
  activeMenu.anchor.setAttribute("aria-expanded", "false");
  activeMenu = null;
}
function openMenu(anchor, html, handlers) {
  const same = activeMenu?.anchor === anchor;
  closeMenu();
  if (same) return;
  const el = document.createElement("div");
  el.className = "menu";
  el.setAttribute("role", "menu");
  el.innerHTML = html;
  el.querySelectorAll("button, a").forEach((b) => b.setAttribute("role", "menuitem"));
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = r.right - w;
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-menu]");
    if (!b) return;
    if (b.dataset.menu === "noop") { setTimeout(closeMenu, 0); return; } // روابط: نترك المتصفح يفتحها أولاً
    closeMenu();
    handlers[b.dataset.menu]?.();
  });
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const key = (e) => {
    const items = [...el.querySelectorAll("button, a")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); anchor.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  };
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("keydown", key, true);
  anchor.setAttribute("aria-expanded", "true");
  activeMenu = { el, anchor, outside, key };
  el.querySelector("button, a")?.focus();
}

function siteMenu(anchor, s) {
  const url = s.pages?.html_url;
  const linked = isLinked(s), locked = isLocked(s), instant = !!s.record?.instant;
  openMenu(anchor, `
    ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" data-menu="noop">${icon("external")}زيارة الموقع</a>
      <button data-menu="copy">${icon("copy")}نسخ الرابط</button>` : ""}
    <button data-menu="category">${icon("tag")}تغيير التصنيف<span class="hint">${esc(categoryOf(s).label)}</span></button>
    ${linked ? `<button data-menu="service">${icon("edit")}تعديل اسم الخدمة</button>` : ""}
    ${linked && !locked ? `<button data-menu="instant">${icon("zap")}الإغلاق الفوري<span class="hint">${instant ? "مفعّل" : "غير مفعّل"}</span></button>` : ""}
    <a href="${esc(s.repo.html_url)}" target="_blank" rel="noopener" data-menu="noop">${icon("branch")}فتح المستودع على GitHub</a>
    ${linked && !locked ? `<hr><button data-menu="unlink" class="danger-text">${icon("unlink")}فك الربط</button>` : ""}`, {
    copy: () => navigator.clipboard?.writeText(url).then(() => toast({ kind: "ok", title: "تم نسخ الرابط", text: url })),
    category: () => categoryDialog(s),
    service: () => serviceDialog(s),
    instant: () => runAction(instant ? "instant-off" : "instant-on", s),
    unlink: () => runAction("unlink", s),
  });
}

// ───────────────────────── نوافذ المواقع ─────────────────────────

/** نافذة الإغلاق (أو تحديث صفحة الإغلاق) مع اختيار السبب */
function closeDialog(s, { update = false } = {}) {
  const rec = s.record || {};
  let reason = update ? (rec.reason || "custom") : "subscription";
  let dirty = update;
  const startMsg = update ? (rec.message || "") : reasonOf(reason).message;
  const service = serviceOf(s);

  const m = openModal(`
    ${dlgHead(update
      ? { iconName: "edit", tone: "accent", title: `تحديث صفحة إغلاق «${esc(service)}»`, text: "يبقى الموقع مغلقاً، وتتغير الرسالة التي يراها الزوار." }
      : { iconName: "power", tone: "danger", title: `إغلاق «${esc(service)}»؟`, text: "سيرى الزوار صفحة الإغلاق بدل الموقع. يمكنك إعادة فتحه في أي وقت." })}
    <div class="dlg-body">
      <fieldset>
        <legend>سبب الإغلاق</legend>
        <div class="reasons">
          ${REASONS.map((r) => `
            <label class="reason">
              <input type="radio" name="reason" value="${r.id}" ${r.id === reason ? "checked" : ""}>
              <span class="r-mark" style="${toneStyle(r.tone)}">${icon(r.icon)}</span>
              <span class="r-text">${esc(r.label)}<small>${esc(r.hint)}</small></span>
              <span class="r-radio" aria-hidden="true"></span>
            </label>`).join("")}
        </div>
      </fieldset>

      <div class="inline-field" id="ret-wrap" ${reason === "maintenance" ? "" : "hidden"}>
        <label for="ret">العودة المتوقعة</label>
        <input id="ret" value="${esc(rec.returnAt || "")}" placeholder="مثال: اليوم 6:00 م" autocomplete="off">
        <small>تظهر للزائر أسفل الرسالة</small>
      </div>

      ${config.templates.length ? `<div class="templates"><span>رسائلك الجاهزة:</span>
        ${config.templates.map((t) => `<button type="button" class="chip chip-btn" data-tpl="${esc(t.id)}">${esc(t.label)}</button>`).join("")}</div>` : ""}

      <div class="compose">
        <div class="compose-fields">
          <div class="field"><label for="svc">اسم الخدمة</label>
            <input id="svc" value="${esc(rec.serviceName || "")}" placeholder="${esc(s.repo.name)}" autocomplete="off"></div>
          <div class="field"><label for="msg">الرسالة للزوار</label>
            <textarea id="msg" rows="4">${esc(startMsg)}</textarea></div>
        </div>
        <div class="preview">
          <span>معاينة</span>
          <div class="preview-box" aria-label="معاينة صفحة الإغلاق">
            <div class="preview-main">
              <span class="tile" id="pv-tile"></span>
              <b id="pv-head"></b>
              <span class="svc" id="pv-svc"></span>
              <p id="pv-msg"></p>
              <span class="ret" id="pv-ret"></span>
            </div>
            <div class="preview-brand"><span>برمجيات QB</span><span dir="ltr">053-838-1612</span></div>
          </div>
        </div>
      </div>

      <div class="options">
        ${rec.instant
          ? `<div class="info">${icon("zap")}<span><b>الإغلاق الفوري مفعّل</b> <span class="muted">— تظهر صفحة الإغلاق لمن يتصفح الموقع الآن خلال ثوانٍ.</span></span></div>`
          : `<div class="info">${icon("info")}<span><b>الإغلاق الفوري غير مفعّل</b> <span class="muted">— تظهر الصفحة بعد اكتمال النشر. فعّله من «خيارات أخرى».</span></span></div>`}
        <label><input type="checkbox" id="save-tpl"><span><b>حفظ كرسالة جاهزة</b> <span class="muted">— لاستخدامها مع مواقع أخرى</span></span></label>
      </div>
    </div>
    <div class="dlg-foot">
      <span class="note">${update ? "تُنشر الرسالة الجديدة خلال دقيقة أو دقيقتين." : "يكتمل الإغلاق على GitHub Pages خلال دقيقة إلى دقيقتين."}</span>
      <button class="btn lg" data-close>إلغاء</button>
      <button class="btn lg ${update ? "primary" : "danger"}" id="dlg-ok">${icon(update ? "check" : "lock", "sm")}${update ? "حفظ التحديث" : "تأكيد الإغلاق"}</button>
    </div>`);

  const $o = m.overlay;
  const $msg = $o.querySelector("#msg"), $svc = $o.querySelector("#svc"), $ret = $o.querySelector("#ret");
  const preview = () => {
    const r = reasonOf(reason);
    const $tile = $o.querySelector("#pv-tile");
    $tile.style.cssText = toneStyle(r.tone);
    $tile.innerHTML = icon(r.icon, "sm");
    $o.querySelector("#pv-head").textContent = r.headline;
    $o.querySelector("#pv-svc").textContent = `الخدمة: ${$svc.value.trim() || s.repo.name}`;
    $o.querySelector("#pv-msg").textContent = $msg.value.trim() || r.message || DEFAULT_MESSAGE;
    $o.querySelector("#pv-ret").textContent = reason === "maintenance" && $ret.value.trim() ? `العودة المتوقعة: ${$ret.value.trim()}` : "";
  };
  $o.querySelectorAll('input[name="reason"]').forEach((el) => el.addEventListener("change", () => {
    reason = el.value;
    const r = reasonOf(reason);
    // نستبدل الرسالة بالجاهزة فقط إن لم يكتبها المستخدم بنفسه
    if (!dirty || REASONS.some((x) => x.message && x.message === $msg.value.trim())) {
      $msg.value = r.message;
      dirty = false;
    }
    $msg.placeholder = r.id === "custom" ? "اكتب الرسالة التي ستظهر للزوار…" : "";
    $o.querySelector("#ret-wrap").hidden = reason !== "maintenance";
    if (r.id === "custom") $msg.focus();
    preview();
  }));
  $msg.addEventListener("input", () => { dirty = true; preview(); });
  $svc.addEventListener("input", preview);
  $ret.addEventListener("input", preview);
  $o.querySelectorAll("[data-tpl]").forEach((b) => b.addEventListener("click", () => {
    const t = config.templates.find((x) => x.id === b.dataset.tpl);
    if (t) { $msg.value = t.message; dirty = true; preview(); }
  }));
  preview();

  $o.querySelector("#dlg-ok").onclick = async () => {
    const r = reasonOf(reason);
    const message = $msg.value.trim() || r.message || DEFAULT_MESSAGE;
    const page = { message, serviceName: $svc.value.trim(), reason, returnAt: $ret.value.trim() };
    if ($o.querySelector("#save-tpl").checked) {
      const label = r.id === "custom" ? message.slice(0, 32) + (message.length > 32 ? "…" : "") : r.label;
      config.templates = [...config.templates, { id: `t${Date.now().toString(36)}`, label, message }];
      saveConfig({ templates: config.templates }).catch(() => toast({ kind: "error", title: "تعذّر حفظ الرسالة الجاهزة" }));
    }
    m.close();
    runAction(update ? "update" : "lock", s, page);
  };
}

/** نافذة تأكيد فتح الموقع */
function openDialog(s) {
  const rec = s.record || {};
  const orig = rec.original;
  const workflow = orig?.build_type === "workflow";
  const reason = rec.reason ? reasonOf(rec.reason).label : "غير محدد";
  const lockedAt = toDate(rec.lockedAt);
  const m = openModal(`
    ${dlgHead({ iconName: "power", tone: "success", centered: true,
      title: `فتح «${esc(serviceOf(s))}» من جديد؟`, text: "ستختفي صفحة الإغلاق ويعود الموقع للزوار كما كان قبل الإغلاق." })}
    <div class="dlg-body">
      <div class="facts">
        <div><span>سبب الإغلاق الحالي</span><b>${esc(reason)}</b></div>
        ${lockedAt ? `<div><span>مدة الإغلاق</span><b>${esc(duration(Date.now() - lockedAt.getTime()))}</b></div>` : ""}
        <div><span>سيعود النشر إلى</span><b>${esc(orig ? describeSource(orig) : `فرع ${s.repo.default_branch} (افتراضي)`)}</b></div>
      </div>
      ${workflow ? `<label style="display:flex;align-items:center;gap:10px;font-weight:400;cursor:pointer">
        <input type="checkbox" id="redeploy" checked><span>إعادة تشغيل آخر عملية نشر تلقائياً</span></label>` : ""}
    </div>
    <div class="dlg-foot">
      <button class="btn lg grow" data-close>إلغاء</button>
      <button class="btn lg success" style="flex:2" id="dlg-ok">${icon("power", "sm")}نعم، افتح الموقع</button>
    </div>`, { size: "sm" });
  m.overlay.querySelector("#dlg-ok").onclick = () => {
    const redeploy = m.overlay.querySelector("#redeploy")?.checked ?? true;
    m.close();
    runAction("unlock", s, { redeploy });
  };
}

function categoryDialog(s) {
  const cur = s.record?.category || "none";
  const opts = [...config.categories.map((c, i) => ({ ...c, tone: TONES[i % TONES.length] })), { id: "none", label: "بلا تصنيف", tone: "muted" }];
  const m = openModal(`
    ${dlgHead({ iconName: "tag", tone: "purple", title: "تغيير التصنيف", text: esc(serviceOf(s)) })}
    <div class="dlg-body" style="gap:4px">
      ${opts.map((c) => `<button class="cat-item" data-pick="${esc(c.id)}" aria-pressed="${c.id === cur}">
        <span class="swatch" style="${toneStyle(c.tone)}"></span><span>${esc(c.label)}</span>${c.id === cur ? `<span class="count">${icon("check", "sm")}</span>` : ""}</button>`).join("")}
    </div>
    <div class="dlg-foot"><button class="btn" id="new-cat">${icon("plus", "sm")}تصنيف جديد</button><span class="note"></span>
      <button class="btn" data-close>إغلاق</button></div>`, { size: "sm" });
  m.overlay.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    m.close();
    setCategory(s, b.dataset.pick);
  }));
  m.overlay.querySelector("#new-cat").onclick = async () => {
    m.close();
    const id = await addCategory();
    if (id) setCategory(s, id);
  };
}

async function setCategory(s, id) {
  const name = s.repo.name;
  const value = id === "none" ? null : id;
  try {
    await saveRecord(name, { category: value });
    s.record = { ...(s.record || {}), category: value };
    const label = categoryOf(s).label;
    addLog({ type: "category", site: name, title: `تصنيف ${serviceOf(s)}`, detail: label });
    toast({ kind: "ok", title: "تم تغيير التصنيف", text: `${serviceOf(s)} ← ${label}` });
    renderSites();
  } catch (e) {
    toast({ kind: "error", title: "تعذّر تغيير التصنيف", text: e.message });
  }
}

async function addCategory() {
  const label = await promptDialog({ title: "تصنيف جديد", label: "اسم التصنيف", iconName: "tag", tone: "purple", confirmLabel: "إضافة", placeholder: "مثال: مطاعم" });
  if (!label) return null;
  const id = `c${Date.now().toString(36)}`;
  config.categories = [...config.categories, { id, label }];
  try {
    await saveConfig({ categories: config.categories });
    toast({ kind: "ok", title: "تمت إضافة التصنيف", text: label });
  } catch (e) {
    toast({ kind: "error", title: "تعذّر حفظ التصنيف", text: e.message });
  }
  renderSites();
  return id;
}

async function serviceDialog(s) {
  const v = await promptDialog({ title: "اسم الخدمة", label: "الاسم الذي يظهر في اللوحة وصفحة الإغلاق", value: s.record?.serviceName || "", placeholder: s.repo.name });
  if (v == null) return;
  try {
    await saveRecord(s.repo.name, { serviceName: v });
    s.record = { ...(s.record || {}), serviceName: v };
    addLog({ type: "service", site: s.repo.name, title: `اسم الخدمة لـ ${s.repo.name}`, detail: v || "(بدون)" });
    toast({ kind: "ok", title: "تم تحديث اسم الخدمة", text: isLocked(s) ? "سيظهر في صفحة الإغلاق عند تحديثها." : v || s.repo.name });
    renderSites();
  } catch (e) {
    toast({ kind: "error", title: "تعذّر الحفظ", text: e.message });
  }
}

function templateDialog() {
  const m = openModal(`
    ${dlgHead({ iconName: "messages", tone: "purple", title: "رسالة إغلاق جديدة" })}
    <div class="dlg-body">
      <div class="field"><label for="tpl-l">العنوان المختصر</label><input id="tpl-l" placeholder="مثال: إجازة العيد" autocomplete="off" autofocus></div>
      <div class="field"><label for="tpl-m">نص الرسالة</label><textarea id="tpl-m" rows="4"></textarea></div>
    </div>
    <div class="dlg-foot"><span class="note"></span><button class="btn lg" data-close>إلغاء</button>
      <button class="btn lg primary" id="dlg-ok">حفظ</button></div>`, { size: "sm" });
  m.overlay.querySelector("#dlg-ok").onclick = async () => {
    const label = m.overlay.querySelector("#tpl-l").value.trim();
    const message = m.overlay.querySelector("#tpl-m").value.trim();
    if (!label || !message) { toast({ kind: "warn", title: "أكمل الحقول", text: "اكتب العنوان ونص الرسالة.", duration: 4000 }); return; }
    m.close();
    config.templates = [...config.templates, { id: `t${Date.now().toString(36)}`, label, message }];
    try { await saveConfig({ templates: config.templates }); toast({ kind: "ok", title: "تم حفظ الرسالة", text: label }); }
    catch (e) { toast({ kind: "error", title: "تعذّر الحفظ", text: e.message }); }
    renderSites();
  };
}

// ───────────────────────── تنفيذ العمليات ─────────────────────────

const ACTIONS = {
  lock: { label: "جارٍ الإغلاق…", total: 3 },
  update: { label: "جارٍ التحديث…", total: 2 },
  unlock: { label: "جارٍ الفتح…", total: 3 },
  link: { label: "جارٍ الربط…", total: 0 },
  "instant-on": { label: "جارٍ التفعيل…", total: 0 },
  "instant-off": { label: "جارٍ الإزالة…", total: 0 },
  unlink: { label: "جارٍ فك الربط…", total: 0 },
};

async function runAction(act, s, opts = {}) {
  const name = s.repo.name;
  if (busy.has(name)) return;
  const service = serviceOf(s);

  if (act === "instant-on" && !(await confirmDialog({
    iconName: "zap", tone: "warn", title: `تفعيل الإغلاق الفوري على «${esc(service)}»؟`,
    text: "تظهر صفحة الإغلاق للزوار خلال ثوانٍ، وتبدأ اللوحة بعدّ زيارات التشغيل.",
    body: `<div class="options"><div class="info">${icon("info")}<span>سيُضاف سطر واحد إلى ملفات HTML في المستودع (commit جديد).
      إذا كانت لديك نسخة على جهازك، اسحب التحديث (<code>git pull</code>) قبل أن تعدّل عليها.</span></div></div>`,
    confirmLabel: "تفعيل",
  }))) return;
  if (act === "instant-off" && !(await confirmDialog({
    iconName: "zap", tone: "neutral", title: `إزالة الإغلاق الفوري من «${esc(service)}»؟`,
    text: "سيُحذف السطر من ملفات HTML (commit جديد)، ويتوقف عدّ زيارات التشغيل.", confirmLabel: "إزالة", confirmClass: "danger",
  }))) return;
  if (act === "unlink" && !(await confirmDialog({
    iconName: "unlink", tone: "danger", title: `فك ربط «${esc(service)}»؟`,
    text: "سيُحذف سجل الموقع من اللوحة (التصنيف واسم الخدمة والرسالة). الموقع نفسه لن يتأثر.", confirmLabel: "فك الربط", confirmClass: "danger",
  }))) return;

  const meta = ACTIONS[act];
  busy.set(name, { label: meta.label, step: 0, total: meta.total, text: "بدء التنفيذ" });
  renderSites();
  const progress = toast({ kind: "progress", title: `${meta.label.replace("…", "")} «${service}»…`, text: "بدء التنفيذ" });
  const onStep = (step, text) => {
    busy.set(name, { ...busy.get(name), step, text });
    progress.update({ text: meta.total ? `الخطوة ${step} من ${meta.total}: ${text}` : text, step, total: meta.total });
    const card = document.querySelector(`[data-site="${CSS.escape(name)}"] .site-note.busy span`);
    if (card) card.textContent = `${meta.total ? `الخطوة ${step} من ${meta.total}: ` : ""}${text}`;
  };

  try {
    if (act === "link") {
      onStep(1, "إنشاء فرع صفحة الإغلاق");
      await linkSite(s);
      addLog({ type: "link", site: name, title: `ربط ${service}`, detail: "أصبح الموقع تحت التحكم" });
      toast({ kind: "ok", title: `تم ربط «${service}»`, text: "يمكنك الآن إغلاقه وفتحه من اللوحة." });
    } else if (act === "lock" || act === "update") {
      await lockSite(s, opts, onStep);
      const r = reasonOf(opts.reason);
      if (act === "lock") {
        addLog({ type: "close", site: name, title: `إغلاق ${opts.serviceName || service}`, detail: `السبب: ${r.label}` });
        toast({
          kind: "closed", title: `تم إغلاق «${opts.serviceName || service}»`,
          text: `السبب: ${r.label}. تظهر صفحة الإغلاق خلال دقيقة أو دقيقتين.`,
          duration: 8000,
          actions: [
            { label: "تراجع", onClick: () => { const x = sites.find((y) => y.repo.name === name); if (x) openDialog(x); } },
            ...(s.pages?.html_url ? [{ label: "عرض الصفحة", onClick: () => window.open(s.pages.html_url, "_blank", "noopener") }] : []),
          ],
        });
      } else {
        addLog({ type: "update", site: name, title: `تحديث رسالة ${opts.serviceName || service}`, detail: r.label });
        toast({ kind: "updated", title: "تم تحديث صفحة الإغلاق", text: `رسالة «${opts.serviceName || service}» أصبحت: ${r.label}.` });
      }
    } else if (act === "unlock") {
      const note = await unlockSite(s, opts, onStep);
      const orig = s.record?.original;
      addLog({ type: "open", site: name, title: `فتح ${service}`, detail: orig ? `عاد النشر إلى ${describeSource(orig)}` : "عاد الموقع للعمل" });
      toast({ kind: "opened", title: `تم فتح «${service}»`, text: `${orig ? `عاد النشر إلى ${describeSource(orig)}. ` : ""}سيظهر الموقع للزوار خلال دقيقة أو دقيقتين.` });
      if (note) toast({ kind: "warn", title: "الموقع مفتوح، لكن إعادة النشر تحتاج تدخلك", text: note,
        actions: [{ label: "فتح Actions", onClick: () => window.open(`${s.repo.html_url}/actions`, "_blank", "noopener") }] });
    } else if (act === "instant-on" || act === "instant-off") {
      const on = act === "instant-on";
      onStep(1, on ? "إضافة سطر الإغلاق الفوري" : "حذف سطر الإغلاق الفوري");
      const { count, branch } = await setInstantLock(s, on);
      addLog({ type: "instant", site: name, title: `${on ? "تفعيل" : "إزالة"} الإغلاق الفوري على ${service}`, detail: count ? `${count} ملف · فرع ${branch}` : "لا تغيير" });
      toast(count
        ? { kind: "ok", title: on ? "تم تفعيل الإغلاق الفوري" : "تمت إزالة الإغلاق الفوري", text: `${service}: ${count} ملف في فرع ${branch}. يسري بعد إعادة النشر خلال دقيقة أو دقيقتين.` }
        : { kind: "info", title: on ? "الإغلاق الفوري مفعّل مسبقاً" : "لا يوجد سكربت لإزالته", text: service });
    } else if (act === "unlink") {
      onStep(1, "حذف سجل الموقع");
      await deleteDoc(doc(db, "sites", name));
      addLog({ type: "unlink", site: name, title: `فك ربط ${service}`, detail: "حُذف السجل من اللوحة" });
      toast({ kind: "ok", title: `تم فك ربط «${service}»` });
    }
  } catch (e) {
    const perm = e.status === 401 || e.status === 403 || e.status === 404;
    toast({
      kind: "error", title: `تعذّر تنفيذ العملية على «${service}»`,
      text: `${e.message}${perm ? " — تأكد من صلاحيات مفتاح GitHub: Administration وContents وPages وActions." : ""}`,
      actions: [
        { label: "إعادة المحاولة", onClick: () => { const x = sites.find((y) => y.repo.name === name); if (x) runAction(act, x, opts); } },
        ...(perm ? [{ label: "تحديث المفتاح", onClick: renderTokenForm }] : []),
      ],
    });
  } finally {
    progress.close();
    busy.delete(name);
    await refreshOne(name).catch(() => {});
    if (document.getElementById("dash")) renderSites();
  }
}

// ───── تحديث كل صفحات الإغلاق دفعة واحدة ─────
// يعيد نشر صفحة الإغلاق لكل موقع مغلق بنفس رسالته وسببه وتاريخه، حتى تحصل كل الصفحات
// على آخر نسخة من القالب (مثل عدّاد زيارات الإغلاق). لا يغيّر Firestore ولا مصدر النشر.

const lockedLinked = () => sites.filter((s) => isLinked(s) && isLocked(s));

async function republishAll() {
  const targets = lockedLinked().filter((s) => !busy.has(s.repo.name));
  if (!targets.length) { toast({ kind: "info", title: "لا توجد مواقع مغلقة لتحديثها" }); return; }
  if (!(await confirmDialog({
    iconName: "refresh", tone: "accent", title: `تحديث صفحات الإغلاق (${targets.length})؟`,
    text: "تُعاد كتابة صفحة الإغلاق في كل موقع مغلق بنفس الرسالة والسبب والتاريخ، فتحصل على آخر نسخة من القالب وعدّاد الزيارات.",
    body: `<div class="options"><div class="info">${icon("info")}<span>commit واحد في فرع <code>maintenance</code> لكل موقع.
      لا يتغير شيء آخر، والمواقع تبقى مغلقة. تظهر النسخة الجديدة خلال دقيقة أو دقيقتين.</span></div></div>`,
    confirmLabel: "تحديث الكل",
  }))) return;

  targets.forEach((s) => busy.set(s.repo.name, { label: "بانتظار التحديث…", step: 0, total: 0, text: "في قائمة الانتظار" }));
  renderSites();
  const progress = toast({ kind: "progress", title: "تحديث صفحات الإغلاق…", text: `0 من ${targets.length}` });
  const failed = [];
  // واحداً تلو الآخر حتى لا نصطدم بحدود GitHub API
  for (let i = 0; i < targets.length; i++) {
    const s = targets[i];
    const name = s.repo.name, r = s.record || {};
    busy.set(name, { label: "جارٍ التحديث…", step: 1, total: 1, text: "كتابة صفحة الإغلاق" });
    renderSites();
    progress.update({ text: `${i + 1} من ${targets.length}: ${serviceOf(s)}`, step: i + 1, total: targets.length });
    try {
      await writeMaintenanceBranch(s.repo.owner.login, name, r.message || DEFAULT_MESSAGE, {
        serviceName: r.serviceName || "",
        closedAt: r.lockedAt?.toDate?.() || null,
        headline: r.headline || (r.reason ? reasonOf(r.reason).headline : ""),
        returnAt: r.reason === "maintenance" ? (r.returnAt || "") : "",
      });
      await requestPagesBuild(s.repo.owner.login, name);
    } catch (e) {
      failed.push({ s, message: e.message, status: e.status });
    } finally {
      busy.delete(name);
    }
  }
  progress.close();
  renderSites();

  const done = targets.length - failed.length;
  if (done) addLog({ type: "update", site: "", title: "تحديث كل صفحات الإغلاق", detail: `${done} من ${targets.length} موقع` });
  if (!failed.length) {
    toast({ kind: "updated", title: `تم تحديث ${done} صفحة إغلاق`, text: "تظهر النسخة الجديدة للزوار خلال دقيقة أو دقيقتين." });
  } else {
    const perm = failed.some((f) => f.status === 401 || f.status === 403 || f.status === 404);
    toast({
      kind: "error", title: `تعذّر تحديث ${failed.length} من ${targets.length}`,
      text: `${failed.map((f) => `${serviceOf(f.s)}: ${f.message}`).join(" · ")}${perm ? " — تأكد من صلاحيات مفتاح GitHub (Contents وPages)." : ""}`,
      actions: [{ label: "إعادة المحاولة", onClick: republishAll }],
    });
  }
}

// ───────────────────────── الأحداث ─────────────────────────

$view.addEventListener("click", (ev) => {
  const nav = ev.target.closest("[data-nav]");
  if (nav) { go(nav.dataset.nav); return; }
  const cat = ev.target.closest("[data-cat]");
  if (cat) { ui.cat = cat.dataset.cat; ui.view = "sites"; renderSites(); return; }
  const tab = ev.target.closest("[data-filter]");
  if (tab) { ui.filter = tab.dataset.filter; renderTabs(); renderList(); return; }
  const mode = ev.target.closest("[data-mode]");
  if (mode) {
    ui.mode = mode.dataset.mode;
    try { localStorage.setItem(VIEW_KEY, ui.mode); } catch {}
    renderList();
    return;
  }
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "add-category") { addCategory(); return; }
  if (act === "add-template") { templateDialog(); return; }
  if (act === "del-template") {
    const t = config.templates.find((x) => x.id === btn.dataset.id);
    confirmDialog({ iconName: "trash", tone: "danger", title: `حذف رسالة «${esc(t?.label || "")}»؟`, confirmLabel: "حذف", confirmClass: "danger" }).then(async (ok) => {
      if (!ok) return;
      config.templates = config.templates.filter((x) => x.id !== btn.dataset.id);
      try { await saveConfig({ templates: config.templates }); toast({ kind: "ok", title: "تم حذف الرسالة" }); }
      catch (e) { toast({ kind: "error", title: "تعذّر الحذف", text: e.message }); }
      renderSites();
    });
    return;
  }
  if (act === "token") { renderTokenForm(); return; }
  if (act === "theme") { toggleTheme(); renderSites(); return; }

  const s = sites.find((x) => x.repo.name === btn.dataset.name);
  if (!s) return;
  if (act === "menu") siteMenu(btn, s);
  else if (act === "category") categoryDialog(s);
  else if (act === "lock") closeDialog(s);
  else if (act === "update") closeDialog(s, { update: true });
  else if (act === "unlock") openDialog(s);
  else runAction(act, s);
});

$q.addEventListener("input", () => {
  ui.query = $q.value;
  if (ui.view !== "sites") { ui.view = "sites"; renderSites(); } else renderList();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || activeModal || $searchArea.hidden) return;
  const t = e.target;
  if (t.closest?.("input, textarea, select, [contenteditable]")) return;
  e.preventDefault();
  $q.focus();
});
window.addEventListener("resize", closeMenu);
window.addEventListener("scroll", closeMenu, { passive: true });

// ───────────────────────── البدء ─────────────────────────

function start() {
  if (String(firebaseConfig.apiKey).startsWith("YOUR_")) { renderSetupNeeded(); return; }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    renderUser();
    if (!user) return renderSignIn();
    if (user.uid !== ADMIN_UID) return renderNotAdmin();
    if (!getToken()) return renderTokenForm();
    loadSites();
  });
}

start();
