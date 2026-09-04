import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  BRIDGE_SYNC_REMOTE_DIR,
  getBridgeSyncManifest,
  mergeSshConfig,
  missingBridgeWorkflowIds,
  normalizeSshConfig,
} from '../src/index.js'

test('Bridge sync uses a fixed safe manifest and discovers every local workflow id', async () => {
  const manifest = await getBridgeSyncManifest()

  assert.equal(BRIDGE_SYNC_REMOTE_DIR, '/root/comfy-bridge')
  assert.deepEqual(manifest.workflowIds, ['image-generate', 'image-generate-qwen', 'image-to-image', 'video-first-last'])
  assert.ok(manifest.files.includes('bridge.py'))
  assert.ok(manifest.files.includes('run.sh'))
  assert.ok(manifest.files.includes('workflows/image-to-image.json'))
  assert.ok(manifest.files.includes('api-workflows/image-to-image.api.json'))
  assert.ok(manifest.files.every(file => !file.includes('.env') && !file.startsWith('data/')))
  assert.ok(manifest.files.every(file => /^(?:bridge[.]py|run[.]sh|(?:api-)?workflows\/[^/]+[.]json)$/u.test(file)))
})

test('Bridge sync rejects a contract whose raw API workflow export is missing', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-sync-manifest-'))
  try {
    await mkdir(path.join(temporary, 'workflows'))
    await mkdir(path.join(temporary, 'api-workflows'))
    await writeFile(path.join(temporary, 'bridge.py'), '# bridge\n', 'utf8')
    await writeFile(path.join(temporary, 'run.sh'), '#!/bin/sh\n', 'utf8')
    await writeFile(path.join(temporary, 'api-workflows', 'present.api.json'), '{}', 'utf8')
    await writeFile(path.join(temporary, 'workflows', 'broken.json'), JSON.stringify({
      id: 'broken',
      comfyPromptFile: 'missing.api.json',
    }), 'utf8')

    await assert.rejects(
      () => getBridgeSyncManifest(temporary),
      /引用的 API 工作流不存在：missing[.]api[.]json/u,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('Bridge workflow verification reports only missing local workflow ids', () => {
  const expected = ['image-generate', 'image-to-image', 'video-first-last']

  assert.deepEqual(missingBridgeWorkflowIds({ workflows: expected.map(id => ({ id })) }, expected), [])
  assert.deepEqual(
    missingBridgeWorkflowIds({ workflows: [{ id: 'image-generate' }, { id: 'video-first-last' }] }, expected),
    ['image-to-image'],
  )
  assert.throws(() => missingBridgeWorkflowIds({}, expected), /Bridge 返回格式无效/u)
})

test('SSH normalization persists the local password but rejects unrelated remote paths', () => {
  const config = normalizeSshConfig({
    name: '测试服务器',
    host: 'example.com',
    port: 22,
    user: 'root',
    localPort: 18787,
    remoteHost: '127.0.0.1',
    remotePort: 8787,
    password: 'store-locally',
    remoteDirectory: '/tmp/injected',
  })

  assert.equal(config.host, 'example.com')
  assert.equal(config.localPort, 18787)
  assert.equal(config.password, 'store-locally')
  assert.equal('remoteDirectory' in config, false)

  assert.equal(mergeSshConfig(config, { host: 'new.example.com' }).password, 'store-locally')
  assert.equal(mergeSshConfig(config, { password: '' }).password, 'store-locally')
  assert.equal(mergeSshConfig(config, { password: 'replacement' }).password, 'replacement')
})
