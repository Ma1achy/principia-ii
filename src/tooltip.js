// Glass shader pipeline — generic WebGL blur/invert overlay.
// GlassPanel: low-level, apply to any canvas element.
// GlTooltip: floating tooltip built on GlassPanel.

async function fetchShader(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load shader: ${url}`);
  return res.text();
}

let _glassSrcs = null;
async function getGlassSrcs() {
  if (!_glassSrcs) {
    const base = new URL('./shaders/glass/', import.meta.url);
    _glassSrcs = await Promise.all([
      fetchShader(new URL('vert.glsl', base)),
      fetchShader(new URL('frag.glsl', base)),
    ]);
  }
  return _glassSrcs;
}

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

  // Re-initialise GL state (called when context is lost after canvas resize).
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

  // Allocate an empty RGBA texture + framebuffer for the intermediate pass.
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

  // Draw the glass effect.
  // sceneSource: canvas/image cropped to panel dimensions
  // textSource:  canvas with text in white on transparent background
  // blur:        radius scale — 1.0 = default sigma-8 kernel, 2.0 = twice as wide
  async draw(sceneSource, textSource, blur = 1.0) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    // Re-acquire context if the canvas was resized (causes context loss in some browsers)
    const freshGl = this.canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!freshGl) return;
    if (freshGl !== this.gl) await this._reinit();
    const gl = this.gl;

    gl.useProgram(this.prog);
    gl.disable(gl.BLEND);
    gl.uniform2f(this.uRes, W, H);
    gl.uniform1f(this.uBlur, blur);

    // Upload source textures
    const sceneTex = this._makeTex(gl, sceneSource);
    const textTex  = this._makeTex(gl, textSource);

    // Intermediate FBO for horizontal blur result
    const { tex: hBlurTex, fbo } = this._makeFBO(gl, W, H);

    // ── Pass 1: horizontal blur → FBO ────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.uniform1i(this.uHorizontal, 1);
    gl.uniform1i(this.uScene, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    this._drawQuad(gl);

    // ── Pass 2: vertical blur + composite → canvas ────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.uniform1i(this.uHorizontal, 0);
    // u_scene now reads from the H-blurred intermediate texture
    gl.uniform1i(this.uScene, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, hBlurTex);
    gl.uniform1i(this.uText, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    this._drawQuad(gl);

    // Cleanup
    gl.deleteTexture(sceneTex);
    gl.deleteTexture(textTex);
    gl.deleteTexture(hBlurTex);
    gl.deleteFramebuffer(fbo);
  }
}

// ─── GlTooltip ───────────────────────────────────────────────────────────────
// Floating fixed-position tooltip using the glass effect.

export class GlTooltip {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9999;display:none;box-shadow:0 0 18px 4px rgba(0,0,0,0.55);';
    document.body.appendChild(this.canvas);
    this._panel = null;
    this._initPromise = GlassPanel.create(this.canvas).then(p => { this._panel = p; });
  }

  _cropElement(el, screenX, screenY, W, H) {
    const r = el.getBoundingClientRect();
    const scaleX = el.width  / r.width;
    const scaleY = el.height / r.height;
    const sx = (screenX - r.left) * scaleX;
    const sy = (screenY - r.top)  * scaleY;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').drawImage(el, sx, sy, W * scaleX, H * scaleY, 0, 0, W, H);
    return c;
  }

  // lines: [{type:"row", label, val}] or [{type:"hint", text}]
  _buildTextCanvas(lines, W, H, dpr) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'white';
    ctx.textBaseline = 'top';
    const FONT_SIZE = 10 * dpr;
    const LINE_H    = 13 * dpr;
    const PAD_X     = 10 * dpr;
    const PAD_Y     = 7  * dpr;
    let y = PAD_Y;
    for (const ln of lines) {
      ctx.globalAlpha = 1.0;
      if (ln.type === 'hint') {
        ctx.font = `${FONT_SIZE}px "IBM Plex Mono", monospace`;
        const words = ln.text.split(' ');
        const maxW = W - PAD_X * 2;
        let line = '';
        for (const word of words) {
          const test = line ? line + ' ' + word : word;
          if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, PAD_X, y);
            y += LINE_H;
            line = word;
          } else {
            line = test;
          }
        }
        if (line) { ctx.fillText(line, PAD_X, y); y += LINE_H; }
      } else {
        ctx.font = `${FONT_SIZE}px "IBM Plex Mono", monospace`;
        ctx.fillText(ln.label, PAD_X, y);
        const vw = ctx.measureText(ln.val).width;
        ctx.fillText(ln.val, W - PAD_X - vw, y);
        y += LINE_H;
      }
    }
    return c;
  }

  render(lines, screenX, screenY, W, H, sceneEl) {
    this.canvas.style.left   = screenX + 'px';
    this.canvas.style.top    = screenY + 'px';
    this.canvas.style.width  = W + 'px';
    this.canvas.style.height = H + 'px';
    this.canvas.width  = W;
    this.canvas.height = H;
    this.canvas.style.display = 'block';

    // Read glass config from CSS custom properties on the tooltip canvas element.
    // Override per-element in CSS: .my-thing { --glass: 0; --glass-blur: 2.0; }
    const cs   = getComputedStyle(this.canvas);
    const glass = parseFloat(cs.getPropertyValue('--glass').trim() || '1');
    const blur  = parseFloat(cs.getPropertyValue('--glass-blur').trim() || '1.0');

    const dpr = window.devicePixelRatio || 1;

    let sceneC;
    if (glass && sceneEl) {
      sceneC = this._cropElement(sceneEl, screenX, screenY, W, H);
    } else {
      sceneC = document.createElement('canvas');
      sceneC.width = W; sceneC.height = H;
      const ctx = sceneC.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#efede8';
      ctx.fillRect(0, 0, W, H);
    }

    const textC_hi = this._buildTextCanvas(lines, W * dpr, H * dpr, dpr);
    const textScaled = document.createElement('canvas');
    textScaled.width = W; textScaled.height = H;
    textScaled.getContext('2d').drawImage(textC_hi, 0, 0, W, H);

    // Re-create the panel each render (handles canvas resize / context loss)
    GlassPanel.create(this.canvas).then(panel => panel.draw(sceneC, textScaled, blur));
  }

  hide() {
    this.canvas.style.display = 'none';
  }
}
