# 0.5.1

对照 DSH **0.2.2-alpha.3** 的 release notes 与真实运行时做的一轮兼容性修复。

- **修复「侧边聊天切换模型/思考难度在 0.2.2-alpha.3 上静默失效」**：该版本把模型选择
  从「插件持有的可变 ref + `installModelSelection(agentCtx, selection)`」改成
  **持久选择**——`agent.model.select()` 追加 `model/selection` 事件，步骤准备在提示词
  组装前固定路由；同名安装器现在只接收 `agentCtx` 并负责「模型已切换」提示行。旧调用
  仍能通过编译（第二个参数被忽略），但选择再也不会生效，且 agent-loop 会对
  `agent/request` 里改写 provider/model 的监听器直接抛错。现在按能力探测：出现
  `AgentModel` 的运行时用持久 API（创建时记录继承路由、`sidechat.selectModel` 后追加
  新选择），0.2.1 线仍走原耦合器。
- **继承发起会话的「下一步」模型**：`sidechat.inherit` / `sidechat.start` /
  `sidechat.summarize` 先读 `agent.model.current()`，再退回
  `session.requestHeader()` 与 agent options。0.2.2-alpha.3 起，主会话里刚切换的模型要
  等到下一次请求才进 request header，旧顺序会让紧接着新建的侧边聊天继承到旧模型。
- **开发依赖与锁文件升到 0.2.2-alpha.3**：19 个 `@deepseek-ai/dsh-*` devDependency、
  `cordis`（`4.0.6-alpha.2`）与 `schemastery`（`3.18.6-alpha.2`）对齐该运行时；
  `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 为每个 dsh 包追加
  `0.2.2-alpha.3`（保留旧版本条目，便于随时回切复验）。
- **floor 不变，仍为 `0.2.1-rc.1`**：0.2.2-alpha.3 的变更是可探测的加法式改造，代码在
  两条线上都能正确工作，因此不抬下限。按 AGENTS.md 的 floor 复验流程实测：切回
  `0.2.1-rc.1`（含 `cordis@4.0.3`／`schemastery@3.18.3`）后
  `pnpm typecheck` / `pnpm test`（24 通过、1 条 0.2.2 专属用例按能力跳过）/
  `pnpm build` 全绿，再切回 0.2.2-alpha.3 复归。
- **新增回归测试**：`scripts/compat.test.ts` 增加「0.2.2+ 通过 `agent.model.select` 记录
  选择、且不安装 `agent/request` 改写器」与「优先继承持久选择」两条；
  `scripts/model-selection-legacy.test.ts` 用 mock 的 0.2.1 形态 agent 包验证下限线仍
  收到二的参数耦合器。测试同时把 `DSH_HOME` 指到临时目录，跑测试不再重写真实的
  侧边聊天记录表。
- **验证**：`pnpm typecheck`、25 条测试、`pnpm build`（含对 0.2.2-alpha.3 真实 web shell
  的 `check-seed-exports` 与 `check-dsh-compat`）全绿；在 0.2.2-alpha.3 运行时上
  `evaluatePluginCompatibility` 返回 `undefined`（兼容），`readPluginMeta` 仍返回中英
  标题/描述与内联图标。
- **向前兼容落到工程手段**：peer 保持单一开区间、不设上界（已用真实 `dsh-app-boot` 实测
  0.2.2-rc.1 / 0.2.2 / 0.2.3-rc.1 / 0.3.0 / 1.0.0 / 2.0.0 全部 ACCEPT），运行期一律**能力探测**
  而不是比较版本号；客户端平台模块用构建期 `check-seed-exports` 与运行期
  `SidechatErrorBoundary`（面板与右侧栏各自兜底）双层保护，运行时比构建线新时降级显示
  提示而不是白屏。
- **新增 `pnpm verify:lines`**（`scripts/verify-dsh-lines.mjs`）：对当前开发线与 peer 下限线
  各切换清单跑一遍 install/typecheck/test/build，按各线自己的 manifest 对齐
  `cordis`/`schemastery`，完成后自动复原；`--dry-run` / `--lines` / `--runtime` /
  `--keep` 可选。CI 增加 `floor` job，每次 push 都验下限线。
- 验证：`pnpm verify:lines --runtime <DSH 安装根>` 两条线均 PASS；`pnpm typecheck`、25 条测试、
  `pnpm build` 全绿。
- **未改动但需留意**：0.2.2-alpha.3 新增原生文本交互面
  （`uiConversation.interactions` + `conversation.chat.text-interaction` 插槽，
  可选插件 `dsh-message-quotes` 用它做「引用」）。本插件的浮动「问侧边聊天」菜单
  仍走自己的 `selectionchange` 监听、不注册该面；同时装两者时选中文本会出现两个入口，
  属交互重叠而非故障。

# 0.5.0

对照 DSH **0.2.1-rc.1** 的 release notes 做的一轮兼容性修复。该版本改写了 `/api` 的
浏览器信任栅栏（`dsh-client-connection` 的 `api-request-trust`），本插件此前照抄的是
0.2.0 线的版本，因此需要跟进。

- **修复「非 loopback 部署下 `/sidechat/api` 全部 403」**：0.2.1-rc.1 起，fence 除了
  loopback 与声明的 `trustedHosts`，还接受**监听器自己的绑定 IP 字面量**（`--host 10.0.0.7`
  后用该地址访问）；0.2.0 线是把 LAN 字面量折进 `trustedHosts` 实现的。此前本插件只看
  authority 列表，`--host <LAN IP>` 场景下 DSH 自己的 `/api` 放行、侧边聊天却全被拒。
  现在按上游语义把绑定地址与监听协议一并传给 fence。
- **修复 `trustedHosts` 一直读成空数组**：旧代码按 `entry.options.name === 'connection'`
  匹配 Loader 行，而该行的 `name` 是 `@deepseek-ai/dsh-client-connection`（`connection`
  是 `id`）——匹配永远不命中，`--trusted-host` 因此从未生效。现在优先读
  `webStartup.trustedHosts`（0.2.1-rc.1 起 `/api` fence 的权威来源），并保留
  `connection` 行 config 作为 0.2.0 线的回退，两者取并集。
- **修复未求值的 `!!js` 配置让 fence 抛异常**：Loader 行的 `options.config` 保留原始节点
  （`trustedHosts: !!js ctx.webStartup.trustedHosts` 不会就地求值），旧代码把它当数组用，
  非 loopback 请求会在 `trustedHosts.some` 上抛 TypeError。现在只接受字符串数组。
- **Host/Origin 按监听协议归一化**：0.2.1-rc.1 支持 `--tls-cert`/`--tls-key`，默认端口要按
  实际服务的 scheme 剥离（HTTPS 监听下 `Host: app.internal` 与 `Origin: https://app.internal`
  归一化一致）。fence 行为现与上游逐条对齐，并新增 `scripts/trust-fence.test.ts`
  （6 条）与 3 条宿主侧集成测试覆盖绑定字面量、`webStartup`/`connection` 两个来源与
  `!!js` 节点。
- **适配 0.2.1-rc.1 的插件页元信息**：新版 `dsh-app-boot` 的 `readPluginMeta` 从
  `<包>/locale/<lang>.json`（`meta.title` / `meta.description`）与 `<包>/icon` 读取显示
  文本和图标。新增 `locale/en.json`、`locale/zh-hans.json` 与 `assets/icon.svg`，并在
  `package.json` 的 `exports` 中导出 `./icon` 与 `./locale/*`（`files` 同步）。
  已用真实运行时的 `readPluginMeta` 实测返回中英标题、描述与内联图标。
- **客户端防重复挂载**：0.2.1-rc.1 支持就地重载可替换插件（HMR），客户端 bundle 工厂可能
  在同一文档里再跑一次；挂载面板前先清掉上一次遗留的 `[data-dsh-side-chat]` 宿主节点。
- **下限上移到 `0.2.1-rc.1`**：所有 dsh peer 与 `dsh.plugin.json` 的 `engines.dsh` 统一为
  `>=0.2.1-rc.1`（按 AGENTS.md 规则 3：DSH 的破坏性变更迫使本插件改代码并重新发布时，
  floor 抬到该变更所在的最低版本）。开发依赖、锁文件与 CI 同步到 `0.2.1-rc.1`；
  `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 保留 0.2.0 两版条目，便于随时回切复验。
- 验证：`pnpm typecheck`、22 条测试、`pnpm build`（含对 0.2.1-rc.1 真实 web shell 的
  `check-seed-exports` 与 `check-dsh-compat`）全绿；另在本机 0.2.1-rc.1 运行时上实测
  `settings.get` / `sidechat.directory` / `sidechat.limits` / `sidechat.permissions` 与
  `evaluatePluginCompatibility` 判定兼容。

# 0.4.4

- **npm 上的 0.4.3 及更早版本在 DSH 0.2.0-rc.x 上装不上**：那些 tarball 里的 peer 仍是
  `^0.1.7-0`，会被 `dsh: installation rejected: Plugin dsh-side-chat-plus@0.4.3 is
  incompatible with dsh 0.2.0-rc.2` 拒装（安装随后回滚，profile 不会残留）。请使用
  **0.4.4 或更高版本**。
- **兼容性窗口改为开区间。** 所有 `@deepseek-ai/dsh*` peer 统一声明为 `>=0.2.0-rc.1`，
  `dsh.plugin.json` 的 `engines.dsh` 同步。此前提交里写的是 `^0.1.7-0`，而 DSH 用
  `semver.satisfies(runtime, range, { includePrerelease: true })` 校验 peer，
  caret 是闭区间（上界 `0.2.0`）：连 `0.2.0-rc.1` / `0.2.0-rc.2` 都会被判为不兼容。
  同 profile 的 `dsh-session-bridge@0.4.0` 正是因此被桌面版 0.2.0-rc.2
  拒装（`dsh: installation rejected: Plugin … is incompatible with dsh 0.2.0-rc.2`）。
  现在 `0.2.0-rc.1` 及之后的所有版本（含预发布）都会被接受。
- 开发依赖与 CI 从 `0.2.0-rc.1` 提到 `0.2.0-rc.2`，并用 DSH 自带的前置校验
  （`dsh-app-boot` 的 `evaluatePluginCompatibility`）在本仓库清单上实测：0.2.0-rc.2
  下判定为**兼容**。
- 新增 `scripts/check-dsh-compat.mjs`（`pnpm check:dsh`，并挂在 `pnpm build` 末尾）：
  强制每个 dsh peer 是单一开区间 `>=<floor>`、共用同一个 floor、与 `engines.dsh`
  一致，且 floor 不高于被测 DSH 运行时；`^`／精确锁定／上界／多 floor 都会让构建失败。
- 在 `>=0.2.0-rc.1` 下限上以同一份源码跑通 typecheck、13 条测试与构建（含对 0.2.0-rc.2
  真实 web shell 的冻结模块表校验），并在 0.2.0-rc.2 下复跑通过。
- 兼容性规则与验证步骤写入 [AGENTS.md](./AGENTS.md)；README/CI 注释中的 DSH 版本说明同步更新。

# 0.4.3

- 对照 DSH `0.1.7-rc.1` 做了一轮完整功能回归：宿主侧 `/sidechat/api` 的 start / followup / stop /
  history / list / state / commands / summarize / inject / attachment / selectModel /
  selectPermission / settings.get / settings.update / dispose 全部实测通过；「推理期间临时取消归档、
  本轮结束恢复归档」的门禁流程在 rc.1 上仍按要求工作（侧边会话不出现在会话列表）。
- 修复「右侧栏服务缺失时侧边聊天彻底不可用」：默认偏好是停靠新版右侧栏，但部署里没有
  `sidebarRight` / `sidebarRightTabs` 服务时，此前只写一条“已回退为浮动面板”的错误提示，既不注册
  停靠入口、也不渲染浮动面板——而提示本身就在面板里，用户什么也看不到。现在真的回退到经典浮动
  面板，提示只用于解释停靠偏好为何未生效。
- 修复「启动失败会留下幽灵侧边聊天」：`sidechat.start` 原先先创建并持久化侧边会话、再校验提示里的
  图片，图片被拒时既返回 500，又留下一个没有任何消息的侧边聊天（写入记录，之后还会被复用）。
  现在图片在创建会话之前处理，失败返回 400 `bad-image`，且不创建任何会话。
- `sidechat.history` 对不存在或已删除的侧边聊天返回 404 `not-found`，不再把这种正常的客户端缺席
  报成 500 `internal`。
- 开发依赖与 CI 对齐到 `0.1.7-rc.1`（此前 `0.1.7-alpha.1`）；typecheck、构建（含
  `check-seed-exports` 对真实 DSH 安装的校验）与测试均在 rc.1 类型下通过。
- 新增 3 条回归测试：图片被拒不留会话且 list 为空、history 返回 404、合法图片仍能正常启动。

# 0.4.2

- 0.4.1 被 CI 从「修复提交之前」的提交打包发布（tag 先指向旧提交、随后才被强制更新），因此 npm 上的 0.4.1
  **不含**设置 namespace 修复，设置页偏好读写仍然失效。0.4.2 是同一份修复的正式发布，修复内容见下一节。
  请使用 0.4.2 或更高版本。

# 0.4.1

- 修复「插件设置页偏好读写失效」的问题（0.4.1-alpha.1 引入）。此前插件从 `ctx.entry` 取自身 Loader entry id，
  但 Cordis 的受控 Context 对未声明的属性会直接抛错（`cannot get property "entry" without inject`），
  `ctx.inject(['settings'], …)` 回调在绑定设置服务前就中断，于是 `settings.get` 恒返回空值、
  `settings.update` 恒返回 503 `settings-rejected`，设置页里的偏好保存静默失败。
  现在改为从拥有该 fiber 的 entry 上取 namespace（`ctx.fiber.entry.options.id`，与官方 llm 插件一致），
  并以 `loader.locate(fiber)` 作为兜底。
- 已在真实的 Loader + config-editor + settings 组合中验证：`settings.describe()` 能列出本插件的 volatile 字段，
  `/sidechat/api/settings.get` 返回当前偏好与 revision，`settings.update` 能到达设置服务并带正确的 namespace。
- 新增 3 条设置 namespace 回归测试（fiber entry、裸挂载时降级为“偏好不可用但不报错”、loader 兜底）。

# 0.4.1-alpha.1

- 适配 DSH `0.1.7-alpha.1`，最低版本声明同步为 `^0.1.7-0`。
- 修复侧边聊天在 0.1.7 下“发出去没有任何回复”的问题：0.1.7 新增的 archived-session 门禁会对归档会话的
  `agent/pre-step` 直接返回 `reject`，整轮以 `blocked` 结束（不发请求）。现在改为“推理期间临时取消归档、
  本轮 settle 后重新归档”，既可继续正常回答，又保持默认隐藏（宿主创建的会话不占工作区记录，因此即使在这段
  窗口里也不会出现在左侧工作区，最多落在「未分组」）。
- “带回主会话”改用 V4 producer-owned source，保持与官方迁移旧消息后的身份一致，修复旧 `kind: plugin` 格式被拒绝的问题。
- 偏好通过插件导出的 volatile Config 和实际 Loader entry id 保存至当前 Profile，支持实时更新和修订冲突检查。
- 迁移 agent-preset-registry 依赖及新版 Regular 图标；侧栏优先使用公共 sidebarRightTabs 服务。
- 本地、CI、发布统一锁定新版依赖；新增 V3→V4 缺失轮次结束记录、历史过滤、上下文注入及设置回归测试。
- 官方侧边对话复用评估见 [方案说明](docs/official-sidebar-assessment.md)。本次保留现有聊天区，尚未替换成官方 Conversation。

旧设置服务的自定义 namespace 已取消。新版本设置归属于 Profile 中的插件条目；官方一次性导入无法映射旧自定义 namespace 时，需在插件设置页重新保存偏好。
