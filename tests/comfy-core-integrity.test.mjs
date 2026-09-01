import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  COMFY_MAX_OUTPUT_FILE_BYTES,
  archiveComfyOutput,
  createComfyJob,
  createDefaultComfyConfig,
  transitionComfyJob,
} from '../src/comfy-core.js'
import { createCharacterAsset, withProjectRoot } from '../lib/workspace-core.js'

const OUTPUT = Buffer.from('verified Comfy output')
const OUTPUT_SHA256 = createHash('sha256').update(OUTPUT).digest('hex')

test('Comfy archive verifies bridge size/checksum before publishing and starts with two disabled server placeholders', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-integrity-'))
  const root = await realpath(temporary)
  try {
    const defaultConfig = createDefaultComfyConfig()
    assert.equal(defaultConfig.activeProfile, 'cloud-a')
    assert.deepEqual(defaultConfig.profiles.map(profile => profile.id), ['cloud-a', 'cloud-b'])
    assert.ok(defaultConfig.profiles.every(profile => !profile.enabled && !profile.token && !profile.bridgeUrl))
    assert.ok(defaultConfig.profiles.every(profile => profile.downloadTimeoutMs === 30 * 60 * 1_000))

    const characterPath = await withProjectRoot(root, () => createCharacterAsset('完整性测试人物'))
    const job = createComfyJob({
      profileId: 'cloud-a',
      workflowId: 'character-turnaround-v1',
      inputs: { prompt: 'test turnaround', width: 1024, height: 1536 },
      target: { assetType: 'character', assetPath: characterPath, slot: 'turnaround' },
    })

    const archived = await archiveComfyOutput({
      projectRoot: root,
      job,
      remoteFileName: 'result.png',
      data: OUTPUT,
      expectedBytes: OUTPUT.length,
      expectedSha256: OUTPUT_SHA256,
    })
    assert.equal(archived.bytes, OUTPUT.length)
    assert.equal(archived.sha256, OUTPUT_SHA256)
    assert.equal(archived.remoteFileName, 'result.png')
    assert.deepEqual(await readFile(path.join(root, ...archived.path.split('/'))), OUTPUT)

    // Simulates a process failure after publishing the file but before the
    // local job JSON is updated: re-archiving the same manifest must reuse it.
    const repeated = await archiveComfyOutput({
      projectRoot: root,
      job,
      remoteFileName: 'result.png',
      data: OUTPUT,
      expectedBytes: OUTPUT.length,
      expectedSha256: OUTPUT_SHA256,
      outputIndex: 1,
    })
    assert.equal(repeated.path, archived.path)

    await assert.rejects(
      archiveComfyOutput({
        projectRoot: root,
        job,
        remoteFileName: 'wrong-size.png',
        data: OUTPUT,
        expectedBytes: OUTPUT.length + 1,
        expectedSha256: OUTPUT_SHA256,
      }),
      /size does not match/u,
    )
    await assert.rejects(
      archiveComfyOutput({
        projectRoot: root,
        job,
        remoteFileName: 'wrong-hash.png',
        data: OUTPUT,
        expectedBytes: OUTPUT.length,
        expectedSha256: '0'.repeat(64),
      }),
      /checksum does not match/u,
    )
    await assert.rejects(
      archiveComfyOutput({
        projectRoot: root,
        job,
        remoteFileName: 'too-large.png',
        data: OUTPUT,
        expectedBytes: COMFY_MAX_OUTPUT_FILE_BYTES + 1,
      }),
      /expected Comfy output size is invalid/u,
    )

    const files = await readdir(path.join(root, '主要人物', '完整性测试人物', '三视图'))
    assert.equal(files.length, 1)
    assert.ok(files[0].endsWith('.png'))

    let lifecycle = createComfyJob({
      profileId: 'cloud-a',
      workflowId: 'character-turnaround-v1',
      inputs: { prompt: 'history rollover' },
      target: { assetType: 'character', assetPath: characterPath, slot: 'turnaround' },
    })
    for (let attempt = 0; attempt < 120; attempt += 1) {
      lifecycle = transitionComfyJob(lifecycle, 'failed', { error: { code: 'TEST', message: 'retry', at: new Date().toISOString() } })
      lifecycle = transitionComfyJob(lifecycle, 'queued', { message: 'retrying' })
    }
    assert.equal(lifecycle.history.length, 200)
    assert.equal(lifecycle.status, 'queued')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
