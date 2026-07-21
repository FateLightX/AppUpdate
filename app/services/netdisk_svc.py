from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from bs4 import BeautifulSoup

from app.services import netdisk as netdisk_lib

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# Some pan CDNs return broken compressed payloads; prefer identity.
DEFAULT_HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
}


def is_netdisk_url(url: str) -> bool:
    return netdisk_lib._provider_for_url(url or "") is not None


def provider_for_url(url: str) -> tuple[str, str] | None:
    return netdisk_lib._provider_for_url(url or "")


def extract_code(url: str, explicit: str = "") -> str:
    code = (explicit or "").strip()
    if code:
        return code
    return netdisk_lib._code_from_url(url or "")


def default_name(url: str) -> str:
    prov = provider_for_url(url)
    if not prov:
        return url
    pid, label = prov
    key = _share_key(url, pid) or ""
    if key:
        return f"{label} {key[:12]}"
    return label


def _share_key(url: str, provider_id: str) -> str:
    parsed = urlparse(url or "")
    path = unquote(parsed.path or "").rstrip("/")
    qs = parse_qs(parsed.query or "")

    if provider_id == "baidu":
        m = re.search(r"/s/([A-Za-z0-9_-]+)", path)
        return m.group(1) if m else ""
    if provider_id == "aliyun":
        m = re.search(r"/s/([A-Za-z0-9_-]+)", path)
        return m.group(1) if m else ""
    if provider_id == "quark":
        m = re.search(r"/s/([A-Za-z0-9_-]+)", path)
        return m.group(1) if m else ""
    if provider_id == "123":
        m = re.search(r"/s/([A-Za-z0-9_-]+)", path)
        return m.group(1) if m else ""
    if provider_id == "tianyi":
        if "code" in qs and qs["code"]:
            return qs["code"][0]
        m = re.search(r"/t/([A-Za-z0-9_-]+)", path)
        return m.group(1) if m else ""
    if provider_id == "lanzou":
        m = re.search(r"/([A-Za-z0-9_-]+)$", path)
        return m.group(1) if m else ""
    return path.rsplit("/", 1)[-1] if path else ""


def _fmt_size(size: int | None) -> str:
    if size is None or size < 0:
        return ""
    n = float(size)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            if unit == "B":
                return f"{int(n)}{unit}"
            return f"{n:.1f}{unit}"
        n /= 1024
    return str(size)


def _fingerprint(provider: str, key: str, title: str, files: list[dict[str, Any]], extra: str = "") -> str:
    parts = []
    for f in files:
        name = f.get("name") or ""
        size = f.get("size")
        size_s = "" if size is None else str(size)
        parts.append(f"{name}:{size_s}")
    parts.sort()
    base = f"netdisk|{provider}|{key}|{title}|{','.join(parts)}"
    if extra:
        base += f"|{extra}"
    return base


def _result(
    *,
    url: str,
    provider_label: str,
    title: str,
    code: str,
    files: list[dict[str, Any]],
    fingerprint: str,
    note: str = "",
) -> dict[str, Any]:
    assets = []
    for f in files:
        assets.append(
            {
                "name": f.get("name") or "未命名",
                "url": f.get("url") or url,
                "size": f.get("size"),
            }
        )
    file_count = len(assets)
    if file_count:
        preview = " / ".join(a["name"][:24] for a in assets[:3])
        if file_count > 3:
            preview += f" 等{file_count}项"
        summary = f"{provider_label} · {file_count} 项 · {preview}"
    else:
        summary = f"{provider_label} · {(title or '分享')[:40]}"
        if note:
            summary += f" · {note}"

    netdisk_item = {
        "provider": provider_label,
        "title": (title or provider_label)[:120],
        "url": url,
        "code": code or "",
    }
    return {
        "version": title or provider_label,
        "title": title or provider_label,
        "assets": assets,
        "unmatched_assets": [],
        "netdisks": [netdisk_item],
        "summary": summary,
        "fingerprint": fingerprint,
        "html_url": url,
    }


async def fetch_share(url: str, code: str = "") -> dict[str, Any]:
    raw_url = (url or "").strip()
    if not raw_url.startswith("http://") and not raw_url.startswith("https://"):
        raise ValueError("请填写完整 http(s) 网盘分享链接")

    prov = provider_for_url(raw_url)
    if not prov:
        raise ValueError("暂不支持该网盘，目前支持百度/阿里/夸克/123/天翼/蓝奏")

    provider_id, provider_label = prov
    share_code = extract_code(raw_url, code)
    key = _share_key(raw_url, provider_id)

    headers = dict(DEFAULT_HEADERS)

    async with httpx.AsyncClient(timeout=30.0, headers=headers, follow_redirects=True) as client:
        if provider_id == "aliyun":
            return await _fetch_aliyun(client, raw_url, key, share_code, provider_label)
        if provider_id == "123":
            return await _fetch_123(client, raw_url, key, share_code, provider_label)
        if provider_id == "lanzou":
            return await _fetch_lanzou(client, raw_url, key, share_code, provider_label)
        if provider_id == "tianyi":
            return await _fetch_tianyi(client, raw_url, key, share_code, provider_label)
        if provider_id == "baidu":
            return await _fetch_baidu(client, raw_url, key, share_code, provider_label)
        if provider_id == "quark":
            return await _fetch_quark(client, raw_url, key, share_code, provider_label)

    raise ValueError(f"暂未实现：{provider_label}")


async def _fetch_aliyun(
    client: httpx.AsyncClient,
    url: str,
    share_id: str,
    code: str,
    label: str,
) -> dict[str, Any]:
    if not share_id:
        raise ValueError("无法解析阿里云盘分享 ID")

    info_resp = await client.post(
        "https://api.aliyundrive.com/adrive/v3/share_link/get_share_by_anonymous",
        json={"share_id": share_id},
        headers={"Content-Type": "application/json", "Referer": "https://www.alipan.com/"},
    )
    if info_resp.status_code >= 400:
        raise ValueError(f"阿里云盘分享不可用：HTTP {info_resp.status_code}")
    info = info_resp.json()
    if info.get("code") and str(info.get("code")).upper() not in {"", "OK", "SUCCESS"}:
        # some errors come as code field
        msg = info.get("message") or info.get("code") or "分享不可用"
        if "password" in str(msg).lower() or "pwd" in str(msg).lower() or "提取" in str(msg):
            if not code:
                raise ValueError("该分享需要提取码")
        # continue; may still need token

    title = (
        info.get("share_name")
        or info.get("share_title")
        or info.get("display_name")
        or label
    )
    file_id = info.get("file_id") or info.get("fileId") or "root"
    if info.get("file_infos") and isinstance(info["file_infos"], list) and info["file_infos"]:
        first = info["file_infos"][0]
        file_id = first.get("file_id") or first.get("fileId") or file_id
        if not title or title == label:
            title = first.get("file_name") or first.get("name") or title

    token_payload: dict[str, Any] = {"share_id": share_id}
    if code:
        token_payload["share_pwd"] = code
    token_resp = await client.post(
        "https://api.aliyundrive.com/v2/share_link/get_share_token",
        json=token_payload,
        headers={"Content-Type": "application/json", "Referer": "https://www.alipan.com/"},
    )
    token_data = {}
    try:
        token_data = token_resp.json()
    except Exception:
        token_data = {}
    share_token = token_data.get("share_token") or ""
    if token_resp.status_code >= 400 or not share_token:
        err = token_data.get("message") or token_data.get("code") or f"HTTP {token_resp.status_code}"
        if not code and ("password" in str(err).lower() or "pwd" in str(err).lower() or "ShareLinkPassword" in str(err)):
            raise ValueError("该分享需要提取码")
        if code and ("password" in str(err).lower() or "pwd" in str(err).lower() or "invalid" in str(err).lower()):
            raise ValueError("提取码错误")
        # fallback to page probe if token fails without clear password error
        return await _fetch_html_fallback(client, url, share_id, code, label, "aliyun")

    files: list[dict[str, Any]] = []
    parent = file_id or "root"
    list_resp = await client.post(
        "https://api.aliyundrive.com/adrive/v2/file/list_by_share",
        json={
            "share_id": share_id,
            "parent_file_id": parent,
            "limit": 100,
            "order_by": "name",
            "order_direction": "ASC",
        },
        headers={
            "Content-Type": "application/json",
            "x-share-token": share_token,
            "Referer": "https://www.alipan.com/",
        },
    )
    if list_resp.status_code < 400:
        data = list_resp.json()
        items = data.get("items") or data.get("file_list") or []
        for it in items:
            name = it.get("name") or it.get("file_name") or "未命名"
            size = it.get("size")
            if size is None and it.get("type") == "folder":
                size = None
                name = f"[文件夹] {name}"
            files.append({"name": name, "size": size if isinstance(size, int) else None, "url": url})
    else:
        # single file share
        if info.get("file_infos"):
            for it in info["file_infos"]:
                name = it.get("file_name") or it.get("name") or "未命名"
                size = it.get("size")
                files.append({"name": name, "size": size if isinstance(size, int) else None, "url": url})

    if not files and info.get("file_infos"):
        for it in info["file_infos"]:
            name = it.get("file_name") or it.get("name") or "未命名"
            size = it.get("size")
            files.append({"name": name, "size": size if isinstance(size, int) else None, "url": url})

    fp = _fingerprint("aliyun", share_id, str(title), files)
    return _result(url=url, provider_label=label, title=str(title), code=code, files=files, fingerprint=fp)


async def _fetch_123(
    client: httpx.AsyncClient,
    url: str,
    share_key: str,
    code: str,
    label: str,
) -> dict[str, Any]:
    if not share_key:
        raise ValueError("无法解析 123 网盘分享 key")

    hosts = ["www.123pan.com", "www.123684.com", "www.123865.com", "www.123912.com"]
    parsed = urlparse(url)
    if parsed.netloc:
        hosts = [parsed.netloc] + [h for h in hosts if h != parsed.netloc]

    last_err = "分享不可用"
    for host in hosts:
        api = (
            f"https://{host}/b/api/share/get"
            f"?limit=100&next=1&orderBy=file_name&orderDirection=asc"
            f"&shareKey={share_key}&SharePwd={code or ''}&ParentFileId=0&Page=1"
            f"&event=homeListFile&operateType=1"
        )
        resp = await client.get(
            api,
            headers={
                "Referer": f"https://{host}/s/{share_key}",
                "Accept": "application/json, text/plain, */*",
                "Platform": "web",
                "App-Version": "3",
            },
        )
        if resp.status_code >= 400:
            last_err = f"HTTP {resp.status_code}"
            continue
        try:
            payload = resp.json()
        except Exception:
            last_err = "返回非 JSON"
            continue
        code_n = payload.get("code")
        if code_n not in (0, "0", None) and payload.get("data") is None:
            msg = payload.get("message") or payload.get("msg") or str(code_n)
            last_err = str(msg)
            if "密码" in str(msg) or "提取" in str(msg) or "pwd" in str(msg).lower():
                if not code:
                    raise ValueError("该分享需要提取码")
                raise ValueError("提取码错误或分享不可用")
            continue

        data = payload.get("data") or {}
        info = data.get("Info") or data.get("info") or data
        title = (
            (info.get("ShareName") if isinstance(info, dict) else None)
            or (info.get("shareName") if isinstance(info, dict) else None)
            or label
        )
        file_list = (
            data.get("InfoList")
            or data.get("info_list")
            or data.get("fileList")
            or data.get("list")
            or []
        )
        files: list[dict[str, Any]] = []
        for it in file_list:
            if not isinstance(it, dict):
                continue
            name = it.get("FileName") or it.get("fileName") or it.get("filename") or it.get("name") or "未命名"
            size = it.get("Size") if "Size" in it else it.get("size")
            is_dir = it.get("Type") == 1 or it.get("type") == 1 or it.get("isDir")
            if is_dir:
                name = f"[文件夹] {name}"
            files.append(
                {
                    "name": str(name),
                    "size": int(size) if isinstance(size, (int, float)) else None,
                    "url": url,
                }
            )
        fp = _fingerprint("123", share_key, str(title), files)
        return _result(url=url, provider_label=label, title=str(title), code=code, files=files, fingerprint=fp)

    # fallback HTML
    try:
        return await _fetch_html_fallback(client, url, share_key, code, label, "123")
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"123 网盘检查失败：{last_err}") from e


async def _fetch_lanzou(
    client: httpx.AsyncClient,
    url: str,
    share_key: str,
    code: str,
    label: str,
) -> dict[str, Any]:
    resp = await client.get(url)
    if resp.status_code >= 400:
        raise ValueError(f"蓝奏分享不可用：HTTP {resp.status_code}")
    html = resp.text
    final_url = str(resp.url)
    soup = BeautifulSoup(html, "html.parser")
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    for sel in ("#filenamelink", ".n_box .b", "div.n_box", "h2", ".file-name"):
        node = soup.select_one(sel)
        if node:
            t = node.get_text(" ", strip=True)
            if t and not t.startswith("http"):
                title = t
                break
    title = re.sub(r"\s+", " ", title or label)[:120]

    # password page
    if ("输入密码" in html or "pwd" in html.lower()) and ("filemoreajax" in html or "id=\"pwd\"" in html or "name=\"pwd\"" in html):
        if not code:
            raise ValueError("该分享需要提取码")
        # try ajax file list for folder shares
        m_sign = re.search(r"data\s*:\s*\{[^}]*'sign'\s*:\s*'([^']+)'", html)
        m_url = re.search(r"url\s*:\s*['\"]([^'\"]+filemoreajax[^'\"]*)['\"]", html)
        if m_url:
            ajax = m_url.group(1)
            if ajax.startswith("/"):
                parsed = urlparse(final_url)
                ajax = f"{parsed.scheme}://{parsed.netloc}{ajax}"
            data = {"pwd": code}
            if m_sign:
                data["sign"] = m_sign.group(1)
            # common fields
            for key, pat in (
                ("lx", r"'lx'\s*:\s*(\d+)"),
                ("fid", r"'fid'\s*:\s*(\d+)"),
                ("uid", r"'uid'\s*:\s*['\"]?(\d+)"),
                ("pg", r"'pg'\s*:\s*(\d+)"),
                ("rep", r"'rep'\s*:\s*['\"]?([^,'\"]+)"),
                ("t", r"'t'\s*:\s*([^,\n}]+)"),
                ("k", r"'k'\s*:\s*([^,\n}]+)"),
            ):
                mm = re.search(pat, html)
                if mm:
                    data[key] = mm.group(1).strip().strip("'\"")
            ar = await client.post(
                ajax,
                data=data,
                headers={
                    "Referer": final_url,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Requested-With": "XMLHttpRequest",
                },
            )
            try:
                payload = ar.json()
            except Exception:
                payload = {}
            files: list[dict[str, Any]] = []
            for it in payload.get("text") or []:
                if not isinstance(it, dict):
                    continue
                name = it.get("name_all") or it.get("name") or "未命名"
                size_s = it.get("size")
                size = None
                files.append({"name": str(name), "size": size, "url": url, "size_text": size_s})
            if files:
                # include size text in fingerprint via name
                fp_files = [
                    {"name": f"{f['name']}|{f.get('size_text') or ''}", "size": None} for f in files
                ]
                fp = _fingerprint("lanzou", share_key or final_url, title, fp_files)
                clean = [{"name": f["name"], "size": None, "url": url} for f in files]
                return _result(url=url, provider_label=label, title=title, code=code, files=clean, fingerprint=fp)

    # single file page: look for size
    size_text = ""
    m_size = re.search(r"(?:文件大小|大小)[：:]\s*([0-9.]+\s*[KMGT]?B)", html, re.I)
    if m_size:
        size_text = m_size.group(1).strip()
    files = [{"name": title or "分享文件", "size": None, "url": url}]
    if size_text:
        files[0]["name"] = f"{files[0]['name']} ({size_text})"

    # content fingerprint from title+size+filename markers
    extra = hashlib.sha1(
        re.sub(r"\s+", " ", soup.get_text(" ", strip=True))[:4000].encode("utf-8", "ignore")
    ).hexdigest()[:16]
    fp = _fingerprint("lanzou", share_key or final_url, title, files, extra=extra)
    return _result(url=url, provider_label=label, title=title, code=code, files=files, fingerprint=fp)


async def _fetch_tianyi(
    client: httpx.AsyncClient,
    url: str,
    share_key: str,
    code: str,
    label: str,
) -> dict[str, Any]:
    # Try access page then listShareDir
    page = await client.get(url, headers={"Referer": "https://cloud.189.cn/"})
    html = page.text if page.status_code < 400 else ""
    soup = BeautifulSoup(html or "", "html.parser")
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    title = re.sub(r"\s*[-_|].*$", "", title).strip() or label

    access_code = share_key or ""
    if not access_code:
        m = re.search(r"/t/([A-Za-z0-9_-]+)", url)
        access_code = m.group(1) if m else ""

    # public list API (best effort)
    if access_code:
        api = (
            "https://cloud.189.cn/api/open/share/getShareInfoByCodeV2.action"
            f"?shareCode={access_code}"
        )
        r = await client.get(api, headers={"Referer": "https://cloud.189.cn/", "Accept": "application/json"})
        if r.status_code < 400:
            try:
                data = r.json()
            except Exception:
                data = {}
            # nested fields vary
            share = data.get("shareInfo") or data.get("data") or data
            if isinstance(share, dict):
                title = share.get("fileName") or share.get("shareTitle") or share.get("name") or title
                files: list[dict[str, Any]] = []
                # single file
                if share.get("fileName") or share.get("name"):
                    name = share.get("fileName") or share.get("name")
                    size = share.get("fileSize") or share.get("size")
                    files.append(
                        {
                            "name": str(name),
                            "size": int(size) if isinstance(size, (int, float)) and int(size) >= 0 else None,
                            "url": url,
                        }
                    )
                file_list = share.get("fileList") or share.get("files") or []
                if isinstance(file_list, dict):
                    file_list = file_list.get("file") or file_list.get("list") or []
                if isinstance(file_list, list):
                    for it in file_list:
                        if not isinstance(it, dict):
                            continue
                        name = it.get("name") or it.get("fileName") or "未命名"
                        size = it.get("size") or it.get("fileSize")
                        files.append(
                            {
                                "name": str(name),
                                "size": int(size) if isinstance(size, (int, float)) else None,
                                "url": url,
                            }
                        )
                if files:
                    fp = _fingerprint("tianyi", access_code, str(title), files)
                    return _result(
                        url=url, provider_label=label, title=str(title), code=code, files=files, fingerprint=fp
                    )

    return await _fetch_html_fallback(client, url, access_code or share_key, code, label, "tianyi", pre_html=html)


async def _fetch_baidu(
    client: httpx.AsyncClient,
    url: str,
    share_key: str,
    code: str,
    label: str,
) -> dict[str, Any]:
    # Baidu list API usually needs cookies after verify. Use page markers + shortverify when possible.
    try:
        page = await client.get(url, headers={"Referer": "https://pan.baidu.com/"})
        html = page.text if page.status_code < 500 else ""
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"百度网盘页面无法访问：{e}") from e
    if page.status_code == 404 or "页面不存在" in html:
        raise ValueError("百度网盘分享不存在或已失效")
    if "分享的文件已经被取消" in html or "此链接分享内容可能因为涉及侵权" in html:
        raise ValueError("百度网盘分享已失效")

    # try surl verify with password
    surl = share_key
    if surl.startswith("1"):
        surl_body = surl[1:]  # baidu uses surl without leading 1 sometimes
    else:
        surl_body = surl

    if code:
        verify = await client.post(
            "https://pan.baidu.com/share/verify",
            params={"surl": surl_body, "t": "1", "channel": "chunlei", "web": "1", "app_id": "250528", "clienttype": "0"},
            data={"pwd": code, "vcode": "", "vcode_str": ""},
            headers={
                "Referer": url,
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
            },
        )
        try:
            vj = verify.json()
        except Exception:
            vj = {}
        # errno 0 success; -9 wrong password; -12 need captcha
        if vj.get("errno") == -9:
            raise ValueError("提取码错误")
        if vj.get("errno") == -12:
            # captcha required — fall back
            return await _fetch_html_fallback(client, url, share_key, code, label, "baidu", pre_html=html, note="需验证码，仅页面指纹")
        if vj.get("errno") == 0:
            sekey = vj.get("randsk") or ""
            cookies = {"BDCLND": sekey} if sekey else None
            list_resp = await client.get(
                "https://pan.baidu.com/share/list",
                params={
                    "shareid": _extract_js_var(html, "shareid") or "0",
                    "uk": _extract_js_var(html, "share_uk") or _extract_js_var(html, "uk") or "0",
                    "root": "1",
                    "page": "1",
                    "num": "100",
                    "channel": "chunlei",
                    "web": "1",
                    "app_id": "250528",
                    "clienttype": "0",
                },
                cookies=cookies,
                headers={"Referer": url},
            )
            try:
                lj = list_resp.json()
            except Exception:
                lj = {}
            if lj.get("errno") == 0 and isinstance(lj.get("list"), list):
                files = []
                title = _extract_js_str(html, "server_filename") or label
                for it in lj["list"]:
                    name = it.get("server_filename") or it.get("filename") or "未命名"
                    size = it.get("size")
                    isdir = it.get("isdir") in (1, "1", True)
                    if isdir:
                        name = f"[文件夹] {name}"
                    files.append(
                        {
                            "name": str(name),
                            "size": int(size) if isinstance(size, (int, float)) else None,
                            "url": url,
                        }
                    )
                if files and (not title or title == label):
                    title = files[0]["name"]
                fp = _fingerprint("baidu", share_key, str(title), files)
                return _result(url=url, provider_label=label, title=str(title), code=code, files=files, fingerprint=fp)

    return await _fetch_html_fallback(
        client,
        url,
        share_key,
        code,
        label,
        "baidu",
        pre_html=html,
        note="页面指纹（登录墙时可能延迟感知）",
    )


async def _fetch_quark(
    client: httpx.AsyncClient,
    url: str,
    share_key: str,
    code: str,
    label: str,
) -> dict[str, Any]:
    # Quark public share token API (best effort)
    if share_key:
        token_resp = await client.post(
            "https://drive-pc.quark.cn/1/clouddrive/share/sharepage/token",
            params={"pr": "ucpro", "fr": "pc"},
            json={"pwd_id": share_key, "passcode": code or ""},
            headers={
                "Content-Type": "application/json",
                "Referer": "https://pan.quark.cn/",
                "User-Agent": BROWSER_UA,
            },
        )
        try:
            tj = token_resp.json()
        except Exception:
            tj = {}
        data = tj.get("data") or {}
        stoken = data.get("stoken") or ""
        title = data.get("title") or data.get("share_title") or label
        if stoken:
            list_resp = await client.get(
                "https://drive-pc.quark.cn/1/clouddrive/share/sharepage/detail",
                params={
                    "pr": "ucpro",
                    "fr": "pc",
                    "pwd_id": share_key,
                    "stoken": stoken,
                    "pdir_fid": "0",
                    "force": "0",
                    "_page": "1",
                    "_size": "100",
                    "_fetch_banner": "1",
                    "_fetch_share": "1",
                    "_fetch_total": "1",
                },
                headers={"Referer": "https://pan.quark.cn/", "User-Agent": BROWSER_UA},
            )
            try:
                lj = list_resp.json()
            except Exception:
                lj = {}
            detail = (lj.get("data") or {})
            title = detail.get("share", {}).get("title") or detail.get("title") or title
            files = []
            for it in detail.get("list") or []:
                name = it.get("file_name") or it.get("name") or "未命名"
                size = it.get("size")
                if it.get("dir") or it.get("file_type") == 0:
                    name = f"[文件夹] {name}"
                files.append(
                    {
                        "name": str(name),
                        "size": int(size) if isinstance(size, (int, float)) else None,
                        "url": url,
                    }
                )
            if files:
                fp = _fingerprint("quark", share_key, str(title), files)
                return _result(url=url, provider_label=label, title=str(title), code=code, files=files, fingerprint=fp)
        # password errors
        msg = str(tj.get("message") or tj.get("msg") or "")
        if "密码" in msg or "提取" in msg or tj.get("status") == 400:
            if not code:
                raise ValueError("该分享需要提取码")
            # wrong code may also land here; still try HTML fallback

    return await _fetch_html_fallback(client, url, share_key, code, label, "quark", note="页面指纹")


def _extract_js_var(html: str, name: str) -> str:
    m = re.search(rf"{re.escape(name)}\s*[:=]\s*['\"]?(\d+)['\"]?", html or "")
    return m.group(1) if m else ""


def _extract_js_str(html: str, name: str) -> str:
    m = re.search(rf"{re.escape(name)}\s*[:=]\s*['\"]([^'\"]+)['\"]", html or "")
    return m.group(1) if m else ""


async def _fetch_html_fallback(
    client: httpx.AsyncClient,
    url: str,
    share_key: str,
    code: str,
    label: str,
    provider_id: str,
    pre_html: str | None = None,
    note: str = "页面指纹",
) -> dict[str, Any]:
    html = pre_html
    if html is None:
        resp = await client.get(url)
        if resp.status_code >= 400:
            raise ValueError(f"{label}分享不可用：HTTP {resp.status_code}")
        html = resp.text

    if any(x in (html or "") for x in ("页面不存在", "分享的文件已经被取消了", "啊哦，你所访问的页面不存在了")):
        raise ValueError(f"{label}分享不存在或已失效")

    soup = BeautifulSoup(html or "", "html.parser")
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    if title in {"页面不存在", "404", "Error"}:
        raise ValueError(f"{label}分享不存在或已失效")
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        title = og["content"].strip()
    title = re.sub(r"\s+", " ", title or label)[:120]

    # try extract file-like names from common patterns / JSON blobs
    files: list[dict[str, Any]] = []
    for pat in (
        r'"server_filename"\s*:\s*"([^"]+)"',
        r'"filename"\s*:\s*"([^"]+)"',
        r'"file_name"\s*:\s*"([^"]+)"',
        r'"fileName"\s*:\s*"([^"]+)"',
        r'"name"\s*:\s*"([^"]+\.[A-Za-z0-9]{1,8})"',
    ):
        for m in re.finditer(pat, html or ""):
            name = m.group(1)
            if name and name not in {f["name"] for f in files}:
                files.append({"name": name, "size": None, "url": url})
            if len(files) >= 50:
                break
        if len(files) >= 50:
            break

    text = soup.get_text("\n", strip=True)
    # content hash for change detection when file list unavailable
    digest = hashlib.sha1(re.sub(r"\s+", " ", text)[:8000].encode("utf-8", "ignore")).hexdigest()[:20]
    if not files:
        files = [{"name": title or "分享内容", "size": None, "url": url}]

    fp = _fingerprint(provider_id, share_key or url, title, files, extra=digest)
    return _result(
        url=url,
        provider_label=label,
        title=title,
        code=code,
        files=files,
        fingerprint=fp,
        note=note,
    )


def describe_netdisk_rule(rule: dict[str, Any] | None) -> str:
    rule = rule or {}
    code = str(rule.get("code") or "").strip()
    if code:
        return f"提取码 {code}"
    return "无提取码"
