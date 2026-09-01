import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

export const COMFY_CONFIG_VERSION = 1
export const COMFY_JOB_VERSION = 1
export const COMFY_CONFIG_FILE_NAME = 'ai-drama-workbench-comfy.json'
export const COMFY_PLACEHOLDER_PROFILE_ID = 'cloud-a'
export const COMFY_JOB_STATUSES = Object.freeze([
  'draft',
  'queued',
  'uploading',
  'running',
  'downloading',
  'archiving',
  'completed',
  'failed',
  'cancelled',
])

const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_JOB_BYTES = 2 * 1024 * 1024
const MAX_JOB_HISTORY_ENTRIES = 200
const MAX_JOB_ERROR_MESSAGE_CHARS = 2_000
// A single remote output should never be able to exhaust the user's project disk.
// H3 videos comfortably fit below this cap while a malformed bridge response cannot.
export const COMFY_MAX_OUTPUT_FILE_BYTES = 2 * 1024 * 1024 * 1024
export const COMFY_MAX_OUTPUT_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
const PROFILE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const JOB_ID_PATTERN = /^job_[A-Za-z0-9-]{8,128}$/
const REMOTE_ID_PATTERN = /^[A-Za-z0-9._-]{1,256}$/
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const JOB_TRANSITIONS = Object.freeze({
  draft: ['queued', 'cancelled'],
  queued: ['uploading', 'failed', 'cancelled'],
  uploading: ['running', 'failed', 'cancelled'],
  running: ['downloading', 'failed', 'cancelled'],
  downloading: ['archiving', 'failed', 'cancelled'],
  archiving: ['completed', 'failed'],
  completed: [],
  failed: ['queued', 'cancelled'],
  cancelled: ['queued'],
})

const ASSET_SLOT_DEFINITIONS = deepFreeze({
  character: {
    markerFile: '角色设定.md',
    slots: {
      turnaround: { directory: '三视图', label: '三视图', mediaKinds: ['image'] },
      costume: { directory: '定妆', label: '定妆', mediaKinds: ['image'] },
      reference: { directory: '参考图', label: '参考图', mediaKinds: ['image'] },
    },
  },
  scene: {
    markerFile: '场次.md',
    slots: {
      setting: { directory: '场景图', label: '场景图', mediaKinds: ['image'] },
      reference: { directory: '参考图', label: '参考图', mediaKinds: ['image'] },
      firstFrame: { directory: '首帧', label: '首帧', mediaKinds: ['image'] },
      lastFrame: { directory: '尾帧', label: '尾帧', mediaKinds: ['image'] },
      candidate: { directory: '候选', label: '候选', mediaKinds: ['image', 'video'] },
      final: { directory: '定稿', label: '定稿', mediaKinds: ['image', 'video'] },
      video: { directory: '成片', label: '成片', mediaKinds: ['video'] },
    },
  },
  location: {
    markerFile: '场景设定.md',
    slots: {
      setting: { directory: '场景图', label: '场景图', mediaKinds: ['image'] },
      reference: { directory: '参考图', label: '参考图', mediaKinds: ['image'] },
      candidate: { directory: '候选', label: '候选', mediaKinds: ['image', 'video'] },
      final: { directory: '定稿', label: '定稿', mediaKinds: ['image', 'video'] },
    },
  },
  shot: {
    markerFile: '镜头.md',
    slots: {
      reference: { directory: '参考图', label: '参考图', mediaKinds: ['image'] },
      firstFrame: { directory: '首帧', label: '首帧', mediaKinds: ['image'] },
      lastFrame: { directory: '尾帧', label: '尾帧', mediaKinds: ['image'] },
      candidate: { directory: '候选', label: '候选', mediaKinds: ['image', 'video'] },
      final: { directory: '定稿', label: '定稿', mediaKinds: ['image', 'video'] },
      video: { directory: '成片', label: '成片', mediaKinds: ['video'] },
    },
  },
})

export const COMFY_ASSET_SLOT_METADATA = cloneJson(ASSET_SLOT_DEFINITIONS)

const WORKFLOW_PRESETS = deepFreeze([
  {
    id: 'character-turnaround-v1',
    label: '人物三视图',
    // The first version is deliberately text-to-image. Reference-image
    // workflows can be added as separate presets once their API export exists.
    referenceImagesEnabled: false,
    defaults: { width: 1024, height: 1536 },
    output: { kind: 'image', targetSlots: [{ assetType: 'character', slot: 'turnaround' }] },
    inputs: standardImageInputs(),
    uploadRoles: [{ role: 'referenceImage', required: false, mediaKind: 'image' }],
  },
  {
    id: 'character-costume-v1',
    label: '人物定妆',
    referenceImagesEnabled: false,
    defaults: { width: 1024, height: 1536 },
    output: { kind: 'image', targetSlots: [{ assetType: 'character', slot: 'costume' }] },
    inputs: standardImageInputs(),
    uploadRoles: [{ role: 'referenceImage', required: false, mediaKind: 'image' }],
  },
  {
    id: 'scene-image-v1',
    label: '场景图',
    referenceImagesEnabled: false,
    defaults: { width: 1536, height: 864 },
    // 场景图资料槽本身就是候选池；人工从中标记一张“已选”作为场景参考。
    output: {
      kind: 'image',
      targetSlots: [
        { assetType: 'scene', slot: 'setting' },
        { assetType: 'location', slot: 'setting' },
      ],
    },
    inputs: standardImageInputs(),
    uploadRoles: [{ role: 'referenceImage', required: false, mediaKind: 'image' }],
  },
  {
    id: 'shot-image-v1',
    label: '镜头候选图',
    referenceImagesEnabled: false,
    defaults: { width: 1536, height: 864 },
    output: { kind: 'image', targetSlots: [{ assetType: 'shot', slot: 'candidate' }] },
    inputs: standardImageInputs(),
    uploadRoles: [
      { role: 'characterReference', required: false, mediaKind: 'image' },
      { role: 'sceneReference', required: false, mediaKind: 'image' },
      { role: 'referenceImage', required: false, mediaKind: 'image' },
    ],
  },
  {
    id: 'shot-first-frame-v1',
    label: '镜头首帧',
    referenceImagesEnabled: false,
    defaults: { width: 1536, height: 864 },
    output: { kind: 'image', targetSlots: [{ assetType: 'shot', slot: 'firstFrame' }] },
    inputs: standardImageInputs(),
    uploadRoles: [
      { role: 'characterReference', required: false, mediaKind: 'image' },
      { role: 'sceneReference', required: false, mediaKind: 'image' },
    ],
  },
  {
    id: 'shot-last-frame-v1',
    label: '镜头尾帧',
    referenceImagesEnabled: false,
    defaults: { width: 1536, height: 864 },
    output: { kind: 'image', targetSlots: [{ assetType: 'shot', slot: 'lastFrame' }] },
    inputs: standardImageInputs(),
    uploadRoles: [
      { role: 'firstFrame', required: false, mediaKind: 'image' },
      { role: 'characterReference', required: false, mediaKind: 'image' },
    ],
  },
  {
    id: 'shot-first-frame-img2img-v1',
    label: '镜头首帧（图生图）',
    referenceImagesEnabled: true,
    defaults: { width: 1536, height: 864, denoise: 0.65 },
    output: { kind: 'image', targetSlots: [{ assetType: 'shot', slot: 'firstFrame' }] },
    inputs: standardImageToImageInputs(),
    uploadRoles: [{ role: 'referenceImage', required: true, mediaKind: 'image' }],
  },
  {
    id: 'shot-last-frame-img2img-v1',
    label: '镜头尾帧（图生图）',
    referenceImagesEnabled: true,
    defaults: { width: 1536, height: 864, denoise: 0.65 },
    output: { kind: 'image', targetSlots: [{ assetType: 'shot', slot: 'lastFrame' }] },
    inputs: standardImageToImageInputs(),
    uploadRoles: [{ role: 'referenceImage', required: true, mediaKind: 'image' }],
  },
  {
    id: 'h3-first-last-video-v1',
    label: 'H3 首尾帧视频',
    // This preset consumes exactly two keyframes; a future reference-video
    // workflow should be introduced as a separate preset and mapping.
    referenceImagesEnabled: false,
    defaults: { durationSeconds: 5 },
    output: { kind: 'video', targetSlots: [{ assetType: 'shot', slot: 'candidate' }] },
    inputs: [
      { key: 'prompt', type: 'string', required: true, maxLength: 20_000 },
      // ComfyUI's RandomNoise node accepts an unsigned 64-bit seed. Keep the
      // local contract within JavaScript's safe-integer range so the value can
      // round-trip through JSON without precision loss.
      { key: 'seed', type: 'integer', required: false, minimum: -1, maximum: Number.MAX_SAFE_INTEGER },
      // Keep the raw graph's duration -> 24 fps -> 17k+5 alignment intact.
      { key: 'durationSeconds', type: 'number', required: false, minimum: 1, maximum: 60 },
    ],
    uploadRoles: [
      { role: 'firstFrame', required: true, mediaKind: 'image' },
      { role: 'lastFrame', required: true, mediaKind: 'image' },
    ],
  },
])

export const COMFY_WORKFLOW_PRESETS = cloneJson(WORKFLOW_PRESETS)

// Each cloud profile may override these bridge IDs. The local preset IDs stay
// stable even when a new ComfyUI server gives the workflow a different name.
const DEFAULT_BRIDGE_WORKFLOW_MAP = deepFreeze({
  'character-turnaround-v1': 'image-generate',
  'character-costume-v1': 'image-generate',
  'scene-image-v1': 'image-generate',
  'shot-image-v1': 'image-generate',
  'shot-first-frame-v1': 'image-generate',
  'shot-last-frame-v1': 'image-generate',
  'shot-first-frame-img2img-v1': 'image-to-image',
  'shot-last-frame-img2img-v1': 'image-to-image',
  'h3-first-last-video-v1': 'video-first-last',
})

const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mkv', '.mov', '.mp4', '.webm'])

export class ComfyCoreError extends Error {}
export class ComfyConfigurationError extends ComfyCoreError {}
export class ComfyJobError extends ComfyCoreError {}
export class ComfyArchiveError extends ComfyCoreError {}

function standardImageInputs() {
  return [
    { key: 'prompt', type: 'string', required: true, maxLength: 20_000 },
    { key: 'negativePrompt', type: 'string', required: false, maxLength: 20_000 },
    { key: 'width', type: 'integer', required: false, minimum: 64, maximum: 4096 },
    { key: 'height', type: 'integer', required: false, minimum: 64, maximum: 4096 },
    { key: 'seed', type: 'integer', required: false, minimum: -1, maximum: 2_147_483_647 },
  ]
}

function standardImageToImageInputs() {
  return [
    ...standardImageInputs(),
    { key: 'denoise', type: 'number', required: false, minimum: 0, maximum: 1 },
  ]
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isErrno(error, code) {
  return Boolean(error && typeof error === 'object' && error.code === code)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function assertRecord(value, message, ErrorType = ComfyCoreError) {
  if (!isRecord(value)) throw new ErrorType(message)
  return value
}

function assertNonEmptyString(value, message, ErrorType = ComfyCoreError, maximum = 20_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new ErrorType(message)
  }
  return value.trim()
}

function assertOptionalString(value, message, ErrorType = ComfyCoreError, maximum = 20_000) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > maximum) throw new ErrorType(message)
  return value
}

function assertBoolean(value, message, ErrorType = ComfyCoreError) {
  if (typeof value !== 'boolean') throw new ErrorType(message)
  return value
}

function assertInteger(value, message, ErrorType = ComfyCoreError, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ErrorType(message)
  }
  return value
}

function assertNumber(value, message, ErrorType = ComfyCoreError, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ErrorType(message)
  }
  return value
}

function assertIsoTimestamp(value, message, ErrorType = ComfyJobError) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ErrorType(message)
  }
  return value
}

function normalizeRelativePath(value, message, ErrorType = ComfyArchiveError) {
  const candidate = assertNonEmptyString(value, message, ErrorType, 1024)
  if (candidate.includes('\\') || candidate.includes('\u0000') || path.isAbsolute(candidate)) {
    throw new ErrorType(message)
  }
  const segments = candidate.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new ErrorType(message)
  }
  return segments.join('/')
}

function safePathSegments(relativePath, message, ErrorType = ComfyArchiveError) {
  return normalizeRelativePath(relativePath, message, ErrorType).split('/')
}

function safeWorkbenchInternalSegments(relativePath) {
  const candidate = assertNonEmptyString(relativePath, 'The requested workbench path is invalid.', ComfyArchiveError, 1024)
  if (candidate.includes('\\') || candidate.includes('\u0000') || path.isAbsolute(candidate)) {
    throw new ComfyArchiveError('The requested workbench path is invalid.')
  }
  const segments = candidate.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || (segment.startsWith('.') && segment !== '.workbench'))) {
    throw new ComfyArchiveError('The requested workbench path is invalid.')
  }
  return segments
}

function joinRelativePath(...segments) {
  return segments.filter(Boolean).join('/')
}

function toProjectRelative(root, absolutePath) {
  const relative = path.relative(root, absolutePath)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ComfyArchiveError('Archive output must stay inside the active project.')
  }
  return relative.split(path.sep).join('/')
}

function getSlotDefinition(assetType, slot) {
  const asset = ASSET_SLOT_DEFINITIONS[assetType]
  const definition = asset?.slots?.[slot]
  if (!definition) throw new ComfyArchiveError('The requested asset slot is not supported.')
  return definition
}

function normalizeAssetTarget(value) {
  const target = assertRecord(value, 'A Comfy job needs an archive target.', ComfyJobError)
  const assetType = assertNonEmptyString(target.assetType, 'The archive target asset type is required.', ComfyJobError, 32)
  if (!Object.hasOwn(ASSET_SLOT_DEFINITIONS, assetType)) {
    throw new ComfyJobError('The archive target asset type is not supported.')
  }
  const assetPath = normalizeRelativePath(target.assetPath, 'The archive target path is invalid.', ComfyJobError)
  const slot = assertNonEmptyString(target.slot, 'The archive target slot is required.', ComfyJobError, 64)
  const definition = getSlotDefinition(assetType, slot)
  const pathSegments = assetPath.split('/')

  if (assetType === 'character' && (pathSegments.length !== 2 || pathSegments[0] !== '主要人物')) {
    throw new ComfyJobError('Character output must target one direct child of 主要人物.')
  }
  if (assetType === 'scene' && (pathSegments.length !== 2 || pathSegments[0] !== '分镜')) {
    throw new ComfyJobError('Scene output must target one direct child of 分镜.')
  }
  if (assetType === 'location' && (pathSegments.length !== 2 || pathSegments[0] !== '场景')) {
    throw new ComfyJobError('Location output must target one direct child of 场景.')
  }
  if (assetType === 'shot' && (pathSegments.length !== 3 || pathSegments[0] !== '分镜')) {
    throw new ComfyJobError('Shot output must target a direct shot folder under 分镜.')
  }

  let lookPath
  if (target.lookPath !== undefined && target.lookPath !== null && target.lookPath !== '') {
    if (assetType !== 'character') {
      throw new ComfyJobError('Only character output may target a costume look.')
    }
    lookPath = normalizeRelativePath(target.lookPath, 'The character look path is invalid.', ComfyJobError)
    const expectedPrefix = `${assetPath}/造型/`
    if (!lookPath.startsWith(expectedPrefix) || lookPath.split('/').length !== 4) {
      throw new ComfyJobError('The character look must belong to the selected character asset.')
    }
  }

  return {
    assetType,
    assetPath,
    slot,
    ...(lookPath ? { lookPath } : {}),
    slotDirectory: definition.directory,
  }
}

function publicTarget(target) {
  const { slotDirectory, ...visible } = target
  return visible
}

function normalizeBridgeUrl(value) {
  const raw = assertOptionalString(value, 'The Comfy Bridge URL is invalid.', ComfyConfigurationError, 2_048).trim()
  if (!raw) return ''
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new ComfyConfigurationError('The Comfy Bridge URL is invalid.')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ComfyConfigurationError('The Comfy Bridge URL must be an http(s) base URL without credentials.')
  }
  return parsed.toString().replace(/\/+$/, '')
}

function normalizeProfile(value) {
  const profile = assertRecord(value, 'Each Comfy profile must be an object.', ComfyConfigurationError)
  const id = assertNonEmptyString(profile.id, 'A Comfy profile id is required.', ComfyConfigurationError, 64)
  if (!PROFILE_ID_PATTERN.test(id)) throw new ComfyConfigurationError('Comfy profile ids must use lowercase letters, numbers, and hyphens.')
  const name = assertNonEmptyString(profile.name, 'A Comfy profile name is required.', ComfyConfigurationError, 120)
  const enabled = profile.enabled === undefined ? false : assertBoolean(profile.enabled, 'Comfy profile enabled must be true or false.', ComfyConfigurationError)
  const bridgeUrl = normalizeBridgeUrl(profile.bridgeUrl)
  const token = assertOptionalString(profile.token, 'The Comfy Bridge token is invalid.', ComfyConfigurationError, 4_096)
  if (token && /\s/u.test(token)) throw new ComfyConfigurationError('The Comfy Bridge token cannot contain whitespace.')
  const requestTimeoutMs = profile.requestTimeoutMs === undefined
    ? 30_000
    : assertInteger(profile.requestTimeoutMs, 'Comfy request timeout must be between 1 and 600 seconds.', ComfyConfigurationError, 1_000, 600_000)
  const downloadTimeoutMs = profile.downloadTimeoutMs === undefined
    ? 30 * 60 * 1_000
    : assertInteger(profile.downloadTimeoutMs, 'Comfy download timeout must be between 10 seconds and 24 hours.', ComfyConfigurationError, 10_000, 24 * 60 * 60 * 1_000)
  const maxConcurrentJobs = profile.maxConcurrentJobs === undefined
    ? 1
    : assertInteger(profile.maxConcurrentJobs, 'Comfy concurrent jobs must be between 1 and 8.', ComfyConfigurationError, 1, 8)
  const workflowMap = normalizeWorkflowMap(profile.workflowMap)
  if (enabled && (!bridgeUrl || !token)) {
    throw new ComfyConfigurationError('An enabled Comfy profile needs both a Bridge URL and token.')
  }
  return { id, name, enabled, bridgeUrl, token, requestTimeoutMs, downloadTimeoutMs, maxConcurrentJobs, workflowMap }
}

function normalizeWorkflowMap(value) {
  if (value === undefined || value === null) return cloneJson(DEFAULT_BRIDGE_WORKFLOW_MAP)
  const rawMap = assertRecord(value, 'The Comfy workflow mapping must be an object.', ComfyConfigurationError)
  const map = { ...DEFAULT_BRIDGE_WORKFLOW_MAP }
  for (const [localWorkflowId, remoteWorkflowId] of Object.entries(rawMap)) {
    if (!WORKFLOW_PRESETS.some(preset => preset.id === localWorkflowId)) {
      throw new ComfyConfigurationError(`The Comfy workflow mapping contains an unknown local preset: ${localWorkflowId}.`)
    }
    const remoteId = assertNonEmptyString(remoteWorkflowId, 'A remote Comfy workflow id is invalid.', ComfyConfigurationError, 256)
    if (!REMOTE_ID_PATTERN.test(remoteId)) {
      throw new ComfyConfigurationError('Remote Comfy workflow ids may only use letters, numbers, dots, underscores, and hyphens.')
    }
    map[localWorkflowId] = remoteId
  }
  return map
}

function isRunnableProfile(profile) {
  return profile.enabled && Boolean(profile.bridgeUrl) && Boolean(profile.token)
}

export function getDefaultComfyConfigPath(options = {}) {
  const requestedHome = typeof options === 'string' ? options : options?.dshHome
  const stateHome = requestedHome ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  if (typeof stateHome !== 'string' || !stateHome.trim()) {
    throw new ComfyConfigurationError('The local DSH state directory is invalid.')
  }
  return path.join(path.resolve(stateHome), COMFY_CONFIG_FILE_NAME)
}

export function createDefaultComfyConfig() {
  return {
    version: COMFY_CONFIG_VERSION,
    activeProfile: COMFY_PLACEHOLDER_PROFILE_ID,
    // These are intentionally disabled. They make the two-server switch visible
    // from the first launch without ever attempting a network request.
    profiles: [
      {
        id: COMFY_PLACEHOLDER_PROFILE_ID,
        name: '云端 A（待配置）',
        enabled: false,
        bridgeUrl: '',
        token: '',
        requestTimeoutMs: 30_000,
        downloadTimeoutMs: 30 * 60 * 1_000,
        maxConcurrentJobs: 1,
      },
      {
        id: 'cloud-b',
        name: '云端 B（备用待配置）',
        enabled: false,
        bridgeUrl: '',
        token: '',
        requestTimeoutMs: 30_000,
        downloadTimeoutMs: 30 * 60 * 1_000,
        maxConcurrentJobs: 1,
      },
    ],
  }
}

export function validateComfyConfig(value) {
  const config = assertRecord(value, 'The Comfy configuration must be an object.', ComfyConfigurationError)
  if (config.version !== COMFY_CONFIG_VERSION) {
    throw new ComfyConfigurationError(`Unsupported Comfy configuration version: ${String(config.version)}.`)
  }
  if (!Array.isArray(config.profiles) || !config.profiles.length || config.profiles.length > 32) {
    throw new ComfyConfigurationError('The Comfy configuration must contain between 1 and 32 profiles.')
  }
  const profiles = config.profiles.map(normalizeProfile)
  const ids = new Set()
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new ComfyConfigurationError(`Duplicate Comfy profile id: ${profile.id}.`)
    ids.add(profile.id)
  }
  const activeProfile = assertNonEmptyString(config.activeProfile, 'The active Comfy profile is required.', ComfyConfigurationError, 64)
  if (!ids.has(activeProfile)) throw new ComfyConfigurationError('The active Comfy profile does not exist.')
  return { version: COMFY_CONFIG_VERSION, activeProfile, profiles }
}

function resolveConfigPath(options = {}) {
  const configPath = typeof options === 'string' ? options : options?.configPath
  if (configPath === undefined) return getDefaultComfyConfigPath()
  if (typeof configPath !== 'string' || !configPath.trim()) {
    throw new ComfyConfigurationError('The Comfy configuration path is invalid.')
  }
  return path.resolve(configPath)
}

async function assertSafeDirectory(directory, ErrorType = ComfyCoreError) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await fs.lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new ErrorType('A local workbench directory cannot be a symbolic link.')
  }
  // mkdir() honors an existing directory's mode. Workbench state can include
  // prompts and local server configuration, so repair permissive prior modes.
  await fs.chmod(directory, 0o700)
  return directory
}

async function readPrivateJson(filePath, maximumBytes, ErrorType, missingValue) {
  try {
    const info = await fs.lstat(filePath)
    if (!info.isFile() || info.isSymbolicLink()) throw new ErrorType('A local workbench data file cannot be a symbolic link.')
    if (info.size > maximumBytes) throw new ErrorType('A local workbench data file is too large.')
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return missingValue
    if (error instanceof ErrorType) throw error
    if (error instanceof SyntaxError) throw new ErrorType('The local workbench data file is not valid JSON.')
    throw error
  }
}

async function writePrivateJson(filePath, value, { overwrite, ErrorType = ComfyCoreError }) {
  const directory = await assertSafeDirectory(path.dirname(filePath), ErrorType)
  try {
    const existing = await fs.lstat(filePath)
    if (existing.isSymbolicLink()) throw new ErrorType('A local workbench data file cannot be a symbolic link.')
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error
  }

  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    if (overwrite) {
      await fs.rename(temporaryPath, filePath)
    } else {
      // link() publishes the fully-written file without replacing an existing job record.
      await fs.link(temporaryPath, filePath)
    }
    await fs.chmod(filePath, 0o600)
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function loadComfyConfig(options = {}) {
  const configPath = resolveConfigPath(options)
  const value = await readPrivateJson(configPath, MAX_CONFIG_BYTES, ComfyConfigurationError, undefined)
  return value === undefined ? createDefaultComfyConfig() : validateComfyConfig(value)
}

export async function saveComfyConfig(config, options = {}) {
  const normalized = validateComfyConfig(config)
  await writePrivateJson(resolveConfigPath(options), normalized, { overwrite: true, ErrorType: ComfyConfigurationError })
  return cloneJson(normalized)
}

export function listComfyProfiles(config) {
  const normalized = validateComfyConfig(config)
  return normalized.profiles.map(profile => ({
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    bridgeUrl: profile.bridgeUrl,
    hasToken: Boolean(profile.token),
    requestTimeoutMs: profile.requestTimeoutMs,
    downloadTimeoutMs: profile.downloadTimeoutMs,
    maxConcurrentJobs: profile.maxConcurrentJobs,
    workflowMap: cloneJson(profile.workflowMap),
    isActive: profile.id === normalized.activeProfile,
  }))
}

export function getPublicComfyConfig(config) {
  const normalized = validateComfyConfig(config)
  return { version: normalized.version, activeProfile: normalized.activeProfile, profiles: listComfyProfiles(normalized) }
}

export function getComfyProfile(config, profileId = undefined) {
  const normalized = validateComfyConfig(config)
  const requestedId = profileId ?? normalized.activeProfile
  if (typeof requestedId !== 'string') throw new ComfyConfigurationError('The requested Comfy profile id is invalid.')
  const profile = normalized.profiles.find(candidate => candidate.id === requestedId)
  if (!profile) throw new ComfyConfigurationError('The requested Comfy profile does not exist.')
  return cloneJson(profile)
}

export function getRunnableComfyProfile(config, profileId = undefined) {
  const profile = getComfyProfile(config, profileId)
  if (!isRunnableProfile(profile)) {
    throw new ComfyConfigurationError('Configure and enable a Comfy Bridge profile before submitting a job.')
  }
  return profile
}

export function upsertComfyProfile(config, profile) {
  const normalized = validateComfyConfig(config)
  const nextProfile = normalizeProfile(profile)
  const existingIndex = normalized.profiles.findIndex(candidate => candidate.id === nextProfile.id)
  const profiles = [...normalized.profiles]
  if (existingIndex >= 0) profiles.splice(existingIndex, 1, nextProfile)
  else {
    if (profiles.length >= 32) throw new ComfyConfigurationError('A maximum of 32 Comfy profiles is supported.')
    profiles.push(nextProfile)
  }
  return validateComfyConfig({ ...normalized, profiles })
}

export function setActiveComfyProfile(config, profileId) {
  const normalized = validateComfyConfig(config)
  const id = assertNonEmptyString(profileId, 'The active Comfy profile id is required.', ComfyConfigurationError, 64)
  if (!normalized.profiles.some(profile => profile.id === id)) {
    throw new ComfyConfigurationError('The requested Comfy profile does not exist.')
  }
  return { ...normalized, activeProfile: id }
}

export async function activateComfyProfile(profileId, options = {}) {
  const config = await loadComfyConfig(options)
  const nextConfig = setActiveComfyProfile(config, profileId)
  return saveComfyConfig(nextConfig, options)
}

export function getComfyWorkflowPreset(workflowId) {
  const id = assertNonEmptyString(workflowId, 'A Comfy workflow id is required.', ComfyJobError, 128)
  const preset = WORKFLOW_PRESETS.find(candidate => candidate.id === id)
  if (!preset) throw new ComfyJobError(`The Comfy workflow preset is not supported: ${id}.`)
  return cloneJson(preset)
}

export function getComfyWorkflowPresets() {
  return WORKFLOW_PRESETS.map(preset => {
    const targets = preset.output.targetSlots.map(target => {
      const slot = getSlotDefinition(target.assetType, target.slot)
      return { ...target, outputSlotLabel: slot.label }
    })
    const firstTarget = targets[0]
    return {
      id: preset.id,
      label: preset.label,
      description: `受控${preset.output.kind === 'video' ? '视频' : '图片'}工作流：${preset.label}。`,
      assetTypes: [...new Set(targets.map(target => target.assetType))],
      outputSlot: firstTarget.slot,
      outputSlotLabel: firstTarget.outputSlotLabel,
      outputKind: preset.output.kind,
      outputTargets: targets,
      defaults: {
        ...cloneJson(preset.defaults ?? {}),
        ...(preset.inputs.some(input => input.key === 'negativePrompt') ? { negativePrompt: '' } : {}),
      },
      inputs: cloneJson(preset.inputs),
      uploadRoles: cloneJson(preset.uploadRoles),
      referenceImagesEnabled: Boolean(preset.referenceImagesEnabled),
    }
  })
}

function normalizeWorkflowInputs(preset, value) {
  const inputs = assertRecord(value ?? {}, 'Comfy workflow inputs must be an object.', ComfyJobError)
  const definitions = new Map(preset.inputs.map(definition => [definition.key, definition]))
  const normalized = {}
  for (const key of Object.keys(inputs)) {
    // Older H3 job records were allowed to persist a negativePrompt field,
    // even though MiniMaxH3ImageToVideo has no negative-prompt input. Drop it
    // during validation so queued/recovered jobs remain runnable after the
    // preset contract is corrected.
    if (preset.id === 'h3-first-last-video-v1' && key === 'negativePrompt') continue
    const definition = definitions.get(key)
    if (!definition) throw new ComfyJobError(`The ${preset.id} workflow does not accept input: ${key}.`)
    const input = inputs[key]
    if (definition.type === 'string') {
      if (typeof input !== 'string' || input.length > definition.maxLength) {
        throw new ComfyJobError(`The ${key} workflow input must be a string.`)
      }
      normalized[key] = input
    } else if (definition.type === 'integer') {
      const integer = assertInteger(input, `The ${key} workflow input must be an integer.`, ComfyJobError, definition.minimum, definition.maximum)
      normalized[key] = integer
    } else if (definition.type === 'number') {
      normalized[key] = assertNumber(input, `The ${key} workflow input must be a finite number.`, ComfyJobError, definition.minimum, definition.maximum)
    } else {
      throw new ComfyJobError(`The ${preset.id} workflow contains an unsupported input type.`)
    }
  }
  for (const definition of preset.inputs) {
    if (definition.required && !(definition.key in normalized)) {
      throw new ComfyJobError(`The ${preset.id} workflow requires input: ${definition.key}.`)
    }
  }
  return normalized
}

function validateSafeFileName(value, ErrorType = ComfyJobError) {
  const fileName = assertNonEmptyString(value, 'A media file name is required.', ErrorType, 255)
  if (fileName !== path.basename(fileName) || fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..' || /[\u0000-\u001f]/u.test(fileName)) {
    throw new ErrorType('The media file name is invalid.')
  }
  return fileName
}

function normalizeUploads(preset, value) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 32) throw new ComfyJobError('Comfy uploads must be a list of at most 32 files.')
  const allowedRoles = new Map(preset.uploadRoles.map(definition => [definition.role, definition]))
  const roles = new Set()
  return value.map(upload => {
    const candidate = assertRecord(upload, 'Each Comfy upload must be an object.', ComfyJobError)
    const role = assertNonEmptyString(candidate.role, 'Each Comfy upload needs a role.', ComfyJobError, 128)
    if (!allowedRoles.has(role)) throw new ComfyJobError(`The ${preset.id} workflow does not accept upload role: ${role}.`)
    if (roles.has(role)) throw new ComfyJobError(`The ${role} upload role may only be supplied once.`)
    roles.add(role)
    const sourcePath = candidate.sourcePath === undefined ? undefined : normalizeRelativePath(candidate.sourcePath, 'The upload source path is invalid.', ComfyJobError)
    const uploadId = candidate.uploadId === undefined ? undefined : assertRemoteId(candidate.uploadId, 'The upload id is invalid.', ComfyJobError)
    const fileName = candidate.fileName === undefined ? undefined : validateSafeFileName(candidate.fileName, ComfyJobError)
    if (!sourcePath && !uploadId) throw new ComfyJobError('Each Comfy upload needs a project source path or a remote upload id.')
    return { role, ...(sourcePath ? { sourcePath } : {}), ...(uploadId ? { uploadId } : {}), ...(fileName ? { fileName } : {}) }
  })
}

function assertPresetAllowsTarget(preset, target) {
  const allowed = preset.output.targetSlots.some(candidate => candidate.assetType === target.assetType && candidate.slot === target.slot)
  if (!allowed) {
    throw new ComfyJobError(`The ${preset.id} workflow cannot archive output to this asset slot.`)
  }
  const slot = getSlotDefinition(target.assetType, target.slot)
  if (!slot.mediaKinds.includes(preset.output.kind)) {
    throw new ComfyJobError('The requested asset slot does not accept this workflow output kind.')
  }
}

function assertRemoteId(value, message, ErrorType = ComfyJobError) {
  const id = assertNonEmptyString(value, message, ErrorType, 256)
  if (!REMOTE_ID_PATTERN.test(id)) throw new ErrorType(message)
  return id
}

function normalizeRemote(value) {
  if (value === undefined || value === null) return undefined
  const remote = assertRecord(value, 'The Comfy remote job state is invalid.', ComfyJobError)
  const bridgeJobId = remote.bridgeJobId === undefined ? undefined : assertRemoteId(remote.bridgeJobId, 'The Bridge job id is invalid.', ComfyJobError)
  const progress = remote.progress === undefined ? undefined : assertProgress(remote.progress)
  const submittedAt = remote.submittedAt === undefined ? undefined : assertIsoTimestamp(remote.submittedAt, 'The remote submitted timestamp is invalid.')
  const updatedAt = remote.updatedAt === undefined ? undefined : assertIsoTimestamp(remote.updatedAt, 'The remote update timestamp is invalid.')
  const status = remote.status === undefined ? undefined : assertNonEmptyString(remote.status, 'The remote status is invalid.', ComfyJobError, 120)
  return {
    ...(bridgeJobId ? { bridgeJobId } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(submittedAt ? { submittedAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(status ? { status } : {}),
  }
}

function assertProgress(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ComfyJobError('Comfy job progress must be between 0 and 1.')
  }
  return value
}

function normalizeArchiveOutput(value, target = undefined) {
  const output = assertRecord(value, 'A Comfy archive output is invalid.', ComfyJobError)
  const fileName = validateSafeFileName(output.fileName, ComfyJobError)
  const outputPath = normalizeRelativePath(output.path, 'The archived output path is invalid.', ComfyJobError)
  const bytes = assertInteger(output.bytes, 'The archived output size is invalid.', ComfyJobError, 1, COMFY_MAX_OUTPUT_FILE_BYTES)
  const sha256 = assertNonEmptyString(output.sha256, 'The archived output checksum is invalid.', ComfyJobError, 128)
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new ComfyJobError('The archived output checksum is invalid.')
  const kind = output.kind
  if (kind !== 'image' && kind !== 'video') throw new ComfyJobError('The archived output media kind is invalid.')
  const remoteFileName = output.remoteFileName === undefined || output.remoteFileName === null
    ? undefined
    : validateSafeFileName(output.remoteFileName, ComfyJobError)
  if (target) {
    const slot = getSlotDefinition(target.assetType, target.slot)
    const prefix = `${target.lookPath ?? target.assetPath}/${slot.directory}/`
    if (!outputPath.startsWith(prefix)) throw new ComfyJobError('The archived output must stay inside its target asset slot.')
  }
  return { fileName, path: outputPath, bytes, sha256, kind, ...(remoteFileName ? { remoteFileName } : {}) }
}

function normalizeJobHistory(value, initialStatus, createdAt) {
  if (value === undefined) return [{ status: initialStatus, at: createdAt }]
  if (!Array.isArray(value) || !value.length || value.length > MAX_JOB_HISTORY_ENTRIES) {
    throw new ComfyJobError('The Comfy job history is invalid.')
  }
  return value.map(entry => {
    const item = assertRecord(entry, 'The Comfy job history is invalid.', ComfyJobError)
    const status = assertNonEmptyString(item.status, 'The Comfy job history status is invalid.', ComfyJobError, 32)
    if (!COMFY_JOB_STATUSES.includes(status)) throw new ComfyJobError('The Comfy job history status is invalid.')
    const at = assertIsoTimestamp(item.at, 'The Comfy job history timestamp is invalid.')
    const message = item.message === undefined ? undefined : assertNonEmptyString(item.message, 'The Comfy job history message is invalid.', ComfyJobError, 500)
    return { status, at, ...(message ? { message } : {}) }
  })
}

function normalizeJobError(value) {
  if (value === undefined || value === null) return undefined
  const error = assertRecord(value, 'The Comfy job error is invalid.', ComfyJobError)
  const message = assertNonEmptyString(error.message, 'The Comfy job error message is invalid.', ComfyJobError, MAX_JOB_ERROR_MESSAGE_CHARS)
  const code = error.code === undefined ? undefined : assertNonEmptyString(error.code, 'The Comfy job error code is invalid.', ComfyJobError, 120)
  const at = error.at === undefined ? undefined : assertIsoTimestamp(error.at, 'The Comfy job error timestamp is invalid.')
  return { message, ...(code ? { code } : {}), ...(at ? { at } : {}) }
}

export function validateComfyJob(value) {
  const job = assertRecord(value, 'The Comfy job must be an object.', ComfyJobError)
  if (job.version !== COMFY_JOB_VERSION) {
    throw new ComfyJobError(`Unsupported Comfy job version: ${String(job.version)}.`)
  }
  const id = assertNonEmptyString(job.id, 'The Comfy job id is required.', ComfyJobError, 128)
  if (!JOB_ID_PATTERN.test(id)) throw new ComfyJobError('The Comfy job id is invalid.')
  const status = assertNonEmptyString(job.status, 'The Comfy job status is required.', ComfyJobError, 32)
  if (!COMFY_JOB_STATUSES.includes(status)) throw new ComfyJobError('The Comfy job status is invalid.')
  const createdAt = assertIsoTimestamp(job.createdAt, 'The Comfy job creation time is invalid.')
  const updatedAt = assertIsoTimestamp(job.updatedAt, 'The Comfy job update time is invalid.')
  const profileId = assertNonEmptyString(job.profileId, 'The Comfy job profile id is required.', ComfyJobError, 64)
  if (!PROFILE_ID_PATTERN.test(profileId)) throw new ComfyJobError('The Comfy job profile id is invalid.')
  const preset = getComfyWorkflowPreset(job.workflowId)
  const target = normalizeAssetTarget(job.target)
  assertPresetAllowsTarget(preset, target)
  const inputs = normalizeWorkflowInputs(preset, job.inputs)
  const uploads = normalizeUploads(preset, job.uploads)
  const progress = job.progress === undefined ? 0 : assertProgress(job.progress)
  const remote = normalizeRemote(job.remote)
  const outputs = job.outputs === undefined
    ? []
    : (() => {
      if (!Array.isArray(job.outputs) || job.outputs.length > 100) throw new ComfyJobError('The Comfy job outputs are invalid.')
      return job.outputs.map(output => normalizeArchiveOutput(output, target))
    })()
  const history = normalizeJobHistory(job.history, status, createdAt)
  const error = normalizeJobError(job.error)
  return {
    version: COMFY_JOB_VERSION,
    id,
    status,
    createdAt,
    updatedAt,
    profileId,
    workflowId: preset.id,
    inputs,
    uploads,
    target: publicTarget(target),
    progress,
    ...(remote && Object.keys(remote).length ? { remote } : {}),
    outputs,
    history,
    ...(error ? { error } : {}),
  }
}

export function createComfyJob(input) {
  const value = assertRecord(input, 'The Comfy job input must be an object.', ComfyJobError)
  const now = value.now === undefined ? new Date().toISOString() : assertIsoTimestamp(value.now, 'The Comfy job creation time is invalid.')
  const status = value.status === undefined ? 'queued' : value.status
  return validateComfyJob({
    version: COMFY_JOB_VERSION,
    id: value.id ?? `job_${randomUUID()}`,
    status,
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? now,
    profileId: value.profileId,
    workflowId: value.workflowId,
    inputs: value.inputs ?? {},
    uploads: value.uploads ?? [],
    target: value.target,
    progress: value.progress ?? 0,
    remote: value.remote,
    outputs: value.outputs ?? [],
    history: value.history,
    error: value.error,
  })
}

function patchComfyJob(job, patch, nextStatus = undefined) {
  const existing = validateComfyJob(job)
  const changes = assertRecord(patch ?? {}, 'The Comfy job update is invalid.', ComfyJobError)
  if (Object.hasOwn(changes, 'status')) throw new ComfyJobError('Use a status transition to change a Comfy job status.')
  const now = new Date().toISOString()
  const status = nextStatus ?? existing.status
  const history = nextStatus
    ? [...existing.history, { status: nextStatus, at: now, ...(changes.message ? { message: assertNonEmptyString(changes.message, 'The Comfy job history message is invalid.', ComfyJobError, 500) } : {}) }].slice(-MAX_JOB_HISTORY_ENTRIES)
    : existing.history
  const candidate = {
    ...existing,
    status,
    updatedAt: now,
    progress: changes.progress === undefined ? existing.progress : changes.progress,
    remote: changes.remote === undefined ? existing.remote : changes.remote,
    uploads: changes.uploads === undefined ? existing.uploads : changes.uploads,
    outputs: changes.outputs === undefined ? existing.outputs : changes.outputs,
    error: changes.error === undefined ? existing.error : changes.error,
    history,
  }
  if (nextStatus && nextStatus !== 'failed' && changes.error === undefined) delete candidate.error
  return validateComfyJob(candidate)
}

export function transitionComfyJob(job, nextStatus, patch = {}) {
  const existing = validateComfyJob(job)
  if (typeof nextStatus !== 'string' || !COMFY_JOB_STATUSES.includes(nextStatus)) {
    throw new ComfyJobError('The next Comfy job status is invalid.')
  }
  if (!JOB_TRANSITIONS[existing.status].includes(nextStatus)) {
    throw new ComfyJobError(`A Comfy job cannot transition from ${existing.status} to ${nextStatus}.`)
  }
  return patchComfyJob(existing, patch, nextStatus)
}

export function updateComfyJob(job, patch = {}) {
  return patchComfyJob(job, patch)
}

function jobFileName(id) {
  const safeId = assertNonEmptyString(id, 'The Comfy job id is invalid.', ComfyJobError, 128)
  if (!JOB_ID_PATTERN.test(safeId)) throw new ComfyJobError('The Comfy job id is invalid.')
  return `${safeId}.json`
}

async function getVerifiedProjectRoot(projectRoot) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw new ComfyArchiveError('The active project root is invalid.')
  }
  let root
  try {
    root = await fs.realpath(projectRoot)
  } catch {
    throw new ComfyArchiveError('The active project root is unavailable.')
  }
  const info = await fs.lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new ComfyArchiveError('The active project root must be a real directory.')
  return root
}

async function resolveSecureDirectory(root, relativePath, { create = false, allowWorkbenchInternal = false } = {}) {
  const segments = allowWorkbenchInternal
    ? safeWorkbenchInternalSegments(relativePath)
    : safePathSegments(relativePath, 'The requested workbench path is invalid.')
  let current = root
  for (const segment of segments) {
    const candidate = path.join(current, segment)
    try {
      const info = await fs.lstat(candidate)
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new ComfyArchiveError('Comfy paths cannot traverse symbolic links or non-directory entries.')
      }
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error
      if (!create) throw new ComfyArchiveError('The requested project asset no longer exists.')
      await fs.mkdir(candidate, { mode: 0o700 })
      const created = await fs.lstat(candidate)
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new ComfyArchiveError('Comfy paths cannot traverse symbolic links or non-directory entries.')
      }
    }
    current = candidate
  }
  return current
}

async function assertRegularMarker(directory, fileName) {
  const markerPath = path.join(directory, fileName)
  try {
    const info = await fs.lstat(markerPath)
    if (!info.isFile() || info.isSymbolicLink()) throw new ComfyArchiveError('The archive target is not a recognized workbench asset.')
  } catch (error) {
    if (isErrno(error, 'ENOENT')) throw new ComfyArchiveError('The archive target is not a recognized workbench asset.')
    throw error
  }
}

export async function resolveComfyArchiveTarget(projectRoot, target) {
  const root = await getVerifiedProjectRoot(projectRoot)
  const normalized = normalizeAssetTarget(target)
  const assetRelativePath = normalized.lookPath ?? normalized.assetPath
  const assetDirectory = await resolveSecureDirectory(root, assetRelativePath)
  const markerFile = normalized.lookPath ? '造型设定.md' : ASSET_SLOT_DEFINITIONS[normalized.assetType].markerFile
  await assertRegularMarker(assetDirectory, markerFile)
  const slotDirectory = await resolveSecureDirectory(root, joinRelativePath(assetRelativePath, normalized.slotDirectory), { create: true })
  return {
    root,
    target: publicTarget(normalized),
    assetDirectory,
    slotDirectory,
    relativeSlotPath: joinRelativePath(assetRelativePath, normalized.slotDirectory),
  }
}

function getMediaKind(fileName, ErrorType = ComfyArchiveError) {
  const extension = path.extname(fileName).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return { extension, kind: 'image' }
  if (VIDEO_EXTENSIONS.has(extension)) return { extension, kind: 'video' }
  throw new ErrorType('Comfy output must use a supported image or video extension.')
}

function sanitizeFileStem(value, fallback) {
  const text = String(value ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/gu, '')
  return text.slice(0, 72) || fallback
}

export function formatComfyOutputFileName(job, remoteFileName, index = 1) {
  const normalized = validateComfyJob(job)
  const safeRemoteName = validateSafeFileName(remoteFileName, ComfyArchiveError)
  const media = getMediaKind(safeRemoteName, ComfyArchiveError)
  const preset = getComfyWorkflowPreset(normalized.workflowId)
  if (media.kind !== preset.output.kind) {
    throw new ComfyArchiveError('The output file extension does not match the workflow output type.')
  }
  const target = normalizeAssetTarget(normalized.target)
  const slot = getSlotDefinition(target.assetType, target.slot)
  const sequence = assertInteger(index, 'The output sequence is invalid.', ComfyArchiveError, 1, 9_999)
  const assetName = sanitizeFileStem(path.basename(target.lookPath ?? target.assetPath), 'asset')
  const workflowName = sanitizeFileStem(preset.label, 'comfy')
  const jobSuffix = normalized.id.replace(/^job_/u, '').slice(0, 12)
  const seedSuffix = Number.isSafeInteger(normalized.inputs.seed) ? `-seed${normalized.inputs.seed}` : ''
  return `${String(sequence).padStart(2, '0')}-${assetName}-${workflowName}-${slot.label}-${jobSuffix}${seedSuffix}${media.extension}`
}

async function writeBufferFully(handle, buffer) {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset)
    if (!bytesWritten) throw new ComfyArchiveError('The Comfy output stream stopped while writing.')
    offset += bytesWritten
  }
}

function isAsyncIterable(value) {
  return value && typeof value[Symbol.asyncIterator] === 'function'
}

function normalizeExpectedArchiveIntegrity({ expectedBytes, expectedSha256 } = {}) {
  const bytes = expectedBytes === undefined
    ? undefined
    : assertInteger(expectedBytes, 'The expected Comfy output size is invalid.', ComfyArchiveError, 1, COMFY_MAX_OUTPUT_FILE_BYTES)
  const sha256 = expectedSha256 === undefined || expectedSha256 === null || expectedSha256 === ''
    ? undefined
    : assertNonEmptyString(expectedSha256, 'The expected Comfy output checksum is invalid.', ComfyArchiveError, 128).toLowerCase()
  if (sha256 && !/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new ComfyArchiveError('The expected Comfy output checksum is invalid.')
  }
  return { bytes, sha256 }
}

async function writeArchiveData(handle, value, expected = {}) {
  const hash = createHash('sha256')
  let bytes = 0
  const writeChunk = async chunk => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (!buffer.length) return
    bytes += buffer.byteLength
    if (bytes > COMFY_MAX_OUTPUT_FILE_BYTES) throw new ComfyArchiveError('Comfy output exceeds the 2 GB per-file archive limit.')
    if (expected.bytes !== undefined && bytes > expected.bytes) {
      throw new ComfyArchiveError('The downloaded Comfy output is larger than the size declared by the Bridge.')
    }
    hash.update(buffer)
    await writeBufferFully(handle, buffer)
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    await writeChunk(value)
  } else if (isAsyncIterable(value)) {
    for await (const chunk of value) await writeChunk(chunk)
  } else {
    throw new ComfyArchiveError('Comfy output must be a Buffer, Uint8Array, or async byte stream.')
  }
  if (!bytes) throw new ComfyArchiveError('Comfy output cannot be empty.')
  const sha256 = hash.digest('hex')
  if (expected.bytes !== undefined && bytes !== expected.bytes) {
    throw new ComfyArchiveError('The downloaded Comfy output size does not match the Bridge declaration.')
  }
  if (expected.sha256 !== undefined && sha256 !== expected.sha256) {
    throw new ComfyArchiveError('The downloaded Comfy output checksum does not match the Bridge declaration.')
  }
  return { bytes, sha256 }
}

async function archiveFileMatchesIntegrity(filePath, expected) {
  if (expected.bytes === undefined || expected.sha256 === undefined) return false
  let info
  try {
    info = await fs.lstat(filePath)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes) return false
  const handle = await fs.open(filePath, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (position < info.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, info.size - position), position)
      if (!bytesRead) return false
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex') === expected.sha256
  } finally {
    await handle.close()
  }
}

async function publishArchiveFile(temporaryPath, slotDirectory, job, remoteFileName, expected, outputIndex = undefined) {
  const indexes = outputIndex === undefined
    ? Array.from({ length: 9_999 }, (_unused, index) => index + 1)
    : [assertInteger(outputIndex, 'The output sequence is invalid.', ComfyArchiveError, 1, 9_999)]
  for (const index of indexes) {
    const fileName = formatComfyOutputFileName(job, remoteFileName, index)
    const targetPath = path.join(slotDirectory, fileName)
    try {
      await fs.link(temporaryPath, targetPath)
      return { fileName, targetPath, reused: false }
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error
      if (await archiveFileMatchesIntegrity(targetPath, expected)) {
        return { fileName, targetPath, reused: true }
      }
      if (outputIndex !== undefined) {
        throw new ComfyArchiveError('An unrelated file already occupies this Comfy output sequence.')
      }
    }
  }
  throw new ComfyArchiveError('No available archive filename remains in the target slot.')
}

export async function archiveComfyOutput({ projectRoot, job, remoteFileName, data, expectedBytes = undefined, expectedSha256 = undefined, outputIndex = undefined }) {
  const normalizedJob = validateComfyJob(job)
  const target = normalizeAssetTarget(normalizedJob.target)
  const preset = getComfyWorkflowPreset(normalizedJob.workflowId)
  assertPresetAllowsTarget(preset, target)
  const safeRemoteName = validateSafeFileName(remoteFileName, ComfyArchiveError)
  const media = getMediaKind(safeRemoteName, ComfyArchiveError)
  if (media.kind !== preset.output.kind) {
    throw new ComfyArchiveError('The output file extension does not match the workflow output type.')
  }
  const archiveTarget = await resolveComfyArchiveTarget(projectRoot, target)
  const expected = normalizeExpectedArchiveIntegrity({ expectedBytes, expectedSha256 })
  const temporaryPath = path.join(archiveTarget.slotDirectory, `.${normalizedJob.id}.${randomUUID()}.part`)
  let handle
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600)
    const written = await writeArchiveData(handle, data, expected)
    await handle.sync()
    await handle.close()
    handle = undefined
    const published = await publishArchiveFile(
      temporaryPath,
      archiveTarget.slotDirectory,
      normalizedJob,
      safeRemoteName,
      expected,
      outputIndex,
    )
    return {
      fileName: published.fileName,
      path: toProjectRelative(archiveTarget.root, published.targetPath),
      bytes: written.bytes,
      sha256: written.sha256,
      kind: media.kind,
      remoteFileName: safeRemoteName,
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function bridgeEndpoint(profile, suffix) {
  const base = `${profile.bridgeUrl.replace(/\/+$/, '')}/`
  return new URL(suffix.replace(/^\/+/, ''), base)
}

function bridgeHeaders(profile, contentType = undefined) {
  return {
    authorization: `Bearer ${profile.token}`,
    ...(contentType ? { 'content-type': contentType } : {}),
  }
}

function assertRunnableProfileInput(profile) {
  const normalized = normalizeProfile(profile)
  if (!isRunnableProfile(normalized)) {
    throw new ComfyConfigurationError('Configure and enable a Comfy Bridge profile before submitting a job.')
  }
  return normalized
}

export function createComfyBridgeUploadRequest(profile, { fileName, body }) {
  const runnable = assertRunnableProfileInput(profile)
  const safeFileName = validateSafeFileName(fileName, ComfyConfigurationError)
  const url = bridgeEndpoint(runnable, 'uploads')
  url.searchParams.set('name', safeFileName)
  return { url: url.toString(), method: 'POST', headers: bridgeHeaders(runnable, 'application/octet-stream'), body }
}

export function createComfyBridgeJobRequest(profile, job) {
  const runnable = assertRunnableProfileInput(profile)
  const normalizedJob = validateComfyJob(job)
  if (normalizedJob.profileId !== runnable.id) {
    throw new ComfyConfigurationError('The selected Comfy profile does not match the queued job profile.')
  }
  const preset = getComfyWorkflowPreset(normalizedJob.workflowId)
  const uploads = normalizedJob.uploads.map(upload => {
    if (!upload.uploadId) throw new ComfyJobError(`Upload role ${upload.role} has not been sent to the Comfy Bridge yet.`)
    return { role: upload.role, uploadId: upload.uploadId }
  })
  for (const definition of preset.uploadRoles) {
    if (definition.required && !uploads.some(upload => upload.role === definition.role)) {
      throw new ComfyJobError(`The ${preset.id} workflow requires upload role: ${definition.role}.`)
    }
  }
  return {
    url: bridgeEndpoint(runnable, 'jobs').toString(),
    method: 'POST',
    headers: bridgeHeaders(runnable, 'application/json'),
    body: {
      workflowId: runnable.workflowMap[preset.id],
      inputs: normalizedJob.inputs,
      uploads,
      clientJobId: normalizedJob.id,
    },
  }
}

export function createComfyBridgePollRequest(profile, bridgeJobId) {
  const runnable = assertRunnableProfileInput(profile)
  const id = assertRemoteId(bridgeJobId, 'The Bridge job id is invalid.', ComfyConfigurationError)
  return { url: bridgeEndpoint(runnable, `jobs/${encodeURIComponent(id)}`).toString(), method: 'GET', headers: bridgeHeaders(runnable) }
}

export function createComfyBridgeDownloadRequest(profile, bridgeJobId, fileName) {
  const runnable = assertRunnableProfileInput(profile)
  const id = assertRemoteId(bridgeJobId, 'The Bridge job id is invalid.', ComfyConfigurationError)
  const safeFileName = validateSafeFileName(fileName, ComfyConfigurationError)
  return {
    url: bridgeEndpoint(runnable, `jobs/${encodeURIComponent(id)}/outputs/${encodeURIComponent(safeFileName)}`).toString(),
    method: 'GET',
    headers: bridgeHeaders(runnable),
  }
}

export function createComfyJobStore(projectRoot) {
  let rootPromise
  const root = async () => {
    rootPromise ??= getVerifiedProjectRoot(projectRoot)
    return rootPromise
  }
  const jobsDirectory = async () => resolveSecureDirectory(await root(), '.workbench/jobs', { create: true, allowWorkbenchInternal: true })
  const jobPath = async id => path.join(await jobsDirectory(), jobFileName(id))

  const get = async id => {
    const filePath = await jobPath(id)
    const job = await readPrivateJson(filePath, MAX_JOB_BYTES, ComfyJobError, undefined)
    if (job === undefined) throw new ComfyJobError('The Comfy job does not exist.')
    const normalized = validateComfyJob(job)
    if (normalized.id !== id) throw new ComfyJobError('The Comfy job record id does not match its filename.')
    return normalized
  }

  const save = async (job, { create = false } = {}) => {
    const normalized = validateComfyJob(job)
    const filePath = await jobPath(normalized.id)
    await writePrivateJson(filePath, normalized, { overwrite: !create, ErrorType: ComfyJobError })
    return normalized
  }

  return {
    async directory() {
      return jobsDirectory()
    },
    async create(input) {
      const job = createComfyJob(input)
      return save(job, { create: true })
    },
    get,
    async list() {
      const directory = await jobsDirectory()
      const entries = await fs.readdir(directory, { withFileTypes: true })
      const jobs = []
      for (const entry of entries) {
        if (!entry.name.endsWith('.json') || !JOB_ID_PATTERN.test(entry.name.slice(0, -5))) continue
        if (!entry.isFile() || entry.isSymbolicLink()) throw new ComfyJobError('A Comfy job record cannot be a symbolic link.')
        jobs.push(await get(entry.name.slice(0, -5)))
      }
      return jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
    },
    save,
    async update(id, patch = {}) {
      const next = updateComfyJob(await get(id), patch)
      return save(next)
    },
    async transition(id, nextStatus, patch = {}) {
      const next = transitionComfyJob(await get(id), nextStatus, patch)
      return save(next)
    },
    async appendOutput(id, output) {
      const job = await get(id)
      const next = updateComfyJob(job, { outputs: [...job.outputs, output] })
      return save(next)
    },
    async archiveOutput(id, { remoteFileName, data, expectedBytes = undefined, expectedSha256 = undefined, outputIndex = undefined }) {
      const job = await get(id)
      const safeRemoteFileName = validateSafeFileName(remoteFileName, ComfyArchiveError)
      const expected = normalizeExpectedArchiveIntegrity({ expectedBytes, expectedSha256 })
      const prior = job.outputs.find(output => output.remoteFileName === safeRemoteFileName
        && (expected.bytes === undefined || output.bytes === expected.bytes)
        && (expected.sha256 === undefined || output.sha256 === expected.sha256))
      if (prior) {
        const archiveTarget = await resolveComfyArchiveTarget(await root(), job.target)
        const existingPath = path.join(archiveTarget.slotDirectory, prior.fileName)
        const integrity = {
          bytes: expected.bytes ?? prior.bytes,
          sha256: expected.sha256 ?? prior.sha256,
        }
        if (await archiveFileMatchesIntegrity(existingPath, integrity)) {
          return { job, output: prior }
        }
      }
      const output = await archiveComfyOutput({
        projectRoot: await root(),
        job,
        remoteFileName: safeRemoteFileName,
        data,
        expectedBytes,
        expectedSha256,
        outputIndex,
      })
      const outputs = job.outputs.some(item => item.path === output.path) ? job.outputs : [...job.outputs, output]
      const next = updateComfyJob(job, { outputs })
      return { job: await save(next), output }
    },
  }
}

function extractBridgeJobId(response) {
  const body = assertRecord(response, 'The Comfy Bridge did not return a valid job response.', ComfyJobError)
  const candidate = body.jobId ?? body.id ?? body.job?.id
  return assertRemoteId(candidate, 'The Comfy Bridge did not return a valid job id.', ComfyJobError)
}

export async function submitComfyJob({ store, config, jobId, profileId = undefined, request }) {
  if (!store || typeof store.get !== 'function' || typeof store.transition !== 'function') {
    throw new ComfyJobError('A Comfy job store is required to submit a job.')
  }
  const job = await store.get(jobId)
  // Build and validate all credentials before the callback can make a network request.
  const profile = getRunnableComfyProfile(config, profileId ?? job.profileId)
  const bridgeRequest = createComfyBridgeJobRequest(profile, job)
  if (typeof request !== 'function') throw new ComfyJobError('A Comfy Bridge request function is required.')

  await store.transition(job.id, 'uploading')
  try {
    const response = await request(bridgeRequest)
    const bridgeJobId = extractBridgeJobId(response)
    const now = new Date().toISOString()
    const next = await store.transition(job.id, 'running', {
      remote: { bridgeJobId, status: 'queued', submittedAt: now, updatedAt: now, progress: 0 },
    })
    return { job: next, response, request: bridgeRequest }
  } catch (error) {
    await store.transition(job.id, 'failed', {
      error: { code: 'BRIDGE_SUBMIT_FAILED', message: errorMessage(error), at: new Date().toISOString() },
    }).catch(() => undefined)
    throw error
  }
}
