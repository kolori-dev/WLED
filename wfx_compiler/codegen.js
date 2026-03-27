'use strict';

const { REG, OP, WFX } = require('./opcodes');

class CodegenError extends Error {
  constructor(msg) {
    super(`Codegen error: ${msg}`);
  }
}

// VM operand layout for each builtin function.
// vmOperands = total bytes read by VM after the opcode byte.
// hasDestReg = true if first operand byte is a destination register.
const BUILTINS = {
  // Pixel ops (void — no dest register)
  pixel:       { op: OP.SPXC, args: 2, hasDestReg: false, vmOperands: 2 },
  pixel2d:     { op: OP.SPXY, args: 3, hasDestReg: false, vmOperands: 3 },
  fill:        { op: OP.FILL, args: 1, hasDestReg: false, vmOperands: 1 },
  fade:        { op: OP.FADE, args: 1, hasDestReg: false, vmOperands: 1 },
  blur:        { op: OP.BLUR, args: 1, hasDestReg: false, vmOperands: 1 },
  blur2d:      { op: OP.BLR2, args: 1, hasDestReg: false, vmOperands: 1 },

  // Pixel ops (returning — first operand is dest)
  get_pixel:   { op: OP.GPXC, args: 1, hasDestReg: true, vmOperands: 2 },
  get_pixel2d: { op: OP.GPXY, args: 2, hasDestReg: true, vmOperands: 3 },

  // Color constructors
  rgb:         { op: OP.RGB,   args: 3, hasDestReg: true, vmOperands: 4 },
  rgbw:        { op: OP.RGBW,  args: 4, hasDestReg: true, vmOperands: 5 },
  blend:       { op: OP.CBLND, args: 3, hasDestReg: true, vmOperands: 4 },
  color_fade:  { op: OP.CFADE, args: 2, hasDestReg: true, vmOperands: 3 },
  color_add:   { op: OP.CADD,  args: 2, hasDestReg: true, vmOperands: 3 },
  palette:     { op: OP.CPAL,  args: 1, hasDestReg: true, vmOperands: 2 },
  palette_x:   { op: OP.CPALX, args: 3, hasDestReg: true, vmOperands: 4 },
  color_wheel: { op: OP.CWHL,  args: 1, hasDestReg: true, vmOperands: 2 },

  // Color extraction
  red:         { op: OP.EXTR, args: 1, hasDestReg: true, vmOperands: 2 },
  green:       { op: OP.EXTG, args: 1, hasDestReg: true, vmOperands: 2 },
  blue:        { op: OP.EXTB, args: 1, hasDestReg: true, vmOperands: 2 },
  white:       { op: OP.EXTW, args: 1, hasDestReg: true, vmOperands: 2 },

  // Math
  sin8:        { op: OP.SIN8,  args: 1, hasDestReg: true, vmOperands: 2 },
  cos8:        { op: OP.COS8,  args: 1, hasDestReg: true, vmOperands: 2 },
  sin16:       { op: OP.SIN16, args: 1, hasDestReg: true, vmOperands: 2 },
  beat8:       { op: OP.BEAT8, args: 3, hasDestReg: true, vmOperands: 4 },
  tri8:        { op: OP.TRI8,  args: 1, hasDestReg: true, vmOperands: 2 },
  quad8:       { op: OP.QAD8,  args: 1, hasDestReg: true, vmOperands: 2 },
  scale8:      { op: OP.SCL8,  args: 2, hasDestReg: true, vmOperands: 3 },
  qadd8:       { op: OP.QADD8, args: 2, hasDestReg: true, vmOperands: 3 },
  qsub8:       { op: OP.QSUB8, args: 2, hasDestReg: true, vmOperands: 3 },
  random:      { op: OP.RND8,  args: -1, hasDestReg: true, vmOperands: 1 }, // special
  random16:    { op: OP.RND16, args: 0, hasDestReg: true, vmOperands: 1 },
  noise:       { op: OP.NOISE, args: 1, hasDestReg: true, vmOperands: 2 },
  noise2:      { op: OP.NOI2,  args: 2, hasDestReg: true, vmOperands: 3 },
  noise3:      { op: OP.NOI3,  args: 3, hasDestReg: true, vmOperands: 4 },
  sqrt:        { op: OP.SQRT,  args: 1, hasDestReg: true, vmOperands: 2 },
  abs:         { op: OP.ABS,   args: 1, hasDestReg: true, vmOperands: 2 },
  min:         { op: OP.MIN,   args: 2, hasDestReg: true, vmOperands: 3 },
  max:         { op: OP.MAX,   args: 2, hasDestReg: true, vmOperands: 3 },

  // Audio-reactive
  fft:          { op: OP.GFFT,  args: 1, hasDestReg: true, vmOperands: 2 },
  audio_bass:   { op: OP.ABASS, args: 0, hasDestReg: true, vmOperands: 1 },
  audio_mid:    { op: OP.AMID,  args: 0, hasDestReg: true, vmOperands: 1 },
  audio_treble: { op: OP.ATREB, args: 0, hasDestReg: true, vmOperands: 1 },

  // Data buffer
  alloc:       { op: OP.ALLOC, args: 1, hasDestReg: false, vmOperands: 1 },

  // 2D geometry (void)
  draw_line:   { op: OP.DLINE, args: 5, hasDestReg: false, vmOperands: 5 },
  draw_circle: { op: OP.DCIRC, args: 4, hasDestReg: false, vmOperands: 4 },
  fill_circle: { op: OP.FCIRC, args: 4, hasDestReg: false, vmOperands: 4 },
  move_pixels: { op: OP.MOVEP, args: 3, hasDestReg: false, vmOperands: 3 },

  // Text operations (2D)
  draw_char:   { op: OP.DCHR, args: 5, hasDestReg: false, vmOperands: 5 },
  name_char:   { op: OP.GCHR, args: 1, hasDestReg: true,  vmOperands: 2 },
  name_len:    { op: OP.GNLN, args: 0, hasDestReg: true,  vmOperands: 1 },
  font_w:      { op: OP.GFNW, args: 1, hasDestReg: true,  vmOperands: 2 },
  font_h:      { op: OP.GFNH, args: 1, hasDestReg: true,  vmOperands: 2 },
};

// Special variable names mapped to registers
const SPECIAL_VARS = {
  speed:     REG.P0,
  intensity: REG.P1,
  custom1:   REG.P2,
  custom2:   REG.P3,
  LEN:       REG.LEN,
  NOW:       REG.NOW,
  CALL:      REG.CALL,
  WIDTH:     REG.WIDTH,
  HEIGHT:    REG.HEIGHT,
};

// Variables accessed via opcodes
const OPCODE_VARS = {
  custom3:  { get: OP.GC3 },
  check1:   { get: OP.GCHK, idx: 0 },
  check2:   { get: OP.GCHK, idx: 1 },
  check3:   { get: OP.GCHK, idx: 2 },
  color0:   { get: OP.GCOL, idx: 0 },
  color1:   { get: OP.GCOL, idx: 1 },
  color2:   { get: OP.GCOL, idx: 2 },
  aux0:     { get: OP.GAUX, set: OP.SAUX, idx: 0 },
  aux1:     { get: OP.GAUX, set: OP.SAUX, idx: 1 },
  step_val: { get: OP.GSTP, set: OP.SSTP },
  // Audio-reactive
  volume:   { get: OP.GVOL },
  peak:     { get: OP.GPEAK },
};

class Codegen {
  constructor(ast) {
    this.ast = ast;
    this.code = [];      // bytecode bytes
    this.vars = {};      // variable name → register
    this.nextReg = 0;    // next available general register (r0-r10)
    this.maxReg = 11;    // r0-r10 for variables
    this.tmpBase = 11;   // r11-r15 for temporaries (5 temps)
    this.tmpDepth = 0;   // current temp stack depth
    this.forNest = 0;    // for-loop nesting depth (for end/step register reuse)
    this.dataDecls = [];
    this.labelCounter = 0;
    this.patches = [];   // { offset, label } — offset points to the 2 bytes of the int16 to patch
    this.labels = {};    // label → bytecode offset
  }

  generate() {
    const effect = this.ast;
    const metadata = this._buildMetadata(effect);

    let dataSize = 0;
    for (const dd of effect.dataDecls) {
      this.dataDecls.push(dd);
      dataSize += this._evalConstExpr(dd.sizeExpr);
    }
    const dataSizeUnits = Math.ceil(dataSize / 16);

    if (dataSize > 0) {
      this._emitLoadImm(this._pushTmp(), dataSize);
      // ALLOC: [op, a] (2 bytes)
      this._emitByte(OP.ALLOC);
      this._emitByte(this._peekTmp());
      this._popTmp();
    }

    for (const stmt of effect.renderBody) {
      this._genStmt(stmt);
    }

    // Trailing HALTS (speed-based delay) as safety fallthrough
    this._emitByte(OP.HALTS);

    this._resolveLabels();
    return this._buildWfx(metadata, dataSizeUnits);
  }

  // --- Metadata ---

  _buildMetadata(effect) {
    // WLED metadata format: Name@Sliders;Colors;Palette;Flags
    // Slider positions: 0=Speed, 1=Intensity, 2=Custom1, 3=Custom2, 4=Custom3
    // Empty position = slider hidden in UI
    let meta = effect.name;
    if (effect.meta) {
      meta += '@';
      // Section 1: Slider labels at correct positions
      const sliderPos = { speed: 0, intensity: 1, custom1: 2, custom2: 3, custom3: 4 };
      const labels = ['', '', '', '', ''];
      for (const s of effect.meta.sliders) {
        const pos = sliderPos[s.name];
        if (pos !== undefined) labels[pos] = s.label;
      }
      // Trim trailing empty slots
      while (labels.length > 0 && labels[labels.length - 1] === '') labels.pop();
      meta += labels.join(',');
      // Section 2: Color slot labels (default)
      meta += ';!';
      // Section 3: Palette
      meta += ';' + (effect.meta.palette ? '!' : '');
      // Section 4: Flags — only emit audio reactivity flags.
      // Do NOT emit type restriction ("1"/"2") — the VM handles both 1D
      // and 2D segments gracefully, and type flags cause 2D effects to be
      // hidden from the UI when only 1D segments are configured.
      let flags = '';
      if (effect.meta.audioReactive) flags += 'f';
      meta += ';' + flags;
    }
    return meta;
  }

  // --- Byte-level emission ---

  _emitByte(b) {
    this.code.push(b & 0xFF);
  }

  _emitI16(v) {
    const v16 = v & 0xFFFF;
    this.code.push(v16 & 0xFF, (v16 >> 8) & 0xFF);
  }

  _emitI32(v) {
    const u = v | 0;
    this.code.push(u & 0xFF, (u >> 8) & 0xFF, (u >> 16) & 0xFF, (u >> 24) & 0xFF);
  }

  // Emit: [op, d, a, b] — 3-operand arithmetic
  _emitArith(op, d, a, b) {
    this._emitByte(op);
    this._emitByte(d);
    this._emitByte(a);
    this._emitByte(b);
  }

  // Emit: [op, d, a] — 2-operand (NEG, NOT, MOV, etc.)
  _emitOp2(op, d, a) {
    this._emitByte(op);
    this._emitByte(d);
    this._emitByte(a);
  }

  _emitLoadImm(reg, value) {
    if (value >= -32768 && value <= 32767) {
      // LDI: [op, d, imm16_lo, imm16_hi] — VM reads d(1) + readI16(2) = 3 operand bytes
      this._emitByte(OP.LDI);
      this._emitByte(reg);
      this._emitI16(value);
    } else {
      // LDI32: [op, d, imm32 (4 bytes)] — VM reads d(1) + readI32(4) = 5 operand bytes
      this._emitByte(OP.LDI32);
      this._emitByte(reg);
      this._emitI32(value);
    }
  }

  // --- Jump emission ---

  _newLabel() { return `_L${this.labelCounter++}`; }

  _placeLabel(label) { this.labels[label] = this.code.length; }

  // JMP: [op, off16] — VM reads readI16(2)
  _emitJmp(label) {
    this._emitByte(OP.JMP);
    const patchOffset = this.code.length;
    this._emitI16(0); // placeholder
    this.patches.push({ offset: patchOffset, label });
  }

  // JZ/JNZ: [op, a, off16] — VM reads readU8(1) + readI16(2)
  _emitJump1(op, a, label) {
    this._emitByte(op);
    this._emitByte(a);
    const patchOffset = this.code.length;
    this._emitI16(0);
    this.patches.push({ offset: patchOffset, label });
  }

  // JLT/JGT/JEQ/JLE/JGE: [op, a, b, off16] — VM reads readU8(1) + readU8(1) + readI16(2)
  _emitJump2(op, a, b, label) {
    this._emitByte(op);
    this._emitByte(a);
    this._emitByte(b);
    const patchOffset = this.code.length;
    this._emitI16(0);
    this.patches.push({ offset: patchOffset, label });
  }

  _resolveLabels() {
    for (const p of this.patches) {
      const target = this.labels[p.label];
      if (target === undefined) {
        throw new CodegenError(`Unresolved label: ${p.label}`);
      }
      // Byte offset relative to the position AFTER the 2-byte offset field
      const afterOffset = p.offset + 2;
      const relBytes = target - afterOffset;
      const rel16 = relBytes & 0xFFFF;
      this.code[p.offset] = rel16 & 0xFF;
      this.code[p.offset + 1] = (rel16 >> 8) & 0xFF;
    }
  }

  // --- Temp register stack ---

  _pushTmp() {
    if (this.tmpDepth >= 5) throw new CodegenError('Expression too complex (max 5 temp registers)');
    return this.tmpBase + this.tmpDepth++;
  }

  _peekTmp() { return this.tmpBase + this.tmpDepth - 1; }

  _popTmp() { this.tmpDepth--; }

  // --- Variable register allocation ---

  _allocVar(name) {
    if (this.vars[name] !== undefined) return this.vars[name];
    if (this.nextReg >= this.maxReg) {
      throw new CodegenError(`Out of registers (max ${this.maxReg} variables)`);
    }
    const reg = this.nextReg++;
    this.vars[name] = reg;
    return reg;
  }

  // Block scoping: save/restore register allocation state so variables
  // inside loops/if blocks have their registers recycled after the block ends.
  _saveScope() { return this.nextReg; }

  _restoreScope(saved) {
    for (const [name, reg] of Object.entries(this.vars)) {
      if (reg >= saved) delete this.vars[name];
    }
    this.nextReg = saved;
  }

  _getVar(name) {
    if (this.vars[name] !== undefined) return { type: 'reg', reg: this.vars[name] };
    if (SPECIAL_VARS[name] !== undefined) return { type: 'special', reg: SPECIAL_VARS[name] };
    if (OPCODE_VARS[name] !== undefined) return { type: 'opcode', info: OPCODE_VARS[name] };
    for (let i = 0; i < this.dataDecls.length; i++) {
      if (this.dataDecls[i].name === name) return { type: 'data', index: i };
    }
    throw new CodegenError(`Undefined variable '${name}'`);
  }

  _evalConstExpr(node) {
    if (node.type === 'Number') return node.value;
    if (node.type === 'Ident' && node.name === 'LEN') return 255;
    if (node.type === 'BinOp') {
      const l = this._evalConstExpr(node.left);
      const r = this._evalConstExpr(node.right);
      switch (node.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return Math.trunc(l / r);
      }
    }
    throw new CodegenError(`Cannot evaluate as constant: ${node.type}`);
  }

  // --- Statement generation ---

  _genStmt(stmt) {
    switch (stmt.type) {
      case 'Let':    return this._genLet(stmt);
      case 'Assign': return this._genAssign(stmt);
      case 'If':     return this._genIf(stmt);
      case 'For':    return this._genFor(stmt);
      case 'While':  return this._genWhile(stmt);
      case 'Frame':  return this._genFrame(stmt);
      case 'Call':   return this._genCallStmt(stmt);
      default:       this._genExpr(stmt, this._pushTmp()); this._popTmp();
    }
  }

  _genLet(stmt) {
    const reg = this._allocVar(stmt.name);
    this._genExpr(stmt.value, reg);
  }

  _genAssign(stmt) {
    const target = stmt.target;
    if (target.type === 'Ident') {
      const v = this._getVar(target.name);
      if (v.type === 'reg') {
        this._genExpr(stmt.value, v.reg);
      } else if (v.type === 'opcode' && v.info.set) {
        const valReg = this._pushTmp();
        this._genExpr(stmt.value, valReg);
        if (v.info.set === OP.SAUX) {
          // SAUX: [op, n, a] — n is aux index, a is value register
          this._emitByte(v.info.set);
          this._emitByte(v.info.idx);
          this._emitByte(valReg);
        } else {
          // SSTP: [op, a] — a is value register (1 operand byte)
          this._emitByte(v.info.set);
          this._emitByte(valReg);
        }
        this._popTmp();
      } else {
        throw new CodegenError(`Cannot assign to '${target.name}'`);
      }
    } else if (target.type === 'Index') {
      // STB: [op, addr_reg, val_reg, offset] — VM reads 3 operand bytes
      const addrReg = this._pushTmp();
      this._genExpr(target.index, addrReg);
      const valReg = this._pushTmp();
      this._genExpr(stmt.value, valReg);
      this._emitByte(OP.STB);
      this._emitByte(addrReg);
      this._emitByte(valReg);
      this._emitByte(0); // offset
      this._popTmp();
      this._popTmp();
    } else {
      throw new CodegenError(`Invalid assignment target: ${target.type}`);
    }
  }

  _genIf(stmt) {
    const elseLabel = this._newLabel();
    const endLabel = this._newLabel();

    const condReg = this._pushTmp();
    this._genExpr(stmt.cond, condReg);
    this._emitJump1(OP.JZ, condReg, stmt.elseBody ? elseLabel : endLabel);
    this._popTmp();

    const thenScope = this._saveScope();
    for (const s of stmt.thenBody) this._genStmt(s);
    this._restoreScope(thenScope);

    if (stmt.elseBody) {
      this._emitJmp(endLabel);
      this._placeLabel(elseLabel);
      const elseScope = this._saveScope();
      for (const s of stmt.elseBody) this._genStmt(s);
      this._restoreScope(elseScope);
    }
    this._placeLabel(endLabel);
  }

  _genFor(stmt) {
    const depth = this.forNest++;
    const outerScope = this._saveScope();

    const varReg = this._allocVar(stmt.varName);
    const endReg = this._allocVar(`__end_${depth}`);
    const stepReg = this._allocVar(`__step_${depth}`);
    const loopTop = this._newLabel();
    const loopEnd = this._newLabel();

    this._genExpr(stmt.start, varReg);
    this._genExpr(stmt.end, endReg);
    if (stmt.step) {
      this._genExpr(stmt.step, stepReg);
    } else {
      this._emitLoadImm(stepReg, 1);
    }

    // Detect step direction for correct loop condition
    const negativeStep = stmt.step && stmt.step.type === 'Number' && stmt.step.value < 0;
    const exitOp = negativeStep ? OP.JLE : OP.JGE;

    this._placeLabel(loopTop);
    this._emitJump2(exitOp, varReg, endReg, loopEnd);

    for (const s of stmt.body) this._genStmt(s);

    this._emitArith(OP.ADD, varReg, varReg, stepReg);
    this._emitJmp(loopTop);
    this._placeLabel(loopEnd);

    this._restoreScope(outerScope);
    this.forNest--;
  }

  _genWhile(stmt) {
    const loopTop = this._newLabel();
    const loopEnd = this._newLabel();

    this._placeLabel(loopTop);
    const condReg = this._pushTmp();
    this._genExpr(stmt.cond, condReg);
    this._emitJump1(OP.JZ, condReg, loopEnd);
    this._popTmp();

    const bodyScope = this._saveScope();
    for (const s of stmt.body) this._genStmt(s);
    this._restoreScope(bodyScope);

    this._emitJmp(loopTop);
    this._placeLabel(loopEnd);
  }

  _genFrame(stmt) {
    if (stmt.delay === null) {
      // frame() — no args: emit HALTS (speed-based delay, no operands)
      this._emitByte(OP.HALTS);
    } else {
      // frame(expr) — explicit delay in ms
      const delayReg = this._pushTmp();
      this._genExpr(stmt.delay, delayReg);
      // HALT: [op, a] — VM reads 1 operand byte
      this._emitByte(OP.HALT);
      this._emitByte(delayReg);
      this._popTmp();
    }
  }

  _genCallStmt(stmt) {
    const fn = BUILTINS[stmt.name];
    if (fn && !fn.hasDestReg) {
      // Void function — no dest register in bytecode, don't waste a temp
      this._genCall(stmt, 0);
    } else {
      // Result-returning function called as statement — discard result
      const tmpReg = this._pushTmp();
      this._genCall(stmt, tmpReg);
      this._popTmp();
    }
  }

  // --- Expression generation ---

  _genExpr(node, destReg) {
    switch (node.type) {
      case 'Number': this._emitLoadImm(destReg, node.value); return;
      case 'Bool':   this._emitLoadImm(destReg, node.value ? 1 : 0); return;
      case 'Ident':  this._genIdent(node.name, destReg); return;
      case 'BinOp':  this._genBinOp(node, destReg); return;
      case 'Unary':  this._genUnary(node, destReg); return;
      case 'Call':   this._genCall(node, destReg); return;
      case 'Index':  this._genIndex(node, destReg); return;
      default: throw new CodegenError(`Cannot generate expression for ${node.type}`);
    }
  }

  _genIdent(name, destReg) {
    const v = this._getVar(name);
    if (v.type === 'reg' || v.type === 'special') {
      if (v.reg !== destReg) this._emitOp2(OP.MOV, destReg, v.reg);
    } else if (v.type === 'opcode') {
      // Opcodes that read 1 byte (GSPD, GINT, GC1-3, GPAL, GSTP): [op, d]
      // Opcodes that read 2 bytes (GCHK, GCOL, GAUX): [op, d, n]
      const info = v.info;
      if (info.idx !== undefined) {
        this._emitOp2(info.get, destReg, info.idx);
      } else {
        this._emitByte(info.get);
        this._emitByte(destReg);
      }
    } else {
      throw new CodegenError(`Cannot read variable '${name}' directly`);
    }
  }

  _genBinOp(node, destReg) {
    const opMap = {
      '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV, '%': OP.MOD,
      '&': OP.AND, '|': OP.OR, '^': OP.XOR, '<<': OP.SHL, '>>': OP.SHR,
    };
    const cmpOps = ['==', '!=', '<', '>', '<=', '>='];

    if (opMap[node.op]) {
      if (destReg >= this.tmpBase) {
        // destReg is a temp register — safe to evaluate left directly into it
        this._genExpr(node.left, destReg);
        const rightReg = this._pushTmp();
        this._genExpr(node.right, rightReg);
        this._emitArith(opMap[node.op], destReg, destReg, rightReg);
        this._popTmp();
      } else {
        // destReg is a variable register — use temps to avoid aliasing bugs
        // (e.g., x = y + x would clobber x if left evaluated into destReg)
        const leftReg = this._pushTmp();
        this._genExpr(node.left, leftReg);
        const rightReg = this._pushTmp();
        this._genExpr(node.right, rightReg);
        this._emitArith(opMap[node.op], destReg, leftReg, rightReg);
        this._popTmp();
        this._popTmp();
      }
    } else if (cmpOps.includes(node.op)) {
      this._genComparison(node, destReg);
    } else if (node.op === 'and') {
      const endLabel = this._newLabel();
      this._genExpr(node.left, destReg);
      this._emitJump1(OP.JZ, destReg, endLabel);
      this._genExpr(node.right, destReg);
      this._placeLabel(endLabel);
    } else if (node.op === 'or') {
      const endLabel = this._newLabel();
      this._genExpr(node.left, destReg);
      this._emitJump1(OP.JNZ, destReg, endLabel);
      this._genExpr(node.right, destReg);
      this._placeLabel(endLabel);
    } else {
      throw new CodegenError(`Unknown binary operator: ${node.op}`);
    }
  }

  _genComparison(node, destReg) {
    // Evaluate left into destReg, right into a temp — uses 1 temp instead of 2.
    // Safe because the comparison jump reads both values before destReg is overwritten with 0/1.
    this._genExpr(node.left, destReg);
    const rightReg = this._pushTmp();
    this._genExpr(node.right, rightReg);

    const trueLabel = this._newLabel();
    const endLabel = this._newLabel();

    if (node.op === '!=') {
      const falseLabel = this._newLabel();
      this._emitJump2(OP.JEQ, destReg, rightReg, falseLabel);
      this._emitLoadImm(destReg, 1);
      this._emitJmp(endLabel);
      this._placeLabel(falseLabel);
      this._emitLoadImm(destReg, 0);
      this._placeLabel(endLabel);
    } else {
      const jmpOp = {
        '==': OP.JEQ, '<': OP.JLT, '>': OP.JGT,
        '<=': OP.JLE, '>=': OP.JGE,
      }[node.op];

      this._emitJump2(jmpOp, destReg, rightReg, trueLabel);
      this._emitLoadImm(destReg, 0);
      this._emitJmp(endLabel);
      this._placeLabel(trueLabel);
      this._emitLoadImm(destReg, 1);
      this._placeLabel(endLabel);
    }
    this._popTmp();
  }

  _genUnary(node, destReg) {
    this._genExpr(node.expr, destReg);
    // NEG/NOT: [op, d, a] — VM reads 2 operand bytes
    switch (node.op) {
      case '-':   this._emitOp2(OP.NEG, destReg, destReg); break;
      case '~':
      case 'not': this._emitOp2(OP.NOT, destReg, destReg); break;
      default: throw new CodegenError(`Unknown unary operator: ${node.op}`);
    }
  }

  _genCall(node, destReg) {
    const fn = BUILTINS[node.name];
    if (!fn) throw new CodegenError(`Unknown function '${node.name}'`);

    // Special: random() has variable args
    if (node.name === 'random') return this._genRandom(node, destReg);

    if (fn.args >= 0 && node.args.length !== fn.args) {
      throw new CodegenError(`${node.name}() expects ${fn.args} args, got ${node.args.length}`);
    }

    // Evaluate all args into temp registers
    const argRegs = [];
    for (let i = 0; i < node.args.length; i++) {
      const reg = this._pushTmp();
      this._genExpr(node.args[i], reg);
      argRegs.push(reg);
    }

    // Emit: [opcode, dest?(if hasDestReg), arg0, arg1, ...]
    this._emitByte(fn.op);
    if (fn.hasDestReg) {
      this._emitByte(destReg);
    }
    for (const r of argRegs) {
      this._emitByte(r);
    }

    // Pop all arg temps
    for (let i = 0; i < node.args.length; i++) {
      this._popTmp();
    }
  }

  _genRandom(node, destReg) {
    if (node.args.length === 0) {
      // RND8: [op, d] — 1 operand byte
      this._emitByte(OP.RND8);
      this._emitByte(destReg);
    } else if (node.args.length === 1) {
      // random(max) → RNDR(0, max): evaluate max into destReg, use temp for zero
      this._genExpr(node.args[0], destReg);
      const zeroReg = this._pushTmp();
      this._emitLoadImm(zeroReg, 0);
      // RNDR: [op, d, a, b] — VM reads all operands before writing result
      this._emitArith(OP.RNDR, destReg, zeroReg, destReg);
      this._popTmp();
    } else if (node.args.length === 2) {
      // Evaluate min into destReg, max into temp
      this._genExpr(node.args[0], destReg);
      const maxReg = this._pushTmp();
      this._genExpr(node.args[1], maxReg);
      this._emitArith(OP.RNDR, destReg, destReg, maxReg);
      this._popTmp();
    } else {
      throw new CodegenError('random() takes 0-2 arguments');
    }
  }

  _genIndex(node, destReg) {
    // LDB: [op, d, addr_reg, offset] — VM reads 3 operand bytes
    const addrReg = this._pushTmp();
    this._genExpr(node.index, addrReg);
    this._emitByte(OP.LDB);
    this._emitByte(destReg);
    this._emitByte(addrReg);
    this._emitByte(0); // offset
    this._popTmp();
  }

  // --- WFX binary builder ---

  _buildWfx(metadata, dataSizeUnits) {
    const metaBytes = Buffer.from(metadata + '\0', 'utf8');
    const bytecodeLen = this.code.length;

    if (bytecodeLen > 65535) {
      throw new CodegenError(`Bytecode too large: ${bytecodeLen} bytes (max 65535)`);
    }

    const header = Buffer.alloc(WFX.HEADER_SIZE);
    header[0] = WFX.MAGIC[0];
    header[1] = WFX.MAGIC[1];
    header[2] = WFX.MAGIC[2];
    header[3] = WFX.VERSION;
    header[4] = this._getFlags();
    header[5] = dataSizeUnits & 0xFF;
    header[6] = bytecodeLen & 0xFF;
    header[7] = (bytecodeLen >> 8) & 0xFF;

    return Buffer.concat([header, metaBytes, Buffer.from(this.code)]);
  }

  _getFlags() {
    let flags = 0;
    if (this.ast.meta) {
      if (this.ast.meta.effectType === '2D') flags |= WFX.FLAG_2D;
      if (this.ast.meta.palette) flags |= WFX.FLAG_PALETTE;
      if (this.ast.meta.audioReactive) flags |= WFX.FLAG_AUDIO;
    }
    return flags;
  }
}

module.exports = { Codegen, CodegenError };
