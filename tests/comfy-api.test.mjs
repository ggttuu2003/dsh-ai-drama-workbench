import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buildShotVideoBrief, createComfyApi, MAX_SHOT_VIDEO_BRIEF_CHARS } from '../src/comfy-api.js'
import { createComfyJobStore, resolveComfyArchiveTarget, saveComfyConfig } from '../src/comfy-core.js'
import {
  createCharacterAsset,
  createCharacterLookAsset,
  createLocationAsset,
  createPropAsset,
  createSceneAsset,
  createShotAsset,
  getAssetWorkspaceSnapshot,
  saveAssetUploadStream,
  setCharacterVisualSelection,
  setWorkspaceVisualSelection,
  updateProjectSettings,
  updateLocationDocument,
  updatePropDocument,
  updateSceneAssetBindings,
  updateSceneCastBindings,
  updateSceneDocument,
  withProjectRoot,
} from '../lib/workspace-core.js'

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+K6G16QAAAABJRU5ErkJggg==',
  'base64',
)
const PIXEL_PNG_SHA256 = createHash('sha256').update(PIXEL_PNG).digest('hex')

function responseCapture() {
  return { headersSent: false, status: undefined, payload: undefined }
}

function responseJson(res, status, payload) {
  res.headersSent = true
  res.status = status
  res.payload = payload
}

function getRequest() {
  const request = Readable.from([])
  request.method = 'GET'
  request.headers = { host: '127.0.0.1' }
  return request
}

function jsonRequest(value) {
  const body = Buffer.from(JSON.stringify(value))
  const request = Readable.from([body])
  request.method = 'POST'
  request.headers = {
    host: '127.0.0.1',
    origin: 'http://127.0.0.1',
    'content-type': 'application/json',
    'content-length': String(body.length),
  }
  return request
}

async function call(api, request, requestUrl) {
  const response = responseCapture()
  const handled = await api.handle(request, response, new URL(requestUrl), responseJson)
  assert.equal(handled, true)
  return response
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await check()
    if (last) return last
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for condition: ${String(last)}`)
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function startMockBridge({ dryRun = false, outputKind = 'image', failure = undefined, outputDelayMs = 0 } = {}) {
  const received = { uploads: [], jobs: [] }
  const outputBytes = outputKind === 'video' ? Buffer.from('mock-mp4-output') : PIXEL_PNG
  const outputFileName = outputKind === 'video' ? 'generated.mp4' : 'generated.png'
  const outputContentType = outputKind === 'video' ? 'video/mp4' : 'image/png'
  const outputSha256 = createHash('sha256').update(outputBytes).digest('hex')
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, 'Bearer local-test-token-1234567890')
      const url = new URL(request.url, 'http://127.0.0.1')
      if (request.method === 'POST' && url.pathname === '/uploads') {
        const body = await readRequestBody(request)
        received.uploads.push({ name: url.searchParams.get('name'), bytes: body })
        response.writeHead(201, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ uploadId: `upload_${received.uploads.length}`, fileName: url.searchParams.get('name'), size: body.length, sha256: 'a'.repeat(64) }))
        return
      }
      if (request.method === 'POST' && url.pathname === '/jobs') {
        const body = JSON.parse((await readRequestBody(request)).toString('utf8'))
        received.jobs.push(body)
        response.writeHead(202, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ id: 'remote_mock_01', status: 'queued', progress: { value: 0 } }))
        return
      }
      if (request.method === 'GET' && url.pathname === '/jobs/remote_mock_01') {
        response.writeHead(200, { 'content-type': 'application/json' })
        if (failure) {
          response.end(JSON.stringify({
            id: 'remote_mock_01',
            status: 'failed',
            progress: { value: 1 },
            error: { code: 'EXECUTION_FAILED', message: failure },
            outputs: [],
          }))
          return
        }
        if (dryRun) {
          response.end(JSON.stringify({
            id: 'remote_mock_01',
            status: 'completed',
            progress: { value: 1 },
            dryRun: true,
            outputs: [],
          }))
          return
        }
        response.end(JSON.stringify({
          id: 'remote_mock_01',
          status: 'completed',
          progress: { value: 1 },
          outputs: [{ fileName: outputFileName, contentType: outputContentType, size: outputBytes.length, sha256: outputSha256 }],
        }))
        return
      }
      if (request.method === 'GET' && url.pathname === `/jobs/remote_mock_01/outputs/${outputFileName}`) {
        response.writeHead(200, { 'content-type': outputContentType, 'content-length': String(outputBytes.length) })
        if (outputDelayMs > 0) {
          response.flushHeaders()
          setTimeout(() => response.end(outputBytes), outputDelayMs)
        } else {
          response.end(outputBytes)
        }
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    received,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

async function saveMockConfig(configPath, bridgeUrl, {
  maxConcurrentJobs = 1,
  requestTimeoutMs = 5_000,
  downloadTimeoutMs = 30 * 60 * 1_000,
} = {}) {
  await saveComfyConfig({
    version: 1,
    activeProfile: 'mock-cloud',
    profiles: [{
      id: 'mock-cloud',
      name: '本地模拟云端',
      enabled: true,
      bridgeUrl,
      token: 'local-test-token-1234567890',
      requestTimeoutMs,
      downloadTimeoutMs,
      maxConcurrentJobs,
    }],
  }, { configPath })
}

function recoveredCharacterJob(characterPath, status, { remote = undefined, error = undefined } = {}) {
  return {
    status,
    profileId: 'mock-cloud',
    workflowId: 'character-turnaround-v1',
    inputs: { prompt: '用于测试 ComfyUI 恢复任务。' },
    uploads: [],
    target: { assetType: 'character', assetPath: characterPath, slot: 'turnaround' },
    ...(remote ? { remote } : {}),
    ...(error ? { error } : {}),
  }
}

test('shot video briefs retain relevant inherited context while staying below the H3 prompt cap', () => {
  const projectAnchor = '寒潮将临，城市停电。'
  const brief = buildShotVideoBrief({
    projectSettings: { content: `${projectAnchor}${' 项目补充设定。'.repeat(4_000)}` },
    characters: [{
      rootPath: '主要人物/沈墨',
      name: '沈墨',
      profileContent: '年轻巡夜人，湿透的黑色斗篷。',
      looks: [{ rootPath: '主要人物/沈墨/造型/LOOK-001-雨夜', name: '雨夜造型', documentContent: '斗篷边缘滴水，手套沾着泥。' }],
    }],
    locations: [{ rootPath: '场景/雨夜巷道', name: '雨夜巷道', profileContent: '狭窄石板路，霓虹反射在积水中。' }],
    props: [{ rootPath: '道具/铜钥匙', name: '铜钥匙', profileContent: '旧铜钥匙，齿纹磨损。' }],
    scenes: [{
      sceneId: 'EP001-SC001',
      sceneContent: '暴雨中的旧城巷道，远处传来警报。',
      castBindings: [
        { characterPath: '主要人物/沈墨', lookPath: '主要人物/沈墨/造型/LOOK-001-雨夜', state: '右手握钥匙', continuity: '斗篷保持湿润', startShotId: 'SH002', endShotId: 'SH002' },
        { characterPath: '主要人物/不应出现', state: '不应出现', continuity: '', startShotId: 'SH001', endShotId: 'SH001' },
      ],
      locationBindings: [
        { locationPath: '场景/雨夜巷道', role: '追逐空间', state: '地面有积水', continuity: '霓虹倒影持续可见', startShotId: 'SH002', endShotId: 'SH002' },
        { locationPath: '场景/过期地点', role: '不应出现', state: '', continuity: '', startShotId: 'SH001', endShotId: 'SH001' },
      ],
      propBindings: [{ propPath: '道具/铜钥匙', role: '关键线索', state: '握在右手', continuity: '不能消失', startShotId: '', endShotId: '' }],
    }],
  }, {
    design: {
      sceneId: 'EP001-SC001',
      shotId: 'SH002',
      title: '钥匙特写',
      timecode: '00:00:03:00-00:00:05:00',
      duration: '2 秒',
      framing: '近景',
      content: '沈墨在雨中抬起铜钥匙。',
      dialogue: '门快开了。',
      camera: '缓慢推近',
      prompt: 'cinematic close-up of a wet brass key',
      negativePrompt: '不要文字',
      references: '雨夜电影质感',
      status: '待生成',
    },
  })

  assert.match(brief, /镜头核心画面：cinematic close-up of a wet brass key/u)
  assert.match(brief, /场次环境：暴雨中的旧城巷道/u)
  assert.match(brief, /出场人物：沈墨，造型：雨夜造型，状态：右手握钥匙/u)
  assert.match(brief, /地点环境：雨夜巷道，用途：追逐空间/u)
  assert.match(brief, /关键道具：铜钥匙，用途：关键线索/u)
  assert.match(brief, new RegExp(projectAnchor, 'u'))
  assert.doesNotMatch(brief, /不应出现/u)
  assert.ok(brief.length <= MAX_SHOT_VIDEO_BRIEF_CHARS)
  assert.match(brief, /…$/u)
})

test('ComfyUI API keeps tokens private, checks first/last frames, and archives image outputs safely', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()
  const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

  try {
    const initial = await call(api, getRequest(), 'http://127.0.0.1/ai-drama/workbench/comfy/config')
    assert.equal(initial.status, 200)
    assert.equal(initial.payload.profiles[0].configured, false)
    assert.match(initial.payload.configPath, /private-comfy\.json$/)
    assert.equal(JSON.stringify(initial.payload).includes('token'), false)
    assert.equal((await stat(configPath)).mode & 0o777, 0o600)

    await saveComfyConfig({
      version: 1,
      activeProfile: 'mock-cloud',
      profiles: [
        {
          id: 'mock-cloud',
          name: '本地模拟云端',
          enabled: true,
          bridgeUrl: bridge.url,
          token: 'local-test-token-1234567890',
          requestTimeoutMs: 5_000,
          maxConcurrentJobs: 1,
        },
        {
          id: 'standby-cloud',
          name: '备用服务器占位符',
          enabled: false,
          bridgeUrl: '',
          token: '',
        },
      ],
    }, { configPath })

    await withProjectRoot(root, async () => {
      const characterPath = await createCharacterAsset('测试人物')
      await saveAssetUploadStream('character', characterPath, 'reference', '参考-01.png', Readable.from([PIXEL_PNG]))
      await setCharacterVisualSelection(characterPath, 'reference', '参考-01.png')
      await createCharacterAsset('测试人物乙')
      await createSceneAsset('EP001-SC001')
      await createShotAsset('EP001-SC001', 'SH001', '测试镜头', {
        sceneId: 'EP001-SC001',
        shotId: 'SH001',
        title: '测试镜头',
        timecode: '00:00:00:00-00:00:03:00',
        duration: '3 秒',
        framing: '全景',
        content: '测试角色站在边关。',
        dialogue: '',
        camera: '缓慢推进',
        prompt: 'cinematic character at a frontier',
        negativePrompt: 'text',
        firstFramePrompt: 'first-frame frontier establishing composition',
        firstFrameNegativePrompt: 'first-frame text',
        lastFramePrompt: 'last-frame frontier resolved composition',
        lastFrameNegativePrompt: 'last-frame text',
        references: '测试人物',
        status: '待生成',
      })
    })

    const snapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    const character = snapshot.characters.find(item => item.name === '测试人物')
    const secondCharacter = snapshot.characters.find(item => item.name === '测试人物乙')
    const scene = snapshot.scenes.find(item => item.sceneId === 'EP001-SC001')
    const shot = snapshot.shots.find(item => item.design.shotId === 'SH001' && !item.isDraft)
    assert.ok(character)
    assert.ok(secondCharacter)
    assert.ok(scene)
    assert.ok(shot?.rootPath)

    const invalidPreview = await call(api, jsonRequest({
      assetType: 'character',
      assetPath: character.rootPath,
      presetId: 'character-turnaround-v1',
      profileId: 'mock-cloud',
      options: { width: '1', height: '1536' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(invalidPreview.status, 400)
    assert.match(invalidPreview.payload.error, /width.*64/u)
    const invalidSubmit = await call(api, jsonRequest({
      assetType: 'character',
      assetPath: character.rootPath,
      presetId: 'character-turnaround-v1',
      profileId: 'mock-cloud',
      options: { width: '1', height: '1536' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(invalidSubmit.status, 400)
    assert.equal(invalidSubmit.payload.error, invalidPreview.payload.error)

    const booleanOption = await call(api, jsonRequest({
      assetType: 'character',
      assetPath: character.rootPath,
      presetId: 'character-turnaround-v1',
      profileId: 'mock-cloud',
      options: { width: true, height: 1536 },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(booleanOption.status, 400)
    assert.match(booleanOption.payload.error, /width.*整数/u)

    const sceneTextToImage = await call(api, jsonRequest({
      assetType: 'scene',
      assetPath: scene.rootPath,
      presetId: 'scene-image-v1',
      profileId: 'mock-cloud',
      options: { width: '1536', height: '864' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(sceneTextToImage.status, 200)
    assert.equal(sceneTextToImage.payload.preview.outputSlotLabel, '场景图')
    assert.deepEqual(sceneTextToImage.payload.preview.attachments, [])
    assert.match(sceneTextToImage.payload.preview.summary, /纯文生图/u)

    const lastFrameTextToImage = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-last-frame-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(lastFrameTextToImage.status, 200)
    assert.equal(lastFrameTextToImage.payload.preview.errors.length, 0)
    assert.deepEqual(lastFrameTextToImage.payload.preview.attachments, [])
    assert.equal(lastFrameTextToImage.payload.preview.prompt, 'last-frame frontier resolved composition')
    assert.equal(lastFrameTextToImage.payload.preview.negativePrompt, 'last-frame text')

    const h3Preview = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'h3-first-last-video-v1',
      profileId: 'mock-cloud',
      options: { durationSeconds: '5' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(h3Preview.status, 200)
    assert.ok(h3Preview.payload.preview.errors.some(message => message.includes('首帧')))
    assert.ok(h3Preview.payload.preview.errors.some(message => message.includes('尾帧')))

    await withProjectRoot(root, async () => {
      await saveAssetUploadStream('scene', scene.rootPath, 'setting', '场景图-01.png', Readable.from([PIXEL_PNG]))
      await setWorkspaceVisualSelection('scene', scene.rootPath, 'setting', '场景图-01.png')
      await saveAssetUploadStream('scene', scene.rootPath, 'setting', '场景图-未选.png', Readable.from([PIXEL_PNG]))
    })
    const firstFrameImageToImage = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-first-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(firstFrameImageToImage.status, 200)
    assert.equal(firstFrameImageToImage.payload.preview.errors.length, 0)
    assert.deepEqual(firstFrameImageToImage.payload.preview.attachments, [
      { role: '首帧输入图', name: '场景图-01-已选.png' },
    ])
    assert.equal(firstFrameImageToImage.payload.preview.prompt, 'first-frame frontier establishing composition')
    assert.equal(firstFrameImageToImage.payload.preview.negativePrompt, '')
    assert.ok(firstFrameImageToImage.payload.preview.warnings.some(message => message.includes('场次已选场景图')))

    await withProjectRoot(root, async () => {
      const locationPath = await createLocationAsset('测试地点')
      const propPath = await createPropAsset('测试道具')
      const current = await getAssetWorkspaceSnapshot()
      const currentScene = current.scenes.find(item => item.rootPath === scene.rootPath)
      assert.ok(currentScene)
      await updateSceneAssetBindings(currentScene.rootPath, {
        locations: [...currentScene.locationBindings, {
          locationPath,
          role: '主环境',
          state: '',
          continuity: '',
          startShotId: 'SH001',
          endShotId: 'SH001',
        }],
        props: [...currentScene.propBindings, {
          propPath,
          role: '关键道具',
          state: '',
          continuity: '',
          startShotId: 'SH001',
          endShotId: 'SH001',
        }],
      }, currentScene.assetBindingsRevision)
      await saveAssetUploadStream('location', locationPath, 'setting', '地点场景图-01.png', Readable.from([PIXEL_PNG]))
      await setWorkspaceVisualSelection('location', locationPath, 'setting', '地点场景图-01.png')
      await saveAssetUploadStream('prop', propPath, 'reference', '道具参考-01.png', Readable.from([PIXEL_PNG]))
      await setWorkspaceVisualSelection('prop', propPath, 'reference', '道具参考-01.png')
    })
    const locationFirstFrameImageToImage = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-first-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(locationFirstFrameImageToImage.status, 200)
    assert.equal(locationFirstFrameImageToImage.payload.preview.errors.length, 0)
    assert.deepEqual(locationFirstFrameImageToImage.payload.preview.attachments, [
      { role: '首帧输入图', name: '地点场景图-01-已选.png' },
    ])
    assert.ok(locationFirstFrameImageToImage.payload.preview.warnings.some(message => message.includes('地点/环境')))

    const referencesSnapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    const refreshedScene = referencesSnapshot.scenes.find(item => item.rootPath === scene.rootPath)
    const sceneReference = refreshedScene?.slots.find(slot => slot.key === 'setting')?.files.find(file => file.name === '场景图-01-已选.png')
    const unselectedSceneReference = refreshedScene?.slots.find(slot => slot.key === 'setting')?.files.find(file => file.name === '场景图-未选.png')
    const unboundCharacterReference = referencesSnapshot.characters
      .find(item => item.rootPath === character.rootPath)
      ?.slots.find(slot => slot.key === 'reference')?.files.find(file => file.name === '参考-01-已选.png')
    const propReference = referencesSnapshot.props
      .find(item => item.name === '测试道具')
      ?.slots.find(slot => slot.key === 'reference')?.files.find(file => file.name === '道具参考-01-已选.png')
    assert.ok(sceneReference?.path)
    assert.ok(unselectedSceneReference?.path)
    assert.ok(unboundCharacterReference?.path)
    assert.ok(propReference?.path)

    const explicitFirstFrameImageToImage = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-first-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720', referenceImagePath: sceneReference.path },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(explicitFirstFrameImageToImage.status, 200)
    assert.equal(explicitFirstFrameImageToImage.payload.preview.errors.length, 0)
    assert.deepEqual(explicitFirstFrameImageToImage.payload.preview.attachments, [
      { role: '首帧输入图', name: '场景图-01-已选.png' },
    ])
    assert.ok(explicitFirstFrameImageToImage.payload.preview.warnings.some(message => message.includes('指定参考图')))

    const unselectedReference = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-first-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720', referenceImagePath: unselectedSceneReference.path },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(unselectedReference.status, 200)
    assert.equal(unselectedReference.payload.preview.errors.length, 0)
    assert.deepEqual(unselectedReference.payload.preview.attachments, [
      { role: '首帧输入图', name: '场景图-未选.png' },
    ])

    const unboundCharacterPreview = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-first-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720', referenceImagePath: unboundCharacterReference.path },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(unboundCharacterPreview.status, 200)
    assert.equal(unboundCharacterPreview.payload.preview.errors.length, 0)
    assert.deepEqual(unboundCharacterPreview.payload.preview.attachments, [
      { role: '首帧输入图', name: '参考-01-已选.png' },
    ])
    const lastFrameWithoutFirstFrame = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-last-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(lastFrameWithoutFirstFrame.status, 200)
    assert.equal(lastFrameWithoutFirstFrame.payload.preview.errors.length, 0)
    assert.equal(lastFrameWithoutFirstFrame.payload.preview.attachments.length, 2)
    assert.notEqual(lastFrameWithoutFirstFrame.payload.preview.attachments[0].name, '首帧-01.png')

    const imageToImageDisabled = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-first-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720', useReferenceImages: false },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(imageToImageDisabled.status, 200)
    assert.ok(imageToImageDisabled.payload.preview.errors.some(message => message.includes('需要一张参考图')))
    const imageToImageDisabledSubmit = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-first-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720', useReferenceImages: false },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(imageToImageDisabledSubmit.status, 400)

    await withProjectRoot(root, async () => {
      await saveAssetUploadStream('shot', shot.rootPath, 'firstFrame', '首帧-01.png', Readable.from([PIXEL_PNG]))
      await saveAssetUploadStream('shot', shot.rootPath, 'lastFrame', '尾帧-01.png', Readable.from([PIXEL_PNG]))
      await setWorkspaceVisualSelection('shot', shot.rootPath, 'firstFrame', '首帧-01.png')
      await setWorkspaceVisualSelection('shot', shot.rootPath, 'lastFrame', '尾帧-01.png')
    })
    const h3Ready = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'h3-first-last-video-v1',
      profileId: 'mock-cloud',
      options: { durationSeconds: '5' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(h3Ready.status, 200)
    assert.equal(h3Ready.payload.preview.errors.length, 0)
    assert.deepEqual(h3Ready.payload.preview.attachments.map(item => item.role), ['首帧', '尾帧'])

    const explicitLastFrameImageToImage = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-last-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720', referenceImagePath: propReference.path },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(explicitLastFrameImageToImage.status, 200)
    assert.equal(explicitLastFrameImageToImage.payload.preview.errors.length, 0)
    assert.deepEqual(explicitLastFrameImageToImage.payload.preview.attachments, [
      { role: '尾帧输入图', name: '道具参考-01-已选.png' },
    ])
    assert.equal(explicitLastFrameImageToImage.payload.preview.prompt, 'last-frame frontier resolved composition')

    const lastFrameImageToImage = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-last-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(lastFrameImageToImage.status, 200)
    assert.equal(lastFrameImageToImage.payload.preview.errors.length, 0)
    assert.equal(lastFrameImageToImage.payload.preview.attachments.length, 2)
    assert.notEqual(lastFrameImageToImage.payload.preview.attachments[0].name, '首帧-01-已选.png')
    assert.equal(lastFrameImageToImage.payload.preview.prompt, 'last-frame frontier resolved composition')
    assert.equal(lastFrameImageToImage.payload.preview.negativePrompt, '')

    await withProjectRoot(root, () => updateSceneCastBindings(scene.rootPath, [
      { characterPath: character.rootPath, state: '站立', continuity: '同场', startShotId: 'SH001', endShotId: 'SH001' },
      { characterPath: secondCharacter.rootPath, state: '站立', continuity: '同场', startShotId: 'SH001', endShotId: 'SH001' },
    ], scene.castRevision))

    // Tail-frame generation accepts any two project references in the order
    // chosen by the caller; the first frame is only one optional candidate.
    const frameSnapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    const firstFrameReference = frameSnapshot.shots
      .find(item => item.rootPath === shot.rootPath)
      ?.slots.find(slot => slot.key === 'firstFrame')?.files.find(file => file.name === '首帧-01-已选.png')
    assert.ok(firstFrameReference?.path)
    const explicitTwoReferenceLastFrame = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-last-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: {
        width: '1280',
        height: '720',
        referenceImages: [
          // Deliberately send a person first. The server must preserve the
          // caller's order instead of forcing the first frame into slot one.
          { path: unboundCharacterReference.path, role: 'referenceImage' },
          { path: firstFrameReference.path, role: 'referenceImage2' },
        ],
      },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(explicitTwoReferenceLastFrame.status, 200)
    assert.equal(explicitTwoReferenceLastFrame.payload.preview.errors.length, 0)
    assert.deepEqual(explicitTwoReferenceLastFrame.payload.preview.attachments.map(item => item.name), [
      '参考-01-已选.png',
      '首帧-01-已选.png',
    ])
    assert.equal(explicitTwoReferenceLastFrame.payload.preview.attachments.length, 2)

    // A frame request may combine the selected scene and character visuals;
    // both files must survive preflight as distinct Bridge upload roles.
    const twoReferenceFirstFrame = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-first-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: {
        width: '1280',
        height: '720',
        referenceImages: [
          { path: sceneReference.path, role: 'referenceImage' },
          { path: unboundCharacterReference.path, role: 'referenceImage2' },
        ],
      },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(twoReferenceFirstFrame.status, 200)
    assert.equal(twoReferenceFirstFrame.payload.preview.errors.length, 0)
    assert.deepEqual(twoReferenceFirstFrame.payload.preview.attachments.map(item => item.name), [
      '场景图-01-已选.png',
      '参考-01-已选.png',
    ])
    assert.equal(twoReferenceFirstFrame.payload.preview.attachments.length, 2)

    // The same multi-reference contract is available when the target is a
    // reusable scene asset (the "生成场景图" flow), not only for a shot.
    const twoReferenceSceneImage = await call(api, jsonRequest({
      assetType: 'scene',
      assetPath: scene.rootPath,
      presetId: 'scene-image-img2img-v1',
      profileId: 'mock-cloud',
      options: {
        width: '1536',
        height: '864',
        referenceImages: [
          { path: sceneReference.path, role: 'referenceImage' },
          { path: unboundCharacterReference.path, role: 'referenceImage2' },
        ],
      },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(twoReferenceSceneImage.status, 200)
    assert.equal(twoReferenceSceneImage.payload.preview.errors.length, 0)
    assert.deepEqual(twoReferenceSceneImage.payload.preview.attachments.map(item => item.name), [
      '场景图-01-已选.png',
      '参考-01-已选.png',
    ])

    const multiCharacterPreview = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-image-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(multiCharacterPreview.status, 200)
    // Multiple character bindings are valid for a text-to-image prompt. The
    // single-reference restriction only applies to an explicitly enabled
    // image-to-image workflow.
    assert.equal(multiCharacterPreview.payload.preview.errors.length, 0)
    const multiCharacterSubmit = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shot.rootPath,
      presetId: 'shot-image-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(multiCharacterSubmit.status, 202)
    await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(shot.rootPath)}`)
      const job = listed.payload.jobs.find(item => item.id === multiCharacterSubmit.payload.job.id)
      if (job?.status === 'failed') throw new Error(`ComfyUI job failed: ${job.error || 'unknown error'}`)
      return job?.status === 'completed' ? job : undefined
    })

    const uploadsBeforeCharacterGeneration = bridge.received.uploads.length
    const preview = await call(api, jsonRequest({
      assetType: 'character',
      assetPath: character.rootPath,
      presetId: 'character-costume-v1',
      profileId: 'mock-cloud',
      options: { width: '1024', height: '1536', seed: '' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(preview.status, 200)
    // Image generation starts in text-to-image mode. Existing selected images
    // remain in the project but are not uploaded automatically.
    assert.deepEqual(preview.payload.preview.attachments, [])
    assert.equal(preview.payload.preview.errors.length, 0)

    const queued = await call(api, jsonRequest({
      assetType: 'character',
      assetPath: character.rootPath,
      presetId: 'character-costume-v1',
      profileId: 'mock-cloud',
      options: { width: '1024', height: '1536', seed: '' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(queued.status, 202)
    assert.equal(queued.payload.job.status, 'queued')

    const completed = await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(character.rootPath)}`)
      assert.equal(listed.status, 200)
      const job = listed.payload.jobs.find(item => item.id === queued.payload.job.id)
      if (job?.status === 'failed') throw new Error(`ComfyUI job failed: ${job.error || 'unknown error'}`)
      return job?.status === 'completed' ? job : undefined
    })
    assert.ok(completed.outputPaths.length === 1)
    assert.equal(bridge.received.uploads.length, uploadsBeforeCharacterGeneration)
    assert.equal(bridge.received.jobs.length, 2)
    assert.equal(bridge.received.jobs[0].workflowId, 'image-generate')
    assert.deepEqual(bridge.received.jobs[0].uploads, [])

    const outputPath = path.join(root, ...completed.outputPaths[0].split('/'))
    assert.deepEqual(await readFile(outputPath), PIXEL_PNG)
    assert.match(completed.outputPaths[0], /^主要人物\/测试人物\/定妆\//)
    assert.deepEqual(await readFile(path.join(root, '主要人物', '测试人物', '参考图', '参考-01-已选.png')), PIXEL_PNG)

    const switched = await call(api, jsonRequest({ profileId: 'standby-cloud' }), 'http://127.0.0.1/ai-drama/workbench/comfy/config/active')
    assert.equal(switched.status, 200)
    assert.equal(switched.payload.activeProfileId, 'standby-cloud')
    assert.equal(JSON.stringify(switched.payload).includes('local-test-token'), false)
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI API falls back to the identity reference when a bound look has no selected visual', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-look-fallback-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()
  const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

  try {
    await saveMockConfig(configPath, bridge.url)
    const paths = await withProjectRoot(root, async () => {
      const characterPath = await createCharacterAsset('造型回退人物')
      await saveAssetUploadStream('character', characterPath, 'reference', '身份-01.png', Readable.from([PIXEL_PNG]))
      await setCharacterVisualSelection(characterPath, 'reference', '身份-01.png')
      // The look is intentionally left without any selected visual files.
      const lookPath = await createCharacterLookAsset(characterPath, '雨夜造型')
      const scenePath = await createSceneAsset('EP001-SC601')
      const sceneSnapshot = await getAssetWorkspaceSnapshot()
      const scene = sceneSnapshot.scenes.find(item => item.rootPath === scenePath)
      assert.ok(scene)
      await updateSceneCastBindings(scenePath, [{
        characterPath,
        lookPath,
        state: '站立',
        continuity: '身份保持一致',
        startShotId: 'SH001',
        endShotId: 'SH001',
      }], scene.castRevision)
      const shotPath = await createShotAsset('EP001-SC601', 'SH001', '造型回退镜头', {
        sceneId: 'EP001-SC601',
        shotId: 'SH001',
        title: '造型回退镜头',
        timecode: '00:00:00:00-00:00:03:00',
        duration: '3 秒',
        framing: '中景',
        content: '人物站在雨夜街口。',
        dialogue: '',
        camera: '固定镜头',
        prompt: '雨夜街口的人物首帧',
        negativePrompt: '',
        firstFramePrompt: '',
        firstFrameNegativePrompt: '',
        lastFramePrompt: '',
        lastFrameNegativePrompt: '',
        references: '',
        status: '待生成',
        characterOverrides: [],
      })
      return { characterPath, shotPath }
    })

    const snapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    const identity = snapshot.characters
      .find(item => item.rootPath === paths.characterPath)
      ?.slots.find(slot => slot.key === 'reference')
      ?.files.find(file => file.name === '身份-01-已选.png')
    assert.ok(identity?.path)

    const baseBody = {
      assetType: 'shot',
      assetPath: paths.shotPath,
      presetId: 'shot-first-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720' },
    }
    const automatic = await call(api, jsonRequest(baseBody), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(automatic.status, 200)
    assert.equal(automatic.payload.preview.errors.length, 0)
    assert.deepEqual(automatic.payload.preview.attachments, [
      { role: '首帧输入图', name: '身份-01-已选.png' },
    ])

    // The same identity file must remain selectable when the UI sends an
    // explicit reference while the shot inherits an unillustrated look.
    const explicit = await call(api, jsonRequest({
      ...baseBody,
      options: {
        ...baseBody.options,
        referenceImages: [{ path: identity.path, role: 'referenceImage' }],
      },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(explicit.status, 200)
    assert.equal(explicit.payload.preview.errors.length, 0)
    assert.deepEqual(explicit.payload.preview.attachments, [
      { role: '首帧输入图', name: '身份-01-已选.png' },
    ])
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('explicit frame references can upload an ordinary project image without changing selection state', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-explicit-image-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()
  const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

  try {
    await saveMockConfig(configPath, bridge.url)
    const shotPath = await withProjectRoot(root, async () => {
      await createSceneAsset('EP001-SC602')
      const created = await createShotAsset('EP001-SC602', 'SH001', '普通候选图镜头', {
        sceneId: 'EP001-SC602',
        shotId: 'SH001',
        title: '普通候选图镜头',
        timecode: '00:00:00:00-00:00:03:00',
        duration: '3 秒',
        framing: '中景',
        content: '人物站在场景中。',
        dialogue: '',
        camera: '固定镜头',
        prompt: '普通候选图测试',
        negativePrompt: '',
        firstFramePrompt: '',
        firstFrameNegativePrompt: '',
        lastFramePrompt: '',
        lastFrameNegativePrompt: '',
        references: '',
        status: '待生成',
        characterOverrides: [],
      })
      await saveAssetUploadStream('shot', created, 'reference', '普通候选.png', Readable.from([PIXEL_PNG]))
      return created
    })

    const snapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    const reference = snapshot.shots
      .find(item => item.rootPath === shotPath)
      ?.slots.find(slot => slot.key === 'reference')
      ?.files.find(file => file.name === '普通候选.png')
    assert.ok(reference?.path)

    const body = {
      assetType: 'shot',
      assetPath: shotPath,
      presetId: 'shot-first-frame-img2img-v1',
      profileId: 'mock-cloud',
      options: {
        width: '1280',
        height: '720',
        referenceImagePath: reference.path,
      },
    }
    const preview = await call(api, jsonRequest(body), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.preview.errors.length, 0)
    assert.deepEqual(preview.payload.preview.attachments, [{ role: '首帧输入图', name: '普通候选.png' }])

    const submission = await call(api, jsonRequest(body), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(submission.status, 202)
    await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(shotPath)}`)
      const job = listed.payload.jobs.find(item => item.id === submission.payload.job.id)
      if (job?.status === 'failed') throw new Error(`Explicit reference job failed: ${job.error || 'unknown error'}`)
      return job?.status === 'completed' ? job : undefined
    })
    assert.equal(bridge.received.uploads.length, 1)
    assert.equal(bridge.received.uploads[0].name, '普通候选.png')
    assert.equal(bridge.received.jobs.length, 1)
    assert.deepEqual(bridge.received.jobs[0].uploads.map(item => item.role), ['referenceImage'])
    assert.equal('negativePrompt' in bridge.received.jobs[0].inputs, false)
    assert.equal('denoise' in bridge.received.jobs[0].inputs, false)

    const unsupportedNegativePrompt = await call(api, jsonRequest({
      ...body,
      prompt: 'reference generation prompt',
      negativePrompt: 'unsupported negative prompt',
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(unsupportedNegativePrompt.status, 400)
    assert.match(unsupportedNegativePrompt.payload.error, /不支持临时负面提示词/u)
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI API applies per-job image prompt overrides without rewriting the shot', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-prompt-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()
  const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

  try {
    await saveMockConfig(configPath, bridge.url)
    const shotPath = await withProjectRoot(root, async () => {
      await createSceneAsset('EP001-SC501')
      return createShotAsset('EP001-SC501', 'SH001', '临时提示词镜头', {
        sceneId: 'EP001-SC501',
        shotId: 'SH001',
        title: '临时提示词镜头',
        timecode: '00:00:00:00-00:00:03:00',
        duration: '3 秒',
        framing: '中景',
        content: '已保存的镜头内容。',
        dialogue: '',
        camera: '固定镜头',
        prompt: 'saved image prompt',
        negativePrompt: 'saved negative prompt',
        references: '',
        status: '待生成',
      })
    })
    const body = {
      assetType: 'shot',
      assetPath: shotPath,
      presetId: 'shot-image-v1',
      profileId: 'mock-cloud',
      options: { width: '1280', height: '720' },
    }

    const savedPreview = await call(api, jsonRequest(body), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(savedPreview.status, 200)
    assert.equal(savedPreview.payload.preview.prompt, 'saved image prompt')
    assert.equal(savedPreview.payload.preview.negativePrompt, 'saved negative prompt')

    const override = {
      ...body,
      prompt: '  temporary image prompt  ',
      negativePrompt: '  temporary negative prompt  ',
    }
    const preview = await call(api, jsonRequest(override), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.preview.prompt, 'temporary image prompt')
    assert.equal(preview.payload.preview.negativePrompt, 'temporary negative prompt')
    assert.match(preview.payload.preview.summary, /临时提示词/u)
    assert.equal(preview.payload.preview.errors.length, 0)

    const submission = await call(api, jsonRequest(override), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(submission.status, 202)
    assert.equal(submission.payload.job.prompt, 'temporary image prompt')
    assert.equal(submission.payload.job.negativePrompt, 'temporary negative prompt')
    const completed = await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(shotPath)}`)
      const job = listed.payload.jobs.find(item => item.id === submission.payload.job.id)
      if (job?.status === 'failed') throw new Error(`Prompt override job failed: ${job.error || 'unknown error'}`)
      return job?.status === 'completed' ? job : undefined
    })
    assert.equal(completed.prompt, 'temporary image prompt')
    assert.equal(completed.negativePrompt, 'temporary negative prompt')
    const stored = await createComfyJobStore(root).get(submission.payload.job.id)
    assert.equal(stored.inputs.prompt, 'temporary image prompt')
    assert.equal(stored.inputs.negativePrompt, 'temporary negative prompt')
    assert.equal(bridge.received.jobs.length, 1)
    assert.equal(bridge.received.jobs[0].inputs.prompt, 'temporary image prompt')
    assert.equal(bridge.received.jobs[0].inputs.negativePrompt, 'temporary negative prompt')

    const source = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    const unchangedShot = source.shots.find(item => item.rootPath === shotPath)
    assert.equal(unchangedShot?.design.prompt, 'saved image prompt')
    assert.equal(unchangedShot?.design.negativePrompt, 'saved negative prompt')

    const emptyPrompt = await call(api, jsonRequest({ ...body, prompt: '' }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(emptyPrompt.status, 200)
    assert.equal(emptyPrompt.payload.preview.prompt, '')
    assert.ok(emptyPrompt.payload.preview.errors.some(message => message.includes('没有可用提示词')))

    const clearedNegative = await call(api, jsonRequest({
      ...body,
      prompt: 'temporary prompt without negative',
      negativePrompt: '',
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(clearedNegative.status, 200)
    assert.equal(clearedNegative.payload.preview.negativePrompt, '')

    const invalidPrompt = await call(api, jsonRequest({ ...body, prompt: 7 }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(invalidPrompt.status, 400)
    assert.match(invalidPrompt.payload.error, /临时提示词无效/u)
    const longNegative = await call(api, jsonRequest({ ...body, negativePrompt: 'x'.repeat(20_001) }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(longNegative.status, 400)
    assert.match(longNegative.payload.error, /临时负面提示词无效/u)
    const videoOverride = await call(api, jsonRequest({
      ...body,
      presetId: 'h3-first-last-video-v1',
      prompt: 'video prompt must remain saved-only',
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(videoOverride.status, 400)
    assert.match(videoOverride.payload.error, /视频工作流不支持临时修改提示词/u)
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI API generates reusable location scene images and lists their jobs', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-location-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()
  const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

  try {
    await saveMockConfig(configPath, bridge.url)
    const locationPath = await withProjectRoot(root, async () => {
      const created = await createLocationAsset('焦土尽头')
      const snapshot = await getAssetWorkspaceSnapshot()
      const location = snapshot.locations.find(item => item.rootPath === created)
      assert.ok(location)
      await updateLocationDocument(
        created,
        '# 焦土尽头场景设定\n\n## 基础设定\n\n末日焦土、断壁残垣和低垂铅云，远处没有现代建筑。\n\n## 场景图提示词\n\n末日焦土、断壁残垣和低垂铅云，远处没有现代建筑。\n\n## 负面提示词\n\n文字，水印\n',
        location.profileRevision,
      )
      return created
    })
    const body = {
      assetType: 'location',
      assetPath: locationPath,
      presetId: 'scene-image-v1',
      profileId: 'mock-cloud',
      options: { width: '1536', height: '864' },
    }

    const preview = await call(api, jsonRequest(body), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.preview.outputSlotLabel, '场景图')
    assert.equal(preview.payload.preview.errors.length, 0)
    assert.deepEqual(preview.payload.preview.attachments, [])
    assert.equal(preview.payload.preview.prompt, '末日焦土、断壁残垣和低垂铅云，远处没有现代建筑。')
    assert.equal(preview.payload.preview.negativePrompt, '文字，水印')

    const submission = await call(api, jsonRequest(body), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(submission.status, 202)
    const completed = await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(locationPath)}`)
      assert.equal(listed.status, 200)
      const job = listed.payload.jobs.find(item => item.id === submission.payload.job.id)
      if (job?.status === 'failed') throw new Error(`Location scene image job failed: ${job.error || 'unknown error'}`)
      return job?.status === 'completed' ? job : undefined
    })

    assert.equal(bridge.received.jobs.length, 1)
    assert.equal(bridge.received.jobs[0].workflowId, 'image-generate')
    assert.match(bridge.received.jobs[0].inputs.prompt, /末日焦土、断壁残垣/u)
    assert.deepEqual(bridge.received.jobs[0].uploads, [])
    assert.equal(completed.outputPaths.length, 1)
    assert.match(completed.outputPaths[0], /^场景\/焦土尽头\/场景图\/.+\.png$/u)
    assert.deepEqual(await readFile(path.join(root, ...completed.outputPaths[0].split('/'))), PIXEL_PNG)
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI API generates reusable prop reference images', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-prop-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()
  const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

  try {
    await saveMockConfig(configPath, bridge.url)
    const propPath = await withProjectRoot(root, async () => {
      const created = await createPropAsset('铜钥匙')
      const snapshot = await getAssetWorkspaceSnapshot()
      const prop = snapshot.props.find(item => item.rootPath === created)
      assert.ok(prop)
      await updatePropDocument(
        created,
        '# 铜钥匙道具设定\n\n## 基础设定\n\n旧铜钥匙，齿纹磨损，握柄缠着黑线。\n\n## 道具图提示词\n\n旧铜钥匙，齿纹磨损，握柄缠着黑线，纯色背景。\n\n## 负面提示词\n\n文字，水印\n',
        prop.profileRevision,
      )
      return created
    })
    const body = {
      assetType: 'prop',
      assetPath: propPath,
      presetId: 'prop-image-v1',
      profileId: 'mock-cloud',
      options: { width: '1024', height: '1024' },
    }

    const preview = await call(api, jsonRequest(body), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.preview.outputSlotLabel, '参考图')
    assert.equal(preview.payload.preview.prompt, '旧铜钥匙，齿纹磨损，握柄缠着黑线，纯色背景。')
    assert.equal(preview.payload.preview.negativePrompt, '文字，水印')
    assert.deepEqual(preview.payload.preview.attachments, [])
    assert.equal(preview.payload.preview.errors.length, 0)

    const submission = await call(api, jsonRequest(body), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(submission.status, 202)
    const completed = await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(propPath)}`)
      const job = listed.payload.jobs.find(item => item.id === submission.payload.job.id)
      if (job?.status === 'failed') throw new Error(`Prop reference image job failed: ${job.error || 'unknown error'}`)
      return job?.status === 'completed' ? job : undefined
    })

    assert.equal(bridge.received.jobs.length, 1)
    assert.equal(bridge.received.jobs[0].workflowId, 'image-generate')
    assert.equal(bridge.received.jobs[0].inputs.prompt, '旧铜钥匙，齿纹磨损，握柄缠着黑线，纯色背景。')
    assert.equal(completed.outputPaths.length, 1)
    assert.match(completed.outputPaths[0], /^道具\/铜钥匙\/参考图\/.+\.png$/u)
    assert.deepEqual(await readFile(path.join(root, ...completed.outputPaths[0].split('/'))), PIXEL_PNG)
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('Comfy archive rejects prop targets outside the project prop directory', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-prop-target-'))
  try {
    await assert.rejects(
      resolveComfyArchiveTarget(temporary, {
        assetType: 'prop',
        assetPath: '场景/焦土尽头',
        slot: 'reference',
      }),
      /Prop output must target one direct child of 道具/u,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI API exposes a Bridge mock completion without claiming media was archived', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-dry-run-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge({ dryRun: true })
  const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

  try {
    await saveMockConfig(configPath, bridge.url)
    const characterPath = await withProjectRoot(root, () => createCharacterAsset('模拟验证人物'))

    const queued = await call(api, jsonRequest({
      assetType: 'character',
      assetPath: characterPath,
      presetId: 'character-turnaround-v1',
      profileId: 'mock-cloud',
      options: { width: '1024', height: '1536' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(queued.status, 202)

    const completed = await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(characterPath)}`)
      const job = listed.payload.jobs.find(item => item.id === queued.payload.job.id)
      if (job?.status === 'failed') throw new Error(`ComfyUI mock job failed: ${job.error || 'unknown error'}`)
      return job?.status === 'completed' ? job : undefined
    })

    assert.deepEqual(completed.outputPaths, [])
    assert.equal(completed.message, 'Comfy Bridge 模拟验证完成。')
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI API preserves structured Bridge node failures for the workbench UI', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-error-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const failure = 'ComfyUI node 140:119 (VAELoader) execution failed: FileNotFoundError: MiniMax H3 video VAE was not found.'
  const bridge = await startMockBridge({ failure })
  const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

  try {
    await saveMockConfig(configPath, bridge.url)
    const characterPath = await withProjectRoot(root, () => createCharacterAsset('错误透传测试人物'))
    const submission = await call(api, jsonRequest({
      assetType: 'character',
      assetPath: characterPath,
      presetId: 'character-turnaround-v1',
      profileId: 'mock-cloud',
      options: { width: '1024', height: '1536' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(submission.status, 202)

    const failed = await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(characterPath)}`)
      return listed.payload.jobs.find(item => item.id === submission.payload.job.id && item.status === 'failed')
    })
    assert.equal(failed.error, failure)
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('H3 first/last-frame jobs omit unsupported negative prompts and archive video outputs', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-h3-video-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge({ outputKind: 'video' })
  const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

  try {
    await saveMockConfig(configPath, bridge.url)
    const shotPath = await withProjectRoot(root, async () => {
      const characterPath = await createCharacterAsset('雨夜巡夜人')
      const locationPath = await createLocationAsset('雨夜巷道')
      const propPath = await createPropAsset('铜钥匙')
      const scenePath = await createSceneAsset('EP001-SC003')
      const created = await createShotAsset('EP001-SC003', 'SH001', 'H3 首尾帧测试', {
        sceneId: 'EP001-SC003',
        shotId: 'SH001',
        title: 'H3 首尾帧测试',
        timecode: '00:00:00:00-00:00:05:00',
        duration: '5 秒',
        framing: '全景',
        content: '人物从远处走近。',
        dialogue: '',
        camera: '缓慢推进',
        prompt: 'cinematic character walks forward',
        negativePrompt: '不要文字，不要水印',
        references: '',
        status: '待生成',
      })
      const initial = await getAssetWorkspaceSnapshot()
      const scene = initial.scenes.find(item => item.rootPath === scenePath)
      assert.ok(scene)
      await updateProjectSettings('项目基调：寒冷写实，雨水与霓虹反光必须连续。', initial.projectSettings.revision)
      await updateSceneDocument(scenePath, '雨夜巷道积水，远处警报闪烁。', scene.sceneRevision)
      await updateSceneCastBindings(scenePath, [{
        characterPath,
        state: '斗篷被雨打湿，右手抬起钥匙',
        continuity: '斗篷和钥匙始终湿润',
        startShotId: 'SH001',
        endShotId: 'SH001',
      }], scene.castRevision)
      await updateSceneAssetBindings(scenePath, {
        locations: [{
          locationPath,
          role: '主要行动空间',
          state: '地面有积水和霓虹倒影',
          continuity: '倒影方向保持一致',
          startShotId: 'SH001',
          endShotId: 'SH001',
        }],
        props: [{
          propPath,
          role: '关键线索',
          state: '握在右手',
          continuity: '始终可见',
          startShotId: 'SH001',
          endShotId: 'SH001',
        }],
      }, scene.assetBindingsRevision)
      await saveAssetUploadStream('shot', created, 'firstFrame', '首帧.png', Readable.from([PIXEL_PNG]))
      await saveAssetUploadStream('shot', created, 'lastFrame', '尾帧.png', Readable.from([PIXEL_PNG]))
      await setWorkspaceVisualSelection('shot', created, 'firstFrame', '首帧.png')
      await setWorkspaceVisualSelection('shot', created, 'lastFrame', '尾帧.png')
      return created
    })

    const invalidDuration = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shotPath,
      presetId: 'h3-first-last-video-v1',
      profileId: 'mock-cloud',
      options: { durationSeconds: '0.5' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(invalidDuration.status, 400)
    assert.match(invalidDuration.payload.error, /1 到 60/u)

    const submission = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shotPath,
      presetId: 'h3-first-last-video-v1',
      profileId: 'mock-cloud',
      options: { durationSeconds: '5', seed: '757358688076805' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(submission.status, 202)

    const completed = await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(shotPath)}`)
      const job = listed.payload.jobs.find(item => item.id === submission.payload.job.id)
      if (job?.status === 'failed') throw new Error(`H3 video job failed: ${job.error || 'unknown error'}`)
      return job?.status === 'completed' ? job : undefined
    })
    assert.equal(bridge.received.uploads.length, 2)
    assert.deepEqual(bridge.received.uploads.map(item => item.name), ['首帧-已选.png', '尾帧-已选.png'])
    assert.equal(bridge.received.jobs.length, 1)
    assert.equal(bridge.received.jobs[0].workflowId, 'video-first-last')
    assert.deepEqual(bridge.received.jobs[0].uploads.map(item => item.role), ['firstFrame', 'lastFrame'])
    assert.equal('negativePrompt' in bridge.received.jobs[0].inputs, false)
    assert.deepEqual(Object.keys(bridge.received.jobs[0].inputs).sort(), ['durationSeconds', 'prompt', 'seed'])
    assert.equal(bridge.received.jobs[0].inputs.durationSeconds, 5)
    assert.equal(bridge.received.jobs[0].inputs.seed, 757358688076805)
    assert.match(bridge.received.jobs[0].inputs.prompt, /镜头核心画面：cinematic character walks forward/u)
    assert.match(bridge.received.jobs[0].inputs.prompt, /画面内容：人物从远处走近。/u)
    assert.match(bridge.received.jobs[0].inputs.prompt, /镜头信息：标题：H3 首尾帧测试；景别：全景；运镜：缓慢推进/u)
    assert.match(bridge.received.jobs[0].inputs.prompt, /场次环境：雨夜巷道积水，远处警报闪烁。/u)
    assert.match(bridge.received.jobs[0].inputs.prompt, /出场人物：雨夜巡夜人，状态：斗篷被雨打湿/u)
    assert.match(bridge.received.jobs[0].inputs.prompt, /地点环境：雨夜巷道，用途：主要行动空间/u)
    assert.match(bridge.received.jobs[0].inputs.prompt, /关键道具：铜钥匙，用途：关键线索/u)
    assert.match(bridge.received.jobs[0].inputs.prompt, /项目设定：项目基调：寒冷写实/u)
    assert.equal(completed.prompt, bridge.received.jobs[0].inputs.prompt)
    assert.equal('negativePrompt' in completed, false)
    assert.equal(completed.outputPaths.length, 1)
    assert.match(completed.outputPaths[0], /^分镜\/EP001-SC003\/SH001-H3 首尾帧测试\/候选\/.+\.mp4$/u)
    const outputPath = path.join(root, ...completed.outputPaths[0].split('/'))
    assert.deepEqual(await readFile(outputPath), Buffer.from('mock-mp4-output'))
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI video downloads use the profile download timeout after headers arrive', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-download-timeout-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  // Delay the body after sending response headers. The ordinary request timeout
  // is intentionally shorter than this delay; only the dedicated download
  // timeout should govern the streaming response.
  const bridge = await startMockBridge({ outputKind: 'video', outputDelayMs: 1_200 })
  const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

  try {
    await saveMockConfig(configPath, bridge.url, {
      requestTimeoutMs: 1_000,
      downloadTimeoutMs: 10_000,
    })
    const shotPath = await withProjectRoot(root, async () => {
      await createSceneAsset('EP001-SC010')
      const created = await createShotAsset('EP001-SC010', 'SH001', '下载超时测试', {
        sceneId: 'EP001-SC010',
        shotId: 'SH001',
        title: '下载超时测试',
        timecode: '',
        duration: '3 秒',
        framing: '中景',
        content: '测试视频下载超时配置。',
        dialogue: '',
        camera: '固定',
        prompt: 'video download timeout test',
        negativePrompt: '',
        references: '',
        status: '待生成',
      })
      await saveAssetUploadStream('shot', created, 'firstFrame', '首帧.png', Readable.from([PIXEL_PNG]))
      await saveAssetUploadStream('shot', created, 'lastFrame', '尾帧.png', Readable.from([PIXEL_PNG]))
      await setWorkspaceVisualSelection('shot', created, 'firstFrame', '首帧.png')
      await setWorkspaceVisualSelection('shot', created, 'lastFrame', '尾帧.png')
      return created
    })

    const submission = await call(api, jsonRequest({
      assetType: 'shot',
      assetPath: shotPath,
      presetId: 'h3-first-last-video-v1',
      profileId: 'mock-cloud',
      options: { durationSeconds: '3' },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(submission.status, 202)

    const completed = await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(shotPath)}`)
      const job = listed.payload.jobs.find(item => item.id === submission.payload.job.id)
      if (job?.status === 'failed') throw new Error(`Video download unexpectedly failed: ${job.error || 'unknown error'}`)
      return job?.status === 'completed' ? job : undefined
    }, 8_000)
    assert.equal(completed.outputPaths.length, 1)
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI startup recovery requeues safe work, resumes remote polling, and flags indeterminate work', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-recovery-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()

  try {
    await saveMockConfig(configPath, bridge.url)
    const characterPath = await withProjectRoot(root, () => createCharacterAsset('恢复人物'))
    const store = createComfyJobStore(root)
    const now = new Date().toISOString()
    const queued = await store.create(recoveredCharacterJob(characterPath, 'queued'))
    const resumable = await store.create(recoveredCharacterJob(characterPath, 'running', {
      remote: {
        bridgeJobId: 'remote_mock_01',
        status: 'running',
        progress: 0.5,
        submittedAt: now,
        updatedAt: now,
      },
    }))
    const runningWithoutRemote = await store.create(recoveredCharacterJob(characterPath, 'running'))
    const uploading = await store.create(recoveredCharacterJob(characterPath, 'uploading'))
    const downloading = await store.create(recoveredCharacterJob(characterPath, 'downloading'))
    const archiving = await store.create(recoveredCharacterJob(characterPath, 'archiving'))

    const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })
    assert.equal(typeof api.handle, 'function')

    const recovered = await waitFor(async () => {
      const jobs = await Promise.all([
        store.get(queued.id),
        store.get(resumable.id),
        store.get(runningWithoutRemote.id),
        store.get(uploading.id),
        store.get(downloading.id),
        store.get(archiving.id),
      ])
      const [queuedJob, resumedJob, ...indeterminateJobs] = jobs
      return queuedJob.status === 'completed'
        && resumedJob.status === 'completed'
        && indeterminateJobs.every(job => job.status === 'failed')
        ? jobs
        : undefined
    })

    const [, , ...indeterminateJobs] = recovered
    assert.equal(bridge.received.jobs.length, 1, 'only the locally queued job should be submitted again')
    for (const job of indeterminateJobs) {
      assert.equal(job.error?.code, 'RECOVERY_REQUIRED')
      assert.match(job.error?.message ?? '', /重启/)
    }
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI only allows queued jobs to be cancelled and does not expose retry', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-actions-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()

  try {
    await saveMockConfig(configPath, bridge.url)
    const characterPath = await withProjectRoot(root, () => createCharacterAsset('任务操作人物'))
    const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

    // Wait for the one-time startup scan before adding deliberate test jobs.
    const initial = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(characterPath)}`)
    assert.equal(initial.status, 200)

    const store = createComfyJobStore(root)
    const queued = await store.create(recoveredCharacterJob(characterPath, 'queued'))
    const failed = await store.create(recoveredCharacterJob(characterPath, 'failed', {
      error: { code: 'TEST_FAILURE', message: '用于测试重试。', at: new Date().toISOString() },
    }))
    const cancelled = await call(api, jsonRequest({}), `http://127.0.0.1/ai-drama/workbench/comfy/jobs/${queued.id}/cancel`)
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.payload.job.status, 'cancelled')
    assert.equal((await store.get(queued.id)).status, 'cancelled')
    assert.equal(bridge.received.jobs.length, 0, 'cancelling a queued task must not contact the bridge')

    const rejectedCancel = await call(api, jsonRequest({}), `http://127.0.0.1/ai-drama/workbench/comfy/jobs/${failed.id}/cancel`)
    assert.equal(rejectedCancel.status, 409)
    assert.equal(rejectedCancel.payload.code, 'JOB_NOT_CANCELLABLE')

    const unavailableRetry = await call(api, jsonRequest({}), `http://127.0.0.1/ai-drama/workbench/comfy/jobs/${failed.id}/retry`)
    assert.equal(unavailableRetry.status, 404)
    assert.equal((await store.get(failed.id)).status, 'failed')
    assert.equal((await store.get(queued.id)).status, 'cancelled')
    assert.equal(bridge.received.jobs.length, 0)
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI recovery strips legacy uploads from queued text-to-image jobs', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-queued-legacy-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()

  try {
    await saveMockConfig(configPath, bridge.url)
    const characterPath = await withProjectRoot(root, () => createCharacterAsset('排队旧任务人物'))
    const store = createComfyJobStore(root)
    const queued = await store.create({
      status: 'queued',
      profileId: 'mock-cloud',
      workflowId: 'character-turnaround-v1',
      inputs: { prompt: '排队旧任务恢复测试。', width: 1024, height: 1536 },
      uploads: [{
        role: 'referenceImage',
        sourcePath: '主要人物/排队旧任务人物/参考图/不存在-已选.png',
        fileName: '不存在-已选.png',
      }],
      target: { assetType: 'character', assetPath: characterPath, slot: 'turnaround' },
    })
    createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

    const completed = await waitFor(async () => {
      const current = await store.get(queued.id)
      if (current.status === 'failed') throw new Error(`queued legacy recovery failed: ${current.error?.message || 'unknown error'}`)
      return current.status === 'completed' ? current : undefined
    })
    assert.equal(completed.status, 'completed')
    assert.deepEqual(completed.uploads, [])
    assert.equal(bridge.received.uploads.length, 0)
    assert.equal(bridge.received.jobs.length, 1)
    assert.deepEqual(bridge.received.jobs[0].uploads, [])
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI refuses a queued H3 task when its frozen selected first frame was replaced', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-selection-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()

  try {
    await saveMockConfig(configPath, bridge.url)
    const shotPath = await withProjectRoot(root, async () => {
      await createSceneAsset('EP001-SC002')
      const shotPath = await createShotAsset('EP001-SC002', 'SH001', '冻结首尾帧镜头', {
        sceneId: 'EP001-SC002',
        shotId: 'SH001',
        title: '冻结首尾帧镜头',
        timecode: '00:00:00:00-00:00:03:00',
        duration: '3 秒',
        framing: '全景',
        content: '测试 H3 首尾帧冻结。',
        dialogue: '',
        camera: '固定镜头',
        prompt: 'cinematic first and last frame test',
        negativePrompt: '',
        references: '',
        status: '待生成',
      })
      await saveAssetUploadStream('shot', shotPath, 'firstFrame', '首帧-01.png', Readable.from([PIXEL_PNG]))
      await saveAssetUploadStream('shot', shotPath, 'firstFrame', '首帧-02.png', Readable.from([PIXEL_PNG]))
      await saveAssetUploadStream('shot', shotPath, 'lastFrame', '尾帧-01.png', Readable.from([PIXEL_PNG]))
      await setWorkspaceVisualSelection('shot', shotPath, 'firstFrame', '首帧-01.png')
      await setWorkspaceVisualSelection('shot', shotPath, 'lastFrame', '尾帧-01.png')
      return shotPath
    })
    const snapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    const shot = snapshot.shots.find(item => item.rootPath === shotPath)
    const selectedFirstFrame = shot?.slots.find(slot => slot.key === 'firstFrame')?.files.find(file => file.name.endsWith('-已选.png'))
    const selectedLastFrame = shot?.slots.find(slot => slot.key === 'lastFrame')?.files.find(file => file.name.endsWith('-已选.png'))
    assert.ok(selectedFirstFrame)
    assert.ok(selectedLastFrame)
    const store = createComfyJobStore(root)
    const job = await store.create({
      profileId: 'mock-cloud',
      workflowId: 'h3-first-last-video-v1',
      inputs: { prompt: '首尾帧冻结测试。', durationSeconds: 3 },
      uploads: [
        { role: 'firstFrame', sourcePath: selectedFirstFrame.path, fileName: selectedFirstFrame.name },
        { role: 'lastFrame', sourcePath: selectedLastFrame.path, fileName: selectedLastFrame.name },
      ],
      target: { assetType: 'shot', assetPath: shotPath, slot: 'candidate' },
    })

    await withProjectRoot(root, () => setWorkspaceVisualSelection('shot', shotPath, 'firstFrame', '首帧-02.png'))
    createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })

    const failed = await waitFor(async () => {
      const latest = await store.get(job.id)
      return latest.status === 'failed' ? latest : undefined
    })
    assert.equal(failed.error?.code, 'REFERENCE_SELECTION_CHANGED')
    assert.match(failed.error?.message ?? '', /参考图在任务开始前被切换/u)
    assert.equal(bridge.received.uploads.length, 0)
    assert.equal(bridge.received.jobs.length, 0)
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ComfyUI text-to-image ignores manually duplicated selected images', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-comfy-duplicate-selection-'))
  const root = await realpath(temporary)
  const configPath = path.join(temporary, 'private-comfy.json')
  const state = { root: async () => root }
  const bridge = await startMockBridge()

  try {
    await saveMockConfig(configPath, bridge.url)
    const characterPath = await withProjectRoot(root, async () => {
      const created = await createCharacterAsset('歧义选图人物')
      await saveAssetUploadStream('character', created, 'reference', '参考-01.png', Readable.from([PIXEL_PNG]))
      await saveAssetUploadStream('character', created, 'reference', '参考-02.png', Readable.from([PIXEL_PNG]))
      await setCharacterVisualSelection(created, 'reference', '参考-01.png')
      return created
    })

    // Simulate an external/manual filesystem edit that bypasses the UI's
    // single-selection rename transaction.
    await rename(
      path.join(root, characterPath, '参考图', '参考-02.png'),
      path.join(root, characterPath, '参考图', '参考-02-已选.png'),
    )

    const api = createComfyApi(state, { configPath, pollIntervalMs: 5, maxPollMs: 2_000 })
    const body = {
      assetType: 'character',
      assetPath: characterPath,
      presetId: 'character-costume-v1',
      profileId: 'mock-cloud',
      options: { width: '1024', height: '1536' },
    }
    const preview = await call(api, jsonRequest(body), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.preview.attachments.length, 0)
    assert.deepEqual(preview.payload.preview.attachments, [])
    assert.equal(preview.payload.preview.errors.length, 0)

    const submission = await call(api, jsonRequest(body), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs')
    assert.equal(submission.status, 202)
    await waitFor(async () => {
      const listed = await call(api, getRequest(), `http://127.0.0.1/ai-drama/workbench/comfy/jobs?assetPath=${encodeURIComponent(characterPath)}`)
      const job = listed.payload.jobs.find(item => item.id === submission.payload.job.id)
      if (job?.status === 'failed') throw new Error(`ComfyUI job failed: ${job.error || 'unknown error'}`)
      return job?.status === 'completed' ? job : undefined
    })
    assert.equal(bridge.received.uploads.length, 0)
    assert.equal(bridge.received.jobs.length, 1)
    assert.deepEqual(bridge.received.jobs[0].uploads, [])

    const unsupportedReferenceMode = await call(api, jsonRequest({
      ...body,
      options: { ...body.options, useReferenceImages: true },
    }), 'http://127.0.0.1/ai-drama/workbench/comfy/jobs/preview')
    assert.equal(unsupportedReferenceMode.status, 400)
    assert.match(unsupportedReferenceMode.payload.error, /暂不支持参考生图/u)
    assert.equal(bridge.received.jobs.length, 1)
  } finally {
    await bridge.close()
    await rm(temporary, { recursive: true, force: true })
  }
})
