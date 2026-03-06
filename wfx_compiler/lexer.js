'use strict';

// Token types
const T = {
  NUMBER:  'NUMBER',
  STRING:  'STRING',
  IDENT:   'IDENT',
  KEYWORD: 'KEYWORD',
  OP:      'OP',
  PUNCT:   'PUNCT',
  EOF:     'EOF',
};

const KEYWORDS = new Set([
  'effect', 'meta', 'render', 'data', 'let',
  'if', 'else', 'for', 'in', 'while', 'step',
  'frame', 'slider', 'type', 'palette',
  'true', 'false', 'and', 'or', 'not',
  'default', 'audio_reactive',
]);

// Two-character operators (checked before single-char)
const TWO_CHAR_OPS = new Set([
  '==', '!=', '<=', '>=', '<<', '>>', '..',
]);

// Single-character operators
const ONE_CHAR_OPS = new Set([
  '+', '-', '*', '/', '%', '&', '|', '^', '~',
  '<', '>', '=', '!',
]);

// Punctuation
const PUNCTUATION = new Set([
  '(', ')', '{', '}', '[', ']', ',', ';',
]);

class Token {
  constructor(type, value, line, col) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.col = col;
  }
  toString() {
    return `${this.type}(${this.value}) @${this.line}:${this.col}`;
  }
}

class LexerError extends Error {
  constructor(msg, line, col) {
    super(`Lexer error at ${line}:${col}: ${msg}`);
    this.line = line;
    this.col = col;
  }
}

class Lexer {
  constructor(source) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
    this._tokenize();
    this._index = 0;
  }

  _peek() {
    return this.pos < this.source.length ? this.source[this.pos] : null;
  }

  _advance() {
    const ch = this.source[this.pos++];
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  _skipWhitespace() {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this._advance();
      } else if (ch === '/' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '/') {
        // Line comment
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
          this._advance();
        }
      } else {
        break;
      }
    }
  }

  _readString() {
    const startLine = this.line;
    const startCol = this.col;
    const quote = this._advance(); // consume opening quote
    let str = '';
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === quote) {
        this._advance(); // consume closing quote
        return new Token(T.STRING, str, startLine, startCol);
      }
      if (ch === '\\') {
        this._advance();
        const esc = this._advance();
        switch (esc) {
          case 'n': str += '\n'; break;
          case 't': str += '\t'; break;
          case '\\': str += '\\'; break;
          case '"': str += '"'; break;
          case "'": str += "'"; break;
          default: str += esc; break;
        }
      } else {
        str += this._advance();
      }
    }
    throw new LexerError('Unterminated string', startLine, startCol);
  }

  _readNumber() {
    const startLine = this.line;
    const startCol = this.col;
    let num = '';

    // Hex literal
    if (this.source[this.pos] === '0' && this.pos + 1 < this.source.length &&
        (this.source[this.pos + 1] === 'x' || this.source[this.pos + 1] === 'X')) {
      num += this._advance(); // '0'
      num += this._advance(); // 'x'
      while (this.pos < this.source.length && /[0-9a-fA-F]/.test(this.source[this.pos])) {
        num += this._advance();
      }
      if (num.length === 2) {
        throw new LexerError('Invalid hex literal', startLine, startCol);
      }
      return new Token(T.NUMBER, parseInt(num, 16), startLine, startCol);
    }

    // Decimal
    while (this.pos < this.source.length && /[0-9]/.test(this.source[this.pos])) {
      num += this._advance();
    }

    // Special case: "1D" or "2D" are keywords
    if ((num === '1' || num === '2') && this.pos < this.source.length && this.source[this.pos] === 'D') {
      num += this._advance();
      return new Token(T.KEYWORD, num, startLine, startCol);
    }

    return new Token(T.NUMBER, parseInt(num, 10), startLine, startCol);
  }

  _readIdentOrKeyword() {
    const startLine = this.line;
    const startCol = this.col;
    let word = '';
    while (this.pos < this.source.length && /[a-zA-Z0-9_]/.test(this.source[this.pos])) {
      word += this._advance();
    }

    // Special: "1D" and "2D" are keywords
    if (word === '1D' || word === '2D') {
      return new Token(T.KEYWORD, word, startLine, startCol);
    }

    if (KEYWORDS.has(word)) {
      return new Token(T.KEYWORD, word, startLine, startCol);
    }

    return new Token(T.IDENT, word, startLine, startCol);
  }

  _tokenize() {
    while (this.pos < this.source.length) {
      this._skipWhitespace();
      if (this.pos >= this.source.length) break;

      const ch = this.source[this.pos];
      const startLine = this.line;
      const startCol = this.col;

      // String
      if (ch === '"' || ch === "'") {
        this.tokens.push(this._readString());
        continue;
      }

      // Number
      if (/[0-9]/.test(ch)) {
        this.tokens.push(this._readNumber());
        continue;
      }

      // Identifier or keyword (including 1D/2D)
      if (/[a-zA-Z_]/.test(ch)) {
        this.tokens.push(this._readIdentOrKeyword());
        continue;
      }

      // Two-character operators
      if (this.pos + 1 < this.source.length) {
        const two = this.source[this.pos] + this.source[this.pos + 1];
        if (TWO_CHAR_OPS.has(two)) {
          this._advance();
          this._advance();
          this.tokens.push(new Token(T.OP, two, startLine, startCol));
          continue;
        }
      }

      // Punctuation
      if (PUNCTUATION.has(ch)) {
        this._advance();
        this.tokens.push(new Token(T.PUNCT, ch, startLine, startCol));
        continue;
      }

      // Single-character operators
      if (ONE_CHAR_OPS.has(ch)) {
        this._advance();
        this.tokens.push(new Token(T.OP, ch, startLine, startCol));
        continue;
      }

      throw new LexerError(`Unexpected character '${ch}'`, startLine, startCol);
    }

    this.tokens.push(new Token(T.EOF, null, this.line, this.col));
  }

  // --- Consumer API ---

  /** Return the current token without consuming it */
  peek() {
    return this.tokens[this._index];
  }

  /** Consume and return the current token */
  next() {
    return this.tokens[this._index++];
  }

  /** Consume if current token matches type and optionally value, else throw */
  expect(type, value) {
    const tok = this.peek();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      const expected = value !== undefined ? `${type}(${value})` : type;
      throw new LexerError(
        `Expected ${expected}, got ${tok.type}(${tok.value})`,
        tok.line, tok.col
      );
    }
    return this.next();
  }

  /** Return true if current token matches type and optionally value */
  check(type, value) {
    const tok = this.peek();
    return tok.type === type && (value === undefined || tok.value === value);
  }

  /** Consume and return token if it matches, else return null */
  match(type, value) {
    if (this.check(type, value)) {
      return this.next();
    }
    return null;
  }
}

module.exports = { Lexer, Token, LexerError, T };
