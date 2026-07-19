/**
 * GitHub asset matching: expand user-friendly dimensions into aliases,
 * then match case-insensitively against the asset file name.
 *
 * Naming on GitHub is messy (darwin/osx/macos, aarch64/arm64, etc.).
 * Strategy:
 * 1) Multi-select extension / OS / arch (OR within dimension, AND across)
 * 2) Each OS/arch expands to many aliases
 * 3) Extension may imply OS when filename has no OS keyword (.dmg → macOS)
 * 4) Include keywords (AND) + exclude keywords (OR drop)
 */

export const OS_OPTIONS = [
  {
    id: "macos",
    label: "macOS",
    aliases: ["macos", "mac-os", "mac_os", "darwin", "osx", "apple"],
    // "mac" alone is too short / noisy; keep in weak set only via inference
  },
  {
    id: "windows",
    label: "Windows",
    aliases: ["windows", "win32", "win64", "win", "msvc", "pc-windows"],
  },
  {
    id: "linux",
    label: "Linux",
    aliases: ["linux", "gnu", "ubuntu", "debian", "appimage", "rpm", "deb"],
  },
  {
    id: "android",
    label: "Android",
    aliases: ["android", "apk", "aab"],
  },
];

export const ARCH_OPTIONS = [
  {
    id: "arm64",
    label: "arm64",
    aliases: ["arm64", "aarch64", "arm64e", "arm64v8", "armv8", "arm64-v8a"],
  },
  {
    id: "x64",
    label: "x64",
    aliases: ["x64", "x86_64", "x86-64", "amd64", "win64", "64bit", "64-bit"],
  },
  {
    id: "x86",
    label: "x86",
    aliases: ["x86", "i386", "i686", "ia32", "win32", "32bit", "32-bit"],
  },
  {
    id: "armv7",
    label: "armv7",
    aliases: ["armv7", "armv7l", "armeabi-v7a", "armeabi", "armhf"],
  },
];

export const EXT_OPTIONS = [
  ".dmg",
  ".pkg",
  ".zip",
  ".tar.gz",
  ".tgz",
  ".7z",
  ".exe",
  ".msi",
  ".AppImage",
  ".deb",
  ".rpm",
  ".apk",
  ".aab",
];

/** When filename has no OS keyword, these extensions still count as that OS. */
const EXT_IMPLIES_OS = {
  ".dmg": "macos",
  ".pkg": "macos",
  ".msi": "windows",
  ".exe": "windows",
  ".appimage": "linux",
  ".deb": "linux",
  ".rpm": "linux",
  ".apk": "android",
  ".aab": "android",
};

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAnyAlias(normalized, aliases) {
  return aliases.some((alias) => {
    const a = alias.toLowerCase();
    // Prefer word-ish boundary to reduce false positives (e.g. "mac" in "machine")
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(a)}([^a-z0-9]|$)`);
    return re.test(normalized);
  });
}

function endsWithExt(name, ext) {
  const n = name.toLowerCase();
  const e = ext.toLowerCase();
  return n.endsWith(e);
}

function detectOsIdsFromName(name, normalized) {
  const hit = [];
  for (const os of OS_OPTIONS) {
    if (hasAnyAlias(normalized, os.aliases)) hit.push(os.id);
  }
  // Extension inference only if no explicit OS token found
  if (hit.length === 0) {
    const lower = name.toLowerCase();
    for (const [ext, osId] of Object.entries(EXT_IMPLIES_OS)) {
      if (lower.endsWith(ext) && !hit.includes(osId)) hit.push(osId);
    }
  }
  return hit;
}

/**
 * @param {string} assetName
 * @param {{
 *   exts?: string[],
 *   osIds?: string[],
 *   archIds?: string[],
 *   include?: string[],
 *   exclude?: string[],
 * }} rule
 */
export function matchGithubAsset(assetName, rule = {}) {
  const name = assetName || "";
  const normalized = normalizeName(name);
  const {
    exts = [],
    osIds = [],
    archIds = [],
    include = [],
    exclude = [],
  } = rule;

  // exclude first
  for (const kw of exclude) {
    const k = kw.trim().toLowerCase();
    if (!k) continue;
    if (normalized.includes(k) || name.toLowerCase().includes(k)) {
      return { ok: false, reason: `排除关键词：${kw}` };
    }
  }

  // extension: any of selected
  if (exts.length > 0) {
    const hit = exts.some((ext) => endsWithExt(name, ext));
    if (!hit) return { ok: false, reason: "扩展名不匹配" };
  }

  // os: any selected group (OR within, AND with other dimensions)
  // Uses alias match + extension-implies-OS fallback
  if (osIds.length > 0) {
    const detected = detectOsIdsFromName(name, normalized);
    const hit = osIds.some((id) => detected.includes(id));
    if (!hit) return { ok: false, reason: "系统不匹配" };
  }

  // arch: any selected group
  if (archIds.length > 0) {
    const groups = ARCH_OPTIONS.filter((o) => archIds.includes(o.id));
    const hit = groups.some((g) => hasAnyAlias(normalized, g.aliases));
    if (!hit) return { ok: false, reason: "架构不匹配" };
  }

  // include keywords: all must appear (AND)
  for (const kw of include) {
    const k = kw.trim().toLowerCase();
    if (!k) continue;
    if (!(normalized.includes(k) || name.toLowerCase().includes(k))) {
      return { ok: false, reason: `缺少关键词：${kw}` };
    }
  }

  return { ok: true, reason: "匹配" };
}

export function filterAssets(assets, rule) {
  return (assets || []).filter((a) => matchGithubAsset(a.name, rule).ok);
}

export function describeRule(rule = {}) {
  const parts = [];
  if (rule.exts?.length) parts.push(`扩展名 ${rule.exts.join("/")}`);
  if (rule.osIds?.length) {
    const labels = OS_OPTIONS.filter((o) => rule.osIds.includes(o.id)).map(
      (o) => o.label,
    );
    parts.push(`系统 ${labels.join("/")}`);
  }
  if (rule.archIds?.length) {
    const labels = ARCH_OPTIONS.filter((o) => rule.archIds.includes(o.id)).map(
      (o) => o.label,
    );
    parts.push(`架构 ${labels.join("/")}`);
  }
  if (rule.include?.length) parts.push(`包含 ${rule.include.join("+")}`);
  if (rule.exclude?.length) parts.push(`排除 ${rule.exclude.join("/")}`);
  return parts.length ? parts.join(" · ") : "未设置筛选（保留全部附件）";
}
