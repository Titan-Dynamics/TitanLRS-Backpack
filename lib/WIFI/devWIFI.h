#pragma once

#include "device.h"
#include <stdint.h>

#if defined(PLATFORM_ESP32) || defined(PLATFORM_ESP8266)
extern device_t WIFI_device;
#define HAS_WIFI

extern const char *VERSION;

#if defined(TARGET_TX_BACKPACK)
// CRSF WebSocket functions for device parameter passthrough
void crsfWsRegisterUartCallback(void (*callback)(uint8_t* data, uint8_t len));
void crsfWsSendFrame(uint8_t* data, uint8_t len);
bool crsfWsHasClients();
#endif

#endif