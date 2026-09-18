import type { OrcaDisposable, OrcaLinkProvider } from '../../../../../shared/orca-terminal-surface'
import type { PaneTerminalSearchOptions, PaneTerminalSerializeOptions } from '../pane-terminal'
import { OrcaPaneTerminal, type OrcaPaneAppearance } from '../orca-pane-terminal'

export type GhosttyPaneTerminalOptions = {
  measureRoot: HTMLElement
  appearance?: Partial<OrcaPaneAppearance>
}

export class GhosttyPaneTerminal extends OrcaPaneTerminal {
  constructor(opts: GhosttyPaneTerminalOptions) {
    super(opts.measureRoot, opts.appearance)
  }

  clearSearch(): void {
    this.clearSelection()
  }

  findNext(query: string, opts?: PaneTerminalSearchOptions): boolean {
    return super.findNext(query, opts)
  }

  findPrevious(query: string, opts?: PaneTerminalSearchOptions): boolean {
    return super.findPrevious(query, opts)
  }

  serialize(opts?: PaneTerminalSerializeOptions): string {
    return super.serialize(opts)
  }

  registerLinkProvider(provider: OrcaLinkProvider): OrcaDisposable {
    return super.registerLinkProvider(provider)
  }
}
