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
  el.textContent = text;
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
  $view.innerHTML = `<div class="center muted">جارٍ جلب المستودعات من GitHub…</div>`;
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
    renderSites();
  } catch (e) {
    if (e.status === 401) {
      setToken("");
      toast("مفتاح GitHub غير صالح أو منتهي. أدخل مفتاحاً جديداً.", "error");
      renderTokenForm();
      return;
    }
    $view.innerHTML = `<div class="card narrow"><h2>حدث خطأ</h2><p>${esc(e.message)}</p>
      <button class="primary" id="retry">إعادة المحاولة</button></div>`;
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

function renderUser() {
  if (!currentUser) { $user.innerHTML = ""; return; }
  $user.innerHTML = `
    ${currentUser.photoURL ? `<img src="${esc(currentUser.photoURL)}" alt="">` : ""}
    <span class="muted">${esc(currentUser.displayName || currentUser.email || "")}</span>
    ${getToken() ? `<button class="ghost" id="change-token">مفتاح GitHub</button>` : ""}
    <button class="ghost" id="logout">خروج</button>`;
  document.getElementById("logout").onclick = () => signOut(auth);
  const ct = document.getElementById("change-token");
  if (ct) ct.onclick = renderTokenForm;
}

function renderSetupNeeded() {
  $view.innerHTML = `
    <div class="card narrow">
      <h2>الإعداد غير مكتمل</h2>
      <p>افتح ملف <code>firebase-config.js</code> وضع إعدادات مشروع Firebase الخاص بك، ثم ارفع الملف من جديد.</p>
      <p class="muted">الخطوات الكاملة موجودة في ملف <code>README.md</code>.</p>
    </div>`;
}

function renderSignIn() {
  $view.innerHTML = `
    <div class="card narrow center">
      <h2>تسجيل الدخول</h2>
      <p class="muted">هذه اللوحة خاصة بمالكها فقط.</p>
      <button class="primary" id="login">الدخول بحساب Google</button>
    </div>`;
  document.getElementById("login").onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { toast(`فشل تسجيل الدخول: ${e.message}`, "error"); }
  };
}

function renderNotAdmin() {
  $view.innerHTML = `
    <div class="card narrow">
      <h2>هذا الحساب غير مصرّح له</h2>
      <p>إذا كان هذا حسابك وتقوم بالإعداد الآن، انسخ المعرّف التالي وضعه في
        <code>ADMIN_UID</code> داخل <code>firebase-config.js</code> وفي <code>firestore.rules</code>:</p>
      <div class="row"><input class="ltr" id="uid" readonly value="${esc(currentUser.uid)}">
        <button id="copy-uid">نسخ</button></div>
    </div>`;
  document.getElementById("copy-uid").onclick = () => {
    navigator.clipboard?.writeText(currentUser.uid).then(() => toast("تم النسخ", "ok"));
  };
}

function renderTokenForm() {
  $view.innerHTML = `
    <div class="card narrow">
      <h2>مفتاح GitHub</h2>
      <p>تحتاج اللوحة مفتاح <b>Fine-grained token</b> لتتحكم بإعدادات GitHub Pages.
        المفتاح يُحفظ في هذا المتصفح فقط ولا يُرسل إلى أي مكان غير GitHub.</p>
      <ol>
        <li>افتح <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">إنشاء مفتاح جديد</a>.</li>
        <li><b>Repository access:</b> All repositories (أو اختر مواقعك فقط).</li>
        <li><b>Permissions</b> (Read and write): Administration، Contents، Pages، Actions.</li>
        <li>حدّد تاريخ انتهاء، ثم انسخ المفتاح والصقه هنا.</li>
      </ol>
      <label for="token">المفتاح</label>
      <input class="ltr" id="token" type="password" placeholder="github_pat_…" autocomplete="off">
      <div class="row" style="margin-top:12px">
        <button class="primary" id="save-token">حفظ ومتابعة</button>
        ${getToken() ? `<button id="cancel-token">إلغاء</button><button class="ghost" id="clear-token">حذف المفتاح المحفوظ</button>` : ""}
      </div>
    </div>`;
  document.getElementById("save-token").onclick = async () => {
    const t = document.getElementById("token").value.trim();
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

function siteCard(s) {
  const name = s.repo.name;
  const locked = isLocked(s);
  const linked = !!s.record;
  const working = busy.has(name);
  const url = s.pages?.html_url;
  const message = s.record?.message || DEFAULT_MESSAGE;

  const status = locked
    ? `<span class="badge off">مغلق</span>`
    : `<span class="badge on">يعمل</span>`;

  let actions;
  if (!linked) {
    actions = `<button class="primary" data-act="link" data-name="${esc(name)}" ${working ? "disabled" : ""}>ربط بالموقع</button>`;
  } else if (locked) {
    actions = `
      <button class="success" data-act="unlock" data-name="${esc(name)}" ${working ? "disabled" : ""}>تشغيل الموقع</button>
      <button data-act="update" data-name="${esc(name)}" ${working ? "disabled" : ""}>تحديث الرسالة</button>`;
  } else {
    const instantAct = s.record?.instant ? "instant-off" : "instant-on";
    const instantLabel = s.record?.instant ? "إزالة الإغلاق الفوري" : "⚡ تفعيل الإغلاق الفوري";
    actions = `
      <button class="danger" data-act="lock" data-name="${esc(name)}" ${working ? "disabled" : ""}>إطفاء الموقع</button>
      <button class="ghost" data-act="${instantAct}" data-name="${esc(name)}" ${working ? "disabled" : ""}>${instantLabel}</button>`;
  }

  return `
    <article class="card site">
      <div class="site-head">
        <div>
          <h3>${esc(name)}</h3>
          ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : ""}
        </div>
        ${status}
      </div>
      <div class="meta">
        <span class="badge neutral">${locked ? "النشر الأصلي: " + esc(s.record?.original ? describeSource(s.record.original) : "غير محفوظ") : esc(describeSource(s.pages))}</span>
        ${linked ? `<span class="badge neutral">مربوط</span>` : `<span class="badge warn">غير مربوط</span>`}
        ${s.record?.instant ? `<span class="badge on">⚡ إغلاق فوري</span>` : ""}
        ${s.repo.private ? `<span class="badge neutral">خاص</span>` : ""}
      </div>
      ${linked ? `
        <div>
          <label for="msg-${esc(name)}">سبب الإغلاق (يظهر للزوار)</label>
          <textarea id="msg-${esc(name)}" data-msg="${esc(name)}">${esc(message)}</textarea>
        </div>` : ""}
      <div class="actions">
        ${actions}
        ${working ? `<span class="muted">جارٍ التنفيذ…</span>` : ""}
      </div>
    </article>`;
}

function renderSites() {
  renderUser();
  const lockedCount = sites.filter(isLocked).length;
  $view.innerHTML = `
    <div class="toolbar">
      <h2>المواقع المنشورة على GitHub Pages</h2>
      <div class="stats">
        <span class="badge neutral">الكل: ${sites.length}</span>
        <span class="badge on">تعمل: ${sites.length - lockedCount}</span>
        <span class="badge off">مغلقة: ${lockedCount}</span>
        <button id="reload">تحديث</button>
      </div>
    </div>
    ${sites.length
      ? `<div class="grid">${sites.map(siteCard).join("")}</div>`
      : `<div class="card center muted">لا توجد مستودعات فيها GitHub Pages مفعّل.</div>`}`;
  document.getElementById("reload").onclick = loadSites;
}

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
      toast(`تم إطفاء ${name}. قد يستغرق ظهور صفحة الإغلاق دقيقة أو دقيقتين.`, "ok");
    } else if (act === "update") {
      await lockSite(s, message);
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
