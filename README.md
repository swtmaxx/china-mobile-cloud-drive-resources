# 139 云盘资源分发站

这是一个面向公开访客的资源目录站点：前端使用 Vite + React，API 使用 Cloudflare Pages Functions，139 云盘作为新版个人云资源源，Workers KV 保存加密后的会话、后台配置和短期目录缓存。

站点默认公开 `YUN139_ROOT_ID` 及其子目录；管理员也可以在 `/admin` 的资源显示管理中选择任意可见文件夹作为公开展示根目录，访客的 `dir=root` 会从该文件夹开始浏览。配置不存在时继续使用 `YUN139_ROOT_ID`。站点不在浏览器中保存或传递 139 Authorization、密码和 MailCookies。`/admin` 是不在公开首页显示的单管理员后台入口。

## 本地开发

安装依赖：

```bash
npm install
```

只开发前端：

```bash
npm run dev
```

运行包含 Pages Functions 的本地 Cloudflare runtime：

```bash
npm run cf:dev -- --port 8793
```

Wrangler 会自动读取 `.dev.vars`。仅运行 `npm run dev` 只会启动前端，不会加载 Pages Functions。

没有配置 139 凭据时，首页和 `/api/health` 仍可运行，但资源目录接口会返回配置错误；不会触发真实登录。

本地测试后台时，在 `.dev.vars` 中设置 `ADMIN_PASSWORD`、`ADMIN_SESSION_KEY` 和 `ADMIN_DATA_KEY`。HTTPS 环境的会话 Cookie 带有 `Secure`；Wrangler 的 HTTP 本地开发会按协议省略该属性，便于本地浏览器测试。

验证命令：

```bash
npm run typecheck
npm test
npm run build
```

## Cloudflare 部署

1. 在 Cloudflare 创建 Pages 项目。
2. 创建 KV namespace：

```bash
npx wrangler kv namespace create RESOURCE_KV
```

3. 将命令输出的 namespace ID 写入 `wrangler.toml` 的 `RESOURCE_KV` 配置。
4. 在 Pages 项目中绑定同名 KV：`RESOURCE_KV`。
5. 配置以下环境变量。密码、Cookie 和密钥必须使用 Secret，不要写入仓库：

```text
YUN139_USERNAME
YUN139_PASSWORD
YUN139_MAIL_COOKIES
YUN139_AUTHORIZATION       # 可选；存在时优先使用
AUTH_ENCRYPTION_KEY        # 32 字节，Base64URL 或 64 位 hex
RESOURCE_HANDLE_KEY        # 32 字节，Base64URL 或 64 位 hex
ADMIN_PASSWORD             # 首次登录密码
ADMIN_SESSION_KEY          # 管理员会话 Cookie 加密密钥
ADMIN_DATA_KEY             # 管理员配置和 139 凭据加密密钥
YUN139_TYPE=personal_new
YUN139_ROOT_ID=/
RESOURCE_HANDLE_TTL=86400
RESOURCE_CACHE_TTL=60
```

生成加密密钥示例：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

执行两次，分别用于 `AUTH_ENCRYPTION_KEY` 和 `RESOURCE_HANDLE_KEY`，不要复用；再执行两次，分别用于 `ADMIN_SESSION_KEY` 和 `ADMIN_DATA_KEY`，四个密钥不要复用。

构建并部署：

```bash
npm run cf:deploy
```

也可以在 Pages 中设置构建命令 `npm run build`，输出目录 `dist`，让 Git push 自动部署。

### Git 自动部署

在 Cloudflare Pages 连接代码仓库后，使用以下设置：

```text
Build command: npm run build
Build output directory: dist
Production branch: main
```

在 Pages 项目的 Production 环境中绑定 KV namespace `RESOURCE_KV`，并分别配置上述变量和 Secret。Preview 环境应使用独立 KV namespace、`AUTH_ENCRYPTION_KEY`、`RESOURCE_HANDLE_KEY`、`ADMIN_SESSION_KEY` 和 `ADMIN_DATA_KEY`，避免预览环境读写生产会话或配置。

部署后先检查：

```text
GET /api/health
GET /api/resources?dir=root
```

## API

```text
GET /api/resources?dir=root
GET /api/resources?dir=<opaque-directory-handle>
GET /api/download?resource=<opaque-file-handle>
GET /api/health

POST /api/admin/session
GET /api/admin/session
DELETE /api/admin/session
GET /api/admin/account
POST /api/admin/account/password
GET /api/admin/provider
PATCH /api/admin/provider
POST /api/admin/provider/test
GET /api/admin/resources?dir=root
PATCH /api/admin/resources
```

管理员资源接口始终浏览云盘原始根目录。对 `PATCH /api/admin/resources` 发送 `{ resourceHandle, displayRoot: true }` 可将一个文件夹设为公开展示根目录；发送 `{ displayRoot: false }` 可恢复使用 `YUN139_ROOT_ID`。展示根目录、隐藏规则和对应版本保存在加密 KV 中。切换展示根目录会立即使旧公开目录句柄失效，隐藏资源不会出现在公开目录中，也不能下载。

目录和文件 ID 都封装在 AES-GCM opaque 句柄中。API 不接受任意原始 `fileId`，目录响应不返回原始父目录 ID；下载接口在服务端获取 139 临时直链并返回 `302`。

opaque 句柄由 `RESOURCE_HANDLE_KEY` 保护，密钥轮换会使已有目录和下载链接失效，这是预期行为。

## 会话行为

KV 中保存的是 AES-256-GCM 加密后的 139 Authorization，以及自动登录流程返回的 MailCookies。请求发现 token 临近过期时，会调用 139 刷新接口并更新 KV；刷新失败会回退到密码登录流程。旧 KV 会话无法用当前密钥解密时会自动清理并恢复，不会持续返回 `session_invalid`。

MailCookies 本身无法由 139 token 自动续期。MailCookies 过期时，需要重新获取并在后台更新。后台只返回账号掩码、是否已配置和 Authorization 过期状态，不返回密码、Cookie 或 Authorization。日志不会输出密码、Cookie、Authorization、token 或解密后的登录响应。

管理员密码首次成功登录后会以 PBKDF2-SHA256 加盐哈希保存到 KV，之后以 KV 哈希为准。管理员配置、139 凭据和资源显示规则使用 `ADMIN_DATA_KEY` 加密。修改云盘配置会清除旧的 139 会话；修改资源规则会递增规则版本，让新的公开目录缓存立即使用最新显示状态。

使用 GitHub 自动部署时，生产环境变量和 Secrets 应配置在 Cloudflare Pages 项目的 `Settings` → `Variables and Secrets` 中，不要把生产值写入 `wrangler.toml`。仓库中的 Wrangler 配置只保留 Pages 构建目录和 `RESOURCE_KV` 绑定；修改 Pages 变量后需要重新部署才会应用到 Functions。

## 当前边界

当前版本只支持新版个人云的目录浏览、文件详情和下载，不包含搜索、在线预览、上传、删除、分享链接、多用户和多管理员角色。公开展示根目录只能选择云盘中已能被后台浏览到的文件夹；后台仍从云盘原始根目录管理资源。小规模公开访问和后台配置继续使用 KV；只有在需要本地分类、标签、封面、统计或用户系统时，才建议增加 D1。
