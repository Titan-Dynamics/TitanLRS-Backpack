import { defineConfig, loadEnv } from 'vite'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Zopfli from 'node-zopfli-es'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Helpers copied verbatim from TitanLRS src/html/vite.config.js
// ---------------------------------------------------------------------------

function toCIdentifier(p) {
  let id = p.replace(/[^a-zA-Z0-9]/g, '_')
  if (/^[0-9]/.test(id)) id = '_' + id
  return id
}

async function* walk(dir) {
  const dirents = await fs.readdir(dir, { withFileTypes: true })
  for (const d of dirents) {
    const res = path.resolve(dir, d.name)
    if (d.isDirectory()) {
      yield* walk(res)
    } else if (d.isFile()) {
      yield res
    }
  }
}

function toHexArray(buf) {
  const parts = []
  for (let i = 0; i < buf.length; i++) {
    const hex = '0x' + buf[i].toString(16).padStart(2, '0')
    parts.push(hex)
  }
  const lines = []
  for (let i = 0; i < parts.length; i += 16) {
    lines.push('  ' + parts.slice(i, i + 16).join(', '))
  }
  return lines.join(',\n')
}

function headerPreamble() {
  return `#pragma once\n#include <stddef.h>\n#include <stdint.h>\n#include <pgmspace.h>\n\n#ifdef __cplusplus\nextern "C" {\n#endif\n\n// Represents one web asset (pre-compressed) stored in PROGMEM\ntypedef struct {\n  const char* path;\n  const char* content_type;\n  const unsigned char* data;\n  const size_t size;\n} WebAsset;\n`
}

function headerEpilogue() {
  return `\n#ifdef __cplusplus\n} // extern "C"\n#endif\n`
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.html': return 'text/html'
    case '.css':  return 'text/css'
    case '.js':
    case '.mjs':  return 'application/javascript'
    case '.json': return 'application/json'
    case '.svg':  return 'image/svg+xml'
    case '.png':  return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif':  return 'image/gif'
    case '.ico':  return 'image/x-icon'
    case '.woff': return 'font/woff'
    case '.woff2':return 'font/woff2'
    case '.ttf':  return 'font/ttf'
    case '.wasm': return 'application/wasm'
    default:      return 'application/octet-stream'
  }
}

function viteEsp32HeaderPlugin(options = {}) {
  const headerName = options.headerName || 'esp32_fs.h'

  let outDir = 'dist'
  let root = process.cwd()

  return {
    name: 'vite-esp32-header',
    apply: 'build',
    configResolved(config) {
      outDir = config.build?.outDir || 'dist'
      root = config.root || process.cwd()
    },
    async closeBundle() {
      const distDir = path.resolve(outDir)

      try {
        const st = await fs.stat(distDir)
        if (!st.isDirectory()) return
      } catch (e) {
        return
      }

      const files = []
      for await (const filePath of walk(distDir)) {
        if (filePath.endsWith('.map')) continue
        // Skip the generated header itself
        if (path.basename(filePath) === headerName) continue
        files.push(filePath)
      }

      if (files.length === 0) return

      let header = headerPreamble()

      const assetEntries = []

      for (const abs of files) {
        const rel = path.relative(distDir, abs).split(path.sep).join('/')
        const webPath = '/' + rel
        const id = toCIdentifier(rel)
        const data = await fs.readFile(abs)
        const compressed = Zopfli.gzipSync(data, { numiterations: 15 })
        const hex = toHexArray(compressed)
        const contentType = guessContentType(rel)
        header += `\n// ${webPath} (original ${data.length} bytes) -> compressed ${compressed.length} bytes\n`
        header += `static const unsigned char ${id}[] PROGMEM = {\n${hex}\n};\n`
        header += `static const size_t ${id}_len = ${compressed.length};\n`
        assetEntries.push({ webPath, id, contentType })
      }

      header += '\n// File index for convenient iteration\n'
      header += 'static const WebAsset WEB_ASSETS[] PROGMEM = {\n'
      for (const entry of assetEntries) {
        header += `  { "${entry.webPath}", "${entry.contentType}", ${entry.id}, ${entry.id}_len },\n`
      }
      header += '};\n'
      header += 'static const size_t WEB_ASSETS_COUNT = sizeof(WEB_ASSETS) / sizeof(WEB_ASSETS[0]);\n\n'
      header += headerEpilogue()

      const outFile = path.join(distDir, headerName)
      await fs.writeFile(outFile, header, 'utf8')
      console.log(`\n[vite-esp32-header] Wrote ${path.relative(__dirname, outFile)} with ${assetEntries.length} assets.`)
    },
  }
}

// ---------------------------------------------------------------------------
// Dev mock plugin — adapted for Backpack endpoints
// ---------------------------------------------------------------------------
import { devMockPlugin } from './dev-mock-plugin.js'

// ---------------------------------------------------------------------------
// Multi-page entry map — one HTML per target
// ---------------------------------------------------------------------------

const rootMap = {
  txbp:  path.resolve(__dirname, 'src/txbp'),
  vrx:   path.resolve(__dirname, 'src/vrx'),
  timer: path.resolve(__dirname, 'src/timer'),
}

export default defineConfig(({ command }) => {
  const target = process.env.VITE_TARGET || 'txbp'

  if (!rootMap[target]) {
    throw new Error(`Unknown VITE_TARGET="${target}". Must be txbp, vrx, or timer.`)
  }

  const pageRoot = rootMap[target]

  return {
    // Set root to the target sub-directory so the HTML output is dist/index.html
    root: pageRoot,
    publicDir: path.resolve(__dirname, 'public'),
    plugins: [
      viteEsp32HeaderPlugin(),
      ...(command === 'serve' ? [devMockPlugin()] : []),
    ],
    esbuild: {
      legalComments: 'none',
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          app: path.resolve(pageRoot, 'index.html'),
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
      sourcemap: false,
    },
  }
})
