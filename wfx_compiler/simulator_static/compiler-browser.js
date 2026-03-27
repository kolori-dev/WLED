/**
 * WLED-Lang Compiler — Browser ES Module
 *
 * Bundles lexer, parser, codegen, and opcodes into a single file
 * for in-browser compilation of .wled source to .wfx bytecode.
 *
 * No Node.js dependencies — uses Uint8Array + TextEncoder instead of Buffer.
 */

// ============================================================
// opcodes.js — must match wled_vm.h exactly
// ============================================================

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

const WFX = {
  MAGIC: [0x57, 0x46, 0x58],
  VERSION: 0x01,
  FLAG_2D: 0x01,
  FLAG_PALETTE: 0x02,
  FLAG_AUDIO: 0x04,
  HEADER_SIZE: 8,
};

// ============================================================
// lexer.js
// ============================================================

const T = {
  NUMBER: 'NUMBER', STRING: 'STRING', IDENT: 'IDENT',
  KEYWORD: 'KEYWORD', OP: 'OP', PUNCT: 'PUNCT', EOF: 'EOF',
};

const KEYWORDS = new Set([
  'effect', 'meta', 'render', 'data', 'let',
  'if', 'else', 'for', 'in', 'while', 'step',
  'frame', 'slider', 'type', 'palette',
  'true', 'false', 'and', 'or', 'not',
  'default', 'audio_reactive',
]);

const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '<<', '>>', '..']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '~', '<', '>', '=', '!']);
const PUNCTUATION = new Set(['(', ')', '{', '}', '[', ']', ',', ';']);

class Token {
  constructor(type, value, line, col) {
    this.type = type; this.value = value; this.line = line; this.col = col;
  }
}

class LexerError extends Error {
  constructor(msg, line, col) {
    super(`Lexer error at ${line}:${col}: ${msg}`);
    this.line = line; this.col = col;
  }
}

class Lexer {
  constructor(source) {
    this.source = source; this.pos = 0; this.line = 1; this.col = 1;
    this.tokens = []; this._tokenize(); this._index = 0;
  }
  _peek() { return this.pos < this.source.length ? this.source[this.pos] : null; }
  _advance() {
    const ch = this.source[this.pos++];
    if (ch === '\n') { this.line++; this.col = 1; } else { this.col++; }
    return ch;
  }
  _skipWhitespace() {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { this._advance(); }
      else if (ch === '/' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '/') {
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') this._advance();
      } else break;
    }
  }
  _readString() {
    const startLine = this.line, startCol = this.col;
    const quote = this._advance();
    let str = '';
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === quote) { this._advance(); return new Token(T.STRING, str, startLine, startCol); }
      if (ch === '\\') {
        this._advance();
        const esc = this._advance();
        switch (esc) {
          case 'n': str += '\n'; break; case 't': str += '\t'; break;
          case '\\': str += '\\'; break; case '"': str += '"'; break;
          case "'": str += "'"; break; default: str += esc;
        }
      } else { str += this._advance(); }
    }
    throw new LexerError('Unterminated string', startLine, startCol);
  }
  _readNumber() {
    const startLine = this.line, startCol = this.col;
    let num = '';
    if (this.source[this.pos] === '0' && this.pos + 1 < this.source.length &&
        (this.source[this.pos + 1] === 'x' || this.source[this.pos + 1] === 'X')) {
      num += this._advance(); num += this._advance();
      while (this.pos < this.source.length && /[0-9a-fA-F]/.test(this.source[this.pos])) num += this._advance();
      if (num.length === 2) throw new LexerError('Invalid hex literal', startLine, startCol);
      return new Token(T.NUMBER, parseInt(num, 16), startLine, startCol);
    }
    while (this.pos < this.source.length && /[0-9]/.test(this.source[this.pos])) num += this._advance();
    if ((num === '1' || num === '2') && this.pos < this.source.length && this.source[this.pos] === 'D') {
      num += this._advance();
      return new Token(T.KEYWORD, num, startLine, startCol);
    }
    return new Token(T.NUMBER, parseInt(num, 10), startLine, startCol);
  }
  _readIdentOrKeyword() {
    const startLine = this.line, startCol = this.col;
    let word = '';
    while (this.pos < this.source.length && /[a-zA-Z0-9_]/.test(this.source[this.pos])) word += this._advance();
    if (word === '1D' || word === '2D') return new Token(T.KEYWORD, word, startLine, startCol);
    if (KEYWORDS.has(word)) return new Token(T.KEYWORD, word, startLine, startCol);
    return new Token(T.IDENT, word, startLine, startCol);
  }
  _tokenize() {
    while (this.pos < this.source.length) {
      this._skipWhitespace();
      if (this.pos >= this.source.length) break;
      const ch = this.source[this.pos];
      const startLine = this.line, startCol = this.col;
      if (ch === '"' || ch === "'") { this.tokens.push(this._readString()); continue; }
      if (/[0-9]/.test(ch)) { this.tokens.push(this._readNumber()); continue; }
      if (/[a-zA-Z_]/.test(ch)) { this.tokens.push(this._readIdentOrKeyword()); continue; }
      if (this.pos + 1 < this.source.length) {
        const two = this.source[this.pos] + this.source[this.pos + 1];
        if (TWO_CHAR_OPS.has(two)) { this._advance(); this._advance(); this.tokens.push(new Token(T.OP, two, startLine, startCol)); continue; }
      }
      if (PUNCTUATION.has(ch)) { this._advance(); this.tokens.push(new Token(T.PUNCT, ch, startLine, startCol)); continue; }
      if (ONE_CHAR_OPS.has(ch)) { this._advance(); this.tokens.push(new Token(T.OP, ch, startLine, startCol)); continue; }
      throw new LexerError(`Unexpected character '${ch}'`, startLine, startCol);
    }
    this.tokens.push(new Token(T.EOF, null, this.line, this.col));
  }
  peek() { return this.tokens[this._index]; }
  next() { return this.tokens[this._index++]; }
  expect(type, value) {
    const tok = this.peek();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      const expected = value !== undefined ? `${type}(${value})` : type;
      throw new LexerError(`Expected ${expected}, got ${tok.type}(${tok.value})`, tok.line, tok.col);
    }
    return this.next();
  }
  check(type, value) {
    const tok = this.peek();
    return tok.type === type && (value === undefined || tok.value === value);
  }
  match(type, value) { if (this.check(type, value)) return this.next(); return null; }
}

// ============================================================
// parser.js
// ============================================================

class ParseError extends Error {
  constructor(msg, line, col) {
    super(`Parse error at ${line}:${col}: ${msg}`);
    this.line = line; this.col = col;
  }
}

function parserError(msg, tok) { throw new ParseError(msg, tok.line, tok.col); }

const Node = {
  Effect:   (name, meta, dataDecls, renderBody) => ({ type: 'Effect', name, meta, dataDecls, renderBody }),
  Meta:     (sliders, effectType, palette, audioReactive) => ({ type: 'Meta', sliders, effectType, palette, audioReactive }),
  Slider:   (name, label, defaultVal) => ({ type: 'Slider', name, label, defaultVal }),
  DataDecl: (name, sizeExpr) => ({ type: 'DataDecl', name, sizeExpr }),
  Let:      (name, value) => ({ type: 'Let', name, value }),
  Assign:   (target, value) => ({ type: 'Assign', target, value }),
  If:       (cond, thenBody, elseBody) => ({ type: 'If', cond, thenBody, elseBody }),
  For:      (varName, start, end, step, body) => ({ type: 'For', varName, start, end, step, body }),
  While:    (cond, body) => ({ type: 'While', cond, body }),
  Frame:    (delay) => ({ type: 'Frame', delay }),
  Call:     (name, args) => ({ type: 'Call', name, args }),
  BinOp:    (op, left, right) => ({ type: 'BinOp', op, left, right }),
  Unary:    (op, expr) => ({ type: 'Unary', op, expr }),
  Index:    (array, index) => ({ type: 'Index', array, index }),
  Ident:    (name) => ({ type: 'Ident', name }),
  Number:   (value) => ({ type: 'Number', value }),
  Bool:     (value) => ({ type: 'Bool', value }),
};

class Parser {
  constructor(source) { this.lex = new Lexer(source); }
  parse() { const effect = this._effectDecl(); this.lex.expect(T.EOF); return effect; }

  _effectDecl() {
    this.lex.expect(T.KEYWORD, 'effect');
    const name = this.lex.expect(T.STRING).value;
    this.lex.expect(T.PUNCT, '{');
    let meta = null; const dataDecls = []; let renderBody = null;
    while (!this.lex.check(T.PUNCT, '}')) {
      if (this.lex.check(T.KEYWORD, 'meta')) meta = this._metaBlock();
      else if (this.lex.check(T.KEYWORD, 'data')) dataDecls.push(this._dataDecl());
      else if (this.lex.check(T.KEYWORD, 'render')) renderBody = this._renderBlock();
      else { const tok = this.lex.peek(); parserError(`Unexpected token '${tok.value}' in effect body`, tok); }
    }
    this.lex.expect(T.PUNCT, '}');
    if (!renderBody) parserError('Effect must have a render block', this.lex.peek());
    return Node.Effect(name, meta, dataDecls, renderBody);
  }

  _metaBlock() {
    this.lex.expect(T.KEYWORD, 'meta'); this.lex.expect(T.PUNCT, '{');
    const sliders = []; let effectType = '1D'; let palette = false; let audioReactive = false;
    while (!this.lex.check(T.PUNCT, '}')) {
      if (this.lex.match(T.KEYWORD, 'slider')) {
        const name = this.lex.expect(T.IDENT).value;
        const label = this.lex.expect(T.STRING).value;
        let defaultVal = null;
        if (this.lex.match(T.KEYWORD, 'default')) defaultVal = this._expr();
        sliders.push(Node.Slider(name, label, defaultVal));
      } else if (this.lex.match(T.KEYWORD, 'type')) {
        const tok = this.lex.expect(T.KEYWORD);
        if (tok.value !== '1D' && tok.value !== '2D') parserError(`Expected '1D' or '2D', got '${tok.value}'`, tok);
        effectType = tok.value;
      } else if (this.lex.match(T.KEYWORD, 'palette')) {
        const tok = this.lex.expect(T.KEYWORD);
        palette = tok.value === 'true';
      } else if (this.lex.match(T.KEYWORD, 'audio_reactive')) {
        const tok = this.lex.expect(T.KEYWORD);
        audioReactive = tok.value === 'true';
      } else { const tok = this.lex.peek(); parserError(`Unexpected token '${tok.value}' in meta block`, tok); }
    }
    this.lex.expect(T.PUNCT, '}');
    return Node.Meta(sliders, effectType, palette, audioReactive);
  }

  _dataDecl() {
    this.lex.expect(T.KEYWORD, 'data');
    const name = this.lex.expect(T.IDENT).value;
    this.lex.expect(T.PUNCT, '[');
    const sizeExpr = this._expr();
    this.lex.expect(T.PUNCT, ']');
    return Node.DataDecl(name, sizeExpr);
  }

  _renderBlock() {
    this.lex.expect(T.KEYWORD, 'render'); this.lex.expect(T.PUNCT, '{');
    const stmts = this._stmtList(); this.lex.expect(T.PUNCT, '}');
    return stmts;
  }

  _stmtList() {
    const stmts = [];
    while (!this.lex.check(T.PUNCT, '}') && !this.lex.check(T.EOF)) stmts.push(this._stmt());
    return stmts;
  }

  _stmt() {
    if (this.lex.check(T.KEYWORD, 'let')) return this._letStmt();
    if (this.lex.check(T.KEYWORD, 'if')) return this._ifStmt();
    if (this.lex.check(T.KEYWORD, 'for')) return this._forStmt();
    if (this.lex.check(T.KEYWORD, 'while')) return this._whileStmt();
    if (this.lex.check(T.KEYWORD, 'frame')) return this._frameStmt();
    const expr = this._expr();
    if (this.lex.match(T.OP, '=')) { const value = this._expr(); return Node.Assign(expr, value); }
    return expr;
  }

  _letStmt() {
    this.lex.expect(T.KEYWORD, 'let');
    const name = this.lex.expect(T.IDENT).value;
    this.lex.expect(T.OP, '=');
    return Node.Let(name, this._expr());
  }

  _ifStmt() {
    this.lex.expect(T.KEYWORD, 'if');
    const cond = this._expr();
    this.lex.expect(T.PUNCT, '{');
    const thenBody = this._stmtList();
    this.lex.expect(T.PUNCT, '}');
    let elseBody = null;
    if (this.lex.match(T.KEYWORD, 'else')) {
      if (this.lex.check(T.KEYWORD, 'if')) { elseBody = [this._ifStmt()]; }
      else { this.lex.expect(T.PUNCT, '{'); elseBody = this._stmtList(); this.lex.expect(T.PUNCT, '}'); }
    }
    return Node.If(cond, thenBody, elseBody);
  }

  _forStmt() {
    this.lex.expect(T.KEYWORD, 'for');
    const varName = this.lex.expect(T.IDENT).value;
    this.lex.expect(T.KEYWORD, 'in');
    const start = this._expr();
    this.lex.expect(T.OP, '..');
    const end = this._expr();
    let step = null;
    if (this.lex.match(T.KEYWORD, 'step')) step = this._expr();
    this.lex.expect(T.PUNCT, '{');
    const body = this._stmtList();
    this.lex.expect(T.PUNCT, '}');
    return Node.For(varName, start, end, step, body);
  }

  _whileStmt() {
    this.lex.expect(T.KEYWORD, 'while');
    const cond = this._expr();
    this.lex.expect(T.PUNCT, '{');
    const body = this._stmtList();
    this.lex.expect(T.PUNCT, '}');
    return Node.While(cond, body);
  }

  _frameStmt() {
    this.lex.expect(T.KEYWORD, 'frame');
    this.lex.expect(T.PUNCT, '(');
    let delay = null;
    if (!this.lex.check(T.PUNCT, ')')) delay = this._expr();
    this.lex.expect(T.PUNCT, ')');
    return Node.Frame(delay);
  }

  _expr() { return this._orExpr(); }

  _orExpr() {
    let left = this._andExpr();
    while (this.lex.match(T.KEYWORD, 'or')) left = Node.BinOp('or', left, this._andExpr());
    return left;
  }

  _andExpr() {
    let left = this._cmpExpr();
    while (this.lex.match(T.KEYWORD, 'and')) left = Node.BinOp('and', left, this._cmpExpr());
    return left;
  }

  _cmpExpr() {
    let left = this._addExpr();
    const cmpOps = ['==', '!=', '<', '>', '<=', '>='];
    const tok = this.lex.peek();
    if (tok.type === T.OP && cmpOps.includes(tok.value)) {
      const op = this.lex.next().value;
      left = Node.BinOp(op, left, this._addExpr());
    }
    return left;
  }

  _addExpr() {
    let left = this._mulExpr();
    while (true) {
      const tok = this.lex.peek();
      if (tok.type === T.OP && (tok.value === '+' || tok.value === '-' || tok.value === '|' || tok.value === '^')) {
        left = Node.BinOp(this.lex.next().value, left, this._mulExpr());
      } else break;
    }
    return left;
  }

  _mulExpr() {
    let left = this._unaryExpr();
    while (true) {
      const tok = this.lex.peek();
      if (tok.type === T.OP && (tok.value === '*' || tok.value === '/' || tok.value === '%' ||
          tok.value === '&' || tok.value === '<<' || tok.value === '>>')) {
        left = Node.BinOp(this.lex.next().value, left, this._unaryExpr());
      } else break;
    }
    return left;
  }

  _unaryExpr() {
    if (this.lex.check(T.OP, '-')) { this.lex.next(); return Node.Unary('-', this._unaryExpr()); }
    if (this.lex.check(T.KEYWORD, 'not')) { this.lex.next(); return Node.Unary('not', this._unaryExpr()); }
    if (this.lex.check(T.OP, '~')) { this.lex.next(); return Node.Unary('~', this._unaryExpr()); }
    return this._postfixExpr();
  }

  _postfixExpr() {
    let expr = this._primary();
    while (true) {
      if (this.lex.check(T.PUNCT, '(')) {
        this.lex.next();
        const args = [];
        if (!this.lex.check(T.PUNCT, ')')) {
          args.push(this._expr());
          while (this.lex.match(T.PUNCT, ',')) args.push(this._expr());
        }
        this.lex.expect(T.PUNCT, ')');
        if (expr.type === 'Ident') expr = Node.Call(expr.name, args);
        else parserError('Expected function name before ()', this.lex.peek());
      } else if (this.lex.check(T.PUNCT, '[')) {
        this.lex.next();
        const index = this._expr();
        this.lex.expect(T.PUNCT, ']');
        expr = Node.Index(expr, index);
      } else break;
    }
    return expr;
  }

  _primary() {
    if (this.lex.check(T.NUMBER)) return Node.Number(this.lex.next().value);
    if (this.lex.check(T.KEYWORD, 'true')) { this.lex.next(); return Node.Bool(true); }
    if (this.lex.check(T.KEYWORD, 'false')) { this.lex.next(); return Node.Bool(false); }
    if (this.lex.check(T.IDENT)) return Node.Ident(this.lex.next().value);
    if (this.lex.check(T.KEYWORD, 'palette')) return Node.Ident(this.lex.next().value);
    if (this.lex.match(T.PUNCT, '(')) { const expr = this._expr(); this.lex.expect(T.PUNCT, ')'); return expr; }
    const tok = this.lex.peek();
    parserError(`Unexpected token '${tok.value}'`, tok);
  }
}

// ============================================================
// codegen.js
// ============================================================

class CodegenError extends Error {
  constructor(msg) { super(`Codegen error: ${msg}`); }
}

const BUILTINS = {
  pixel:       { op: OP.SPXC, args: 2, hasDestReg: false, vmOperands: 2 },
  pixel2d:     { op: OP.SPXY, args: 3, hasDestReg: false, vmOperands: 3 },
  fill:        { op: OP.FILL, args: 1, hasDestReg: false, vmOperands: 1 },
  fade:        { op: OP.FADE, args: 1, hasDestReg: false, vmOperands: 1 },
  blur:        { op: OP.BLUR, args: 1, hasDestReg: false, vmOperands: 1 },
  blur2d:      { op: OP.BLR2, args: 1, hasDestReg: false, vmOperands: 1 },
  get_pixel:   { op: OP.GPXC, args: 1, hasDestReg: true, vmOperands: 2 },
  get_pixel2d: { op: OP.GPXY, args: 2, hasDestReg: true, vmOperands: 3 },
  rgb:         { op: OP.RGB,   args: 3, hasDestReg: true, vmOperands: 4 },
  rgbw:        { op: OP.RGBW,  args: 4, hasDestReg: true, vmOperands: 5 },
  blend:       { op: OP.CBLND, args: 3, hasDestReg: true, vmOperands: 4 },
  color_fade:  { op: OP.CFADE, args: 2, hasDestReg: true, vmOperands: 3 },
  color_add:   { op: OP.CADD,  args: 2, hasDestReg: true, vmOperands: 3 },
  palette:     { op: OP.CPAL,  args: 1, hasDestReg: true, vmOperands: 2 },
  palette_x:   { op: OP.CPALX, args: 3, hasDestReg: true, vmOperands: 4 },
  color_wheel: { op: OP.CWHL,  args: 1, hasDestReg: true, vmOperands: 2 },
  red:         { op: OP.EXTR, args: 1, hasDestReg: true, vmOperands: 2 },
  green:       { op: OP.EXTG, args: 1, hasDestReg: true, vmOperands: 2 },
  blue:        { op: OP.EXTB, args: 1, hasDestReg: true, vmOperands: 2 },
  white:       { op: OP.EXTW, args: 1, hasDestReg: true, vmOperands: 2 },
  sin8:        { op: OP.SIN8,  args: 1, hasDestReg: true, vmOperands: 2 },
  cos8:        { op: OP.COS8,  args: 1, hasDestReg: true, vmOperands: 2 },
  sin16:       { op: OP.SIN16, args: 1, hasDestReg: true, vmOperands: 2 },
  beat8:       { op: OP.BEAT8, args: 3, hasDestReg: true, vmOperands: 4 },
  tri8:        { op: OP.TRI8,  args: 1, hasDestReg: true, vmOperands: 2 },
  quad8:       { op: OP.QAD8,  args: 1, hasDestReg: true, vmOperands: 2 },
  scale8:      { op: OP.SCL8,  args: 2, hasDestReg: true, vmOperands: 3 },
  qadd8:       { op: OP.QADD8, args: 2, hasDestReg: true, vmOperands: 3 },
  qsub8:       { op: OP.QSUB8, args: 2, hasDestReg: true, vmOperands: 3 },
  random:      { op: OP.RND8,  args: -1, hasDestReg: true, vmOperands: 1 },
  random16:    { op: OP.RND16, args: 0, hasDestReg: true, vmOperands: 1 },
  noise:       { op: OP.NOISE, args: 1, hasDestReg: true, vmOperands: 2 },
  noise2:      { op: OP.NOI2,  args: 2, hasDestReg: true, vmOperands: 3 },
  noise3:      { op: OP.NOI3,  args: 3, hasDestReg: true, vmOperands: 4 },
  sqrt:        { op: OP.SQRT,  args: 1, hasDestReg: true, vmOperands: 2 },
  abs:         { op: OP.ABS,   args: 1, hasDestReg: true, vmOperands: 2 },
  min:         { op: OP.MIN,   args: 2, hasDestReg: true, vmOperands: 3 },
  max:         { op: OP.MAX,   args: 2, hasDestReg: true, vmOperands: 3 },
  fft:          { op: OP.GFFT,  args: 1, hasDestReg: true, vmOperands: 2 },
  audio_bass:   { op: OP.ABASS, args: 0, hasDestReg: true, vmOperands: 1 },
  audio_mid:    { op: OP.AMID,  args: 0, hasDestReg: true, vmOperands: 1 },
  audio_treble: { op: OP.ATREB, args: 0, hasDestReg: true, vmOperands: 1 },
  alloc:       { op: OP.ALLOC, args: 1, hasDestReg: false, vmOperands: 1 },
  draw_line:   { op: OP.DLINE, args: 5, hasDestReg: false, vmOperands: 5 },
  draw_circle: { op: OP.DCIRC, args: 4, hasDestReg: false, vmOperands: 4 },
  fill_circle: { op: OP.FCIRC, args: 4, hasDestReg: false, vmOperands: 4 },
  move_pixels: { op: OP.MOVEP, args: 3, hasDestReg: false, vmOperands: 3 },
  draw_char:   { op: OP.DCHR, args: 5, hasDestReg: false, vmOperands: 5 },
  name_char:   { op: OP.GCHR, args: 1, hasDestReg: true,  vmOperands: 2 },
  name_len:    { op: OP.GNLN, args: 0, hasDestReg: true,  vmOperands: 1 },
  font_w:      { op: OP.GFNW, args: 1, hasDestReg: true,  vmOperands: 2 },
  font_h:      { op: OP.GFNH, args: 1, hasDestReg: true,  vmOperands: 2 },
};

const SPECIAL_VARS = {
  speed: REG.P0, intensity: REG.P1, custom1: REG.P2, custom2: REG.P3,
  LEN: REG.LEN, NOW: REG.NOW, CALL: REG.CALL, WIDTH: REG.WIDTH, HEIGHT: REG.HEIGHT,
};

const OPCODE_VARS = {
  custom3:  { get: OP.GC3 },
  check1:   { get: OP.GCHK, idx: 0 }, check2: { get: OP.GCHK, idx: 1 }, check3: { get: OP.GCHK, idx: 2 },
  color0:   { get: OP.GCOL, idx: 0 }, color1: { get: OP.GCOL, idx: 1 }, color2: { get: OP.GCOL, idx: 2 },
  aux0:     { get: OP.GAUX, set: OP.SAUX, idx: 0 },
  aux1:     { get: OP.GAUX, set: OP.SAUX, idx: 1 },
  step_val: { get: OP.GSTP, set: OP.SSTP },
  volume:   { get: OP.GVOL },
  peak:     { get: OP.GPEAK },
};

class Codegen {
  constructor(ast) {
    this.ast = ast; this.code = []; this.vars = {}; this.nextReg = 0;
    this.maxReg = 11; this.tmpBase = 11; this.tmpDepth = 0; this.forNest = 0;
    this.dataDecls = []; this.labelCounter = 0; this.patches = []; this.labels = {};
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
      this._emitByte(OP.ALLOC); this._emitByte(this._peekTmp()); this._popTmp();
    }
    for (const stmt of effect.renderBody) this._genStmt(stmt);
    this._emitByte(OP.HALTS);
    this._resolveLabels();
    return this._buildWfx(metadata, dataSizeUnits);
  }

  _buildMetadata(effect) {
    let meta = effect.name;
    if (effect.meta) {
      meta += '@';
      const sliderPos = { speed: 0, intensity: 1, custom1: 2, custom2: 3, custom3: 4 };
      const labels = ['', '', '', '', ''];
      for (const s of effect.meta.sliders) {
        const pos = sliderPos[s.name];
        if (pos !== undefined) labels[pos] = s.label;
      }
      while (labels.length > 0 && labels[labels.length - 1] === '') labels.pop();
      meta += labels.join(',');
      meta += ';!';
      meta += ';' + (effect.meta.palette ? '!' : '');
      let flags = '';
      if (effect.meta.audioReactive) flags += 'f';
      meta += ';' + flags;
    }
    return meta;
  }

  _emitByte(b) { this.code.push(b & 0xFF); }
  _emitI16(v) { const v16 = v & 0xFFFF; this.code.push(v16 & 0xFF, (v16 >> 8) & 0xFF); }
  _emitI32(v) { const u = v | 0; this.code.push(u & 0xFF, (u >> 8) & 0xFF, (u >> 16) & 0xFF, (u >> 24) & 0xFF); }
  _emitArith(op, d, a, b) { this._emitByte(op); this._emitByte(d); this._emitByte(a); this._emitByte(b); }
  _emitOp2(op, d, a) { this._emitByte(op); this._emitByte(d); this._emitByte(a); }

  _emitLoadImm(reg, value) {
    if (value >= -32768 && value <= 32767) {
      this._emitByte(OP.LDI); this._emitByte(reg); this._emitI16(value);
    } else {
      this._emitByte(OP.LDI32); this._emitByte(reg); this._emitI32(value);
    }
  }

  _newLabel() { return `_L${this.labelCounter++}`; }
  _placeLabel(label) { this.labels[label] = this.code.length; }

  _emitJmp(label) {
    this._emitByte(OP.JMP);
    this.patches.push({ offset: this.code.length, label });
    this._emitI16(0);
  }
  _emitJump1(op, a, label) {
    this._emitByte(op); this._emitByte(a);
    this.patches.push({ offset: this.code.length, label });
    this._emitI16(0);
  }
  _emitJump2(op, a, b, label) {
    this._emitByte(op); this._emitByte(a); this._emitByte(b);
    this.patches.push({ offset: this.code.length, label });
    this._emitI16(0);
  }

  _resolveLabels() {
    for (const p of this.patches) {
      const target = this.labels[p.label];
      if (target === undefined) throw new CodegenError(`Unresolved label: ${p.label}`);
      const afterOffset = p.offset + 2;
      const relBytes = target - afterOffset;
      const rel16 = relBytes & 0xFFFF;
      this.code[p.offset] = rel16 & 0xFF;
      this.code[p.offset + 1] = (rel16 >> 8) & 0xFF;
    }
  }

  _pushTmp() {
    if (this.tmpDepth >= 5) throw new CodegenError('Expression too complex (max 5 temp registers)');
    return this.tmpBase + this.tmpDepth++;
  }
  _peekTmp() { return this.tmpBase + this.tmpDepth - 1; }
  _popTmp() { this.tmpDepth--; }

  _allocVar(name) {
    if (this.vars[name] !== undefined) return this.vars[name];
    if (this.nextReg >= this.maxReg) throw new CodegenError(`Out of registers (max ${this.maxReg} variables)`);
    const reg = this.nextReg++; this.vars[name] = reg; return reg;
  }
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
      const l = this._evalConstExpr(node.left), r = this._evalConstExpr(node.right);
      switch (node.op) {
        case '+': return l + r; case '-': return l - r;
        case '*': return l * r; case '/': return Math.trunc(l / r);
      }
    }
    throw new CodegenError(`Cannot evaluate as constant: ${node.type}`);
  }

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

  _genLet(stmt) { const reg = this._allocVar(stmt.name); this._genExpr(stmt.value, reg); }

  _genAssign(stmt) {
    const target = stmt.target;
    if (target.type === 'Ident') {
      const v = this._getVar(target.name);
      if (v.type === 'reg') { this._genExpr(stmt.value, v.reg); }
      else if (v.type === 'opcode' && v.info.set) {
        const valReg = this._pushTmp(); this._genExpr(stmt.value, valReg);
        if (v.info.set === OP.SAUX) {
          this._emitByte(v.info.set); this._emitByte(v.info.idx); this._emitByte(valReg);
        } else { this._emitByte(v.info.set); this._emitByte(valReg); }
        this._popTmp();
      } else throw new CodegenError(`Cannot assign to '${target.name}'`);
    } else if (target.type === 'Index') {
      const addrReg = this._pushTmp(); this._genExpr(target.index, addrReg);
      const valReg = this._pushTmp(); this._genExpr(stmt.value, valReg);
      this._emitByte(OP.STB); this._emitByte(addrReg); this._emitByte(valReg); this._emitByte(0);
      this._popTmp(); this._popTmp();
    } else throw new CodegenError(`Invalid assignment target: ${target.type}`);
  }

  _genIf(stmt) {
    const elseLabel = this._newLabel(), endLabel = this._newLabel();
    const condReg = this._pushTmp(); this._genExpr(stmt.cond, condReg);
    this._emitJump1(OP.JZ, condReg, stmt.elseBody ? elseLabel : endLabel); this._popTmp();
    const thenScope = this._saveScope();
    for (const s of stmt.thenBody) this._genStmt(s);
    this._restoreScope(thenScope);
    if (stmt.elseBody) {
      this._emitJmp(endLabel); this._placeLabel(elseLabel);
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
    const loopTop = this._newLabel(), loopEnd = this._newLabel();
    this._genExpr(stmt.start, varReg); this._genExpr(stmt.end, endReg);
    if (stmt.step) this._genExpr(stmt.step, stepReg);
    else this._emitLoadImm(stepReg, 1);
    const negativeStep = stmt.step && stmt.step.type === 'Number' && stmt.step.value < 0;
    const exitOp = negativeStep ? OP.JLE : OP.JGE;
    this._placeLabel(loopTop); this._emitJump2(exitOp, varReg, endReg, loopEnd);
    for (const s of stmt.body) this._genStmt(s);
    this._emitArith(OP.ADD, varReg, varReg, stepReg); this._emitJmp(loopTop);
    this._placeLabel(loopEnd); this._restoreScope(outerScope); this.forNest--;
  }

  _genWhile(stmt) {
    const loopTop = this._newLabel(), loopEnd = this._newLabel();
    this._placeLabel(loopTop);
    const condReg = this._pushTmp(); this._genExpr(stmt.cond, condReg);
    this._emitJump1(OP.JZ, condReg, loopEnd); this._popTmp();
    const bodyScope = this._saveScope();
    for (const s of stmt.body) this._genStmt(s);
    this._restoreScope(bodyScope);
    this._emitJmp(loopTop); this._placeLabel(loopEnd);
  }

  _genFrame(stmt) {
    if (stmt.delay === null) { this._emitByte(OP.HALTS); }
    else {
      const delayReg = this._pushTmp(); this._genExpr(stmt.delay, delayReg);
      this._emitByte(OP.HALT); this._emitByte(delayReg); this._popTmp();
    }
  }

  _genCallStmt(stmt) {
    const fn = BUILTINS[stmt.name];
    if (fn && !fn.hasDestReg) { this._genCall(stmt, 0); }
    else { const tmpReg = this._pushTmp(); this._genCall(stmt, tmpReg); this._popTmp(); }
  }

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
      const info = v.info;
      if (info.idx !== undefined) { this._emitOp2(info.get, destReg, info.idx); }
      else { this._emitByte(info.get); this._emitByte(destReg); }
    } else throw new CodegenError(`Cannot read variable '${name}' directly`);
  }

  _genBinOp(node, destReg) {
    const opMap = {
      '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV, '%': OP.MOD,
      '&': OP.AND, '|': OP.OR, '^': OP.XOR, '<<': OP.SHL, '>>': OP.SHR,
    };
    const cmpOps = ['==', '!=', '<', '>', '<=', '>='];
    if (opMap[node.op]) {
      if (destReg >= this.tmpBase) {
        this._genExpr(node.left, destReg);
        const rightReg = this._pushTmp(); this._genExpr(node.right, rightReg);
        this._emitArith(opMap[node.op], destReg, destReg, rightReg); this._popTmp();
      } else {
        const leftReg = this._pushTmp(); this._genExpr(node.left, leftReg);
        const rightReg = this._pushTmp(); this._genExpr(node.right, rightReg);
        this._emitArith(opMap[node.op], destReg, leftReg, rightReg);
        this._popTmp(); this._popTmp();
      }
    } else if (cmpOps.includes(node.op)) { this._genComparison(node, destReg); }
    else if (node.op === 'and') {
      const endLabel = this._newLabel();
      this._genExpr(node.left, destReg); this._emitJump1(OP.JZ, destReg, endLabel);
      this._genExpr(node.right, destReg); this._placeLabel(endLabel);
    } else if (node.op === 'or') {
      const endLabel = this._newLabel();
      this._genExpr(node.left, destReg); this._emitJump1(OP.JNZ, destReg, endLabel);
      this._genExpr(node.right, destReg); this._placeLabel(endLabel);
    } else throw new CodegenError(`Unknown binary operator: ${node.op}`);
  }

  _genComparison(node, destReg) {
    this._genExpr(node.left, destReg);
    const rightReg = this._pushTmp(); this._genExpr(node.right, rightReg);
    const trueLabel = this._newLabel(), endLabel = this._newLabel();
    if (node.op === '!=') {
      const falseLabel = this._newLabel();
      this._emitJump2(OP.JEQ, destReg, rightReg, falseLabel);
      this._emitLoadImm(destReg, 1); this._emitJmp(endLabel);
      this._placeLabel(falseLabel); this._emitLoadImm(destReg, 0);
      this._placeLabel(endLabel);
    } else {
      const jmpOp = { '==': OP.JEQ, '<': OP.JLT, '>': OP.JGT, '<=': OP.JLE, '>=': OP.JGE }[node.op];
      this._emitJump2(jmpOp, destReg, rightReg, trueLabel);
      this._emitLoadImm(destReg, 0); this._emitJmp(endLabel);
      this._placeLabel(trueLabel); this._emitLoadImm(destReg, 1);
      this._placeLabel(endLabel);
    }
    this._popTmp();
  }

  _genUnary(node, destReg) {
    this._genExpr(node.expr, destReg);
    switch (node.op) {
      case '-':   this._emitOp2(OP.NEG, destReg, destReg); break;
      case '~': case 'not': this._emitOp2(OP.NOT, destReg, destReg); break;
      default: throw new CodegenError(`Unknown unary operator: ${node.op}`);
    }
  }

  _genCall(node, destReg) {
    const fn = BUILTINS[node.name];
    if (!fn) throw new CodegenError(`Unknown function '${node.name}'`);
    if (node.name === 'random') return this._genRandom(node, destReg);
    if (fn.args >= 0 && node.args.length !== fn.args)
      throw new CodegenError(`${node.name}() expects ${fn.args} args, got ${node.args.length}`);
    const argRegs = [];
    for (let i = 0; i < node.args.length; i++) {
      const reg = this._pushTmp(); this._genExpr(node.args[i], reg); argRegs.push(reg);
    }
    this._emitByte(fn.op);
    if (fn.hasDestReg) this._emitByte(destReg);
    for (const r of argRegs) this._emitByte(r);
    for (let i = 0; i < node.args.length; i++) this._popTmp();
  }

  _genRandom(node, destReg) {
    if (node.args.length === 0) { this._emitByte(OP.RND8); this._emitByte(destReg); }
    else if (node.args.length === 1) {
      this._genExpr(node.args[0], destReg);
      const zeroReg = this._pushTmp(); this._emitLoadImm(zeroReg, 0);
      this._emitArith(OP.RNDR, destReg, zeroReg, destReg); this._popTmp();
    } else if (node.args.length === 2) {
      this._genExpr(node.args[0], destReg);
      const maxReg = this._pushTmp(); this._genExpr(node.args[1], maxReg);
      this._emitArith(OP.RNDR, destReg, destReg, maxReg); this._popTmp();
    } else throw new CodegenError('random() takes 0-2 arguments');
  }

  _genIndex(node, destReg) {
    const addrReg = this._pushTmp(); this._genExpr(node.index, addrReg);
    this._emitByte(OP.LDB); this._emitByte(destReg); this._emitByte(addrReg); this._emitByte(0);
    this._popTmp();
  }

  // --- WFX binary builder (browser-compatible, no Buffer) ---
  _buildWfx(metadata, dataSizeUnits) {
    const encoder = new TextEncoder();
    const metaBytes = encoder.encode(metadata + '\0');
    const bytecodeLen = this.code.length;
    if (bytecodeLen > 65535) throw new CodegenError(`Bytecode too large: ${bytecodeLen} bytes (max 65535)`);

    const header = new Uint8Array(WFX.HEADER_SIZE);
    header[0] = WFX.MAGIC[0]; header[1] = WFX.MAGIC[1]; header[2] = WFX.MAGIC[2];
    header[3] = WFX.VERSION;
    header[4] = this._getFlags();
    header[5] = dataSizeUnits & 0xFF;
    header[6] = bytecodeLen & 0xFF;
    header[7] = (bytecodeLen >> 8) & 0xFF;

    const result = new Uint8Array(header.length + metaBytes.length + this.code.length);
    result.set(header, 0);
    result.set(metaBytes, header.length);
    result.set(new Uint8Array(this.code), header.length + metaBytes.length);
    return result;
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

// ============================================================
// Public API
// ============================================================

/**
 * Compile WLED-Lang source to WFX bytecode.
 * @param {string} source - The .wled source code
 * @returns {Uint8Array} - The compiled .wfx binary
 * @throws {Error} - On lexer, parser, or codegen errors
 */
export function compile(source) {
  const parser = new Parser(source);
  const ast = parser.parse();
  const codegen = new Codegen(ast);
  return codegen.generate();
}
