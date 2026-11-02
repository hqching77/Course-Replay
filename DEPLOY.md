# 上线部署：让朋友 / 真实用户用上 Course Replay

> 一句话：**GitHub Pages 只放网页（前端）**。账号、笔记、AI、上课转写都要靠一台跑后端的服务器，数据库也在那台服务器（或它连的数据库服务）上。
> 所有密钥只填在服务器的「环境变量」里，**永远不进 git**。

## 1. 数据到底存在哪

```
朋友的浏览器 ──打开网页──▶ GitHub Pages（只有 HTML/JS，没有任何数据和密钥）
      │
      └──登录 / 同步 / AI──▶ 后端 API（Render 或 香港云服务器）──▶ 数据库（Neon Postgres 或 SQLite 文件）
                                         └──▶ AI / 语音识别服务（用服务器上的 Key）
```

| 情况 | 数据存在哪 |
| --- | --- |
| 只有 GitHub Pages、没部署后端 | 网页自动进入「离线模式」：数据只在**每个人自己浏览器**的 localStorage 里，换设备或清缓存就没了，AI 和上课转写不能用 |
| 部署了后端 | 账号、课程、笔记、转写、提问都在 `DATABASE_URL` 指向的数据库里；上传的原文件在后端机器的 `data/` 目录 |
| 你本机 `npm run dev:api` | 你电脑上的 `backend/data/course_replay.db`，别人访问不到 |

## 2. 安全：别人拿到后端 / 数据库能看到什么

| 内容 | 怎么保护的 |
| --- | --- |
| 密码 | 只存 scrypt 哈希，谁都还原不出原密码 |
| 登录令牌 | 只存 SHA-256 哈希，30 天不用自动过期 |
| 课程名、小节名、笔记、课堂转写、提问和回答、AI 对话、上传文件名 | **AES-256-GCM 加密后才写进数据库**（`DATA_ENCRYPTION_KEY`）。拿到数据库或备份的人只看到 `enc:v1:…` 乱码 |
| 处理结果文件 `result.json` | 同样加密 |
| 用户在「设置」里填的自己的 AI / 语音 Key | 只存在用户自己的浏览器，不存服务器 |
| 用户名、昵称、时间戳、上传的原文件本身 | 不加密（原文件在服务器磁盘上，所以服务器本身要可信） |
| 别人的笔记 / 文档预览 | 每个接口都检查「是不是你的」，看别人的一律 404 |
| 暴力猜密码 | 同一账号 10 分钟内错 8 次、同一 IP 错 30 次就暂时锁住；同一 IP 每小时最多注册 10 个号 |

**做不到的事（诚实说明）**：能控制服务器的人（你自己、或者偷到服务器登录权限的人）同时拿得到密钥，所以能解密。真正的「端到端加密」对这个应用不可能——AI 要读到明文才能帮你整理笔记。所以：服务器密码 / Render 账号要开两步验证；数据库和密钥分开放（数据库在 Neon，密钥在 Render / 服务器），只泄露其中一个都读不出笔记。

## 3. 先准备：加密密钥

在任意装了 Python 的电脑上运行一次：

```bash
python3 -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

把输出的那串（44 个字符）**存进密码管理器**。以后一直用这一个：
- 丢了它 = 数据库里的笔记永远读不出来；
- 换了它 = 旧数据也读不出来。

## 4. 方案 A：Render + Neon（0 元，适合先给几个朋友用）

**限制**：15 分钟没人访问后端会睡着，下次打开要等约 1 分钟（上课前提前 1 分钟打开网页就行）；Render 免费机的磁盘每次重启都清空，所以笔记必须放 Neon，已上传文档的「查看文档」在重启后会打不开（笔记本身不受影响）；服务器在新加坡，国内访问偶尔会慢。

1. **数据库（Neon）**：注册 <https://neon.com> → 新建 Project，Region 选 *AWS Asia Pacific (Singapore)* → 复制 Connection string（`postgresql://…?sslmode=require`）。
2. **后端（Render）**：注册 <https://render.com>（用 GitHub 登录）→ **New → Blueprint** → 选 `Course-Replay` 仓库（分支选包含 `render.yaml` 的那个）。它会读取仓库里的 `render.yaml`，问你要这些值：

   | 变量 | 填什么 |
   | --- | --- |
   | `DATA_ENCRYPTION_KEY` | 第 3 步生成的密钥 |
   | `DATABASE_URL` | Neon 的 connection string（直接粘贴，`postgresql://` 开头就行） |
   | `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_CHAT_MODEL` / `OPENAI_VISION_MODEL` | 服务器默认用的 AI（任意 OpenAI 兼容接口）。不想替大家付钱可以留空，让每个人在「设置」里填自己的 Key |
   | `STT_API_KEY` | 上课语音转文字的 Key（默认硅基流动 SenseVoiceSmall，在 cloud.siliconflow.cn 申请）。留空则用户需用浏览器自带识别或自己的 Key |

   部署完成后会得到地址，例如 `https://course-replay-api.onrender.com`。打开 `…/api/health` 能看到一段 JSON 就说明好了。
3. **把网页连到后端**：GitHub 仓库 → Settings → Secrets and variables → Actions → **Variables** 标签 → New repository variable：名字 `API_BASE`，值填上一步的地址（不要末尾的 `/`）。然后到 Actions → *Deploy frontend to GitHub Pages* → Run workflow 重新发布一次。
4. 打开 `https://hqching77.github.io/Course-Replay/`，注册账号，在「设置」里点「检查服务端配置」确认 AI 能用。

> `render.yaml` 里的 `CORS_ORIGINS` 写的是 `https://hqching77.github.io`。如果网页换了地址（比如 fork 到别的账号），记得在 Render 后台改它，否则浏览器会拒绝连接。

## 5. 方案 B：香港云服务器（阿里云学生券），一直在线、国内更快

适合正式给很多人用。香港地域**不需要 ICP 备案**。

1. 买一台阿里云 **香港** 地域的轻量应用服务器 / ECS（Ubuntu 24.04，至少 2 GB 内存，LibreOffice 转 PPT 比较吃内存）。安全组放行 **80** 和 **443** 端口。
2. 准备一个域名，DNS 加一条 A 记录指向服务器 IP。没有域名也可以先用 `<IP 用横线连>.sslip.io`，例如 IP `47.242.1.2` → `47-242-1-2.sslip.io`。
3. SSH 登录服务器：
   ```bash
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/hqching77/Course-Replay.git && cd Course-Replay/deploy
   cp production.env.example production.env
   nano production.env      # 填 DATA_ENCRYPTION_KEY、AI / 语音 Key；DATABASE_URL 留空就用本机 SQLite
   nano Caddyfile           # 把 api.example.com 换成你的域名
   docker compose up -d --build
   ```
   Caddy 会自动申请 HTTPS 证书。打开 `https://你的域名/api/health` 检查。
4. 和方案 A 第 3 步一样，把 `API_BASE` 设成 `https://你的域名`，重新发布网页。
5. **更新代码**：`git pull && docker compose up -d --build`
6. **备份**（用 SQLite 时，建议每周一次，备份文件里笔记是加密的，但仍然别公开）：
   ```bash
   docker compose exec api python3 -c "import sqlite3; s=sqlite3.connect('data/course_replay.db'); d=sqlite3.connect('data/backup.db'); s.backup(d); d.close()"
   docker compose cp api:/app/data/backup.db ./backup-$(date +%F).db
   ```

## 6. 生产环境变量一览

| 变量 | 说明 |
| --- | --- |
| `APP_ENV=production` | 打开上线检查：没有加密密钥就拒绝启动；关闭 `/docs` 接口文档 |
| `DATA_ENCRYPTION_KEY` | 必填，见第 3 步 |
| `DATABASE_URL` | Postgres 地址；留空 = SQLite（只适合有持久磁盘的服务器） |
| `CORS_ORIGINS` | 允许调用 API 的网页地址，例如 `https://hqching77.github.io` |
| `CLIENT_IP_HEADER` | 反向代理告诉后端真实访客 IP 的请求头（Render：`True-Client-IP`；方案 B：`X-Real-IP`），用于防暴力破解 |
| `OPENAI_*`、`STT_*` | 服务器默认的 AI / 语音服务，可留空 |
| `ALLOW_REGISTRATION` | 朋友都注册好以后可改成 `false`，陌生人就不能再注册 |
| `ALLOW_CUSTOM_PROVIDERS` | 是否允许用户在设置里用自己的 Key（默认允许） |

## 7. 千万别做

- 别把 `.env`、`deploy/production.env`、任何 Key 提交到 GitHub。`.gitignore` 已经挡住了，但 `git add -f` 会绕过它；提交前看一眼 `git status`。
- 别把 Key 放进 `VITE_` 开头的变量或前端代码：网页代码所有人都能下载查看。`API_BASE` 只是一个网址，不是秘密。
- Key 一旦泄露（比如误提交过），去服务商后台**作废并重新生成**，光删提交记录不够。
- 别随便改 `DATA_ENCRYPTION_KEY`。

本地开发（`npm run dev` + `npm run dev:api`）仍然用根目录的 `.env`，见 `readme.md`；它只在你自己电脑上，不会被提交。
