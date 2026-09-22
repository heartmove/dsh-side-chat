# DSH 0.1.7-alpha.1 官方侧边对话与 Side chat Plus

核对对象：本机实际安装的 `@deepseek-ai/dsh-*` 0.1.7-alpha.1 发布包及其类型声明。

结论：可以组合。当前继续使用官方右侧栏承载插件面板；后续适合复用官方的会话订阅和 Conversation 渲染层。官方现成的子代理侧边对话不能直接替代本插件。

## 能力对照

| 需求 | 官方现成侧边对话 | 组合方式 |
| --- | --- | --- |
| 右侧栏标签、分栏、浮动与布局保存 | 由 sidebar-right 提供 | 当前插件已经接入；优先使用公共 sidebarRightTabs 服务 |
| 完整聊天、工具结果、审批、提问与输入区 | 复用正式 Conversation 界面，具体能力取决于所绑定会话和已装插件 | 后续用 SessionProvider + conversation.content 的 embedded 变体承载普通会话 |
| 新建按主会话隔离的隐藏普通会话 | 官方资源处理器面向已经存在的子代理 | 保留插件自己的创建、关联和隐藏逻辑 |
| 连续对话 | 子代理依 mode 区分；one-shot/unknown 会只读 | 保留普通会话身份，不能把 childId 拼成子代理资源地址冒充子代理 |
| 继承模型、思考难度、权限和预设 | 展示层本身不负责创建与继承 | 保留插件的 host 创建逻辑，后续核对官方输入区配置行为 |
| 选中文本发起提问、发送前暂存、自定义追加提示词 | 子代理侧边视图没有这些专属流程 | 保留选区入口和插件偏好 |
| 查阅工作区/主会话开关 | 没有本插件对应的提示词开关 | 保留插件消息构造逻辑；它是提示词约束，并非文件访问权限边界 |
| 选中或整段带回、AI 总结后带回、草稿/上下文两种模式 | 不是官方侧边视图提供的操作 | 通过额外操作区或消息扩展保留 |

## 核对到的正式接口

- `dsh-client-ui-subagent/lib/types/client/sidebar-chat/index.d.ts`：官方资源协议是 `dsh-resource://subagentchat/session/`，地址包含直接父会话、子会话和 mode。
- 同包 `lib/client.js` 的 `registerSidebarChat`：注册 `sidebar.right.pane.tab`，以 `sessions.retain(address, ...)` 持有子代理引用，在关闭时释放。
- 同包 `ConversationSlotPanel`：通过 `SessionProvider` 绑定目标会话，再渲染 `conversation.content`，传 `variant: 'embedded'`，固定聊天视图。
- `dsh-api-session-controller/lib/types/client/contract/sessions.d.ts`：公共 `retain(target, options)` 接口。普通会话应使用普通 SessionTarget，不使用 SubagentAddress。
- `dsh-api-session-controller/lib/client.js`：子代理地址走 `remote.subagents.prompt` 与 `interruptByParent`，所以冒充子代理不仅影响外观，也会改变发送和取消的路由。

## 后续替换边界

保留 host 层的普通会话、模型权限继承、查阅提示和带回 API。将自绘聊天历史和输入区替换为官方嵌入 Conversation，并保留插件的专属操作。必须先验证：归档普通会话 retain 后不被自动恢复到主列表；主/侧会话切换不串消息与草稿；审批和提问绑定正确；关闭面板只释放视图、不误停后台任务；查阅开关对后续官方输入消息继续生效；带回始终指向创建时的主会话。

本次兼容性修复没有把自绘聊天区直接替换成官方组件，上述完整组合仍是后续实现方案。
