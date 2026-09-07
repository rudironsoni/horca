export function captureLogicalLineAnchor(
  _terminal: unknown,
  _viewportY: number
): { cellOffset: number; lineY: number } | undefined {
  return undefined
}

export function resolveLogicalCellOffsetLine(
  _terminal: unknown,
  lineY: number,
  _cellOffset: number
): number {
  return lineY
}
