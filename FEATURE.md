# WLED-Lang: Bytecode VM for User-Loadable LED Effects

## Summary

This feature replaces all 187 built-in C++ effects (except Solid) with a **runtime bytecode VM** and **effect loader** system. Effects are now written in a purpose-built scripting language called **WLED-Lang**, compiled offline to `.wfx` bytecode files, and loaded from LittleFS. Effects can be uploaded at any time via the web UI and are available immediately — no reboot required. Users can also delete and back up effects directly from the UI, all without a firmware reflash.

**Key numbers:**
- ~10,900 lines of hardcoded C++ effect code removed from `FX.cpp`
- 167 effects reimplemented as `.wled` source files (1D, 2D, audio-reactive, and text)
- New code: ~800 lines C++ (VM + loader), ~1,600 lines JS (compiler), ~400 lines JS (test suite), ~900 lines JS (browser simulator)
- ESP32-only (the VM requires more RAM than ESP8266 provides)

## Why

WLED's effect system has grown to 218 hardcoded C++ functions compiled into firmware. This creates several problems:

1. **Adding or modifying effects requires a firmware rebuild and reflash.** Most users can't build from source, so they're locked to whatever effects ship in a release.
2. **Flash usage grows with every new effect.** On 4MB ESP32 boards, the effect code alone consumes a significant portion of available flash. Users who only want 20 effects still pay the cost of all 218.
3. **Contributing effects requires C++ knowledge and a PlatformIO toolchain.** The barrier to entry is high for the creative community that designs effects.

This feature solves all three: effects become files you drag-and-drop onto your device.

## Architecture

### Bytecode VM (`wled00/wled_vm.h`, `wled_vm.cpp`)

A register-based interpreter purpose-built for LED effects. Not a general-purpose VM — it has no heap allocation (beyond the segment data buffer), no strings, no dynamic dispatch.

- **37 registers**: 16 general-purpose (r0-r15), 8 float (f0-f7, bit-reinterpreted), 4 color (c0-c3), 4 parameter (p0-p3: speed/intensity/custom1/custom2, read-only), 5 special (LEN/NOW/CALL/WIDTH/HEIGHT, read-only)
- **~85 opcodes** covering integer/float arithmetic, bitwise ops, comparisons, control flow (jumps, loops), pixel I/O (1D and 2D), color manipulation (RGB pack/unpack, palette, blend, fade), FastLED-compatible math (sin8, cos8, triwave8, scale8, noise), audio-reactive data access, and text rendering (drawCharacter, segment name access, font metrics)
- **Variable-width instructions**: 1-6 bytes per instruction, no alignment requirements. Compact encoding keeps bytecode small (typical effect: 50-300 bytes)
- **Single execution context**: one `WledVM` instance shared across all effects. Effects don't run concurrently — the existing `strip.service()` loop calls them sequentially per segment

### Effect Loader (`wled00/wled_fx_loader.h`, `wled_fx_loader.cpp`)

Bridges the filesystem and `WS2812FX`:

- On startup, `FXLoader::init()` scans `/fx/*.wfx` on LittleFS to load any previously uploaded effects. New effects uploaded via the web UI are loaded immediately via `FXLoader::loadEffect()` — no reboot needed. Each file's header is validated, bytecode is allocated (PSRAM-preferred), and the effect is registered via `strip.addEffect()` with a shared trampoline function
- **Fixed-size slot array** (180 max) — no `std::vector`, no heap fragmentation from reallocation. Freed slots are reused on next upload
- **Deferred deletion**: `unloadEffect()` marks a slot as `pendingDelete`; actual cleanup happens in `servicePendingDeletes()` called from the main loop, preventing races with VM execution
- **Hot-loading**: uploading a `.wfx` file via the web UI immediately registers it — no reboot needed. Deletion requires a reboot for full cleanup (segment mode IDs reset to Solid)

### Compiler (`wfx_compiler/`)

Node.js CLI tool (no runtime dependencies) that compiles `.wled` source to `.wfx` bytecode:

```
source.wled → Lexer → Parser (recursive descent) → Codegen → .wfx binary
```

- **Register allocator**: 11 variable slots (r0-r10) with block scoping that recycles registers after loop/if bodies. 5 temporary registers (r11-r15) for expression evaluation
- **Constant folding** for data array sizes
- **Jump patching**: forward references resolved in a single pass after codegen
- **WFX binary format**: 8-byte header (magic, version, flags, data size, bytecode length) + null-terminated metadata string + bytecode

### .wfx Binary Format

```
Offset  Size   Field
0       3      Magic "WFX"
3       1      Version (0x01)
4       1      Flags: 0x01=2D, 0x02=palette, 0x04=audio-reactive
5       1      Data buffer size (in 16-byte units)
6       2      Bytecode length (uint16 LE)
8       var    Null-terminated metadata string (WLED format)
var     var    Bytecode
```

### Web UI Changes

- **"Add Effects" button** in the effects panel — uploads one or more `.wfx` files to `/fx/` via the existing upload endpoint
- **Per-effect context menu** (dropdown caret) with a Delete option — sends `POST /fx/delete` with the mode ID
- **Backup effects** button on the Security/Settings page — downloads all `.wfx` files as a `.tar` archive via `GET /fx/backup`
- **XSS protection**: effect names from metadata are HTML-escaped before insertion into the DOM

### WLED Core Changes

Minimal footprint in the existing codebase:

| File | Change |
|------|--------|
| `FX.cpp` | Removed all 187 effect functions (~10,900 lines). Only `mode_static`, `addEffect()`, `removeEffect()` (new), and `setupEffectData()` remain |
| `FX.h` | `MODE_COUNT` set to 2 (Solid + reserve). Added `removeEffect()` declaration |
| `FX_fcn.cpp` | Palette reset when switching to a bytecode effect that doesn't use palettes |
| `wled.cpp` | Two lines: `FXLoader::init()` in `beginStrip()`, `servicePendingDeletes()` in `loop()` |
| `wled_server.cpp` | Upload handler forces `.wfx` files into `/fx/`. New `POST /fx/delete` and `GET /fx/backup` endpoints |
| `data/index.htm` | Upload panel HTML |
| `data/index.js` | Upload, delete, and context menu functions. XSS escaping for effect names |
| `data/index.css` | Context menu and button styling |
| `data/settings_sec.htm` | Backup effects link |

### Browser Simulator (`wfx_compiler/simulator/`)

A browser-based WFX effect previewer for development and testing without hardware:

- **`serve.js`**: HTTP server that serves the simulator UI, provides a `POST /compile` endpoint for live `.wled` → `.wfx` compilation, and exposes a file management API (`GET/PUT/DELETE /effects/<name>`) for the built-in code editor
- **`sim-engine.js`**: Full JS reimplementation of the C++ VM (~85 opcodes), including all text, 2D, audio, and float operations. 1D effects render correctly on 2D grids via automatic pixel mirroring
- **`renderer.js`**: Canvas-based LED strip/matrix renderer with glow effects for small grids
- **`fonts.js`**: 5 bitmap fonts (4x6 through 5x12) extracted from WLED firmware headers
- **`palettes.js`**: All 72 WLED palettes with `colorFromPalette()` interpolation
- **`index.html`**: Split-panel UI with a WLED-Lang code editor (left) and LED simulator (right). Editor features: file browser, Ctrl+Enter compile & run, Ctrl+S save, syntax-aware tab indentation. Simulator: speed/intensity/custom sliders, palette selector, segment name input, 1D/2D mode toggle, drag-and-drop file loading

Start with `node wfx_compiler/simulator/serve.js` — auto-opens a browser at `http://localhost:3456`.

### Integration Test Suite (`wfx_compiler/test/`)

End-to-end tests that compile WLED-Lang source, execute it in a JS VM simulator (faithful port of the C++ interpreter), and verify results:

- **88 tests** across 13 suites: headers, arithmetic, comparisons, loops, math, colors, pixels, data arrays, opcode variables, audio, edge cases, segment parameters, and full effects
- **JS VM simulator** (`vm-sim.js`): implements all ~85 opcodes with matching 32-bit integer semantics, FastLED-compatible math, and mock segment/pixel/audio state
- Runs via `npm test` (Node.js built-in test runner, no dependencies)

## Security

The VM executes untrusted bytecode uploaded by users over the network. Multiple layers prevent abuse:

| Threat | Mitigation |
|--------|------------|
| Infinite loops | **50,000 cycle-per-frame watchdog** — VM halts and returns `FRAMETIME` if exceeded |
| Out-of-bounds bytecode reads | All `readU8`/`readI16`/`readI32` helpers check `pc < bcLen` before every read. Out-of-bounds returns 0 and advances PC to end |
| Invalid jump targets | Every jump/call validates `target >= 0 && target <= len`. Out-of-bounds halts the VM |
| Memory allocation | `OP_ALLOC` capped at **4KB** per effect. Uses WLED's existing `Segment::allocateData()` |
| Buffer overflows (data access) | `LDB`/`STB`/`LDW`/`STW` all bounds-check against `dataLen` before read/write |
| Write to read-only registers | `setReg()` silently refuses writes to parameter (p0-p3) and special registers (LEN/NOW/etc.) |
| Integer overflow on NEG/ABS | `INT32_MIN` guard: `NEG(INT32_MIN)` and `ABS(INT32_MIN)` return `INT32_MAX` instead of undefined behavior |
| Division by zero | `DIV` and `MOD` return 0 when divisor is 0 or when `INT32_MIN / -1` |
| Call stack overflow | Depth limited to 16. Exceeding halts the VM |
| Path traversal on upload | Server forces all `.wfx` uploads into `/fx/` regardless of the submitted path |
| CSRF on delete | Delete endpoint requires `POST` method and validates the OTA lock PIN |
| XSS via effect names | Metadata strings are HTML-escaped (`<`, `>`, `&`, `"`) before DOM insertion |
| Unknown opcodes | `default` case in the switch halts the VM immediately |

The VM has **no access** to: WiFi, filesystem, GPIO, other segments' memory, WLED configuration, or any system call. It can only read segment parameters and write pixels within its own segment.

## Limitations

- **ESP32-only.** The VM and loader add ~15KB of flash and require heap for bytecode storage. ESP8266 lacks the RAM
- **No string type.** Effect names come from the metadata header, not computed at runtime
- **11 variable limit per scope.** The register allocator has 11 variable slots (r0-r10). Complex effects must reuse variables via assignment instead of declaring new ones
- **5 temporary register limit.** Deeply nested expressions (e.g., `pixel2d(x, y, color_fade(palette(sin8(i)), cos8(j)))`) can overflow the temp stack. Fix by pre-computing intermediate values into variables
- **No function definitions in WLED-Lang.** The VM supports `CALL`/`RET` but the compiler doesn't expose user-defined functions yet
- **Integer-only arithmetic by default.** Float registers (f0-f7) exist and work, but the language doesn't expose them yet — integer math with `sin8`/`scale8` covers most effect needs
- **Palette is simulated in tests.** The JS VM simulator uses `color_wheel()` as a palette stand-in since real WLED palettes require the full palette engine
- **Delete requires reboot for full cleanup.** The effect slot is freed and segments fall back to Solid, but the mode ID isn't reclaimed until restart
- **No hot-reload of modified effects.** Re-uploading the same filename adds a second copy. Delete first, then re-upload (or reboot)
- **Max 180 bytecode effects.** The fixed slot array caps at `FX_MAX_EFFECTS`. In practice, flash and RAM limit you well before this

## Effect Library

167 effects ship as `.wled` source files in `wfx_effects/`, covering the full range of WLED's original effect set:

- **1D effects**: Rainbow, Chase, Comet, Meteor, Fireworks, Sinelon, Twinkle, Fire2012, Bouncing Balls, Drip, and many more
- **2D effects**: Plasma, DNA, Rain, Fireworks 2D, Game of Life, Matrix, Blobs, Spiral Galaxy, Scrolling Text, etc.
- **Audio-reactive effects**: BPM, Blurz, DJ Light, Freqmap, GEQ, Gravimeter, Noisemeter, Puddlepeak, Waterfall, etc.

Users compile them with:
```bash
cd wfx_compiler && node compiler.js ../wfx_effects/rainbow_wfx.wled -o rainbow_wfx.wfx
```

Then upload the `.wfx` file through the web UI or copy it to `/fx/` on LittleFS.

A separate language reference is in [`wfx_effects/README.md`](wfx_effects/README.md).

## Testing

```bash
cd wfx_compiler && npm test
```

All 88 tests pass. The test suite validates the full compiler-to-VM contract: source code → bytecode → execution → correct register/pixel/segment state.

## Migration Notes

- **For users**: Flash the new firmware, then upload `.wfx` files via the web UI. The device boots with only the Solid effect until you add bytecode effects
- **For effect developers**: Write effects in WLED-Lang (see `wfx_effects/README.md`), compile to `.wfx`, and share the binary files. No C++ or PlatformIO needed
- **For WLED core contributors**: The VM and loader are self-contained in 4 files (`wled_vm.h/cpp`, `wled_fx_loader.h/cpp`). The only core touchpoints are 2 lines in `wled.cpp`, the upload/delete/backup routes in `wled_server.cpp`, and the UI additions. `FX.h`/`FX_fcn.cpp`/`FX.cpp` changes are subtractive (removing old effects) plus the `removeEffect()` method
