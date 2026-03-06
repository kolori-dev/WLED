/*
 * WLED FX Loader — Loads .wfx bytecode effect files from LittleFS
 * and registers them with WS2812FX at runtime.
 */

#include "wled.h"
#include "wled_vm.h"
#include "wled_fx_loader.h"
#include "FX.h"

// Static member initialization
WfxEffect FXLoader::_effects[FX_MAX_EFFECTS];
uint8_t FXLoader::_numSlots = 0;
uint8_t FXLoader::_modeToSlot[256];

// Shared VM instance (one per frame, not per effect — effects don't run concurrently)
static WledVM vmInstance;

// Trampoline: called by WS2812FX::service() for bytecode effects
void FXLoader::vmTrampoline() {
  uint8_t modeId = SEGMENT.mode;
  WfxEffect* fx = getEffect(modeId);
  if (!fx || !fx->bytecode || fx->pendingDelete) return;

  // Allocate data buffer if the effect needs one
  if (fx->dataSize > 0) {
    if (!SEGMENT.allocateData(fx->dataSize)) {
      // Can't allocate — fall back to solid fill
      SEGMENT.fill(SEGCOLOR(0));
      return;
    }
  }

  // Look up audio data only for effects that declare WFX_FLAG_AUDIO
  float* volSmth = nullptr;
  uint8_t* fftData = nullptr;
  uint8_t* peak = nullptr;

  if (fx->flags & WFX_FLAG_AUDIO) {
    um_data_t* um_data = nullptr;
    if (UsermodManager::getUMData(&um_data, USERMOD_ID_AUDIOREACTIVE) && um_data) {
      volSmth = (float*)um_data->u_data[0];    // volumeSmth
      fftData = (uint8_t*)um_data->u_data[2];  // fftResult[16]
      peak    = (uint8_t*)um_data->u_data[3];   // samplePeak
    } else {
      um_data = simulateSound(SEGMENT.soundSim);
      if (um_data) {
        volSmth = (float*)um_data->u_data[0];
        fftData = (uint8_t*)um_data->u_data[2];
        peak    = (uint8_t*)um_data->u_data[3];
      }
    }
  }

  vmInstance.execute(fx->bytecode, fx->bcLen, SEGMENT, volSmth, fftData, peak);
}

void FXLoader::init() {
  DEBUG_PRINTLN(F("FXLoader: init start"));

  // Free any previously loaded bytecode
  for (uint8_t i = 0; i < _numSlots; i++) {
    if (_effects[i].bytecode) { free(_effects[i].bytecode); _effects[i].bytecode = nullptr; }
  }
  memset(_effects, 0, sizeof(_effects));
  memset(_modeToSlot, 255, sizeof(_modeToSlot));
  _numSlots = 0;

  // Create /fx directory if it doesn't exist
  if (!WLED_FS.mkdir(FX_DIR)) {
    DEBUG_PRINTLN(F("FXLoader: mkdir /fx/ failed (may already exist)"));
  }

  // Scan /fx/ for .wfx files
  File dir = WLED_FS.open(FX_DIR);
  if (!dir || !dir.isDirectory()) {
    DEBUG_PRINTLN(F("FXLoader: /fx/ directory not found, skipping"));
    return;
  }

  File file = dir.openNextFile();
  while (file) {
    if (!file.isDirectory()) {
      String name = file.name();
      if (name.endsWith(".wfx")) {
        String fullPath = String(FX_DIR) + "/" + name;
        loadEffect(fullPath.c_str());
      }
    }
    file = dir.openNextFile();
  }

  DEBUG_PRINTF_P(PSTR("FXLoader: loaded %d bytecode effects\n"), count());
}

bool FXLoader::loadEffect(const char* path) {
  // Find a free slot: first check gaps (bytecode==nullptr), then extend
  int8_t slot = -1;
  for (uint8_t i = 0; i < _numSlots; i++) {
    if (!_effects[i].bytecode && !_effects[i].pendingDelete) { slot = i; break; }
  }
  if (slot < 0) {
    if (_numSlots >= FX_MAX_EFFECTS) {
      DEBUG_PRINTLN(F("FXLoader: max effects reached"));
      return false;
    }
    slot = _numSlots;
  }

  File file = WLED_FS.open(path, "r");
  if (!file) {
    DEBUG_PRINTF_P(PSTR("FXLoader: cannot open %s\n"), path);
    return false;
  }

  // Validate file is large enough for header + at least 1 byte metadata + 1 byte bytecode
  size_t fileSize = file.size();
  if (fileSize < sizeof(WfxHeader) + 2) {
    DEBUG_PRINTLN(F("FXLoader: file too small"));
    file.close();
    return false;
  }

  // Read and validate header
  WfxHeader header;
  if (file.read((uint8_t*)&header, sizeof(WfxHeader)) != sizeof(WfxHeader)) {
    DEBUG_PRINTLN(F("FXLoader: header read failed"));
    file.close();
    return false;
  }

  if (header.magic[0] != WFX_MAGIC_0 || header.magic[1] != WFX_MAGIC_1 ||
      header.magic[2] != WFX_MAGIC_2 || header.version != WFX_VERSION) {
    DEBUG_PRINTLN(F("FXLoader: invalid WFX header"));
    file.close();
    return false;
  }

  // Validate bytecode length: must be non-zero and fit within the file
  size_t maxBcLen = fileSize - sizeof(WfxHeader) - 1; // at least 1 byte for metadata null terminator
  if (header.bytecodeLen == 0 || header.bytecodeLen > maxBcLen) {
    DEBUG_PRINTLN(F("FXLoader: invalid bytecode length"));
    file.close();
    return false;
  }

  // Read metadata string (null-terminated, after header)
  WfxEffect fx;
  memset(&fx, 0, sizeof(WfxEffect));
  fx.flags = header.flags;
  fx.dataSize = (uint16_t)header.dataSize * 16; // stored in 16-byte units
  fx.bcLen = header.bytecodeLen;

  // Read metadata string byte-by-byte until null terminator
  int metaIdx = 0;
  while (metaIdx < FX_METADATA_MAX - 1) {
    int b = file.read();
    if (b <= 0) break; // EOF or null
    fx.metadata[metaIdx++] = (char)b;
  }
  fx.metadata[metaIdx] = '\0';
  // If metadata was truncated, consume remaining bytes until null terminator
  // to keep file position aligned for bytecode read
  if (metaIdx == FX_METADATA_MAX - 1) {
    int b;
    do { b = file.read(); } while (b > 0);
  }

  if (metaIdx == 0) {
    // No metadata — use filename as effect name
    const char* fname = strrchr(path, '/');
    fname = fname ? fname + 1 : path;
    strncpy(fx.metadata, fname, FX_METADATA_MAX - 1);
    // Remove .wfx extension
    char* dot = strrchr(fx.metadata, '.');
    if (dot) *dot = '\0';
  }

  // Read bytecode
  #ifdef BOARD_HAS_PSRAM
  fx.bytecode = (uint8_t*)ps_malloc(fx.bcLen);
  #else
  fx.bytecode = (uint8_t*)malloc(fx.bcLen);
  #endif

  if (!fx.bytecode) {
    DEBUG_PRINTLN(F("FXLoader: bytecode malloc failed"));
    file.close();
    return false;
  }

  if (file.read(fx.bytecode, fx.bcLen) != fx.bcLen) {
    DEBUG_PRINTLN(F("FXLoader: bytecode read incomplete"));
    free(fx.bytecode);
    file.close();
    return false;
  }
  file.close();

  // Store filename
  const char* fname = strrchr(path, '/');
  fname = fname ? fname + 1 : path;
  strncpy(fx.filename, fname, sizeof(fx.filename) - 1);
  fx.filename[sizeof(fx.filename) - 1] = '\0';

  // Store in persistent array FIRST so the metadata pointer stays valid
  // (addEffect stores a raw pointer to the name string)
  _effects[slot] = fx;

  // Register with WS2812FX using the persistent metadata pointer
  uint8_t assignedId = strip.addEffect(255, &FXLoader::vmTrampoline, _effects[slot].metadata);
  if (assignedId == 255) {
    DEBUG_PRINTLN(F("FXLoader: addEffect failed (strip full)"));
    free(_effects[slot].bytecode);
    memset(&_effects[slot], 0, sizeof(WfxEffect));
    return false;
  }

  _effects[slot].id = assignedId;
  _modeToSlot[assignedId] = (uint8_t)slot;
  if (slot >= _numSlots) _numSlots = slot + 1; // extend high-water mark

  DEBUG_PRINTF_P(PSTR("FXLoader: loaded '%s' as mode %d (%d bytes)\n"),
    _effects[slot].metadata, assignedId, fx.bcLen);

  return true;
}

bool FXLoader::unloadEffect(uint8_t modeId) {
  for (uint8_t i = 0; i < _numSlots; i++) {
    if (_effects[i].bytecode && _effects[i].id == modeId) {
      // Mark for deferred deletion — actual free happens in servicePendingDeletes()
      // called from main loop, avoiding race with VM execution in the same task.
      _effects[i].pendingDelete = true;
      return true;
    }
  }
  return false;
}

bool FXLoader::unloadEffectByName(const char* filename) {
  for (uint8_t i = 0; i < _numSlots; i++) {
    if (_effects[i].bytecode && strcmp(_effects[i].filename, filename) == 0) {
      _effects[i].pendingDelete = true;
      // Delete the file from filesystem
      String fullPath = String(FX_DIR) + "/" + filename;
      WLED_FS.remove(fullPath);
      return true;
    }
  }
  return false;
}

// Called from main loop — safe to free bytecode and modify strip since
// VM execution (vmTrampoline) runs in the same task context.
void FXLoader::servicePendingDeletes() {
  for (uint8_t i = 0; i < _numSlots; i++) {
    if (_effects[i].pendingDelete) {
      // Clear lookup table entry
      _modeToSlot[_effects[i].id] = 255;
      // Remove from strip first (resets segments using this mode to Solid)
      strip.removeEffect(_effects[i].id);
      // Free bytecode
      if (_effects[i].bytecode) { free(_effects[i].bytecode); }
      // Clear slot — now available for reuse by loadEffect()
      memset(&_effects[i], 0, sizeof(WfxEffect));
    }
  }
}

WfxEffect* FXLoader::getEffect(uint8_t modeId) {
  uint8_t slot = _modeToSlot[modeId];
  if (slot < _numSlots && _effects[slot].bytecode && _effects[slot].id == modeId) {
    return &_effects[slot];
  }
  return nullptr;
}

uint8_t FXLoader::count() {
  uint8_t n = 0;
  for (uint8_t i = 0; i < _numSlots; i++) {
    if (_effects[i].bytecode && !_effects[i].pendingDelete) n++;
  }
  return n;
}
