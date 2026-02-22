import { getGlassSrcs } from './shaders.js';

// ─── GlassPanel ──────────────────────────────────────────────────────────────
// Renders the glass blur/invert effect onto a given canvas element using a
// two-pass separable Gaussian blur with bilinear-offset taps.
//
// Pass 1: horizontal blur  → intermediate FBO texture
// Pass 2: vertical blur + text composite → canvas
//
// Usage:
//   const panel = await GlassPanel.create(canvas);
//   panel.draw(sceneImageSource, textImageSource);

export class GlassPanel {
  constructor(canvas, gl, prog, buf) {
    this.canvas = canvas;
    this.gl     = gl;
    this.prog   = prog;
    this.buf    = buf;
    this.uScene      = gl.getUniformLocation(prog, 'u_scene');
    this.uText       = gl.getUniformLocation(prog, 'u_text');
    this.uRes        = gl.getUniformLocation(prog, 'u_res');
    this.uHorizontal = gl.getUniformLocation(prog, 'u_horizontal');
    this.uBlur       = gl.getUniformLocation(prog, 'u_blur');
  }

  static _buildProgram(gl, vertSrc, fragSrc) {
    const mkShader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, mkShader(gl.VERTEX_SHADER, vertSrc));
    gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(prog);
    return prog;
  }

  static async create(canvas) {
    const [vertSrc, fragSrc] = await getGlassSrcs();
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error('WebGL not available for GlassPanel');
    const prog = GlassPanel._buildProgram(gl, vertSrc, fragSrc);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    return new GlassPanel(canvas, gl, prog, buf);
  }

  async _reinit() {
    const [vertSrc, fragSrc] = await getGlassSrcs();
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!gl) return false;
    this.gl   = gl;
    this.prog = GlassPanel._buildProgram(gl, vertSrc, fragSrc);
    gl.useProgram(this.prog);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    this.uScene      = gl.getUniformLocation(this.prog, 'u_scene');
    this.uText       = gl.getUniformLocation(this.prog, 'u_text');
    this.uRes        = gl.getUniformLocation(this.prog, 'u_res');
    this.uHorizontal = gl.getUniformLocation(this.prog, 'u_horizontal');
    this.uBlur       = gl.getUniformLocation(this.prog, 'u_blur');
    return true;
  }

  _makeTex(gl, source) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return tex;
  }

  _makeFBO(gl, W, H) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  }

  _drawQuad(gl) {
    const aPos = gl.getAttribLocation(this.prog, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  async draw(sceneSource, textSource, blur = 1.0) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const freshGl = this.canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!freshGl) return;
    if (freshGl !== this.gl) await this._reinit();
    const gl = this.gl;

    gl.useProgram(this.prog);
    gl.disable(gl.BLEND);
    gl.uniform2f(this.uRes, W, H);
    gl.uniform1f(this.uBlur, blur);

    const sceneTex = this._makeTex(gl, sceneSource);
    const textTex  = this._makeTex(gl, textSource);
    const { tex: hBlurTex, fbo } = this._makeFBO(gl, W, H);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.uniform1i(this.uHorizontal, 1);
    gl.uniform1i(this.uScene, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    this._drawQuad(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.uniform1i(this.uHorizontal, 0);
    gl.uniform1i(this.uScene, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, hBlurTex);
    gl.uniform1i(this.uText, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    this._drawQuad(gl);

    gl.deleteTexture(sceneTex);
    gl.deleteTexture(textTex);
    gl.deleteTexture(hBlurTex);
    gl.deleteFramebuffer(fbo);
  }
}
