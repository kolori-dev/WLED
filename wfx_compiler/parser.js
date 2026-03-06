'use strict';

const { Lexer, T } = require('./lexer');

class ParseError extends Error {
  constructor(msg, line, col) {
    super(`Parse error at ${line}:${col}: ${msg}`);
    this.line = line;
    this.col = col;
  }
}

function error(msg, tok) {
  throw new ParseError(msg, tok.line, tok.col);
}

// --- AST Node constructors ---

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
  constructor(source) {
    this.lex = new Lexer(source);
  }

  parse() {
    const effect = this._effectDecl();
    this.lex.expect(T.EOF);
    return effect;
  }

  // effect "Name" { ... }
  _effectDecl() {
    this.lex.expect(T.KEYWORD, 'effect');
    const name = this.lex.expect(T.STRING).value;
    this.lex.expect(T.PUNCT, '{');

    let meta = null;
    const dataDecls = [];
    let renderBody = null;

    while (!this.lex.check(T.PUNCT, '}')) {
      if (this.lex.check(T.KEYWORD, 'meta')) {
        meta = this._metaBlock();
      } else if (this.lex.check(T.KEYWORD, 'data')) {
        dataDecls.push(this._dataDecl());
      } else if (this.lex.check(T.KEYWORD, 'render')) {
        renderBody = this._renderBlock();
      } else {
        const tok = this.lex.peek();
        error(`Unexpected token '${tok.value}' in effect body`, tok);
      }
    }
    this.lex.expect(T.PUNCT, '}');

    if (!renderBody) {
      error('Effect must have a render block', this.lex.peek());
    }

    return Node.Effect(name, meta, dataDecls, renderBody);
  }

  // meta { ... }
  _metaBlock() {
    this.lex.expect(T.KEYWORD, 'meta');
    this.lex.expect(T.PUNCT, '{');
    const sliders = [];
    let effectType = '1D';
    let palette = false;
    let audioReactive = false;

    while (!this.lex.check(T.PUNCT, '}')) {
      if (this.lex.match(T.KEYWORD, 'slider')) {
        const name = this.lex.expect(T.IDENT).value;
        const label = this.lex.expect(T.STRING).value;
        let defaultVal = null;
        if (this.lex.match(T.KEYWORD, 'default')) {
          defaultVal = this._expr();
        }
        sliders.push(Node.Slider(name, label, defaultVal));
      } else if (this.lex.match(T.KEYWORD, 'type')) {
        const tok = this.lex.expect(T.KEYWORD);
        if (tok.value !== '1D' && tok.value !== '2D') {
          error(`Expected '1D' or '2D', got '${tok.value}'`, tok);
        }
        effectType = tok.value;
      } else if (this.lex.match(T.KEYWORD, 'palette')) {
        const tok = this.lex.expect(T.KEYWORD);
        if (tok.value !== 'true' && tok.value !== 'false') {
          error(`Expected 'true' or 'false', got '${tok.value}'`, tok);
        }
        palette = tok.value === 'true';
      } else if (this.lex.match(T.KEYWORD, 'audio_reactive')) {
        const tok = this.lex.expect(T.KEYWORD);
        if (tok.value !== 'true' && tok.value !== 'false') {
          error(`Expected 'true' or 'false', got '${tok.value}'`, tok);
        }
        audioReactive = tok.value === 'true';
      } else {
        const tok = this.lex.peek();
        error(`Unexpected token '${tok.value}' in meta block`, tok);
      }
    }
    this.lex.expect(T.PUNCT, '}');
    return Node.Meta(sliders, effectType, palette, audioReactive);
  }

  // data name[size]
  _dataDecl() {
    this.lex.expect(T.KEYWORD, 'data');
    const name = this.lex.expect(T.IDENT).value;
    this.lex.expect(T.PUNCT, '[');
    const sizeExpr = this._expr();
    this.lex.expect(T.PUNCT, ']');
    return Node.DataDecl(name, sizeExpr);
  }

  // render { ... }
  _renderBlock() {
    this.lex.expect(T.KEYWORD, 'render');
    this.lex.expect(T.PUNCT, '{');
    const stmts = this._stmtList();
    this.lex.expect(T.PUNCT, '}');
    return stmts;
  }

  _stmtList() {
    const stmts = [];
    while (!this.lex.check(T.PUNCT, '}') && !this.lex.check(T.EOF)) {
      stmts.push(this._stmt());
    }
    return stmts;
  }

  _stmt() {
    // let declaration
    if (this.lex.check(T.KEYWORD, 'let')) {
      return this._letStmt();
    }
    // if statement
    if (this.lex.check(T.KEYWORD, 'if')) {
      return this._ifStmt();
    }
    // for loop
    if (this.lex.check(T.KEYWORD, 'for')) {
      return this._forStmt();
    }
    // while loop
    if (this.lex.check(T.KEYWORD, 'while')) {
      return this._whileStmt();
    }
    // frame statement
    if (this.lex.check(T.KEYWORD, 'frame')) {
      return this._frameStmt();
    }

    // Expression statement — could be assignment or function call
    const expr = this._expr();

    // Check for assignment: ident = expr  or  ident[expr] = expr
    if (this.lex.match(T.OP, '=')) {
      const value = this._expr();
      return Node.Assign(expr, value);
    }

    return expr; // bare expression statement (function call)
  }

  // let name = expr
  _letStmt() {
    this.lex.expect(T.KEYWORD, 'let');
    const name = this.lex.expect(T.IDENT).value;
    this.lex.expect(T.OP, '=');
    const value = this._expr();
    return Node.Let(name, value);
  }

  // if expr { stmts } (else { stmts })?
  _ifStmt() {
    this.lex.expect(T.KEYWORD, 'if');
    const cond = this._expr();
    this.lex.expect(T.PUNCT, '{');
    const thenBody = this._stmtList();
    this.lex.expect(T.PUNCT, '}');
    let elseBody = null;
    if (this.lex.match(T.KEYWORD, 'else')) {
      if (this.lex.check(T.KEYWORD, 'if')) {
        // else if — wrap in list
        elseBody = [this._ifStmt()];
      } else {
        this.lex.expect(T.PUNCT, '{');
        elseBody = this._stmtList();
        this.lex.expect(T.PUNCT, '}');
      }
    }
    return Node.If(cond, thenBody, elseBody);
  }

  // for ident in start..end (step expr)? { stmts }
  _forStmt() {
    this.lex.expect(T.KEYWORD, 'for');
    const varName = this.lex.expect(T.IDENT).value;
    this.lex.expect(T.KEYWORD, 'in');
    const start = this._expr();
    this.lex.expect(T.OP, '..');
    const end = this._expr();
    let step = null;
    if (this.lex.match(T.KEYWORD, 'step')) {
      step = this._expr();
    }
    this.lex.expect(T.PUNCT, '{');
    const body = this._stmtList();
    this.lex.expect(T.PUNCT, '}');
    return Node.For(varName, start, end, step, body);
  }

  // while expr { stmts }
  _whileStmt() {
    this.lex.expect(T.KEYWORD, 'while');
    const cond = this._expr();
    this.lex.expect(T.PUNCT, '{');
    const body = this._stmtList();
    this.lex.expect(T.PUNCT, '}');
    return Node.While(cond, body);
  }

  // frame(delay) or frame() — no-arg uses SPEED_FORMULA_L
  _frameStmt() {
    this.lex.expect(T.KEYWORD, 'frame');
    this.lex.expect(T.PUNCT, '(');
    let delay = null;
    if (!this.lex.check(T.PUNCT, ')')) {
      delay = this._expr();
    }
    this.lex.expect(T.PUNCT, ')');
    return Node.Frame(delay);
  }

  // --- Expression parsing (precedence climbing) ---

  _expr() {
    return this._orExpr();
  }

  _orExpr() {
    let left = this._andExpr();
    while (this.lex.match(T.KEYWORD, 'or')) {
      const right = this._andExpr();
      left = Node.BinOp('or', left, right);
    }
    return left;
  }

  _andExpr() {
    let left = this._cmpExpr();
    while (this.lex.match(T.KEYWORD, 'and')) {
      const right = this._cmpExpr();
      left = Node.BinOp('and', left, right);
    }
    return left;
  }

  _cmpExpr() {
    let left = this._addExpr();
    const cmpOps = ['==', '!=', '<', '>', '<=', '>='];
    const tok = this.lex.peek();
    if (tok.type === T.OP && cmpOps.includes(tok.value)) {
      const op = this.lex.next().value;
      const right = this._addExpr();
      left = Node.BinOp(op, left, right);
    }
    return left;
  }

  _addExpr() {
    let left = this._mulExpr();
    while (true) {
      const tok = this.lex.peek();
      if (tok.type === T.OP && (tok.value === '+' || tok.value === '-' || tok.value === '|' || tok.value === '^')) {
        const op = this.lex.next().value;
        const right = this._mulExpr();
        left = Node.BinOp(op, left, right);
      } else {
        break;
      }
    }
    return left;
  }

  _mulExpr() {
    let left = this._unaryExpr();
    while (true) {
      const tok = this.lex.peek();
      if (tok.type === T.OP && (tok.value === '*' || tok.value === '/' || tok.value === '%' || tok.value === '&' || tok.value === '<<' || tok.value === '>>')) {
        const op = this.lex.next().value;
        const right = this._unaryExpr();
        left = Node.BinOp(op, left, right);
      } else {
        break;
      }
    }
    return left;
  }

  _unaryExpr() {
    if (this.lex.check(T.OP, '-')) {
      this.lex.next();
      return Node.Unary('-', this._unaryExpr());
    }
    if (this.lex.check(T.KEYWORD, 'not')) {
      this.lex.next();
      return Node.Unary('not', this._unaryExpr());
    }
    if (this.lex.check(T.OP, '~')) {
      this.lex.next();
      return Node.Unary('~', this._unaryExpr());
    }
    return this._postfixExpr();
  }

  _postfixExpr() {
    let expr = this._primary();

    while (true) {
      // Function call
      if (this.lex.check(T.PUNCT, '(')) {
        this.lex.next();
        const args = [];
        if (!this.lex.check(T.PUNCT, ')')) {
          args.push(this._expr());
          while (this.lex.match(T.PUNCT, ',')) {
            args.push(this._expr());
          }
        }
        this.lex.expect(T.PUNCT, ')');
        // expr should be an Ident for named function calls
        if (expr.type === 'Ident') {
          expr = Node.Call(expr.name, args);
        } else {
          error('Expected function name before ()', this.lex.peek());
        }
      }
      // Array index
      else if (this.lex.check(T.PUNCT, '[')) {
        this.lex.next();
        const index = this._expr();
        this.lex.expect(T.PUNCT, ']');
        expr = Node.Index(expr, index);
      } else {
        break;
      }
    }

    return expr;
  }

  _primary() {
    // Number literal
    if (this.lex.check(T.NUMBER)) {
      return Node.Number(this.lex.next().value);
    }

    // Boolean literals
    if (this.lex.check(T.KEYWORD, 'true')) {
      this.lex.next();
      return Node.Bool(true);
    }
    if (this.lex.check(T.KEYWORD, 'false')) {
      this.lex.next();
      return Node.Bool(false);
    }

    // Identifier
    if (this.lex.check(T.IDENT)) {
      return Node.Ident(this.lex.next().value);
    }

    // Keywords that double as function names in expression context
    if (this.lex.check(T.KEYWORD, 'palette')) {
      return Node.Ident(this.lex.next().value);
    }

    // Parenthesized expression
    if (this.lex.match(T.PUNCT, '(')) {
      const expr = this._expr();
      this.lex.expect(T.PUNCT, ')');
      return expr;
    }

    const tok = this.lex.peek();
    error(`Unexpected token '${tok.value}'`, tok);
  }
}

module.exports = { Parser, ParseError, Node };
