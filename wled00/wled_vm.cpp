/*
 * WLED-Lang Bytecode VM — Interpreter
 * Register-based VM executing .wfx bytecode for LED effects.
 */

#include "wled.h"
#include "wled_vm.h"
#include "FX.h"
#include "FastLED.h"

// Palette blend macros (also defined in FX.cpp)
#define PALETTE_SOLID_WRAP (strip.paletteBlend == 1 || strip.paletteBlend == 3)

WledVM::WledVM() : callDepth(0), pc(0), cycles(0), bcLen(0) {
  memset(regs, 0, sizeof(regs));
  memset(callStack, 0, sizeof(callStack));
}

uint16_t WledVM::execute(const uint8_t* bc, uint16_t len, Segment& seg,
                         float* vol, uint8_t* fft, uint8_t* peak) {
  // Reset state
  pc = 0;
  bcLen = len;
  cycles = 0;
  callDepth = 0;
  memset(regs, 0, sizeof(regs));

  // Store audio pointers (null if unavailable)
  _audioVol = vol;
  _audioFFT = fft;
  _audioPeak = peak;

  // Auto-populate parameter registers
  regs[REG_P0] = seg.speed;
  regs[REG_P1] = seg.intensity;
  regs[REG_P2] = seg.custom1;
  regs[REG_P3] = seg.custom2;
  regs[REG_LEN]    = seg.virtualLength();
  regs[REG_NOW]    = (int32_t)strip.now;
  regs[REG_CALL]   = (int32_t)seg.call;
  regs[REG_WIDTH]  = seg.virtualWidth();
  regs[REG_HEIGHT] = seg.virtualHeight();

  byte* dataBuf = seg.data;
  uint16_t dataLen = seg.dataSize();
  uint16_t nameLen = seg.name ? (uint16_t)strlen(seg.name) : 0;

  while (pc < len) {
    if (++cycles > VM_MAX_CYCLES_PER_FRAME) {
      return FRAMETIME; // safety: prevent infinite loops
    }

    uint8_t op = bc[pc++];

    switch (op) {

    // ---- Arithmetic ----
    case OP_ADD: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, (int32_t)((uint32_t)getReg(a) + (uint32_t)getReg(b)));
    } break;
    case OP_SUB: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, (int32_t)((uint32_t)getReg(a) - (uint32_t)getReg(b)));
    } break;
    case OP_MUL: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, (int32_t)((uint32_t)getReg(a) * (uint32_t)getReg(b)));
    } break;
    case OP_DIV: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      int32_t av = getReg(a), bv = getReg(b);
      setReg(d, (bv != 0 && !(av == INT32_MIN && bv == -1)) ? av / bv : 0);
    } break;
    case OP_MOD: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      int32_t av = getReg(a), bv = getReg(b);
      setReg(d, (bv != 0 && !(av == INT32_MIN && bv == -1)) ? av % bv : 0);
    } break;
    case OP_AND: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, getReg(a) & getReg(b));
    } break;
    case OP_OR: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, getReg(a) | getReg(b));
    } break;
    case OP_XOR: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, getReg(a) ^ getReg(b));
    } break;
    case OP_SHL: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, (int32_t)((uint32_t)getReg(a) << (getReg(b) & 31)));
    } break;
    case OP_SHR: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, (int32_t)((uint32_t)getReg(a) >> (getReg(b) & 31)));
    } break;
    case OP_NEG: {
      uint8_t d = readU8(bc), a = readU8(bc);
      int32_t v = getReg(a);
      setReg(d, (v == INT32_MIN) ? INT32_MAX : -v);
    } break;
    case OP_NOT: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setReg(d, ~getReg(a));
    } break;

    // ---- Load/Store ----
    case OP_LDI: {
      uint8_t d = readU8(bc);
      int16_t imm = readI16(bc);
      setReg(d, (int32_t)imm); // sign-extend
    } break;
    case OP_LDI32: {
      uint8_t d = readU8(bc);
      int32_t imm = readI32(bc);
      setReg(d, imm);
    } break;
    case OP_MOV: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setReg(d, getReg(a));
    } break;
    case OP_LDB: {
      uint8_t d = readU8(bc), a = readU8(bc), off = readU8(bc);
      uint16_t addr = (uint16_t)getReg(a) + off;
      setReg(d, (dataBuf && addr < dataLen) ? dataBuf[addr] : 0);
    } break;
    case OP_STB: {
      uint8_t a = readU8(bc), d = readU8(bc), off = readU8(bc);
      uint16_t addr = (uint16_t)getReg(a) + off;
      if (dataBuf && addr < dataLen) dataBuf[addr] = (uint8_t)(getReg(d) & 0xFF);
    } break;
    case OP_LDW: {
      uint8_t d = readU8(bc), a = readU8(bc), off = readU8(bc);
      uint16_t addr = (uint16_t)getReg(a) + off;
      if (dataBuf && addr + 3 < dataLen) {
        int32_t v = dataBuf[addr] | (dataBuf[addr+1]<<8) | (dataBuf[addr+2]<<16) | (dataBuf[addr+3]<<24);
        setReg(d, v);
      } else {
        setReg(d, 0);
      }
    } break;
    case OP_STW: {
      uint8_t a = readU8(bc), d = readU8(bc), off = readU8(bc);
      uint16_t addr = (uint16_t)getReg(a) + off;
      if (dataBuf && addr + 3 < dataLen) {
        int32_t v = getReg(d);
        dataBuf[addr]   = v & 0xFF;
        dataBuf[addr+1] = (v >> 8) & 0xFF;
        dataBuf[addr+2] = (v >> 16) & 0xFF;
        dataBuf[addr+3] = (v >> 24) & 0xFF;
      }
    } break;

    // ---- Segment Parameter Access ----
    case OP_GSPD: { setReg(readU8(bc), seg.speed); } break;
    case OP_GINT: { setReg(readU8(bc), seg.intensity); } break;
    case OP_GC1:  { setReg(readU8(bc), seg.custom1); } break;
    case OP_GC2:  { setReg(readU8(bc), seg.custom2); } break;
    case OP_GC3:  { setReg(readU8(bc), seg.custom3); } break;
    case OP_GCHK: {
      uint8_t d = readU8(bc), n = readU8(bc);
      bool v = (n == 0) ? seg.check1 : (n == 1) ? seg.check2 : seg.check3;
      setReg(d, v ? 1 : 0);
    } break;
    case OP_GCOL: {
      uint8_t d = readU8(bc), n = readU8(bc);
      setColor(d, Segment::getCurrentColor(n < 3 ? n : 0));
    } break;
    case OP_GPAL: { setReg(readU8(bc), seg.palette); } break;
    case OP_GAUX: {
      uint8_t d = readU8(bc), n = readU8(bc);
      setReg(d, (n == 0) ? seg.aux0 : seg.aux1);
    } break;
    case OP_SAUX: {
      uint8_t n = readU8(bc), a = readU8(bc);
      if (n == 0) seg.aux0 = (uint16_t)getReg(a);
      else        seg.aux1 = (uint16_t)getReg(a);
    } break;
    case OP_GSTP: { setReg(readU8(bc), (int32_t)seg.step); } break;
    case OP_SSTP: { seg.step = (uint32_t)getReg(readU8(bc)); } break;

    // ---- Pixel Operations ----
    case OP_SPXC: {
      uint8_t a = readU8(bc), c = readU8(bc);
      seg.setPixelColor((int)getReg(a), (uint32_t)getColor(c));
    } break;
    case OP_GPXC: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setColor(d, seg.getPixelColor((int)getReg(a)));
    } break;
#ifndef WLED_DISABLE_2D
    case OP_SPXY: {
      uint8_t a = readU8(bc), b = readU8(bc), c = readU8(bc);
      seg.setPixelColorXY((int)getReg(a), (int)getReg(b), (uint32_t)getColor(c));
    } break;
    case OP_GPXY: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setColor(d, seg.getPixelColorXY((int)getReg(a), (int)getReg(b)));
    } break;
#else
    case OP_SPXY: { readU8(bc); readU8(bc); readU8(bc); } break; // skip operands
    case OP_GPXY: { readU8(bc); readU8(bc); readU8(bc); } break;
#endif
    case OP_FILL: {
      uint8_t c = readU8(bc);
      seg.fill((uint32_t)getColor(c));
    } break;
    case OP_FADE: {
      uint8_t a = readU8(bc);
      seg.fade_out((uint8_t)getReg(a));
    } break;
    case OP_BLUR: {
      uint8_t a = readU8(bc);
      seg.blur((uint8_t)getReg(a));
    } break;
#ifndef WLED_DISABLE_2D
    case OP_BLR2: {
      uint8_t a = readU8(bc);
      uint8_t bv = (uint8_t)getReg(a);
      seg.blur2D(bv, bv);
    } break;
#else
    case OP_BLR2: { readU8(bc); } break;
#endif

    // ---- Color Operations ----
    case OP_RGB: {
      uint8_t d = readU8(bc), ra = readU8(bc), rb = readU8(bc), rc = readU8(bc);
      setColor(d, RGBW32((uint8_t)getReg(ra), (uint8_t)getReg(rb), (uint8_t)getReg(rc), 0));
    } break;
    case OP_RGBW: {
      uint8_t d = readU8(bc), ra = readU8(bc), rb = readU8(bc), rc = readU8(bc), rd2 = readU8(bc);
      setColor(d, RGBW32((uint8_t)getReg(ra), (uint8_t)getReg(rb), (uint8_t)getReg(rc), (uint8_t)getReg(rd2)));
    } break;
    case OP_CBLND: {
      uint8_t d = readU8(bc), ca = readU8(bc), cb = readU8(bc), ra = readU8(bc);
      setColor(d, color_blend(getColor(ca), getColor(cb), (uint16_t)getReg(ra)));
    } break;
    case OP_CFADE: {
      uint8_t d = readU8(bc), ca = readU8(bc), ra = readU8(bc);
      setColor(d, color_fade(getColor(ca), (uint8_t)getReg(ra)));
    } break;
    case OP_CADD: {
      uint8_t d = readU8(bc), ca = readU8(bc), cb = readU8(bc);
      setColor(d, color_add(getColor(ca), getColor(cb)));
    } break;
    case OP_CPAL: {
      uint8_t d = readU8(bc), ra = readU8(bc);
      setColor(d, seg.color_from_palette((uint16_t)getReg(ra), true, PALETTE_SOLID_WRAP, 0));
    } break;
    case OP_CPALX: {
      uint8_t d = readU8(bc), ra = readU8(bc), rb = readU8(bc), rc = readU8(bc);
      setColor(d, seg.color_from_palette((uint16_t)getReg(ra), (bool)getReg(rb), (uint8_t)getReg(rc), 0));
    } break;
    case OP_CWHL: {
      uint8_t d = readU8(bc), ra = readU8(bc);
      setColor(d, seg.color_wheel((uint8_t)getReg(ra)));
    } break;
    case OP_EXTR: {
      uint8_t d = readU8(bc), ca = readU8(bc);
      setReg(d, R(getColor(ca)));
    } break;
    case OP_EXTG: {
      uint8_t d = readU8(bc), ca = readU8(bc);
      setReg(d, G(getColor(ca)));
    } break;
    case OP_EXTB: {
      uint8_t d = readU8(bc), ca = readU8(bc);
      setReg(d, B(getColor(ca)));
    } break;
    case OP_EXTW: {
      uint8_t d = readU8(bc), ca = readU8(bc);
      setReg(d, W(getColor(ca)));
    } break;

    // ---- Math ----
    case OP_SIN8: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setReg(d, sin8_t((uint8_t)getReg(a)));
    } break;
    case OP_COS8: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setReg(d, cos8_t((uint8_t)getReg(a)));
    } break;
    case OP_SIN16: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setReg(d, sin16_t((uint16_t)getReg(a)));
    } break;
    case OP_BEAT8: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc), c = readU8(bc);
      setReg(d, beatsin8_t((uint8_t)getReg(a), (uint8_t)getReg(b), (uint8_t)getReg(c)));
    } break;
    case OP_TRI8: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setReg(d, triwave8((uint8_t)getReg(a)));
    } break;
    case OP_QAD8: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setReg(d, quadwave8((uint8_t)getReg(a)));
    } break;
    case OP_SCL8: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, scale8((uint8_t)getReg(a), (uint8_t)getReg(b)));
    } break;
    case OP_QADD8: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, qadd8((uint8_t)getReg(a), (uint8_t)getReg(b)));
    } break;
    case OP_QSUB8: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, qsub8((uint8_t)getReg(a), (uint8_t)getReg(b)));
    } break;
    case OP_RND8: {
      uint8_t d = readU8(bc);
      setReg(d, random8());
    } break;
    case OP_RND16: {
      uint8_t d = readU8(bc);
      setReg(d, random16());
    } break;
    case OP_RNDR: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, random8((uint8_t)getReg(a), (uint8_t)getReg(b)));
    } break;
    case OP_NOISE: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setReg(d, inoise8((uint16_t)getReg(a)));
    } break;
    case OP_NOI2: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, inoise8((uint16_t)getReg(a), (uint16_t)getReg(b)));
    } break;
    case OP_NOI3: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc), c = readU8(bc);
      setReg(d, inoise8((uint16_t)getReg(a), (uint16_t)getReg(b), (uint16_t)getReg(c)));
    } break;
    case OP_SQRT: {
      uint8_t d = readU8(bc), a = readU8(bc);
      int32_t v = getReg(a);
      setReg(d, v > 0 ? (int32_t)sqrt16((uint16_t)v) : 0);
    } break;
    case OP_ABS: {
      uint8_t d = readU8(bc), a = readU8(bc);
      int32_t v = getReg(a);
      setReg(d, (v == INT32_MIN) ? INT32_MAX : (v < 0 ? -v : v));
    } break;
    case OP_MIN: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, min(getReg(a), getReg(b)));
    } break;
    case OP_MAX: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setReg(d, max(getReg(a), getReg(b)));
    } break;

    // ---- Control Flow ----
    // Helper macro: validate jump target, halt on out-of-bounds
    #define VM_JUMP(off) { \
      int32_t _t = (int32_t)pc + (off); \
      if (_t < 0 || _t > (int32_t)len) return FRAMETIME; \
      pc = (uint16_t)_t; \
    }
    case OP_JMP: {
      int16_t off = readI16(bc);
      VM_JUMP(off);
    } break;
    case OP_JZ: {
      uint8_t a = readU8(bc);
      int16_t off = readI16(bc);
      if (getReg(a) == 0) VM_JUMP(off);
    } break;
    case OP_JNZ: {
      uint8_t a = readU8(bc);
      int16_t off = readI16(bc);
      if (getReg(a) != 0) VM_JUMP(off);
    } break;
    case OP_JLT: {
      uint8_t a = readU8(bc), b = readU8(bc);
      int16_t off = readI16(bc);
      if (getReg(a) < getReg(b)) VM_JUMP(off);
    } break;
    case OP_JGT: {
      uint8_t a = readU8(bc), b = readU8(bc);
      int16_t off = readI16(bc);
      if (getReg(a) > getReg(b)) VM_JUMP(off);
    } break;
    case OP_JEQ: {
      uint8_t a = readU8(bc), b = readU8(bc);
      int16_t off = readI16(bc);
      if (getReg(a) == getReg(b)) VM_JUMP(off);
    } break;
    case OP_JLE: {
      uint8_t a = readU8(bc), b = readU8(bc);
      int16_t off = readI16(bc);
      if (getReg(a) <= getReg(b)) VM_JUMP(off);
    } break;
    case OP_JGE: {
      uint8_t a = readU8(bc), b = readU8(bc);
      int16_t off = readI16(bc);
      if (getReg(a) >= getReg(b)) VM_JUMP(off);
    } break;
    case OP_CALL: {
      int16_t off = readI16(bc);
      if (callDepth >= VM_CALL_STACK_DEPTH) return FRAMETIME; // halt on call stack overflow
      callStack[callDepth++] = pc;
      int32_t target = (int32_t)pc + off;
      if (target < 0 || target > (int32_t)len) return FRAMETIME;
      pc = (uint16_t)target;
    } break;
    #undef VM_JUMP
    case OP_RET: {
      if (callDepth > 0) {
        pc = callStack[--callDepth];
      } else {
        return FRAMETIME; // return from top-level = end of frame
      }
    } break;
    case OP_HALT: {
      uint8_t a = readU8(bc);
      uint16_t delay = (uint16_t)getReg(a);
      return delay > 0 ? delay : FRAMETIME;
    } break;
    case OP_HALTS: {
      // frame() with no args: compute delay from speed using SPEED_FORMULA_L
      // Higher speed = shorter delay = faster animation
      uint8_t spd = (uint8_t)regs[REG_P0];
      return 5 + (50 * (255 - spd)) / 255;
    } break;

    // ---- Data Buffer ----
    case OP_ALLOC: {
      uint8_t a = readU8(bc);
      int32_t raw = getReg(a);
      uint16_t size = (uint16_t)(raw > 0 ? min(raw, (int32_t)4096) : 0); // cap at 4KB
      bool ok = seg.allocateData(size);
      setReg(REG_R0, ok ? 1 : 0);
      if (ok) {
        dataBuf = seg.data;
        dataLen = seg.dataSize();
      }
    } break;

    // ---- 2D Geometry ----
#ifndef WLED_DISABLE_2D
    case OP_DLINE: {
      uint8_t x0 = readU8(bc), y0 = readU8(bc), x1 = readU8(bc), y1 = readU8(bc), c = readU8(bc);
      seg.drawLine(getReg(x0), getReg(y0), getReg(x1), getReg(y1), getColor(c));
    } break;
    case OP_DCIRC: {
      uint8_t cx = readU8(bc), cy = readU8(bc), r = readU8(bc), c = readU8(bc);
      seg.drawCircle(getReg(cx), getReg(cy), getReg(r), getColor(c));
    } break;
    case OP_FCIRC: {
      uint8_t cx = readU8(bc), cy = readU8(bc), r = readU8(bc), c = readU8(bc);
      seg.fillCircle(getReg(cx), getReg(cy), getReg(r), getColor(c));
    } break;
    case OP_MOVEP: {
      uint8_t d = readU8(bc), delta = readU8(bc), wrap = readU8(bc);
      seg.move((uint8_t)getReg(d), (uint8_t)getReg(delta), (bool)getReg(wrap));
    } break;

    // ---- Text operations (2D) ----
    case OP_DCHR: {
      uint8_t chr_r = readU8(bc), x_r = readU8(bc), y_r = readU8(bc);
      uint8_t font_r = readU8(bc), col_r = readU8(bc);
      static const uint8_t fw[] = {4, 5, 6, 7, 5};
      static const uint8_t fh[] = {6, 8, 8, 9, 12};
      int fi = constrain(getReg(font_r), 0, 4);
      uint32_t col = getColor(col_r);
      seg.drawCharacter((unsigned char)getReg(chr_r),
                        (int16_t)getReg(x_r), (int16_t)getReg(y_r),
                        fw[fi], fh[fi], col, col, 0);
    } break;
    case OP_GCHR: {
      uint8_t d = readU8(bc), a = readU8(bc);
      int idx = getReg(a);
      if (seg.name && idx >= 0 && idx < (int)nameLen) {
        setReg(d, (int32_t)(unsigned char)seg.name[idx]);
      } else {
        setReg(d, 0);
      }
    } break;
    case OP_GNLN: {
      uint8_t d = readU8(bc);
      setReg(d, (int32_t)nameLen);
    } break;
    case OP_GFNW: {
      uint8_t d = readU8(bc), a = readU8(bc);
      static const uint8_t fw[] = {4, 5, 6, 7, 5};
      setReg(d, fw[constrain(getReg(a), 0, 4)]);
    } break;
    case OP_GFNH: {
      uint8_t d = readU8(bc), a = readU8(bc);
      static const uint8_t fh[] = {6, 8, 8, 9, 12};
      setReg(d, fh[constrain(getReg(a), 0, 4)]);
    } break;
#else
    case OP_DLINE: { readU8(bc); readU8(bc); readU8(bc); readU8(bc); readU8(bc); } break;
    case OP_DCIRC: { readU8(bc); readU8(bc); readU8(bc); readU8(bc); } break;
    case OP_FCIRC: { readU8(bc); readU8(bc); readU8(bc); readU8(bc); } break;
    case OP_MOVEP: { readU8(bc); readU8(bc); readU8(bc); } break;
    case OP_DCHR:  { readU8(bc); readU8(bc); readU8(bc); readU8(bc); readU8(bc); } break;
    case OP_GCHR:  { readU8(bc); readU8(bc); } break;
    case OP_GNLN:  { readU8(bc); } break;
    case OP_GFNW:  { readU8(bc); readU8(bc); } break;
    case OP_GFNH:  { readU8(bc); readU8(bc); } break;
#endif

    // ---- Float Operations ----
    case OP_FADD: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setFloat(d, getFloat(a) + getFloat(b));
    } break;
    case OP_FSUB: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setFloat(d, getFloat(a) - getFloat(b));
    } break;
    case OP_FMUL: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      setFloat(d, getFloat(a) * getFloat(b));
    } break;
    case OP_FDIV: {
      uint8_t d = readU8(bc), a = readU8(bc), b = readU8(bc);
      float bv = getFloat(b);
      setFloat(d, bv != 0.0f ? getFloat(a) / bv : 0.0f);
    } break;
    case OP_ITOF: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setFloat(d, (float)getReg(a));
    } break;
    case OP_FTOI: {
      uint8_t d = readU8(bc), a = readU8(bc);
      float fv = getFloat(a);
      if (isnan(fv) || isinf(fv) || fv > (float)INT32_MAX || fv < (float)INT32_MIN) setReg(d, 0);
      else setReg(d, (int32_t)fv);
    } break;
    case OP_FSIN: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setFloat(d, sin_approx(getFloat(a)));
    } break;
    case OP_FCOS: {
      uint8_t d = readU8(bc), a = readU8(bc);
      setFloat(d, cos_approx(getFloat(a)));
    } break;

    // ---- Audio-reactive ----
    case OP_GVOL: {
      uint8_t d = readU8(bc);
      setReg(d, _audioVol ? (int32_t)(*_audioVol) : 0);
    } break;
    case OP_GPEAK: {
      uint8_t d = readU8(bc);
      setReg(d, _audioPeak ? (int32_t)(*_audioPeak) : 0);
    } break;
    case OP_GFFT: {
      uint8_t d = readU8(bc), a = readU8(bc);
      uint8_t bin = (uint8_t)(getReg(a)) & 0x0F;
      setReg(d, _audioFFT ? (int32_t)_audioFFT[bin] : 0);
    } break;
    case OP_ABASS: {
      uint8_t d = readU8(bc);
      if (_audioFFT) {
        setReg(d, ((int32_t)_audioFFT[0] + _audioFFT[1] + _audioFFT[2] + _audioFFT[3]) / 4);
      } else {
        setReg(d, 0);
      }
    } break;
    case OP_AMID: {
      uint8_t d = readU8(bc);
      if (_audioFFT) {
        setReg(d, ((int32_t)_audioFFT[4] + _audioFFT[5] + _audioFFT[6] + _audioFFT[7]) / 4);
      } else {
        setReg(d, 0);
      }
    } break;
    case OP_ATREB: {
      uint8_t d = readU8(bc);
      if (_audioFFT) {
        int32_t sum = 0;
        for (uint8_t b = 8; b < 16; b++) sum += _audioFFT[b];
        setReg(d, sum / 8);
      } else {
        setReg(d, 0);
      }
    } break;

    case OP_NOP:
      break;

    default:
      // Unknown opcode: halt to prevent undefined behavior
      return FRAMETIME;
    }
  }

  // Fell off end of bytecode — return default frame time
  return FRAMETIME;
}
