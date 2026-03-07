/*
  WS2812FX.cpp contains all effect methods
  Harm Aldick - 2016
  www.aldick.org

  Copyright (c) 2016  Harm Aldick
  Licensed under the EUPL v. 1.2 or later
  Adapted from code originally licensed under the MIT license

  Modified heavily for WLED
*/

#include "wled.h"
#include "FX.h"
#include "fcn_declare.h"

// paletteBlend: 0 - wrap when moving, 1 - always wrap, 2 - never wrap, 3 - none (undefined)
#define PALETTE_SOLID_WRAP (strip.paletteBlend == 1 || strip.paletteBlend == 3)

// effect functions

/*
 * No blinking. Just plain old static light.
 */
void mode_static(void)
{
  SEGMENT.fill(SEGCOLOR(0));
}
static const char _data_FX_MODE_STATIC[] PROGMEM = "Solid";

//////////////////////////////////////////////////////////////////////////////////////////
// mode data
static const char _data_RESERVED[] PROGMEM = "RSVD";

// add (or replace reserved) effect mode and data into vector
// use id==255 to find unallocated gaps (with "Reserved" data string)
// if vector size() is smaller than id (single) data is appended at the end (regardless of id)
// return the actual id used for the effect or 255 if the add failed.
uint8_t WS2812FX::addEffect(uint8_t id, mode_ptr mode_fn, const char *mode_name)
{
  if (id == 255)
  { // find empty slot
    for (size_t i = 1; i < _mode.size(); i++)
      if (_modeData[i] == _data_RESERVED)
      {
        id = i;
        break;
      }
  }
  if (id < _mode.size())
  {
    if (_modeData[id] != _data_RESERVED)
      return 255; // do not overwrite an already added effect
    _mode[id] = mode_fn;
    _modeData[id] = mode_name;
    return id;
  }
  else if (_mode.size() < 255)
  { // 255 is reserved for indicating the effect wasn't added
    _mode.push_back(mode_fn);
    _modeData.push_back(mode_name);
    if (_modeCount < _mode.size())
      _modeCount++;
    return _mode.size() - 1;
  }
  else
  {
    return 255; // The vector is full so return 255
  }
}

// Reset an effect slot back to Reserved. Segments using this mode switch to Solid.
bool WS2812FX::removeEffect(uint8_t id)
{
  if (id == 0 || id >= _mode.size())
    return false; // can't remove Solid or out-of-range
  if (_modeData[id] == _data_RESERVED)
    return false;           // already reserved
  _mode[id] = &mode_static; // safe fallback function
  _modeData[id] = _data_RESERVED;
  // Reset any segment using this mode to Solid
  for (size_t i = 0; i < _segments.size(); i++)
  {
    if (_segments[i].mode == id)
      _segments[i].mode = DEFAULT_MODE;
  }
  return true;
}

void WS2812FX::setupEffectData()
{
  // Solid must be first! (assuming vector is empty upon call to setup)
  _mode.push_back(&mode_static);
  _modeData.push_back(_data_FX_MODE_STATIC);
  // Sync _modeCount with actual vector size (MODE_COUNT is >1 just to pass constructor capacity check)
  _modeCount = _mode.size();
  // All other effects are loaded as .wfx bytecode by FXLoader::init()
}
