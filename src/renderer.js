import { dot10, add10, sub10, scale10, norm10, normalize10, basis10 } from './math.js';

async function fetchShader(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load shader: ${url}`);
  return res.text();
}

export async function createThreeBodyRenderer(glCanvas, outCanvas) {
  const [vertSrc, fragSrc] = await Promise.all([
    fetchShader(new URL('./shaders/principia/vert.glsl', import.meta.url)),
    fetchShader(new URL('./shaders/principia/frag.glsl', import.meta.url)),
  ]);
  return new ThreeBodyRenderer(glCanvas, outCanvas, vertSrc, fragSrc);
}

class ThreeBodyRenderer {
  constructor(glCanvas, outCanvas, vertSrc, fragSrc) {
    this.canvas = glCanvas;
    this.outCanvas = outCanvas;
    const gl = glCanvas.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;
    this.program = this._createProgram(vertSrc, fragSrc);
    this.gl.useProgram(this.program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(this.program, "position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    this.U = {};
    [
      "uHorizon","uDtMacro","uRColl","uREsc","uMaxSteps","uRenderMode","uTile",
      "uZ0_012","uZ0_345","uZ0_6789",
      "uQ1_012","uQ1_345","uQ1_6789",
      "uQ2_012","uQ2_345","uQ2_6789"
    ].forEach(n => this.U[n] = gl.getUniformLocation(this.program, n));
    this.tilePixels = null;
    this.tileFlipped = null;
    this.abort = false;
    this._maxDrawable = null;
    this._max2D = null;
  }

  setAbort(flag) { this.abort = flag; }

  getMaxDrawableSize() {
    if (this._maxDrawable != null) return this._maxDrawable;
    const gl = this.gl;
    const tex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const rb  = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const vp  = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    this._maxDrawable = Math.min(tex, rb, vp[0], vp[1]);
    return this._maxDrawable;
  }

  getMax2DCanvasSize() {
    if (this._max2D != null) return this._max2D;
    const c = document.createElement("canvas");
    let lo = 1024, hi = 32768;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      c.width = mid; c.height = mid;
      if (c.width === mid && c.height === mid) lo = mid;
      else hi = mid - 1;
    }
    this._max2D = lo;
    return lo;
  }

  _createShader(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(msg || "Shader compile failed");
    }
    return sh;
  }

  _createProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = this._createShader(gl.VERTEX_SHADER, vsSrc);
    const fs = this._createShader(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const msg = gl.getProgramInfoLog(prog);
      throw new Error(msg || "Program link failed");
    }
    return prog;
  }

  computeSliceDirs(st) {
    const gamma = (st.gammaDeg * Math.PI) / 180.0;
    let q1 = add10(st.dir1Base, scale10(basis10(st.tiltDim1), st.tiltAmt1));
    let q2 = add10(st.dir2Base, scale10(basis10(st.tiltDim2), st.tiltAmt2));
    q1 = normalize10(q1);
    if (st.doOrtho) {
      const proj = dot10(q2, q1);
      q2 = sub10(q2, scale10(q1, proj));
    }
    q2 = normalize10(q2);
    const c = Math.cos(gamma), s = Math.sin(gamma);
    const q1r = add10(scale10(q1, c),  scale10(q2, s));
    const q2r = add10(scale10(q1, -s), scale10(q2, c));
    return { q1: q1r, q2: q2r };
  }

  _setUniforms(st, tile) {
    const gl = this.gl;
    const U = this.U;
    gl.uniform1f(U.uHorizon, st.horizon);
    gl.uniform1f(U.uDtMacro, st.dtMacro);
    gl.uniform1f(U.uRColl, st.rColl);
    gl.uniform1f(U.uREsc,  st.rEsc);
    gl.uniform1i(U.uMaxSteps, Math.max(1, Math.min(20000, st.maxSteps | 0)));
    gl.uniform1i(U.uRenderMode, st.mode | 0);
    gl.uniform4f(U.uTile, tile.offX, tile.offY, tile.scX, tile.scY);
    gl.uniform3fv(U.uZ0_012, [st.z0[0], st.z0[1], st.z0[2]]);
    gl.uniform3fv(U.uZ0_345, [st.z0[3], st.z0[4], st.z0[5]]);
    gl.uniform4fv(U.uZ0_6789, [st.z0[6], st.z0[7], st.z0[8], st.z0[9]]);
    const { q1, q2 } = this.computeSliceDirs(st);
    gl.uniform3fv(U.uQ1_012, q1.slice(0, 3));
    gl.uniform3fv(U.uQ1_345, q1.slice(3, 6));
    gl.uniform4fv(U.uQ1_6789, q1.slice(6, 10));
    gl.uniform3fv(U.uQ2_012, q2.slice(0, 3));
    gl.uniform3fv(U.uQ2_345, q2.slice(3, 6));
    gl.uniform4fv(U.uQ2_6789, q2.slice(6, 10));
  }

  fullViewTile(st) {
    return { offX: st.viewPanX, offY: st.viewPanY, scX: st.viewZoom, scY: st.viewZoom };
  }

  renderNormal(st, res) {
    const gl = this.gl;
    this.canvas.width = res;
    this.canvas.height = res;
    gl.viewport(0, 0, res, res);
    gl.useProgram(this.program);
    this._setUniforms(st, this.fullViewTile(st));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  async renderTiled(st, targetSize, onProgress) {
    const gl = this.gl;
    this.abort = false;
    const max2D = this.getMax2DCanvasSize();
    if (targetSize > max2D) throw new Error(`2D canvas limit ~${max2D}px`);
    const maxGpu = this.getMaxDrawableSize();
    const TILE = Math.min(4096, maxGpu);
    const out = this.outCanvas;
    out.width = targetSize;
    out.height = targetSize;
    const out2d = out.getContext("2d", { willReadFrequently: false });
    const maxTile = TILE;
    if (!this.tilePixels || this.tilePixels.length !== maxTile * maxTile * 4) {
      this.tilePixels = new Uint8Array(maxTile * maxTile * 4);
      this.tileFlipped = new Uint8ClampedArray(maxTile * maxTile * 4);
    }
    const tilesX = Math.ceil(targetSize / TILE);
    const tilesY = Math.ceil(targetSize / TILE);
    const total = tilesX * tilesY;
    let done = 0;
    gl.useProgram(this.program);
    this._setUniforms(st, this.fullViewTile(st));
    const view = this.fullViewTile(st);
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        if (this.abort) return { aborted: true };
        const x0 = tx * TILE, y0 = ty * TILE;
        const w = Math.min(TILE, targetSize - x0);
        const h = Math.min(TILE, targetSize - y0);
        this.canvas.width = w; this.canvas.height = h;
        gl.viewport(0, 0, w, h);
        const u0 = x0 / targetSize, us = w / targetSize;
        const v0 = 1.0 - (y0 + h) / targetSize, vs = h / targetSize;
        const tile = {
          offX: view.offX + u0 * view.scX,
          offY: view.offY + v0 * view.scY,
          scX:  us * view.scX,
          scY:  vs * view.scY,
        };
        gl.uniform4f(this.U.uTile, tile.offX, tile.offY, tile.scX, tile.scY);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.tilePixels);
        for (let row = 0; row < h; row++) {
          const srcRow = (h - 1 - row);
          this.tileFlipped.set(
            this.tilePixels.subarray(srcRow * w * 4, srcRow * w * 4 + w * 4),
            row * w * 4
          );
        }
        out2d.putImageData(new ImageData(this.tileFlipped.subarray(0, w * h * 4), w, h), x0, y0);
        done++;
        if (onProgress) onProgress({ done, total, w, h, tx, ty });
        await new Promise(requestAnimationFrame);
      }
    }
    return { aborted: false };
  }
}
