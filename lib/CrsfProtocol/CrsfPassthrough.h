#pragma once

#include <stdint.h>
#include "crsf_protocol.h"

// Maximum CRSF packet size for passthrough buffer
#define CRSF_PASSTHROUGH_MAX_PACKET_SIZE 64

/**
 * CrsfPassthrough - A simple CRSF frame detector for passthrough operation.
 *
 * This class parses CRSF frames byte-by-byte similar to the MSP parser.
 * It is designed for transparent passthrough between UART and WebSocket,
 * with minimal RAM usage on the ESP.
 *
 * Frame format: [SYNC 0xC8][LENGTH][TYPE][PAYLOAD...][CRC]
 * For extended frames (type >= 0x28): [SYNC][LENGTH][TYPE][DEST][ORIGIN][PAYLOAD...][CRC]
 */
class CrsfPassthrough
{
public:
    CrsfPassthrough();

    /**
     * Process a received byte from UART.
     * @param c The byte to process
     * @return true if a complete valid frame has been received
     */
    bool processReceivedByte(uint8_t c);

    /**
     * Get pointer to the received frame buffer.
     * Valid only after processReceivedByte returns true.
     * @return Pointer to frame data (includes sync byte, length, type, payload, crc)
     */
    uint8_t* getReceivedFrame();

    /**
     * Get the total length of the received frame.
     * @return Total frame length in bytes (sync + length + type + payload + crc)
     */
    uint8_t getReceivedFrameLength();

    /**
     * Reset the parser state to idle.
     * Call this after processing a received frame.
     */
    void markFrameReceived();

    /**
     * Calculate CRC-8 for CRSF data.
     * @param data Pointer to data (should be TYPE through PAYLOAD, excluding sync, length, crc)
     * @param length Number of bytes to process
     * @return Calculated CRC-8 value
     */
    static uint8_t calculateCRC(const uint8_t* data, uint8_t length);

    /**
     * Validate CRC of a complete frame.
     * @param frame Pointer to complete frame including sync byte
     * @param length Total frame length
     * @return true if CRC is valid
     */
    static bool validateFrame(const uint8_t* frame, uint8_t length);

    /**
     * Check if a frame type uses extended addressing (dest/origin fields).
     * @param type The CRSF frame type
     * @return true if type >= 0x28
     */
    static bool isExtendedType(uint8_t type);

private:
    enum ParserState {
        CRSF_IDLE,
        CRSF_LENGTH,
        CRSF_DATA,
        CRSF_FRAME_RECEIVED
    };

    ParserState m_state;
    uint8_t m_buffer[CRSF_PASSTHROUGH_MAX_PACKET_SIZE];
    uint8_t m_bufferPos;
    uint8_t m_frameLength;  // Expected total frame length (sync + length byte + data)
};
