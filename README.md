# 更新追踪（AppUpdate）

内网自用：追踪 **GitHub Release 下载附件** 与 **单篇文章网盘链接**，网页管理，可选 Telegram 推送。

## 功能

- GitHub 公开仓库：正式版 + 预发布；按扩展名 / 系统 / 架构别名 / 包含排除筛选附件
- 单篇文章：标题变化则整页重抓，提取百度 / 阿里 / 夸克 / 123 / 天翼 / 蓝奏
- 只保留当前最新状态
- 固定间隔检查（默认 6 小时，可在设置里改）+ 立即检查
- 可停用不删除
- Docker 一键部署，无登录

## 上线部署（推荐）

```bash
# 若使用 Colima（无 Docker Desktop 时）
# brew install colima docker docker-compose && colima start

docker compose up -d --build
```

浏览器打开：http://127.0.0.1:8000

首次打开为空列表。在网页中：

1. **设置**：填写检查间隔、Telegram Bot Token / Chat ID（可选）、**面板访问密码（可选）**
2. **添加**：GitHub 仓库或文章链接，并配置筛选规则
3. 添加后会自动检查；也可随时点 **立即检查**

数据持久化目录：`./data`（SQLite 文件 `appupdate.db`，首次运行自动创建）

停止：

```bash
docker compose down
```

## 可选环境变量

| 变量 | 说明 |
|------|------|
| `GITHUB_TOKEN` | 提高 GitHub API 限额（建议内网服务器配置） |
| `APPUPDATE_PANEL_PASSWORD` | 首次初始化时写入面板密码（库中已有密码时不覆盖；日常请在网页设置） |
| `APPUPDATE_DATA_DIR` | 数据目录，默认 `/data`（容器内） |
| `APPUPDATE_INTERVAL_HOURS` | 仅影响**首次初始化**时的默认间隔，之后以网页设置为准 |

在 `docker-compose.yml` 中取消 `GITHUB_TOKEN` 注释即可注入。

## 本地开发

需要 Python 3.12 或 3.13：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 说明

- 仅支持公开 GitHub 仓库
- 不做自动下载、不自动转存网盘
- 无登录（仅限内网）
- 设计稿与交互原型在 `design-options/`、`prototype/`，上线部署不需要，已排除在 Docker 构建之外
