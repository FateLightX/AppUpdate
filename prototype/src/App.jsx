import { useMemo, useState } from "react";
import {
  Plus,
  RefreshCw,
  Settings,
  Copy,
  ExternalLink,
  X,
} from "lucide-react";
import {
  ARCH_OPTIONS,
  EXT_OPTIONS,
  OS_OPTIONS,
  describeRule,
  filterAssets,
} from "./githubMatch.js";

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "update", label: "有更新" },
  { id: "github", label: "GitHub" },
  { id: "article", label: "文章" },
];

const EMPTY_RULE = {
  exts: [],
  osIds: [],
  archIds: [],
  include: [],
  exclude: [],
};

const INITIAL = [
  {
    id: "1",
    name: "Clash Verge Rev",
    type: "github",
    url: "https://github.com/clash-verge-rev/clash-verge-rev",
    enabled: true,
    status: "update",
    summary: "v2.4.1 · 匹配 1 个文件",
    version: "v2.4.1",
    metrics: [
      { label: "版本", width: 100, warn: true },
      { label: "匹配", width: 80, warn: false },
    ],
    filterRule: {
      exts: [".dmg"],
      osIds: ["macos"],
      archIds: ["arm64"],
      include: [],
      exclude: [],
    },
    assets: [
      {
        name: "Clash.Verge_2.4.1_aarch64.dmg",
        url: "https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.4.1/Clash.Verge_2.4.1_aarch64.dmg",
      },
      {
        name: "Clash.Verge_2.4.1_x64.dmg",
        url: "https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.4.1/Clash.Verge_2.4.1_x64.dmg",
      },
      {
        name: "Clash.Verge_2.4.1_x64-setup.exe",
        url: "https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.4.1/Clash.Verge_2.4.1_x64-setup.exe",
      },
    ],
    netdisks: [],
    lastCheck: "10 分钟前",
  },
  {
    id: "2",
    name: "某资源站更新帖",
    type: "article",
    url: "https://blog.example.com/post/1024",
    enabled: true,
    status: "update",
    summary: "标题已变 · 百度 / 夸克",
    version: "标题已变化",
    metrics: [
      { label: "标题", width: 100, warn: true },
      { label: "网盘", width: 66, warn: false },
    ],
    filterRule: null,
    assets: [],
    netdisks: [
      {
        provider: "百度网盘",
        title: "合集备份",
        url: "https://pan.baidu.com/s/example1",
        code: "a8k2",
      },
      {
        provider: "夸克",
        title: "夸克分享",
        url: "https://pan.quark.cn/s/example2",
        code: "9x3m",
      },
    ],
    lastCheck: "10 分钟前",
  },
  {
    id: "3",
    name: "LocalSend",
    type: "github",
    url: "https://github.com/localsend/localsend",
    enabled: true,
    status: "ok",
    summary: "v1.17.0 · 匹配 1 个文件",
    version: "v1.17.0",
    metrics: [
      { label: "版本", width: 70, warn: false },
      { label: "匹配", width: 55, warn: false },
    ],
    filterRule: {
      exts: [".exe"],
      osIds: ["windows"],
      archIds: ["x64"],
      include: [],
      exclude: ["setup"],
    },
    assets: [
      {
        name: "LocalSend-1.17.0-windows-x86-64.exe",
        url: "https://github.com/localsend/localsend/releases/download/v1.17.0/LocalSend-1.17.0-windows-x86-64.exe",
      },
      {
        name: "LocalSend-1.17.0-windows-x86-64-setup.exe",
        url: "https://github.com/localsend/localsend/releases/download/v1.17.0/LocalSend-1.17.0-windows-x86-64-setup.exe",
      },
    ],
    netdisks: [],
    lastCheck: "6 小时前",
  },
  {
    id: "4",
    name: "工具合集说明",
    type: "article",
    url: "https://notes.example.com/tools",
    enabled: true,
    status: "ok",
    summary: "原标题 · 2 个网盘",
    version: "原标题",
    metrics: [
      { label: "标题", width: 100, warn: false },
      { label: "网盘", width: 50, warn: false },
    ],
    filterRule: null,
    assets: [],
    netdisks: [
      {
        provider: "123",
        title: "工具包",
        url: "https://www.123pan.com/s/example3",
        code: "k2p9",
      },
      {
        provider: "蓝奏",
        title: "小文件",
        url: "https://wwa.lanzoui.com/example4",
        code: "",
      },
    ],
    lastCheck: "6 小时前",
  },
  {
    id: "5",
    name: "App 内测包",
    type: "github",
    url: "https://github.com/example/app",
    enabled: false,
    status: "off",
    summary: "v0.9.2-beta · 已停用",
    version: "v0.9.2-beta",
    metrics: [
      { label: "版本", width: 30, warn: false },
      { label: "匹配", width: 15, warn: false },
    ],
    filterRule: {
      exts: [".apk", ".zip"],
      osIds: ["android"],
      archIds: [],
      include: [],
      exclude: [],
    },
    assets: [],
    netdisks: [],
    lastCheck: "昨天",
  },
];

function statusLabel(item) {
  if (!item.enabled || item.status === "off") return "停用";
  if (item.status === "update") return "有更新";
  return "正常";
}

function statusClass(item) {
  if (!item.enabled || item.status === "off") return "status-off";
  if (item.status === "update") return "status-up";
  return "status-ok";
}

function dotClass(item) {
  if (!item.enabled || item.status === "off") return "dot off";
  if (item.status === "update") return "dot warn";
  return "dot";
}

function toggleInList(list, value) {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

function parseKeywords(text) {
  return String(text || "")
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ChipMulti({ options, values, onChange, getId, getLabel }) {
  return (
    <div className="chip-multi">
      {options.map((opt) => {
        const id = getId ? getId(opt) : opt;
        const label = getLabel ? getLabel(opt) : opt;
        const on = values.includes(id);
        return (
          <button
            key={id}
            type="button"
            className={`mini-chip ${on ? "on" : ""}`}
            onClick={() => onChange(toggleInList(values, id))}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function App() {
  const [items, setItems] = useState(INITIAL);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("1");
  const [checking, setChecking] = useState(false);
  const [toast, setToast] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    intervalHours: 6,
    botToken: "",
    chatId: "",
    telegramConnected: true,
  });
  const [addForm, setAddForm] = useState({
    type: "github",
    url: "",
    name: "",
    exts: [".dmg"],
    osIds: ["macos"],
    archIds: ["arm64"],
    includeText: "",
    excludeText: "",
  });

  const enabledCount = items.filter((i) => i.enabled).length;

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (filter === "update") return item.enabled && item.status === "update";
      if (filter === "github") return item.type === "github";
      if (filter === "article") return item.type === "article";
      return true;
    });
  }, [items, filter]);

  const selected = items.find((i) => i.id === selectedId) || null;

  const selectedMatchedAssets = useMemo(() => {
    if (!selected || selected.type !== "github") return [];
    return filterAssets(selected.assets, selected.filterRule || EMPTY_RULE);
  }, [selected]);

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 2400);
  }

  async function copyText(text, okMsg = "已复制") {
    try {
      await navigator.clipboard.writeText(text);
      showToast(okMsg);
    } catch {
      showToast("复制失败，请手动选择");
    }
  }

  function runCheck() {
    if (checking) return;
    setChecking(true);
    showToast("正在检查更新…");
    window.setTimeout(() => {
      setItems((prev) =>
        prev.map((item) =>
          item.enabled ? { ...item, lastCheck: "刚刚" } : item,
        ),
      );
      setChecking(false);
      showToast("检查完成（演示数据）");
    }, 900);
  }

  function toggleEnabled(id) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const enabled = !item.enabled;
        return {
          ...item,
          enabled,
          status: enabled ? (item.status === "off" ? "ok" : item.status) : "off",
          summary: enabled
            ? item.summary.replace(" · 已停用", "")
            : item.summary.includes("已停用")
              ? item.summary
              : `${item.version} · 已停用`,
        };
      }),
    );
  }

  function addItem(e) {
    e.preventDefault();
    if (!addForm.url.trim()) {
      showToast("请填写完整地址");
      return;
    }
    const name =
      addForm.name.trim() ||
      (addForm.type === "github"
        ? addForm.url.replace(/https?:\/\/github\.com\//, "").replace(/\/$/, "")
        : "新文章");
    const id = String(Date.now());
    const filterRule =
      addForm.type === "github"
        ? {
            exts: addForm.exts,
            osIds: addForm.osIds,
            archIds: addForm.archIds,
            include: parseKeywords(addForm.includeText),
            exclude: parseKeywords(addForm.excludeText),
          }
        : null;

    const next = {
      id,
      name,
      type: addForm.type,
      url: addForm.url.trim(),
      enabled: true,
      status: "ok",
      summary:
        addForm.type === "github"
          ? `待检查 · ${describeRule(filterRule)}`
          : "待检查 · 标题与网盘",
      version: "待检查",
      metrics:
        addForm.type === "github"
          ? [
              { label: "版本", width: 20, warn: false },
              { label: "匹配", width: 20, warn: false },
            ]
          : [
              { label: "标题", width: 20, warn: false },
              { label: "网盘", width: 20, warn: false },
            ],
      filterRule,
      assets: [],
      netdisks: [],
      lastCheck: "未检查",
    };
    setItems((prev) => [next, ...prev]);
    setSelectedId(id);
    setShowAdd(false);
    setAddForm({
      type: "github",
      url: "",
      name: "",
      exts: [".dmg"],
      osIds: ["macos"],
      archIds: ["arm64"],
      includeText: "",
      excludeText: "",
    });
    showToast("已添加追踪项");
  }

  function openExternal(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <header className="top">
        <div className="brand">更新追踪</div>
        <div className="top-right">
          <button className="pill" type="button" onClick={() => setShowAdd(true)}>
            <Plus size={15} strokeWidth={2} />
            添加
          </button>
          <button
            className={`pill ${checking ? "checking" : ""}`}
            type="button"
            onClick={runCheck}
            disabled={checking}
          >
            <RefreshCw size={15} strokeWidth={2} />
            {checking ? "检查中" : "立即检查"}
          </button>
          <button className="pill" type="button" onClick={() => setShowSettings(true)}>
            <Settings size={15} strokeWidth={2} />
            设置
          </button>
          <div className="pill online">
            <i className="dot-live" />
            {enabledCount} 启用
            {settings.telegramConnected ? " · TG 已连接" : " · TG 未配置"}
          </div>
        </div>
      </header>

      <main className="wrap">
        <div className="toolbar">
          <div className="filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`chip ${filter === f.id ? "on" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="meta-note">
            间隔 {settings.intervalHours} 小时 · 下次约 2 小时后
          </div>
        </div>

        <section className="panel">
          <div className="row head">
            <div />
            <div>名称</div>
            <div>类型</div>
            <div>指标</div>
            <div>状态</div>
            <div>操作</div>
          </div>

          {filtered.length === 0 && (
            <div className="empty">当前筛选下没有追踪项</div>
          )}

          {filtered.map((item) => {
            const matched =
              item.type === "github"
                ? filterAssets(item.assets, item.filterRule || EMPTY_RULE)
                : [];
            return (
              <div
                key={item.id}
                className={`row body ${selectedId === item.id ? "selected" : ""}`}
                onClick={() => setSelectedId(item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelectedId(item.id);
                }}
              >
                <div className={dotClass(item)} />
                <div>
                  <div className="name">{item.name}</div>
                  <div className="sub">{item.summary}</div>
                </div>
                <div>
                  <span className="tag">
                    {item.type === "github" ? "GitHub" : "文章"}
                  </span>
                </div>
                <div className="bars">
                  {item.metrics.map((m) => (
                    <div className="mini" key={m.label}>
                      <span>{m.label}</span>
                      <div className={`bar ${m.warn ? "warn" : ""}`}>
                        <i style={{ width: `${m.width}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className={statusClass(item)}>{statusLabel(item)}</div>
                <div className="actions" onClick={(e) => e.stopPropagation()}>
                  {item.type === "github" ? (
                    <>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => openExternal(item.url)}
                      >
                        发布页
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        disabled={!matched[0]}
                        onClick={() =>
                          matched[0] &&
                          copyText(matched[0].url, "下载链接已复制")
                        }
                      >
                        复制
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => openExternal(item.url)}
                      >
                        原文
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        disabled={!item.netdisks[0]}
                        onClick={() => setSelectedId(item.id)}
                      >
                        网盘
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setSelectedId(item.id)}
                  >
                    详情
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        {selected && (
          <section className="detail">
            <div className="detail-head">
              <div>
                <h3>{selected.name}</h3>
                <div className="url">{selected.url}</div>
              </div>
              <button
                type="button"
                className={`switch ${selected.enabled ? "on" : ""}`}
                aria-label={selected.enabled ? "停用" : "启用"}
                onClick={() => toggleEnabled(selected.id)}
              />
            </div>

            <div className="kv">
              <span>类型</span>
              <div>{selected.type === "github" ? "GitHub" : "文章"}</div>
              <span>状态</span>
              <div className={statusClass(selected)}>{statusLabel(selected)}</div>
              <span>上次检查</span>
              <div>{selected.lastCheck}</div>
              <span>Telegram</span>
              <div>{settings.telegramConnected ? "有更新时推送" : "未配置"}</div>
            </div>

            {selected.type === "github" && (
              <>
                <div className="rule-box">
                  <div className="rule-title">筛选规则（别名自动扩展）</div>
                  <div className="rule-text">
                    {describeRule(selected.filterRule || EMPTY_RULE)}
                  </div>
                  <div className="rule-hint">
                    系统/架构用别名匹配（darwin=macOS，aarch64=arm64）。文件名没写系统时，
                    会按扩展名推断（如 .dmg→macOS）。仍漏可用「包含/排除」关键词。
                  </div>
                </div>

                <div className="section-label">
                  匹配结果 {selectedMatchedAssets.length} / {selected.assets.length}
                </div>

                {selectedMatchedAssets.length === 0 && (
                  <div className="empty" style={{ padding: "16px 0" }}>
                    暂无匹配到的下载文件。可放宽系统/架构，或加包含关键词。
                  </div>
                )}
                {selectedMatchedAssets.map((asset) => (
                  <div className="asset" key={asset.name}>
                    <code>{asset.name}</code>
                    <div className="actions">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => copyText(asset.url, "下载链接已复制")}
                      >
                        <Copy size={13} style={{ verticalAlign: "-2px" }} /> 复制
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => openExternal(asset.url)}
                      >
                        <ExternalLink size={13} style={{ verticalAlign: "-2px" }} /> 打开
                      </button>
                    </div>
                  </div>
                ))}

                {selected.assets.length > selectedMatchedAssets.length && (
                  <>
                    <div className="section-label muted-label">
                      未匹配（便于核对漏项）
                    </div>
                    {selected.assets
                      .filter(
                        (a) =>
                          !selectedMatchedAssets.some((m) => m.name === a.name),
                      )
                      .map((asset) => (
                        <div className="asset dim" key={asset.name}>
                          <code>{asset.name}</code>
                          <span className="miss-tag">未匹配</span>
                        </div>
                      ))}
                  </>
                )}
              </>
            )}

            {selected.type === "article" && (
              <>
                {selected.netdisks.length === 0 && (
                  <div className="empty" style={{ padding: "16px 0" }}>
                    暂无提取到网盘信息
                  </div>
                )}
                {selected.netdisks.map((disk) => (
                  <div className="asset" key={disk.url}>
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {disk.provider}
                        {disk.title ? ` · ${disk.title}` : ""}
                      </div>
                      <div className="sub">
                        {disk.url}
                        {disk.code ? ` · 提取码 ${disk.code}` : ""}
                      </div>
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() =>
                          copyText(
                            disk.code
                              ? `${disk.url} 提取码：${disk.code}`
                              : disk.url,
                            "网盘信息已复制",
                          )
                        }
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => openExternal(disk.url)}
                      >
                        打开
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </section>
        )}
      </main>

      {showAdd && (
        <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
          <form
            className="modal wide"
            onClick={(e) => e.stopPropagation()}
            onSubmit={addItem}
          >
            <h2>添加追踪</h2>
            <p className="desc">
              GitHub 附件命名不统一：系统/架构用「组别 + 别名」匹配，并可加关键词兜底。
            </p>
            <div className="field">
              <label>类型</label>
              <select
                value={addForm.type}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, type: e.target.value }))
                }
              >
                <option value="github">GitHub Release</option>
                <option value="article">博客文章</option>
              </select>
            </div>
            <div className="field">
              <label>完整地址</label>
              <input
                value={addForm.url}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, url: e.target.value }))
                }
                placeholder={
                  addForm.type === "github"
                    ? "https://github.com/owner/repo"
                    : "https://example.com/post/xxx"
                }
              />
            </div>
            <div className="field">
              <label>显示名称（可选）</label>
              <input
                value={addForm.name}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="留空则自动生成"
              />
            </div>

            {addForm.type === "github" && (
              <>
                <div className="field">
                  <label>扩展名（可多选，不选=不限）</label>
                  <ChipMulti
                    options={EXT_OPTIONS}
                    values={addForm.exts}
                    onChange={(exts) => setAddForm((f) => ({ ...f, exts }))}
                  />
                </div>
                <div className="field">
                  <label>系统（可多选，按别名识别）</label>
                  <ChipMulti
                    options={OS_OPTIONS}
                    values={addForm.osIds}
                    onChange={(osIds) => setAddForm((f) => ({ ...f, osIds }))}
                    getId={(o) => o.id}
                    getLabel={(o) => o.label}
                  />
                  <div className="field-hint">
                    文件名别名自动认：macOS→darwin/osx；Windows→win/win64；Linux→appimage。
                    若文件名没写系统，.dmg/.pkg 仍算 macOS，.exe/.msi 算 Windows，.apk 算 Android。
                  </div>
                </div>
                <div className="field">
                  <label>架构（可多选，按别名识别）</label>
                  <ChipMulti
                    options={ARCH_OPTIONS}
                    values={addForm.archIds}
                    onChange={(archIds) =>
                      setAddForm((f) => ({ ...f, archIds }))
                    }
                    getId={(o) => o.id}
                    getLabel={(o) => o.label}
                  />
                  <div className="field-hint">
                    arm64 → aarch64；x64 → x86_64/amd64；x86 → i386/win32
                  </div>
                </div>
                <div className="field-row two">
                  <div className="field">
                    <label>文件名包含（全部满足）</label>
                    <input
                      value={addForm.includeText}
                      onChange={(e) =>
                        setAddForm((f) => ({
                          ...f,
                          includeText: e.target.value,
                        }))
                      }
                      placeholder="如 portable, signed"
                    />
                  </div>
                  <div className="field">
                    <label>文件名排除（命中即丢）</label>
                    <input
                      value={addForm.excludeText}
                      onChange={(e) =>
                        setAddForm((f) => ({
                          ...f,
                          excludeText: e.target.value,
                        }))
                      }
                      placeholder="如 setup, debug, symbols"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="pill"
                onClick={() => setShowAdd(false)}
              >
                取消
              </button>
              <button type="submit" className="pill primary">
                添加
              </button>
            </div>
          </form>
        </div>
      )}

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h2>设置</h2>
              <button
                type="button"
                className="link-btn"
                onClick={() => setShowSettings(false)}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <p className="desc">全局检查间隔与 Telegram 推送配置。</p>
            <div className="field">
              <label>检查间隔（小时）</label>
              <input
                type="number"
                min={1}
                max={168}
                value={settings.intervalHours}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    intervalHours: Number(e.target.value) || 6,
                  }))
                }
              />
            </div>
            <div className="field">
              <label>Telegram Bot Token</label>
              <input
                value={settings.botToken}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, botToken: e.target.value }))
                }
                placeholder="123456:ABC-DEF..."
              />
            </div>
            <div className="field">
              <label>聊天 ID</label>
              <input
                value={settings.chatId}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, chatId: e.target.value }))
                }
                placeholder="-100xxxxxxxxxx"
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="pill"
                onClick={() => setShowSettings(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="pill primary"
                onClick={() => {
                  const connected = Boolean(
                    settings.botToken.trim() && settings.chatId.trim(),
                  );
                  setSettings((s) => ({
                    ...s,
                    telegramConnected: connected || s.telegramConnected,
                  }));
                  setShowSettings(false);
                  showToast(
                    connected ? "设置已保存，Telegram 已配置" : "设置已保存",
                  );
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
