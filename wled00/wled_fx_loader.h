#pragma once
/*
 * WLED FX Loader — Loads .wfx bytecode effect files from LittleFS
 * and registers them with WS2812FX at runtime.
 */

#ifndef WLED_FX_LOADER_H
#define WLED_FX_LOADER_H

#include <cstdint>

// Forward declarations
class WS2812FX;
struct Segment;

#define FX_DIR          "/fx"
#define FX_MAX_EFFECTS  180   // max number of loaded bytecode effects
#define FX_METADATA_MAX 128   // max metadata string length

struct WfxEffect {
  uint8_t   id;               // assigned mode ID in WS2812FX
  uint8_t   flags;            // from WFX header
  bool      pendingDelete;    // marked for deferred deletion (safe across tasks)
  uint16_t  bcLen;            // bytecode length
  uint16_t  dataSize;         // min data buffer size needed
  char      metadata[FX_METADATA_MAX]; // WLED effect metadata string
  uint8_t*  bytecode;         // heap/PSRAM-allocated bytecode
  char      filename[32];     // filename (without path)
};

class FXLoader {
public:
  // Initialize: scan /fx/ directory and load all .wfx files
  static void init();

  // Load a single .wfx file and register it as an effect
  static bool loadEffect(const char* path);

  // Unload an effect by mode ID, remove from strip
  static bool unloadEffect(uint8_t modeId);

  // Unload by filename
  static bool unloadEffectByName(const char* filename);

  // Get effect data for a given mode ID (used by vm_trampoline)
  static WfxEffect* getEffect(uint8_t modeId);

  // Get number of loaded bytecode effects
  static uint8_t count();

  // Serialize effect list to JSON
  static void listEffects(/* JsonArray& arr */);

  // The trampoline function registered as mode_ptr for all bytecode effects
  static void vmTrampoline();

  // Process pending deletes — call from main loop (not async context)
  static void servicePendingDeletes();

private:
  static WfxEffect _effects[FX_MAX_EFFECTS]; // fixed array — stable pointers, no shifting
  static uint8_t _numSlots;                  // high-water mark (slots used, including freed gaps)
  static uint8_t _modeToSlot[256];           // mode ID → slot index (255 = unmapped)
};

#endif // WLED_FX_LOADER_H
