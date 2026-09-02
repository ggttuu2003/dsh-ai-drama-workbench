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
  getComfyWorkflowPresets,
  transitionComfyJob,
} from '../src/comfy-core.js'
import { createCharacterAsset, createLocationAsset, withProjectRoot } from '../lib/workspace-core.js'

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
    const sceneImagePreset = getComfyWorkflowPresets().find(preset => preset.id === 'scene-image-v1')
    assert.deepEqual(sceneImagePreset?.assetTypes, ['scene', 'location'])
    assert.deepEqual(sceneImagePreset?.outputTargets, [
      { assetType: 'scene', slot: 'setting', outputSlotLabel: '场景图' },
      { assetType: 'location', slot: 'setting', outputSlotLabel: '场景图' },
    ])
    const sceneImageImg2ImgPreset = getComfyWorkflowPresets().find(preset => preset.id === 'scene-image-img2img-v1')
    assert.equal(sceneImageImg2ImgPreset?.referenceImagesEnabled, true)
    assert.equal(sceneImageImg2ImgPreset?.maxReferenceImages, 2)
    assert.deepEqual(sceneImageImg2ImgPreset?.referenceImageRoles, ['referenceImage', 'referenceImage2'])

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

    const locationPath = await withProjectRoot(root, () => createLocationAsset('完整性测试场景'))
    const locationJob = createComfyJob({
      profileId: 'cloud-a',
      workflowId: 'scene-image-v1',
      inputs: { prompt: 'test reusable location', width: 1536, height: 864 },
      target: { assetType: 'location', assetPath: locationPath, slot: 'setting' },
    })
    const locationOutput = await archiveComfyOutput({
      projectRoot: root,
      job: locationJob,
      remoteFileName: 'location.png',
      data: OUTPUT,
      expectedBytes: OUTPUT.length,
      expectedSha256: OUTPUT_SHA256,
    })
    assert.match(locationOutput.path, /^场景\/完整性测试场景\/场景图\//u)
    assert.deepEqual(await readFile(path.join(root, ...locationOutput.path.split('/'))), OUTPUT)

    assert.throws(
      () => createComfyJob({
        profileId: 'cloud-a',
        workflowId: 'scene-image-v1',
        inputs: { prompt: 'invalid location target' },
        target: { assetType: 'location', assetPath: '分镜/EP001-SC001', slot: 'setting' },
      }),
      /Location output must target one direct child of 场景/u,
    )

    const lifecycle = createComfyJob({
      profileId: 'cloud-a',
      workflowId: 'character-turnaround-v1',
      inputs: { prompt: 'terminal state' },
      target: { assetType: 'character', assetPath: characterPath, slot: 'turnaround' },
    })
    const failed = transitionComfyJob(lifecycle, 'failed', { error: { code: 'TEST', message: 'failed', at: new Date().toISOString() } })
    assert.throws(() => transitionComfyJob(failed, 'queued'), /cannot transition from failed to queued/u)
    const cancelled = transitionComfyJob(lifecycle, 'cancelled')
    assert.throws(() => transitionComfyJob(cancelled, 'queued'), /cannot transition from cancelled to queued/u)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
