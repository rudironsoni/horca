export type OrcaPaneHostChrome = {
  write(data: string): void
  resize(cols: number, rows: number): void
  sync(): void
  dispose(): void
}

export function bindOrcaPaneHostChrome(
  _canvas: HTMLCanvasElement,
  _host: HTMLElement,
  _scrollLines: (delta: number) => void
): OrcaPaneHostChrome {
  return {
    write() {},
    resize() {},
    sync() {},
    dispose() {}
  }
}
