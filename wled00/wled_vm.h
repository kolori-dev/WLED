#pragma once
/*
 * WLED-Lang Bytecode VM
 * A register-based virtual machine for executing .wfx effect bytecode.
 * ESP32-only.
 */

#ifndef WLED_VM_H
#define WLED_VM_H

#include <cstdint>
#include <cstddef>

// Forward declarations
struct Segment;
class WS2812FX;

// VM limits
#define VM_MAX_CYCLES_PER_FRAME  50000  // safety watchdog
#define VM_CALL_STACK_DEPTH      16     // max subroutine nesting
#define VM_NUM_GREGS             16     // general purpose registers r0-r15
#define VM_NUM_FREGS             8      // float registers f0-f7
#define VM_NUM_CREGS             4      // color registers c0-c3
#define VM_NUM_PREGS             4      // parameter registers p0-p3
#define VM_NUM_SREGS             5      // special read-only registers

// Register indices (flat addressing for operand bytes)
// r0-r15:  0x00 - 0x0F
// f0-f7:   0x10 - 0x17
// c0-c3:   0x18 - 0x1B
// p0-p3:   0x1C - 0x1F  (speed, intensity, custom1, custom2)
// special: 0x20 - 0x24  (LEN, NOW, CALL, WIDTH, HEIGHT)
#define REG_R0      0x00
#define REG_F0      0x10
#define REG_C0      0x18
#define REG_P0      0x1C  // speed
#define REG_P1      0x1D  // intensity
#define REG_P2      0x1E  // custom1
#define REG_P3      0x1F  // custom2
#define REG_LEN     0x20
#define REG_NOW     0x21
#define REG_CALL    0x22
#define REG_WIDTH   0x23
#define REG_HEIGHT  0x24
#define REG_COUNT   0x25  // total register slots

// Opcodes
enum WledVMOp : uint8_t {
  // Arithmetic (rd, ra, rb) — 3 operand bytes
  OP_ADD = 0x01,
  OP_SUB = 0x02,
  OP_MUL = 0x03,
  OP_DIV = 0x04,
  OP_MOD = 0x05,
  OP_AND = 0x06,
  OP_OR  = 0x07,
  OP_XOR = 0x08,
  OP_SHL = 0x09,
  OP_SHR = 0x0A,
  OP_NEG = 0x0B,  // rd, ra — 2 operand bytes
  OP_NOT = 0x0C,  // rd, ra

  // Load/Store
  OP_LDI   = 0x10,  // rd, imm16 — load 16-bit immediate (sign-extended to 32)
  OP_LDI32 = 0x11,  // rd, imm32 — load 32-bit immediate
  OP_MOV   = 0x12,  // rd, ra — copy register
  OP_LDB   = 0x13,  // rd, ra, imm8 — load byte from data[ra + imm8]
  OP_STB   = 0x14,  // ra, rd, imm8 — store byte rd to data[ra + imm8]
  OP_LDW   = 0x15,  // rd, ra, imm8 — load word from data[ra + imm8]
  OP_STW   = 0x16,  // ra, rd, imm8 — store word rd to data[ra + imm8]

  // Segment parameter access
  OP_GSPD  = 0x20,  // rd — get speed
  OP_GINT  = 0x21,  // rd — get intensity
  OP_GC1   = 0x22,  // rd — get custom1
  OP_GC2   = 0x23,  // rd — get custom2
  OP_GC3   = 0x24,  // rd — get custom3
  OP_GCHK  = 0x25,  // rd, n — get check{n}
  OP_GCOL  = 0x26,  // cd, n — get SEGCOLOR(n)
  OP_GPAL  = 0x27,  // rd — get palette index
  OP_GAUX  = 0x28,  // rd, n — get aux{n}
  OP_SAUX  = 0x29,  // n, ra — set aux{n} = ra
  OP_GSTP  = 0x2A,  // rd — get step
  OP_SSTP  = 0x2B,  // ra — set step = ra

  // Pixel operations
  OP_SPXC  = 0x30,  // ra, cb — setPixelColor(ra, cb)
  OP_GPXC  = 0x31,  // cd, ra — cd = getPixelColor(ra)
  OP_SPXY  = 0x32,  // ra, rb, cc — setPixelColorXY(ra, rb, cc)
  OP_GPXY  = 0x33,  // cd, ra, rb — cd = getPixelColorXY(ra, rb)
  OP_FILL  = 0x34,  // ca — fill(ca)
  OP_FADE  = 0x35,  // ra — fade_out(ra)
  OP_BLUR  = 0x36,  // ra — blur(ra)
  OP_BLR2  = 0x37,  // ra — blur2D(ra)

  // Color operations
  OP_RGB   = 0x40,  // cd, ra, rb, rc — cd = RGBW32(ra, rb, rc, 0)
  OP_RGBW  = 0x41,  // cd, ra, rb, rc, rd2 — cd = RGBW32(ra, rb, rc, rd2)
  OP_CBLND = 0x42,  // cd, ca, cb, ra — cd = color_blend(ca, cb, ra)
  OP_CFADE = 0x43,  // cd, ca, ra — cd = color_fade(ca, ra)
  OP_CADD  = 0x44,  // cd, ca, cb — cd = color_add(ca, cb)
  OP_CPAL  = 0x45,  // cd, ra — cd = color_from_palette(ra)
  OP_CPALX = 0x46,  // cd, ra, rb, rc — cd = color_from_palette(ra, rb, rc, 0)
  OP_CWHL  = 0x47,  // cd, ra — cd = color_wheel(ra)
  OP_EXTR  = 0x48,  // rd, ca — rd = R(ca)
  OP_EXTG  = 0x49,  // rd, ca — rd = G(ca)
  OP_EXTB  = 0x4A,  // rd, ca — rd = B(ca)
  OP_EXTW  = 0x4B,  // rd, ca — rd = W(ca)

  // Math
  OP_SIN8  = 0x50,  // rd, ra — rd = sin8_t(ra)
  OP_COS8  = 0x51,  // rd, ra
  OP_SIN16 = 0x52,  // rd, ra
  OP_BEAT8 = 0x53,  // rd, ra, rb, rc — rd = beatsin8(ra, rb, rc)
  OP_TRI8  = 0x54,  // rd, ra
  OP_QAD8  = 0x55,  // rd, ra
  OP_SCL8  = 0x56,  // rd, ra, rb — rd = scale8(ra, rb)
  OP_QADD8 = 0x57,  // rd, ra, rb — rd = qadd8(ra, rb)
  OP_QSUB8 = 0x58,  // rd, ra, rb — rd = qsub8(ra, rb)
  OP_RND8  = 0x59,  // rd — rd = random8()
  OP_RND16 = 0x5A,  // rd — rd = random16()
  OP_RNDR  = 0x5B,  // rd, ra, rb — rd = random8(ra, rb)
  OP_NOISE = 0x5C,  // rd, ra — rd = inoise8(ra)
  OP_NOI2  = 0x5D,  // rd, ra, rb
  OP_NOI3  = 0x5E,  // rd, ra, rb, rc
  OP_SQRT  = 0x5F,  // rd, ra
  OP_ABS   = 0x60,  // rd, ra
  OP_MIN   = 0x61,  // rd, ra, rb
  OP_MAX   = 0x62,  // rd, ra, rb

  // Control flow
  OP_JMP   = 0x70,  // offset16 — unconditional relative jump
  OP_JZ    = 0x71,  // ra, offset16 — jump if ra == 0
  OP_JNZ   = 0x72,  // ra, offset16 — jump if ra != 0
  OP_JLT   = 0x73,  // ra, rb, offset16 — jump if ra < rb
  OP_JGT   = 0x74,  // ra, rb, offset16 — jump if ra > rb
  OP_JEQ   = 0x75,  // ra, rb, offset16 — jump if ra == rb
  OP_JLE   = 0x76,  // ra, rb, offset16 — jump if ra <= rb
  OP_JGE   = 0x77,  // ra, rb, offset16 — jump if ra >= rb
  OP_CALL  = 0x78,  // offset16 — push PC, jump
  OP_RET   = 0x79,  // pop PC, return
  OP_HALT  = 0x7A,  // ra — end frame, return ra as delay (ms)
  OP_HALTS = 0x7B,  // (no operands) — end frame, delay from speed via SPEED_FORMULA_L

  // Data buffer
  OP_ALLOC = 0x80,  // ra — allocateData(ra), r0 = success

  // 2D Geometry
  OP_DLINE = 0x90,  // ra, rb, rc, rd, ce — drawLine(x0,y0,x1,y1,color)
  OP_DCIRC = 0x91,  // ra, rb, rc, cd — drawCircle(cx,cy,r,color)
  OP_FCIRC = 0x92,  // ra, rb, rc, cd — fillCircle(cx,cy,r,color)
  OP_MOVEP = 0x93,  // ra, rb, rc — move(dir, delta, wrap)

  // Float operations (use f-registers, reinterpreted)
  OP_FADD  = 0xA0,  // fd, fa, fb
  OP_FSUB  = 0xA1,
  OP_FMUL  = 0xA2,
  OP_FDIV  = 0xA3,
  OP_ITOF  = 0xA4,  // fd, ra — convert int to float
  OP_FTOI  = 0xA5,  // rd, fa — convert float to int
  OP_FSIN  = 0xA6,  // fd, fa — sin(fa)
  OP_FCOS  = 0xA7,  // fd, fa — cos(fa)

  // Audio-reactive (require WFX_FLAG_AUDIO)
  OP_GVOL  = 0xB0,  // rd — get smoothed volume (0-255)
  OP_GPEAK = 0xB1,  // rd — get peak flag (0 or 1)
  OP_GFFT  = 0xB2,  // rd, ra — get fftResult[ra & 0x0F] (0-255)
  OP_ABASS = 0xB3,  // rd — avg of fft bins 0-3
  OP_AMID  = 0xB4,  // rd — avg of fft bins 4-7
  OP_ATREB = 0xB5,  // rd — avg of fft bins 8-15

  // Text operations (2D)
  OP_DCHR  = 0xC0,  // ra, rb, rc, rd, ce — drawCharacter(chr, x, y, font, color)
  OP_GCHR  = 0xC1,  // rd, ra — rd = seg.name[ra] (0 if null/OOB)
  OP_GNLN  = 0xC2,  // rd — rd = strlen(seg.name) (0 if null)
  OP_GFNW  = 0xC3,  // rd, ra — rd = font_width[ra] (font index 0-4)
  OP_GFNH  = 0xC4,  // rd, ra — rd = font_height[ra] (font index 0-4)

  OP_NOP   = 0xFF
};

// .wfx file header
#define WFX_MAGIC_0 'W'
#define WFX_MAGIC_1 'F'
#define WFX_MAGIC_2 'X'
#define WFX_VERSION 0x01

#define WFX_FLAG_2D          0x01
#define WFX_FLAG_PALETTE     0x02
#define WFX_FLAG_AUDIO       0x04

struct __attribute__((packed)) WfxHeader {
  uint8_t  magic[3];     // "WFX"
  uint8_t  version;      // 0x01
  uint8_t  flags;        // WFX_FLAG_*
  uint8_t  dataSize;     // min data buffer in 16-byte units (0 = none)
  uint16_t bytecodeLen;  // length of bytecode section
  // followed by: null-terminated metadata string, then bytecode
};

// VM state for a single execution
class WledVM {
public:
  WledVM();

  // Execute bytecode for one frame. Returns frame delay in ms.
  // Audio pointers are optional — null if audio unavailable or effect doesn't use audio.
  uint16_t execute(const uint8_t* bytecode, uint16_t len, Segment& seg,
                   float* vol = nullptr, uint8_t* fft = nullptr, uint8_t* peak = nullptr);

private:
  // Audio source pointers (set per execute() call, null-safe)
  float*   _audioVol;   // -> volumeSmth
  uint8_t* _audioFFT;   // -> fftResult[16]
  uint8_t* _audioPeak;  // -> samplePeak
  // Register file (all 32-bit)
  int32_t  regs[REG_COUNT];

  // Call stack
  uint16_t callStack[VM_CALL_STACK_DEPTH];
  uint8_t  callDepth;

  // Program counter
  uint16_t pc;

  // Cycle counter (safety)
  uint32_t cycles;

  // Bytecode length (set per execute() call)
  uint16_t bcLen;

  // Helpers with bounds checking
  inline uint8_t readU8(const uint8_t* bc) {
    return (pc < bcLen) ? bc[pc++] : 0;
  }
  inline int16_t readI16(const uint8_t* bc) {
    if (pc + 2 > bcLen) { pc = bcLen; return 0; }
    int16_t v = (int16_t)(bc[pc] | (bc[pc+1] << 8)); pc += 2; return v;
  }
  inline uint16_t readU16(const uint8_t* bc) {
    if (pc + 2 > bcLen) { pc = bcLen; return 0; }
    uint16_t v = bc[pc] | (bc[pc+1] << 8); pc += 2; return v;
  }
  inline int32_t readI32(const uint8_t* bc) {
    if (pc + 4 > bcLen) { pc = bcLen; return 0; }
    int32_t v = bc[pc] | (bc[pc+1]<<8) | (bc[pc+2]<<16) | (bc[pc+3]<<24); pc += 4; return v;
  }

  // Register access with bounds checking
  inline int32_t  getReg(uint8_t id)  { return (id < REG_COUNT) ? regs[id] : 0; }
  inline void     setReg(uint8_t id, int32_t v) { if (id < REG_COUNT && id < REG_P0) regs[id] = v; } // can't write to param/special regs

  // Float helpers (reinterpret cast via union)
  inline float    getFloat(uint8_t id) { union { int32_t i; float f; } u; u.i = getReg(id); return u.f; }
  inline void     setFloat(uint8_t id, float v) { union { int32_t i; float f; } u; u.f = v; setReg(id, u.i); }

  // Color register access (color regs are at REG_C0..REG_C0+3)
  inline uint32_t getColor(uint8_t id) { return (uint32_t)getReg(id); }
  inline void     setColor(uint8_t id, uint32_t c) { setReg(id, (int32_t)c); }
};

#endif // WLED_VM_H
