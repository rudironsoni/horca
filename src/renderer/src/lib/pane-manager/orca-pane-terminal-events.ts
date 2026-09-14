import type { OrcaDisposable, OrcaLinkProvider } from '../../../../shared/orca-terminal-surface'
import { registerOrcaPaneLinkProvider } from './orca-pane-links'
import { trackListener } from './orca-pane-buffer'

export class OrcaPaneListenerHub {
  readonly linkProviders = new Set<OrcaLinkProvider>()
  protected readonly dataListeners = new Set<(data: string) => void>()
  protected readonly renderListeners = new Set<() => void>()
  protected readonly resizeListeners = new Set<(size: { cols: number; rows: number }) => void>()
  protected readonly selectionListeners = new Set<() => void>()
  protected readonly titleListeners = new Set<(title: string) => void>()
  protected customKeyHandler: ((event: KeyboardEvent) => boolean) | null = null
  protected wheelPolicy: ((event: WheelEvent) => boolean) | null = null

  customWheelHandler(): ((event: WheelEvent) => boolean) | null {
    return this.wheelPolicy
  }

  onData(listener: (data: string) => void): OrcaDisposable {
    return trackListener(this.dataListeners, listener)
  }
  onResize(listener: (size: { cols: number; rows: number }) => void): OrcaDisposable {
    return trackListener(this.resizeListeners, listener)
  }
  onRender(listener: () => void): OrcaDisposable {
    return trackListener(this.renderListeners, listener)
  }
  onSelectionChange(listener: () => void): OrcaDisposable {
    return trackListener(this.selectionListeners, listener)
  }
  onWriteParsed(listener: () => void): OrcaDisposable {
    return this.onData(() => listener())
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    this.customKeyHandler = handler
  }
  attachCustomWheelEventHandler(handler: (event: WheelEvent) => boolean): void {
    this.wheelPolicy = handler
  }
  addLinkProvider(provider: OrcaLinkProvider): OrcaDisposable {
    return registerOrcaPaneLinkProvider(this.linkProviders, provider)
  }
  registerLinkProvider(provider: OrcaLinkProvider): OrcaDisposable {
    return this.addLinkProvider(provider)
  }
  registerCharacterJoiner(_handler: (text: string) => number[][]): number {
    return 0
  }
  deregisterCharacterJoiner(_id: number): void {}
}
