// Browser-compatible WFX VM — ES module
// Full visual operations: fade, blur, 2D geometry, text, palette interpolation

import { PALETTES, colorFromPalette, color_blend, color_scale } from './palettes.js';
import { FONTS } from './fonts.js';

// ---- Constants matching wled_vm.h ----
const REG_COUNT = 0x25;
const REG_P0 = 0x1C;
const MAX_CYCLES = 50000;
const CALL_STACK_DEPTH = 16;
const FRAMETIME = 42;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

// Register indices
const REG = {
  R0: 0x00, R1: 0x01, R2: 0x02, R3: 0x03,
  R4: 0x04, R5: 0x05, R6: 0x06, R7: 0x07,
  R8: 0x08, R9: 0x09, R10: 0x0A, R11: 0x0B,
  R12: 0x0C, R13: 0x0D, R14: 0x0E, R15: 0x0F,
  F0: 0x10, F1: 0x11, F2: 0x12, F3: 0x13,
  F4: 0x14, F5: 0x15, F6: 0x16, F7: 0x17,
  C0: 0x18, C1: 0x19, C2: 0x1A, C3: 0x1B,
  P0: 0x1C, P1: 0x1D, P2: 0x1E, P3: 0x1F,
  LEN: 0x20, NOW: 0x21, CALL: 0x22, WIDTH: 0x23, HEIGHT: 0x24,
};

// Opcodes
const OP = {
  ADD: 0x01, SUB: 0x02, MUL: 0x03, DIV: 0x04, MOD: 0x05,
  AND: 0x06, OR: 0x07, XOR: 0x08, SHL: 0x09, SHR: 0x0A,
  NEG: 0x0B, NOT: 0x0C,
  LDI: 0x10, LDI32: 0x11, MOV: 0x12,
  LDB: 0x13, STB: 0x14, LDW: 0x15, STW: 0x16,
  GSPD: 0x20, GINT: 0x21, GC1: 0x22, GC2: 0x23, GC3: 0x24,
  GCHK: 0x25, GCOL: 0x26, GPAL: 0x27,
  GAUX: 0x28, SAUX: 0x29, GSTP: 0x2A, SSTP: 0x2B,
  SPXC: 0x30, GPXC: 0x31, SPXY: 0x32, GPXY: 0x33,
  FILL: 0x34, FADE: 0x35, BLUR: 0x36, BLR2: 0x37,
  RGB: 0x40, RGBW: 0x41, CBLND: 0x42, CFADE: 0x43,
  CADD: 0x44, CPAL: 0x45, CPALX: 0x46, CWHL: 0x47,
  EXTR: 0x48, EXTG: 0x49, EXTB: 0x4A, EXTW: 0x4B,
  SIN8: 0x50, COS8: 0x51, SIN16: 0x52, BEAT8: 0x53,
  TRI8: 0x54, QAD8: 0x55, SCL8: 0x56, QADD8: 0x57,
  QSUB8: 0x58, RND8: 0x59, RND16: 0x5A, RNDR: 0x5B,
  NOISE: 0x5C, NOI2: 0x5D, NOI3: 0x5E, SQRT: 0x5F,
  ABS: 0x60, MIN: 0x61, MAX: 0x62,
  JMP: 0x70, JZ: 0x71, JNZ: 0x72, JLT: 0x73, JGT: 0x74,
  JEQ: 0x75, JLE: 0x76, JGE: 0x77,
  CALL: 0x78, RET: 0x79, HALT: 0x7A, HALTS: 0x7B,
  ALLOC: 0x80,
  DLINE: 0x90, DCIRC: 0x91, FCIRC: 0x92, MOVEP: 0x93,
  FADD: 0xA0, FSUB: 0xA1, FMUL: 0xA2, FDIV: 0xA3,
  ITOF: 0xA4, FTOI: 0xA5, FSIN: 0xA6, FCOS: 0xA7,
  GVOL: 0xB0, GPEAK: 0xB1, GFFT: 0xB2,
  ABASS: 0xB3, AMID: 0xB4, ATREB: 0xB5,
  DCHR: 0xC0, GCHR: 0xC1, GNLN: 0xC2, GFNW: 0xC3, GFNH: 0xC4,
  NOP: 0xFF,
};

// WFX header constants
const WFX = {
  MAGIC: [0x57, 0x46, 0x58],
  VERSION: 0x01,
  FLAG_2D: 0x01,
  FLAG_PALETTE: 0x02,
  FLAG_AUDIO: 0x04,
  HEADER_SIZE: 8,
};

// ---- Integer helpers ----
function i32(v) { return v | 0; }
function u32(v) { return v >>> 0; }
function u8(v) { return v & 0xFF; }
function u16(v) { return v & 0xFFFF; }

// ---- FastLED-compatible math ----
const SIN8_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  SIN8_TABLE[i] = Math.round(128 + 127 * Math.sin(i * 2 * Math.PI / 256));
}
function sin8(x) { return SIN8_TABLE[u8(x)]; }
function cos8(x) { return SIN8_TABLE[u8(x + 64)]; }

function sin16(x) {
  return i32(Math.round(32767 * Math.sin(u16(x) * 2 * Math.PI / 65536)));
}

function triwave8(x) {
  const v = u8(x);
  return v < 128 ? v * 2 : (255 - v) * 2;
}

function quadwave8(x) { return sin8(triwave8(x)); }

function scale8(a, b) { return u8(Math.floor((u8(a) * u8(b)) / 256)); }

function qadd8(a, b) {
  const s = u8(a) + u8(b);
  return s > 255 ? 255 : s;
}

function qsub8(a, b) {
  const s = u8(a) - u8(b);
  return s < 0 ? 0 : s;
}

function sqrt16(v) {
  if (v <= 0) return 0;
  return Math.floor(Math.sqrt(u16(v)));
}

// PRNG (xorshift32)
let _rngState = 12345;
function _nextRng() {
  let x = _rngState;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  _rngState = x;
  return u32(x);
}
function random8() { return _nextRng() & 0xFF; }
function random16() { return _nextRng() & 0xFFFF; }
function randomRange(lo, hi) {
  lo = u8(lo); hi = u8(hi);
  if (lo >= hi) return lo;
  return lo + (_nextRng() % (hi - lo));
}

// Noise (simple hash-based)
function inoise8_1(x) { return u8((x * 37 + 97) ^ (x >> 3)); }
function inoise8_2(x, y) { return u8(inoise8_1(x) ^ inoise8_1(y + 53)); }
function inoise8_3(x, y, z) { return u8(inoise8_2(x, y) ^ inoise8_1(z + 127)); }

// ---- Color helpers ----
function RGBW32(r, g, b, w) {
  return u32((u8(w) << 24) | (u8(r) << 16) | (u8(g) << 8) | u8(b));
}
function R(c) { return (u32(c) >> 16) & 0xFF; }
function G(c) { return (u32(c) >> 8) & 0xFF; }
function B(c) { return u32(c) & 0xFF; }
function W(c) { return (u32(c) >> 24) & 0xFF; }

function color_fade(c, amount) {
  const a = u8(amount);
  return RGBW32(
    Math.floor(R(c) * a / 256),
    Math.floor(G(c) * a / 256),
    Math.floor(B(c) * a / 256),
    Math.floor(W(c) * a / 256)
  );
}

function color_add(a, b) {
  return RGBW32(
    Math.min(255, R(a) + R(b)),
    Math.min(255, G(a) + G(b)),
    Math.min(255, B(a) + B(b)),
    Math.min(255, W(a) + W(b))
  );
}

function color_wheel(pos) {
  pos = u8(pos);
  if (pos < 85) return RGBW32(255 - pos * 3, pos * 3, 0, 0);
  if (pos < 170) { pos -= 85; return RGBW32(0, 255 - pos * 3, pos * 3, 0); }
  pos -= 170; return RGBW32(pos * 3, 0, 255 - pos * 3, 0);
}

// ---- Visual operations (ported from FX_fcn.cpp / FX_2Dfcn.cpp) ----

// fade_out: per-pixel fade toward background color (ported from FX_fcn.cpp)
// rate: 0 = no fade (max retention), 255 = instant fade (min retention)
function fade_out_1d(pixels, rate, bgColor) {
  if (rate === 0) return;
  // Match WLED C++ mapping: rate = (256-rate)>>1; mappedRate = rate + 1.1
  const r2 = (256 - rate) >> 1;
  const mappedRate = r2 + 1.1;
  const bgR = R(bgColor), bgG = G(bgColor), bgB = B(bgColor), bgW = W(bgColor);

  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    if (c === bgColor) continue;

    let cr = R(c), cg = G(c), cb = B(c), cw = W(c);
    if (cr === bgR && cg === bgG && cb === bgB && cw === bgW) continue;

    cr = (cr > bgR) ? Math.max(bgR, cr - Math.ceil((cr - bgR) / mappedRate)) : Math.min(bgR, cr + Math.ceil((bgR - cr) / mappedRate));
    cg = (cg > bgG) ? Math.max(bgG, cg - Math.ceil((cg - bgG) / mappedRate)) : Math.min(bgG, cg + Math.ceil((bgG - cg) / mappedRate));
    cb = (cb > bgB) ? Math.max(bgB, cb - Math.ceil((cb - bgB) / mappedRate)) : Math.min(bgB, cb + Math.ceil((bgB - cb) / mappedRate));
    cw = (cw > bgW) ? Math.max(bgW, cw - Math.ceil((cw - bgW) / mappedRate)) : Math.min(bgW, cw + Math.ceil((bgW - cw) / mappedRate));

    pixels[i] = RGBW32(cr, cg, cb, cw);
  }
}

function fade_out_2d(pixels2d, w, h, rate, bgColor) {
  for (let y = 0; y < h; y++) {
    fade_out_1d(pixels2d[y], rate, bgColor);
  }
}

// blur1d: FastLED blur with carryover
function blur1d(pixels, amount) {
  if (amount === 0 || pixels.length < 2) return;
  const keep = 255 - amount;
  const seep = amount >> 1;
  let carryR = 0, carryG = 0, carryB = 0, carryW = 0;

  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    const cr = R(c), cg = G(c), cb = B(c), cw = W(c);

    const newR = Math.floor(cr * keep / 256) + carryR;
    const newG = Math.floor(cg * keep / 256) + carryG;
    const newB = Math.floor(cb * keep / 256) + carryB;
    const newW = Math.floor(cw * keep / 256) + carryW;

    carryR = Math.floor(cr * seep / 256);
    carryG = Math.floor(cg * seep / 256);
    carryB = Math.floor(cb * seep / 256);
    carryW = Math.floor(cw * seep / 256);

    pixels[i] = RGBW32(
      Math.min(255, newR), Math.min(255, newG),
      Math.min(255, newB), Math.min(255, newW)
    );
  }
}

// blur2d: blur rows then columns
function blur2d(pixels2d, w, h, amountX, amountY) {
  // Blur all rows (X direction)
  for (let y = 0; y < h; y++) {
    blur1d(pixels2d[y], amountX);
  }
  // Blur all columns (Y direction)
  if (amountY === 0) return;
  const keep = 255 - amountY;
  const seep = amountY >> 1;
  for (let x = 0; x < w; x++) {
    let carryR = 0, carryG = 0, carryB = 0, carryW = 0;
    for (let y = 0; y < h; y++) {
      const c = pixels2d[y][x];
      const cr = R(c), cg = G(c), cb = B(c), cw = W(c);
      const newR = Math.floor(cr * keep / 256) + carryR;
      const newG = Math.floor(cg * keep / 256) + carryG;
      const newB = Math.floor(cb * keep / 256) + carryB;
      const newW = Math.floor(cw * keep / 256) + carryW;
      carryR = Math.floor(cr * seep / 256);
      carryG = Math.floor(cg * seep / 256);
      carryB = Math.floor(cb * seep / 256);
      carryW = Math.floor(cw * seep / 256);
      pixels2d[y][x] = RGBW32(
        Math.min(255, newR), Math.min(255, newG),
        Math.min(255, newB), Math.min(255, newW)
      );
    }
  }
}

// drawLine: Bresenham's algorithm (from FX_2Dfcn.cpp)
function drawLine(pixels2d, w, h, x0, y0, x1, y1, color) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    if (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) {
      pixels2d[y0][x0] = color;
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// drawCircle: Bresenham midpoint circle
function drawCircle(pixels2d, w, h, cx, cy, radius, color) {
  let x = -radius, y = 0, err = 2 - 2 * radius;
  while (x < 0) {
    _setPixel2d(pixels2d, w, h, cx - x, cy + y, color);
    _setPixel2d(pixels2d, w, h, cx - y, cy - x, color);
    _setPixel2d(pixels2d, w, h, cx + x, cy - y, color);
    _setPixel2d(pixels2d, w, h, cx + y, cy + x, color);
    const r = err;
    if (r <= y) err += ++y * 2 + 1;
    if (r > x || err > y) err += ++x * 2 + 1;
  }
}

// fillCircle: x^2 + y^2 <= r^2 test
function fillCircle(pixels2d, w, h, cx, cy, radius, color) {
  radius = Math.min(Math.abs(radius), Math.max(w, h)); // clamp to grid size
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        _setPixel2d(pixels2d, w, h, cx + dx, cy + dy, color);
      }
    }
  }
}

function _setPixel2d(pixels2d, w, h, x, y, color) {
  if (x >= 0 && x < w && y >= 0 && y < h) {
    pixels2d[y][x] = color;
  }
}

// move: 8-direction pixel shift (FX_2Dfcn.cpp:365-434)
function movePixels(pixels2d, w, h, dir, delta, wrap) {
  if (delta === 0) return;
  switch (dir) {
    case 0: _moveX(pixels2d, w, h, delta, wrap); break;       // right
    case 1: _moveX(pixels2d, w, h, -delta, wrap); break;      // left
    case 2: _moveY(pixels2d, w, h, -delta, wrap); break;      // up
    case 3: _moveY(pixels2d, w, h, delta, wrap); break;       // down
    case 4: _moveX(pixels2d, w, h, delta, wrap); _moveY(pixels2d, w, h, -delta, wrap); break;  // right-up
    case 5: _moveX(pixels2d, w, h, -delta, wrap); _moveY(pixels2d, w, h, -delta, wrap); break; // left-up
    case 6: _moveX(pixels2d, w, h, delta, wrap); _moveY(pixels2d, w, h, delta, wrap); break;   // right-down
    case 7: _moveX(pixels2d, w, h, -delta, wrap); _moveY(pixels2d, w, h, delta, wrap); break;  // left-down
  }
}

function _moveX(pixels2d, w, h, delta, wrap) {
  for (let y = 0; y < h; y++) {
    const row = pixels2d[y];
    if (delta > 0) {
      for (let x = w - 1; x >= delta; x--) row[x] = row[x - delta];
      for (let x = 0; x < delta; x++) row[x] = wrap ? row[w - delta + x] : 0;
    } else {
      const d = -delta;
      for (let x = 0; x < w - d; x++) row[x] = row[x + d];
      for (let x = w - d; x < w; x++) row[x] = wrap ? row[x - w + d] : 0;
    }
  }
}

function _moveY(pixels2d, w, h, delta, wrap) {
  if (delta > 0) {
    for (let y = h - 1; y >= delta; y--) {
      for (let x = 0; x < w; x++) pixels2d[y][x] = pixels2d[y - delta][x];
    }
    for (let y = 0; y < delta; y++) {
      for (let x = 0; x < w; x++) pixels2d[y][x] = wrap ? pixels2d[h - delta + y][x] : 0;
    }
  } else {
    const d = -delta;
    for (let y = 0; y < h - d; y++) {
      for (let x = 0; x < w; x++) pixels2d[y][x] = pixels2d[y + d][x];
    }
    for (let y = h - d; y < h; y++) {
      for (let x = 0; x < w; x++) pixels2d[y][x] = wrap ? pixels2d[y - h + d][x] : 0;
    }
  }
}

// drawCharacter: font rendering (from FX_2Dfcn.cpp drawCharacter)
function drawCharacter(pixels2d, matW, matH, chr, x, y, fontIdx, color) {
  const font = FONTS[fontIdx];
  if (!font) return;
  const fw = font.w, fh = font.h;
  const charCode = chr - 32;
  if (charCode < 0 || charCode >= 95) return;
  const baseOffset = charCode * fh;

  for (let row = 0; row < fh; row++) {
    const bits = font.data[baseOffset + row];
    for (let col = 0; col < fw; col++) {
      // Bits are MSB-first, shifted to align with font width
      if ((bits >> (7 - col)) & 1) {
        _setPixel2d(pixels2d, matW, matH, x + col, y + row, color);
      }
    }
  }
}

// ---- Extract bytecode from .wfx ArrayBuffer ----
export function extractBytecode(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  if (buf.length < WFX.HEADER_SIZE) throw new Error('WFX too short');
  if (buf[0] !== 0x57 || buf[1] !== 0x46 || buf[2] !== 0x58) throw new Error('Bad WFX magic');

  const flags = buf[4];
  const dataSize = buf[5] * 16;
  const bcLen = buf[6] | (buf[7] << 8);

  let metaEnd = WFX.HEADER_SIZE;
  while (metaEnd < buf.length && buf[metaEnd] !== 0) metaEnd++;
  const metadata = new TextDecoder().decode(buf.slice(WFX.HEADER_SIZE, metaEnd));
  metaEnd++;

  const bytecode = buf.slice(metaEnd, metaEnd + bcLen);
  return { bytecode, metadata, flags, dataSize, bcLen };
}

// ---- SimState: persistent state across frames ----
export function createState(opts = {}) {
  const len = opts.LEN || 30;
  const width = opts.WIDTH || len;
  const height = opts.HEIGHT || 1;
  const is2D = opts.is2D || false;

  const pixels1d = new Uint32Array(len);
  const pixels2d = [];
  for (let y = 0; y < height; y++) pixels2d.push(new Uint32Array(width));

  return {
    pixels1d,
    pixels2d,
    aux0: 0,
    aux1: 0,
    step: 0,
    call: 0,
    dataBuf: null,
    dataLen: 0,
    LEN: len,
    WIDTH: width,
    HEIGHT: height,
    is2D,
  };
}

// ---- SimEngine ----
export class SimEngine {
  constructor() {
    this.regs = new Int32Array(REG_COUNT);
  }

  /**
   * Execute one frame of bytecode.
   * @param {Uint8Array} bytecode
   * @param {object} state - persistent SimState (mutated in-place)
   * @param {object} opts - segment parameters
   * @returns {{ delay: number }}
   */
  executeFrame(bytecode, state, opts = {}) {
    const bc = bytecode;
    const len = bc.length;

    this.regs = new Int32Array(REG_COUNT);
    const regs = this.regs;
    let pc = 0;
    let cycles = 0;
    const callStack = new Uint16Array(CALL_STACK_DEPTH);
    let callDepth = 0;

    const seg = {
      speed:     opts.speed     ?? 128,
      intensity: opts.intensity ?? 128,
      custom1:   opts.custom1   ?? 0,
      custom2:   opts.custom2   ?? 0,
      custom3:   opts.custom3   ?? 0,
      check1:    opts.check1    ?? false,
      check2:    opts.check2    ?? false,
      check3:    opts.check3    ?? false,
      palette:   opts.palette   ?? 0,
      colors:    opts.colors    ?? [0x00FFFFFF, 0x00000000, 0x00000000],
      name:      opts.name      ?? '',
    };

    // Use persistent state
    const pixels = state.pixels1d;
    const w = state.WIDTH, h = state.HEIGHT;
    const pixels2d = state.pixels2d;
    let dataBuf = state.dataBuf;
    let dataLen = state.dataLen;

    // Get the palette object
    const palObj = PALETTES[seg.palette] || PALETTES[0];

    // Populate registers from persistent state and opts
    regs[REG.P0] = seg.speed;
    regs[REG.P1] = seg.intensity;
    regs[REG.P2] = seg.custom1;
    regs[REG.P3] = seg.custom2;
    regs[REG.LEN]    = state.LEN;
    regs[REG.NOW]    = i32(opts.NOW ?? 0);
    regs[REG.CALL]   = i32(state.call);
    regs[REG.WIDTH]  = w;
    regs[REG.HEIGHT] = h;

    // Seed RNG with NOW for variation each frame
    _rngState = (opts.NOW || 1) ^ 0x5DEECE66;

    // Float helpers
    const floatBuf = new ArrayBuffer(4);
    const floatView = new DataView(floatBuf);
    function getFloat(id) {
      floatView.setInt32(0, getReg(id), true);
      return floatView.getFloat32(0, true);
    }
    function setFloat(id, f) {
      floatView.setFloat32(0, f, true);
      setReg(id, floatView.getInt32(0, true));
    }

    // ---- Read helpers ----
    function readU8() { return (pc < len) ? bc[pc++] : 0; }
    function readI16() {
      if (pc + 2 > len) { pc = len; return 0; }
      const v = (bc[pc] | (bc[pc + 1] << 8)) << 16 >> 16;
      pc += 2; return v;
    }
    function readU16() {
      if (pc + 2 > len) { pc = len; return 0; }
      const v = bc[pc] | (bc[pc + 1] << 8);
      pc += 2; return v;
    }
    function readI32() {
      if (pc + 4 > len) { pc = len; return 0; }
      const v = bc[pc] | (bc[pc + 1] << 8) | (bc[pc + 2] << 16) | (bc[pc + 3] << 24);
      pc += 4; return v;
    }

    function getReg(id) { return (id < REG_COUNT) ? regs[id] : 0; }
    function setReg(id, v) {
      if (id < REG_COUNT && id < REG_P0) regs[id] = i32(v);
    }
    function getColor(id) { return u32(getReg(id)); }
    function setColor(id, c) { setReg(id, i32(u32(c))); }

    // beatsin8: time-dependent
    function _beatsin8(bpm, lo, hi) {
      const now = u32(opts.NOW ?? 0);
      const beat = (now * u8(bpm) * 256) / 60000;
      const v = sin8(Math.floor(beat) & 0xFF);
      return u8(lo + scale8(v, hi - lo));
    }

    // Palette color lookup
    function palette_color(idx) {
      return colorFromPalette(palObj, u8(idx), 255);
    }

    function palette_color_ex(idx, bri, blend) {
      return colorFromPalette(palObj, u8(idx), u8(bri));
    }

    // ---- Main loop ----
    while (pc < len) {
      if (++cycles > MAX_CYCLES) return finish(FRAMETIME);

      const op = bc[pc++];

      switch (op) {
        // ---- Arithmetic ----
        case OP.ADD: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, i32(u32(getReg(a)) + u32(getReg(b)))); } break;
        case OP.SUB: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, i32(u32(getReg(a)) - u32(getReg(b)))); } break;
        case OP.MUL: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, i32(Math.imul(getReg(a), getReg(b)))); } break;
        case OP.DIV: {
          const d = readU8(), a = readU8(), b = readU8();
          const av = getReg(a), bv = getReg(b);
          setReg(d, (bv !== 0 && !(av === INT32_MIN && bv === -1)) ? i32(Math.trunc(av / bv)) : 0);
        } break;
        case OP.MOD: {
          const d = readU8(), a = readU8(), b = readU8();
          const av = getReg(a), bv = getReg(b);
          setReg(d, (bv !== 0 && !(av === INT32_MIN && bv === -1)) ? i32(av % bv) : 0);
        } break;
        case OP.AND: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, getReg(a) & getReg(b)); } break;
        case OP.OR:  { const d = readU8(), a = readU8(), b = readU8(); setReg(d, getReg(a) | getReg(b)); } break;
        case OP.XOR: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, getReg(a) ^ getReg(b)); } break;
        case OP.SHL: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, i32(u32(getReg(a)) << (getReg(b) & 31))); } break;
        case OP.SHR: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, i32(u32(getReg(a)) >>> (getReg(b) & 31))); } break;
        case OP.NEG: { const d = readU8(), a = readU8(); const v = getReg(a); setReg(d, (v === INT32_MIN) ? INT32_MAX : -v); } break;
        case OP.NOT: { const d = readU8(), a = readU8(); setReg(d, ~getReg(a)); } break;

        // ---- Load/Store ----
        case OP.LDI:   { const d = readU8(); setReg(d, readI16()); } break;
        case OP.LDI32: { const d = readU8(); setReg(d, readI32()); } break;
        case OP.MOV:   { const d = readU8(), a = readU8(); setReg(d, getReg(a)); } break;
        case OP.LDB: {
          const d = readU8(), a = readU8(), off = readU8();
          const addr = u16(getReg(a)) + off;
          setReg(d, (dataBuf && addr < dataLen) ? dataBuf[addr] : 0);
        } break;
        case OP.STB: {
          const a = readU8(), d = readU8(), off = readU8();
          const addr = u16(getReg(a)) + off;
          if (dataBuf && addr < dataLen) dataBuf[addr] = u8(getReg(d));
        } break;
        case OP.LDW: {
          const d = readU8(), a = readU8(), off = readU8();
          const addr = u16(getReg(a)) + off;
          if (dataBuf && addr + 3 < dataLen) {
            setReg(d, dataBuf[addr] | (dataBuf[addr+1]<<8) | (dataBuf[addr+2]<<16) | (dataBuf[addr+3]<<24));
          } else { setReg(d, 0); }
        } break;
        case OP.STW: {
          const a = readU8(), d = readU8(), off = readU8();
          const addr = u16(getReg(a)) + off;
          if (dataBuf && addr + 3 < dataLen) {
            const v = getReg(d);
            dataBuf[addr] = v & 0xFF; dataBuf[addr+1] = (v >> 8) & 0xFF;
            dataBuf[addr+2] = (v >> 16) & 0xFF; dataBuf[addr+3] = (v >> 24) & 0xFF;
          }
        } break;

        // ---- Segment Parameters ----
        case OP.GSPD: { setReg(readU8(), seg.speed); } break;
        case OP.GINT: { setReg(readU8(), seg.intensity); } break;
        case OP.GC1:  { setReg(readU8(), seg.custom1); } break;
        case OP.GC2:  { setReg(readU8(), seg.custom2); } break;
        case OP.GC3:  { setReg(readU8(), seg.custom3); } break;
        case OP.GCHK: {
          const d = readU8(), n = readU8();
          const v = (n === 0) ? seg.check1 : (n === 1) ? seg.check2 : seg.check3;
          setReg(d, v ? 1 : 0);
        } break;
        case OP.GCOL: {
          const d = readU8(), n = readU8();
          setColor(d, seg.colors[n < 3 ? n : 0] || 0);
        } break;
        case OP.GPAL: { setReg(readU8(), seg.palette); } break;
        case OP.GAUX: {
          const d = readU8(), n = readU8();
          setReg(d, (n === 0) ? state.aux0 : state.aux1);
        } break;
        case OP.SAUX: {
          const n = readU8(), a = readU8();
          if (n === 0) state.aux0 = u16(getReg(a));
          else         state.aux1 = u16(getReg(a));
        } break;
        case OP.GSTP: { setReg(readU8(), i32(state.step)); } break;
        case OP.SSTP: { state.step = u32(getReg(readU8())); } break;

        // ---- Pixel Operations ----
        case OP.SPXC: {
          const a = readU8(), c = readU8();
          const idx = getReg(a);
          if (idx >= 0 && idx < state.LEN) {
            const col = getColor(c);
            pixels[idx] = col;
            // Mirror 1D write to 2D grid (like WLED's setPixelColor on 2D segments)
            if (state.is2D) {
              const px = idx % w, py = Math.floor(idx / w);
              if (py < h) pixels2d[py][px] = col;
            }
          }
        } break;
        case OP.GPXC: {
          const d = readU8(), a = readU8();
          const idx = getReg(a);
          if (idx >= 0 && idx < state.LEN) {
            // In 2D mode, read from the 2D grid (consistent with SPXC mirroring)
            if (state.is2D) {
              const px = idx % w, py = Math.floor(idx / w);
              setColor(d, (py < h) ? pixels2d[py][px] : 0);
            } else {
              setColor(d, pixels[idx]);
            }
          } else {
            setColor(d, 0);
          }
        } break;
        case OP.SPXY: {
          const a = readU8(), b = readU8(), c = readU8();
          const x = getReg(a), y = getReg(b);
          if (x >= 0 && x < w && y >= 0 && y < h) pixels2d[y][x] = getColor(c);
        } break;
        case OP.GPXY: {
          const d = readU8(), a = readU8(), b = readU8();
          const x = getReg(a), y = getReg(b);
          setColor(d, (x >= 0 && x < w && y >= 0 && y < h) ? pixels2d[y][x] : 0);
        } break;
        case OP.FILL: {
          const c = readU8();
          const color = getColor(c);
          pixels.fill(color);
          for (let y2 = 0; y2 < h; y2++) pixels2d[y2].fill(color);
        } break;
        case OP.FADE: {
          const a = readU8();
          const rate = u8(getReg(a));
          const bgColor = seg.colors[1] || 0;
          if (state.is2D) {
            fade_out_2d(pixels2d, w, h, rate, bgColor);
            // Sync pixels1d from pixels2d so 1D reads stay consistent
            for (let y2 = 0; y2 < h; y2++)
              for (let x2 = 0; x2 < w; x2++)
                pixels[y2 * w + x2] = pixels2d[y2][x2];
          } else {
            fade_out_1d(pixels, rate, bgColor);
          }
        } break;
        case OP.BLUR: {
          const a = readU8();
          const bv = u8(getReg(a));
          if (state.is2D) {
            // In 2D mode, blur the 2D grid (1D effects using blur on 2D)
            blur2d(pixels2d, w, h, bv, bv);
            for (let y2 = 0; y2 < h; y2++)
              for (let x2 = 0; x2 < w; x2++)
                pixels[y2 * w + x2] = pixels2d[y2][x2];
          } else {
            blur1d(pixels, bv);
          }
        } break;
        case OP.BLR2: {
          const a = readU8();
          const bv = u8(getReg(a));
          blur2d(pixels2d, w, h, bv, bv);
        } break;

        // ---- Color Operations ----
        case OP.RGB: {
          const d = readU8(), ra = readU8(), rb = readU8(), rc = readU8();
          setColor(d, RGBW32(u8(getReg(ra)), u8(getReg(rb)), u8(getReg(rc)), 0));
        } break;
        case OP.RGBW: {
          const d = readU8(), ra = readU8(), rb = readU8(), rc = readU8(), rd2 = readU8();
          setColor(d, RGBW32(u8(getReg(ra)), u8(getReg(rb)), u8(getReg(rc)), u8(getReg(rd2))));
        } break;
        case OP.CBLND: {
          const d = readU8(), ca = readU8(), cb = readU8(), ra = readU8();
          setColor(d, color_blend(getColor(ca), getColor(cb), u16(getReg(ra))));
        } break;
        case OP.CFADE: {
          const d = readU8(), ca = readU8(), ra = readU8();
          setColor(d, color_fade(getColor(ca), u8(getReg(ra))));
        } break;
        case OP.CADD: {
          const d = readU8(), ca = readU8(), cb = readU8();
          setColor(d, color_add(getColor(ca), getColor(cb)));
        } break;
        case OP.CPAL: {
          const d = readU8(), ra = readU8();
          setColor(d, palette_color(u16(getReg(ra))));
        } break;
        case OP.CPALX: {
          const d = readU8(), ra = readU8(), rb = readU8(), rc = readU8();
          setColor(d, palette_color_ex(u16(getReg(ra)), u8(getReg(rb)), u8(getReg(rc))));
        } break;
        case OP.CWHL: {
          const d = readU8(), ra = readU8();
          setColor(d, color_wheel(u8(getReg(ra))));
        } break;
        case OP.EXTR: { const d = readU8(), ca = readU8(); setReg(d, R(getColor(ca))); } break;
        case OP.EXTG: { const d = readU8(), ca = readU8(); setReg(d, G(getColor(ca))); } break;
        case OP.EXTB: { const d = readU8(), ca = readU8(); setReg(d, B(getColor(ca))); } break;
        case OP.EXTW: { const d = readU8(), ca = readU8(); setReg(d, W(getColor(ca))); } break;

        // ---- Math ----
        case OP.SIN8:  { const d = readU8(), a = readU8(); setReg(d, sin8(u8(getReg(a)))); } break;
        case OP.COS8:  { const d = readU8(), a = readU8(); setReg(d, cos8(u8(getReg(a)))); } break;
        case OP.SIN16: { const d = readU8(), a = readU8(); setReg(d, sin16(u16(getReg(a)))); } break;
        case OP.BEAT8: {
          const d = readU8(), a = readU8(), b = readU8(), c = readU8();
          setReg(d, _beatsin8(u8(getReg(a)), u8(getReg(b)), u8(getReg(c))));
        } break;
        case OP.TRI8:  { const d = readU8(), a = readU8(); setReg(d, triwave8(u8(getReg(a)))); } break;
        case OP.QAD8:  { const d = readU8(), a = readU8(); setReg(d, quadwave8(u8(getReg(a)))); } break;
        case OP.SCL8:  { const d = readU8(), a = readU8(), b = readU8(); setReg(d, scale8(u8(getReg(a)), u8(getReg(b)))); } break;
        case OP.QADD8: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, qadd8(u8(getReg(a)), u8(getReg(b)))); } break;
        case OP.QSUB8: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, qsub8(u8(getReg(a)), u8(getReg(b)))); } break;
        case OP.RND8:  { setReg(readU8(), random8()); } break;
        case OP.RND16: { setReg(readU8(), random16()); } break;
        case OP.RNDR:  { const d = readU8(), a = readU8(), b = readU8(); setReg(d, randomRange(u8(getReg(a)), u8(getReg(b)))); } break;
        case OP.NOISE: { const d = readU8(), a = readU8(); setReg(d, inoise8_1(u16(getReg(a)))); } break;
        case OP.NOI2:  { const d = readU8(), a = readU8(), b = readU8(); setReg(d, inoise8_2(u16(getReg(a)), u16(getReg(b)))); } break;
        case OP.NOI3:  { const d = readU8(), a = readU8(), b = readU8(), c = readU8(); setReg(d, inoise8_3(u16(getReg(a)), u16(getReg(b)), u16(getReg(c)))); } break;
        case OP.SQRT: {
          const d = readU8(), a = readU8();
          const v = getReg(a);
          setReg(d, v > 0 ? sqrt16(u16(v)) : 0);
        } break;
        case OP.ABS: {
          const d = readU8(), a = readU8();
          const v = getReg(a);
          setReg(d, (v === INT32_MIN) ? INT32_MAX : (v < 0 ? -v : v));
        } break;
        case OP.MIN: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, Math.min(getReg(a), getReg(b))); } break;
        case OP.MAX: { const d = readU8(), a = readU8(), b = readU8(); setReg(d, Math.max(getReg(a), getReg(b))); } break;

        // ---- Control Flow ----
        case OP.JMP: {
          const off = readI16();
          const t = pc + off;
          if (t < 0 || t > len) return finish(FRAMETIME);
          pc = t;
        } break;
        case OP.JZ: {
          const a = readU8(), off = readI16();
          if (getReg(a) === 0) { const t = pc + off; if (t < 0 || t > len) return finish(FRAMETIME); pc = t; }
        } break;
        case OP.JNZ: {
          const a = readU8(), off = readI16();
          if (getReg(a) !== 0) { const t = pc + off; if (t < 0 || t > len) return finish(FRAMETIME); pc = t; }
        } break;
        case OP.JLT: {
          const a = readU8(), b = readU8(), off = readI16();
          if (getReg(a) < getReg(b)) { const t = pc + off; if (t < 0 || t > len) return finish(FRAMETIME); pc = t; }
        } break;
        case OP.JGT: {
          const a = readU8(), b = readU8(), off = readI16();
          if (getReg(a) > getReg(b)) { const t = pc + off; if (t < 0 || t > len) return finish(FRAMETIME); pc = t; }
        } break;
        case OP.JEQ: {
          const a = readU8(), b = readU8(), off = readI16();
          if (getReg(a) === getReg(b)) { const t = pc + off; if (t < 0 || t > len) return finish(FRAMETIME); pc = t; }
        } break;
        case OP.JLE: {
          const a = readU8(), b = readU8(), off = readI16();
          if (getReg(a) <= getReg(b)) { const t = pc + off; if (t < 0 || t > len) return finish(FRAMETIME); pc = t; }
        } break;
        case OP.JGE: {
          const a = readU8(), b = readU8(), off = readI16();
          if (getReg(a) >= getReg(b)) { const t = pc + off; if (t < 0 || t > len) return finish(FRAMETIME); pc = t; }
        } break;
        case OP.CALL: {
          const off = readI16();
          if (callDepth >= CALL_STACK_DEPTH) return finish(FRAMETIME);
          callStack[callDepth++] = pc;
          const target = pc + off;
          if (target < 0 || target > len) return finish(FRAMETIME);
          pc = target;
        } break;
        case OP.RET: {
          if (callDepth > 0) pc = callStack[--callDepth];
          else return finish(FRAMETIME);
        } break;
        case OP.HALT: {
          const a = readU8();
          const delay = u16(getReg(a));
          return finish(delay > 0 ? delay : FRAMETIME);
        } break;
        case OP.HALTS: {
          // frame() with no args: compute delay from speed using SPEED_FORMULA_L
          // Higher speed = shorter delay = faster animation
          const spd = regs[REG.P0] & 0xFF;
          return finish(5 + Math.floor((50 * (255 - spd)) / 255));
        } break;

        // ---- Data Buffer ----
        case OP.ALLOC: {
          const a = readU8();
          const raw = getReg(a);
          const size = u16(raw > 0 ? Math.min(raw, 4096) : 0);
          if (size > 0 && !dataBuf) {
            dataBuf = new Uint8Array(size);
            dataLen = size;
            state.dataBuf = dataBuf;
            state.dataLen = dataLen;
            setReg(0, 1);
          } else if (dataBuf) {
            setReg(0, 1); // already allocated
          } else {
            setReg(0, 0);
          }
        } break;

        // ---- 2D Geometry ----
        case OP.DLINE: {
          const x0r = readU8(), y0r = readU8(), x1r = readU8(), y1r = readU8(), cr = readU8();
          drawLine(pixels2d, w, h, getReg(x0r), getReg(y0r), getReg(x1r), getReg(y1r), getColor(cr));
        } break;
        case OP.DCIRC: {
          const cxr = readU8(), cyr = readU8(), rr = readU8(), cr = readU8();
          drawCircle(pixels2d, w, h, getReg(cxr), getReg(cyr), getReg(rr), getColor(cr));
        } break;
        case OP.FCIRC: {
          const cxr = readU8(), cyr = readU8(), rr = readU8(), cr = readU8();
          fillCircle(pixels2d, w, h, getReg(cxr), getReg(cyr), getReg(rr), getColor(cr));
        } break;
        case OP.MOVEP: {
          const dr = readU8(), delta = readU8(), wrap = readU8();
          movePixels(pixels2d, w, h, u8(getReg(dr)), u8(getReg(delta)), !!getReg(wrap));
        } break;

        // ---- Text Operations ----
        case OP.DCHR: {
          const chr_r = readU8(), x_r = readU8(), y_r = readU8();
          const font_r = readU8(), col_r = readU8();
          const fi = Math.max(0, Math.min(4, getReg(font_r)));
          drawCharacter(pixels2d, w, h, getReg(chr_r), getReg(x_r), getReg(y_r), fi, getColor(col_r));
        } break;
        case OP.GCHR: {
          const d = readU8(), a = readU8();
          const idx = getReg(a);
          const name = seg.name || '';
          setReg(d, (idx >= 0 && idx < name.length) ? name.charCodeAt(idx) : 0);
        } break;
        case OP.GNLN: {
          const d = readU8();
          setReg(d, (seg.name || '').length);
        } break;
        case OP.GFNW: {
          const d = readU8(), a = readU8();
          const fw = [4, 5, 6, 7, 5];
          setReg(d, fw[Math.max(0, Math.min(4, getReg(a)))]);
        } break;
        case OP.GFNH: {
          const d = readU8(), a = readU8();
          const fh = [6, 8, 8, 9, 12];
          setReg(d, fh[Math.max(0, Math.min(4, getReg(a)))]);
        } break;

        // ---- Float Operations ----
        case OP.FADD: { const d = readU8(), a = readU8(), b = readU8(); setFloat(d, getFloat(a) + getFloat(b)); } break;
        case OP.FSUB: { const d = readU8(), a = readU8(), b = readU8(); setFloat(d, getFloat(a) - getFloat(b)); } break;
        case OP.FMUL: { const d = readU8(), a = readU8(), b = readU8(); setFloat(d, getFloat(a) * getFloat(b)); } break;
        case OP.FDIV: {
          const d = readU8(), a = readU8(), b = readU8();
          const bv = getFloat(b);
          setFloat(d, bv !== 0 ? getFloat(a) / bv : 0);
        } break;
        case OP.ITOF: { const d = readU8(), a = readU8(); setFloat(d, getReg(a)); } break;
        case OP.FTOI: {
          const d = readU8(), a = readU8();
          const fv = getFloat(a);
          if (isNaN(fv) || !isFinite(fv) || fv > INT32_MAX || fv < INT32_MIN) setReg(d, 0);
          else setReg(d, i32(Math.trunc(fv)));
        } break;
        case OP.FSIN: { const d = readU8(), a = readU8(); setFloat(d, Math.sin(getFloat(a))); } break;
        case OP.FCOS: { const d = readU8(), a = readU8(); setFloat(d, Math.cos(getFloat(a))); } break;

        // ---- Audio ----
        case OP.GVOL:  { setReg(readU8(), 0); } break;
        case OP.GPEAK: { setReg(readU8(), 0); } break;
        case OP.GFFT:  { const d = readU8(); readU8(); setReg(d, 0); } break;
        case OP.ABASS: { setReg(readU8(), 0); } break;
        case OP.AMID:  { setReg(readU8(), 0); } break;
        case OP.ATREB: { setReg(readU8(), 0); } break;

        case OP.NOP: break;

        default:
          return finish(FRAMETIME);
      }
    }

    return finish(FRAMETIME);

    function finish(delay) {
      state.call++;
      return { delay };
    }
  }
}
