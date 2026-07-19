const state = {
  sources: [],
  filter: "all",
  selectedId: null,
  meta: { osOptions: [], archOptions: [], extOptions: [] },
  settings: null,
  addType: "github",
  addExts: [],
  addOs: [],
  addArch: [],
  checking: false,
  editId: null,
  editExts: [],
  editOs: [],
  editArch: [],
};

const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

const TOKEN_KEY = "appupdate_token";

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function showLoginGate(show, errorText) {
  const gate = $("loginGate");
  if (!gate) return;
  gate.hidden = !show;
  document.body.classList.toggle("locked", !!show);
  const err = $("loginError");
  if (err) {
    if (errorText) {
      err.hidden = false;
      err.textContent = errorText;
    } else {
      err.hidden = true;
      err.textContent = "";
    }
  }
  if (show) {
    setTimeout(() => $("loginPassword")?.focus(), 50);
  }
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    ...options,
    headers,
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    setToken("");
    showLoginGate(true, "登录已失效，请重新输入密码");
    throw new Error("未登录或登录已失效");
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

async function ensureAuth() {
  const status = await api("/api/auth/status");
  const logoutBtn = $("btnLogout");
  if (logoutBtn) logoutBtn.hidden = !status.required;
  if (!status.required) {
    showLoginGate(false);
    return true;
  }
  if (status.authenticated) {
    showLoginGate(false);
    return true;
  }
  showLoginGate(true);
  return false;
}

async function doLogin() {
  const password = ($("loginPassword")?.value || "").trim();
  if (!password) {
    showLoginGate(true, "请输入密码");
    return;
  }
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showLoginGate(true, data.detail || "密码错误");
      return;
    }
    if (data.token) setToken(data.token);
    $("loginPassword").value = "";
    showLoginGate(false);
    toast("已登录");
    await loadAll();
  } catch (e) {
    showLoginGate(true, e.message || "登录失败");
  }
}

async function doLogout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  setToken("");
  toast("已退出");
  const ok = await ensureAuth();
  if (ok) await loadAll();
  else {
    state.sources = [];
    renderAll();
  }
}

function statusLabel(item) {
  if (!item.enabled || item.status === "off") return "停用";
  if (item.status === "update" || item.hasUpdate) return "有更新";
  if (item.status === "error") return "失败";
  return "正常";
}

function statusClass(item) {
  if (!item.enabled || item.status === "off") return "status-off";
  if (item.status === "update" || item.hasUpdate) return "status-up";
  if (item.status === "error") return "status-err";
  return "status-ok";
}

function dotClass(item) {
  if (!item.enabled || item.status === "off") return "dot off";
  if (item.status === "error") return "dot err";
  if (item.status === "update" || item.hasUpdate) return "dot warn";
  return "dot";
}

function formatTime(iso) {
  if (!iso) return "尚未检查";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function parseKeywords(text) {
  return String(text || "")
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function filteredSources() {
  return state.sources.filter((s) => {
    if (state.filter === "all") return true;
    if (state.filter === "update") return s.hasUpdate || s.status === "update";
    if (state.filter === "github") return s.type === "github";
    if (state.filter === "article") return s.type === "article";
    return true;
  });
}

function renderFilters() {
  const items = [
    { id: "all", label: "全部" },
    { id: "update", label: "有更新" },
    { id: "github", label: "GitHub" },
    { id: "article", label: "文章" },
  ];
  $("filters").innerHTML = items
    .map(
      (f) =>
        `<button type="button" class="chip ${state.filter === f.id ? "on" : ""}" data-filter="${f.id}">${f.label}</button>`,
    )
    .join("");
}

function metricFacts(item) {
  if (item.type === "github") {
    const matched = (item.assets || []).length;
    const unmatched = (item.unmatchedAssets || []).length;
    const total = matched + unmatched;
    const version = item.version || "尚未检查";
    const matchText =
      total > 0
        ? `匹配 ${matched}${total !== matched ? ` / ${total}` : ""} 个文件`
        : matched > 0
          ? `匹配 ${matched} 个文件`
          : item.lastCheck
            ? "无匹配文件"
            : "等待检查";
    return `
      <div class="facts">
        <div class="fact-main ${item.hasUpdate || item.status === "update" ? "warn" : ""}">${escapeHtml(version)}</div>
        <div class="fact-sub">${escapeHtml(matchText)}</div>
      </div>`;
  }
  const disks = item.netdisks || [];
  const providers = [...new Set(disks.map((d) => d.provider).filter(Boolean))];
  const title = item.title || item.version || "尚未检查";
  const short =
    title.length > 28 ? `${title.slice(0, 28)}…` : title;
  const diskText = disks.length
    ? `${disks.length} 个网盘${providers.length ? " · " + providers.slice(0, 3).join("/") : ""}`
    : item.lastCheck
      ? "未发现网盘"
      : "等待检查";
  return `
    <div class="facts">
      <div class="fact-main ${item.hasUpdate || item.status === "update" ? "warn" : ""}" title="${escapeHtml(title)}">${escapeHtml(short)}</div>
      <div class="fact-sub">${escapeHtml(diskText)}</div>
    </div>`;
}

function renderList() {
  const list = filteredSources();
  const enabled = state.sources.filter((s) => s.enabled).length;
  $("onlineBadge").querySelector("span").textContent = `${enabled} 启用`;
  $("onlineBadge").classList.toggle("warn", state.sources.some((s) => s.hasUpdate));
  $("statsText").textContent = `共 ${state.sources.length} 项 · 显示 ${list.length} 项`;

  if (!list.length) {
    $("rows").innerHTML = `<div class="empty">还没有追踪项。点右上角「添加」开始。</div>`;
    return;
  }

  $("rows").innerHTML = list
    .map((item) => {
      const active = item.id === state.selectedId ? "active" : "";
      const detail =
        item.id === state.selectedId
          ? `<div class="row-detail" data-stop data-detail-id="${item.id}">${buildDetailHtml(item)}</div>`
          : "";
      return `
      <div class="row ${active}" data-id="${item.id}">
        <div><span class="${dotClass(item)}"></span></div>
        <div>
          <div class="name">${escapeHtml(item.name)}</div>
          <div class="sub">${escapeHtml(formatTime(item.lastCheck))} · ${escapeHtml(item.url)}</div>
        </div>
        <div><span class="tag">${item.type === "github" ? "GitHub" : "文章"}</span></div>
        <div>${metricFacts(item)}</div>
        <div class="${statusClass(item)}">${statusLabel(item)}</div>
        <div class="row-actions" data-stop>
          <button type="button" class="link-btn" data-act="check" data-id="${item.id}">检查</button>
          <button type="button" class="link-btn" data-act="edit" data-id="${item.id}">编辑</button>
          <button type="button" class="link-btn" data-act="toggle" data-id="${item.id}">${item.enabled ? "停用" : "启用"}</button>
          <button type="button" class="link-btn danger" data-act="del" data-id="${item.id}">删除</button>
        </div>
      </div>${detail}`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制");
  } catch {
    toast("复制失败");
  }
}

function buildDetailHtml(item) {
  let body = "";
  if (item.type === "github") {
    const assets = item.assets || [];
    const unmatched = item.unmatchedAssets || [];
    body += `
      <div class="rule-box">
        <div class="rule-title">筛选规则（别名自动扩展）</div>
        <div class="rule-text">${escapeHtml(item.ruleText || "未设置")}</div>
        <div class="rule-hint">系统/架构用别名匹配；文件名没写系统时按扩展名推断。仍漏可用包含/排除关键词。</div>
        <div style="margin-top:8px"><button type="button" class="link-btn" data-act="edit-detail" data-id="${item.id}">编辑规则</button></div>
      </div>
      <div class="section-label">匹配结果 ${assets.length}${item.unmatchedAssets ? ` / ${assets.length + unmatched.length}` : ""}</div>
    `;
    if (!assets.length) {
      body += `<div class="empty" style="padding:16px 0">暂无匹配到的下载文件。可放宽筛选或稍后再检查。</div>`;
    } else {
      body += assets
        .map(
          (a) => `
        <div class="asset">
          <code>${escapeHtml(a.name)}</code>
          <div class="row-actions">
            <button type="button" class="link-btn" data-copy="${escapeHtml(a.url)}">复制</button>
            <a class="link-btn" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">打开</a>
          </div>
        </div>`,
        )
        .join("");
    }
    if (unmatched.length) {
      body += `<div class="section-label muted-label">未匹配（便于核对漏项）</div>`;
      body += unmatched
        .map(
          (a) => `
        <div class="asset dim">
          <code>${escapeHtml(a.name)}</code>
          <span class="miss-tag">未匹配</span>
        </div>`,
        )
        .join("");
    }
  } else {
    const disks = item.netdisks || [];
    body += `<div class="section-label">当前标题</div><div>${escapeHtml(item.title || item.version || "-")}</div>`;
    body += `<div class="section-label">网盘 ${disks.length}</div>`;
    if (!disks.length) {
      body += `<div class="empty" style="padding:16px 0">未发现网盘链接</div>`;
    } else {
      body += disks
        .map(
          (d) => `
        <div class="netdisk">
          <div class="provider">${escapeHtml(d.provider)} · ${escapeHtml(d.title || "")}</div>
          <div class="meta">${d.code ? "提取码 " + escapeHtml(d.code) : "无提取码"}</div>
          <div class="url-line">${escapeHtml(d.url)}</div>
          <div class="row-actions">
            <button type="button" class="link-btn" data-copy="${escapeHtml(d.url)}">复制链接</button>
            ${d.code ? `<button type="button" class="link-btn" data-copy="${escapeHtml(d.code)}">复制提取码</button>` : ""}
            <a class="link-btn" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">打开</a>
          </div>
        </div>`,
        )
        .join("");
    }
  }

  if (item.lastError) {
    body += `<div class="section-label">最近错误</div><div class="status-err">${escapeHtml(item.lastError)}</div>`;
  }

  return `
    <div class="detail">
      <div class="detail-head">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <div class="url">${escapeHtml(item.url)}</div>
        </div>
        <div class="detail-actions">
          <button type="button" class="switch ${item.enabled ? "on" : ""}" data-act="toggle" data-id="${item.id}" aria-label="启用停用"></button>
          <button type="button" class="icon-btn" data-act="close-detail" aria-label="关闭详情">×</button>
        </div>
      </div>
      <div class="kv">
        <span>类型</span><div>${item.type === "github" ? "GitHub" : "文章"}</div>
        <span>状态</span><div class="${statusClass(item)}">${statusLabel(item)}</div>
        <span>上次检查</span><div>${escapeHtml(formatTime(item.lastCheck))}</div>
        <span>Telegram</span><div>${state.settings?.telegramConfigured ? "有更新时推送" : "未配置"}</div>
      </div>
      ${body}
    </div>`;
}

function renderDetail() {
  // 详情已并入列表行下方，保留此函数兼容旧调用
  renderList();
}

function renderAll() {
  renderFilters();
  renderList();
}

async function loadAll() {
  const [sources, settings, meta] = await Promise.all([
    api("/api/sources"),
    api("/api/settings"),
    api("/api/sources/meta/filters"),
  ]);
  state.sources = sources;
  state.settings = settings;
  state.meta = meta;
  // 不自动展开详情：只有用户点选时才显示
  if (state.selectedId != null && !sources.find((s) => s.id === state.selectedId)) {
    state.selectedId = null;
  }
  renderAll();
  renderAddChips();
}

function renderAddChips() {
  const make = (containerId, options, selected, key) => {
    const el = $(containerId);
    if (!el) return;
    el.innerHTML = options
      .map((opt) => {
        const id = typeof opt === "string" ? opt : opt.id;
        const label = typeof opt === "string" ? opt : opt.label;
        const on = selected.includes(id) ? "on" : "";
        return `<button type="button" class="mini-chip ${on}" data-key="${key}" data-id="${id}">${label}</button>`;
      })
      .join("");
  };
  make("extChips", state.meta.extOptions || [], state.addExts, "ext");
  make("osChips", state.meta.osOptions || [], state.addOs, "os");
  make("archChips", state.meta.archOptions || [], state.addArch, "arch");
}

function toggleChip(key, id) {
  const map = { ext: "addExts", os: "addOs", arch: "addArch" };
  const field = map[key];
  const arr = state[field];
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(id);
  renderAddChips();
}


function renderEditChips() {
  const make = (containerId, options, selected, key) => {
    const el = $(containerId);
    if (!el) return;
    el.innerHTML = options
      .map((opt) => {
        const id = typeof opt === "string" ? opt : opt.id;
        const label = typeof opt === "string" ? opt : opt.label;
        const on = selected.includes(id) ? "on" : "";
        return `<button type="button" class="mini-chip ${on}" data-edit-key="${key}" data-id="${id}">${label}</button>`;
      })
      .join("");
  };
  make("editExtChips", state.meta.extOptions || [], state.editExts, "ext");
  make("editOsChips", state.meta.osOptions || [], state.editOs, "os");
  make("editArchChips", state.meta.archOptions || [], state.editArch, "arch");
}

function toggleEditChip(key, id) {
  const map = { ext: "editExts", os: "editOs", arch: "editArch" };
  const field = map[key];
  const arr = state[field];
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(id);
  renderEditChips();
}

function openEdit(id) {
  const item = state.sources.find((s) => s.id === id);
  if (!item) return;
  state.editId = id;
  $("editName").value = item.name || "";
  const isGh = item.type === "github";
  $("editGithubFields").style.display = isGh ? "block" : "none";
  $("editArticleHint").hidden = isGh;
  if (isGh) {
    const rule = item.filterRule || {};
    state.editExts = [...(rule.exts || [])];
    state.editOs = [...(rule.osIds || [])];
    state.editArch = [...(rule.archIds || [])];
    $("editInclude").value = (rule.include || []).join(", ");
    $("editExclude").value = (rule.exclude || []).join(", ");
    $("editPrerelease").checked = item.includePrerelease !== false;
    renderEditChips();
  }
  $("editModal").classList.add("show");
}

async function submitEdit() {
  const id = state.editId;
  const item = state.sources.find((s) => s.id === id);
  if (!item) return;
  const body = { name: $("editName").value.trim() || item.name };
  if (item.type === "github") {
    body.includePrerelease = $("editPrerelease").checked;
    body.filterRule = {
      exts: [...state.editExts],
      osIds: [...state.editOs],
      archIds: [...state.editArch],
      include: parseKeywords($("editInclude").value),
      exclude: parseKeywords($("editExclude").value),
    };
  }
  try {
    await api(`/api/sources/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    $("editModal").classList.remove("show");
    toast("已保存，正在检查…");
    await api(`/api/check?sourceId=${id}`, { method: "POST" });
    await loadAll();
    state.selectedId = id;
    renderAll();
    toast("检查完成");
  } catch (e) {
    toast(e.message || "保存失败");
  }
}


function openAdd() {
  state.addType = "github";
  state.addExts = [".dmg"];
  state.addOs = ["macos"];
  state.addArch = ["arm64"];
  $("addUrl").value = "";
  $("addName").value = "";
  $("addInclude").value = "";
  $("addExclude").value = "";
  $("addPrerelease").checked = true;
  syncAddTypeUI();
  renderAddChips();
  $("addModal").classList.add("show");
}

function syncAddTypeUI() {
  document.querySelectorAll("#addModal .type-tabs .mini-chip").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.type === state.addType);
  });
  const gh = state.addType === "github";
  $("githubFields").style.display = gh ? "block" : "none";
  $("urlLabel").textContent = gh ? "GitHub 仓库完整地址" : "文章完整链接";
  $("addUrl").placeholder = gh
    ? "https://github.com/owner/repo"
    : "https://example.com/post/123";
}

async function submitAdd() {
  const url = $("addUrl").value.trim();
  if (!url) return toast("请填写地址");
  const body = {
    type: state.addType,
    url,
    name: $("addName").value.trim(),
    enabled: true,
  };
  if (state.addType === "github") {
    body.includePrerelease = $("addPrerelease").checked;
    body.filterRule = {
      exts: [...state.addExts],
      osIds: [...state.addOs],
      archIds: [...state.addArch],
      include: parseKeywords($("addInclude").value),
      exclude: parseKeywords($("addExclude").value),
    };
  }
  try {
    const created = await api("/api/sources", { method: "POST", body: JSON.stringify(body) });
    $("addModal").classList.remove("show");
    toast("已添加，正在检查…");
    await api(`/api/check?sourceId=${created.id}`, { method: "POST" });
    await loadAll();
    state.selectedId = created.id;
    renderAll();
    toast("检查完成");
  } catch (e) {
    toast(e.message || "添加失败");
  }
}

function openSettings() {
  const s = state.settings || {};
  $("setInterval").value = s.intervalHours || 6;
  $("setToken").value = "";
  $("setChatId").value = s.chatId || "";
  $("tokenHint").textContent = s.hasToken
    ? `已保存 Token ${s.tokenMasked || ""}，留空则不修改`
    : "尚未配置 Token";
  if ($("setPanelPassword")) $("setPanelPassword").value = "";
  if ($("clearPanelPassword")) $("clearPanelPassword").checked = false;
  if ($("panelPasswordHint")) {
    $("panelPasswordHint").textContent = s.hasPanelPassword
      ? "已启用访问密码。填写新密码可更换；勾选下方可关闭保护"
      : "未设置时任何人可访问；设置后打开面板需输入密码";
  }
  $("settingsModal").classList.add("show");
}

async function submitSettings() {
  const body = {
    intervalHours: Number($("setInterval").value || 6),
    chatId: $("setChatId").value.trim(),
  };
  const token = $("setToken").value.trim();
  if (token) body.botToken = token;
  const clearPw = $("clearPanelPassword")?.checked;
  const panelPw = ($("setPanelPassword")?.value || "").trim();
  if (clearPw) body.clearPanelPassword = true;
  else if (panelPw) body.panelPassword = panelPw;
  try {
    state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
    $("settingsModal").classList.remove("show");
    toast("设置已保存");
    // password change invalidates sessions
    if (clearPw || panelPw) {
      setToken("");
      const ok = await ensureAuth();
      if (ok) {
        await loadAll();
      } else {
        state.sources = [];
        renderAll();
        if (panelPw) showLoginGate(true, "密码已更新，请用新密码登录");
      }
    } else {
      renderDetail();
      const logoutBtn = $("btnLogout");
      if (logoutBtn) logoutBtn.hidden = !state.settings.hasPanelPassword;
    }
  } catch (e) {
    toast(e.message || "保存失败");
  }
}

async function checkNow(sourceId) {
  if (state.checking) return;
  state.checking = true;
  $("btnCheck").classList.add("checking");
  $("btnCheck").disabled = true;
  try {
    const q = sourceId ? `?sourceId=${sourceId}` : "";
    const result = await api(`/api/check${q}`, { method: "POST" });
    await loadAll();
    toast(`检查完成：${result.checked} 项，更新 ${result.updated}，失败 ${result.errors}`);
  } catch (e) {
    toast(e.message || "检查失败");
  } finally {
    state.checking = false;
    $("btnCheck").classList.remove("checking");
    $("btnCheck").disabled = false;
  }
}

async function toggleEnabled(id) {
  const item = state.sources.find((s) => s.id === id);
  if (!item) return;
  try {
    await api(`/api/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !item.enabled }),
    });
    await loadAll();
  } catch (e) {
    toast(e.message || "操作失败");
  }
}

async function deleteSource(id) {
  if (!confirm("确定删除这个追踪项？")) return;
  try {
    await api(`/api/sources/${id}`, { method: "DELETE" });
    if (state.selectedId === id) state.selectedId = null;
    await loadAll();
    toast("已删除");
  } catch (e) {
    toast(e.message || "删除失败");
  }
}

function bindEvents() {
  $("btnAdd").onclick = openAdd;
  $("btnCheck").onclick = () => checkNow();
  $("btnSettings").onclick = openSettings;
  if ($("btnLogout")) $("btnLogout").onclick = doLogout;
  if ($("loginSubmit")) $("loginSubmit").onclick = doLogin;
  if ($("loginPassword")) {
    $("loginPassword").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
  }
  $("addCancel").onclick = () => $("addModal").classList.remove("show");
  $("editCancel").onclick = () => $("editModal").classList.remove("show");
  $("editSubmit").onclick = submitEdit;
  ["editExtChips", "editOsChips", "editArchChips"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".mini-chip");
      if (!btn) return;
      toggleEditChip(btn.dataset.editKey, btn.dataset.id);
    });
  });
  $("setCancel").onclick = () => $("settingsModal").classList.remove("show");
  $("addSubmit").onclick = submitAdd;
  $("setSubmit").onclick = submitSettings;
  $("tgTest").onclick = async () => {
    try {
      // save chat first if filled
      await submitSettings();
      const r = await api("/api/settings/telegram/test", { method: "POST" });
      toast(r.message || "已发送");
    } catch (e) {
      toast(e.message || "测试失败");
    }
  };

  document.querySelectorAll("#addModal .type-tabs .mini-chip").forEach((btn) => {
    btn.onclick = () => {
      state.addType = btn.dataset.type;
      syncAddTypeUI();
    };
  });

  ["extChips", "osChips", "archChips"].forEach((id) => {
    $(id).addEventListener("click", (e) => {
      const btn = e.target.closest(".mini-chip");
      if (!btn) return;
      toggleChip(btn.dataset.key, btn.dataset.id);
    });
  });

  $("filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    renderAll();
  });

  $("rows").addEventListener("click", (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      e.stopPropagation();
      copyText(copy.getAttribute("data-copy"));
      return;
    }
    const actBtn = e.target.closest("[data-act]");
    if (actBtn) {
      e.stopPropagation();
      const id = Number(actBtn.dataset.id);
      const act = actBtn.dataset.act;
      if (act === "close-detail") {
        state.selectedId = null;
        renderAll();
        return;
      }
      if (act === "check") checkNow(id);
      if (act === "edit" || act === "edit-detail") openEdit(id);
      if (act === "toggle") toggleEnabled(id);
      if (act === "del") deleteSource(id);
      return;
    }
    // 详情区域内的空白点击不切换行
    if (e.target.closest(".row-detail")) return;
    const stop = e.target.closest("[data-stop]");
    if (stop) return;
    const row = e.target.closest(".row[data-id]");
    if (!row) return;
    const id = Number(row.dataset.id);
    // 再点同一行则收起详情
    state.selectedId = state.selectedId === id ? null : id;
    renderAll();
    if (state.selectedId != null) {
      const panel = document.querySelector(`.row-detail[data-detail-id="${state.selectedId}"]`);
      if (panel) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });

  [$("addModal"), $("settingsModal"), $("editModal")].forEach((mask) => {
    mask.addEventListener("click", (e) => {
      if (e.target === mask) mask.classList.remove("show");
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.querySelector(".modal-mask.show, .login-gate:not([hidden])")) return;
    if (state.selectedId == null) return;
    state.selectedId = null;
    renderAll();
  });
}

bindEvents();
(async () => {
  try {
    const ok = await ensureAuth();
    if (ok) await loadAll();
  } catch (e) {
    toast(e.message || "加载失败");
  }
})();
