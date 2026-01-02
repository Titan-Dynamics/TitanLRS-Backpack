#include "CrsfPassthrough.h"
#include "crc.h"

// Maximum payload length (packet size - sync - length - type - crc)
#define CRSF_PASSTHROUGH_MAX_PAYLOAD_LEN (CRSF_PASSTHROUGH_MAX_PACKET_SIZE - 4)

// CRC-8 instance with CRSF polynomial 0xD5
static GENERIC_CRC8 crsf_crc8(CRSF_CRC_POLY);

CrsfPassthrough::CrsfPassthrough() :
    m_state(CRSF_IDLE),
    m_bufferPos(0),
    m_frameLength(0)
{
}

bool CrsfPassthrough::processReceivedByte(uint8_t c)
{
    switch (m_state)
    {
        case CRSF_IDLE:
            // Wait for sync byte
            if (c == CRSF_SYNC_BYTE)
            {
                m_buffer[0] = c;
                m_bufferPos = 1;
                m_state = CRSF_LENGTH;
            }
            break;

        case CRSF_LENGTH:
            // Read the length byte
            // Length field = type + payload + crc (excludes sync and length bytes)
            // Valid range: 3 (min: type + 1 byte payload + crc) to CRSF_PASSTHROUGH_MAX_PAYLOAD_LEN + 2
            if (c >= 3 && c <= (CRSF_PASSTHROUGH_MAX_PAYLOAD_LEN + 2))
            {
                m_buffer[1] = c;
                m_bufferPos = 2;
                m_frameLength = c + 2;  // Total frame = sync + length + (length field value)
                m_state = CRSF_DATA;
            }
            else
            {
                // Invalid length, reset
                m_state = CRSF_IDLE;
            }
            break;

        case CRSF_DATA:
            // Read remaining data bytes
            m_buffer[m_bufferPos++] = c;

            if (m_bufferPos >= m_frameLength)
            {
                // Frame complete, validate CRC
                // CRC is calculated over type through payload (excludes sync, length, and crc itself)
                uint8_t len = m_buffer[1];
                uint8_t receivedCrc = m_buffer[m_frameLength - 1];
                uint8_t calculatedCrc = calculateCRC(&m_buffer[2], len - 1);

                if (receivedCrc == calculatedCrc)
                {
                    m_state = CRSF_FRAME_RECEIVED;
                    return true;
                }
                else
                {
                    // CRC mismatch, reset
                    m_state = CRSF_IDLE;
                }
            }
            break;

        case CRSF_FRAME_RECEIVED:
            // Waiting for markFrameReceived() to be called
            // Ignore incoming bytes until then
            break;
    }

    return false;
}

uint8_t* CrsfPassthrough::getReceivedFrame()
{
    return m_buffer;
}

uint8_t CrsfPassthrough::getReceivedFrameLength()
{
    return m_frameLength;
}

void CrsfPassthrough::markFrameReceived()
{
    m_state = CRSF_IDLE;
    m_bufferPos = 0;
    m_frameLength = 0;
}

uint8_t CrsfPassthrough::calculateCRC(const uint8_t* data, uint8_t length)
{
    return crsf_crc8.calc(data, length, 0);
}

bool CrsfPassthrough::validateFrame(const uint8_t* frame, uint8_t length)
{
    if (length < 4 || frame[0] != CRSF_SYNC_BYTE)
    {
        return false;
    }

    uint8_t declaredLen = frame[1];
    if (length != declaredLen + 2)
    {
        return false;
    }

    uint8_t receivedCrc = frame[length - 1];
    uint8_t calculatedCrc = calculateCRC(&frame[2], declaredLen - 1);

    return receivedCrc == calculatedCrc;
}

bool CrsfPassthrough::isExtendedType(uint8_t type)
{
    return type >= 0x28;
}
