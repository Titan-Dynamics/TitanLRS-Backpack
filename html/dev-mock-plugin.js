/**
 * Vite dev-server middleware that returns realistic stub responses for all
 * Backpack API endpoints.  This lets the UI be developed without a real
 * device connected.
 *
 * Adapted from TitanLRS src/html/dev-mock-plugin.js for the Backpack subset
 * of endpoints: /config, /networks.json, /sethome, /setapssid, /setappassword,
 * /setmavlink, /mavlink, /update, /forceupdate, /forget, /connect, /access,
 * /aatconfig, /setrtc.
 */

import * as crypto from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Minimal CRSF codec (mirrors the browser-side CRSF object in scan.js)
// ─────────────────────────────────────────────────────────────────────────────
const CRSF_SYNC       = 0xC8
const CRSF_CRC_POLY   = 0xD5
const DEVICE_PING     = 0x28
const DEVICE_INFO     = 0x29
const PARAM_ENTRY     = 0x2B
const PARAM_READ      = 0x2C
const PARAM_WRITE     = 0x2D  // also triggers ELRS_STATUS poll when param==0
const ELRS_STATUS     = 0x2E
const ADDR_BROADCAST  = 0x00
const ADDR_RADIO_TX   = 0xEA
const ADDR_RX         = 0xEC
const ADDR_TX         = 0xEE
const ADDR_ELRS_LUA   = 0xEF

const PT_UINT8     = 0x00
const PT_TEXT_SEL  = 0x09
const PT_INFO      = 0x0C
const PT_FOLDER    = 0x0B
const PT_COMMAND   = 0x0D

function crsfCRC(data) {
  let crc = 0
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x80 ? ((crc << 1) ^ CRSF_CRC_POLY) & 0xFF : (crc << 1) & 0xFF
    }
  }
  return crc
}

function buildFrame(type, dest, origin, payload) {
  const len = 4 + (payload ? payload.length : 0)
  const buf = Buffer.alloc(2 + len)
  buf[0] = CRSF_SYNC
  buf[1] = len
  buf[2] = type
  buf[3] = dest
  buf[4] = origin
  if (payload) payload.copy(buf, 5)
  buf[2 + len - 1] = crsfCRC(buf.slice(2, 2 + len - 1))
  return buf
}

function parseFrame(buf) {
  if (buf.length < 4 || buf[0] !== CRSF_SYNC) return null
  const len = buf[1]
  if (buf.length < len + 2) return null
  const type = buf[2]
  return {
    type,
    dest:    buf[3],
    origin:  buf[4],
    payload: buf.slice(5, len + 1),
  }
}

// Write a null-terminated string into a buffer at offset, return next offset
function writeStr(buf, offset, str) {
  for (let i = 0; i < str.length; i++) buf[offset++] = str.charCodeAt(i)
  buf[offset++] = 0
  return offset
}

// Build a DEVICE_INFO payload
// Layout: name\0 serialNumber(4) hardwareId(4) firmwareId(4) paramCount paramVersion
function buildDeviceInfo(name, serialNumber, hwId, fwId, paramCount) {
  const buf = Buffer.alloc(name.length + 1 + 4 + 4 + 4 + 2)
  let o = writeStr(buf, 0, name)
  buf.writeUInt32BE(serialNumber, o); o += 4
  buf.writeUInt32BE(hwId,         o); o += 4
  buf.writeUInt32BE(fwId,         o); o += 4
  buf[o++] = paramCount
  buf[o++] = 0  // parameterVersion
  return buf
}

// Build a PARAM_ENTRY payload
// Layout: paramNum chunksRemaining parentFolder typeByte name\0 <type-specific>
function buildParamEntry(paramNum, chunksRemaining, entry) {
  // Pre-allocate a generous buffer
  const tmp = Buffer.alloc(256)
  tmp[0] = paramNum
  tmp[1] = chunksRemaining
  tmp[2] = entry.parent   // parentFolder (0 = root)
  tmp[3] = entry.type     // typeByte
  let o = writeStr(tmp, 4, entry.name)

  switch (entry.type & 0x3F) {
    case PT_UINT8:
      tmp[o++] = entry.value
      tmp[o++] = entry.min ?? 0
      tmp[o++] = entry.max ?? 255
      tmp[o++] = entry.def ?? 0
      o = writeStr(tmp, o, entry.unit ?? '')
      break
    case PT_TEXT_SEL:
      o = writeStr(tmp, o, (entry.options ?? []).join(';'))
      tmp[o++] = entry.value ?? 0
      tmp[o++] = 0  // min
      tmp[o++] = (entry.options ?? []).length - 1  // max
      tmp[o++] = entry.def ?? 0
      o = writeStr(tmp, o, entry.unit ?? '')
      break
    case PT_INFO:
      o = writeStr(tmp, o, entry.value ?? '')
      break
    case PT_COMMAND:
      tmp[o++] = entry.status ?? 0   // status: 0=ready
      tmp[o++] = entry.timeout ?? 0
      o = writeStr(tmp, o, entry.info ?? '')
      break
    case PT_FOLDER:
      break  // no additional data
  }

  return tmp.slice(0, o)
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock device definitions
// ─────────────────────────────────────────────────────────────────────────────
const MOCK_DEVICES = [
  {
    name:         'RM Bandit',
    address:      ADDR_TX,
    serialNumber: 0x454C5253,
    hwId:         0x00010000,
    fwId:         0x00040000,
    isElrs:       true,
    params: [
      // Root params (1–12)
      /* 1  */ { parent: 0, type: PT_TEXT_SEL, name: 'Packet Rate',
                 options: ['50Hz(-117dBm)','100Hz(-115dBm)','150Hz(-112dBm)','200Hz(-112dBm)','250Hz(-108dBm)','333Hz(-105dBm)','500Hz(-102dBm)'], value: 3, def: 3 },
      /* 2  */ { parent: 0, type: PT_TEXT_SEL, name: 'Telem Ratio',
                 options: ['Std','Off','1:128','1:64','1:32','1:16','1:8','1:4','1:2','Race'], value: 8, def: 1 },
      /* 3  */ { parent: 0, type: PT_TEXT_SEL, name: 'Switch Mode',
                 options: ['Hybrid','Wide'], value: 0, def: 0 },
      /* 4  */ { parent: 0, type: PT_TEXT_SEL, name: 'Link Mode',
                 options: ['Normal','MAVLink'], value: 1, def: 0 },
      /* 5  */ { parent: 0, type: PT_TEXT_SEL, name: 'Model Match',
                 options: ['Off','On'], value: 0, def: 0, unit: 'ID: 0' },
      /* 6  */ { parent: 0, type: PT_FOLDER,   name: 'TX Power (1000mW Dyn)' },
      /* 7  */ { parent: 0, type: PT_FOLDER,   name: 'VTX Administrator' },
      /* 8  */ { parent: 0, type: PT_FOLDER,   name: 'WiFi Connectivity' },
      /* 9  */ { parent: 0, type: PT_FOLDER,   name: 'Backpack' },
      /* 10 */ { parent: 0, type: PT_COMMAND,  name: 'BLE Joystick', status: 0, timeout: 0 },
      /* 11 */ { parent: 0, type: PT_COMMAND,  name: 'Bind',         status: 0, timeout: 0 },
      /* 12 */ { parent: 0, type: PT_INFO,     name: '4.0.0-TD FCC915', value: '3f867a' },
      // TX Power sub-params (parent = param 6)
      /* 13 */ { parent: 6, type: PT_TEXT_SEL, name: 'Max Power',
                 options: ['10mW','25mW','50mW','100mW','250mW','500mW','1000mW'], value: 6, def: 2 },
      /* 14 */ { parent: 6, type: PT_TEXT_SEL, name: 'Dynamic',
                 options: ['Off','On','AUX9','AUX10','AUX11','AUX12'], value: 1, def: 0 },
      // VTX Administrator sub-params (parent = param 7)
      /* 15 */ { parent: 7, type: PT_TEXT_SEL, name: 'Band',
                 options: ['Off','A','B','E','F','R','L'], value: 0, def: 0 },
      /* 16 */ { parent: 7, type: PT_TEXT_SEL, name: 'Channel',
                 options: ['1','2','3','4','5','6','7','8'], value: 0, def: 0 },
      /* 17 */ { parent: 7, type: PT_TEXT_SEL, name: 'Pwr Lvl',
                 options: ['-','1','2','3','4','5','6','7','8'], value: 0, def: 0 },
      /* 18 */ { parent: 7, type: PT_TEXT_SEL, name: 'Pitmode',
                 options: ['Off','On'], value: 0, def: 0 },
      /* 19 */ { parent: 7, type: PT_COMMAND,  name: 'Send VTx', status: 0, timeout: 0 },
      // WiFi Connectivity sub-params (parent = param 8)
      /* 20 */ { parent: 8, type: PT_COMMAND,  name: 'Enable WiFi',          status: 0, timeout: 10 },
      /* 21 */ { parent: 8, type: PT_COMMAND,  name: 'Enable Rx WiFi',        status: 0, timeout: 10 },
      /* 22 */ { parent: 8, type: PT_COMMAND,  name: 'Enable Backpack WiFi',  status: 0, timeout: 10 },
      /* 23 */ { parent: 8, type: PT_INFO,     name: 'WiFi SSID', value: '' },
      /* 24 */ { parent: 8, type: PT_INFO,     name: 'WiFi key',  value: '' },
      /* 25 */ { parent: 8, type: PT_UINT8,    name: 'WiFi on interval',
                 value: 0, min: 0, max: 255, def: 60, unit: 's' },
      // Backpack sub-params (parent = param 9)
      /* 26 */ { parent: 9, type: PT_TEXT_SEL, name: 'Backpack',
                 options: ['Off','On'], value: 1, def: 0 },
      /* 27 */ { parent: 9, type: PT_COMMAND,  name: 'Send OSD', status: 0, timeout: 0 },
      /* 28 */ { parent: 9, type: PT_TEXT_SEL, name: 'Team Race',
                 options: ['Off','On'], value: 0, def: 0 },
      /* 29 */ { parent: 9, type: PT_TEXT_SEL, name: 'Telemetry',
                 options: ['Off','On'], value: 1, def: 1 },
      /* 30 */ { parent: 9, type: PT_TEXT_SEL, name: 'FC/GCS',
                 options: ['Off','On'], value: 1, def: 0 },
      /* 31 */ { parent: 9, type: PT_TEXT_SEL, name: 'OSD Style',
                 options: ['BETAFLIGHT','INAV'], value: 0, def: 0 },
      /* 32 */ { parent: 9, type: PT_TEXT_SEL, name: 'OSD Units',
                 options: ['Imperial','Metric'], value: 1, def: 1 },
      /* 33 */ { parent: 9, type: PT_TEXT_SEL, name: 'HT Enable',
                 options: ['Off','On'], value: 0, def: 0 },
    ],
  },
  {
    name:         'RM XR1',
    address:      ADDR_RX,
    serialNumber: 0x454C5253,
    hwId:         0x00020000,
    fwId:         0x00040000,
    isElrs:       true,
    params: [
      // Root params (1–12) + 1 TX Power sub-param = 13 total
      /* 1  */ { parent: 0, type: PT_TEXT_SEL, name: 'Packet Rate',
                 options: ['50Hz(-117dBm)','100Hz(-115dBm)','150Hz(-112dBm)','200Hz(-112dBm)','250Hz(-108dBm)','333Hz(-105dBm)','500Hz(-102dBm)'], value: 3, def: 3 },
      /* 2  */ { parent: 0, type: PT_TEXT_SEL, name: 'Telem Ratio',
                 options: ['Std','Off','1:128','1:64','1:32','1:16','1:8','1:4','1:2','Race'], value: 8, def: 1 },
      /* 3  */ { parent: 0, type: PT_TEXT_SEL, name: 'Switch Mode',
                 options: ['Hybrid','Wide'], value: 0, def: 0 },
      /* 4  */ { parent: 0, type: PT_TEXT_SEL, name: 'Link Mode',
                 options: ['Normal','MAVLink'], value: 1, def: 0 },
      /* 5  */ { parent: 0, type: PT_TEXT_SEL, name: 'Model Match',
                 options: ['Off','On'], value: 0, def: 0, unit: 'ID: 0' },
      /* 6  */ { parent: 0, type: PT_FOLDER,   name: 'TX Power (1000mW Dyn)' },
      /* 7  */ { parent: 0, type: PT_FOLDER,   name: 'VTX Administrator' },
      /* 8  */ { parent: 0, type: PT_FOLDER,   name: 'WiFi Connectivity' },
      /* 9  */ { parent: 0, type: PT_FOLDER,   name: 'Backpack' },
      /* 10 */ { parent: 0, type: PT_COMMAND,  name: 'BLE Joystick', status: 0, timeout: 0 },
      /* 11 */ { parent: 0, type: PT_COMMAND,  name: 'Bind',         status: 0, timeout: 0 },
      /* 12 */ { parent: 0, type: PT_INFO,     name: '4.0.0-TD FCC915', value: '3f867a' },
      // TX Power sub-param (parent = param 6)
      /* 13 */ { parent: 6, type: PT_TEXT_SEL, name: 'Max Power',
                 options: ['10mW','25mW','50mW','100mW','250mW','500mW','1000mW'], value: 6, def: 2 },
    ],
  },
]

// Build a WebSocket text frame (opcode 0x01) wrapping a Buffer payload
function wsBinaryFrame(payload) {
  const header = payload.length < 126
    ? Buffer.from([0x82, payload.length])
    : Buffer.from([0x82, 126, (payload.length >> 8) & 0xFF, payload.length & 0xFF])
  return Buffer.concat([header, payload])
}

// Unmask a WebSocket frame and return { opcode, payload }
function wsUnframe(buf) {
  if (buf.length < 2) return null
  const opcode  = buf[0] & 0x0F
  const masked  = !!(buf[1] & 0x80)
  let   plen    = buf[1] & 0x7F
  let   offset  = 2
  if (plen === 126) { plen = buf.readUInt16BE(2); offset = 4 }
  else if (plen === 127) return null  // not needed for CRSF frames
  if (buf.length < offset + (masked ? 4 : 0) + plen) return null
  let payload
  if (masked) {
    const mask = buf.slice(offset, offset + 4); offset += 4
    payload = Buffer.alloc(plen)
    for (let i = 0; i < plen; i++) payload[i] = buf[offset + i] ^ mask[i % 4]
  } else {
    payload = buf.slice(offset, offset + plen)
  }
  return { opcode, payload }
}

// Handle an incoming CRSF frame from the browser, return Array<Buffer> of
// CRSF response frames to send back (each wrapped in its own WS frame).
function handleCrsfFrame(frame, elrsCounters) {
  const responses = []

  if (frame.type === DEVICE_PING) {
    // Reply with DEVICE_INFO for every mock device
    for (const dev of MOCK_DEVICES) {
      const info = buildDeviceInfo(dev.name, dev.serialNumber, dev.hwId, dev.fwId, dev.params.length)
      responses.push(buildFrame(DEVICE_INFO, frame.origin, dev.address, info))
    }
    return responses
  }

  if (frame.type === PARAM_READ) {
    // frame.payload = [paramNum, chunkNum]
    const paramNum  = frame.payload[0]
    const _chunkNum = frame.payload[1]
    const dev = MOCK_DEVICES.find(d => d.address === frame.dest)
    if (!dev) return responses
    const entry = dev.params[paramNum - 1]  // params are 1-indexed in CRSF
    if (!entry) return responses
    const entryPayload = buildParamEntry(paramNum, 0 /* chunksRemaining */, entry)
    responses.push(buildFrame(PARAM_ENTRY, frame.origin, dev.address, entryPayload))
    return responses
  }

  if (frame.type === PARAM_WRITE && frame.payload[0] === 0) {
    // linkstat poll — send back ELRS_STATUS for the target device
    const dev = MOCK_DEVICES.find(d => d.address === frame.dest)
    if (!dev) return responses
    elrsCounters[dev.address] = elrsCounters[dev.address] ?? { good: 0, bad: 0 }
    const c = elrsCounters[dev.address]
    c.good = (c.good + 47) & 0xFFFF
    c.bad  = (c.bad  + ((Math.random() < 0.05) ? 1 : 0)) & 0xFF
    // ELRS_STATUS payload: badPkt(1) goodPkt(2 BE) flags(1) msg\0
    const msg   = 'MockLink OK'
    const statusBuf = Buffer.alloc(4 + msg.length + 1)
    statusBuf[0] = c.bad
    statusBuf.writeUInt16BE(c.good, 1)
    statusBuf[3] = 0x01  // flags: connected
    writeStr(statusBuf, 4, msg)
    responses.push(buildFrame(ELRS_STATUS, frame.origin, dev.address, statusBuf))
    return responses
  }

  return responses
}

export function devMockPlugin() {
  function sendJSON(res, obj, status = 200) {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
  }

  function sendText(res, text, status = 200) {
    res.statusCode = status
    res.setHeader('Content-Type', 'text/plain')
    res.end(text)
  }

  function sendStatus(res, status = 204) {
    res.statusCode = status
    res.end()
  }

  const stubState = {
    config: {
      ssid: 'MockHomeWiFi',
      mode: 'AP',
      product_name: 'TX Backpack (Mock)',
      version: '1.0.0-mock',
      ap_ssid: 'TitanLRS TX',
      ap_password: 'titanpass',
      'head-tracking': false,
    },
  }

  let networkQueryCount = 0

  return {
    name: 'vite-dev-mock',
    apply: 'serve',
    configureServer(server) {
      // Mock WebSocket endpoints (/crsf and /ws) — full CRSF protocol mock
      server.httpServer?.on('upgrade', (req, socket) => {
        if (req.url !== '/crsf' && req.url !== '/ws') return
        const key = req.headers['sec-websocket-key']
        if (!key) { socket.destroy(); return }
        const accept = crypto
          .createHash('sha1')
          .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
          .digest('base64')
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          '\r\n'
        )

        const elrsCounters = {}
        let remainder = Buffer.alloc(0)

        socket.on('data', (buf) => {
          remainder = Buffer.concat([remainder, buf])
          while (remainder.length >= 2) {
            const opcode = remainder[0] & 0x0F
            const masked = !!(remainder[1] & 0x80)
            let plen = remainder[1] & 0x7F
            let hdrLen = 2 + (masked ? 4 : 0)
            if (plen === 126) hdrLen += 2
            if (remainder.length < hdrLen + (plen === 126 ? remainder.readUInt16BE(2) : plen)) break

            const ws = wsUnframe(remainder)
            if (!ws) break
            const consumed = 2 + (ws.payload.length) + (masked ? 4 : 0) +
              (plen === 126 ? 2 : 0)
            remainder = remainder.slice(consumed)

            if (ws.opcode === 0x09) {
              // PING → PONG
              socket.write(Buffer.from([0x8a, 0x00]))
            } else if (ws.opcode === 0x08) {
              // CLOSE
              socket.destroy()
            } else if (ws.opcode === 0x02 || ws.opcode === 0x01) {
              // Binary or text — expect CRSF
              const frame = parseFrame(ws.payload)
              if (frame) {
                const replies = handleCrsfFrame(frame, elrsCounters)
                for (const r of replies) socket.write(wsBinaryFrame(r))
              }
            }
          }
        })
        socket.on('error', () => socket.destroy())
      })

      server.middlewares.use((req, res, next) => {
        const url = req.url || '/'
        const method = (req.method || 'GET').toUpperCase()

        const readBody = () =>
          new Promise((resolve) => {
            let data = ''
            req.on('data', (chunk) => { data += chunk })
            req.on('end', () => resolve(data))
          })

        // ── GET /config ────────────────────────────────────────────────────
        if (method === 'GET' && url === '/config') {
          networkQueryCount = 0
          return sendJSON(res, stubState)
        }

        // ── GET /POST /networks.json ───────────────────────────────────────
        if ((url === '/networks.json' || url.startsWith('/networks.json?'))) {
          networkQueryCount++
          if (networkQueryCount <= 2) return sendStatus(res, 204)
          return sendJSON(res, ['MockHomeWiFi', 'NeighbourNet', 'TitanLRS AP'])
        }

        // ── POST /sethome ──────────────────────────────────────────────────
        if (method === 'POST' && url === '/sethome') {
          return readBody().then(() => sendText(res, 'Connecting to network…'))
        }

        // ── POST /setapssid ────────────────────────────────────────────────
        if (method === 'POST' && url === '/setapssid') {
          return readBody().then((body) => {
            const params = new URLSearchParams(body)
            if (params.has('ap_ssid')) stubState.config.ap_ssid = params.get('ap_ssid')
            return sendText(res, 'WiFi AP SSID updated successfully. Changes will take effect on next AP mode activation.')
          })
        }

        // ── POST /setappassword ────────────────────────────────────────────
        if (method === 'POST' && url === '/setappassword') {
          return readBody().then((body) => {
            const params = new URLSearchParams(body)
            if (params.has('ap_password')) stubState.config.ap_password = params.get('ap_password')
            return sendText(res, 'WiFi AP password updated successfully. Changes will take effect on next AP mode activation.')
          })
        }

        // ── POST /setmavlink ───────────────────────────────────────────────
        if (method === 'POST' && url === '/setmavlink') {
          return readBody().then(() => sendText(res, 'MavLink configuration saved.'))
        }

        // ── GET /mavlink ───────────────────────────────────────────────────
        if (method === 'GET' && url === '/mavlink') {
          return sendJSON(res, {
            enabled: true,
            counters: { packets_down: 1024, packets_up: 512, drops_down: 3, overflows_down: 0 },
            ports: { listen: 14555, send: 14550 },
            ip: { gcs: '192.168.4.2' },
            protocol: 'UDP',
          })
        }

        // ── POST /update (firmware upload) ─────────────────────────────────
        if (method === 'POST' && url === '/update') {
          return sendJSON(res, {
            status: 'ok',
            msg: 'Update complete. Please wait for LED to turn on before disconnecting power.',
          })
        }

        // ── POST /forceupdate ──────────────────────────────────────────────
        if (method === 'POST' && url === '/forceupdate') {
          return readBody().then(() =>
            sendJSON(res, { status: 'ok', msg: 'Force update acknowledged (mock).' })
          )
        }

        // ── POST /forget ───────────────────────────────────────────────────
        if (method === 'POST' && url === '/forget') {
          return sendText(res, 'Home network forgotten. Access point starting…')
        }

        // ── POST /connect ──────────────────────────────────────────────────
        if (method === 'POST' && url === '/connect') {
          return sendText(res, 'Connecting to home network…')
        }

        // ── POST /access ───────────────────────────────────────────────────
        if (method === 'POST' && url === '/access') {
          return sendText(res, 'Access Point started.')
        }

        // ── POST /aatconfig ────────────────────────────────────────────────
        if (method === 'POST' && url === '/aatconfig') {
          return readBody().then(() => sendText(res, 'AAT config updated.'))
        }

        // ── POST /setrtc ───────────────────────────────────────────────────
        if (method === 'POST' && url === '/setrtc') {
          return sendText(res, 'RTC clock synced with NTP server.')
        }

        // ── Captive-portal probes — redirect to root ───────────────────────
        const captiveProbes = [
          '/generate_204', '/gen_204', '/hotspot-detect.html',
          '/connectivity-check.html', '/check_network_status.txt',
          '/ncsi.txt', '/fwlink',
        ]
        if (captiveProbes.some((p) => url === p || url.startsWith(p))) {
          res.statusCode = 302
          res.setHeader('Location', '/')
          return res.end()
        }

        next()
      })
    },
  }
}
