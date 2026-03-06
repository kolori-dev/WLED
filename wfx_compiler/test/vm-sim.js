'use strict';

const { REG, OP, WFX } = require('../opcodes');

// ---- Constants matching wled_vm.h ----
const REG_COUNT = 0x25;
const REG_P0 = 0x1C;
const MAX_CYCLES = 50000;
const CALL_STACK_DEPTH = 16;
const FRAMETIME = 42; // WLED default ~24fps
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

// ---- 32-bit integer helpers ----
function i32(v) { return v | 0; }
function u32(v) { return v >>> 0; }
function u8(v) { return v & 0xFF; }
function u16(v) { return v & 0xFFFF; }

// ---- FastLED-compatible math ----

// sin8_t: 0-255 input, 0-255 output (half-wave sine scaled)
const SIN8_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  SIN8_TABLE[i] = Math.round(128 + 127 * Math.sin(i * 2 * Math.PI / 256));
}
function sin8(x) { return SIN8_TABLE[u8(x)]; }
function cos8(x) { return SIN8_TABLE[u8(x + 64)]; }

function sin16(x) {
  // sin16_t: uint16 → int16 (-32767..32767)
  return i32(Math.round(32767 * Math.sin(u16(x) * 2 * Math.PI / 65536)));
}

function triwave8(x) {
  const v = u8(x);
  return v < 128 ? v * 2 : (255 - v) * 2;
}

function quadwave8(x) {
  return sin8(triwave8(x));
}

function scale8(a, b) {
  return u8(Math.floor((u8(a) * u8(b)) / 256));
}

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

// Simple seeded PRNG (xorshift32) for deterministic tests
let _rngState = 12345;
function seedRng(s) { _rngState = s || 12345; }
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

// Noise: deterministic dummy (exact Perlin not needed)
function inoise8_1(x) { return u8((x * 37 + 97) ^ (x >> 3)); }
function inoise8_2(x, y) { return u8(inoise8_1(x) ^ inoise8_1(y + 53)); }
function inoise8_3(x, y, z) { return u8(inoise8_2(x, y) ^ inoise8_1(z + 127)); }

// beatsin8: simplified — returns sin8(bpm * now / 1000 + phase) scaled between lo and hi
// For tests we simplify: just return sin8(bpm) scaled to lo..hi
function beatsin8(bpm, lo, hi) {
  const v = sin8(u8(bpm));
  return u8(lo + scale8(v, hi - lo));
}

// ---- Color helpers (matching WLED color.cpp) ----
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

function color_blend(a, b, ratio) {
  const r = u16(ratio);
  const mix = (va, vb) => Math.floor((va * (256 - r) + vb * r) / 256);
  return RGBW32(mix(R(a), R(b)), mix(G(a), G(b)), mix(B(a), B(b)), mix(W(a), W(b)));
}

// Standard rainbow color wheel (matching WLED)
function color_wheel(pos) {
  pos = u8(pos);
  if (pos < 85) return RGBW32(255 - pos * 3, pos * 3, 0, 0);
  if (pos < 170) { pos -= 85; return RGBW32(0, 255 - pos * 3, pos * 3, 0); }
  pos -= 170; return RGBW32(pos * 3, 0, 255 - pos * 3, 0);
}

// palette: identity map for testing — returns color_wheel(idx & 0xFF)
function palette_color(idx) {
  return color_wheel(u8(idx));
}

// ---- Extract bytecode from .wfx buffer ----
function extractBytecode(wfxBuf) {
  const buf = Buffer.from(wfxBuf);
  if (buf.length < WFX.HEADER_SIZE) throw new Error('WFX too short');
  if (buf[0] !== 0x57 || buf[1] !== 0x46 || buf[2] !== 0x58) throw new Error('Bad WFX magic');

  const flags = buf[4];
  const dataSize = buf[5] * 16;
  const bcLen = buf[6] | (buf[7] << 8);

  // Find end of null-terminated metadata string
  let metaEnd = WFX.HEADER_SIZE;
  while (metaEnd < buf.length && buf[metaEnd] !== 0) metaEnd++;
  metaEnd++; // skip null terminator

  const bytecode = buf.slice(metaEnd, metaEnd + bcLen);
  const metadata = buf.slice(WFX.HEADER_SIZE, metaEnd - 1).toString('utf8');

  return { bytecode, metadata, flags, dataSize, bcLen };
}

// ---- VM Simulator ----
class WledVMSim {
  constructor() {
    this.regs = new Int32Array(REG_COUNT);
  }

  /**
   * Execute bytecode for one frame.
   * @param {Uint8Array|Buffer} bytecode
   * @param {object} opts - segment state and mock config
   * @returns {{ delay: number, regs: Int32Array, pixels: Uint32Array, pixels2d: Uint32Array[][], seg: object }}
   */
  execute(bytecode, opts = {}) {
    const bc = Uint8Array.from(bytecode);
    const len = bc.length;

    // Reset
    this.regs = new Int32Array(REG_COUNT);
    const regs = this.regs;
    let pc = 0;
    let cycles = 0;
    const callStack = new Uint16Array(CALL_STACK_DEPTH);
    let callDepth = 0;

    // Segment state
    const seg = {
      speed:     opts.speed     ?? 128,
      intensity: opts.intensity ?? 128,
      custom1:   opts.custom1   ?? 0,
      custom2:   opts.custom2   ?? 0,
      custom3:   opts.custom3   ?? 0,
      check1: opts.check1 ?? false,
      check2: opts.check2 ?? false,
      check3: opts.check3 ?? false,
      palette:   opts.palette   ?? 0,
      aux0:      opts.aux0      ?? 0,
      aux1:      opts.aux1      ?? 0,
      step:      opts.step      ?? 0,
      colors:    opts.colors    ?? [0xFFFFFF, 0x000000, 0x000000],
      LEN:       opts.LEN       ?? 30,
      NOW:       opts.NOW       ?? 1000,
      CALL:      opts.CALL      ?? 0,
      WIDTH:     opts.WIDTH     ?? (opts.LEN ?? 30),
      HEIGHT:    opts.HEIGHT    ?? 1,
    };

    // Populate registers
    regs[REG.P0] = seg.speed;
    regs[REG.P1] = seg.intensity;
    regs[REG.P2] = seg.custom1;
    regs[REG.P3] = seg.custom2;
    regs[REG.LEN]    = seg.LEN;
    regs[REG.NOW]    = i32(seg.NOW);
    regs[REG.CALL]   = i32(seg.CALL);
    regs[REG.WIDTH]  = seg.WIDTH;
    regs[REG.HEIGHT] = seg.HEIGHT;

    // Pixel buffers
    const pixels = new Uint32Array(seg.LEN);
    const w = seg.WIDTH, h = seg.HEIGHT;
    const pixels2d = [];
    for (let y = 0; y < h; y++) pixels2d.push(new Uint32Array(w));

    // Data buffer
    let dataBuf = null;
    let dataLen = 0;
    if (opts.dataSize && opts.dataSize > 0) {
      dataBuf = new Uint8Array(opts.dataSize);
      dataLen = opts.dataSize;
    }

    // Audio (optional)
    const audio = opts.audio ?? null; // { volume: float, peak: uint8, fft: Uint8Array(16) }

    // Seed RNG for determinism
    seedRng(opts.rngSeed ?? 12345);

    // ---- Read helpers (match C++ exactly) ----
    function readU8() {
      return (pc < len) ? bc[pc++] : 0;
    }
    function readI16() {
      if (pc + 2 > len) { pc = len; return 0; }
      const v = (bc[pc] | (bc[pc + 1] << 8)) << 16 >> 16; // sign-extend
      pc += 2;
      return v;
    }
    function readU16() {
      if (pc + 2 > len) { pc = len; return 0; }
      const v = bc[pc] | (bc[pc + 1] << 8);
      pc += 2;
      return v;
    }
    function readI32() {
      if (pc + 4 > len) { pc = len; return 0; }
      const v = bc[pc] | (bc[pc + 1] << 8) | (bc[pc + 2] << 16) | (bc[pc + 3] << 24);
      pc += 4;
      return v;
    }

    function getReg(id) { return (id < REG_COUNT) ? regs[id] : 0; }
    function setReg(id, v) {
      if (id < REG_COUNT && id < REG_P0) regs[id] = i32(v);
    }

    // Float helpers (reinterpret via DataView)
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

    function getColor(id) { return u32(getReg(id)); }
    function setColor(id, c) { setReg(id, i32(u32(c))); }

    // ---- Main execution loop ----
    while (pc < len) {
      if (++cycles > MAX_CYCLES) return result(FRAMETIME);

      const op = bc[pc++];

      switch (op) {
        // ---- Arithmetic ----
        case OP.ADD: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, i32(u32(getReg(a)) + u32(getReg(b))));
        } break;
        case OP.SUB: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, i32(u32(getReg(a)) - u32(getReg(b))));
        } break;
        case OP.MUL: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, i32(Math.imul(getReg(a), getReg(b))));
        } break;
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
        case OP.AND: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, getReg(a) & getReg(b));
        } break;
        case OP.OR: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, getReg(a) | getReg(b));
        } break;
        case OP.XOR: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, getReg(a) ^ getReg(b));
        } break;
        case OP.SHL: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, i32(u32(getReg(a)) << (getReg(b) & 31)));
        } break;
        case OP.SHR: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, i32(u32(getReg(a)) >>> (getReg(b) & 31)));
        } break;
        case OP.NEG: {
          const d = readU8(), a = readU8();
          const v = getReg(a);
          setReg(d, (v === INT32_MIN) ? INT32_MAX : -v);
        } break;
        case OP.NOT: {
          const d = readU8(), a = readU8();
          setReg(d, ~getReg(a));
        } break;

        // ---- Load/Store ----
        case OP.LDI: {
          const d = readU8();
          const imm = readI16();
          setReg(d, imm);
        } break;
        case OP.LDI32: {
          const d = readU8();
          const imm = readI32();
          setReg(d, imm);
        } break;
        case OP.MOV: {
          const d = readU8(), a = readU8();
          setReg(d, getReg(a));
        } break;
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
            const v = dataBuf[addr] | (dataBuf[addr+1]<<8) | (dataBuf[addr+2]<<16) | (dataBuf[addr+3]<<24);
            setReg(d, v);
          } else {
            setReg(d, 0);
          }
        } break;
        case OP.STW: {
          const a = readU8(), d = readU8(), off = readU8();
          const addr = u16(getReg(a)) + off;
          if (dataBuf && addr + 3 < dataLen) {
            const v = getReg(d);
            dataBuf[addr]   = v & 0xFF;
            dataBuf[addr+1] = (v >> 8) & 0xFF;
            dataBuf[addr+2] = (v >> 16) & 0xFF;
            dataBuf[addr+3] = (v >> 24) & 0xFF;
          }
        } break;

        // ---- Segment Parameter Access ----
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
          setReg(d, (n === 0) ? seg.aux0 : seg.aux1);
        } break;
        case OP.SAUX: {
          const n = readU8(), a = readU8();
          if (n === 0) seg.aux0 = u16(getReg(a));
          else         seg.aux1 = u16(getReg(a));
        } break;
        case OP.GSTP: { setReg(readU8(), i32(seg.step)); } break;
        case OP.SSTP: { seg.step = u32(getReg(readU8())); } break;

        // ---- Pixel Operations ----
        case OP.SPXC: {
          const a = readU8(), c = readU8();
          const idx = getReg(a);
          if (idx >= 0 && idx < seg.LEN) pixels[idx] = getColor(c);
        } break;
        case OP.GPXC: {
          const d = readU8(), a = readU8();
          const idx = getReg(a);
          setColor(d, (idx >= 0 && idx < seg.LEN) ? pixels[idx] : 0);
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
        case OP.FADE: { readU8(); /* simplified: no-op in sim */ } break;
        case OP.BLUR: { readU8(); /* simplified: no-op in sim */ } break;
        case OP.BLR2: { readU8(); /* simplified: no-op in sim */ } break;

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
          setColor(d, palette_color(u16(getReg(ra))));
        } break;
        case OP.CWHL: {
          const d = readU8(), ra = readU8();
          setColor(d, color_wheel(u8(getReg(ra))));
        } break;
        case OP.EXTR: {
          const d = readU8(), ca = readU8();
          setReg(d, R(getColor(ca)));
        } break;
        case OP.EXTG: {
          const d = readU8(), ca = readU8();
          setReg(d, G(getColor(ca)));
        } break;
        case OP.EXTB: {
          const d = readU8(), ca = readU8();
          setReg(d, B(getColor(ca)));
        } break;
        case OP.EXTW: {
          const d = readU8(), ca = readU8();
          setReg(d, W(getColor(ca)));
        } break;

        // ---- Math ----
        case OP.SIN8: {
          const d = readU8(), a = readU8();
          setReg(d, sin8(u8(getReg(a))));
        } break;
        case OP.COS8: {
          const d = readU8(), a = readU8();
          setReg(d, cos8(u8(getReg(a))));
        } break;
        case OP.SIN16: {
          const d = readU8(), a = readU8();
          setReg(d, sin16(u16(getReg(a))));
        } break;
        case OP.BEAT8: {
          const d = readU8(), a = readU8(), b = readU8(), c = readU8();
          setReg(d, beatsin8(u8(getReg(a)), u8(getReg(b)), u8(getReg(c))));
        } break;
        case OP.TRI8: {
          const d = readU8(), a = readU8();
          setReg(d, triwave8(u8(getReg(a))));
        } break;
        case OP.QAD8: {
          const d = readU8(), a = readU8();
          setReg(d, quadwave8(u8(getReg(a))));
        } break;
        case OP.SCL8: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, scale8(u8(getReg(a)), u8(getReg(b))));
        } break;
        case OP.QADD8: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, qadd8(u8(getReg(a)), u8(getReg(b))));
        } break;
        case OP.QSUB8: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, qsub8(u8(getReg(a)), u8(getReg(b))));
        } break;
        case OP.RND8: {
          const d = readU8();
          setReg(d, random8());
        } break;
        case OP.RND16: {
          const d = readU8();
          setReg(d, random16());
        } break;
        case OP.RNDR: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, randomRange(u8(getReg(a)), u8(getReg(b))));
        } break;
        case OP.NOISE: {
          const d = readU8(), a = readU8();
          setReg(d, inoise8_1(u16(getReg(a))));
        } break;
        case OP.NOI2: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, inoise8_2(u16(getReg(a)), u16(getReg(b))));
        } break;
        case OP.NOI3: {
          const d = readU8(), a = readU8(), b = readU8(), c = readU8();
          setReg(d, inoise8_3(u16(getReg(a)), u16(getReg(b)), u16(getReg(c))));
        } break;
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
        case OP.MIN: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, Math.min(getReg(a), getReg(b)));
        } break;
        case OP.MAX: {
          const d = readU8(), a = readU8(), b = readU8();
          setReg(d, Math.max(getReg(a), getReg(b)));
        } break;

        // ---- Control Flow ----
        case OP.JMP: {
          const off = readI16();
          const t = pc + off;
          if (t < 0 || t > len) return result(FRAMETIME);
          pc = t;
        } break;
        case OP.JZ: {
          const a = readU8(), off = readI16();
          if (getReg(a) === 0) {
            const t = pc + off;
            if (t < 0 || t > len) return result(FRAMETIME);
            pc = t;
          }
        } break;
        case OP.JNZ: {
          const a = readU8(), off = readI16();
          if (getReg(a) !== 0) {
            const t = pc + off;
            if (t < 0 || t > len) return result(FRAMETIME);
            pc = t;
          }
        } break;
        case OP.JLT: {
          const a = readU8(), b = readU8(), off = readI16();
          if (getReg(a) < getReg(b)) {
            const t = pc + off;
            if (t < 0 || t > len) return result(FRAMETIME);
            pc = t;
          }
        } break;
        case OP.JGT: {
          const a = readU8(), b = readU8(), off = readI16();
          if (getReg(a) > getReg(b)) {
            const t = pc + off;
            if (t < 0 || t > len) return result(FRAMETIME);
            pc = t;
          }
        } break;
        case OP.JEQ: {
          const a = readU8(), b = readU8(), off = readI16();
          if (getReg(a) === getReg(b)) {
            const t = pc + off;
            if (t < 0 || t > len) return result(FRAMETIME);
            pc = t;
          }
        } break;
        case OP.JLE: {
          const a = readU8(), b = readU8(), off = readI16();
          if (getReg(a) <= getReg(b)) {
            const t = pc + off;
            if (t < 0 || t > len) return result(FRAMETIME);
            pc = t;
          }
        } break;
        case OP.JGE: {
          const a = readU8(), b = readU8(), off = readI16();
          if (getReg(a) >= getReg(b)) {
            const t = pc + off;
            if (t < 0 || t > len) return result(FRAMETIME);
            pc = t;
          }
        } break;
        case OP.CALL: {
          const off = readI16();
          if (callDepth >= CALL_STACK_DEPTH) return result(FRAMETIME);
          callStack[callDepth++] = pc;
          const target = pc + off;
          if (target < 0 || target > len) return result(FRAMETIME);
          pc = target;
        } break;
        case OP.RET: {
          if (callDepth > 0) {
            pc = callStack[--callDepth];
          } else {
            return result(FRAMETIME);
          }
        } break;
        case OP.HALT: {
          const a = readU8();
          const delay = u16(getReg(a));
          return result(delay > 0 ? delay : FRAMETIME);
        } break;

        // ---- Data Buffer ----
        case OP.ALLOC: {
          const a = readU8();
          const raw = getReg(a);
          const size = u16(raw > 0 ? Math.min(raw, 4096) : 0);
          if (size > 0) {
            dataBuf = new Uint8Array(size);
            dataLen = size;
            setReg(0, 1); // r0 = success
          } else {
            setReg(0, 0);
          }
        } break;

        // ---- 2D Geometry (simplified mocks) ----
        case OP.DLINE: { readU8(); readU8(); readU8(); readU8(); readU8(); } break;
        case OP.DCIRC: { readU8(); readU8(); readU8(); readU8(); } break;
        case OP.FCIRC: { readU8(); readU8(); readU8(); readU8(); } break;
        case OP.MOVEP: { readU8(); readU8(); readU8(); } break;

        // ---- Float Operations ----
        case OP.FADD: {
          const d = readU8(), a = readU8(), b = readU8();
          setFloat(d, getFloat(a) + getFloat(b));
        } break;
        case OP.FSUB: {
          const d = readU8(), a = readU8(), b = readU8();
          setFloat(d, getFloat(a) - getFloat(b));
        } break;
        case OP.FMUL: {
          const d = readU8(), a = readU8(), b = readU8();
          setFloat(d, getFloat(a) * getFloat(b));
        } break;
        case OP.FDIV: {
          const d = readU8(), a = readU8(), b = readU8();
          const bv = getFloat(b);
          setFloat(d, bv !== 0 ? getFloat(a) / bv : 0);
        } break;
        case OP.ITOF: {
          const d = readU8(), a = readU8();
          setFloat(d, getReg(a));
        } break;
        case OP.FTOI: {
          const d = readU8(), a = readU8();
          const fv = getFloat(a);
          if (isNaN(fv) || !isFinite(fv) || fv > INT32_MAX || fv < INT32_MIN) setReg(d, 0);
          else setReg(d, i32(Math.trunc(fv)));
        } break;
        case OP.FSIN: {
          const d = readU8(), a = readU8();
          setFloat(d, Math.sin(getFloat(a)));
        } break;
        case OP.FCOS: {
          const d = readU8(), a = readU8();
          setFloat(d, Math.cos(getFloat(a)));
        } break;

        // ---- Audio-reactive ----
        case OP.GVOL: {
          const d = readU8();
          setReg(d, audio ? i32(audio.volume) : 0);
        } break;
        case OP.GPEAK: {
          const d = readU8();
          setReg(d, audio ? i32(audio.peak) : 0);
        } break;
        case OP.GFFT: {
          const d = readU8(), a = readU8();
          const bin = u8(getReg(a)) & 0x0F;
          setReg(d, (audio && audio.fft) ? i32(audio.fft[bin]) : 0);
        } break;
        case OP.ABASS: {
          const d = readU8();
          if (audio && audio.fft) {
            setReg(d, i32((audio.fft[0] + audio.fft[1] + audio.fft[2] + audio.fft[3]) / 4));
          } else {
            setReg(d, 0);
          }
        } break;
        case OP.AMID: {
          const d = readU8();
          if (audio && audio.fft) {
            setReg(d, i32((audio.fft[4] + audio.fft[5] + audio.fft[6] + audio.fft[7]) / 4));
          } else {
            setReg(d, 0);
          }
        } break;
        case OP.ATREB: {
          const d = readU8();
          if (audio && audio.fft) {
            let sum = 0;
            for (let b = 8; b < 16; b++) sum += audio.fft[b];
            setReg(d, i32(Math.floor(sum / 8)));
          } else {
            setReg(d, 0);
          }
        } break;

        case OP.NOP: break;

        default:
          // Unknown opcode: halt
          return result(FRAMETIME);
      }
    }

    // Fell off end of bytecode
    return result(FRAMETIME);

    function result(delay) {
      return { delay, regs, pixels, pixels2d, seg, dataBuf, dataLen };
    }
  }
}

module.exports = {
  WledVMSim,
  extractBytecode,
  // Exported for direct testing
  sin8, cos8, sin16, triwave8, quadwave8, scale8, qadd8, qsub8,
  RGBW32, R, G, B, W, color_fade, color_add, color_blend, color_wheel,
  FRAMETIME,
};
