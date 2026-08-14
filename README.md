# dsh-side-chat — 侧边聊天 (Side chat)

A [DSH](https://www.deepseek.com) web plugin that lets you select part of a
conversation and ask about it in a **side chat** — a dedicated chat opened in a
right-side panel, scoped to the conversation it was started from.

> 中文文档见 [README.zh.md](./README.zh.md).

## What it does

- **Select text → ask in a side chat.** Select any part of a message and a
  floating button *"Ask in side chat"* appears. The selected text is carried
  into the side chat automatically.
- **Per-conversation isolation.** Each side chat is a hidden ordinary DSH
  session (`meta.parentSession` links it to the conversation that started it,
  and the session is archived so it never appears in the main session list).
  Every conversation gets its own side chat.
- **Inherits main-conversation context.** The side chat is aware of the
  conversation it was started from and its working directory, and inherits the
  main conversation's model, thinking effort, and permission preset by default.
- **Model / effort / permission are adjustable.** A two-level model menu
  (provider → model → effort) and a permission menu are copied from the main
  conversation, so each side chat can be tuned independently.
- **"Look up workspace / parent when needed" switch** (default off). When on,
  the side chat may read files from the workspace and the parent conversation
  when it needs more information.
- **Normal conversation capabilities.** Markdown replies, thinking/reasoning
  display, image attachments (paste / drag-and-drop), send/stop controls, and
  thinking-duration display — all reuse the same UI primitives as the main
  conversation.
- **Bring AI replies back to the main conversation.** Every assistant reply in
  the side chat can be brought into the current main conversation's composer:
  select part of it with the mouse, or insert the whole reply in one click.
  Either way you can choose **"Insert directly"** (verbatim) or
  **"Summarize & insert"** (the side chat's inherited model summarizes it
  first). The text is written to the main composer draft only — never sent.
- **Resizable, collapsible panel.** Drag to resize (280–720 px), collapse and
  expand; no close button.
- **Language-aware.** The plugin follows DSH's language setting (Chinese /
  English).

## Requirements

- [Node.js](https://nodejs.org) ≥ 20
- [pnpm](https://pnpm.io)
- DSH ≥ `0.1.0-rc.6` (the harness `engines.dsh` constraint)

## Build

```bash
pnpm install
pnpm build
```

`pnpm build` clears `lib/`, runs `tsc -p tsconfig.build.json` for type
declarations, then bundles the host (`lib/index.js`) and client
(`lib/client.js` + `lib/client-registry.js`) with tsdown.

## Deploy

DSH web loads external plugins from the active profile. This package is a
**bundle**: its `package.json` declares `dsh.bundle.patch` →
[`cordis.patch.yml`](./cordis.patch.yml), whose `insert` row mounts the plugin.
That declaration is what lets `dsh plugin add` install the package *and*
activate it in one step.

### Install from GitHub

```bash
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:heartmove/dsh-side-chat
```

`dsh plugin` forwards to pnpm inside `~/.dsh/profiles/web/`, then reconciles the
bundle into the profile's `dsh.profile.bundles` layer list. A git install
fetches sources, so pnpm runs the package's `prepare` script (`tsdown`) to build
`lib/` from `src/` after checkout.

pnpm ≥ 10 refuses to run a git dependency's `prepare` script until it is
allowlisted, so the first `add` fails with an "Ignored build scripts" hint. Copy
the exact package key pnpm printed into the profile's `pnpm-workspace.yaml`
(`~/.dsh/profiles/web/pnpm-workspace.yaml`):

```yaml
allowBuilds:
  dsh-side-chat: true
```

then re-run the `add`. That allowance means "run this package's code on my
machine at install time" — only allow packages whose source you trust, and pin a
commit (`github:heartmove/dsh-side-chat#<sha>`) so a later push cannot silently
change what runs.

Restart `dsh web`, then hard-refresh the page (Ctrl/Cmd+Shift+R).

### Install from a local checkout

From the directory that contains this checkout:

```bash
npx -p @deepseek-ai/dsh dsh plugin --profile web add ./dsh-side-chat
```

pnpm links the checkout and `dsh` activates the bundle the same way.

### Manual link

To manage the profile by hand, link the package and list it as a bundle in
`~/.dsh/profiles/web/package.json` (the bundle's own `cordis.patch.yml` supplies
the loader row, so no `insert` entry is needed):

```json
{
  "dependencies": {
    "dsh-side-chat": "link:D:\\path\\to\\dsh-side-chat"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-side-chat"]
    }
  }
}
```

(On POSIX systems use `link:/path/to/dsh-side-chat`.) Then run `pnpm install`
in the profile directory and restart `dsh web`.

## Usage

1. Select part of any message in the main conversation.
2. A floating **"Ask in side chat"** button appears — click it.
   - If a side chat already exists for this conversation, you'll also see
     **"Continue active side chat"**.
3. The right-side panel opens (or expands) with the selected text staged in the
   composer.
4. Adjust **model / effort** and **permission**, and toggle **"Look up workspace
   / parent when needed"** as desired.
5. Send. The reply streams back with markdown rendering and, where applicable,
   a "Think" row for the model's reasoning.
6. Drag the panel's left edge to resize, or use the collapse/expand control.

### Sending behavior

By default (`sendImmediately` on), selecting text **sends it immediately** and
appends your configured **default prompt**. Turn `sendImmediately` off in
settings to stage the selection as an attachment instead, so you can review and
edit before sending.

### Bring replies back to the main conversation

Assistant replies in the side chat can be brought into the current main
conversation's composer (written to the draft only — **never sent**):

1. **Bring a selection.** Select part of an assistant reply in the side chat,
   then choose **"Insert directly"** (verbatim) or **"Summarize & insert"** (the
   side chat's inherited model summarizes it first) from the floating menu.
2. **Bring the whole reply.** Each assistant reply has **"Insert directly"** and
   **"Summarize & insert"** buttons under its text, for inserting the full reply
   (or its summary) in one click.
3. Brought-back text is appended to the main composer draft (on a new paragraph
   when the draft is non-empty), ready for you to review, edit, then send.

## Settings

Open DSH **Settings → 侧边聊天 (Side chat)** to configure:

| Setting | Default | Description |
| --- | --- | --- |
| `lookupDefault` | off | Whether the "look up workspace / parent" switch is on by default for new side chats. |
| `sendImmediately` | on | Whether selecting text sends it immediately, or stages it as an attachment. |
| `defaultPrompt` | *(empty)* | Extra prompt appended when the selection is sent immediately. |

Preferences are stored in the DSH settings namespace `dsh-side-chat`.

## Project layout

```
src/
  index.ts            host plugin (routes, session/agent lifecycle, transcript folding)
  wire.ts             request/response helpers
  trust-fence.ts      loopback / trusted-API request guard
  settings-shared.ts  preference vocabulary shared by host and client
  context-types.ts    Cordis Context type augmentation
  client/
    index.tsx         client plugin (panel, composer, settings section, floating buttons)
    api.ts            client↔host API types
    locales.ts        zh/en dictionaries
    client.module.css panel/composer/settings styles
    layout.css        #root margin-right driven by panel width
cordis.patch.yml      bundle patch layer (inserts the loader row; dsh.bundle.patch)
dsh.plugin.json       external plugin manifest
tsdown.config.ts      bundle config (client externals + CSS inlining)
```

## License

[MIT](./LICENSE)
