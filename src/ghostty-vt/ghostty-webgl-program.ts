export const GHOSTTY_WEBGL_VERTEX = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
in vec4 a_fg;
in vec4 a_bg;
uniform vec2 u_resolution;
out vec2 v_uv;
out vec4 v_fg;
out vec4 v_bg;
void main() {
  vec2 clip = (a_pos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_fg = a_fg;
  v_bg = a_bg;
}
`

export const GHOSTTY_WEBGL_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_fg;
in vec4 v_bg;
uniform sampler2D u_atlas;
out vec4 outColor;
void main() {
  float a = v_uv.x < 0.0 ? 0.0 : texture(u_atlas, v_uv).a;
  outColor = mix(v_bg, vec4(v_fg.rgb, 1.0), a * v_fg.a);
}
`

export function compileGhosttyWebglProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, GHOSTTY_WEBGL_VERTEX)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, GHOSTTY_WEBGL_FRAGMENT)
  if (!vertex || !fragment) {
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return null
  }
  return program
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}
