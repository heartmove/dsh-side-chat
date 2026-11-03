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
   还能跑」就把 floor 降回去。**0.2.2-alpha.3 没有抬 floor**：它把模型选择改成持久的
   `agent.model.select()`（`installModelSelection` 只剩一个参数、只负责切换提示），
   属于可做能力探测的加法式改造，两条线都能正确工作，因此只改代码、不抬下限。
4. `devDependencies` 与 `pnpm-lock.yaml` 固定在**当前最新**的 DSH 版本线（写作时
   `0.2.2-alpha.3`，`cordis` 对齐运行时 `4.0.6-alpha.2`、`schemastery`
   `3.18.6-alpha.2`），typecheck、测试、构建都对着它跑；floor 只体现在 peer 声明与跨版本
   验证里。现在 floor（`0.2.1-rc.1`）低于版本线，**每次升版本线都要按下面的「floor 复验」
   跑两条线**（0.5.1 已按此跑过，见「当前状态」）。
5. 升 DSH 版本线时，把新版本逐个加进 `pnpm-workspace.yaml` 的
   `minimumReleaseAgeExclude`。pnpm 11 默认 `minimumReleaseAge=1440`（1 天），刚发布的
   版本不在白名单里会报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`；**CI 的
   `pnpm install --frozen-lockfile` 会直接失败**（0.5.1 就栽在这里：本机
   `minimumReleaseAge=0` 看不见，CI 默认 1440 当场拒绝）。**保留旧版本的条目**，这样可以
   随时把 devDependencies 切回 floor 做复验。

   - 要覆盖**该线解析出来的每一个包**，不只是 package.json 里点名的那些：0.5.1 漏掉的是
     `@deepseek-ai/dsh-official-bundles`、`@deepseek-ai/dsh-util-time`（dsh 的传递依赖）
     以及 `cordis-plugin-group@1.0.6-alpha.2`、`cordis-plugin-include@1.0.11-alpha.2`、
     `cordis-plugin-loader@1.0.7-alpha.2`、`cosmokit@1.8.7-alpha.2`。
   - 本机等价校验（推之前必跑）：`pnpm check:age`
     （= `pnpm install --frozen-lockfile --config.minimumReleaseAge=1440`），它复现 CI 的
     供应链闸门。
6. 新增/删除任何 `@deepseek-ai/dsh-*` 依赖时，`peerDependencies` 与 `devDependencies`
   一起改，并同步 `dsh.plugin.json`。

### 向前兼容（对新版本不设墙）

「兼容」有两层，必须分开看：

1. **安装期**：由 semver 判定。peer 全是单一开区间 `>=<floor>`、没有任何上界，所以
   0.2.2-rc.1 / 0.2.2 / 0.2.3 / 0.3.0 / 1.0 / 2.0 一律被
   `evaluatePluginCompatibility` 放行（已用真实 `dsh-app-boot` 逐个实测 ACCEPT）。
   **不要**为了让新版本装上而改 peer——它本来就装得上。
2. **运行期**：semver 看不见，靠代码形态。硬规矩：
   - **不做版本号比较**（不写 `if (runtime >= 0.2.2)`）。一律**能力探测**：导出/成员/方法
     在不在、签名对不对（如 `AgentModel` 是否存在 → 持久选择 vs 可变 ref 耦合器），
     探测失败就退回旧路径或安全降级。
   - **跨插件能力走 cordis service，用可选访问**（`ctx.get('x')`、`?.()`），不要值导入
     别的插件包，也不要假设新服务一定存在。
   - **客户端平台模块**（冻结模块表）只外置 `react` / `react-dom` / `cordis` /
     `dsh-client-ui-slots` / `dsh-client-ui-primitives`；`check-seed-exports` 在构建期
     拿最新安装的真实 shell 校验导出，运行期再用 `SidechatErrorBoundary` 兜底——运行时
     比构建线新时宁可局部显示失败提示，也不要整个面板/右侧栏白屏。
   - **新版本发布后尽快跟一条 0.5.x**：向前兼容不等于行为兼容，DSH 改语义（0.2.2 的
     `installModelSelection` 就是）只能靠跟进发现。

> 经验：安装期通过 ≠ 行为兼容。0.2.2-alpha.3 的模型选择变更在 semver 与 TypeScript 上
> 都"通过"，但选择会静默失效，还埋着 `agent/request` 抛错——所以两条线必须实跑。

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
- **两条线一起验**：`pnpm verify:lines`（`scripts/verify-dsh-lines.mjs`）。
  对「当前 devDependency 线」和「peer floor 线」各做一遍
  `pnpm install → typecheck → test → build`，最后**自动复原** `package.json` 并重装原线
  （即使某条线失败也会复原）。切换时按 `https://registry.npmjs.org/@deepseek-ai%2Fdsh/<版本>`
  的 manifest 把 `cordis` / `schemastery` 一起对齐到该线自己声明的范围，所以不用手工查配对。

  ```bash
  pnpm verify:lines:dry                       # 只打印计划（含解析出的 cordis/schemastery 范围）
  pnpm verify:lines --runtime <DSH 安装根目录>  # 两条线全跑；--runtime 让 check-seed-exports 用真实 web shell
  pnpm verify:lines --lines 0.2.2-rc.1         # 只验某一条线
  pnpm verify:lines --continue                 # 一条失败也继续跑下一条（默认遇错即停）
  ```

  默认走 `registry.npmjs.org`：预发布版本比 pnpm 的 `minimumReleaseAge` 新，且
  `npmmirror` 的元数据可能还没同步。CI 里的 `floor` job 用
  `--lines 0.2.1-rc.1 --keep` 跑下限线，`--keep` 省掉末尾的复原安装。
- **floor 复验（手工兜底）**：把 `devDependencies` 全部临时切回 floor 版本 →
  `pnpm install && pnpm typecheck && pnpm test && pnpm build` → 再切回最新版本线并
  `pnpm install`。floor 低于 devDependency 时两条线都要绿。

### 新 DSH 版本发布后的动作（以 0.2.2-rc.1 为例）

1. `devDependencies` 的 19 个 `@deepseek-ai/dsh-*` 切到新版本，`cordis`/`schemastery`
   按新线 manifest 对齐（`pnpm verify:lines:dry` 会打印该线声明什么）。
2. 把新版本加进 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（**保留旧条目**）。
3. `pnpm install --registry https://registry.npmjs.org/` → `pnpm verify:lines`
   （新线 + floor 线都要绿）。
4. 用真实运行时跑 `evaluatePluginCompatibility` / `readPluginMeta`，并核对
   `scripts/trust-fence.ts` 与运行时 `dsh-client-connection` 是否仍逐条对齐。
5. 只有新版本出现**迫使改代码的破坏性变更**时才抬 floor；否则 floor 不动。
6. 更新 `CHANGELOG.md`、`README(.zh).md`、本文件、CI 注释，然后按「发布」一节打 tag。

### 当前状态（写作时的事实）

- 本机 DSH 运行时：**0.2.2-alpha.3**（全局 `dsh` CLI、Web GUI `http://127.0.0.1:3080` 与
  `web` profile 同一版本线）；在该运行时下 `evaluatePluginCompatibility` 对本插件判定为
  **兼容**（返回 `undefined`），`readPluginMeta` 仍返回中英标题/描述与内联图标，且
  `settings.get` / `sidechat.directory` / `sidechat.limits` / `sidechat.permissions`
  在真实运行时上实测可用。
- 最近一次完整验证（0.5.1）：`pnpm typecheck`、25 条测试、`pnpm build`（含对
  0.2.2-alpha.3 真实 web shell 的冻结模块表校验）全绿；floor 复验（切到 `0.2.1-rc.1` +
  `cordis@4.0.3` + `schemastery@3.18.3`）同样全绿（24 通过、1 条 0.2.2 专属用例按能力跳过），
  随后切回 0.2.2-alpha.3 复归。
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
- 发布**不是**本地做的事，见下面的「## 发布」：只走 git tag → `publish.yml`。
  本机直连 `registry.npmjs.org` 会被 `ECONNRESET`／超时重置，连元数据 GET 都过不去；
  本地只用 `pnpm pack` 校验产物内容。
- **「0.5.0 装不上」的真实原因多半是 `npmmirror` 元数据滞后，不是兼容性**（2026-10-19 实测）：
  本机 `~/.npmrc` 的 `registry` 指向 `https://registry.npmmirror.com/`，该镜像的 packument 停在
  `0.4.3`（`time.modified = 2026-09-24`，`versions` 里没有 `0.5.0`），于是
  `dsh plugin add dsh-side-chat-plus@0.5.0` 直接报
  `ERR_PNPM_NO_MATCHING_VERSION ... while fetching it from https://registry.npmmirror.com/`，
  同时 `latest = 0.4.3` 还会让不带版本号的 `add` 落到那个在 0.2.1 线被拒装的旧版。
  但镜像 **CDN 上的 tarball 其实已经回源存在**，只是元数据没刷新。两条实测可装的命令：

  ```bash
  # A. 这一次绕开镜像的元数据（已验证：7.4s 装上 0.5.0）
  dsh plugin --profile <p> add dsh-side-chat-plus@0.5.0 --registry https://registry.npmjs.org/
  # B. 用镜像 CDN 的 tarball 直连（已验证：733ms，不依赖 npmjs 连通性）
  dsh plugin --profile <p> add https://cdn.npmmirror.com/packages/dsh-side-chat-plus/0.5.0/dsh-side-chat-plus-0.5.0.tgz
  ```

  注意 `npm_config_registry=` 环境变量压不住 profile 的 registry 配置，只有 pnpm 的
  `--registry` 参数有效；`PUT https://registry.npmmirror.com/-/package/dsh-side-chat-plus/syncs`
  会返回 201 但元数据要过一段时间才刷新，别指望立刻见效。核对时直接查实时接口
  `https://registry.npmjs.org/-/package/dsh-side-chat-plus/dist-tags`（那里 `latest` 就是 `0.5.0`），
  不要用本机 `npm view`——它走镜像，会给你 `0.4.3` 的假象。

## 发布（唯一路径：git tag → `publish.yml`）

**发布 = 往 GitHub 推一个 `v*` tag，由 CI 构建并发布。本地不做发布动作。**
（用户 2026-10-19 明确要求：走 git 发布，记住这条，别再给本地 `npm publish` 的路子。）

- 触发：`.github/workflows/publish.yml`，`on.push.tags: ['v*']`；另有 `workflow_dispatch`
  只用于**重跑一次失败的发布**。
- 流程：

  ```bash
  pnpm typecheck && pnpm test     # 本地先绿，CI 还会再跑一遍
  # 改版本相关内容（CHANGELOG、README 顶部的版本说明等）并提交
  git commit -am "release(side-chat): 0.5.1 …"
  git push origin main
  git tag v0.5.1
  git push origin v0.5.1          # ← 这一步才是发布
  ```

- 版本真源是 **tag 名**：CI 从 tag 剥掉 `v` 写回 `package.json` 与 `dsh.plugin.json`，
  然后 `pnpm publish --provenance`。所以 tag 与 `package.json` 不一致时以 tag 为准；
  `package.json` 里的 version 只在 `workflow_dispatch` 时兜底。tag 命名必须是 `vX.Y.Z`
  （预发布写 `vX.Y.Z-rc.1` 这类）。
- dist-tag 自动决定：版本里带预发布后缀 → 用该后缀首段（`0.5.1-rc.1` → `rc`）；
  不带 → `latest`。预发布绝不能落到 `latest`，否则会把稳定线挤掉。
- CI 里 `pnpm build`、`check-seed-exports`、`check-dsh-compat` 全部通过才会发布；
  发布失败先看 Actions 日志，修好再打**新 tag**（npm 不允许重发同版本号），或确认是
  发布环节失败后用 `workflow_dispatch` 重跑。
- 本地只做产物校验：`pnpm pack` / 解包看 `lib/`、`dsh.plugin.json`、`locale/`、
  `assets/` 是否齐全。**不要** `npm publish`／`pnpm publish`：本机直连
  `registry.npmjs.org` 会被重置，且那样发出去的包没有 provenance。
- 发布后核对用**实时接口**（packument 会滞后十几分钟）：

  ```bash
  curl -s https://registry.npmjs.org/-/package/dsh-side-chat-plus/dist-tags
  curl -sI https://registry.npmjs.org/dsh-side-chat-plus/-/dsh-side-chat-plus-<版本>.tgz | head -1
  ```

- 下游镜像（`registry.npmmirror.com`）同步滞后**不是**发布问题，也**不是**改本地发布的理由：
  安装端按「当前状态」里那两条命令（`--registry` 或 CDN tarball）临时绕过即可。

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
- **模型选择走两条线**：出现 `AgentModel` 导出（0.2.2-alpha.3+）时用
  `agent.model.select()` 记录持久选择——它在步骤准备前固定路由，agent-loop 会对
  `agent/request` 里改写 provider/model 的监听器**直接抛错**；0.2.1 线仍用
  `installModelSelection(agentCtx, selection)` 的可变 ref。创建侧边聊天时先记录继承路由，
  `sidechat.selectModel` 后追加新选择；继承发起会话时优先读 `agent.model.current()`，
  再退回 `requestHeader().config` 与 agent options。
- 0.2.2-alpha.3 新增原生文本交互面（`uiConversation.interactions` +
  `conversation.chat.text-interaction` 插槽，可选插件 `dsh-message-quotes` 用于「引用」）；
  本插件的选中浮动菜单仍用 document `selectionchange`，不注册该面——两者同装时会有两个
  入口，属交互重叠。
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
