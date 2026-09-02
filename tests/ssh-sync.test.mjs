import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BRIDGE_SYNC_REMOTE_DIR,
  getBridgeSyncManifest,
  missingBridgeWorkflowIds,
  normalizeSshConfig,
} from '../src/index.js'

test('Bridge sync uses a fixed safe manifest and discovers every local workflow id', async () => {
  const manifest = await getBridgeSyncManifest()

  assert.equal(BRIDGE_SYNC_REMOTE_DIR, '/root/comfy-bridge')
  assert.deepEqual(manifest.workflowIds, ['image-generate', 'image-to-image', 'video-first-last'])
  assert.ok(manifest.files.includes('bridge.py'))
  assert.ok(manifest.files.includes('run.sh'))
  assert.ok(manifest.files.includes('workflows/image-to-image.json'))
  assert.ok(manifest.files.includes('api-workflows/image-to-image.api.json'))
  assert.ok(manifest.files.every(file => !file.includes('.env') && !file.startsWith('data/')))
  assert.ok(manifest.files.every(file => /^(?:bridge[.]py|run[.]sh|(?:api-)?workflows\/[^/]+[.]json)$/u.test(file)))
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

test('SSH normalization never persists the transient password or remote sync paths', () => {
  const config = normalizeSshConfig({
    name: '测试服务器',
    host: 'example.com',
    port: 22,
    user: 'root',
    localPort: 18787,
    remoteHost: '127.0.0.1',
    remotePort: 8787,
    password: 'never-store-this',
    remoteDirectory: '/tmp/injected',
  })

  assert.equal(config.host, 'example.com')
  assert.equal(config.localPort, 18787)
  assert.equal('password' in config, false)
  assert.equal('remoteDirectory' in config, false)
})
