# WLED-Lang Compiler

Node.js CLI tool that compiles `.wled` source files into `.wfx` bytecode for the WLED bytecode VM. The VM runs on ESP32 and replaces all built-in C++ effects with runtime-loaded bytecode effects.

## Requirements

- Node.js >= 20.0.0

## Usage

```bash
# Compile a .wled source file to .wfx bytecode
node compiler.js <input.wled> [-o output.wfx]

# Print the AST (for debugging)
node compiler.js <input.wled> --ast

# Print a hex dump of the bytecode
node compiler.js <input.wled> --hex
```

If `-o` is omitted, the output filename matches the input with a `.wfx` extension.

## Pipeline

```
source.wled → Lexer → Parser → Codegen → .wfx binary
```

| File | Role |
|------|------|
| `lexer.js` | Tokenizer — keywords, operators, numbers, strings, identifiers |
| `parser.js` | Recursive-descent parser — produces an AST |
| `codegen.js` | AST → variable-width bytecode + WFX binary packaging |
| `opcodes.js` | Opcode and register constants (must match `wled00/wled_vm.h`) |
| `compiler.js` | CLI entry point, exports `compile(source)` for programmatic use |

## .wfx Binary Format

```
Offset  Size   Field
0       3      Magic bytes "WFX"
3       1      Version (0x01)
4       1      Flags (FLAG_2D=0x01, FLAG_PALETTE=0x02, FLAG_AUDIO=0x04)
5       1      Data buffer size in 16-byte units
6       2      Bytecode length (uint16 LE)
8       var    Null-terminated metadata string
var     var    Bytecode
```

The metadata string follows the WLED format: `Name@Sliders;Colors;Palette;Flags`.

## Register Layout

37 registers in a flat address space:

| Range | Registers | Description |
|-------|-----------|-------------|
| `0x00-0x0F` | r0-r15 | General purpose (r0-r10 variables, r11-r15 temporaries) |
| `0x10-0x17` | f0-f7 | Float (reinterpreted int32) |
| `0x18-0x1B` | c0-c3 | Color (uint32 as int32) |
| `0x1C-0x1F` | p0-p3 | Parameters: speed, intensity, custom1, custom2 (read-only) |
| `0x20-0x24` | special | LEN, NOW, CALL, WIDTH, HEIGHT (read-only) |

## Codegen Details

- **Variable-width instructions**: each opcode has a specific byte layout matching the VM's `readU8`/`readI16`/`readI32` consumption. See the `BUILTINS` table in `codegen.js` for `vmOperands`/`hasDestReg` per function.
- **Register allocation**: r0-r10 for variables (11 slots), r11-r15 for temporaries (5-deep stack). Block scoping recycles registers after `for`/`if`/`while` bodies.
- **For-loop depth tracking**: `forNest` counter reuses `__end_N`/`__step_N` variable registers across sequential loops at the same depth.
- **Temp register optimization**: binary ops evaluate the left operand into `destReg` directly when `destReg` is a temp (avoids aliasing bugs for variable registers).

## Tests

The test suite uses Node's built-in test runner and a JS VM simulator that faithfully ports the C++ VM interpreter.

```bash
npm test
# or
node --test test/
```

| File | Description |
|------|-------------|
| `test/vm-sim.js` | JS port of `wled00/wled_vm.cpp` — executes bytecode with mock segment state, pixel buffers, and audio data |
| `test/compiler.test.js` | 88 end-to-end tests: compile WLED-Lang source → execute in VM sim → verify results |

### Test Coverage

- WFX header (magic, flags, data size)
- Arithmetic (add, sub, mul, div, mod, bitwise, shifts)
- Comparisons and if/else branching
- For loops (counting, nested, step, register recycling)
- While loops
- Math builtins (sin8, cos8, abs, min, max, sqrt, scale8, qadd8, qsub8, tri8)
- Color operations (rgb, channel extraction, color_wheel, color_fade, palette)
- Pixel operations (1D and 2D pixel buffers, fill)
- Data arrays (write/read byte buffers)
- Opcode variables (step_val, aux0, aux1)
- Audio-reactive (volume, peak, fft, bass/mid/treble averages)
- Edge cases (division by zero, cycle watchdog, FRAMETIME)
- Segment parameters (speed, intensity, custom1/2, LEN, NOW, WIDTH, HEIGHT)
