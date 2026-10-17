# Hsu · 直播航班板（无后端静态版）

**不依赖任何后端服务器**的直播间状态看板：在一个页面里检测哔哩哔哩直播、斗鱼、虎牙和抖音直播间的
`live | looping | offline | unknown` 状态。

**线上演示**：<https://www.live.hsuxsj.xyz>

- 没有登录、注册、邀请码、管理员、统计、通知（飞书/Hermes）等功能。
- 关注列表保存在浏览器 **localStorage**，不上传任何服务器。
- 全部检测逻辑（链接解析、平台适配器、状态映射）都在浏览器端运行。
- 页面可见时每 2 分钟自动刷新，支持手动刷新（10 秒冷却）、搜索、状态筛选、排序、编辑与删除。
- 纯静态产物，可直接部署到 Cloudflare Pages（推荐）或 GitHub Pages。

## 为什么需要一个「检测通道」

四个直播平台的接口都**不允许浏览器直接访问**（实测 2026-10）：

| 平台 | 直连结果 |
| --- | --- |
| 哔哩哔哩 `api.live.bilibili.com` | 带 `Origin` 头的跨域请求直接返回 403 |
| 斗鱼 `www.douyu.com/betard` | 无 CORS 响应头 |
| 虎牙 `mp.huya.com` | 无 CORS 响应头 |
| 抖音 `live.douyin.com` | 需要先获取 `ttwid` Cookie，浏览器无法跨域读取 `Set-Cookie` |

因此检测请求必须经过一个中转通道。本项目内置两种通道，可在页面右上角 ⚙️ **检测通道设置** 中切换：

1. **内置中转（推荐）**：`functions/api/relay.ts` 是一个约 100 行的 Cloudflare Pages Function，
   只做域名白名单转发（B站/斗鱼/虎牙/抖音/b23.tv），无任何业务逻辑。
   **部署到 Cloudflare Pages 时自动生效，零配置、免维护、免费额度足够个人使用。**
2. **公共 CORS 代理（降级方案）**：适用于 GitHub Pages 等无法运行 Functions 的纯静态空间。
   在设置中填写代理模板（如 `https://api.allorigins.win/raw?url=`）即可检测 B站/斗鱼/虎牙；
   **抖音与 B站短链接（b23.tv）必须使用内置中转**，公共代理无法支持。

### ⚠️ 已知限制：B站 在 Cloudflare 上不可用

实测（2026-10）**B站 对 Cloudflare 边缘 IP 段做了整体风控**：从 CF Function 发出的任何 B站 请求
都稳定返回 `{"code":-412,"message":"request was banned"}`，换接口、换请求头、补 Cookie 均无效。

| 尝试过的方式 | 结果 |
| --- | --- |
| `room/v1/Room/get_info`（本机住宅 IP） | ✅ 200 |
| 同一接口，从 Cloudflare 边缘请求 | ❌ 412 |
| 换 `xlive/web-room/v1/index/getInfoByRoom`、`live_user/…/get_anchor_in_room` | ❌ 412 |
| 公开设备指纹接口 `api.bilibili.com/x/frontend/finger/spi` | ❌ 412 |
| 补 `buvid3/buvid4` Cookie + 完整浏览器 UA/Referer | ❌ 412（IP 已被封，Cookie 无效） |
| 浏览器直连（跨域必带 `Origin`） | ❌ 403 |
| 公共 CORS 代理（allorigins / codetabs / corsproxy.io / cors.lol） | ❌ 522 / 522 / 401 / 429 |

因此各平台的实测可用情况为：

| 部署方式 | 哔哩哔哩 | 斗鱼 | 虎牙 | 抖音 | b23.tv |
| --- | --- | --- | --- | --- | --- |
| **Cloudflare Pages（内置中转）** | ❌ 被风控 | ✅ 实测通过 | ✅ 实测通过 | ✅ 实测通过 | ✅ |
| 非机房 IP 自建中转（本机 / VPS） | ✅ | ✅ | ✅ | ✅ | ✅ |
| GitHub Pages + 公共代理 | ⚠️ 取决于代理 | ⚠️ | ⚠️ | ❌ | ❌ |

B站 检测失败时状态显示为 `unknown`（需确认），**不会伪造为 `offline`**。
如果你有非机房 IP 的服务器，可在 ⚙️ 检测通道设置中填入自建代理，即可恢复 B站 检测。

## 本地开发

```powershell
pnpm install
pnpm dev        # http://localhost:5173，开发服务器内置了与 Cloudflare Function 相同的中转逻辑
pnpm test       # 链接解析 / 平台适配器 / 本地仓库 / 传输层 / 中转核心单元测试
pnpm typecheck  # TypeScript 类型检查
pnpm build      # 类型检查 + 生产构建到 dist/
```

## 部署到 Cloudflare Pages（推荐）

### 方式 A：Git 集成（推送即部署）

1. 把仓库推送到 GitHub/GitLab。
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，选择仓库。
3. 构建配置：
   - **Root directory**: 留空（仓库根目录即应用根目录）
   - **Build command**: `pnpm build`
   - **Build output directory**: `dist`
   - **环境变量**：无需设置。Pages v3 构建镜像默认 Node.js 22.16 + pnpm 10.11，
     已满足本项目要求（Vite 8 需要 Node ≥ 22.12，lockfile 为 pnpm 9.0 格式）
4. 部署完成后，`functions/api/relay.ts` 会自动作为 `/api/relay` 边缘函数生效，
   页面「检测通道」会显示 **内置中转：可用**，斗鱼 / 虎牙 / 抖音 即可正常检测
   （B站 受平台风控限制，见上文《已知限制》）。

### 方式 B：Wrangler CLI 直接部署

```powershell
pnpm install
pnpm deploy      # = pnpm build && pnpm dlx wrangler pages deploy dist
```

首次使用需要 `pnpm dlx wrangler login` 授权。`wrangler.toml` 已配置输出目录。

> 平台差异：四个接口对机房 IP 的容忍度不同。实测 Cloudflare 边缘上 斗鱼 / 虎牙 / 抖音 均正常，
> **B站 会被风控**（见上文《已知限制》）。

### 绑定自定义域名

1. 确认域名已托管在 Cloudflare（DNS 使用 CF 的 nameserver）。若还没有，
   在 Dashboard → **Add a site** 添加域名并选 Free 计划，再到注册商处把 NS 改成 CF 提供的两个。
2. Workers & Pages → 该项目 → **Custom domains** → **Set up a custom domain**，
   输入要用的域名（推荐子域名，如 `live.example.com`，不影响根域名上已有的邮箱/网站记录）。
3. CF 会自动创建 DNS 记录（CNAME 指向 `<项目名>.pages.dev`）并签发 SSL 证书；
   Custom domains 里的状态由 `Initializing` 变为 **`Active`** 后即可访问（一般 1~5 分钟）。
4. 建议到 **SSL/TLS → Edge Certificates** 打开 **Always Use HTTPS**，让 http 强制跳转 https。

前端资源使用相对路径、中转是**同源** `/api/relay`，因此绑定自定义域名**不需要改动任何代码**。
注意 `www.example.com` 与 `example.com` 是两个不同的域名，需要分别添加。

### 免费配额与超额表现

Cloudflare 免费版每天 **100,000 次** Function 调用（静态资源免费不限量），**次日 UTC 0 点 = 北京时间 08:00 自动重置**。
实测：**每个直播间每轮检测 1 次请求**，页面加载时额外 1 次探测；页面切到后台即停止轮询，不消耗配额。
配额耗尽时页面照常打开，检测行显示「状态未知 · 检测通道不可用」（不会伪装成平台故障），次日 08:00 自动恢复，无需重启或改配置。

## 关于 GitHub Pages（可选，功能受限）

仓库附带的是 CI 工作流 [.github/workflows/ci.yml](.github/workflows/ci.yml)：推送时执行类型检查、单元测试与构建，
不包含 Pages 部署步骤（部署走 Cloudflare Pages）。如果仍想发布到 GitHub Pages，需要自行启用
Pages（Settings → Pages → Source 选择 **GitHub Actions**）并补一个部署工作流。

限制：GitHub Pages 无法运行 `/api/relay`，因此**抖音检测与 B站短链接识别不可用**。若要用它，
需在页面 ⚙️ 检测通道设置里填写公共 CORS 代理模板才能检测 B站/斗鱼/虎牙，例如：

- `https://api.allorigins.win/raw?url=`
- `https://api.codetabs.com/v1/proxy?quest=`

公共代理由第三方提供，可用性无法保证（实测 2026-10：allorigins 与 codetabs 返回 522、
corsproxy.io 需要付费 key、cors.lol 限流），因此 GitHub Pages 只能算兜底方案，
需要完整功能请使用 Cloudflare Pages。

## 目录结构

```text
├── .github/workflows/ci.yml      CI：类型检查 + 单元测试 + 构建
├── functions/api/relay.ts        Cloudflare Pages Function（域名白名单中转，部署到 CF 自动生效）
├── shared/
│   ├── relay-core.ts             中转核心逻辑（CF Function 与本地开发服务器共用）
│   └── relay-core.test.ts        中转核心测试（白名单 / Cookie / 短链接解析）
├── src/
│   ├── platform/                 链接解析、四平台适配器、传输层、LiveApi（全部浏览器端）
│   ├── storage/                  localStorage 关注列表仓库
│   ├── features/board/           看板 UI（概览 / 搜索 / 筛选 / 状态分区）
│   ├── features/settings/        检测通道设置
│   ├── hooks/                    状态轮询 / 列表读取
│   └── theme/                    明暗主题
├── public/_headers               Cloudflare Pages 安全响应头
├── wrangler.toml                 Wrangler Pages 配置
├── vite.config.ts                构建配置（含本地开发中转中间件）
└── vitest.config.ts              单元测试配置（覆盖 src/ 与 shared/）
```

## 数据与隐私

- 关注列表、主题、检测通道配置全部保存在浏览器 localStorage，清除浏览器数据即删除。
- 页面不收集、不上传任何用户数据；中转仅转发公开的直播间状态接口请求。
- 直播间跳转使用新标签页 + `noopener noreferrer`。
