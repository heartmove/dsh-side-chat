/**
 * Last-resort render guard for runtime drift.
 *
 * The client bundle externalizes the platform modules the DSH web shell freezes
 * into its module table (`react`, `dsh-client-ui-slots`,
 * `dsh-client-ui-primitives`). Those exports are resolved by the RUNNING shell,
 * not by the line this bundle was compiled against, so a newer DSH that drops or
 * renames one hands this bundle `undefined` — React then throws on render and
 * the whole panel (or the host's right-sidebar tab that embeds it) disappears.
 * `check-seed-exports` catches that at build time against the newest installed
 * shell; this boundary covers the gap where the runtime is newer than the last
 * verified line.
 *
 * It renders a neutral placeholder instead of retrying: a drifted platform
 * contract needs a rebuilt bundle, and an endless retry would only spam the
 * console. The failure is logged once per mount with the component label.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import css from './client.module.css'

interface SidechatErrorBoundaryProps {
  /** Which surface failed ("panel" / "dock"), for the log line. */
  label: string
  children: ReactNode
}

interface SidechatErrorBoundaryState {
  failure: unknown
}

/** Render-level guard around one mounted side-chat surface. */
export class SidechatErrorBoundary extends Component<SidechatErrorBoundaryProps, SidechatErrorBoundaryState> {
  state: SidechatErrorBoundaryState = { failure: null }

  static getDerivedStateFromError(failure: unknown): SidechatErrorBoundaryState {
    return { failure }
  }

  componentDidCatch(failure: unknown, info: ErrorInfo): void {
    console.error(
      `[dsh-side-chat] ${this.props.label} failed to render against this DSH runtime:`,
      failure instanceof Error ? failure.message : String(failure),
      info.componentStack ?? '',
    )
  }

  render(): ReactNode {
    if (this.state.failure === null) return this.props.children
    return (
      <div className={css.renderFailure} data-dsh-side-chat-failure={this.props.label} role="alert">
        <strong>侧边聊天无法在此 DSH 版本上渲染 / Side chat cannot render on this DSH build</strong>
        <span>请把 dsh-side-chat-plus 升级到与当前 DSH 匹配的版本，或重载插件。 / Update dsh-side-chat-plus to a release built for this DSH, then reload the plugin.</span>
        <code>{this.state.failure instanceof Error ? this.state.failure.message : String(this.state.failure)}</code>
      </div>
    )
  }
}
