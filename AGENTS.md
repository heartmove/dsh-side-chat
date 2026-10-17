# AGENTS.md — dsh-side-chat（侧边聊天 Plus）

本仓库是 DSH 的外部插件 **`dsh-side-chat-plus`**：一个 bundle（host 插件）加两个
客户端 bundle，通过 `dsh plugin add` 装进某个 DSH profile 后由 DSH 装载。

- npm 包名：`dsh-side-chat-plus`；插件清单 ID：`dsh-external/dsh-side-chat-plus`
- host 端：`src/index.ts` → `lib/index.js`
- client 端：`src/client/index.tsx` → `lib/client.js`（package-name 频道）
  与 `lib/client-registry.js`（manifest-id 频道）
- bundle patch：`cordis.patch.yml`；外部插件清单：`dsh.plugin.json`
- 插件页元信息：`locale/en.json`、`locale/zh-hans.json`、`assets/icon.svg`

## DSH 兼容性（硬性规则，务必遵守）

**支持的窗口是开区间 `>=0.2.1-rc.1`：`0.2.1-rc.1` 以及之后的所有 DSH 版本
（含预发布版本）都必须能装、能用；不设上界。**

判定来源：DSH 在安装/激活 bundle 时，用 `dsh-app-boot` 的
`evaluatePluginCompatibility()` 校验 `peerDependencies` 中的
`@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`，判定语句是
`semver.satisfies(runtimeVersion, range, { includePrerelease: true })`。
由此有两个必须避开的坑：

1. **caret 是闭区间。** `^0.2.0-rc.1` 的上界是 `0.2.0`，连 `0.2.0-rc.2` 都拒绝。
   真实事故：同一 profile 的 `dsh-session-bridge@0.4.0` 用 `^0.1.7-0` 声明，在桌面版
   0.2.0-rc.2 上被直接拒装（`dsh: installation rejected: Plugin … is incompatible
   with dsh 0.2.0-rc.2`），见 `.dsh/profiles/<profile>/.plugin-manager/logs/`。
2. **精确锁定、上界、`||` 链**同样是窄窗口：新版本一发布就装不上。

### 规则

1. 每个 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer 都写成**单一开区间**
   `>=<精确版本>`；所有 dsh peer 共用**同一个 floor**；不要用 `^`、`~`、精确版本、
   任何上界或 `||`。
2. `dsh.plugin.json` 的 `engines.dsh` 必须与 peer floor 完全一致（`>=<floor>`）。
3. **floor 只在破坏性变更时上移。** floor 表示「当前代码已知能正常工作的最低 DSH 版本」。
   平时不动；只有当 DSH 的破坏性变更**迫使本插件改代码并重新发布**时，才把 floor 抬到
   该破坏性变更所在的最低版本——既然改了代码、要重新发布，就不要留着旧下限假装还支持
   （用户 2026-09-29 明确要求）。**当前 floor = `0.2.1-rc.1`**：0.5.0 抬到这里，因为
   DSH 0.2.1-rc.1 改写了本插件镜像的 `/api` 信任栅栏（接受监听绑定 IP 字面量、按监听协议
   归一化默认端口、`trustedHosts` 改由 `webStartup` 提供），迫使本插件改代码并重新发布。
   `0.1.7` 及更早、以及 `0.2.0-rc.1`／`0.2.0-rc.2` 都不再承诺支持，不要因为「代码看起来
   还能跑」就把 floor 降回去。
4. `devDependencies` 与 `pnpm-lock.yaml` 固定在**当前最新**的 DSH 版本线（写作时
   `0.2.1-rc.1`），typecheck、测试、构建都对着它跑；floor 只体现在 peer 声明与跨版本验证里。
   当前 floor 与最新版本线同为 `0.2.1-rc.1`，所以这一版没有更低的线可复验；下次升版本线时
   floor 会重新低于 devDependency，那时再按下面的「floor 复验」跑两条线。
5. 升 DSH 版本线时，把新版本逐个加进 `pnpm-workspace.yaml` 的
   `minimumReleaseAgeExclude`。pnpm 11 默认 `minimumReleaseAge=1440`（1 天），刚发布的
   DSH 版本不在白名单里会报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`。**保留旧版本的
   条目**，这样可以随时把 devDependencies 切回 floor 做复验。
6. 新增/删除任何 `@deepseek-ai/dsh-*` 依赖时，`peerDependencies` 与 `devDependencies`
   一起改，并同步 `dsh.plugin.json`。

### 兼容性验证（每次改版本或改依赖都要跑）

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build          # 末尾依次跑 check-seed-exports 与 check-dsh-compat
```

- `pnpm check:dsh`（`scripts/check-dsh-compat.mjs`，也挂在 `pnpm build` 末尾）：
  机械地强制上面规则 1/2/3，并校验 floor ≤ 被测运行时。`^`／精确锁定／上界／多 floor
  都会让构建失败。
  - 指定被测运行时：`node scripts/check-dsh-compat.mjs --dsh-version 0.2.1-rc.1`，
    或设 `DSH_INSTALL` 指向 DSH 安装根目录；都没有时用固定下来的 devDependency 版本。
- `pnpm check:seed`（`scripts/check-seed-exports.mjs`）：把客户端 bundle 引用的冻结模块表
  与一份真实 DSH 安装（`--shell` / `$DSH_WEB_SHELL` / `$DSH_INSTALL` / `PATH` 上的 `dsh`）
  比对，找不到目标则跳过。DSH 少一个导出时 TypeScript 看不出来，只有这道闸能拦住。
- 最权威的一步——直接问 DSH 本人：用真实运行时里的 `dsh-app-boot` 跑
  `evaluatePluginCompatibility(manifest, {}, '<运行时版本>')`，返回 `undefined` 即兼容。
  本仓库 `node_modules` 里**没有** `dsh-app-boot`，可从本机 DSH 安装目录 import，例如全局
  `dsh` 的 `node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`。
- 插件页元信息同样可以直接问运行时：`dsh-app-boot` 的
  `readPluginMeta('dsh-side-chat-plus', <profile 目录的 file URL>)` 应返回中英 `title`／
  `description` 与内联的 `icon`（`<包>/icon`、`<包>/locale/<lang>.json` 都靠
  `package.json` 的 `exports` 解析，改 `exports` 后一定要复跑这一步）。
- **floor 复验**：把 `devDependencies` 全部临时切回 floor 版本 →
  `pnpm install && pnpm typecheck && pnpm test && pnpm build` → 再切回最新版本线并
  `pnpm install`。floor 低于 devDependency 时两条线都要绿。

### 当前状态（写作时的事实）

- 本机 DSH 运行时：**0.2.1-rc.1**（全局 `dsh` CLI、Web GUI `http://127.0.0.1:3080` 与
  `web` profile 同一版本线）；在该运行时下 `evaluatePluginCompatibility` 对本插件判定为
  **兼容**，且 `settings.get` / `sidechat.directory` / `sidechat.limits` /
  `sidechat.permissions` 在真实运行时上实测可用。
- 最近一次完整验证：`pnpm typecheck`、22 条测试、`pnpm build`（含对 0.2.1-rc.1 真实 web
  shell 的冻结模块表校验）全绿；floor 与版本线同为 0.2.1-rc.1，没有更低的线需要复验。
- 安装位置：`web` profile 以 `link:D:/code/DSH-side-chat` 链接；`desktop` profile 目前
  未安装本插件（装它走 `dsh plugin --profile desktop add …`；桌面应用必须**先完全退出**，
  CLI 才允许写 desktop profile）。
- **npm 上 `0.4.3` 及更早的版本在 0.2.1-rc.1 上装不上**（它们仍是 caret 形式的 peer）。
  `0.5.0` 是第一个声明 `>=0.2.1-rc.1` 的发布版，已发布且 `latest = 0.5.0`。排查「装不上」时先
  `npm view dsh-side-chat-plus@<版本> peerDependencies` 对一下，不要只看本仓库的
  `package.json`。
- **验证发布结果别只看 packument**：`https://registry.npmjs.org/dsh-side-chat-plus` 的
  `versions`／`dist-tags` 会滞后十几分钟，而 `<pkg>/<version>` 与
  `<pkg>/-/<pkg>-<version>.tgz` 是实时的。曾因此把一次成功的 CI 发布误判成失败。
- **本机直连 `registry.npmjs.org` 发布不可靠**（`ECONNRESET`／网络超时，连元数据 GET 都会被重置），
  发布请走 tag → `publish.yml`；本地只用 `pnpm pack` 校验产物内容。

## 构建与产物

- `pnpm build` = 清空 `lib/` → `tsc -p tsconfig.build.json`（生成 .d.ts）→ `tsdown`
  （host ESM + 两个 client CJS bundle）→ `check-seed-exports` → `check-dsh-compat`。
- client bundle 只允许引用 `tsdown.config.ts` 中 `CLIENT_EXTERNALS` 的模块
  （react / react-dom / cordis / `dsh-client-ui-slots` / `dsh-client-ui-primitives`）；
  其他 `@deepseek-ai/*` 值导入会被 purity gate 判为构建失败——跨插件协作走 cordis
  service，不要加值导入。
- CSS 一律走 CSS Modules，由 tsdown 内联成 `<style data-plugin>`，不要引入别的样式方案。
- 0.2.1-rc.1 起客户端 bundle 的入口由 `package.json` 的 `exports["./client"]` 决定
  （`dsh-client-modules` 的 `clientExportOf`），模块 id 是**包名**，所以生效的是
  `lib/client.js`；`dsh.plugin.json` 的 `client.main` 只对更早的线有意义，两边都要保留。

## 代码要点（容易踩的坑）

- 设置命名空间取自**拥有该 fiber 的 Loader entry**（`ctx.fiber.entry.options.id`，
  兜底 `loader.locate(fiber)`），不是 `ctx.entry`——受控 Context 对未声明属性直接抛错。
- 「带回主会话」写入的是 V4 **producer-owned source**（`plugin:dsh-side-chat`），
  旧的 `kind: 'plugin'` 会被严格持久化校验拒绝。
- 侧边会话默认归档；推理期间临时取消归档，本轮 settle 后恢复归档。
- 宿主路由在 `/sidechat/api/*`；客户端 bundle 有两个频道 id
  （`dsh-side-chat-plus` 与 `dsh-external/dsh-side-chat-plus`），两者都要顾及。
- `src/trust-fence.ts` 是 DSH `/api` 信任栅栏的自带副本，必须与运行时逐条对齐：loopback、
  声明的 `trustedHosts`、**监听器自己的绑定 IP 字面量**（`--host <IP>`）三者之一放行，
  再查 `sec-fetch-site` 与 Origin；Host/Origin 按**监听协议**归一化默认端口。
- `trustedHostsOf` 优先读 `webStartup.trustedHosts`（0.2.1-rc.1 起 `/api` 的权威来源），
  `connection` Loader 行（`options.id === 'connection'`，`name` 是
  `@deepseek-ai/dsh-client-connection`）只作 0.2.0 线的回退。Loader 行的
  `options.config` 保留**未求值**的 `!!js` 节点，任何读到的值都必须先 `Array.isArray` 校验，
  否则非 loopback 请求会在 fence 里抛 TypeError。

## 文档维护

改动兼容性窗口或版本线时，一并更新：`README.md`、`README.zh.md`（顶部与「环境要求」）、
`CHANGELOG.md`、`AGENTS.md`（本文件）、`.github/workflows/ci.yml` 与 `publish.yml` 里的
版本注释。
