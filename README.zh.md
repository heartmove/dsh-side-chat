# dsh-side-chat — 侧边聊天（Side chat）

一个 [DSH](https://www.deepseek.com) 网页插件：在对话中选中部分内容后，即可在
**侧边聊天**里提问 —— 侧边聊天是位于右侧面板、按发起它的主会话隔离的独立聊天。

> English docs: [README.md](./README.md).

## 功能

- **选中内容 → 侧边聊天提问。** 选中任意消息文本后，会浮出「在侧边聊天中提问」按钮，
  选中的内容会自动带入侧边聊天。
- **按主会话隔离。** 每个侧边聊天都是一个隐藏的普通 DSH 会话（通过
  `meta.parentSession` 关联发起它的主会话，并被归档，因此不会出现在主会话列表中）。
  每个主会话各自拥有自己的侧边聊天。
- **继承主会话上下文。** 侧边聊天能感知它的发起会话与所在工作目录，并默认继承主会话的
  模型、思考难度与权限预设。
- **模型 / 思考难度 / 权限可调。** 复刻主会话的二级模型菜单（服务商 → 模型 → 思考难度）
  与权限菜单，每个侧边聊天可独立调整。
- **「需要时从工作区 / 主会话查信息」开关**（默认关闭）。开启后，侧边聊天在需要更多信息
  时，可读取工作区文件与主会话内容。
- **与正常对话一致的能力。** Markdown 回复、思考（推理）过程展示、图片附件（粘贴 /
  拖拽）、发送/停止按钮、思考时长显示 —— 均复用主会话同款 UI 组件。
- **可拖拽、可收起的面板。** 拖拽左边缘调整宽度（280–720 px），可收起/展开；没有关闭按钮。
- **跟随语言设置。** 插件会跟随 DSH 的语言设置切换中文 / 英文界面。

## 环境要求

- [Node.js](https://nodejs.org) ≥ 20
- [pnpm](https://pnpm.io)
- DSH ≥ `0.1.0-rc.6`（即 `engines.dsh` 声明的约束）

## 构建

```bash
pnpm install
pnpm build
```

`pnpm build` 会先清空 `lib/`，再执行 `tsc -p tsconfig.build.json` 生成类型声明，
最后用 tsdown 打包出 host 端（`lib/index.js`）与 client 端
（`lib/client.js` + `lib/client-registry.js`）。

## 部署

DSH web 从当前 profile 加载外部插件。把本插件挂载到你的 web profile
（通常位于 `~/.dsh/profiles/web/`）：

1. **链接包。** 在 `~/.dsh/profiles/web/package.json` 里，把插件作为 `link:` 依赖
   指向本项目目录：

   ```json
   {
     "dependencies": {
       "dsh-side-chat": "link:D:\\path\\to\\dsh-side-chat"
     }
   }
   ```

   （在 POSIX 系统上使用 `link:/path/to/dsh-side-chat`。）

2. **插入加载器条目。** 在 `~/.dsh/profiles/web/cordis.patch.yml` 里添加一个
   `insert` 条目：

   ```yaml
   - insert:
       - id: dsh-side-chat
         name: 'dsh-side-chat'
   ```

   其中 `name` 必须与上面的依赖名一致；加载器会据此解析到链接的包，并读取其
   `dsh.plugin.json`（插件 id 为 `dsh-external/dsh-side-chat`）。

3. **安装并重启。**

   ```bash
   cd ~/.dsh/profiles/web
   pnpm install
   ```

   重启 `dsh web`，然后在浏览器中强制刷新页面（Ctrl/Cmd+Shift+R）。

## 使用

1. 在主对话中选中某条消息的部分文本。
2. 点击浮出的 **「在侧边聊天中提问」** 按钮。
   - 若当前会话已有侧边聊天，还会出现 **「继续在激活的侧边聊天中提问」**。
3. 右侧面板会打开（或展开），选中的文本已带入输入框。
4. 按需调整 **模型 / 思考难度**、**权限**，以及 **「需要时从工作区 / 主会话查信息」**
   开关。
5. 发送。回复会以流式返回，带 Markdown 渲染，并在需要时显示「思考」折叠行展示模型推理过程。
6. 拖动面板左边缘可调整宽度，或使用收起/展开控件。

### 发送行为

默认（`sendImmediately` 开启）时，选中内容会**立即发送**，并自动附加你配置的
**默认提示词**。在设置里关闭 `sendImmediately` 后，选中的内容会先作为附件放入输入框，
由你确认、编辑后再发送。

## 设置

打开 DSH **设置 → 侧边聊天（Side chat）**，可配置：

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lookupDefault` | 关 | 新建侧边聊天时，「需要时从工作区 / 主会话查信息」开关是否默认开启。 |
| `sendImmediately` | 开 | 选中内容后立即发送，还是先作为附件放入输入框。 |
| `defaultPrompt` | *（空）* | 「立即发送」开启时，附加在选中内容后的额外提示词。 |

偏好设置保存在 DSH 设置命名空间 `dsh-side-chat` 下。

## 项目结构

```
src/
  index.ts            host 插件（路由、会话/Agent 生命周期、转录折叠）
  wire.ts             请求/响应辅助
  trust-fence.ts      环回 / 可信 API 请求守卫
  settings-shared.ts  host 与 client 共用的偏好设置词汇
  context-types.ts    Cordis Context 类型扩展
  client/
    index.tsx         client 插件（面板、输入框、设置分区、悬浮按钮）
    api.ts            client↔host API 类型
    locales.ts        中英文词典
    client.module.css 面板/输入框/设置样式
    layout.css        由面板宽度驱动的 #root margin-right
dsh.plugin.json       外部插件清单
tsdown.config.ts      打包配置（client 外部依赖 + CSS 内联）
```

## 许可证

[MIT](./LICENSE)
