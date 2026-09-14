import type { ThemeRgb } from './ghostty-css-color'
import type { GhosttyVisitedCell } from './ghostty-renderer-cells'
import { compileGhosttyWebglProgram } from './ghostty-webgl-program'

const ATLAS = 1024
const FLOATS_PER_VERTEX = 12
const VERTICES_PER_QUAD = 6
const MAX_QUADS = 8192

type GlyphSlot = { u: number; v: number; uw: number; vh: number }

export class GhosttyWebglAtlas {
  readonly kind = 'webgl2' as const
  private readonly gl: WebGL2RenderingContext
  private readonly canvas: HTMLCanvasElement
  private readonly program: WebGLProgram
  private readonly buffer: WebGLBuffer
  private readonly vao: WebGLVertexArrayObject
  private readonly texture: WebGLTexture
  private readonly baker: OffscreenCanvas | HTMLCanvasElement
  private readonly bakeCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  private readonly glyphs = new Map<string, GlyphSlot>()
  private atlasX = 1
  private atlasY = 1
  private atlasRowH = 0
  private readonly floats = new Float32Array(MAX_QUADS * VERTICES_PER_QUAD * FLOATS_PER_VERTEX)
  private quadCount = 0

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.canvas = canvas
    this.gl = gl
    this.program = program
    const vao = gl.createVertexArray()
    const buffer = gl.createBuffer()
    const texture = gl.createTexture()
    if (!vao || !buffer || !texture) {
      throw new Error('WebGL2 atlas resources unavailable')
    }
    this.vao = vao
    this.buffer = buffer
    this.texture = texture
    this.baker =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(64, 64)
        : document.createElement('canvas')
    const bakeCtx = this.baker.getContext('2d')
    if (!bakeCtx) {
      throw new Error('glyph baker unavailable')
    }
    this.bakeCtx = bakeCtx
    this.bindProgram()
    this.initTexture()
  }

  begin(cssWidth: number, cssHeight: number, dpr: number, bg: ThemeRgb, alpha: number): void {
    const gl = this.gl
    const width = Math.max(1, Math.floor(cssWidth * dpr))
    const height = Math.max(1, Math.floor(cssHeight * dpr))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.canvas.style.width = `${cssWidth}px`
      this.canvas.style.height = `${cssHeight}px`
    }
    gl.viewport(0, 0, width, height)
    gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, alpha)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), cssWidth, cssHeight)
    this.quadCount = 0
  }

  paintCell(cell: GhosttyVisitedCell, cellWidth: number, cellHeight: number): void {
    const px = cell.x * cellWidth
    const py = cell.y * cellHeight
    const width = cell.columns * cellWidth
    const slot = cell.grapheme ? this.glyph(cell.grapheme, cell.font, cellWidth, cellHeight) : null
    this.quad(
      px,
      py,
      width,
      cellHeight,
      slot,
      cell.fg,
      cell.bg,
      cell.bgAlpha,
      cell.grapheme ? 1 : 0
    )
    if (cell.underline) {
      this.quad(px, py + cellHeight - 1, width, 1, null, cell.fg, cell.fg, 1, 0)
    }
    if (cell.strike) {
      this.quad(px, py + cellHeight / 2, width, 1, null, cell.fg, cell.fg, 1, 0)
    }
  }

  fillRect(x: number, y: number, w: number, h: number, color: ThemeRgb): void {
    this.quad(x, y, w, h, null, color, color, 1, 0)
  }

  end(): void {
    if (this.quadCount === 0) {
      return
    }
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.floats.subarray(0, this.quadCount * VERTICES_PER_QUAD * FLOATS_PER_VERTEX),
      gl.STREAM_DRAW
    )
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.drawArrays(gl.TRIANGLES, 0, this.quadCount * VERTICES_PER_QUAD)
  }

  loseContext(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  restoreContext(): void {
    this.gl.getExtension('WEBGL_lose_context')?.restoreContext()
  }

  isContextLost(): boolean {
    return this.gl.isContextLost()
  }

  dispose(): void {
    this.loseContext()
  }

  private glyph(grapheme: string, font: string, cellWidth: number, cellHeight: number): GlyphSlot {
    const key = `${font}\0${grapheme}`
    const cached = this.glyphs.get(key)
    if (cached) {
      return cached
    }
    const w = Math.max(1, Math.ceil(cellWidth))
    const h = Math.max(1, Math.ceil(cellHeight))
    if (this.atlasX + w + 1 >= ATLAS) {
      this.atlasX = 1
      this.atlasY += this.atlasRowH + 1
      this.atlasRowH = 0
    }
    if (this.atlasY + h + 1 >= ATLAS) {
      this.glyphs.clear()
      this.atlasX = 1
      this.atlasY = 1
      this.atlasRowH = 0
    }
    this.baker.width = w
    this.baker.height = h
    this.bakeCtx.clearRect(0, 0, w, h)
    this.bakeCtx.font = font
    this.bakeCtx.fillStyle = '#fff'
    this.bakeCtx.textBaseline = 'alphabetic'
    const metrics = this.bakeCtx.measureText(grapheme)
    const ascent = metrics.actualBoundingBoxAscent || h * 0.8
    const descent = metrics.actualBoundingBoxDescent || h * 0.2
    this.bakeCtx.fillText(grapheme, 0, (h - (ascent + descent)) / 2 + ascent)
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture)
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.atlasX,
      this.atlasY,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      this.baker
    )
    const slot = {
      u: this.atlasX / ATLAS,
      v: this.atlasY / ATLAS,
      uw: w / ATLAS,
      vh: h / ATLAS
    }
    this.glyphs.set(key, slot)
    this.atlasX += w + 1
    this.atlasRowH = Math.max(this.atlasRowH, h)
    return slot
  }

  private quad(
    x: number,
    y: number,
    w: number,
    h: number,
    slot: GlyphSlot | null,
    fg: ThemeRgb,
    bg: ThemeRgb,
    bgAlpha: number,
    fgAlpha: number
  ): void {
    if (this.quadCount >= MAX_QUADS) {
      this.end()
      this.quadCount = 0
    }
    const u0 = slot ? slot.u : -1
    const v0 = slot ? slot.v : 0
    const u1 = slot ? slot.u + slot.uw : -1
    const v1 = slot ? slot.v + slot.vh : 0
    const verts = [
      [x, y, u0, v0],
      [x + w, y, u1, v0],
      [x, y + h, u0, v1],
      [x, y + h, u0, v1],
      [x + w, y, u1, v0],
      [x + w, y + h, u1, v1]
    ]
    let offset = this.quadCount * VERTICES_PER_QUAD * FLOATS_PER_VERTEX
    for (const [px, py, u, v] of verts) {
      this.floats[offset] = px
      this.floats[offset + 1] = py
      this.floats[offset + 2] = u
      this.floats[offset + 3] = v
      this.floats[offset + 4] = fg[0] / 255
      this.floats[offset + 5] = fg[1] / 255
      this.floats[offset + 6] = fg[2] / 255
      this.floats[offset + 7] = fgAlpha
      this.floats[offset + 8] = bg[0] / 255
      this.floats[offset + 9] = bg[1] / 255
      this.floats[offset + 10] = bg[2] / 255
      this.floats[offset + 11] = bgAlpha
      offset += FLOATS_PER_VERTEX
    }
    this.quadCount += 1
  }

  private bindProgram(): void {
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const stride = FLOATS_PER_VERTEX * 4
    const loc = (name: string): number => gl.getAttribLocation(this.program, name)
    gl.enableVertexAttribArray(loc('a_pos'))
    gl.vertexAttribPointer(loc('a_pos'), 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(loc('a_uv'))
    gl.vertexAttribPointer(loc('a_uv'), 2, gl.FLOAT, false, stride, 8)
    gl.enableVertexAttribArray(loc('a_fg'))
    gl.vertexAttribPointer(loc('a_fg'), 4, gl.FLOAT, false, stride, 16)
    gl.enableVertexAttribArray(loc('a_bg'))
    gl.vertexAttribPointer(loc('a_bg'), 4, gl.FLOAT, false, stride, 32)
  }

  private initTexture(): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ATLAS, ATLAS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  }
}

export function isUsableWebGL2(value: RenderingContext | null): value is WebGL2RenderingContext {
  return (
    value !== null &&
    'createTexture' in value &&
    typeof value.createTexture === 'function' &&
    'createShader' in value &&
    typeof value.createShader === 'function' &&
    'texSubImage2D' in value &&
    typeof value.texSubImage2D === 'function' &&
    'drawArrays' in value &&
    typeof value.drawArrays === 'function'
  )
}

export function tryCreateGhosttyWebglAtlas(canvas: HTMLCanvasElement): GhosttyWebglAtlas | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true
  })
  if (!isUsableWebGL2(gl)) {
    return null
  }
  const program = compileGhosttyWebglProgram(gl)
  if (!program) {
    return null
  }
  try {
    return new GhosttyWebglAtlas(canvas, gl, program)
  } catch {
    return null
  }
}
