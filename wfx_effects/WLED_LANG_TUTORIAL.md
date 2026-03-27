# WLED-Lang Tutorial: From Beginner to Advanced

A complete guide to writing LED effects in WLED-Lang, the domain-specific language
for the WLED bytecode VM. Effects are compiled to `.wfx` files and loaded onto
ESP32 controllers at runtime.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Your First Effect](#2-your-first-effect)
3. [Colors and Palettes](#3-colors-and-palettes)
4. [Animation and Timing](#4-animation-and-timing)
5. [Control Flow](#5-control-flow)
6. [UI Sliders and Metadata](#6-ui-sliders-and-metadata)
7. [Persistent State](#7-persistent-state)
8. [Data Buffers](#8-data-buffers)
9. [Math and Wave Functions](#9-math-and-wave-functions)
10. [2D Matrix Effects](#10-2d-matrix-effects)
11. [Text Rendering](#11-text-rendering)
12. [Audio-Reactive Effects](#12-audio-reactive-effects)
13. [Register Limits and Optimization](#13-register-limits-and-optimization)
14. [Complete Language Reference](#14-complete-language-reference)
15. [Recipes and Patterns](#15-recipes-and-patterns)

---

## 1. Getting Started

### What is WLED-Lang?

WLED-Lang is a simple programming language designed for writing LED effects.
You write `.wled` source files, compile them to `.wfx` bytecode, and upload
them to your ESP32 running WLED. The effects run inside a lightweight virtual
machine on the microcontroller.

### Compiling Effects

```bash
# Compile a single effect
node wfx_compiler/compiler.js wfx_effects/my_effect.wled -o wfx_effects/my_effect.wfx

# Compile all effects in a directory
node wfx_compiler/compiler.js wfx_effects/

# Debug: dump the AST (abstract syntax tree)
node wfx_compiler/compiler.js wfx_effects/my_effect.wled --ast

# Debug: dump raw bytecode as hex
node wfx_compiler/compiler.js wfx_effects/my_effect.wled --hex
```

### Testing in the Browser Simulator

Before uploading to hardware, you can test effects in the browser simulator:

```bash
node wfx_compiler/simulator/serve.js
# Open http://localhost:3456 in your browser
```

The simulator provides a split-panel interface with a code editor on the left
and a live LED preview on the right.

### Uploading to WLED

In the WLED web UI, use the "Add Effects" button to upload compiled `.wfx` files.
They are stored in the `/fx/` directory on the ESP32's filesystem and loaded
automatically at boot.

---

## 2. Your First Effect

### The Basic Structure

Every WLED-Lang file has this structure:

```wled
effect "My Effect Name" {
  render {
    // Your effect code goes here
  }
}
```

- `effect "Name"` declares the effect and its display name in the UI.
- `render { }` is the main block that runs every animation frame.

### Hello World: Solid Color

The simplest possible effect fills every LED with red:

```wled
effect "Solid Red" {
  render {
    fill(rgb(255, 0, 0))
    frame()
  }
}
```

- `fill(color)` sets every pixel in the segment to the given color.
- `rgb(255, 0, 0)` creates a red color (red=255, green=0, blue=0).
- `frame()` pauses until the next animation frame. **Every render block must
  end with `frame()` or `frame(N)`**, or the effect will consume all CPU cycles.

### Painting Individual Pixels

To set pixels one at a time, use `pixel(index, color)`:

```wled
effect "Alternating" {
  render {
    for i in 0..LEN {
      if i % 2 == 0 {
        pixel(i, rgb(255, 0, 0))
      } else {
        pixel(i, rgb(0, 0, 255))
      }
    }
    frame()
  }
}
```

- `LEN` is the number of LEDs in the current segment.
- `for i in 0..LEN` loops from 0 to LEN-1.
- `pixel(index, color)` sets a single LED.

---

## 3. Colors and Palettes

### Creating Colors

```wled
let red = rgb(255, 0, 0)         // Pure red
let white = rgb(255, 255, 255)   // White
let teal = rgb(0, 128, 128)      // Teal
let warm = rgbw(255, 180, 80, 0) // Warm (RGBW strips with white channel)
```

### The Color Wheel

`color_wheel(hue)` generates a rainbow color from a hue value (0-255):

```wled
effect "Rainbow" {
  render {
    for i in 0..LEN {
      let hue = i * 255 / LEN
      pixel(i, color_wheel(hue))
    }
    frame()
  }
}
```

This spreads the full rainbow across the strip. Hue 0 is red, ~85 is green,
~170 is blue, and 255 wraps back to red.

### Palettes

WLED has 72 built-in color palettes. When you enable palette support, users
can choose a palette from the UI, and your effect samples colors from it.

```wled
effect "Palette Sweep" {
  meta {
    palette true
  }

  render {
    for i in 0..LEN {
      let idx = i * 255 / LEN
      pixel(i, palette(idx))
    }
    frame()
  }
}
```

- `palette(index)` samples the active palette at position 0-255.
- `palette true` in the meta block enables the palette selector in the UI.

For more control, use `palette_x(index, brightness, palette_offset)`:

```wled
let c = palette_x(128, 200, 64)  // Sample at 128, brightness 200, offset 64
```

### Manipulating Colors

```wled
let c1 = rgb(255, 0, 0)
let c2 = rgb(0, 0, 255)

// Blend two colors (0 = all c1, 255 = all c2)
let mixed = blend(c1, c2, 128)          // Purple

// Dim a color (0 = off, 255 = full brightness)
let dimmed = color_fade(c1, 64)          // Dark red

// Add colors (saturating — won't overflow past 255)
let bright = color_add(c1, c2)           // Magenta

// Extract individual channels
let r = red(mixed)                       // Red component (0-255)
let g = green(mixed)                     // Green component
let b = blue(mixed)                      // Blue component
let w = white(mixed)                     // White channel (RGBW strips)
```

### Segment Colors

Users can pick colors in the WLED UI. Access them with `color0`, `color1`, `color2`:

```wled
let primary = color0     // First color picked by user
let secondary = color1   // Second color
let tertiary = color2    // Third color
```

These are read-only and don't consume register slots.

---

## 4. Animation and Timing

### The frame() Function

`frame()` is the heartbeat of your effect. It pauses execution and yields
control back to WLED. There are two forms:

```wled
frame()     // Delay based on speed slider: 5 + (50*(255-speed))/255 ms
frame(16)   // Explicit delay: 16 milliseconds (~60 FPS)
```

**Always call `frame()` at the end of your render block.** Without it, the
effect will run in an infinite loop and freeze the controller.

Most effects use `frame()` (no arguments) to let the speed slider control
the animation speed.

### Using NOW for Animation

`NOW` returns the current time in milliseconds. Use it to create animations
that progress over time:

```wled
effect "Scrolling Rainbow" {
  meta {
    palette true
  }

  render {
    let offset = NOW / 10   // Scrolls ~100 pixels per second

    for i in 0..LEN {
      let idx = (i + offset) % 256
      pixel(i, palette(idx))
    }
    frame()
  }
}
```

### Using CALL as a Frame Counter

`CALL` increments every time the render block executes. It's useful for
per-frame stepping:

```wled
effect "Dot Chase" {
  render {
    fill(rgb(0, 0, 0))                 // Clear
    let pos = CALL % LEN               // Advance one pixel per frame
    pixel(pos, rgb(255, 255, 255))     // Draw dot
    frame()
  }
}
```

### First-Frame Initialization

Use `CALL == 0` to run setup code once when the effect starts:

```wled
if CALL == 0 {
  aux0 = 128          // Initialize state
  aux1 = random(255)  // Random starting value
}
```

---

## 5. Control Flow

### Variables

Declare variables with `let`. They must be initialized:

```wled
let x = 0
let brightness = 128
let color = rgb(255, 0, 0)
```

Reassign them with `=`:

```wled
x = x + 1
brightness = intensity * 2
```

**Important:** You can have at most **11 variables** in scope at once (registers
r0-r10). See [Register Limits](#13-register-limits-and-optimization) for details.

### If / Else

```wled
if x > 100 {
  fill(rgb(255, 0, 0))
} else if x > 50 {
  fill(rgb(0, 255, 0))
} else {
  fill(rgb(0, 0, 255))
}
```

Conditions support: `==`, `!=`, `<`, `>`, `<=`, `>=`

Combine with `and`, `or`, `not`:

```wled
if x > 10 and x < 100 {
  // x is between 10 and 100
}

if not (x == 0) {
  // x is nonzero
}
```

**Note:** Comparisons are not chainable. Write `a < b and b < c`, not `a < b < c`.

### For Loops

```wled
// Count from 0 to LEN-1
for i in 0..LEN {
  pixel(i, palette(i))
}

// Count from 0 to 9 by 2s (0, 2, 4, 6, 8)
for i in 0..10 step 2 {
  pixel(i, rgb(255, 255, 255))
}

// Count backwards (10, 9, 8, ..., 1)
for i in 10..0 step -1 {
  pixel(i, rgb(255, 0, 0))
}
```

### While Loops

```wled
let x = 0
while x < LEN {
  pixel(x, rgb(0, 255, 0))
  x = x + 3   // Every third pixel
}
```

### Block Scoping

Variables declared inside `if`, `for`, or `while` blocks are scoped to that
block. Their registers are recycled when the block ends:

```wled
for i in 0..LEN {
  let c = palette(i * 255 / LEN)   // 'c' only exists inside this loop
  pixel(i, c)
}
// 'c' is gone here — its register is freed
```

This is important for staying within the 11-variable limit.

---

## 6. UI Sliders and Metadata

### The Meta Block

The `meta { }` block configures how your effect appears in the WLED UI:

```wled
effect "My Effect" {
  meta {
    slider speed "Animation Speed" default 128
    slider intensity "Brightness" default 255
    slider custom1 "Trail Length"
    slider custom2 "Density"
    slider custom3 "Color Shift"
    palette true
    type 2D
    audio_reactive true
  }

  render {
    // ...
  }
}
```

### Sliders

There are 5 possible slider positions, each mapped to a fixed variable name:

| Variable   | UI Position | Range  |
|-----------|-------------|--------|
| `speed`    | Slider 1    | 0-255  |
| `intensity`| Slider 2    | 0-255  |
| `custom1`  | Slider 3    | 0-255  |
| `custom2`  | Slider 4    | 0-255  |
| `custom3`  | Slider 5    | 0-255  |

Only declared sliders appear in the UI. Undeclared positions are hidden.
The string label (e.g., `"Animation Speed"`) is what users see.

You can optionally set a default value:

```wled
slider speed "Speed" default 128   // Starts at 128 when effect is selected
```

### Reading Slider Values

Slider variables are read-only and don't consume register slots:

```wled
let delay = 255 - speed          // Fast when speed is high
let numDots = intensity / 16     // 0-15 dots based on intensity
let trailLen = custom1           // Direct use of custom slider
```

### Other Metadata Options

- **`palette true`** — Shows the palette selector in the UI.
- **`type 2D`** — Declares the effect as 2D (uses `pixel2d`, `WIDTH`, `HEIGHT`).
  Both 1D and 2D effects work in all configurations; this is just a hint.
- **`audio_reactive true`** — Enables audio data access (`volume`, `fft()`, etc.).
  Required if you use any audio functions.

### Checkboxes and Colors

WLED provides segment-level checkboxes and color pickers. Access them as
read-only variables:

```wled
if check1 {
  // Checkbox 1 is checked (e.g., reverse direction)
}

let bg = color1   // User's second color pick
```

Available: `check1`, `check2`, `check3`, `color0`, `color1`, `color2`

---

## 7. Persistent State

Effects need to remember values between frames. WLED-Lang provides three
special variables that persist across `frame()` calls without consuming
register slots.

### aux0 and aux1

Two general-purpose persistent values:

```wled
effect "Bouncing Dot" {
  render {
    // Initialize on first frame
    if CALL == 0 {
      aux0 = 0       // Position
      aux1 = 1       // Direction (1 = right, 0 = left)
    }

    fill(rgb(0, 0, 0))
    pixel(aux0, rgb(255, 255, 255))

    // Move
    if aux1 == 1 {
      aux0 = aux0 + 1
      if aux0 >= LEN - 1 {
        aux1 = 0     // Reverse at right edge
      }
    } else {
      aux0 = aux0 - 1
      if aux0 <= 0 {
        aux1 = 1     // Reverse at left edge
      }
    }

    frame()
  }
}
```

### step_val

A third persistent value, often used as a counter or accumulator:

```wled
// Throttle updates: only act every N frames
step_val = step_val + 1
if step_val > 10 {
  step_val = 0
  // Do expensive work here
}
```

### Why Use These Instead of Variables?

- `aux0`, `aux1`, and `step_val` don't consume register slots (only 11 available).
- They persist across frames automatically.
- Regular `let` variables reset every frame (the render block re-executes
  from the top each frame).

---

## 8. Data Buffers

For effects that need more than 3 persistent values (like physics simulations
or per-pixel state), use `data` buffers.

### Declaring a Buffer

```wled
effect "Trail Effect" {
  data history[256]    // 256-byte persistent buffer

  render {
    // Read and write buffer entries
    let old = history[0]
    history[0] = 128
  }
}
```

- Declared between `meta { }` and `render { }`.
- Size must be a compile-time constant (can use `LEN` and arithmetic).
- Maximum total allocation: 4KB.
- Buffer persists across frames (stored per-segment on the ESP32).
- Each entry is one byte (0-255).

### Example: Per-Pixel Heat Map

```wled
effect "Fire" {
  meta {
    slider speed "Cooling"
    slider intensity "Sparking"
    palette true
  }

  data heat[256]

  render {
    // Cool down each cell
    for i in 0..LEN {
      let cooling = random(speed * 10 / LEN + 2)
      heat[i] = qsub8(heat[i], cooling)
    }

    // Heat drifts up (spread)
    for k in 2..LEN {
      let idx = LEN - 1 - k
      heat[idx] = (heat[idx + 1] + heat[idx + 2]) / 2
    }

    // Random sparks at bottom
    if random(255) < intensity {
      let pos = random(3)
      heat[pos] = qadd8(heat[pos], random(160, 255))
    }

    // Render heat to pixels
    for j in 0..LEN {
      pixel(j, palette(heat[j]))
    }

    frame()
  }
}
```

### Example: Bouncing Balls with Physics

```wled
effect "Balls" {
  meta {
    slider intensity "# of balls"
    palette true
  }

  // 8 balls max, 2 bytes each: [height, velocity]
  data balls[16]

  render {
    let numBalls = intensity / 32 + 1
    if numBalls > 8 { numBalls = 8 }

    if CALL == 0 {
      for i in 0..numBalls {
        balls[i * 2] = 0                   // height = 0
        balls[i * 2 + 1] = random(200, 240) // velocity
      }
    }

    fill(rgb(0, 0, 0))

    for i in 0..numBalls {
      let d = i * 2
      let h = balls[d]
      let v = balls[d + 1]

      // Physics: velocity is offset by 128 (128 = stopped)
      h = h + (v - 128)
      v = v - 2              // Gravity

      // Bounce
      if h <= 0 {
        h = 0
        v = (128 - v) * 220 / 256 + 128   // Reverse + damping
      }

      if h > 255 { h = 255 }
      if v < 0 { v = 0 }
      if v > 255 { v = 255 }

      balls[d] = h
      balls[d + 1] = v

      // Map height to pixel position
      let pos = h * (LEN - 1) / 255
      pixel(pos, color_wheel(i * 255 / numBalls))
    }

    frame()
  }
}
```

---

## 9. Math and Wave Functions

### Arithmetic

Standard operators: `+`, `-`, `*`, `/`, `%` (modulo)

All arithmetic is **integer** (no floating point). Division truncates:

```wled
let x = 7 / 2     // x = 3 (not 3.5)
let r = 7 % 2     // r = 1 (remainder)
```

### Bitwise Operations

```wled
let a = x & 0xFF        // AND — mask to byte
let b = x | 0x80        // OR — set high bit
let c = x ^ 0xFF        // XOR — invert byte
let d = x << 2          // Shift left (multiply by 4)
let e = x >> 3          // Shift right (divide by 8)
let f = ~x              // Bitwise NOT
```

### Clamping Arithmetic

These are essential for LED math where values must stay in 0-255:

```wled
let a = qadd8(200, 100)   // = 255 (capped, not 300)
let b = qsub8(50, 100)    // = 0   (floored, not -50)
let c = scale8(128, 128)  // = 64  (128 * 128 / 255)
```

### Random Numbers

```wled
let r = random()            // 0-255
let r = random(100)         // 0-99
let r = random(10, 50)      // 10-49
let r16 = random16()        // 0-65535
```

### Wave Functions

These are fast 8-bit approximations (lookup tables, no floating point):

```wled
// All take a phase (0-255) and return 0-255
let s = sin8(phase)     // Sine wave
let c = cos8(phase)     // Cosine wave
let t = tri8(phase)     // Triangle wave (linear up then down)
let q = quad8(phase)    // Quadratic easing (ease-in-out)
```

There's also a 16-bit sine:

```wled
let s16 = sin16(phase)  // phase: 0-65535, returns: -32768 to 32767
```

### Beat Synchronization

`beat8(bpm, offset, beats)` creates a smooth oscillation at a given BPM:

```wled
let pulse = beat8(60, 0, 1)    // 60 BPM, one beat per cycle
let fast = beat8(120, 0, 1)    // 120 BPM
```

Great for pulsing brightness, color cycling, or synchronized movement.

### Perlin Noise

Generate smooth, organic randomness:

```wled
let n = noise(seed)               // 1D noise (0-255)
let n2 = noise2(seedX, seedY)     // 2D noise
let n3 = noise3(seedX, seedY, seedZ) // 3D noise
```

Noise is deterministic: same seed always produces the same value. Animate
by slowly changing the seed:

```wled
for i in 0..LEN {
  let n = noise(i * 50 + NOW / 10)
  pixel(i, palette(n))
}
```

### Other Math

```wled
let s = sqrt(144)      // = 12 (integer square root)
let a = abs(-42)       // = 42
let lo = min(x, y)     // Smaller of x, y
let hi = max(x, y)     // Larger of x, y
```

---

## 10. 2D Matrix Effects

If your LEDs are arranged in a grid (matrix), you can use 2D functions.

### Setting Up a 2D Effect

```wled
effect "2D Gradient" {
  meta {
    type 2D
    palette true
  }

  render {
    for y in 0..HEIGHT {
      for x in 0..WIDTH {
        let idx = (x + y) * 255 / (WIDTH + HEIGHT)
        pixel2d(x, y, palette(idx))
      }
    }
    frame()
  }
}
```

- `WIDTH` and `HEIGHT` give the matrix dimensions.
- `pixel2d(x, y, color)` sets a pixel by (x, y) coordinate.
- `get_pixel2d(x, y)` reads a pixel's current color.

### 2D Drawing Primitives

```wled
// Draw a line from (x1,y1) to (x2,y2)
draw_line(0, 0, WIDTH - 1, HEIGHT - 1, rgb(255, 0, 0))

// Draw circle outline at (cx, cy) with radius r
draw_circle(WIDTH / 2, HEIGHT / 2, 5, rgb(0, 255, 0))

// Draw filled circle
fill_circle(WIDTH / 2, HEIGHT / 2, 3, rgb(0, 0, 255))

// Shift all pixels by (dx, dy). wrap=1 wraps edges, wrap=0 doesn't.
move_pixels(1, 0, 1)    // Shift right, wrapping
move_pixels(0, -1, 0)   // Shift up, no wrap (new pixels are black)
```

### 2D Post-Processing

```wled
fade(240)         // Darken all pixels slightly (creates trails)
blur2d(64)        // Smooth neighboring pixels (glow effect)
```

### Example: Rotating Plasma

```wled
effect "Plasma 2D" {
  meta {
    slider speed "Speed"
    type 2D
    palette true
  }

  render {
    let t = NOW * speed / 512

    for y in 0..HEIGHT {
      for x in 0..WIDTH {
        let v1 = sin8(x * 32 + t)
        let v2 = cos8(y * 32 + t)
        let v3 = sin8((x + y) * 16 + t / 2)
        v1 = (v1 + v2 + v3) / 3
        pixel2d(x, y, palette(v1))
      }
    }

    frame()
  }
}
```

### Example: Raindrop Ripples

```wled
effect "Ripples 2D" {
  meta {
    slider speed "Speed"
    slider intensity "Rate"
    type 2D
    palette true
  }

  render {
    fade(248)

    // Spawn random ripple
    if random(255) < intensity / 4 {
      let rx = random(WIDTH)
      let ry = random(HEIGHT)
      pixel2d(rx, ry, palette(random(255)))
    }

    // Expand ripples via blur
    blur2d(speed / 4)

    frame()
  }
}
```

---

## 11. Text Rendering

2D effects can draw text from the segment name (set in the WLED UI).

### Text Functions

```wled
let len = name_len()           // Length of segment name (0 if unnamed)
let ch = name_char(0)          // ASCII code of first character
let fw = font_w(1)             // Width of font 1 in pixels
let fh = font_h(1)             // Height of font 1 in pixels

// Draw character 'A' (ASCII 65) at position (x, y) in font 1 with color
draw_char(65, 10, 2, 1, rgb(255, 255, 255))
```

### Available Fonts

| ID | Size  | Description     |
|----|-------|-----------------|
| 0  | 4x6   | Tiny            |
| 1  | 5x8   | Small (default) |
| 2  | 6x8   | Medium          |
| 3  | 7x9   | Large           |
| 4  | 5x12  | Tall            |

### Example: Scrolling Text

```wled
effect "Scroll Name" {
  meta {
    slider speed "Speed"
    slider custom1 "Font"
    type 2D
    palette true
  }

  render {
    if CALL == 0 {
      step_val = 0
    }

    fade(200)

    let font = custom1 * 5 / 256
    let fw = font_w(font)
    let fh = font_h(font)
    let tlen = name_len()

    // Skip if no name set
    if tlen == 0 {
      frame()
    }

    let yoff = (HEIGHT - fh) / 2   // Center vertically

    for i in 0..tlen {
      let cx = i * fw + WIDTH - step_val
      if cx + fw > 0 {
        if cx < WIDTH {
          let ch = name_char(i)
          let col = palette(i * 255 / tlen)
          draw_char(ch, cx, yoff, font, col)
        }
      }
    }

    // Advance scroll position
    let totalW = tlen * fw + WIDTH
    step_val = (step_val + speed / 32 + 1) % totalW

    frame()
  }
}
```

---

## 12. Audio-Reactive Effects

Effects can respond to music when the AudioReactive usermod is installed.

### Enabling Audio

You **must** declare `audio_reactive true` in the meta block:

```wled
effect "VU Meter" {
  meta {
    audio_reactive true
    palette true
  }

  render {
    let vol = volume              // Overall volume (0-255)
    let pk = peak                 // Peak level (0-255)
    let numLit = vol * LEN / 255  // Scale to strip length

    fill(rgb(0, 0, 0))
    for i in 0..numLit {
      pixel(i, palette(i * 255 / LEN))
    }
    frame()
  }
}
```

### Audio Variables and Functions

| Name                | Type     | Description                           |
|---------------------|----------|---------------------------------------|
| `volume`            | Variable | Overall volume level (0-255)          |
| `peak`              | Variable | Peak audio level (0-255)              |
| `fft(bin)`          | Function | FFT bin magnitude (bin 0-15, returns 0-255) |
| `audio_bass()`      | Function | Low-frequency energy (0-255)          |
| `audio_mid()`       | Function | Mid-frequency energy (0-255)          |
| `audio_treble()`    | Function | High-frequency energy (0-255)         |

All audio functions are **null-safe**: they return 0 if no AudioReactive
usermod is running. Your effect won't crash — it just won't animate.

### Example: Spectrum Analyzer

```wled
effect "Spectrum" {
  meta {
    slider intensity "Sensitivity"
    audio_reactive true
    palette true
  }

  render {
    fill(rgb(0, 0, 0))

    let bins = 16
    let barW = LEN / bins

    for b in 0..bins {
      let val = fft(b) * intensity / 128
      if val > 255 { val = 255 }

      let numLit = val * barW / 255
      for j in 0..numLit {
        let pos = b * barW + j
        if pos < LEN {
          pixel(pos, palette(b * 255 / bins))
        }
      }
    }

    frame()
  }
}
```

### Example: Bass-Reactive Pulse

```wled
effect "Bass Pulse" {
  meta {
    slider speed "Decay"
    audio_reactive true
    palette true
  }

  render {
    let bass = audio_bass()

    // Smooth decay using aux0
    if bass > aux0 {
      aux0 = bass
    } else {
      aux0 = qsub8(aux0, speed / 8 + 1)
    }

    let bri = aux0
    let c = color_fade(palette(bri), bri)
    fill(c)

    frame()
  }
}
```

---

## 13. Register Limits and Optimization

Understanding register limits is crucial for writing complex effects.

### The Register Budget

The VM has a fixed register file:

- **r0 - r10**: 11 registers for your variables (`let` declarations)
- **r11 - r15**: 5 temporary registers for expression evaluation

If you exceed 11 variables or nest function calls too deeply, compilation fails.

### Counting Variables

Each `let` in scope costs one register:

```wled
let a = 0       // r0
let b = 1       // r1
let c = 2       // r2
// ... up to r10 (11 total)
```

For loops also consume registers for the loop variable and internal
end/step values:

```wled
for i in 0..LEN {      // i = 1 reg, __end = 1 reg, __step = 1 reg = 3 regs
  let x = i * 2        // x = 1 reg → 4 regs total in this scope
}
// i, __end, __step, x are all freed here
```

### Block Scoping Saves Registers

Variables declared inside blocks are freed when the block ends:

```wled
for i in 0..LEN {
  let c = palette(i)    // 'c' allocated here
  pixel(i, c)
}                        // 'c' freed here

for j in 0..LEN {
  let d = rgb(j, 0, 0)  // 'd' reuses 'c's old register
  pixel(j, d)
}
```

### Free Variables (No Register Cost)

These special variables don't consume registers — use them freely:

- `speed`, `intensity`, `custom1`, `custom2`, `custom3` (slider values)
- `aux0`, `aux1` (persistent state)
- `step_val` (persistent counter)
- `check1`, `check2`, `check3` (checkboxes)
- `color0`, `color1`, `color2` (user colors)
- `volume`, `peak` (audio)
- `LEN`, `NOW`, `CALL`, `WIDTH`, `HEIGHT` (read-only constants)

**Tip:** Use `aux0`, `aux1`, `step_val` to hold values that would otherwise
need a `let` variable. They're free!

### Temporary Register Overflow

Each function argument pushes one temporary register. The limit is 5.

```wled
// OK (3 temps): pixel(i, palette(idx))
// OK (4 temps): pixel2d(x, y, palette(idx))
// OK (5 temps): pixel2d(x, y, color_fade(c, bri))

// FAILS (6+ temps):
pixel2d(x, y, color_fade(palette(v), bri))
//                        ^^^^^^^^^^  nested call inside args = too deep
```

**Fix:** Pre-compute intermediate values:

```wled
// Instead of: pixel2d(x, y, color_fade(palette(v), bri))
let c = palette(v)
pixel2d(x, y, color_fade(c, bri))   // Now only 5 temps
```

### Optimization Tips

1. **Reuse variables** instead of declaring new ones:
   ```wled
   let temp = some_calculation()
   pixel(0, temp)
   temp = another_calculation()    // Reuse 'temp' instead of 'let temp2'
   pixel(1, temp)
   ```

2. **Use aux0/aux1/step_val** for outer-scope state to save registers for
   inner loops.

3. **Pre-compute outside loops** when possible:
   ```wled
   let c = palette(128)            // Compute once
   for i in 0..LEN {
     pixel(i, c)                   // Reuse many times
   }
   ```

4. **Keep inner loops lean**: 2D nested loops (for y / for x) consume ~6
   registers for loop variables alone, leaving only ~5 for your code inside.

5. **Break up complex expressions**: Split `f(g(h(x)))` into separate steps.

---

## 14. Complete Language Reference

### Keywords

`effect`, `meta`, `render`, `data`, `let`, `for`, `in`, `while`, `if`,
`else`, `step`, `frame`, `slider`, `type`, `palette`, `audio_reactive`,
`default`, `true`, `false`, `and`, `or`, `not`, `1D`, `2D`

### Operators (by precedence, highest first)

| Precedence | Operators                    | Description              |
|------------|------------------------------|--------------------------|
| 7          | `()` `[]`                    | Call, index              |
| 6          | `-` `not` `~`               | Unary negate, NOT, complement |
| 5          | `*` `/` `%` `&` `<<` `>>`   | Multiply, divide, modulo, bitwise |
| 4          | `+` `-` `\|` `^`            | Add, subtract, OR, XOR  |
| 3          | `==` `!=` `<` `>` `<=` `>=` | Comparison               |
| 2          | `and`                        | Logical AND              |
| 1          | `or`                         | Logical OR               |

### All Built-in Functions

**Pixel I/O:**

| Function                  | Returns | Description                         |
|--------------------------|---------|-------------------------------------|
| `pixel(i, color)`         | void    | Set 1D pixel                       |
| `pixel2d(x, y, color)`   | void    | Set 2D pixel                       |
| `get_pixel(i)`            | color   | Read 1D pixel                      |
| `get_pixel2d(x, y)`      | color   | Read 2D pixel                      |
| `fill(color)`             | void    | Fill entire segment                |
| `fade(amount)`            | void    | Fade all pixels (255=no fade)      |
| `blur(amount)`            | void    | 1D blur (0-255)                    |
| `blur2d(amount)`          | void    | 2D blur (0-255)                    |

**Color:**

| Function                              | Returns | Description                    |
|---------------------------------------|---------|--------------------------------|
| `rgb(r, g, b)`                        | color   | Create RGB color               |
| `rgbw(r, g, b, w)`                    | color   | Create RGBW color              |
| `palette(index)`                      | color   | Sample palette (0-255)         |
| `palette_x(index, bri, offset)`       | color   | Extended palette sample        |
| `color_wheel(hue)`                    | color   | Hue to rainbow color           |
| `blend(c1, c2, amount)`               | color   | Mix two colors (0-255)         |
| `color_fade(color, brightness)`       | color   | Dim a color (0-255)            |
| `color_add(c1, c2)`                   | color   | Saturating add                 |
| `red(color)`                          | 0-255   | Extract red channel            |
| `green(color)`                        | 0-255   | Extract green channel          |
| `blue(color)`                         | 0-255   | Extract blue channel           |
| `white(color)`                        | 0-255   | Extract white channel          |

**Math:**

| Function                     | Returns        | Description                    |
|------------------------------|----------------|--------------------------------|
| `sin8(phase)`                | 0-255          | Fast 8-bit sine                |
| `cos8(phase)`                | 0-255          | Fast 8-bit cosine              |
| `sin16(phase)`               | -32768..32767  | 16-bit sine                    |
| `tri8(phase)`                | 0-255          | Triangle wave                  |
| `quad8(phase)`               | 0-255          | Quadratic easing               |
| `beat8(bpm, offset, beats)`  | 0-255          | BPM oscillation                |
| `scale8(val, scale)`         | 0-255          | Scale (val*scale/255)          |
| `qadd8(a, b)`                | 0-255          | Saturating add                 |
| `qsub8(a, b)`               | 0-255          | Saturating subtract            |
| `random()`                   | 0-255          | Random byte                    |
| `random(max)`                | 0 to max-1     | Random in range                |
| `random(min, max)`           | min to max-1   | Random in range                |
| `random16()`                 | 0-65535        | Random 16-bit                  |
| `noise(seed)`                | 0-255          | 1D Perlin noise                |
| `noise2(x, y)`               | 0-255          | 2D Perlin noise                |
| `noise3(x, y, z)`           | 0-255          | 3D Perlin noise                |
| `sqrt(val)`                  | int            | Integer square root            |
| `abs(val)`                   | int            | Absolute value                 |
| `min(a, b)`                  | int            | Minimum                        |
| `max(a, b)`                  | int            | Maximum                        |

**2D Geometry (void):**

| Function                           | Description                    |
|------------------------------------|--------------------------------|
| `draw_line(x1, y1, x2, y2, color)` | Draw line                     |
| `draw_circle(cx, cy, r, color)`    | Draw circle outline            |
| `fill_circle(cx, cy, r, color)`    | Draw filled circle             |
| `move_pixels(dx, dy, wrap)`        | Shift all pixels               |

**Text (2D):**

| Function                            | Returns | Description               |
|--------------------------------------|---------|---------------------------|
| `draw_char(char, x, y, font, color)` | void   | Draw character to matrix  |
| `name_char(index)`                   | 0-255  | Char from segment name    |
| `name_len()`                         | 0-255  | Length of segment name    |
| `font_w(font_id)`                    | pixels | Font width               |
| `font_h(font_id)`                    | pixels | Font height              |

**Audio (requires `audio_reactive true`):**

| Function          | Returns | Description               |
|-------------------|---------|---------------------------|
| `fft(bin)`        | 0-255   | FFT bin (0-15)            |
| `audio_bass()`    | 0-255   | Bass frequency energy     |
| `audio_mid()`     | 0-255   | Mid frequency energy      |
| `audio_treble()`  | 0-255   | Treble frequency energy   |

**Audio Variables:** `volume` (0-255), `peak` (0-255)

### Special Variables (No Register Cost)

| Variable                 | Access | Description                        |
|--------------------------|--------|------------------------------------|
| `LEN`                    | Read   | Segment pixel count                |
| `NOW`                    | Read   | Milliseconds (32-bit)              |
| `CALL`                   | Read   | Frame counter                      |
| `WIDTH`                  | Read   | Matrix width (2D)                  |
| `HEIGHT`                 | Read   | Matrix height (2D)                 |
| `speed`                  | Read   | Speed slider (0-255)               |
| `intensity`              | Read   | Intensity slider (0-255)           |
| `custom1` / `custom2` / `custom3` | Read | Custom sliders (0-255)   |
| `check1` / `check2` / `check3`    | Read | UI checkboxes            |
| `color0` / `color1` / `color2`    | Read | UI color picks           |
| `aux0` / `aux1`         | R/W    | Persistent values                  |
| `step_val`               | R/W    | Persistent counter                 |
| `volume` / `peak`        | Read   | Audio levels                       |

### Literals

```wled
255         // Decimal integer
0xFF        // Hexadecimal
true        // Boolean true (1)
false       // Boolean false (0)
"string"    // String (only in meta/effect declarations)
```

### Comments

```wled
// This is a line comment
// No block comments available
```

---

## 15. Recipes and Patterns

### Pattern: Scrolling Effect

Move a pattern across the strip using `NOW`:

```wled
let offset = NOW / 10
for i in 0..LEN {
  let idx = (i + offset) % 256
  pixel(i, palette(idx))
}
frame()
```

### Pattern: Twinkling Stars

Random pixels light up and fade:

```wled
effect "Twinkle" {
  meta {
    slider speed "Fade speed"
    slider intensity "Density"
    palette true
  }

  render {
    fade(255 - speed / 4)

    let numNew = intensity / 16 + 1
    for i in 0..numNew {
      let pos = random(LEN)
      pixel(pos, palette(random(255)))
    }

    frame()
  }
}
```

### Pattern: Color Wipe

Fill from one end to the other, then clear:

```wled
effect "Color Wipe" {
  meta {
    slider speed "Speed"
    palette true
  }

  render {
    if CALL == 0 {
      aux0 = 0     // Current position
      aux1 = 0     // Phase: 0=fill, 1=clear
    }

    if aux1 == 0 {
      pixel(aux0, palette(aux0 * 255 / LEN))
    } else {
      pixel(aux0, rgb(0, 0, 0))
    }

    aux0 = aux0 + 1
    if aux0 >= LEN {
      aux0 = 0
      aux1 = 1 - aux1   // Toggle phase
    }

    frame()
  }
}
```

### Pattern: Smooth Breathing

Pulse brightness smoothly using sin8:

```wled
effect "Breathe" {
  meta {
    slider speed "Speed"
    palette true
  }

  render {
    let phase = NOW * speed / 1024
    let bri = sin8(phase % 256)
    let c = color_fade(palette(128), bri)
    fill(c)
    frame()
  }
}
```

### Pattern: Pixel Shift (Scrolling Buffer)

Shift pixels along the strip and add new ones at one end:

```wled
// Shift right, add new pixel at position 0
for i in 1..LEN {
  let pos = LEN - i
  pixel(pos, get_pixel(pos - 1))
}
pixel(0, new_color)
```

### Pattern: Mirrored Effect

Paint the first half and mirror to the second:

```wled
let half = LEN / 2
for i in 0..half {
  let c = palette(i * 255 / half)
  pixel(i, c)
  pixel(LEN - 1 - i, c)
}
```

### Pattern: Probability-Based Spawning

Spawn events at a rate controlled by a slider:

```wled
if random(255) < intensity / 4 {
  // Spawn something (e.g., a spark, raindrop, etc.)
  let pos = random(LEN)
  pixel(pos, rgb(255, 255, 255))
}
```

### Pattern: Speed-Gated Updates

Only update every N frames based on speed:

```wled
let tick = NOW / max(256 - speed, 1)
if aux0 != tick {
  aux0 = tick
  // Do the actual update work here
}
```

### Pattern: Smooth Color Transitions

Blend between the current and target color over time:

```wled
// aux0 = current value, aux1 = target
if aux0 < aux1 {
  aux0 = qadd8(aux0, 2)     // Move toward target
} else {
  aux0 = qsub8(aux0, 2)
}
```

### Pattern: 2D Diagonal Sweep

```wled
let t = NOW / 20
for y in 0..HEIGHT {
  for x in 0..WIDTH {
    let idx = (x + y * 2 + t) % 256
    pixel2d(x, y, palette(idx))
  }
}
```

### Pattern: Audio VU Meter (Vertical Bars)

```wled
// Requires: audio_reactive true, type 2D
for x in 0..WIDTH {
  let bin = x * 16 / WIDTH
  let val = fft(bin)
  let numLit = val * HEIGHT / 255

  for y in 0..HEIGHT {
    if y < numLit {
      pixel2d(x, HEIGHT - 1 - y, palette(y * 255 / HEIGHT))
    } else {
      pixel2d(x, HEIGHT - 1 - y, rgb(0, 0, 0))
    }
  }
}
```

---

## Quick Reference Card

```
STRUCTURE:       effect "Name" { meta { ... } data buf[N] render { ... } }
PIXEL OPS:       pixel(i, c)  pixel2d(x, y, c)  fill(c)  fade(n)  blur(n)
READ PIXEL:      get_pixel(i)  get_pixel2d(x, y)
COLORS:          rgb(r,g,b)  rgbw(r,g,b,w)  palette(idx)  color_wheel(hue)
COLOR MATH:      blend(c1,c2,amt)  color_fade(c,bri)  color_add(c1,c2)
EXTRACT:         red(c)  green(c)  blue(c)  white(c)
MATH:            sin8  cos8  tri8  quad8  beat8  sin16  sqrt  abs  min  max
SAFE MATH:       qadd8(a,b)  qsub8(a,b)  scale8(v,s)
RANDOM:          random()  random(max)  random(min,max)  random16()
NOISE:           noise(s)  noise2(x,y)  noise3(x,y,z)
2D DRAW:         draw_line  draw_circle  fill_circle  move_pixels  blur2d
TEXT:            draw_char  name_char  name_len  font_w  font_h
AUDIO:           volume  peak  fft(bin)  audio_bass()  audio_mid()  audio_treble()
STATE:           aux0  aux1  step_val  (persistent, free)
CONSTANTS:       LEN  NOW  CALL  WIDTH  HEIGHT
SLIDERS:         speed  intensity  custom1  custom2  custom3
COLORS:          color0  color1  color2
CHECKS:          check1  check2  check3
FRAME:           frame()  frame(ms)
LIMITS:          11 variables, 5 temp depth, 4KB data buffer
```
