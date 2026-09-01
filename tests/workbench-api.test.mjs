import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { handleWorkbenchRequest } from '../src/workbench-api.js'

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+K6G16QAAAABJRU5ErkJggg==',
  'base64',
)

function responseCapture() {
  return { headersSent: false, payload: undefined, status: undefined }
}

function responseJson(res, status, value) {
  res.headersSent = true
  res.status = status
  res.payload = value
}

function jsonRequest(payload) {
  const body = Buffer.from(JSON.stringify(payload))
  const req = Readable.from([body])
  req.method = 'POST'
  req.headers = { 'content-type': 'application/json', 'content-length': String(body.length), host: '127.0.0.1' }
  return req
}

function rawRequest(body, extraHeaders = {}) {
  const req = Readable.from([body])
  req.method = 'POST'
  req.headers = { 'content-length': String(body.length), host: '127.0.0.1', ...extraHeaders }
  return req
}

function getRequest() {
  const req = Readable.from([])
  req.method = 'GET'
  req.headers = { host: '127.0.0.1' }
  return req
}

async function call(state, request, requestUrl) {
  const res = responseCapture()
  const handled = await handleWorkbenchRequest({
    state,
    req: request,
    res,
    url: new URL(requestUrl),
    responseJson,
  })
  assert.equal(handled, true)
  return res
}

async function stagingParts(root) {
  try {
    return (await readdir(path.join(root, '.workbench', '.uploads'))).filter(name => name.endsWith('.part'))
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return []
    throw error
  }
}

test('full workbench compatibility API reads and writes only its active temporary project', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-workbench-api-'))
  // macOS exposes the temporary directory as /var while realpath uses /private/var.
  // WorkbenchState supplies a resolved root in production, so mirror that contract here.
  const root = await realpath(temporaryRoot)
  const state = { root: async () => root }

  try {
    const initial = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/project')
    assert.equal(initial.status, 200)
    assert.equal(initial.payload.rootName, path.basename(root))
    assert.equal(initial.payload.projectSettings.path, '项目设定.md')
    assert.equal(initial.payload.projectSettings.content, '')

    const createdCharacter = await call(state, jsonRequest({ action: 'createCharacter', name: '验证人物' }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(createdCharacter.status, 200)
    assert.equal(createdCharacter.payload.path, '主要人物/验证人物')

    const upload = await call(
      state,
      rawRequest(PIXEL_PNG),
      'http://127.0.0.1/ai-drama/workbench/assets/upload?assetType=character&assetPath=%E4%B8%BB%E8%A6%81%E4%BA%BA%E7%89%A9%2F%E9%AA%8C%E8%AF%81%E4%BA%BA%E7%89%A9&slot=turnaround&fileName=01-%E5%B7%B2%E9%80%89.png',
    )
    assert.equal(upload.status, 200)
    assert.equal(upload.payload.path, '主要人物/验证人物/三视图/01.png')
    assert.deepEqual(await stagingParts(root), [])

    const beforeSelection = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/project')
    assert.equal(beforeSelection.status, 200)
    assert.equal(beforeSelection.payload.characters[0].confirmedVisuals.turnaround, undefined)

    const selected = await call(state, jsonRequest({
      action: 'setCharacterVisualSelection',
      assetPath: '主要人物/验证人物',
      slot: 'turnaround',
      fileName: '01.png',
    }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(selected.status, 200)
    assert.equal(selected.payload.path, '主要人物/验证人物/三视图/01-已选.png')
    assert.deepEqual(
      await readFile(path.join(root, '主要人物', '验证人物', '三视图', '01-已选.png')),
      PIXEL_PNG,
    )

    const scene = await call(state, jsonRequest({ action: 'createScene', sceneId: 'EP001-SC001' }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(scene.status, 200)
    const shot = await call(state, jsonRequest({ action: 'createShot', sceneId: 'EP001-SC001', shotId: 'SH001', title: '验证镜头' }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(shot.status, 200)
    assert.equal(shot.payload.path, '分镜/EP001-SC001/SH001-验证镜头')

    const snapshot = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/project')
    assert.equal(snapshot.status, 200)
    assert.equal(snapshot.payload.characters[0].confirmedVisuals.turnaround.name, '01-已选.png')
    assert.equal(snapshot.payload.scenes[0].shotCount, 1)
    assert.equal(snapshot.payload.shots[0].design.shotId, 'SH001')

    const blockedPath = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/file?path=..%2Foutside.md')
    assert.equal(blockedPath.status, 400)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('project settings can be saved through the workbench API with revision protection', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-project-settings-api-'))
  const root = await realpath(temporaryRoot)
  const state = { root: async () => root }

  try {
    const initial = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/project')
    const revision = initial.payload.projectSettings.revision
    const saved = await call(
      state,
      jsonRequest({
        action: 'updateProjectSettings',
        content: '# 新项目\n\n## 世界观\n边关城在冬夜封锁。',
        expectedRevision: revision,
      }),
      'http://127.0.0.1/ai-drama/workbench/assets',
    )
    assert.equal(saved.status, 200)
    assert.equal(saved.payload.path, '项目设定.md')
    assert.match(await readFile(path.join(root, '项目设定.md'), 'utf8'), /边关城在冬夜封锁/u)

    const current = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/project')
    assert.notEqual(current.payload.projectSettings.revision, revision)
    const stale = await call(
      state,
      jsonRequest({
        action: 'updateProjectSettings',
        content: '# 过期修改',
        expectedRevision: revision,
      }),
      'http://127.0.0.1/ai-drama/workbench/assets',
    )
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.code, 'REVISION_CONFLICT')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('scene and prop asset APIs create standard folders, expose snapshots, and protect document revisions', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-simple-assets-api-'))
  const root = await realpath(temporaryRoot)
  const state = { root: async () => root }

  try {
    const createdLocation = await call(state, jsonRequest({ action: 'createLocation', name: '废弃车站' }), 'http://127.0.0.1/ai-drama/workbench/assets')
    const createdProp = await call(state, jsonRequest({ action: 'createProp', name: '青铜短剑' }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(createdLocation.status, 200)
    assert.equal(createdLocation.payload.path, '场景/废弃车站')
    assert.equal(createdProp.status, 200)
    assert.equal(createdProp.payload.path, '道具/青铜短剑')

    const snapshot = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/project')
    assert.equal(snapshot.status, 200)
    assert.equal(snapshot.payload.locations[0].name, '废弃车站')
    assert.equal(snapshot.payload.locations[0].slots.length, 4)
    assert.equal(snapshot.payload.props[0].name, '青铜短剑')
    assert.equal(snapshot.payload.props[0].slots.length, 3)

    const locationRevision = snapshot.payload.locations[0].profileRevision
    const saved = await call(state, jsonRequest({
      action: 'updateLocationDocument',
      assetPath: '场景/废弃车站',
      content: '# 废弃车站场景设定\n\n夜间积水，站牌缺了一角。',
      expectedRevision: locationRevision,
    }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(saved.status, 200)
    assert.match(await readFile(path.join(root, '场景', '废弃车站', '场景设定.md'), 'utf8'), /站牌缺了一角/u)

    const stale = await call(state, jsonRequest({
      action: 'updateLocationDocument',
      assetPath: '场景/废弃车站',
      content: '# 过期内容',
      expectedRevision: locationRevision,
    }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.code, 'REVISION_CONFLICT')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('upload API rejects invalid MIME, extension, and declared sizes without publishing partial assets', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-workbench-upload-api-'))
  const root = await realpath(temporaryRoot)
  const state = { root: async () => root }
  const assetPath = '主要人物/上传验证'
  const uploadUrl = (fileName) => `http://127.0.0.1/ai-drama/workbench/assets/upload?assetType=character&assetPath=${encodeURIComponent(assetPath)}&slot=turnaround&fileName=${encodeURIComponent(fileName)}`

  try {
    const created = await call(state, jsonRequest({ action: 'createCharacter', name: '上传验证' }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(created.status, 200)

    const mismatchedMime = await call(
      state,
      rawRequest(PIXEL_PNG, { 'content-type': 'video/mp4' }),
      uploadUrl('mismatch.png'),
    )
    assert.equal(mismatchedMime.status, 400)
    assert.match(mismatchedMime.payload.error, /MIME/)
    assert.deepEqual(await stagingParts(root), [])

    const unsupportedExtension = await call(
      state,
      rawRequest(Buffer.from('not an image'), { 'content-type': 'text/plain' }),
      uploadUrl('unsafe.txt'),
    )
    assert.equal(unsupportedExtension.status, 400)
    assert.match(unsupportedExtension.payload.error, /仅支持/)
    assert.deepEqual(await stagingParts(root), [])

    const videoForCharacter = await call(
      state,
      rawRequest(PIXEL_PNG, { 'content-type': 'video/mp4' }),
      uploadUrl('character-video.mp4'),
    )
    assert.equal(videoForCharacter.status, 400)
    assert.match(videoForCharacter.payload.error, /人物资料槽/)
    assert.deepEqual(await stagingParts(root), [])

    const malformedLength = await call(
      state,
      rawRequest(PIXEL_PNG, { 'content-length': '1.5', 'content-type': 'image/png' }),
      uploadUrl('bad-length.png'),
    )
    assert.equal(malformedLength.status, 400)
    assert.match(malformedLength.payload.error, /大小请求头/)
    assert.deepEqual(await stagingParts(root), [])

    const oversizedLength = await call(
      state,
      rawRequest(PIXEL_PNG, { 'content-length': String(200 * 1024 * 1024 + 1), 'content-type': 'image/png' }),
      uploadUrl('too-large.png'),
    )
    assert.equal(oversizedLength.status, 413)
    assert.deepEqual(await stagingParts(root), [])

    const invalidSignature = await call(
      state,
      rawRequest(Buffer.from('not a PNG image'), { 'content-type': 'image/png' }),
      uploadUrl('bad-signature.png'),
    )
    assert.equal(invalidSignature.status, 400)
    assert.ok(invalidSignature.payload.error)
    assert.deepEqual(await stagingParts(root), [])

    const snapshot = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/project')
    assert.equal(snapshot.status, 200)
    assert.deepEqual(snapshot.payload.characters[0].slots.find(slot => slot.key === 'turnaround').files, [])
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('upload API never overwrites an already published candidate when a duplicate upload fails', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-workbench-upload-atomic-'))
  const root = await realpath(temporaryRoot)
  const state = { root: async () => root }
  const assetPath = '主要人物/原子提交验证'
  const uploadUrl = 'http://127.0.0.1/ai-drama/workbench/assets/upload?assetType=character'
    + `&assetPath=${encodeURIComponent(assetPath)}&slot=turnaround&fileName=stable.png`

  try {
    const created = await call(state, jsonRequest({ action: 'createCharacter', name: '原子提交验证' }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(created.status, 200)

    const initial = await call(state, rawRequest(PIXEL_PNG, { 'content-type': 'image/png' }), uploadUrl)
    assert.equal(initial.status, 200)
    assert.equal(initial.payload.path, '主要人物/原子提交验证/三视图/stable.png')
    assert.deepEqual(await stagingParts(root), [])

    const replacement = Buffer.concat([PIXEL_PNG.subarray(0, 8), Buffer.from('different candidate')])
    const duplicate = await call(state, rawRequest(replacement, { 'content-type': 'image/png' }), uploadUrl)
    assert.equal(duplicate.status, 409)
    assert.deepEqual(
      await readFile(path.join(root, '主要人物', '原子提交验证', '三视图', 'stable.png')),
      PIXEL_PNG,
    )
    assert.deepEqual(await stagingParts(root), [])
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('recycle-bin API lists and restores a trashed asset only to its original project path', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-workbench-trash-api-'))
  const root = await realpath(temporaryRoot)
  const state = { root: async () => root }

  try {
    const created = await call(state, jsonRequest({ action: 'createCharacter', name: '回收站人物' }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(created.status, 200)
    const assetPath = created.payload.path

    const trashed = await call(state, jsonRequest({ action: 'trashAsset', assetType: 'character', assetPath }), 'http://127.0.0.1/ai-drama/workbench/assets')
    assert.equal(trashed.status, 200)

    const listed = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/trash')
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.entries.length, 1)
    assert.equal(listed.payload.entries[0].originalPath, assetPath)
    assert.equal(listed.payload.entries[0].recoverable, true)

    const restored = await call(state, jsonRequest({ action: 'restore', entryId: listed.payload.entries[0].id }), 'http://127.0.0.1/ai-drama/workbench/trash')
    assert.equal(restored.status, 200)
    assert.equal(restored.payload.path, assetPath)

    const snapshot = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/project')
    assert.equal(snapshot.status, 200)
    assert.equal(snapshot.payload.characters[0].name, '回收站人物')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
