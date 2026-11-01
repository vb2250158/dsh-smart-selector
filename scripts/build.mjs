import { build } from 'esbuild'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(resolve(root, 'lib'), { recursive: true })
await build({ entryPoints: [resolve(root, 'src/index.mjs')], outfile: resolve(root, 'lib/index.js'), bundle: true, format: 'esm', platform: 'node', target: 'node22', external: ['@deepseek-ai/*'], logLevel: 'silent' })
await copyFile(resolve(root, 'src/question-worker.mjs'), resolve(root, 'lib/question-worker.mjs'))
await copyFile(resolve(root, 'src/candidate-worker.mjs'), resolve(root, 'lib/candidate-worker.mjs'))
const temp = resolve(root, '.tmp-client')
await rm(temp, { recursive: true, force: true })
const result = await build({ entryPoints: [resolve(root, 'src/client/index.ts')], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false, outdir: temp, loader: { '.css': 'local-css' }, external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-*'], logLevel: 'silent' })
const js = result.outputFiles.find(file => file.path.endsWith('.js'))
const css = result.outputFiles.find(file => file.path.endsWith('.css'))
if (!js || !css) throw new Error('Smart Selector client build did not produce JS and CSS')
if (js.text.includes('require("@deepseek-ai/schemastery")')) throw new Error('Smart Selector client must bundle schemastery for the browser loader')
const moduleId = 'dsh-smart-selector'
const artifact = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(moduleId)},\n  factory: (require) => {\n    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="${moduleId}"]')) { const tag = document.createElement('style'); tag.dataset.plugin = ${JSON.stringify(moduleId)}; tag.dataset.pluginCss = ${JSON.stringify(moduleId)}; tag.textContent = ${JSON.stringify(css.text)}; document.head.append(tag) }\n    var module = { exports: {} }; var exports = module.exports\n${js.text}\n    return module.exports\n  },\n})\n`
await writeFile(resolve(root, 'lib/client.js'), artifact)
await rm(temp, { recursive: true, force: true })
console.log('Built dsh-smart-selector')
