'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { compile } = require('../compiler');
const { WledVMSim, extractBytecode, FRAMETIME,
        sin8, cos8, RGBW32, R, G, B, W, color_wheel } = require('./vm-sim');
const { WFX } = require('../opcodes');

// ---- Helper: compile WLED-Lang source → run in VM sim → return results ----
function run(source, opts = {}) {
  const wfx = compile(source);
  const { bytecode, flags, dataSize } = extractBytecode(wfx);
  const vm = new WledVMSim();
  // Provide dataSize from header if not overridden
  const execOpts = { dataSize, ...opts };
  const result = vm.execute(bytecode, execOpts);
  return { ...result, flags, wfx };
}

// Minimal effect wrapper: wraps render body statements in a valid effect
function fx(body) {
  return `effect "Test" {\n  render {\n${body}\n  }\n}`;
}

// Effect with meta block
function fxMeta(meta, body) {
  return `effect "Test" {\n  meta {\n${meta}\n  }\n  render {\n${body}\n  }\n}`;
}

// Effect with data declarations
function fxData(data, body) {
  return `effect "Test" {\n  ${data}\n  render {\n${body}\n  }\n}`;
}

// ========================================================================
// 2a. WFX Header Tests
// ========================================================================
describe('WFX Header', () => {
  it('has correct magic bytes and version', () => {
    const wfx = compile(fx('let x = 1'));
    assert.equal(wfx[0], 0x57); // 'W'
    assert.equal(wfx[1], 0x46); // 'F'
    assert.equal(wfx[2], 0x58); // 'X'
    assert.equal(wfx[3], 0x01); // version
  });

  it('type 1D sets palette flag only', () => {
    const src = fxMeta('type 1D\n    palette true', 'let x = 1');
    const { flags } = run(src);
    assert.equal(flags & WFX.FLAG_PALETTE, WFX.FLAG_PALETTE);
    assert.equal(flags & WFX.FLAG_2D, 0);
  });

  it('type 2D sets 2D + palette flags', () => {
    const src = fxMeta('type 2D\n    palette true', 'let x = 1');
    const { flags } = run(src);
    assert.equal(flags & WFX.FLAG_2D, WFX.FLAG_2D);
    assert.equal(flags & WFX.FLAG_PALETTE, WFX.FLAG_PALETTE);
  });

  it('audio_reactive true sets audio flag', () => {
    const src = fxMeta('audio_reactive true', 'let x = 1');
    const { flags } = run(src);
    assert.equal(flags & WFX.FLAG_AUDIO, WFX.FLAG_AUDIO);
  });

  it('data declarations produce non-zero dataSize', () => {
    const src = fxData('data buf[16]', 'let x = 1');
    const wfx = compile(src);
    assert.ok(wfx[5] > 0, 'dataSize field should be > 0');
  });
});

// ========================================================================
// 2b. Arithmetic Tests
// ========================================================================
describe('Arithmetic', () => {
  it('addition: 3 + 4 = 7', () => {
    const { regs } = run(fx('let x = 3 + 4'));
    assert.equal(regs[0], 7);
  });

  it('subtraction: 10 - 3 = 7', () => {
    const { regs } = run(fx('let x = 10 - 3'));
    assert.equal(regs[0], 7);
  });

  it('multiplication: 6 * 7 = 42', () => {
    const { regs } = run(fx('let x = 6 * 7'));
    assert.equal(regs[0], 42);
  });

  it('integer division: 20 / 3 = 6', () => {
    const { regs } = run(fx('let x = 20 / 3'));
    assert.equal(regs[0], 6);
  });

  it('modulo: 17 % 5 = 2', () => {
    const { regs } = run(fx('let x = 17 % 5'));
    assert.equal(regs[0], 2);
  });

  it('division by zero returns 0', () => {
    const { regs } = run(fx('let x = 10 / 0'));
    assert.equal(regs[0], 0);
  });

  it('modulo by zero returns 0', () => {
    const { regs } = run(fx('let x = 10 % 0'));
    assert.equal(regs[0], 0);
  });

  it('negation: -5', () => {
    const { regs } = run(fx('let x = -5'));
    assert.equal(regs[0], -5);
  });

  it('chained arithmetic: (2 + 3) * 4 = 20', () => {
    const { regs } = run(fx('let x = (2 + 3) * 4'));
    assert.equal(regs[0], 20);
  });

  it('bitwise AND', () => {
    const { regs } = run(fx('let x = 0xFF & 0x0F'));
    assert.equal(regs[0], 0x0F);
  });

  it('bitwise OR', () => {
    const { regs } = run(fx('let x = 0xF0 | 0x0F'));
    assert.equal(regs[0], 0xFF);
  });

  it('left shift', () => {
    const { regs } = run(fx('let x = 1 << 8'));
    assert.equal(regs[0], 256);
  });

  it('right shift', () => {
    const { regs } = run(fx('let x = 256 >> 4'));
    assert.equal(regs[0], 16);
  });
});

// ========================================================================
// 2c. Comparison & If/Else Tests
// ========================================================================
describe('Comparisons & If/Else', () => {
  it('5 > 3 is truthy (then branch taken)', () => {
    const { regs } = run(fx(`
      let x = 0
      if 5 > 3 { x = 1 }
    `));
    assert.equal(regs[0], 1);
  });

  it('3 > 5 is falsy (then branch NOT taken)', () => {
    const { regs } = run(fx(`
      let x = 0
      if 3 > 5 { x = 1 }
    `));
    assert.equal(regs[0], 0);
  });

  it('if/else takes correct branch (true)', () => {
    const { regs } = run(fx(`
      let x = 0
      if 10 > 5 { x = 1 } else { x = 2 }
    `));
    assert.equal(regs[0], 1);
  });

  it('if/else takes correct branch (false)', () => {
    const { regs } = run(fx(`
      let x = 0
      if 3 > 5 { x = 1 } else { x = 2 }
    `));
    assert.equal(regs[0], 2);
  });

  it('equality comparison', () => {
    const { regs } = run(fx(`
      let x = 0
      if 5 == 5 { x = 1 }
    `));
    assert.equal(regs[0], 1);
  });

  it('inequality comparison', () => {
    const { regs } = run(fx(`
      let x = 0
      if 5 != 3 { x = 1 }
    `));
    assert.equal(regs[0], 1);
  });

  it('less than comparison', () => {
    const { regs } = run(fx(`
      let x = 0
      if 3 < 5 { x = 1 }
    `));
    assert.equal(regs[0], 1);
  });

  it('less-equal comparison', () => {
    const { regs } = run(fx(`
      let x = 0
      if 5 <= 5 { x = 1 }
    `));
    assert.equal(regs[0], 1);
  });

  it('greater-equal comparison', () => {
    const { regs } = run(fx(`
      let x = 0
      if 5 >= 5 { x = 1 }
    `));
    assert.equal(regs[0], 1);
  });

  it('nested ifs', () => {
    const { regs } = run(fx(`
      let x = 0
      if 5 > 3 {
        if 10 > 7 { x = 42 }
      }
    `));
    assert.equal(regs[0], 42);
  });
});

// ========================================================================
// 2d. For Loop Tests
// ========================================================================
describe('For Loops', () => {
  it('for 0..5 increments x five times', () => {
    const { regs } = run(fx(`
      let x = 0
      for i in 0..5 { x = x + 1 }
    `));
    assert.equal(regs[0], 5);
  });

  it('for loop variable has correct values', () => {
    // Sum 0+1+2+3+4 = 10
    const { regs } = run(fx(`
      let x = 0
      for i in 0..5 { x = x + i }
    `));
    assert.equal(regs[0], 10);
  });

  it('nested for loops', () => {
    // 3 * 4 = 12 iterations
    const { regs } = run(fx(`
      let x = 0
      for i in 0..3 {
        for j in 0..4 { x = x + 1 }
      }
    `));
    assert.equal(regs[0], 12);
  });

  it('for loop with explicit step', () => {
    // 0, 2, 4 → 3 iterations → sum = 6
    const { regs } = run(fx(`
      let x = 0
      for i in 0..6 step 2 { x = x + i }
    `));
    assert.equal(regs[0], 6); // 0+2+4
  });

  it('register recycled after loop (sequential loops work)', () => {
    const { regs } = run(fx(`
      let a = 0
      for i in 0..3 { a = a + 1 }
      let b = 0
      for j in 0..4 { b = b + 1 }
    `));
    assert.equal(regs[0], 3); // a
    assert.equal(regs[1], 4); // b
  });
});

// ========================================================================
// 2e. While Loop Tests
// ========================================================================
describe('While Loops', () => {
  it('while x < 10 increments to 10', () => {
    const { regs } = run(fx(`
      let x = 0
      while x < 10 { x = x + 1 }
    `));
    assert.equal(regs[0], 10);
  });

  it('while false body never executes', () => {
    const { regs } = run(fx(`
      let x = 42
      while 0 > 1 { x = 0 }
    `));
    assert.equal(regs[0], 42);
  });
});

// ========================================================================
// 2f. Built-in Math Tests
// ========================================================================
describe('Math Built-ins', () => {
  it('abs(-5) = 5', () => {
    const { regs } = run(fx('let x = abs(-5)'));
    assert.equal(regs[0], 5);
  });

  it('abs(5) = 5', () => {
    const { regs } = run(fx('let x = abs(5)'));
    assert.equal(regs[0], 5);
  });

  it('min(3, 7) = 3', () => {
    const { regs } = run(fx('let x = min(3, 7)'));
    assert.equal(regs[0], 3);
  });

  it('max(3, 7) = 7', () => {
    const { regs } = run(fx('let x = max(3, 7)'));
    assert.equal(regs[0], 7);
  });

  it('sin8(0) returns known value', () => {
    const { regs } = run(fx('let x = sin8(0)'));
    assert.equal(regs[0], sin8(0));
  });

  it('cos8(0) returns known value', () => {
    const { regs } = run(fx('let x = cos8(0)'));
    assert.equal(regs[0], cos8(0));
  });

  it('sin8(64) ~ 255 (peak of sine)', () => {
    const { regs } = run(fx('let x = sin8(64)'));
    assert.equal(regs[0], sin8(64));
    assert.ok(regs[0] >= 254, 'sin8(64) should be near 255');
  });

  it('sqrt(25) = 5', () => {
    const { regs } = run(fx('let x = sqrt(25)'));
    assert.equal(regs[0], 5);
  });

  it('sqrt(0) = 0', () => {
    const { regs } = run(fx('let x = sqrt(0)'));
    assert.equal(regs[0], 0);
  });

  it('scale8(128, 128) ~ 64', () => {
    const { regs } = run(fx('let x = scale8(128, 128)'));
    assert.equal(regs[0], Math.floor(128 * 128 / 256));
  });

  it('qadd8 saturates at 255', () => {
    const { regs } = run(fx('let x = qadd8(200, 200)'));
    assert.equal(regs[0], 255);
  });

  it('qsub8 clamps at 0', () => {
    const { regs } = run(fx('let x = qsub8(10, 50)'));
    assert.equal(regs[0], 0);
  });

  it('tri8(0) = 0', () => {
    const { regs } = run(fx('let x = tri8(0)'));
    assert.equal(regs[0], 0);
  });

  it('tri8(64) = 128', () => {
    const { regs } = run(fx('let x = tri8(64)'));
    assert.equal(regs[0], 128);
  });
});

// ========================================================================
// 2g. Color & Pixel Tests
// ========================================================================
describe('Color & Pixel', () => {
  it('rgb(255, 0, 0) produces correct 32-bit color', () => {
    const { regs } = run(fx('let c = rgb(255, 0, 0)'));
    // c is in c0 (0x18) since rgb returns to a color register? No — let stores in r0.
    // Actually rgb has hasDestReg:true and writes to dest. For let, dest = r0.
    // But wait, RGB writes to a color register slot... The codegen emits [RGB, destReg, rR, rG, rB].
    // destReg is r0 (0x00). setColor(0x00, ...) calls setReg(0x00, ...) which is < REG_P0 so it works.
    const expected = RGBW32(255, 0, 0, 0);
    // regs[0] is int32 interpretation of the color
    assert.equal(regs[0] >>> 0, expected);
  });

  it('red() extracts red channel', () => {
    const { regs } = run(fx(`
      let c = rgb(200, 100, 50)
      let r = red(c)
    `));
    assert.equal(regs[1], 200);
  });

  it('green() extracts green channel', () => {
    const { regs } = run(fx(`
      let c = rgb(200, 100, 50)
      let g = green(c)
    `));
    assert.equal(regs[1], 100);
  });

  it('blue() extracts blue channel', () => {
    const { regs } = run(fx(`
      let c = rgb(200, 100, 50)
      let b = blue(c)
    `));
    assert.equal(regs[1], 50);
  });

  it('pixel() sets mock pixel buffer', () => {
    const { pixels } = run(fx(`
      let c = rgb(255, 0, 0)
      pixel(0, c)
    `), { LEN: 10 });
    assert.equal(pixels[0] >>> 0, RGBW32(255, 0, 0, 0));
  });

  it('pixel2d() sets mock 2D pixel buffer', () => {
    const { pixels2d } = run(fx(`
      let c = rgb(0, 255, 0)
      pixel2d(1, 2, c)
    `), { WIDTH: 8, HEIGHT: 8, LEN: 64 });
    assert.equal(pixels2d[2][1] >>> 0, RGBW32(0, 255, 0, 0));
  });

  it('color_wheel produces non-zero color', () => {
    const { regs } = run(fx('let c = color_wheel(85)'));
    assert.notEqual(regs[0], 0);
    assert.equal(regs[0] >>> 0, color_wheel(85));
  });

  it('color_fade reduces brightness', () => {
    const { regs } = run(fx(`
      let c = rgb(200, 100, 50)
      let f = color_fade(c, 128)
      let r = red(f)
    `));
    // 200 * 128 / 256 = 100
    assert.equal(regs[2], 100);
  });
});

// ========================================================================
// 2h. Data Array Tests
// ========================================================================
describe('Data Arrays', () => {
  it('data array write and read back', () => {
    const src = fxData('data buf[16]', `
      buf[0] = 42
      let x = buf[0]
    `);
    const { regs } = run(src);
    assert.equal(regs[0], 42);
  });

  it('data array multiple indices', () => {
    const src = fxData('data buf[16]', `
      buf[0] = 10
      buf[1] = 20
      let a = buf[0]
      let b = buf[1]
    `);
    const { regs } = run(src);
    assert.equal(regs[0], 10);
    assert.equal(regs[1], 20);
  });
});

// ========================================================================
// 2i. Opcode Variable Tests
// ========================================================================
describe('Opcode Variables', () => {
  it('step_val write and read back', () => {
    const { seg } = run(fx(`
      step_val = 100
    `));
    // step_val = 100 emits [SSTP, valReg, 0] — VM reads valReg as the register
    // The value 100 was loaded into the temp register, then SSTP reads it
    assert.equal(seg.step, 100);
  });

  it('step_val read returns current value', () => {
    const { regs } = run(fx('let x = step_val'), { step: 77 });
    assert.equal(regs[0], 77);
  });

  it('aux0 write and read back', () => {
    const { seg } = run(fx('aux0 = 50'));
    assert.equal(seg.aux0, 50);
  });

  it('aux0 read returns current value', () => {
    const { regs } = run(fx('let x = aux0'), { aux0: 123 });
    assert.equal(regs[0], 123);
  });

  it('aux1 write and read back', () => {
    const { seg } = run(fx('aux1 = 200'));
    assert.equal(seg.aux1, 200);
  });
});

// ========================================================================
// 2j. Audio Tests
// ========================================================================
describe('Audio-reactive', () => {
  const mockAudio = {
    volume: 180.5,
    peak: 1,
    fft: new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]),
  };

  it('volume reads mock volume', () => {
    const src = fxMeta('audio_reactive true', 'let v = volume');
    const { regs } = run(src, { audio: mockAudio });
    assert.equal(regs[0], 180); // truncated to int
  });

  it('peak reads mock peak flag', () => {
    const src = fxMeta('audio_reactive true', 'let p = peak');
    const { regs } = run(src, { audio: mockAudio });
    assert.equal(regs[0], 1);
  });

  it('fft(3) reads mock FFT bin 3', () => {
    const src = fxMeta('audio_reactive true', 'let f = fft(3)');
    const { regs } = run(src, { audio: mockAudio });
    assert.equal(regs[0], 40);
  });

  it('audio_bass() averages bins 0-3', () => {
    const src = fxMeta('audio_reactive true', 'let b = audio_bass()');
    const { regs } = run(src, { audio: mockAudio });
    assert.equal(regs[0], Math.floor((10 + 20 + 30 + 40) / 4));
  });

  it('audio_mid() averages bins 4-7', () => {
    const src = fxMeta('audio_reactive true', 'let m = audio_mid()');
    const { regs } = run(src, { audio: mockAudio });
    assert.equal(regs[0], Math.floor((50 + 60 + 70 + 80) / 4));
  });

  it('audio_treble() averages bins 8-15', () => {
    const src = fxMeta('audio_reactive true', 'let t = audio_treble()');
    const { regs } = run(src, { audio: mockAudio });
    assert.equal(regs[0], Math.floor((90 + 100 + 110 + 120 + 130 + 140 + 150 + 160) / 8));
  });

  it('audio unavailable returns 0 for all', () => {
    const src = fxMeta('audio_reactive true', `
      let v = volume
      let p = peak
      let f = fft(0)
      let b = audio_bass()
    `);
    const { regs } = run(src, { audio: null });
    assert.equal(regs[0], 0);
    assert.equal(regs[1], 0);
    assert.equal(regs[2], 0);
    assert.equal(regs[3], 0);
  });
});

// ========================================================================
// 2k. Edge Cases
// ========================================================================
describe('Edge Cases', () => {
  it('division by zero via variable returns 0', () => {
    const { regs } = run(fx(`
      let d = 0
      let x = 10 / d
    `));
    assert.equal(regs[1], 0);
  });

  it('cycle watchdog triggers on infinite loop', () => {
    const { delay } = run(fx('while 1 > 0 { let x = 1 }'));
    assert.equal(delay, FRAMETIME);
  });

  it('HALT with 0 returns FRAMETIME', () => {
    // The implicit HALT at end uses register 0 which is 0
    const { delay } = run(fx('let x = 0'));
    assert.equal(delay, FRAMETIME);
  });

  it('frame(100) returns 100ms delay', () => {
    const { delay } = run(fx('frame(100)'));
    assert.equal(delay, 100);
  });

  it('special registers are read-only (speed)', () => {
    const { regs } = run(fx('let x = speed'), { speed: 200 });
    assert.equal(regs[0], 200);
  });

  it('LEN register matches segment length', () => {
    const { regs } = run(fx('let x = LEN'), { LEN: 60 });
    assert.equal(regs[0], 60);
  });

  it('NOW register matches mock time', () => {
    const { regs } = run(fx('let x = NOW'), { NOW: 5000 });
    assert.equal(regs[0], 5000);
  });

  it('boolean true = 1, false = 0', () => {
    const { regs } = run(fx(`
      let a = true
      let b = false
    `));
    assert.equal(regs[0], 1);
    assert.equal(regs[1], 0);
  });

  it('logical and short-circuits', () => {
    const { regs } = run(fx('let x = 0 and 5'));
    assert.equal(regs[0], 0);
  });

  it('logical or short-circuits', () => {
    const { regs } = run(fx('let x = 3 or 0'));
    assert.equal(regs[0], 3);
  });
});

// ========================================================================
// Segment parameter access
// ========================================================================
describe('Segment Parameters', () => {
  it('speed register', () => {
    const { regs } = run(fx('let x = speed'), { speed: 100 });
    assert.equal(regs[0], 100);
  });

  it('intensity register', () => {
    const { regs } = run(fx('let x = intensity'), { intensity: 200 });
    assert.equal(regs[0], 200);
  });

  it('custom1 register', () => {
    const { regs } = run(fx('let x = custom1'), { custom1: 42 });
    assert.equal(regs[0], 42);
  });

  it('custom2 register', () => {
    const { regs } = run(fx('let x = custom2'), { custom2: 99 });
    assert.equal(regs[0], 99);
  });

  it('WIDTH and HEIGHT', () => {
    const { regs } = run(fx(`
      let w = WIDTH
      let h = HEIGHT
    `), { WIDTH: 16, HEIGHT: 16, LEN: 256 });
    assert.equal(regs[0], 16);
    assert.equal(regs[1], 16);
  });
});

// ========================================================================
// End-to-end: compile a real-ish effect
// ========================================================================
describe('End-to-end effect', () => {
  it('rainbow-like effect sets all pixels', () => {
    const src = `effect "TestRainbow" {
      render {
        for i in 0..LEN {
          let hue = i * 256 / LEN
          pixel(i, color_wheel(hue))
        }
      }
    }`;
    const { pixels } = run(src, { LEN: 10 });
    // Every pixel should be non-black
    for (let i = 0; i < 10; i++) {
      assert.notEqual(pixels[i], 0, `pixel ${i} should not be black`);
    }
  });

  it('fill sets all pixels to same color', () => {
    const src = fx(`
      let c = rgb(255, 0, 0)
      fill(c)
    `);
    const { pixels } = run(src, { LEN: 5 });
    const red = RGBW32(255, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      assert.equal(pixels[i] >>> 0, red);
    }
  });
});
