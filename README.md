# Hsu · 直播航班板（无后端静态版）

**不依赖任何后端服务器**的直播间状态看板：在一个页面里检测哔哩哔哩直播、斗鱼、虎牙和抖音直播间的
`live | looping | offline | unknown` 状态。

- 没有登录、注册、邀请码、管理员、统计、通知（飞书/Hermes）等功能。
- 关注列表保存在浏览器 **localStorage**，不上传任何服务器。
- 全部检测逻辑（链接解析、平台适配器、状态映射）都在浏览器端运行。
- 页面可见时每 2 分钟自动刷新，支持手动刷新（10 秒冷却）、搜索、状态筛选、排序、编辑与删除。
- 纯静态产物，可直接部署到 Cloudflare Pages 或 GitHub Pages。

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

## 本地开发

```powershell
pnpm install
pnpm dev        # http://localhost:5173，开发服务器内置了与 Cloudflare Function 相同的中转逻辑
pnpm test       # 链接解析 / 平台适配器 / 本地仓库 / 传输层单元测试
pnpm typecheck  # TypeScript 类型检查
pnpm build      # 类型检查 + 生产构建到 dist/
```

## 部署到 Cloudflare Pages（推荐，四平台全支持）

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
   页面探测到中转可用后即可检测全部四个平台。

### 方式 B：Wrangler CLI 直接部署

```powershell
pnpm install
pnpm deploy      # = pnpm build && pnpm dlx wrangler pages deploy dist
```

首次使用需要 `pnpm dlx wrangler login` 授权。`wrangler.toml` 已配置输出目录。

> 抖音检测依赖平台对数据中心 IP 的容忍度；若抖音返回 `unknown`，属于平台侧限制，
> B站/斗鱼/虎牙不受影响。

## 关于 GitHub Pages（可选，功能受限）

仓库附带的是 CI 工作流 [.github/workflows/ci.yml](.github/workflows/ci.yml)：推送时执行类型检查、单元测试与构建，
不包含 Pages 部署步骤（部署走 Cloudflare Pages）。如果仍想发布到 GitHub Pages，需要自行启用
Pages（Settings → Pages → Source 选择 **GitHub Actions**）并补一个部署工作流。

限制：GitHub Pages 无法运行 `/api/relay`，因此**抖音检测与 B站短链接识别不可用**。若要用它，
需在页面 ⚙️ 检测通道设置里填写公共 CORS 代理模板才能检测 B站/斗鱼/虎牙，例如：

- `https://api.allorigins.win/raw?url=`
- `https://api.codetabs.com/v1/proxy?quest=`

公共代理由第三方提供，速度与稳定性不可保证。需要完整功能请使用 Cloudflare Pages。

## 目录结构

```text
├── .github/workflows/ci.yml      CI：类型检查 + 单元测试 + 构建
├── functions/api/relay.ts        Cloudflare Pages Function（域名白名单中转，部署到 CF 自动生效）
├── shared/relay-core.ts          中转核心逻辑（CF Function 与本地开发服务器共用）
├── src/
│   ├── platform/                 链接解析、四平台适配器、传输层、LiveApi（全部浏览器端）
│   ├── storage/                  localStorage 关注列表仓库
│   ├── features/board/           看板 UI（概览 / 搜索 / 筛选 / 状态分区）
│   ├── features/settings/        检测通道设置
│   ├── hooks/                    状态轮询 / 列表读取
│   └── theme/                    明暗主题
├── public/_headers               Cloudflare Pages 安全响应头
├── wrangler.toml                 Wrangler Pages 配置
└── vite.config.ts                构建配置（含本地开发中转中间件）
```

## 数据与隐私

- 关注列表、主题、检测通道配置全部保存在浏览器 localStorage，清除浏览器数据即删除。
- 页面不收集、不上传任何用户数据；中转仅转发公开的直播间状态接口请求。
- 直播间跳转使用新标签页 + `noopener noreferrer`。
