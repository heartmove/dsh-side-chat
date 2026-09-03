# dsh-side-chat — 侧边聊天（Side chat）

一个 [DSH](https://www.deepseek.com) 网页插件，**Codex 式侧边聊天的强化版本**：
在右侧面板提供按主会话隔离的独立聊天，具备 Codex 式的智能体能力——继承主会话的
工具集、模型、思考难度与权限预设，能感知所在工作目录；选中对话内容即可提问，AI 回复
也能**带回主会话**（直接带回或摘要后带回，写入草稿或注入为折叠提示行）。

在 Codex 式能力之上，它额外支持：当主会话的智能体弹出**问题弹框**向你提问时，可以
把问题与各个选项带入侧边聊天、让 AI 帮你分析，**不必打断当前流程**——想清楚后把答案
带回，再回答弹框即可。

> English docs: [README.md](./README.md).

## 功能

- **选中内容 → 侧边聊天提问。** 选中任意消息文本后，会浮出「在侧边聊天中提问」按钮，
  选中的内容会自动带入侧边聊天。
- **按主会话隔离。** 每个侧边聊天都是一个隐藏的普通 DSH 会话（通过
  `meta.parentSession` 关联发起它的主会话，并被归档，因此不会出现在主会话列表中）。
  每个主会话各自拥有自己的侧边聊天。
- **继承主会话上下文。** 侧边聊天能感知它的发起会话与所在工作目录，并默认继承主会话的
  工具集、模型、思考难度与权限预设，可以像主会话一样作用于同一个工作区。
- **模型 / 思考难度 / 权限可调。** 复刻主会话的二级模型菜单（服务商 → 模型 → 思考难度）
  与权限菜单，每个侧边聊天可独立调整。
- **「需要时从工作区 / 主会话查信息」开关**（默认关闭）。开启后，侧边聊天在需要更多信息
  时，可读取工作区文件与主会话内容。
- **与正常对话一致的能力。** Markdown 回复、思考（推理）过程展示、图片附件（粘贴 /
  拖拽）、发送/停止按钮、思考时长显示 —— 均复用主会话同款 UI 组件。
- **AI 回复带回主会话。** 侧边聊天里的每条 AI 回复都能带回当前主会话：可鼠标选中
  部分内容后带回，或一键带回整段；两种方式都可选择 **「直接带回」**（原文）或
  **「摘要后带回」**（先用侧边聊天继承的模型生成摘要再带回）。带回的落地方式可在设置里
  选择：**写入输入框草稿**，或**注入为折叠提示行**（作为上下文，不写草稿、不发送）。
- **针对问题弹框答疑（不打断流程）。** 当主会话弹出「问题弹框」（智能体向用户提问）时，
  侧边面板会自动逐项列出问题和各个选项（无需手动选中文字）。每个问题可「带入全部」、每个
  选项可「带入」，且都支持 **继续已有侧边聊天** 或 **新建侧边聊天** 两种方式，让 AI 帮你
  分析后再回答——主会话静静等待，**流程不会被打断**。列表支持 **折叠 / 展开**，以及
  **删除单个 / 删除全部**（删除后不再出现）。
- **侧边聊天可删除。** 侧边聊天列表里的每个会话可单独删除，也可一次性「删除全部」。
- **自适应分辨率、可拖拽、可收起的面板。** 拖拽左边缘调整宽度（280–720 px）；面板宽度会
  自动钳制在窗口的约 40% 以内、并为主聊天区留出可用空间；窗口尺寸变化（换显示器、调整
  缩放）时会自动重新适配，上次的宽度也会被记住。可收起/展开；没有关闭按钮。
- **跟随语言设置。** 插件会跟随 DSH 的语言设置切换中文 / 英文界面。

## Codex 式侧边聊天（强化版）

本插件是 **Codex 式侧边聊天的强化版本**：在主会话旁边提供第二个智能体聊天；并在
Codex 式能力之上，额外支持针对当前**问题弹框**的侧边聊天——**全程不打断流程**。

**Codex 式基础能力。** 侧边聊天是一个真正的 DSH 智能体会话，而不是便签：

- **继承主会话的配置**：工具集、权限预设、模型 / 思考难度、工作目录，可以像主会话
  一样读写同一个工作区——受你为它选择的权限预设约束。
- **「需要时从工作区 / 主会话查信息」开关**（默认关闭）：任务需要更多上下文时，
  它可以读取工作区文件与主会话记录。
- **模型 / 思考难度 / 权限预设可按聊天调整**：难任务可以交给更强的模型，完全
  不影响主会话。
- **最终回复（或其摘要）可带回主会话**——写入输入框草稿，或注入为折叠提示行，像
  Codex 那样「把结果交接回去」，无需手动复制粘贴。

**强化点：问题弹框侧边聊天，不打断流程。** 主会话智能体向你提问时，常规流程会停在
原地等你回答。本插件让你继续推进：侧边面板自动列出问题与每个选项；把整个问题或任意
一个选项带入侧边聊天（新建或继续），让 AI 帮你分析，再把答案带回、回答弹框。主会话
只是静静等待——流程不被中断，你也不必在准备好之前被迫作答。

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

## CI 与发布

[GitHub Actions](.github/workflows) 覆盖两条流水线：

- **[`ci.yml`](.github/workflows/ci.yml)**：每次 push 到 `main` 及 pull request 时触发——
  安装依赖、类型检查、构建、运行测试脚本，并在 Node 20 / 22 下打包 tarball（作为 artifact 上传）。
- **[`publish.yml`](.github/workflows/publish.yml)**：推送 `v*` 标签时触发——构建并把包发布到
  **npm**，即 [`dsh-side-chat-plus`](https://www.npmjs.com/package/dsh-side-chat-plus)，
  用仓库的 `NPM_TOKEN` secret 鉴权。

包名为 `dsh-side-chat-plus`（npm 上的裸名 `dsh-side-chat` 属于另一维护者，因此发布以 `-plus` 命名）。

> **registry 依赖说明。** 本插件所依赖的 harness 包（DSH `0.1.2` 这一代 API）在 npm 上以预发布
> （`0.1.2-rc.1`）发布，且个别包内部用普通 `>=0.1.2` 范围引用同系列包，npm/pnpm 不会把
> 预发布版本当作满足该范围。因此开发用的 `pnpm-workspace.yaml` 把 `@deepseek-ai/dsh-*` 指向
> 本地 harness checkout（绝对路径 `D:/code/...`，仅存在于维护者本机）。CI 会把该文件替换成
> overrides 将每个 `@deepseek-ai/dsh-*` 依赖固定到 `0.1.2-rc.1` 的版本，从而让安装从 registry
> 解析。在其他机器上，把 overrides 指向你自己的 harness 克隆，或直接以 CI 的 workspace 文件为模板。

## 部署

DSH web 从当前 profile 加载外部插件。本包是一个 **bundle**：它的
`package.json` 声明了 `dsh.bundle.patch` → [`cordis.patch.yml`](./cordis.patch.yml)，
其中的 `insert` 条目用于挂载插件。正是这个声明让 `dsh plugin add` 能一步完成
「安装 + 激活」。

> **推荐：从 npm 安装。** 本包已发布到 [npm](https://www.npmjs.com/package/dsh-side-chat-plus)，
> 名为 `dsh-side-chat-plus`，因此 `dsh plugin add` 无需源码 checkout——tarball 自带预构建的
> `lib/`，安装即激活。

### 从 npm 安装

构建好的包已发布到 npm，名为 [`dsh-side-chat-plus`](https://www.npmjs.com/package/dsh-side-chat-plus)。
从 registry 安装时，tarball 自带预构建的 `lib/`（以及 `cordis.patch.yml`、`dsh.plugin.json`），无需源码构建：

```bash
npx -p @deepseek-ai/dsh dsh plugin --profile web add dsh-side-chat-plus
```

`dsh plugin` 会把 bundle 对账进该 profile 的 `dsh.profile.bundles` 层列表；预构建的 `lib/`
意味着安装时无需额外运行任何构建。版本号随打出的 tag 确定（见 [CI 与发布](#ci-与发布)）。

重启 `dsh web`，然后在浏览器中强制刷新页面（Ctrl/Cmd+Shift+R）。

### 从 GitHub 安装

```bash
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:heartmove/dsh-side-chat-plus
```

`dsh plugin` 会把命令转发到 `~/.dsh/profiles/web/` 下的 pnpm，然后把 bundle
对账进该 profile 的 `dsh.profile.bundles` 层列表。git 安装拉取的是源码，因此
pnpm 会在 checkout 之后运行包的 `prepare` 脚本（`tsdown`），从 `src/` 构建出
`lib/`。

pnpm ≥ 10 在把 git 依赖加入白名单之前，会拒绝运行它的 `prepare` 脚本，因此首次
`add` 会失败并给出「Ignored build scripts」提示。把 pnpm 打印的确切包名键复制到
该 profile 的 `pnpm-workspace.yaml`（`~/.dsh/profiles/web/pnpm-workspace.yaml`）：

```yaml
allowBuilds:
  dsh-side-chat-plus: true
```

然后重新执行 `add`。这个白名单意味着「允许该包的代码在安装时于本机运行」——
只放行你信任其源码的包，并固定到某个 commit
（`github:heartmove/dsh-side-chat-plus#<sha>`），这样之后的推送无法悄悄改变实际运行的代码。

重启 `dsh web`，然后在浏览器中强制刷新页面（Ctrl/Cmd+Shift+R）。

### 从本地 checkout 安装

在包含本项目 checkout 的目录下执行：

```bash
npx -p @deepseek-ai/dsh dsh plugin --profile web add ./dsh-side-chat-plus
```

pnpm 会链接该 checkout，`dsh` 以同样方式激活这个 bundle。

### 手动链接

如果你想手动管理 profile，可在 `~/.dsh/profiles/web/package.json` 里链接该包并
把它列为 bundle（bundle 自带的 `cordis.patch.yml` 已提供加载器条目，因此无需再
写 `insert`）：

```json
{
  "dependencies": {
    "dsh-side-chat-plus": "link:D:\\path\\to\\dsh-side-chat-plus"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-side-chat-plus"]
    }
  }
}
```

（在 POSIX 系统上使用 `link:/path/to/dsh-side-chat-plus`。）然后在 profile 目录执行
`pnpm install` 并重启 `dsh web`。

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

### 带回主会话

侧边聊天里的 AI 回复可以带回当前主会话（**不会立即发送**）：

1. **带回选中片段。** 在侧边聊天里用鼠标选中 AI 回复的一部分文本，浮出的菜单里选择
   **「直接带回」**（原文）或 **「摘要后带回」**（先用侧边聊天继承的模型生成摘要）。
2. **带回整段。** 每条 AI 回复正文下方有 **「直接带回」** 与 **「摘要后带回」** 两个按钮，
   一键把该条回复的完整正文（或其摘要）带回。
3. 根据设置里的 **带回内容的方式**，带回的内容要么**追加进主会话输入框草稿**（可编辑后再
   发送），要么**注入为主会话里一条折叠的提示行**（带来源标记，作为上下文、不写草稿，
   下次对话时模型可见）。

![带回功能演示](docs/bring-back.gif)

### 针对问题弹框

当主会话弹出「问题弹框」时，侧边面板会自动列出问题和选项：

1. 面板关闭时，会先在弹框标题旁出现一个**浮动入口按钮**，点击即可打开面板查看。
2. 每个问题可「带入全部」、每个选项可「带入」，且都支持 **继续已有侧边聊天** 或
   **新建侧边聊天** 两种方式。
3. 列表左上角可 **折叠 / 展开**；每个问题项可 **删除**，也可 **删除全部**（删除后不再出现）。

主会话会一直等待弹框的回答——先在侧边聊天里研究，再把答案带回、回答弹框，全程不打断流程。

![问题弹框功能演示](docs/question-dialog.gif)

### 删除侧边聊天

侧边聊天列表里每个条目有「×」删除按钮；右上角「删除全部」可一次性删除当前主会话的所有
侧边聊天。

## 设置

打开 DSH **设置 → 侧边聊天（Side chat）**，可配置：

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lookupDefault` | 关 | 新建侧边聊天时，「需要时从工作区 / 主会话查信息」开关是否默认开启。 |
| `sendImmediately` | 开 | 选中内容后立即发送，还是先作为附件放入输入框。 |
| `defaultPrompt` | *（空）* | 「立即发送」开启时，附加在选中内容后的额外提示词。 |
| `bringMode` | `draft` | 带回内容的落地方式：`draft` 写入输入框草稿，`context` 注入为折叠提示行。 |

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
cordis.patch.yml      bundle patch 层（插入加载器条目；dsh.bundle.patch 指向它）
dsh.plugin.json       外部插件清单
tsdown.config.ts      打包配置（client 外部依赖 + CSS 内联）
```

## 许可证

[MIT](./LICENSE)
