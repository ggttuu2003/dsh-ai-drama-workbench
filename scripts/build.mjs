import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lib = path.join(root, 'lib')
const clientEntry = path.join(root, 'src', 'client.jsx')
const hostEntry = path.join(root, 'src', 'index.js')
const comfyApiEntry = path.join(root, 'src', 'comfy-api.js')
const comfyCoreEntry = path.join(root, 'src', 'comfy-core.js')
const workbenchApiEntry = path.join(root, 'src', 'workbench-api.js')
const videoAssemblyEntry = path.join(root, 'src', 'video-assembly.js')
const workspaceCoreEntry = path.join(root, 'src', 'workspace-core.ts')

await mkdir(lib, { recursive: true })

const result = await build({
  entryPoints: [clientEntry],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-runtime/client'],
  loader: { '.css': 'text' },
  legalComments: 'none',
  write: false,
  minify: false,
})

await build({
  entryPoints: [workspaceCoreEntry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: path.join(lib, 'workspace-core.js'),
  legalComments: 'none',
  minify: false,
})

const browserSource = result.outputFiles[0].text
const clientBundle = `window.__ModuleLoader__.load({\n  id: "dsh-ai-drama-workbench",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${browserSource}\n    return module.exports;\n  }\n});\n`

await Promise.all([
  writeFile(path.join(lib, 'client.js'), clientBundle, 'utf8'),
  readFile(hostEntry, 'utf8').then(source => writeFile(path.join(lib, 'index.js'), source, 'utf8')),
  readFile(comfyApiEntry, 'utf8').then(source => writeFile(path.join(lib, 'comfy-api.js'), source, 'utf8')),
  readFile(comfyCoreEntry, 'utf8').then(source => writeFile(path.join(lib, 'comfy-core.js'), source, 'utf8')),
  readFile(workbenchApiEntry, 'utf8').then(source => writeFile(path.join(lib, 'workbench-api.js'), source, 'utf8')),
  readFile(videoAssemblyEntry, 'utf8').then(source => writeFile(path.join(lib, 'video-assembly.js'), source, 'utf8')),
])
