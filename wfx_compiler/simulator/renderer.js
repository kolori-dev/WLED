// Canvas LED visualization — renders 1D strips or 2D grids

export class LEDRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pixelSize = 12;
    this.gap = 2;
  }

  configure(opts = {}) {
    if (opts.pixelSize != null) this.pixelSize = opts.pixelSize;
    if (opts.gap != null) this.gap = opts.gap;
  }

  // Convert RGBW32 to CSS color string
  _toCSS(c) {
    const w = (c >>> 24) & 0xFF;
    let r = (c >> 16) & 0xFF;
    let g = (c >> 8) & 0xFF;
    let b = c & 0xFF;
    // Mix white channel into RGB
    r = Math.min(255, r + w);
    g = Math.min(255, g + w);
    b = Math.min(255, b + w);
    return `rgb(${r},${g},${b})`;
  }

  // Auto-compute pixel size to fit canvas
  _autoSize(count, canvasLen) {
    if (count <= 0) return this.pixelSize;
    const maxSize = Math.floor((canvasLen - this.gap) / count) - this.gap;
    return Math.max(2, Math.min(this.pixelSize, maxSize));
  }

  render(pixels1d, pixels2d, is2D, width, height) {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, cw, ch);

    if (is2D && pixels2d && width > 0 && height > 0) {
      this._render2D(pixels2d, width, height, cw, ch);
    } else if (pixels1d && pixels1d.length > 0) {
      this._render1D(pixels1d, cw, ch);
    }
  }

  _render1D(pixels, cw, ch) {
    const ctx = this.ctx;
    const count = pixels.length;
    const ps = this._autoSize(count, cw);
    const gap = this.gap;
    const totalW = count * (ps + gap) - gap;
    const startX = Math.max(0, (cw - totalW) / 2);
    const cy = ch / 2;
    const radius = ps / 2;

    for (let i = 0; i < count; i++) {
      const x = startX + i * (ps + gap) + radius;
      const color = pixels[i];
      if (color === 0) continue;

      const css = this._toCSS(color);

      // Glow effect
      ctx.shadowColor = css;
      ctx.shadowBlur = ps * 0.6;
      ctx.fillStyle = css;
      ctx.beginPath();
      ctx.arc(x, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  _render2D(pixels2d, width, height, cw, ch) {
    const ctx = this.ctx;

    // For large grids, use imageData for performance
    if (width > 32 || height > 32) {
      this._render2DImage(pixels2d, width, height, cw, ch);
      return;
    }

    const psX = this._autoSize(width, cw);
    const psY = this._autoSize(height, ch);
    const ps = Math.min(psX, psY);
    const gap = this.gap;
    const totalW = width * (ps + gap) - gap;
    const totalH = height * (ps + gap) - gap;
    const startX = Math.max(0, (cw - totalW) / 2);
    const startY = Math.max(0, (ch - totalH) / 2);
    const radius = ps / 2;

    for (let y = 0; y < height; y++) {
      const row = pixels2d[y];
      if (!row) continue;
      for (let x = 0; x < width; x++) {
        const color = row[x];
        if (color === 0) continue;

        const css = this._toCSS(color);
        const px = startX + x * (ps + gap) + radius;
        const py = startY + y * (ps + gap) + radius;

        ctx.shadowColor = css;
        ctx.shadowBlur = ps * 0.4;
        ctx.fillStyle = css;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
  }

  _render2DImage(pixels2d, width, height, cw, ch) {
    const ctx = this.ctx;
    const scaleX = Math.floor(cw / width);
    const scaleY = Math.floor(ch / height);
    const scale = Math.max(1, Math.min(scaleX, scaleY));
    const dw = width * scale;
    const dh = height * scale;
    const ox = Math.floor((cw - dw) / 2);
    const oy = Math.floor((ch - dh) / 2);

    const imgData = ctx.createImageData(dw, dh);
    const data = imgData.data;

    for (let y = 0; y < height; y++) {
      const row = pixels2d[y];
      if (!row) continue;
      for (let x = 0; x < width; x++) {
        const c = row[x];
        const w = (c >>> 24) & 0xFF;
        const r = Math.min(255, ((c >> 16) & 0xFF) + w);
        const g = Math.min(255, ((c >> 8) & 0xFF) + w);
        const b = Math.min(255, (c & 0xFF) + w);

        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const idx = ((y * scale + sy) * dw + x * scale + sx) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imgData, ox, oy);
  }
}
