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
