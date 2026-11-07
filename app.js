import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ADMIN_UID, DASHBOARD_REPO } from "./firebase-config.js";
import { maintenancePage } from "./maintenance-template.js";

const MAINT_BRANCH = "maintenance";
const TOKEN_KEY = "qb-omnis.github-token";
const DEFAULT_MESSAGE = "هذا الموقع غير متاح حالياً. نعتذر عن الإزعاج، يرجى المحاولة لاحقاً.";
// رابط سكربت الإغلاق الفوري (lock.js بجانب اللوحة على GitHub Pages)
const LOCK_SRC = new URL("lock.js", location.href).href;
const SNIPPET_RE = /[ \t]*<script[^>]*data-qb-omnis[^>]*><\/script>[ \t]*\r?\n?/gi;

const $view = document.getElementById("view");
const $user = document.getElementById("user-area");
const $toasts = document.getElementById("toasts");

let auth, db, currentUser = null;
let sites = [];          // [{ repo, pages, record }]
let busy = new Set();    // أسماء المستودعات التي تُنفَّذ عليها عملية الآن

// ───────────────────────── أدوات عامة ─────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

function toast(text, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${
    kind === "ok" ? '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'
    : kind === "error" ? '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'
    : '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'}</svg><span></span>`;
  el.querySelector("span").textContent = text;
  $toasts.appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 9000 : 5000);
}

const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

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
async function writeMaintenanceBranch(owner, name, message) {
  const html = maintenancePage({ title: name, message });
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

// ───────────────────────── العمليات ─────────────────────────

async function linkSite(s) {
  const owner = s.repo.owner.login, name = s.repo.name;
  await writeMaintenanceBranch(owner, name, DEFAULT_MESSAGE);
  await saveRecord(name, {
    owner, repo: name,
    enabled: !isLocked(s),
    message: s.record?.message || DEFAULT_MESSAGE,
    pagesUrl: s.pages?.html_url || null,
    linkedAt: serverTimestamp(),
  });
}

async function lockSite(s, message) {
  const owner = s.repo.owner.login, name = s.repo.name;
  const alreadyLocked = isLocked(s);
  // 1) Firestore أولاً: يُغلق الموقع فوراً عند الزوار (إن كان الإغلاق الفوري مفعّلاً)،
  //    ونحفظ الإعداد الأصلي قبل تغييره حتى نستطيع استرجاعه دائماً
  await saveRecord(name, {
    enabled: false, message, owner, repo: name, lockedAt: serverTimestamp(),
    ...(alreadyLocked ? {} : { original: originalConfig(s.pages) }),
  });
  // 2) الإغلاق الحقيقي على GitHub Pages
  try {
    await writeMaintenanceBranch(owner, name, message);
    if (!alreadyLocked) {
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

async function unlockSite(s) {
  const owner = s.repo.owner.login, name = s.repo.name;
  const orig = s.record?.original || { build_type: "legacy", source: { branch: s.repo.default_branch, path: "/" } };
  let note = "";
  if (orig.build_type === "workflow") {
    await gh(`/repos/${owner}/${name}/pages`, { method: "PUT", body: { build_type: "workflow" } });
    note = await redeployWorkflow(owner, name, s.repo.default_branch);
  } else {
    await gh(`/repos/${owner}/${name}/pages`, { method: "PUT", body: { build_type: "legacy", source: orig.source } });
    await requestPagesBuild(owner, name);
  }
  await saveRecord(name, { enabled: true, unlockedAt: serverTimestamp() });
  return note;
}

// ───────────────────────── تحميل البيانات ─────────────────────────

async function loadSites() {
  $view.innerHTML = loadingView("جارٍ جلب المستودعات من GitHub…");
  try {
    const repos = await ghAll("/user/repos?affiliation=owner&sort=updated");
    const withPages = repos.filter((r) => r.has_pages && r.name !== DASHBOARD_REPO);
    const snap = await getDocs(collection(db, "sites"));
    const records = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    sites = await Promise.all(withPages.map(async (repo) => {
      let pages = null;
      try { pages = await gh(`/repos/${repo.owner.login}/${repo.name}/pages`); }
      catch (e) { if (e.status !== 404) throw e; }
      return { repo, pages, record: records[repo.name] || null };
    }));
    sites = sites.filter((s) => s.pages);
    ui.loadedAt = new Date();
    renderSites();
  } catch (e) {
    if (e.status === 401) {
      setToken("");
      toast("مفتاح GitHub غير صالح أو منتهي. أدخل مفتاحاً جديداً.", "error");
      renderTokenForm();
      return;
    }
    $view.innerHTML = panel({
      iconName: "alert", title: "حدث خطأ",
      body: `<p class="center">${esc(e.message)}</p><button class="primary block" id="retry">إعادة المحاولة</button>`,
    });
    document.getElementById("retry").onclick = loadSites;
  }
}

async function refreshOne(name) {
  const s = sites.find((x) => x.repo.name === name);
  if (!s) return;
  try { s.pages = await gh(`/repos/${s.repo.owner.login}/${name}/pages`); } catch {}
  const snap = await getDocs(collection(db, "sites"));
  const d = snap.docs.find((x) => x.id === name);
  s.record = d ? d.data() : null;
}

// ───────────────────────── الواجهة ─────────────────────────

const VIEW_KEY = "qb-omnis.view";
const THEME_KEY = "qb-omnis.theme";
const ui = {
  filter: "all",        // all | on | off | unlinked
  query: "",
  mode: (() => { try { return localStorage.getItem(VIEW_KEY) || "list"; } catch { return "list"; } })(),
  loadedAt: null,
};
const drafts = new Map(); // نصوص رسائل الإغلاق أثناء الكتابة، حتى لا تضيع عند إعادة الرسم

// أيقونات SVG خفيفة بنمط خطّي
const ICONS = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  stop: '<circle cx="12" cy="12" r="9"/><path d="M9 9h6v6H9z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  unlink: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/><path d="M3 3l18 18"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
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
  google: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 12h-8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
};
const icon = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

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

const timeAgo = (d) => {
  if (!d) return "";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "الآن";
  const m = Math.round(s / 60);
  if (m < 60) return `قبل ${m} دقيقة`;
  return d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
};

function loadingView(text) {
  return `<div class="loading-screen"><span class="spinner"></span>${esc(text)}</div>`;
}

/** صندوق بسيط للشاشات المستقلة (الدخول، المفتاح، الأخطاء) */
function panel({ iconName, title, body }) {
  return `
    <div class="box narrow">
      <div class="box-body">
        ${iconName ? `<div class="auth-icon">${icon(iconName)}</div>` : ""}
        <h2 class="${iconName ? "center" : ""}">${title}</h2>
        ${body}
      </div>
    </div>`;
}

function renderUser() {
  if (!currentUser) {
    $user.innerHTML = `<button class="ghost btn-icon" id="theme" title="تبديل المظهر">${icon(currentTheme() === "dark" ? "sun" : "moon")}</button>`;
  } else {
    $user.innerHTML = `
      <button class="ghost btn-icon" id="theme" title="تبديل المظهر">${icon(currentTheme() === "dark" ? "sun" : "moon")}</button>
      ${getToken() ? `<button class="btn-sm" id="change-token" title="مفتاح GitHub">${icon("key")}<span>المفتاح</span></button>` : ""}
      <button class="btn-sm" id="logout" title="تسجيل الخروج">${icon("logout")}<span>خروج</span></button>
      <span class="user-name">${esc(currentUser.displayName || currentUser.email || "")}</span>
      ${currentUser.photoURL ? `<img class="avatar" src="${esc(currentUser.photoURL)}" alt="">` : ""}`;
    document.getElementById("logout").onclick = () => signOut(auth);
    const ct = document.getElementById("change-token");
    if (ct) ct.onclick = renderTokenForm;
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
  $view.innerHTML = panel({
    iconName: "lock",
    title: "تسجيل الدخول إلى QB-OMNIS",
    body: `<p class="muted center">هذه اللوحة خاصة بمالكها فقط.</p>
      <button class="primary block" id="login">${icon("user")} الدخول بحساب Google</button>`,
  });
  document.getElementById("login").onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { toast(`فشل تسجيل الدخول: ${e.message}`, "error"); }
  };
}

function renderNotAdmin() {
  $view.innerHTML = panel({
    iconName: "alert",
    title: "هذا الحساب غير مصرّح له",
    body: `<p>إذا كان هذا حسابك وتقوم بالإعداد الآن، انسخ المعرّف التالي وضعه في
        <code>ADMIN_UID</code> داخل <code>firebase-config.js</code> وفي <code>firestore.rules</code>:</p>
      <div class="row" style="flex-wrap:nowrap"><input class="ltr" id="uid" readonly value="${esc(currentUser.uid)}">
        <button id="copy-uid">${icon("copy")} نسخ</button></div>`,
  });
  document.getElementById("copy-uid").onclick = () => {
    navigator.clipboard?.writeText(currentUser.uid).then(() => toast("تم النسخ", "ok"));
  };
}

function renderTokenForm() {
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
      <label for="token">المفتاح</label>
      <input class="ltr" id="token" type="password" placeholder="github_pat_…" autocomplete="off">
      <div class="row" style="margin-top:16px">
        <button class="primary" id="save-token">حفظ ومتابعة</button>
        ${getToken() ? `<button id="cancel-token">إلغاء</button><button class="danger" id="clear-token">حذف المفتاح المحفوظ</button>` : ""}
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
      toast(`تم الاتصال بحساب ${me.login}`, "ok");
      renderUser();
      loadSites();
    } catch (e) {
      setToken("");
      toast(`المفتاح غير صالح: ${e.message}`, "error");
    }
  };
  const cancel = document.getElementById("cancel-token");
  if (cancel) cancel.onclick = loadSites;
  const clear = document.getElementById("clear-token");
  if (clear) clear.onclick = () => { setToken(""); renderUser(); renderTokenForm(); };
}

// ───── بيانات اللوحة ─────

function counts() {
  const locked = sites.filter(isLocked).length;
  return {
    all: sites.length,
    on: sites.length - locked,
    off: locked,
    unlinked: sites.filter((s) => !s.record).length,
    instant: sites.filter((s) => s.record?.instant).length,
  };
}

function filteredSites() {
  const q = ui.query.trim().toLowerCase();
  return sites.filter((s) => {
    if (ui.filter === "on" && isLocked(s)) return false;
    if (ui.filter === "off" && !isLocked(s)) return false;
    if (ui.filter === "unlinked" && s.record) return false;
    if (q && !s.repo.name.toLowerCase().includes(q) && !String(s.pages?.html_url || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

// ───── أجزاء الموقع الواحد ─────

function siteParts(s) {
  const name = s.repo.name;
  const locked = isLocked(s);
  const linked = !!s.record;
  const working = busy.has(name);
  const url = s.pages?.html_url;
  const message = drafts.get(name) ?? s.record?.message ?? DEFAULT_MESSAGE;
  const dis = working ? "disabled" : "";
  const n = esc(name);

  let actions;
  if (!linked) {
    actions = `<button class="accent btn-sm" data-act="link" data-name="${n}" ${dis}>${icon("link")} ربط بالموقع</button>`;
  } else if (locked) {
    actions = `
      <button class="success btn-sm" data-act="unlock" data-name="${n}" ${dis}>${icon("power")} تشغيل الموقع</button>
      <button class="btn-sm" data-act="update" data-name="${n}" ${dis}>${icon("edit")} تحديث الرسالة</button>`;
  } else {
    const instant = !!s.record?.instant;
    actions = `
      <button class="danger btn-sm" data-act="lock" data-name="${n}" ${dis}>${icon("power")} إطفاء الموقع</button>
      <button class="btn-sm" data-act="${instant ? "instant-off" : "instant-on"}" data-name="${n}" ${dis}>
        ${icon("zap")} ${instant ? "إزالة الإغلاق الفوري" : "تفعيل الإغلاق الفوري"}</button>`;
  }
  if (working) actions += `<span class="working"><span class="spinner"></span>جارٍ التنفيذ…</span>`;

  const source = locked
    ? `النشر الأصلي: ${s.record?.original ? describeSource(s.record.original) : "غير محفوظ"}`
    : describeSource(s.pages);

  const state = locked
    ? `<span class="state off">${icon("stop")} مغلق</span>`
    : `<span class="state on">${icon("check")} يعمل</span>`;

  const badges = `
    ${linked ? `<span class="badge neutral">${icon("link")} مربوط</span>` : `<span class="badge warn">${icon("unlink")} غير مربوط</span>`}
    ${s.record?.instant ? `<span class="badge done">${icon("zap")} إغلاق فوري</span>` : ""}
    ${s.repo.private ? `<span class="badge neutral">${icon("lock")} خاص</span>` : ""}`;

  const link = url
    ? `<a class="site-url" href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, ""))} ${icon("external")}</a>`
    : "";

  const msg = linked ? `
    <details class="msg" ${locked || drafts.has(name) ? "open" : ""}>
      <summary>${icon("edit")} سبب الإغلاق (يظهر للزوار)</summary>
      <label class="sr-only" for="msg-${n}">سبب الإغلاق</label>
      <textarea id="msg-${n}" data-msg="${n}">${esc(message)}</textarea>
    </details>` : "";

  return { name: n, locked, state, badges, link, source, actions, msg };
}

function siteRow(s) {
  const p = siteParts(s);
  return `
    <div class="box-row site-row">
      <span class="status-dot ${p.locked ? "off" : "on"}" title="${p.locked ? "مغلق" : "يعمل"}">${icon(p.locked ? "stop" : "check")}</span>
      <div>
        <div class="site-title"><h4>${p.name}</h4>${p.badges}</div>
        ${p.link}
        <div class="meta-inline">
          <span>${icon("branch")} ${esc(p.source)}</span>
          <span>${icon("clock")} آخر تحديث للمستودع ${esc(new Date(s.repo.pushed_at || s.repo.updated_at).toLocaleDateString("ar"))}</span>
        </div>
        ${p.msg}
      </div>
      <div class="actions">${p.actions}</div>
    </div>`;
}

function siteCard(s) {
  const p = siteParts(s);
  return `
    <article class="site-card ${p.locked ? "off" : "on"}">
      <div class="card-head">
        <div style="min-width:0">
          <div class="site-title"><h4>${p.name}</h4></div>
          ${p.link}
        </div>
        ${p.state}
      </div>
      <div class="meta">${p.badges}<span class="badge neutral">${icon("branch")} ${esc(p.source)}</span></div>
      ${p.msg}
      <div class="actions">${p.actions}</div>
    </article>`;
}

// ───── رسم اللوحة ─────

function statCard({ label, value, iconName, tone, foot }) {
  return `
    <div class="box stat">
      <div class="stat-top"><span>${label}</span><span class="stat-icon ${tone}">${icon(iconName)}</span></div>
      <div class="stat-value">${value}</div>
      ${foot ? `<div class="stat-foot">${foot}</div>` : ""}
    </div>`;
}

function renderStats() {
  const c = counts();
  const pct = c.all ? Math.round((c.on / c.all) * 100) : 0;
  document.getElementById("stats").innerHTML = [
    statCard({ label: "إجمالي المواقع", value: c.all, iconName: "globe", tone: "accent", foot: "منشورة على GitHub Pages" }),
    statCard({ label: "تعمل", value: c.on, iconName: "check", tone: "success",
      foot: `<div class="meter" title="${pct}%"><span class="on" style="width:${pct}%"></span></div>` }),
    statCard({ label: "مغلقة", value: c.off, iconName: "stop", tone: "danger", foot: c.off ? "تعرض صفحة الإغلاق للزوار" : "لا توجد مواقع مغلقة" }),
    statCard({ label: "غير مربوطة", value: c.unlinked, iconName: "unlink", tone: "attention", foot: `${c.instant} بإغلاق فوري مفعّل` }),
  ].join("");

  document.getElementById("sidebar-stats").innerHTML = `
    <li><span><i class="dot" style="background:var(--success)"></i>تعمل</span><b>${c.on}</b></li>
    <li><span><i class="dot" style="background:var(--danger)"></i>مغلقة</span><b>${c.off}</b></li>
    <li><span><i class="dot" style="background:var(--attention)"></i>غير مربوطة</span><b>${c.unlinked}</b></li>
    <li><span><i class="dot" style="background:var(--done)"></i>إغلاق فوري</span><b>${c.instant}</b></li>
    <li style="padding-top:10px"><div class="meter" style="flex:1">
      <span class="on" style="width:${c.all ? (c.on / c.all) * 100 : 0}%"></span>
      <span class="off" style="width:${c.all ? (c.off / c.all) * 100 : 0}%"></span></div></li>`;

  const tabs = [["all", "الكل"], ["on", "تعمل"], ["off", "مغلقة"], ["unlinked", "غير مربوطة"]];
  document.getElementById("tabs").innerHTML = tabs.map(([key, label]) => `
    <button class="tab" role="tab" data-filter="${key}" aria-selected="${ui.filter === key}">
      ${label} <span class="counter">${c[key]}</span></button>`).join("");

  const upd = document.getElementById("updated");
  if (upd) upd.textContent = ui.loadedAt ? `آخر جلب: ${timeAgo(ui.loadedAt)}` : "";
}

function renderList() {
  const $list = document.getElementById("site-list");
  const list = filteredSites();
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === ui.mode)));

  if (!sites.length) {
    $list.innerHTML = `<div class="blankslate">${icon("globe")}<h3>لا توجد مواقع</h3>
      <p>لا توجد مستودعات فيها GitHub Pages مفعّل.</p></div>`;
    return;
  }
  if (!list.length) {
    $list.innerHTML = `<div class="blankslate">${icon("search")}<h3>لا توجد نتائج</h3>
      <p>لا توجد مواقع تطابق التصفية الحالية.</p></div>`;
    return;
  }
  $list.innerHTML = ui.mode === "grid"
    ? `<div class="grid">${list.map(siteCard).join("")}</div>`
    : list.map(siteRow).join("");
}

function renderShell() {
  const u = currentUser || {};
  $view.innerHTML = `
    <div class="layout" id="dash">
      <aside class="sidebar">
        <div class="box box-body">
          <div class="profile">
            ${u.photoURL ? `<img src="${esc(u.photoURL)}" alt="">` : `<span class="auth-icon" style="margin:0;width:48px;height:48px">${icon("user")}</span>`}
            <div style="min-width:0"><b>${esc(u.displayName || "المالك")}</b><span>${esc(u.email || "")}</span></div>
          </div>
        </div>
        <div class="box">
          <div class="box-header"><h3>ملخص الحالة</h3></div>
          <div class="box-body"><ul class="side-list" id="sidebar-stats"></ul></div>
        </div>
        <div class="box">
          <div class="box-header"><h3>روابط سريعة</h3></div>
          <div class="box-body">
            <ul class="side-list">
              <li><a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">${icon("key")} مفاتيح GitHub</a></li>
              <li><a href="https://github.com/${esc(sites[0]?.repo.owner.login || "")}?tab=repositories" target="_blank" rel="noopener">${icon("branch")} المستودعات</a></li>
              <li><a href="https://www.githubstatus.com" target="_blank" rel="noopener">${icon("info")} حالة GitHub</a></li>
            </ul>
          </div>
        </div>
      </aside>

      <section class="content">
        <div class="page-head">
          <div>
            <h2>نظرة عامة</h2>
            <p>تحكّم في تشغيل وإطفاء مواقعك المنشورة على GitHub Pages.</p>
          </div>
          <div class="row">
            <span class="muted" id="updated" style="font-size:12px"></span>
            <button id="reload">${icon("refresh")} تحديث</button>
          </div>
        </div>

        <div class="stats" id="stats"></div>

        <div class="box">
          <div class="toolbar">
            <nav class="tabs" role="tablist" id="tabs"></nav>
            <div class="tools">
              <div class="search">${icon("search")}
                <input id="q" type="search" placeholder="ابحث عن موقع…" value="${esc(ui.query)}" autocomplete="off">
              </div>
              <div class="segmented" role="group" aria-label="طريقة العرض">
                <button data-mode="list" title="قائمة">${icon("list")}</button>
                <button data-mode="grid" title="بطاقات">${icon("grid")}</button>
              </div>
            </div>
          </div>
          <div id="site-list"></div>
        </div>

        <div class="footer">QB-OMNIS · ${sites.length} موقع</div>
      </section>
    </div>`;

  document.getElementById("reload").onclick = loadSites;
  document.getElementById("q").addEventListener("input", (e) => { ui.query = e.target.value; renderList(); });
}

function renderSites() {
  renderUser();
  if (!document.getElementById("dash")) renderShell();
  renderStats();
  renderList();
}

// التبويبات وطريقة العرض وحفظ المسودات
$view.addEventListener("click", (ev) => {
  const tab = ev.target.closest("[data-filter]");
  if (tab) { ui.filter = tab.dataset.filter; renderStats(); renderList(); return; }
  const mode = ev.target.closest("[data-mode]");
  if (mode) {
    ui.mode = mode.dataset.mode;
    try { localStorage.setItem(VIEW_KEY, ui.mode); } catch {}
    renderList();
  }
});
$view.addEventListener("input", (ev) => {
  const t = ev.target.closest("textarea[data-msg]");
  if (t) drafts.set(t.dataset.msg, t.value);
});

$view.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const name = btn.dataset.name;
  const act = btn.dataset.act;
  const s = sites.find((x) => x.repo.name === name);
  if (!s) return;
  const msgEl = $view.querySelector(`textarea[data-msg="${CSS.escape(name)}"]`);
  const message = (msgEl?.value || "").trim() || DEFAULT_MESSAGE;

  if (act === "lock" && !confirm(`إطفاء الموقع "${name}"؟\nسيظهر للزوار: ${message}`)) return;
  if (act === "unlock" && !confirm(`تشغيل الموقع "${name}" من جديد؟`)) return;
  if (act === "instant-on" && !confirm(
    `تفعيل الإغلاق الفوري على "${name}"؟\n\n` +
    `سيُضاف سطر واحد إلى ملفات HTML في المستودع (commit جديد).\n` +
    `إذا كانت لديك نسخة من المشروع على جهازك، اسحب التحديث (git pull) قبل أن تعدّل عليها.`)) return;
  if (act === "instant-off" && !confirm(`إزالة الإغلاق الفوري من "${name}"؟ (commit جديد في المستودع)`)) return;

  busy.add(name);
  renderSites();
  try {
    if (act === "link") {
      await linkSite(s);
      toast(`تم ربط ${name}`, "ok");
    } else if (act === "lock") {
      await lockSite(s, message);
      drafts.delete(name);
      toast(`تم إطفاء ${name}. قد يستغرق ظهور صفحة الإغلاق دقيقة أو دقيقتين.`, "ok");
    } else if (act === "update") {
      await lockSite(s, message);
      drafts.delete(name);
      toast(`تم تحديث رسالة ${name}`, "ok");
    } else if (act === "unlock") {
      const note = await unlockSite(s);
      toast(`تم تشغيل ${name}. قد يستغرق ظهور الموقع دقيقة أو دقيقتين.`, "ok");
      if (note) toast(note, "error");
    } else if (act === "instant-on" || act === "instant-off") {
      const on = act === "instant-on";
      const { count, branch } = await setInstantLock(s, on);
      toast(count
        ? `${on ? "تم تفعيل" : "تمت إزالة"} الإغلاق الفوري على ${name} (${count} ملف، فرع ${branch}). يظهر بعد إعادة نشر الموقع خلال دقيقة أو دقيقتين.`
        : `${on ? "الإغلاق الفوري مفعّل مسبقاً" : "لا يوجد سكربت لإزالته"} في ${name}.`, "ok");
    }
  } catch (e) {
    const hint = e.status === 403 || e.status === 404
      ? " (تأكد من صلاحيات مفتاح GitHub: Administration وContents وPages وActions)"
      : "";
    toast(`فشلت العملية على ${name}: ${e.message}${hint}`, "error");
  } finally {
    busy.delete(name);
    await refreshOne(name).catch(() => {});
    renderSites();
  }
});

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
