const state = {
  sources: [],
  filter: "all",
  selectedId: null,
  openMenuId: null,
  checkedIds: {},
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
  tgDetail: "compact",
};

const $ = (id) => document.getElementById(id);

function typeLabel(type) {
  if (type === "github") return "GitHub";
  if (type === "netdisk") return "网盘";
  return "文章";
}

function tgMetaLabel() {
  return state.settings?.telegramConfigured ? "TG 已开" : "TG 未配";
}

function detectAddType(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("github.com") || lower.startsWith("git@github.com:")) return "github";

  // netdisk hosts / patterns (align with backend providers)
  const netdiskHints = [
    "pan.baidu.com",
    "yun.baidu.com",
    "alipan.com",
    "aliyundrive.com",
    "pan.quark.cn",
    "123pan.com",
    "123684.com",
    "123865.com",
    "123912.com",
    "cloud.189.cn",
    "lanzou",
    "lanoso.com",
  ];
  if (netdiskHints.some((h) => lower.includes(h))) return "netdisk";
  if (/^https?:\/\//i.test(raw)) return "article";
  return null;
}

function extractShareCodeFromUrl(url) {
  const m = String(url || "").match(/[?&](?:pwd|password|code)=([A-Za-z0-9]+)/i);
  return m ? m[1] : "";
}

function applyUrlAutoDetect() {
  const input = $("addUrl");
  if (!input) return;
  const url = input.value.trim();
  const detected = detectAddType(url);
  if (!detected) return;
  if (state.addType !== detected) {
    state.addType = detected;
    syncAddTypeUI();
  }
  if (detected === "netdisk") {
    const code = extractShareCodeFromUrl(url);
    const codeEl = $("addShareCode");
    if (codeEl && code && !codeEl.value.trim()) {
      codeEl.value = code;
    }
  }
}

function netdiskProbe(item) {
  const d0 = (item.netdisks || [])[0] || {};
  const mode = d0.mode || item.probeMode || "";
  if (mode === "fingerprint") {
    return { mode: "fingerprint", label: d0.modeLabel || "页面指纹", weak: true };
  }
  if (mode === "list") {
    return { mode: "list", label: d0.modeLabel || "文件列表", weak: false };
  }
  // legacy rows before mode field
  if (item.type === "netdisk" && item.lastCheck) {
    if ((item.summary || "").includes("页面指纹")) {
      return { mode: "fingerprint", label: "页面指纹", weak: true };
    }
    return { mode: "list", label: "文件列表", weak: false };
  }
  return { mode: "", label: "", weak: false };
}

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

function shortError(item, maxLen = 36) {
  let msg = String(item.lastError || item.summary || "检查失败").trim();
  msg = msg.replace(/^Client error '[^']*' for url '[^']*'\s*/i, "");
  msg = msg.replace(/^检查失败[：:]\s*/i, "");
  msg = msg.replace(/\s*For more information check:.*$/i, "");
  msg = msg.replace(/\s+/g, " ");
  if (!msg) msg = "检查失败";
  return msg.length > maxLen ? msg.slice(0, maxLen - 1) + "…" : msg;
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

function shortUrl(url) {
  try {
    const u = new URL(url);
    const path = (u.pathname || "/").replace(/\/+$/, "") || "";
    const shortPath = path.length > 28 ? path.slice(0, 26) + "…" : path;
    return u.host + (shortPath && shortPath !== "/" ? shortPath : "");
  } catch {
    const s = String(url || "");
    return s.length > 42 ? s.slice(0, 40) + "…" : s;
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
    if (state.filter === "netdisk") return s.type === "netdisk";
    return true;
  });
}

function renderEmptyState() {
  // 有数据但被筛选滤空
  if (state.sources.length > 0) {
    const filterLabel =
      { all: "全部", update: "有更新", github: "GitHub", article: "文章", netdisk: "网盘" }[state.filter] ||
      state.filter;
    return `
      <div class="empty-state">
        <div class="empty-title">「${escapeHtml(filterLabel)}」下没有项目</div>
        <div class="empty-desc">换个筛选，或添加新的追踪项。</div>
        <div class="empty-actions">
          <button type="button" class="pill" data-empty-act="filter-all">查看全部</button>
          <button type="button" class="pill primary" data-empty-act="add">添加</button>
        </div>
      </div>`;
  }

  return `
    <div class="empty-state">
      <div class="empty-title">还没有追踪项</div>
      <div class="empty-desc">添加后会定时检查：GitHub 新版本、文章网盘变化、分享页文件更新。有变化时可推 Telegram。</div>
      <div class="empty-cards">
        <button type="button" class="empty-card" data-empty-act="sample-github">
          <span class="empty-card-tag">GitHub</span>
          <span class="empty-card-title">仓库 Release</span>
          <span class="empty-card-desc">按扩展名 / 系统 / 架构筛下载附件</span>
        </button>
        <button type="button" class="empty-card" data-empty-act="sample-article">
          <span class="empty-card-tag">文章</span>
          <span class="empty-card-title">博客页面</span>
          <span class="empty-card-desc">盯标题变化，抓页内网盘链接与提取码</span>
        </button>
        <button type="button" class="empty-card" data-empty-act="sample-netdisk">
          <span class="empty-card-tag">网盘</span>
          <span class="empty-card-title">分享链接</span>
          <span class="empty-card-desc">直接监控分享文件列表（可选提取码）</span>
        </button>
      </div>
      <div class="empty-actions">
        <button type="button" class="pill primary" data-empty-act="add">添加追踪</button>
      </div>
    </div>`;
}

function openAddSample(kind) {
  openAdd();
  if (kind === "github") {
    state.addType = "github";
    state.addExts = [".dmg", ".zip"];
    state.addOs = ["macos"];
    state.addArch = ["arm64"];
    $("addUrl").value = "https://github.com/cli/cli";
    $("addName").value = "示例 · GitHub CLI";
    if ($("addInclude")) $("addInclude").value = "";
    if ($("addExclude")) $("addExclude").value = "";
    if ($("addPrerelease")) $("addPrerelease").checked = true;
  } else if (kind === "article") {
    state.addType = "article";
    $("addUrl").value = "https://example.com/your-post";
    $("addName").value = "示例 · 文章";
  } else if (kind === "netdisk") {
    state.addType = "netdisk";
    $("addUrl").value = "https://pan.baidu.com/s/1xxxxxxxx?pwd=abcd";
    $("addName").value = "示例 · 网盘分享";
    if ($("addShareCode")) $("addShareCode").value = "abcd";
  }
  syncAddTypeUI();
  renderAddChips();
  toast("已填入示例，改成你的地址后保存即可");
  setTimeout(() => $("addUrl")?.focus(), 50);
}

function checkedIdList() {
  return Object.keys(state.checkedIds)
    .map((x) => Number(x))
    .filter((id) => state.checkedIds[id] && state.sources.some((s) => s.id === id));
}

function setChecked(id, on) {
  if (on) state.checkedIds[id] = true;
  else delete state.checkedIds[id];
}

function clearChecked() {
  state.checkedIds = {};
}

function pruneChecked() {
  const alive = new Set(state.sources.map((s) => s.id));
  for (const k of Object.keys(state.checkedIds)) {
    if (!alive.has(Number(k))) delete state.checkedIds[k];
  }
}

function renderBulkBar() {
  const bar = $("bulkBar");
  const failedBtn = $("btnCheckFailed");
  const failedCount = state.sources.filter(
    (s) => s.enabled && (s.status === "error" || s.lastError),
  ).length;
  if (failedBtn) {
    failedBtn.hidden = failedCount === 0;
    failedBtn.textContent = failedCount ? `检查失败项 (${failedCount})` : "检查失败项";
  }
  if (!bar) return;
  const ids = checkedIdList();
  const n = ids.length;
  bar.hidden = n === 0;
  if ($("bulkCount")) $("bulkCount").textContent = `已选 ${n} 项`;
  const list = filteredSources();
  const allChecked = list.length > 0 && list.every((s) => state.checkedIds[s.id]);
  if ($("bulkSelectAll")) $("bulkSelectAll").checked = allChecked;
  if ($("headSelectAll")) $("headSelectAll").checked = allChecked;
}

function renderFilters() {
  const items = [
    { id: "all", label: "全部" },
    { id: "update", label: "有更新" },
    { id: "github", label: "GitHub" },
    { id: "article", label: "文章" },
    { id: "netdisk", label: "网盘" },
  ];
  $("filters").innerHTML = items
    .map(
      (f) =>
        `<button type="button" class="chip ${state.filter === f.id ? "on" : ""}" data-filter="${f.id}">${f.label}</button>`,
    )
    .join("");
}

function metricFacts(item) {
  if (item.status === "error") {
    const err = shortError(item);
    return `
      <div class="facts">
        <div class="fact-main fact-err" title="${escapeHtml(item.lastError || err)}">${escapeHtml(err)}</div>
        <div class="fact-sub">检查失败 · 可重试</div>
      </div>`;
  }
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
  if (item.type === "netdisk") {
    const files = item.assets || [];
    const title = item.title || item.version || "尚未检查";
    const short = title.length > 28 ? `${title.slice(0, 28)}…` : title;
    const probe = netdiskProbe(item);
    let sub = "等待检查";
    if (item.lastCheck) {
      const count = files.length ? `${files.length} 个文件/文件夹` : "已检查";
      sub = probe.label ? `${count} · ${probe.label}` : count;
    }
    return `
    <div class="facts">
      <div class="fact-main ${item.hasUpdate || item.status === "update" ? "warn" : ""}" title="${escapeHtml(title)}">${escapeHtml(short)}</div>
      <div class="fact-sub">${escapeHtml(sub)}${probe.weak ? ' <span class="probe-pill weak">指纹</span>' : probe.mode === "list" ? ' <span class="probe-pill">列表</span>' : ""}</div>
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
  pruneChecked();
  const enabled = state.sources.filter((s) => s.enabled).length;
  $("onlineBadge").querySelector("span").textContent = `${enabled} 启用`;
  $("onlineBadge").classList.toggle("warn", state.sources.some((s) => s.hasUpdate));
  $("statsText").textContent = `共 ${state.sources.length} 项 · 显示 ${list.length} 项`;
  renderBulkBar();

  if (!list.length) {
    $("rows").innerHTML = renderEmptyState();
    return;
  }

  $("rows").innerHTML = list
    .map((item) => {
      const active = item.id === state.selectedId ? "active" : "";
      const checked = state.checkedIds[item.id] ? "checked" : "";
      const detail =
        item.id === state.selectedId
          ? `<div class="row-detail" data-stop data-detail-id="${item.id}">${buildDetailHtml(item)}</div>`
          : "";
      return `
      <div class="row ${active}" data-id="${item.id}">
        <div class="row-lead" data-stop>
          <input type="checkbox" class="row-check" data-check-id="${item.id}" ${checked} aria-label="选择 ${escapeHtml(item.name)}" />
          <span class="${dotClass(item)}"></span>
        </div>
        <div>
          <div class="name">${escapeHtml(item.name)}</div>
          <div class="sub">${escapeHtml(formatTime(item.lastCheck))}${item.url ? " · " + escapeHtml(shortUrl(item.url)) : ""}</div>
        </div>
        <div><span class="tag">${typeLabel(item.type)}</span></div>
        <div>${metricFacts(item)}</div>
        <div class="${statusClass(item)}">${statusLabel(item)}</div>
        <div class="row-actions" data-stop>
          <button type="button" class="link-btn" data-act="check" data-id="${item.id}">检查</button>
          <div class="more-wrap">
            <button type="button" class="more-btn ${state.openMenuId === item.id ? "on" : ""}" data-act="menu" data-id="${item.id}" aria-label="更多操作" aria-expanded="${state.openMenuId === item.id ? "true" : "false"}">⋯</button>
            ${
              state.openMenuId === item.id
                ? `<div class="more-menu" role="menu">
                    ${item.hasUpdate || item.status === "update" ? `<button type="button" class="more-item" data-act="ack" data-id="${item.id}" role="menuitem">已知晓</button>` : ""}
                    <button type="button" class="more-item" data-act="edit" data-id="${item.id}" role="menuitem">编辑</button>
                    <button type="button" class="more-item" data-act="toggle" data-id="${item.id}" role="menuitem">${item.enabled ? "停用" : "启用"}</button>
                    <button type="button" class="more-item danger" data-act="del" data-id="${item.id}" role="menuitem">删除</button>
                  </div>`
                : ""
            }
          </div>
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
  } else if (item.type === "netdisk") {
    const files = item.assets || [];
    const disks = item.netdisks || [];
    const d0 = disks[0] || {};
    const probe = netdiskProbe(item);
    const probeHint = probe.mode === "fingerprint"
      ? "当前为页面指纹模式：无法稳定列出文件时用页面内容变化判断，可能延迟或误报。"
      : "当前为文件列表模式：按分享内文件名/大小变化判断更新，更可靠。";
    body += `
      <div class="rule-box">
        <div class="rule-title">分享信息 ${probe.label ? `<span class="probe-pill ${probe.weak ? "weak" : ""}">${escapeHtml(probe.label)}</span>` : ""}</div>
        <div class="rule-text">${escapeHtml(item.ruleText || "无提取码")}</div>
        <div class="rule-hint">${escapeHtml(probeHint)}${d0.note ? " " + escapeHtml(d0.note) : ""}</div>
        <div style="margin-top:8px"><button type="button" class="link-btn" data-act="edit-detail" data-id="${item.id}">编辑</button></div>
      </div>
      <div class="section-label">分享标题</div><div>${escapeHtml(item.title || item.version || "-")}</div>
      <div class="section-label">${probe.mode === "fingerprint" ? "探测内容" : "文件列表"} ${files.length}</div>`;
    if (!files.length) {
      body += `<div class="empty" style="padding:16px 0">${probe.mode === "fingerprint" ? "暂无结构化文件列表，已用页面指纹监控" : "暂未列出文件"}</div>`;
    } else {
      body += files
        .map(
          (a) => `
        <div class="asset">
          <code>${escapeHtml(a.name)}${a.size != null ? " · " + escapeHtml(String(a.size)) : ""}</code>
          <div class="row-actions">
            <a class="link-btn" href="${escapeHtml(a.url || item.url)}" target="_blank" rel="noopener">打开分享</a>
          </div>
        </div>`,
        )
        .join("");
    }
    body += `<div class="section-label">分享链接</div>`;
    body += `
      <div class="netdisk">
        <div class="provider">${escapeHtml(d0.provider || "网盘")} · ${escapeHtml(d0.title || item.title || "")}</div>
        <div class="meta">${d0.code ? "提取码 " + escapeHtml(d0.code) : "无提取码"}</div>
        <div class="url-line">${escapeHtml(d0.url || item.url)}</div>
        <div class="row-actions">
          <button type="button" class="link-btn" data-copy="${escapeHtml(d0.url || item.url)}">复制链接</button>
          ${d0.code ? `<button type="button" class="link-btn" data-copy="${escapeHtml(d0.code)}">复制提取码</button>` : ""}
          <a class="link-btn" href="${escapeHtml(d0.url || item.url)}" target="_blank" rel="noopener">打开</a>
        </div>
      </div>`;
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

  const srcUrl = item.url || "";
  const urlHtml = srcUrl
    ? `<a class="url url-link" href="${escapeHtml(srcUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(srcUrl)}</a>`
    : `<div class="url">-</div>`;
  // 类型/状态/上次检查已在列表行展示，详情只保留可点原链接 + TG
  const tg = tgMetaLabel();
  const tgOn = !!state.settings?.telegramConfigured;

  return `
    <div class="detail">
      <div class="detail-head">
        <div class="detail-title">
          <h3>${escapeHtml(item.name)}</h3>
          ${urlHtml}
          <div class="detail-tg ${tgOn ? "on" : ""}" title="Telegram 推送">${escapeHtml(tg)}</div>
        </div>
        <div class="detail-actions">
          ${item.hasUpdate || item.status === "update" ? `<button type="button" class="pill ack-btn" data-act="ack" data-id="${item.id}">已知晓</button>` : ""}
          <button type="button" class="switch ${item.enabled ? "on" : ""}" data-act="toggle" data-id="${item.id}" aria-label="启用停用"></button>
          <button type="button" class="icon-btn" data-act="close-detail" aria-label="关闭详情">×</button>
        </div>
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
  const isNd = item.type === "netdisk";
  $("editGithubFields").style.display = isGh ? "block" : "none";
  if ($("editNetdiskFields")) $("editNetdiskFields").hidden = !isNd;
  $("editArticleHint").hidden = isGh || isNd;
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
  if (isNd && $("editShareCode")) {
    $("editShareCode").value = item.shareCode || (item.filterRule && item.filterRule.code) || "";
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
  } else if (item.type === "netdisk") {
    body.shareCode = ($("editShareCode")?.value || "").trim();
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
  if ($("addShareCode")) $("addShareCode").value = "";
  syncAddTypeUI();
  renderAddChips();
  $("addModal").classList.add("show");
}

function syncAddTypeUI() {
  document.querySelectorAll("#addModal .type-tabs .mini-chip").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.type === state.addType);
  });
  const gh = state.addType === "github";
  const nd = state.addType === "netdisk";
  $("githubFields").style.display = gh ? "block" : "none";
  if ($("netdiskFields")) $("netdiskFields").hidden = !nd;
  if (gh) {
    $("urlLabel").textContent = "GitHub 仓库完整地址";
    $("addUrl").placeholder = "https://github.com/owner/repo";
  } else if (nd) {
    $("urlLabel").textContent = "网盘分享链接";
    $("addUrl").placeholder = "https://pan.baidu.com/s/xxx 或阿里/夸克/123/天翼/蓝奏";
  } else {
    $("urlLabel").textContent = "文章完整链接";
    $("addUrl").placeholder = "https://example.com/post/123";
  }
}

async function submitAdd() {
  const url = $("addUrl").value.trim();
  if (!url) return toast("请填写地址");
  applyUrlAutoDetect();
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
  } else if (state.addType === "netdisk") {
    body.shareCode = ($("addShareCode")?.value || "").trim();
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

function syncTgDetailUI() {
  document.querySelectorAll("#tgDetailTabs .mini-chip").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.tgDetail === state.tgDetail);
  });
}

function openSettings() {
  const s = state.settings || {};
  $("setInterval").value = s.intervalHours || 6;
  $("setToken").value = "";
  $("setChatId").value = s.chatId || "";
  state.tgDetail = s.telegramDetail === "full" ? "full" : "compact";
  syncTgDetailUI();
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
    telegramDetail: state.tgDetail === "full" ? "full" : "compact",
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

async function checkNow(sourceId, options = {}) {
  if (state.checking) return;
  state.checking = true;
  $("btnCheck").classList.add("checking");
  $("btnCheck").disabled = true;
  if ($("btnCheckFailed")) $("btnCheckFailed").disabled = true;
  try {
    let result;
    if (sourceId) {
      result = await api(`/api/check?sourceId=${sourceId}`, { method: "POST" });
    } else if (options.failedOnly) {
      result = await api(`/api/check?failedOnly=true`, { method: "POST" });
    } else if (options.ids && options.ids.length) {
      result = await api(`/api/check`, {
        method: "POST",
        body: JSON.stringify({ sourceIds: options.ids }),
      });
    } else {
      result = await api(`/api/check`, { method: "POST" });
    }
    await loadAll();
    if (result.checked === 0) {
      toast(options.failedOnly ? "没有失败项需要检查" : "没有可检查的项目");
    } else {
      toast(`检查完成：${result.checked} 项，更新 ${result.updated}，失败 ${result.errors}`);
    }
  } catch (e) {
    toast(e.message || "检查失败");
  } finally {
    state.checking = false;
    $("btnCheck").classList.remove("checking");
    $("btnCheck").disabled = false;
    if ($("btnCheckFailed")) $("btnCheckFailed").disabled = false;
  }
}

async function batchAction(action) {
  const ids = checkedIdList();
  if (!ids.length) return toast("请先勾选项目");
  if (action === "check") {
    await checkNow(null, { ids });
    return;
  }
  if (action === "clear") {
    clearChecked();
    renderAll();
    return;
  }
  if (action === "ack") {
    const targets = ids.filter((id) => {
      const s = state.sources.find((x) => x.id === id);
      return s && (s.hasUpdate || s.status === "update");
    });
    if (!targets.length) return toast("选中项没有「有更新」状态");
    try {
      let n = 0;
      for (const id of targets) {
        await api(`/api/sources/${id}/ack`, { method: "POST" });
        n += 1;
      }
      await loadAll();
      toast(`已标为已知晓 ${n} 项`);
    } catch (e) {
      toast(e.message || "批量已知晓失败");
    }
    return;
  }
  if (action === "delete") {
    if (!confirm(`确定删除选中的 ${ids.length} 项？`)) return;
  }
  try {
    const map = { enable: "enable", disable: "disable", delete: "delete" };
    const res = await api("/api/sources/batch", {
      method: "POST",
      body: JSON.stringify({ action: map[action], ids }),
    });
    if (action === "delete") clearChecked();
    await loadAll();
    const label = { enable: "已启用", disable: "已停用", delete: "已删除" }[action] || "完成";
    toast(`${label} ${res.done || ids.length} 项`);
  } catch (e) {
    toast(e.message || "批量操作失败");
  }
}

function toggleSelectAllVisible(on) {
  const list = filteredSources();
  for (const s of list) setChecked(s.id, on);
  renderAll();
}

async function ackUpdate(id) {
  try {
    await api(`/api/sources/${id}/ack`, { method: "POST" });
    await loadAll();
    toast("已标为已知晓");
  } catch (e) {
    toast(e.message || "操作失败");
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
  if ($("btnCheckFailed")) $("btnCheckFailed").onclick = () => checkNow(null, { failedOnly: true });
  $("btnSettings").onclick = openSettings;
  if ($("bulkBar")) {
    $("bulkBar").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-bulk]");
      if (!btn) return;
      batchAction(btn.dataset.bulk);
    });
  }
  if ($("bulkSelectAll")) {
    $("bulkSelectAll").addEventListener("change", (e) => {
      toggleSelectAllVisible(!!e.target.checked);
    });
  }
  if ($("headSelectAll")) {
    $("headSelectAll").addEventListener("change", (e) => {
      toggleSelectAllVisible(!!e.target.checked);
    });
  }
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
  if ($("addUrl")) {
    const onUrl = () => applyUrlAutoDetect();
    $("addUrl").addEventListener("input", onUrl);
    $("addUrl").addEventListener("paste", () => setTimeout(onUrl, 0));
    $("addUrl").addEventListener("change", onUrl);
  }
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

  const tgTabs = $("tgDetailTabs");
  if (tgTabs) {
    tgTabs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tg-detail]");
      if (!btn) return;
      state.tgDetail = btn.dataset.tgDetail === "full" ? "full" : "compact";
      syncTgDetailUI();
    });
  }

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
    const checkEl = e.target.closest(".row-check, #headSelectAll");
    if (checkEl && checkEl.classList.contains("row-check")) {
      e.stopPropagation();
      const id = Number(checkEl.dataset.checkId);
      setChecked(id, !!checkEl.checked);
      renderBulkBar();
      // sync select-all boxes without full re-render of rows
      const list = filteredSources();
      const allChecked = list.length > 0 && list.every((s) => state.checkedIds[s.id]);
      if ($("bulkSelectAll")) $("bulkSelectAll").checked = allChecked;
      if ($("headSelectAll")) $("headSelectAll").checked = allChecked;
      return;
    }
    const emptyAct = e.target.closest("[data-empty-act]");
    if (emptyAct) {
      e.stopPropagation();
      const act = emptyAct.dataset.emptyAct;
      if (act === "add") openAdd();
      else if (act === "filter-all") {
        state.filter = "all";
        renderAll();
      } else if (act === "sample-github") openAddSample("github");
      else if (act === "sample-article") openAddSample("article");
      else if (act === "sample-netdisk") openAddSample("netdisk");
      return;
    }
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
        state.openMenuId = null;
        renderAll();
        return;
      }
      if (act === "menu") {
        state.openMenuId = state.openMenuId === id ? null : id;
        renderAll();
        return;
      }
      state.openMenuId = null;
      if (act === "check") {
        renderAll();
        checkNow(id);
        return;
      }
      if (act === "edit" || act === "edit-detail") {
        renderAll();
        openEdit(id);
        return;
      }
      if (act === "toggle") {
        renderAll();
        toggleEnabled(id);
        return;
      }
      if (act === "del") {
        renderAll();
        deleteSource(id);
        return;
      }
      if (act === "ack") {
        renderAll();
        ackUpdate(id);
        return;
      }
      renderAll();
      return;
    }
    // 详情区域内的空白点击不切换行
    if (e.target.closest(".row-detail")) return;
    const stop = e.target.closest("[data-stop]");
    if (stop) return;
    const row = e.target.closest(".row[data-id]");
    if (!row) return;
    const id = Number(row.dataset.id);
    // 再点同一行则收起详情；切换行时收起更多菜单
    state.openMenuId = null;
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
    if (state.openMenuId != null) {
      state.openMenuId = null;
      renderAll();
      return;
    }
    if (state.selectedId == null) return;
    state.selectedId = null;
    renderAll();
  });

  document.addEventListener("click", (e) => {
    if (state.openMenuId == null) return;
    if (e.target.closest(".more-wrap")) return;
    state.openMenuId = null;
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
