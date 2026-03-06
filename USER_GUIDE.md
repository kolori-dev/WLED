# WLED Effects User Guide

## What's New

WLED effects are no longer baked into the firmware. Instead, effects are individual files (`.wfx`) that live on your device's filesystem. You can add, remove, and swap effects whenever you want — directly from the WLED web interface. No need to reflash firmware.

Your device ships with the **Solid** effect built in. All other effects are loaded from `.wfx` files that you upload.

## Requirements

- An **ESP32-based** WLED device (ESP8266 is not supported for loadable effects)
- WLED firmware with the bytecode VM (this version)
- A computer or phone with a web browser to access the WLED web UI

## Getting Effect Files

Effect files have the `.wfx` extension. You can get them in two ways:

### Option A: Download Pre-Compiled Effects

If someone has shared `.wfx` files with you (from a community pack, a GitHub release, or another user), you're ready to go. Skip to [Uploading Effects](#uploading-effects).

### Option B: Compile From Source

If you have `.wled` source files (the human-readable effect scripts), you can compile them yourself. This requires [Node.js](https://nodejs.org/) (version 20 or newer) installed on your computer.

1. Open a terminal/command prompt
2. Navigate to the `wfx_compiler` folder in the WLED project
3. Run:

```
node compiler.js path/to/my_effect.wled -o my_effect.wfx
```

This produces a `.wfx` file you can upload to your device.

To compile **all** the included effects at once:

```
node compiler.js ../wfx_effects/
```

The compiled `.wfx` files will appear next to each `.wled` source file in the `wfx_effects` folder.

## Uploading Effects

1. Open your WLED device's web interface (e.g., `http://[your-device-ip]`)
2. Go to the **Effects** tab
3. Click the **Add Effects** button at the top of the effects list
4. A file picker will appear — select one or more `.wfx` files from your computer
5. Click **Upload**
6. Wait for the "Done!" confirmation message
7. Your new effects appear in the effects list immediately — no reboot needed

You can upload multiple files at once by selecting them together in the file picker.

## Using Effects

Once uploaded, your effects appear in the normal effects list alongside Solid. Just tap any effect name to activate it on the current segment.

Effects respond to the same controls as always:

- **Speed** slider — controls animation speed (higher = faster)
- **Intensity** slider — controls effect intensity or density
- **Custom 1 / Custom 2 / Custom 3** sliders — additional parameters (if the effect supports them)
- **Color pickers** — set segment colors used by the effect
- **Palette selector** — choose a color palette (if the effect supports palettes)

Only the sliders an effect actually uses are shown. For example, static pattern effects that run at a fixed frame rate hide the speed slider entirely.

## Deleting Effects

1. In the Effects list, find the effect you want to remove
2. Click the small **dropdown arrow** (&#9660;) on the right side of the effect entry
3. A menu appears — click **Delete**
4. Confirm the deletion when prompted
5. The effect is removed from the list

After deleting, segments that were using that effect will switch back to Solid. A reboot is recommended after deleting effects to fully clean up.

**Note:** You cannot delete the built-in Solid effect.

## Backing Up Your Effects

It's a good idea to back up your effects before updating firmware.

1. Go to **Config** > **Security & Updates**
2. Click **Backup effects**
3. Your browser downloads a `wled_effects.tar` file containing all your uploaded `.wfx` files

To restore after a firmware update, extract the `.tar` file and re-upload the `.wfx` files through the Add Effects button.

## How Many Effects Can I Have?

- Up to **180** effects can be loaded at the same time
- In practice, the limit depends on your device's available flash storage
- Typical effects are very small (under 1KB each), so most devices can hold well over 100

## Troubleshooting

### "I uploaded an effect but it doesn't appear"
- Make sure the file has a `.wfx` extension (not `.wled` — that's the uncompiled source)
- Check that the upload completed successfully (you should see "Done!")
- Try refreshing the page in your browser

### "An effect isn't animating / looks wrong"
- Check the **Speed** slider — some effects are very slow at low speed values
- Try adjusting **Intensity** and the **Custom** sliders
- Make sure you have enough LEDs in the segment — some effects need a minimum length to look right
- 2D effects require a 2D matrix setup. They won't display correctly on a 1D strip

### "My device seems slow after uploading many effects"
- Effects only use resources when actively running. Having many effects uploaded doesn't slow down the device
- If a specific effect seems slow, it may be too complex for your segment length. Try a shorter segment

### "I want to update an effect"
- Currently, re-uploading a file with the same name adds a second copy rather than replacing it
- To update: delete the old version first, then upload the new one

### "I lost my effects after a firmware update"
- Firmware updates may erase the filesystem depending on the update method
- Always back up your effects before updating (see [Backing Up](#backing-up-your-effects))
- OTA updates from the WLED UI typically preserve the filesystem, but a full flash erase will not

## Included Effects

This version of WLED includes **167 effect source files** in the `wfx_effects` folder, covering all the classics:

- Rainbow, Chase, Comet, Meteor, Fireworks, Twinkle, Fire, Breathe, Sparkle, Strobe, and many more
- 2D effects like Plasma, DNA, Rain, Matrix, Game of Life, Spiral Galaxy, and Scrolling Text
- Audio-reactive effects like BPM, DJ Light, GEQ, Gravimeter, and Waterfall (requires the AudioReactive usermod)

These are provided as `.wled` source files. Compile them to `.wfx` using the compiler (see [Compile From Source](#option-b-compile-from-source)), then upload to your device.

## Previewing Effects (Simulator)

You can preview effects in your browser without any hardware using the built-in simulator:

1. Make sure [Node.js](https://nodejs.org/) (version 20+) is installed
2. Run: `node wfx_compiler/simulator/serve.js`
3. A browser window opens at `http://localhost:3456`
4. Drag and drop a `.wled` or `.wfx` file onto the simulator — it compiles and runs automatically
5. Adjust sliders, palette, colors, and grid size to see how the effect looks
6. For text effects (like Scrolling Text), type a name in the **Segment Name** field

The simulator faithfully reproduces the bytecode VM, so effects look the same as they would on real hardware.

## For Effect Creators

Want to write your own effects? See the [WLED-Lang language reference](wfx_effects/README.md) for the full scripting guide. Effects are written in a simple, purpose-built language — no C++ knowledge required.
