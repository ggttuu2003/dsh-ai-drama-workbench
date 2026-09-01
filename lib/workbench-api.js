import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'

import {
  MAX_ASSET_UPLOAD_BYTES,
  ProjectConflictError,
  ProjectPathError,
  ProjectPayloadTooLargeError,
  createCharacterAsset,
  createCharacterLookAsset,
  createLocationAsset,
  createPropAsset,
  createSceneAsset,
  createShotAsset,
  getAssetWorkspaceSnapshot,
  getProjectStructureSnapshot,
  getTrashEntries,
  importStoryboardDrafts,
  readTextAsset,
  rebuildProjectIndex,
  renameWorkspaceAsset,
  restoreTrashEntry,
  resolveExistingPath,
  saveAssetUploadStream,
  setCharacterTurnaround,
  setCharacterVisualSelection,
  setWorkspaceVisualSelection,
  trashWorkspaceAsset,
  trashWorkspaceAssetFile,
  updateCharacterLookDocument,
  updateCharacterProfile,
  updateProjectSettings,
  updateSceneCastBindings,
  updateSceneAssetBindings,
  updateSceneDocument,
  updateLocationDocument,
  updatePropDocument,
  updateShotDesign,
  withProjectRoot,
} from '../lib/workspace-core.js'

const MAX_JSON_BYTES = 4 * 1024 * 1024
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mkv', '.mov', '.mp4', '.webm'])
const CHARACTER_VISUAL_SLOTS = new Set(['turnaround', 'costume', 'reference'])
const ASSET_TYPES = new Set(['character', 'location', 'prop', 'scene', 'shot'])
const GENERIC_BINARY_MEDIA_TYPE = 'application/octet-stream'
const UPLOAD_MEDIA_BY_EXTENSION = new Map([
  ['.avif', { kind: 'image', mediaTypes: new Set(['image/avif']) }],
  ['.gif', { kind: 'image', mediaTypes: new Set(['image/gif']) }],
  ['.jpeg', { kind: 'image', mediaTypes: new Set(['image/jpeg']) }],
  ['.jpg', { kind: 'image', mediaTypes: new Set(['image/jpeg']) }],
  ['.mkv', { kind: 'video', mediaTypes: new Set(['video/x-matroska', 'video/matroska']) }],
  ['.mov', { kind: 'video', mediaTypes: new Set(['video/quicktime']) }],
  ['.mp4', { kind: 'video', mediaTypes: new Set(['video/mp4']) }],
  ['.png', { kind: 'image', mediaTypes: new Set(['image/png']) }],
  ['.webm', { kind: 'video', mediaTypes: new Set(['video/webm']) }],
  ['.webp', { kind: 'image', mediaTypes: new Set(['image/webp']) }],
])

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function workspaceError(responseJson, res, error, fallback) {
  if (error instanceof ProjectConflictError) {
    responseJson(res, 409, { error: error.message, code: 'REVISION_CONFLICT' })
    return
  }
  if (error instanceof ProjectPayloadTooLargeError) {
    responseJson(res, 413, { error: error.message })
    return
  }
  if (error instanceof ProjectPathError) {
    responseJson(res, 400, { error: error.message })
    return
  }
  if (error instanceof SyntaxError) {
    responseJson(res, 400, { error: '请求内容格式无效。' })
    return
  }
  const code = error && typeof error === 'object' ? error.code : undefined
  if (code === 'ENOENT') {
    responseJson(res, 404, { error: '找不到请求的文件。' })
    return
  }
  if (code === 'EEXIST') {
    responseJson(res, 409, { error: '同名文件已经存在。' })
    return
  }
  if (code === 'EISDIR' || code === 'ENOTDIR') {
    responseJson(res, 400, { error: '请求的路径类型不正确。' })
    return
  }
  console.error(`[ai-drama-workbench] ${fallback}`, error)
  responseJson(res, 500, { error: fallback })
}

function isLoopbackHostname(hostname) {
  const value = hostname.toLowerCase()
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]'
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin
  const host = typeof req.headers.host === 'string' ? req.headers.host.trim() : ''
  if (!origin) return !req.socket?.remoteAddress || isLoopbackAddress(req.socket.remoteAddress)
  if (!host) return false
  try {
    const requested = new URL(`http://${host}`)
    const supplied = new URL(origin)
    return requested.protocol === 'http:'
      && supplied.protocol === 'http:'
      && isLoopbackHostname(requested.hostname)
      && supplied.origin === requested.origin
  } catch {
    return false
  }
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_JSON_BYTES) throw new ProjectPayloadTooLargeError('资产操作请求不能超过 4 MB。')
    chunks.push(chunk)
  }
  if (!size) throw new SyntaxError('empty body')
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new SyntaxError('invalid body')
  return parsed
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value) {
  return typeof value === 'string'
}

function isTextArray(value) {
  return Array.isArray(value) && value.length <= 200 && value.every(isText)
}

function isAssetType(value) {
  return typeof value === 'string' && ASSET_TYPES.has(value)
}

function isCharacterVisualSlot(value) {
  return typeof value === 'string' && CHARACTER_VISUAL_SLOTS.has(value)
}

function parseDeclaredUploadLength(value) {
  if (value === undefined) return undefined
  if (Array.isArray(value) || typeof value !== 'string') {
    throw new ProjectPathError('上传文件大小请求头无效。')
  }
  const text = value.trim()
  if (!/^(?:0|[1-9]\d*)$/u.test(text)) {
    throw new ProjectPathError('上传文件大小请求头无效。')
  }
  const size = Number(text)
  if (!Number.isSafeInteger(size)) {
    throw new ProjectPathError('上传文件大小请求头无效。')
  }
  if (!size) throw new ProjectPathError('请上传非空的图片或视频文件。')
  if (size > MAX_ASSET_UPLOAD_BYTES) {
    throw new ProjectPayloadTooLargeError('每个上传文件最大为 200 MB。')
  }
  return size
}

function parseUploadMediaType(value) {
  if (value === undefined) return undefined
  if (Array.isArray(value) || typeof value !== 'string') {
    throw new ProjectPathError('上传文件类型请求头无效。')
  }
  const mediaType = value.split(';', 1)[0].trim().toLowerCase()
  if (!mediaType) throw new ProjectPathError('上传文件类型请求头无效。')
  return mediaType
}

function assertValidUploadRequest(assetType, fileName, contentTypeHeader) {
  const extension = path.extname(fileName).toLowerCase()
  const expected = UPLOAD_MEDIA_BY_EXTENSION.get(extension)
  if (!expected) {
    throw new ProjectPathError('仅支持 PNG、JPG、JPEG、WEBP、GIF、AVIF、MP4、MOV、WEBM 或 MKV 文件。')
  }
  if (assetType === 'character' && expected.kind !== 'image') {
    throw new ProjectPathError('人物资料槽仅支持图片文件。')
  }

  const mediaType = parseUploadMediaType(contentTypeHeader)
  // Some browsers leave File.type blank for uncommon formats. The persisted
  // stream is still checked against its binary signature in workspace-core.
  if (!mediaType || mediaType === GENERIC_BINARY_MEDIA_TYPE) return
  if (!expected.mediaTypes.has(mediaType)) {
    throw new ProjectPathError('上传文件的 MIME 类型与文件扩展名不一致。')
  }
}

function isShotCharacterOverride(value) {
  return isRecord(value)
    && isText(value.characterPath)
    && isText(value.mode)
    && isText(value.state)
    && ['inherit', 'identity', 'look'].includes(value.mode)
    && (value.lookPath === undefined || isText(value.lookPath))
}

function isSceneCastBinding(value) {
  return isRecord(value)
    && isText(value.characterPath)
    && (value.lookPath === undefined || isText(value.lookPath))
    && isText(value.state)
    && isText(value.continuity)
    && isText(value.startShotId)
    && isText(value.endShotId)
}

function isSceneCastBindings(value) {
  return Array.isArray(value) && value.length <= 120 && value.every(isSceneCastBinding)
}

function isSceneAssetBinding(value, key) {
  return isRecord(value)
    && isText(value[key])
    && isText(value.role)
    && isText(value.state)
    && isText(value.continuity)
    && isText(value.startShotId)
    && isText(value.endShotId)
}

function isSceneAssetBindings(value) {
  return isRecord(value)
    && Array.isArray(value.locations) && value.locations.length <= 120
    && value.locations.every((item) => isSceneAssetBinding(item, 'locationPath'))
    && Array.isArray(value.props) && value.props.length <= 120
    && value.props.every((item) => isSceneAssetBinding(item, 'propPath'))
}

function isShotDesign(value) {
  if (!isRecord(value)) return false
  const requiredFields = [
    'sceneId', 'shotId', 'title', 'timecode', 'duration', 'framing', 'content',
    'dialogue', 'camera', 'prompt', 'negativePrompt', 'references', 'status',
  ]
  return requiredFields.every(key => isText(value[key]))
    && (value.characterOverrides === undefined
      || Array.isArray(value.characterOverrides) && value.characterOverrides.every(isShotCharacterOverride))
}

function parseAssetAction(value) {
  if (!isRecord(value) || !isText(value.action)) return null
  switch (value.action) {
    case 'createCharacter':
      return isText(value.name) ? { action: value.action, name: value.name } : null
    case 'createCharacterLook':
      return isText(value.characterPath) && isText(value.name)
        ? { action: value.action, characterPath: value.characterPath, name: value.name } : null
    case 'createScene':
      return isText(value.sceneId) ? { action: value.action, sceneId: value.sceneId } : null
    case 'createLocation':
    case 'createProp':
      return isText(value.name) ? { action: value.action, name: value.name } : null
    case 'createShot':
      return isText(value.sceneId) && isText(value.shotId) && isText(value.title)
        && (value.design === undefined || isShotDesign(value.design))
        ? { action: value.action, sceneId: value.sceneId, shotId: value.shotId, title: value.title, ...(value.design ? { design: value.design } : {}) } : null
    case 'importStoryboardDrafts':
      return isText(value.sourcePath) && (value.shotIds === undefined || isTextArray(value.shotIds))
        ? { action: value.action, sourcePath: value.sourcePath, ...(value.shotIds ? { shotIds: value.shotIds } : {}) } : null
    case 'updateCharacterProfile':
      return isText(value.assetPath) && isText(value.content) && isText(value.expectedRevision)
        ? { action: value.action, assetPath: value.assetPath, content: value.content, expectedRevision: value.expectedRevision } : null
    case 'updateProjectSettings':
      return isText(value.content) && isText(value.expectedRevision)
        ? { action: value.action, content: value.content, expectedRevision: value.expectedRevision } : null
    case 'updateCharacterLookDocument':
      return isText(value.characterPath) && isText(value.lookPath) && isText(value.content) && isText(value.expectedRevision)
        ? { action: value.action, characterPath: value.characterPath, lookPath: value.lookPath, content: value.content, expectedRevision: value.expectedRevision } : null
    case 'updateSceneDocument':
      return isText(value.assetPath) && isText(value.content) && isText(value.expectedRevision)
        ? { action: value.action, assetPath: value.assetPath, content: value.content, expectedRevision: value.expectedRevision } : null
    case 'updateLocationDocument':
    case 'updatePropDocument':
      return isText(value.assetPath) && isText(value.content) && isText(value.expectedRevision)
        ? { action: value.action, assetPath: value.assetPath, content: value.content, expectedRevision: value.expectedRevision } : null
    case 'updateSceneCastBindings':
      return isText(value.assetPath) && isSceneCastBindings(value.bindings) && isText(value.expectedRevision)
        ? { action: value.action, assetPath: value.assetPath, bindings: value.bindings, expectedRevision: value.expectedRevision } : null
    case 'updateSceneAssetBindings':
      return isText(value.assetPath) && isSceneAssetBindings(value.bindings) && isText(value.expectedRevision)
        ? { action: value.action, assetPath: value.assetPath, bindings: value.bindings, expectedRevision: value.expectedRevision } : null
    case 'setCharacterVisualSelection':
      return isText(value.assetPath) && isCharacterVisualSlot(value.slot) && isText(value.fileName)
        && (value.lookPath === undefined || isText(value.lookPath))
        ? { action: value.action, assetPath: value.assetPath, slot: value.slot, fileName: value.fileName, ...(isText(value.lookPath) ? { lookPath: value.lookPath } : {}) } : null
    case 'setCharacterTurnaround':
      return isText(value.assetPath) && isText(value.fileName)
        ? { action: value.action, assetPath: value.assetPath, fileName: value.fileName } : null
    case 'setWorkspaceVisualSelection':
      return isAssetType(value.assetType) && isText(value.assetPath) && isText(value.slot) && isText(value.fileName)
        && (value.lookPath === undefined || isText(value.lookPath))
        ? { action: value.action, assetType: value.assetType, assetPath: value.assetPath, slot: value.slot, fileName: value.fileName, ...(isText(value.lookPath) ? { lookPath: value.lookPath } : {}) } : null
    case 'updateShotDesign':
      return isText(value.assetPath) && isShotDesign(value.design) && isText(value.expectedRevision)
        ? { action: value.action, assetPath: value.assetPath, design: value.design, expectedRevision: value.expectedRevision } : null
    case 'renameAsset':
      return isAssetType(value.assetType) && isText(value.assetPath) && isText(value.name)
        ? { action: value.action, assetType: value.assetType, assetPath: value.assetPath, name: value.name } : null
    case 'trashAsset':
      return isAssetType(value.assetType) && isText(value.assetPath)
        ? { action: value.action, assetType: value.assetType, assetPath: value.assetPath } : null
    case 'trashAssetFile':
      return isAssetType(value.assetType) && isText(value.assetPath) && isText(value.slot) && isText(value.fileName)
        && (value.lookPath === undefined || isText(value.lookPath))
        ? { action: value.action, assetType: value.assetType, assetPath: value.assetPath, slot: value.slot, fileName: value.fileName, ...(isText(value.lookPath) ? { lookPath: value.lookPath } : {}) } : null
    case 'rebuildProjectIndex':
      return { action: value.action }
    default:
      return null
  }
}

function parseProjectRegistryAction(value) {
  if (!isRecord(value) || !isText(value.action)) return null
  if (value.action === 'select' && isText(value.projectId)) {
    return { action: 'select', projectId: value.projectId }
  }
  if (value.action === 'create' && isText(value.name)) {
    return { action: 'create', name: value.name }
  }
  return null
}

function parseTrashAction(value) {
  if (!isRecord(value) || value.action !== 'restore' || !isText(value.entryId)) return null
  return { action: 'restore', entryId: value.entryId }
}

async function performAssetAction(action) {
  switch (action.action) {
    case 'createCharacter': return { ok: true, path: await createCharacterAsset(action.name) }
    case 'createCharacterLook': return { ok: true, path: await createCharacterLookAsset(action.characterPath, action.name) }
    case 'createScene': return { ok: true, path: await createSceneAsset(action.sceneId) }
    case 'createLocation': return { ok: true, path: await createLocationAsset(action.name) }
    case 'createProp': return { ok: true, path: await createPropAsset(action.name) }
    case 'createShot': return { ok: true, path: await createShotAsset(action.sceneId, action.shotId, action.title, action.design) }
    case 'importStoryboardDrafts': return { ok: true, ...await importStoryboardDrafts(action.sourcePath, action.shotIds) }
    case 'updateCharacterProfile': return { ok: true, path: await updateCharacterProfile(action.assetPath, action.content, action.expectedRevision) }
    case 'updateProjectSettings': return { ok: true, path: await updateProjectSettings(action.content, action.expectedRevision) }
    case 'updateCharacterLookDocument': return { ok: true, path: await updateCharacterLookDocument(action.characterPath, action.lookPath, action.content, action.expectedRevision) }
    case 'updateSceneDocument': return { ok: true, path: await updateSceneDocument(action.assetPath, action.content, action.expectedRevision) }
    case 'updateLocationDocument': return { ok: true, path: await updateLocationDocument(action.assetPath, action.content, action.expectedRevision) }
    case 'updatePropDocument': return { ok: true, path: await updatePropDocument(action.assetPath, action.content, action.expectedRevision) }
    case 'updateSceneCastBindings': return { ok: true, path: await updateSceneCastBindings(action.assetPath, action.bindings, action.expectedRevision) }
    case 'updateSceneAssetBindings': return { ok: true, path: await updateSceneAssetBindings(action.assetPath, action.bindings, action.expectedRevision) }
    case 'setCharacterVisualSelection': return { ok: true, path: await setCharacterVisualSelection(action.assetPath, action.slot, action.fileName, action.lookPath) }
    case 'setCharacterTurnaround': return { ok: true, path: await setCharacterTurnaround(action.assetPath, action.fileName) }
    case 'setWorkspaceVisualSelection': return { ok: true, path: await setWorkspaceVisualSelection(action.assetType, action.assetPath, action.slot, action.fileName, action.lookPath) }
    case 'updateShotDesign': return { ok: true, path: await updateShotDesign(action.assetPath, action.design, action.expectedRevision) }
    case 'renameAsset': return { ok: true, path: await renameWorkspaceAsset(action.assetType, action.assetPath, action.name) }
    case 'trashAsset': return { ok: true, path: await trashWorkspaceAsset(action.assetType, action.assetPath) }
    case 'trashAssetFile': return { ok: true, path: await trashWorkspaceAssetFile(action.assetType, action.assetPath, action.slot, action.fileName, action.lookPath) }
    case 'rebuildProjectIndex': return { ok: true, path: await rebuildProjectIndex() }
    default: throw new ProjectPathError('不支持此资产操作。')
  }
}

function contentType(fileName) {
  const extension = path.extname(fileName).toLowerCase()
  return {
    '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
    '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.mp4': 'video/mp4',
    '.png': 'image/png', '.webm': 'video/webm', '.webp': 'image/webp',
  }[extension]
}

function parseRange(value, size) {
  if (!value) return null
  if (!size) return 'invalid'
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim())
  if (!match || (!match[1] && !match[2])) return 'invalid'
  const startValue = match[1] ? Number(match[1]) : undefined
  const endValue = match[2] ? Number(match[2]) : undefined
  if (!Number.isSafeInteger(startValue ?? 0) || !Number.isSafeInteger(endValue ?? 0)) return 'invalid'
  if (startValue === undefined) {
    if (!endValue || endValue < 1) return 'invalid'
    return { start: Math.max(0, size - endValue), end: size - 1 }
  }
  const end = Math.min(endValue ?? size - 1, size - 1)
  return startValue < 0 || startValue > end || startValue >= size ? 'invalid' : { start: startValue, end }
}

async function serveAsset(root, req, res, url) {
  const relativePath = url.searchParams.get('path')
  if (!relativePath) throw new ProjectPathError('需要提供项目内文件路径。')
  const absolutePath = await withProjectRoot(root, () => resolveExistingPath(relativePath))
  const extension = path.extname(absolutePath).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension) && !VIDEO_EXTENSIONS.has(extension)) {
    throw new ProjectPathError('该文件类型不能预览。')
  }
  const type = contentType(absolutePath)
  if (!type) throw new ProjectPathError('该文件类型不能预览。')
  const info = await fs.stat(absolutePath)
  if (!info.isFile()) throw new ProjectPathError('只能预览普通文件。')
  const range = parseRange(typeof req.headers.range === 'string' ? req.headers.range : undefined, info.size)
  if (range === 'invalid') {
    res.writeHead(416, { 'content-range': `bytes */${info.size}` })
    res.end()
    return
  }
  if (!info.size) {
    res.writeHead(200, { 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'content-length': '0', 'content-type': type })
    res.end()
    return
  }
  const start = range?.start ?? 0
  const end = range?.end ?? info.size - 1
  const length = end - start + 1
  res.writeHead(range ? 206 : 200, {
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(absolutePath))}`,
    'content-length': String(length),
    'content-type': type,
    ...(range ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}),
  })
  const stream = createReadStream(absolutePath, { start, end })
  stream.on('error', () => { if (!res.writableEnded) res.destroy() })
  stream.pipe(res)
}

async function resolveRequestProject(state, url) {
  const rawProjectId = url.searchParams.get('projectId')
  if (rawProjectId !== null && rawProjectId.trim() === '') {
    throw new ProjectPathError('项目 ID 不能为空。')
  }
  if (typeof state.resolveProject === 'function') {
    return state.resolveProject(rawProjectId ?? undefined)
  }
  // Keep the small compatibility API usable by tests and older hosts that
  // only supplied state.root(). Production WorkbenchState always pins by ID.
  return { id: undefined, root: await state.root() }
}

function decorateProjectMedia(value, projectId) {
  if (!projectId || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(item => decorateProjectMedia(item, projectId))
  if (typeof value !== 'object') return value
  const result = {}
  for (const [key, nested] of Object.entries(value)) {
    result[key] = decorateProjectMedia(nested, projectId)
  }
  // AssetFile objects are the only response objects that carry this exact
  // trio. The extra ID lets an old tab keep rendering media from its pinned
  // project after another tab changes the process-wide default.
  if (typeof value.name === 'string' && typeof value.path === 'string' && typeof value.kind === 'string') {
    result.projectId = projectId
  }
  return result
}

function projectSnapshotResponse(snapshot, project) {
  return project.id ? decorateProjectMedia({ ...snapshot, projectId: project.id }, project.id) : snapshot
}

export async function handleWorkbenchRequest({ state, req, res, url, responseJson }) {
  if (!url.pathname.startsWith('/ai-drama/workbench/')) return false

  try {
    // Project selection must work before an active project exists, so handle it
    // before resolving state.root(). It only exposes safe project IDs, never paths.
    if (url.pathname === '/ai-drama/workbench/projects' && req.method === 'GET') {
      if (typeof state.listProjects !== 'function') throw new ProjectPathError('当前工作台不支持项目库。')
      responseJson(res, 200, await state.listProjects())
      return true
    }
    if (url.pathname === '/ai-drama/workbench/projects' && req.method === 'POST') {
      if (!isAllowedOrigin(req)) {
        responseJson(res, 403, { error: '不允许跨来源切换项目。' })
        return true
      }
      const contentTypeHeader = String(req.headers['content-type'] ?? '').toLowerCase()
      if (!contentTypeHeader.includes('application/json')) throw new ProjectPathError('项目操作需要 JSON 请求。')
      const action = parseProjectRegistryAction(await readJson(req))
      if (!action) throw new ProjectPathError('项目操作请求无效。')
      if (action.action === 'select') {
        if (typeof state.selectProject !== 'function') throw new ProjectPathError('当前工作台不支持切换项目。')
        responseJson(res, 200, await state.selectProject(action.projectId))
      } else {
        if (typeof state.createProject !== 'function') throw new ProjectPathError('当前工作台不支持新建项目。')
        responseJson(res, 201, await state.createProject(action.name))
      }
      return true
    }

    const project = await resolveRequestProject(state, url)
    const { root } = project
    if (url.pathname === '/ai-drama/workbench/project' && req.method === 'GET') {
      const snapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
      responseJson(res, 200, projectSnapshotResponse(snapshot, project))
      return true
    }
    if (url.pathname === '/ai-drama/workbench/structure' && req.method === 'GET') {
      const structure = await withProjectRoot(root, () => getProjectStructureSnapshot())
      responseJson(res, 200, project.id ? { ...structure, projectId: project.id } : structure)
      return true
    }
    if (url.pathname === '/ai-drama/workbench/trash' && req.method === 'GET') {
      const entries = await withProjectRoot(root, () => getTrashEntries())
      responseJson(res, 200, project.id ? { entries, projectId: project.id } : { entries })
      return true
    }
    if (url.pathname === '/ai-drama/workbench/trash' && req.method === 'POST') {
      if (!isAllowedOrigin(req)) {
        responseJson(res, 403, { error: '不允许跨来源恢复资产。' })
        return true
      }
      const contentTypeHeader = String(req.headers['content-type'] ?? '').toLowerCase()
      if (!contentTypeHeader.includes('application/json')) throw new ProjectPathError('回收站操作需要 JSON 请求。')
      const action = parseTrashAction(await readJson(req))
      if (!action) throw new ProjectPathError('回收站操作请求无效。')
      const restoredPath = await withProjectRoot(root, () => restoreTrashEntry(action.entryId))
      responseJson(res, 200, { ok: true, path: restoredPath })
      return true
    }
    if (url.pathname === '/ai-drama/workbench/file' && req.method === 'GET') {
      const relativePath = url.searchParams.get('path')
      if (!relativePath) throw new ProjectPathError('需要提供项目内文件路径。')
      responseJson(res, 200, await withProjectRoot(root, () => readTextAsset(relativePath)))
      return true
    }
    if (url.pathname === '/ai-drama/workbench/asset' && req.method === 'GET') {
      await serveAsset(root, req, res, url)
      return true
    }
    if (url.pathname === '/ai-drama/workbench/assets' && req.method === 'POST') {
      if (!isAllowedOrigin(req)) {
        responseJson(res, 403, { error: '不允许跨来源修改资产。' })
        return true
      }
      const contentTypeHeader = String(req.headers['content-type'] ?? '').toLowerCase()
      if (!contentTypeHeader.includes('application/json')) throw new ProjectPathError('资产操作需要 JSON 请求。')
      const body = await readJson(req)
      const action = parseAssetAction(body)
      if (!action) throw new ProjectPathError('资产操作请求无效。')
      responseJson(res, 200, await withProjectRoot(root, () => performAssetAction(action)))
      return true
    }
    if (url.pathname === '/ai-drama/workbench/assets/upload' && req.method === 'POST') {
      if (!isAllowedOrigin(req)) {
        responseJson(res, 403, { error: '不允许跨来源修改资产。' })
        return true
      }
      const assetType = url.searchParams.get('assetType')
      const assetPath = url.searchParams.get('assetPath')
      const lookPath = url.searchParams.get('lookPath') || undefined
      const slot = url.searchParams.get('slot')
      const fileName = url.searchParams.get('fileName')
      if (!isAssetType(assetType) || !assetPath || !slot || !fileName) {
        throw new ProjectPathError('上传资产请求无效。')
      }
      assertValidUploadRequest(assetType, fileName, req.headers['content-type'])
      parseDeclaredUploadLength(req.headers['content-length'])
      const uploadedPath = await withProjectRoot(root, () => saveAssetUploadStream(assetType, assetPath, slot, fileName, req, lookPath))
      responseJson(res, 200, { ok: true, path: uploadedPath })
      return true
    }
    responseJson(res, 404, { error: '找不到工作台接口。' })
    return true
  } catch (error) {
    workspaceError(responseJson, res, error, '工作台操作未能完成。')
    return true
  }
}
