import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

import {
  COMFY_MAX_OUTPUT_FILE_BYTES,
  COMFY_MAX_OUTPUT_TOTAL_BYTES,
  ComfyArchiveError,
  ComfyConfigurationError,
  ComfyCoreError,
  ComfyJobError,
  createComfyBridgeDownloadRequest,
  createComfyBridgeJobRequest,
  createComfyBridgePollRequest,
  createComfyBridgeUploadRequest,
  createComfyJobStore,
  getComfyWorkflowPreset,
  getComfyWorkflowPresets,
  getDefaultComfyConfigPath,
  getPublicComfyConfig,
  getRunnableComfyProfile,
  loadComfyConfig,
  saveComfyConfig,
  setActiveComfyProfile,
} from './comfy-core.js'

import {
  ProjectPathError,
  getAssetWorkspaceSnapshot,
  resolveExistingPath,
  withProjectRoot,
} from '../lib/workspace-core.js'

const API_PREFIX = '/ai-drama/workbench/comfy'
const MAX_JSON_BYTES = 512 * 1024
const MAX_BRIDGE_RESPONSE_BYTES = 1024 * 1024
const MAX_BRIDGE_OUTPUT_FILES = 32
const MAX_LOCAL_JOB_ERROR_CHARS = 1_800
const DEFAULT_POLL_INTERVAL_MS = 1_500
const DEFAULT_MAX_POLL_MS = 2 * 60 * 60 * 1000
const SELECTED_SUFFIX = /(?:-|_)已选$/u
const IMAGE_FILE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
const SUPPORTED_ASSET_TYPES = new Set(['character', 'scene', 'location', 'prop', 'shot'])
// H3 accepts up to 20k prompt characters. Reserve room below that limit so
// inherited project context cannot make a saved shot prompt un-runnable.
export const MAX_SHOT_VIDEO_BRIEF_CHARS = 12_000
const MAX_SHOT_VIDEO_BRIEF_ASSET_ITEMS = 8

class ComfyApiError extends Error {
  constructor(status, message, code = undefined) {
    super(message)
    this.status = status
    this.code = code
  }
}

class BridgeRequestError extends Error {
  constructor(message, status = undefined) {
    super(message)
    this.status = status
  }
}

class FrozenSelectionError extends ComfyJobError {}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function boundedErrorMessage(error, maximum = MAX_LOCAL_JOB_ERROR_CHARS) {
  const message = errorMessage(error).trim() || 'ComfyUI 任务失败。'
  return message.length <= maximum ? message : `${message.slice(0, Math.max(1, maximum - 1))}…`
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_JSON_BYTES) throw new ComfyApiError(413, 'ComfyUI 请求不能超过 512 KB。')
    chunks.push(chunk)
  }
  if (!size) throw new ComfyApiError(400, 'ComfyUI 请求不能为空。')
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!isRecord(body)) throw new Error('not an object')
    return body
  } catch {
    throw new ComfyApiError(400, 'ComfyUI 请求 JSON 格式无效。')
  }
}

function requireText(value, label, { maximum = 4_096 } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new ComfyApiError(400, `${label}无效。`)
  }
  return value.trim()
}

function optionalText(value, label, { maximum = 4_096 } = {}) {
  if (value === undefined || value === null || value === '') return undefined
  return requireText(value, label, { maximum })
}

function hasOwnProperty(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function temporaryPromptOverrides(body, preset) {
  const hasPrompt = hasOwnProperty(body, 'prompt')
  const hasNegativePrompt = hasOwnProperty(body, 'negativePrompt')
  if (!hasPrompt && !hasNegativePrompt) {
    return { hasPrompt: false, hasNegativePrompt: false }
  }
  if (preset.output.kind !== 'image') {
    throw new ComfyApiError(400, '当前视频工作流不支持临时修改提示词。')
  }

  const normalize = (key, label) => {
    const definition = preset.inputs.find(input => input.key === key && input.type === 'string')
    if (!definition) throw new ComfyApiError(400, `当前工作流不支持${label}。`)
    const value = body[key]
    const maximum = Number.isSafeInteger(definition.maxLength) ? definition.maxLength : 20_000
    if (typeof value !== 'string' || value.length > maximum) {
      throw new ComfyApiError(400, `${label}无效。`)
    }
    return value.trim()
  }

  return {
    hasPrompt,
    ...(hasPrompt ? { prompt: normalize('prompt', '临时提示词') } : {}),
    hasNegativePrompt,
    ...(hasNegativePrompt ? { negativePrompt: normalize('negativePrompt', '临时负面提示词') } : {}),
  }
}

async function resolveRequestProject(state, url) {
  const rawProjectId = url.searchParams.get('projectId')
  if (rawProjectId !== null && !rawProjectId.trim()) {
    throw new ComfyApiError(400, '项目 ID 不能为空。')
  }
  if (typeof state.resolveProject === 'function') {
    try {
      return await state.resolveProject(rawProjectId ?? undefined)
    } catch (error) {
      throw new ComfyApiError(404, errorMessage(error))
    }
  }
  return { id: undefined, root: await state.root() }
}

function isSelectedImageName(fileName) {
  if (typeof fileName !== 'string') return false
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  return IMAGE_FILE_EXTENSIONS.has(extension) && SELECTED_SUFFIX.test(stem)
}

function isSelectedImage(file) {
  return Boolean(file && file.kind === 'image' && isSelectedImageName(file.name))
}

function slotFor(asset, key) {
  return asset?.slots?.find(slot => slot.key === key)
}

function selectedSlotImage(asset, keys, errors) {
  for (const key of keys) {
    const slot = slotFor(asset, key)
    const candidates = (slot?.files ?? [])
      .filter(isSelectedImage)
    if (candidates.length > 1) {
      const names = candidates
        .map(candidate => candidate.name)
        .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
        .join('、')
      const message = `资料槽“${slot?.label ?? key}”中有多张“已选”图片（${names}）。请只保留一张后再生成。`
      if (!errors.includes(message)) errors.push(message)
      return undefined
    }
    if (candidates.length === 1) return candidates[0]
  }
  return undefined
}

function selectedSlotImages(asset, keys) {
  const images = []
  const paths = new Set()
  for (const key of keys) {
    const slot = slotFor(asset, key)
    for (const file of slot?.files ?? []) {
      if (!isSelectedImage(file) || typeof file.path !== 'string' || !file.path || paths.has(file.path)) continue
      paths.add(file.path)
      images.push(file)
    }
  }
  return images
}

function selectedCharacterVisual(source, keys, errors) {
  // Read the slot itself instead of the cover metadata: manually duplicated
  // "-已选" files must remain visible to the generation safety check.
  return selectedSlotImage(source, keys, errors)
}

function roleLabel(role) {
  return ({
    referenceImage: '参考图',
    characterReference: '人物参考',
    sceneReference: '场景参考',
    firstFrame: '首帧',
    lastFrame: '尾帧',
  })[role] ?? role
}

function comparableShotId(value) {
  return String(value ?? '').trim().replace(/^SH/iu, '').replace(/^0+(?=\d)/u, '')
}

function isShotInBindingRange(shotId, binding) {
  const current = comparableShotId(shotId)
  const start = comparableShotId(binding?.startShotId)
  const end = comparableShotId(binding?.endShotId)
  if (!current || (!start && !end)) return true
  if (!/^\d+$/u.test(current) || (start && !/^\d+$/u.test(start)) || (end && !/^\d+$/u.test(end))) return true
  const value = Number(current)
  return (!start || value >= Number(start)) && (!end || value <= Number(end))
}

function findSceneForShot(snapshot, shot) {
  return (snapshot?.scenes ?? []).find(scene => scene.sceneId === shot.design.sceneId)
}

function findCharacter(snapshot, characterPath) {
  return snapshot.characters.find(character => character.rootPath === characterPath)
}

function characterSourceForShot(snapshot, shot, scene, warnings) {
  const overrides = (shot.design.characterOverrides ?? []).filter(item => item?.characterPath)
  const bindingCandidates = (scene?.castBindings ?? []).filter(binding => isShotInBindingRange(shot.design.shotId, binding))
  const activeCharacterPaths = new Set((overrides.length ? overrides : bindingCandidates)
    .map(item => item.characterPath)
    .filter(Boolean))
  const selectedOverride = overrides[0]
  const binding = selectedOverride
    ? bindingCandidates.find(item => item.characterPath === selectedOverride.characterPath)
    : bindingCandidates[0]
  const characterPath = selectedOverride?.characterPath ?? binding?.characterPath
  if (!characterPath) return undefined
  const character = findCharacter(snapshot, characterPath)
  if (!character) {
    warnings.push('镜头关联的人物资产不存在，已跳过人物参考。')
    return undefined
  }
  let lookPath
  if (selectedOverride?.mode === 'look') lookPath = selectedOverride.lookPath
  else if (!selectedOverride || selectedOverride.mode === 'inherit') lookPath = binding?.lookPath
  const look = lookPath ? character.looks.find(item => item.rootPath === lookPath) : undefined
  if (lookPath && !look) warnings.push('镜头关联的角色造型不存在，已退回人物身份基准。')
  if (activeCharacterPaths.size > 1) {
    warnings.push('当前镜头关联了多个人物。')
  }
  return { character, source: look ?? character, hasMultipleCharacters: activeCharacterPaths.size > 1 }
}

function selectedLocationImageForShot(snapshot, shot, scene, errors) {
  for (const binding of scene?.locationBindings ?? []) {
    if (!binding?.locationPath || !isShotInBindingRange(shot.design.shotId, binding)) continue
    const location = (snapshot.locations ?? []).find(item => item.rootPath === binding.locationPath)
    if (!location) continue
    const image = selectedSlotImage(location, ['setting', 'reference', 'candidate'], errors)
    if (image) return image
  }
  return undefined
}

function selectedPropImageForShot(snapshot, shot, scene, errors) {
  for (const binding of scene?.propBindings ?? []) {
    if (!binding?.propPath || !isShotInBindingRange(shot.design.shotId, binding)) continue
    const prop = (snapshot.props ?? []).find(item => item.rootPath === binding.propPath)
    if (!prop) continue
    const image = selectedSlotImage(prop, ['reference', 'candidate'], errors)
    if (image) return image
  }
  return undefined
}

function effectiveCharacterSourcesForShot(snapshot, shot, scene) {
  const effective = new Map()
  for (const binding of scene?.castBindings ?? []) {
    if (!binding?.characterPath || !isShotInBindingRange(shot.design.shotId, binding)) continue
    effective.set(binding.characterPath, { characterPath: binding.characterPath, lookPath: binding.lookPath })
  }
  for (const override of shot.design.characterOverrides ?? []) {
    if (!override?.characterPath) continue
    if (override.mode === 'inherit') {
      if (!effective.has(override.characterPath)) continue
      continue
    }
    effective.set(override.characterPath, {
      characterPath: override.characterPath,
      ...(override.mode === 'look' && override.lookPath ? { lookPath: override.lookPath } : {}),
    })
  }
  return [...effective.values()].flatMap(({ characterPath, lookPath }) => {
    const character = findCharacter(snapshot, characterPath)
    if (!character) return []
    const look = lookPath ? character.looks.find(item => item.rootPath === lookPath) : undefined
    return [look ?? character]
  })
}

function selectedShotReferenceImages(snapshot, shot, presetId) {
  const scene = findSceneForShot(snapshot, shot)
  const images = []
  const paths = new Set()
  const add = files => {
    for (const file of files) {
      if (paths.has(file.path)) continue
      paths.add(file.path)
      images.push(file)
    }
  }

  add(selectedSlotImages(shot, ['reference', 'candidate']))
  for (const binding of scene?.locationBindings ?? []) {
    if (!binding?.locationPath || !isShotInBindingRange(shot.design.shotId, binding)) continue
    const location = (snapshot.locations ?? []).find(item => item.rootPath === binding.locationPath)
    if (location) add(selectedSlotImages(location, ['setting', 'reference', 'candidate']))
  }
  if (scene) add(selectedSlotImages(scene, ['setting', 'reference', 'firstFrame', 'lastFrame']))
  for (const source of effectiveCharacterSourcesForShot(snapshot, shot, scene)) {
    add(selectedSlotImages(source, ['turnaround', 'costume', 'reference']))
  }
  for (const binding of scene?.propBindings ?? []) {
    if (!binding?.propPath || !isShotInBindingRange(shot.design.shotId, binding)) continue
    const prop = (snapshot.props ?? []).find(item => item.rootPath === binding.propPath)
    if (prop) add(selectedSlotImages(prop, ['reference', 'candidate']))
  }
  if (presetId === 'shot-last-frame-img2img-v1') add(selectedSlotImages(shot, ['firstFrame']))
  return images
}

function findWorkspaceAsset(snapshot, assetType, assetPath) {
  if (assetType === 'character') return snapshot.characters.find(item => item.rootPath === assetPath)
  if (assetType === 'scene') return snapshot.scenes.find(item => item.rootPath === assetPath)
  if (assetType === 'location') return snapshot.locations.find(item => item.rootPath === assetPath)
  if (assetType === 'prop') return snapshot.props.find(item => item.rootPath === assetPath)
  return snapshot.shots.find(item => !item.isDraft && item.rootPath === assetPath)
}

function parseIntegerOption(rawValue, label) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined
  if (typeof rawValue === 'boolean') {
    throw new ComfyApiError(400, `${label}必须是整数。`)
  }
  if (typeof rawValue === 'number' && Number.isSafeInteger(rawValue)) return rawValue
  if (typeof rawValue !== 'string' || !/^-?\d+$/u.test(rawValue.trim())) {
    throw new ComfyApiError(400, `${label}必须是整数。`)
  }
  const value = Number(rawValue.trim())
  if (!Number.isSafeInteger(value)) throw new ComfyApiError(400, `${label}超出支持范围。`)
  return value
}

function parseNumberOption(rawValue, label) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined
  if (typeof rawValue === 'boolean') {
    throw new ComfyApiError(400, `${label}必须是有效数字。`)
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
  if (!Number.isFinite(value)) throw new ComfyApiError(400, `${label}必须是有效数字。`)
  return value
}

function inputOptionsForPreset(preset, rawOptions) {
  if (rawOptions !== undefined && !isRecord(rawOptions)) {
    throw new ComfyApiError(400, '生成参数必须是对象。')
  }
  const options = rawOptions ?? {}
  const definitions = new Map(preset.inputs.map(input => [input.key, input]))
  const inputs = {}
  for (const key of ['width', 'height', 'seed', 'denoise', 'frames', 'fps', 'durationSeconds']) {
    const definition = definitions.get(key)
    if (!definition) continue
    const label = key === 'fps' ? '帧率'
      : key === 'durationSeconds' ? '时长（秒）'
        : key
    const value = definition.type === 'number'
      ? parseNumberOption(options[key], label)
      : parseIntegerOption(options[key], label)
    // An empty or -1 seed means the bridge should let the workflow randomize it.
    if (key === 'seed' && value === -1) continue
    if (value !== undefined && (value < definition.minimum || value > definition.maximum)) {
      throw new ComfyApiError(400, `${label}必须在 ${definition.minimum} 到 ${definition.maximum} 之间。`)
    }
    if (value !== undefined && Number.isSafeInteger(definition.multiple) && value % definition.multiple !== 0) {
      throw new ComfyApiError(400, `${label}必须是 ${definition.multiple} 的倍数。`)
    }
    if (value !== undefined) inputs[key] = value
  }
  return inputs
}

function referenceImagesOptionForPreset(preset, rawOptions) {
  if (rawOptions !== undefined && !isRecord(rawOptions)) {
    throw new ComfyApiError(400, '生成参数必须是对象。')
  }
  const value = rawOptions?.useReferenceImages
  if (value !== undefined && typeof value !== 'boolean') {
    throw new ComfyApiError(400, '使用参考图选项必须是布尔值。')
  }
  if (value === true && !preset.referenceImagesEnabled) {
    throw new ComfyApiError(400, '当前工作流暂不支持图生图，请先关闭“使用参考图”，使用基础文生图。')
  }
  // Dedicated image-to-image presets opt in by default. A caller may still
  // explicitly disable the reference during preflight, which will surface the
  // preset's required-upload error instead of silently falling back to text.
  return value === undefined ? Boolean(preset.referenceImagesEnabled) : value === true
}

function referenceImagePathOptionForPreset(preset, rawOptions) {
  if (rawOptions !== undefined && !isRecord(rawOptions)) {
    throw new ComfyApiError(400, '生成参数必须是对象。')
  }
  const options = rawOptions ?? {}
  if (!hasOwnProperty(options, 'referenceImagePath')) return undefined
  if (!preset.referenceImagesEnabled) {
    throw new ComfyApiError(400, '当前工作流不支持指定参考图。')
  }
  return requireText(options.referenceImagePath, '参考图路径', { maximum: 1_024 })
}

function outputTargetForPreset(preset, assetType, assetPath, lookPath) {
  const target = preset.output.targetSlots.find(candidate => candidate.assetType === assetType)
  if (!target) throw new ComfyApiError(400, '当前资产没有匹配的受控工作流。')
  return { assetType, assetPath, slot: target.slot, ...(lookPath ? { lookPath } : {}) }
}

function markdownSection(content, heading) {
  const lines = String(content ?? '').replace(/\r\n?/gu, '\n').split('\n')
  const headingIndex = lines.findIndex(line => line.trim() === `## ${heading}`)
  if (headingIndex < 0) return ''
  const section = []
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index].trim())) break
    section.push(lines[index])
  }
  return section.join('\n').trim()
}

function makeUpload(role, file) {
  return { role, sourcePath: file.path, fileName: file.name }
}

function derivePrompt(asset, assetType, look, presetId) {
  if (assetType === 'character') {
    const profile = look?.documentContent || asset.profileContent || ''
    return {
      prompt: profile.trim(),
      negativePrompt: '',
    }
  }
  if (assetType === 'scene') {
    return { prompt: String(asset.sceneContent ?? '').trim(), negativePrompt: '' }
  }
  if (assetType === 'location') {
    const profile = String(asset.profileContent ?? '')
    return {
      prompt: markdownSection(profile, '场景图提示词') || profile.trim(),
      negativePrompt: markdownSection(profile, '场景图负面提示词') || markdownSection(profile, '负面提示词'),
    }
  }
  if (assetType === 'prop') {
    const profile = String(asset.profileContent ?? '')
    return {
      prompt: markdownSection(profile, '道具图提示词') || profile.trim(),
      negativePrompt: markdownSection(profile, '道具图负面提示词') || markdownSection(profile, '负面提示词'),
    }
  }
  const design = asset.design
  const isFirstFrame = presetId === 'shot-first-frame-v1' || presetId === 'shot-first-frame-img2img-v1'
  const isLastFrame = presetId === 'shot-last-frame-v1' || presetId === 'shot-last-frame-img2img-v1'
  return {
    prompt: String(
      (isFirstFrame ? design.firstFramePrompt : isLastFrame ? design.lastFramePrompt : '')
      || design.prompt
      || design.content
      || '',
    ).trim(),
    negativePrompt: String(
      (isFirstFrame ? design.firstFrameNegativePrompt : isLastFrame ? design.lastFrameNegativePrompt : '')
      || design.negativePrompt
      || '',
    ).trim(),
  }
}

function compactBriefText(value, maximum) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const normalized = value
    .replace(/\u0000/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  if (normalized.length <= maximum) return normalized
  return `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`
}

function briefPathName(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\\/gu, '/').split('/').filter(Boolean).at(-1) ?? ''
}

function applicableSceneBindings(scene, key, shotId) {
  if (!scene || !Array.isArray(scene[key])) return []
  return scene[key].filter(binding => binding && isShotInBindingRange(shotId, binding))
}

function relationNotes(binding) {
  return [
    ['用途', binding?.role],
    ['状态', binding?.state],
    ['连续性', binding?.continuity],
  ].map(([label, value]) => {
    const text = compactBriefText(value, 180)
    return text ? `${label}：${text}` : ''
  }).filter(Boolean).join('，')
}

function resolvedShotCharacters(scene, shot) {
  const inherited = applicableSceneBindings(scene, 'castBindings', shot.design.shotId)
  const byCharacter = new Map(inherited
    .filter(binding => binding?.characterPath)
    .map(binding => [binding.characterPath, { ...binding }]))
  const overrides = Array.isArray(shot.design.characterOverrides)
    ? shot.design.characterOverrides.filter(binding => binding?.characterPath)
    : []

  for (const override of overrides) {
    const inheritedBinding = byCharacter.get(override.characterPath)
    const mode = override.mode || 'inherit'
    byCharacter.set(override.characterPath, {
      ...inheritedBinding,
      characterPath: override.characterPath,
      lookPath: mode === 'look'
        ? override.lookPath
        : mode === 'identity'
          ? undefined
          : inheritedBinding?.lookPath,
      state: compactBriefText(override.state, 180) || inheritedBinding?.state || '',
      continuity: inheritedBinding?.continuity || '',
    })
  }
  return [...byCharacter.values()].slice(0, MAX_SHOT_VIDEO_BRIEF_ASSET_ITEMS)
}

function characterBriefs(snapshot, scene, shot) {
  const characters = new Map((snapshot.characters ?? []).map(character => [character.rootPath, character]))
  return resolvedShotCharacters(scene, shot).map(binding => {
    const character = characters.get(binding.characterPath)
    const look = binding.lookPath
      ? character?.looks?.find(candidate => candidate.rootPath === binding.lookPath)
      : undefined
    const name = compactBriefText(character?.name || briefPathName(binding.characterPath), 120)
    const visualSource = look?.documentContent || character?.profileContent
    const visualBrief = compactBriefText(visualSource, 360)
    const notes = [
      name,
      look?.name ? `造型：${compactBriefText(look.name, 120)}` : '',
      binding.state ? `状态：${compactBriefText(binding.state, 180)}` : '',
      binding.continuity ? `连续性：${compactBriefText(binding.continuity, 180)}` : '',
      visualBrief ? `设定：${visualBrief}` : '',
    ].filter(Boolean)
    return notes.join('，')
  }).filter(Boolean)
}

function inheritedAssetBriefs(snapshot, scene, shot, bindingKey, assetKey, pathKey) {
  const assets = new Map((snapshot[assetKey] ?? []).map(asset => [asset.rootPath, asset]))
  return applicableSceneBindings(scene, bindingKey, shot.design.shotId)
    .slice(0, MAX_SHOT_VIDEO_BRIEF_ASSET_ITEMS)
    .map(binding => {
      const asset = assets.get(binding[pathKey])
      const name = compactBriefText(asset?.name || briefPathName(binding[pathKey]), 120)
      const profile = compactBriefText(asset?.profileContent, 300)
      return [
        name,
        relationNotes(binding),
        profile ? `设定：${profile}` : '',
      ].filter(Boolean).join('，')
    }).filter(Boolean)
}

function appendBriefSection(sections, label, value, maximum) {
  const text = compactBriefText(value, maximum)
  if (text) sections.push(`${label}：${text}`)
}

function assembleBoundedBrief(sections) {
  let result = ''
  for (const section of sections) {
    const separator = result ? '\n\n' : ''
    const available = MAX_SHOT_VIDEO_BRIEF_CHARS - result.length - separator.length
    if (available <= 1) break
    if (section.length <= available) {
      result += `${separator}${section}`
      continue
    }
    result += `${separator}${compactBriefText(section, available)}`
    break
  }
  return result
}

/**
 * Build the only free-text H3 input from saved project data. Media itself is
 * deliberately kept out of this brief: selected first/last frames are frozen
 * and uploaded through their two explicit Bridge roles.
 */
export function buildShotVideoBrief(snapshot, shot) {
  if (!shot?.design) return ''
  const design = shot.design
  const shotPrompt = compactBriefText(design.prompt, 3_200)
  const shotContent = compactBriefText(design.content, 3_200)
  const primaryPrompt = shotPrompt || shotContent
  // Preserve the existing generation requirement: a bare title or inherited
  // scene setting must not make an otherwise empty shot runnable.
  if (!primaryPrompt) return ''

  const scene = findSceneForShot(snapshot, shot)
  const sections = []
  appendBriefSection(sections, '镜头核心画面', primaryPrompt, 3_200)
  if (shotPrompt && shotContent && shotContent !== shotPrompt) {
    appendBriefSection(sections, '画面内容', shotContent, 1_400)
  }
  const shotDetails = [
    design.title ? `标题：${compactBriefText(design.title, 180)}` : '',
    design.framing ? `景别：${compactBriefText(design.framing, 180)}` : '',
    design.camera ? `运镜：${compactBriefText(design.camera, 360)}` : '',
    design.timecode ? `时间码：${compactBriefText(design.timecode, 120)}` : '',
    design.dialogue ? `台词：${compactBriefText(design.dialogue, 700)}` : '',
    design.references ? `参考：${compactBriefText(design.references, 480)}` : '',
  ].filter(Boolean).join('；')
  appendBriefSection(sections, '镜头信息', shotDetails, 1_900)

  appendBriefSection(sections, '场次环境', scene?.sceneContent, 1_700)
  const characters = characterBriefs(snapshot, scene, shot)
  if (characters.length) appendBriefSection(sections, '出场人物', characters.join('；'), 2_000)
  const locations = inheritedAssetBriefs(snapshot, scene, shot, 'locationBindings', 'locations', 'locationPath')
  if (locations.length) appendBriefSection(sections, '地点环境', locations.join('；'), 1_500)
  const props = inheritedAssetBriefs(snapshot, scene, shot, 'propBindings', 'props', 'propPath')
  if (props.length) appendBriefSection(sections, '关键道具', props.join('；'), 1_300)
  appendBriefSection(sections, '项目设定', snapshot.projectSettings?.content, 1_700)
  return assembleBoundedBrief(sections)
}

function deriveUploads(snapshot, asset, assetType, look, preset, warnings, errors, useReferenceImages = false, referenceImagePath = undefined) {
  // Image presets are text-to-image by default. Do not inspect or upload a
  // selected reference unless a dedicated image-to-image preset opts in.
  if (preset.output.kind === 'image' && !useReferenceImages) return []
  const acceptedRoles = new Set(preset.uploadRoles.map(item => item.role))
  const uploads = []
  const add = (role, file) => {
    if (!acceptedRoles.has(role) || !file || uploads.some(item => item.role === role)) return
    uploads.push(makeUpload(role, file))
  }

  if (assetType === 'character') {
    const source = look ?? asset
    const preferredSlots = preset.id === 'character-costume-v1'
      ? ['turnaround', 'reference', 'costume']
      : ['reference', 'turnaround', 'costume']
    add('referenceImage', selectedCharacterVisual(source, preferredSlots, errors))
  } else if (assetType === 'scene') {
    add('referenceImage', selectedSlotImage(asset, ['reference', 'setting', 'firstFrame', 'lastFrame'], errors))
  } else if (assetType === 'location') {
    add('referenceImage', selectedSlotImage(asset, ['reference', 'setting'], errors))
  } else if (assetType === 'prop') {
    add('referenceImage', selectedSlotImage(asset, ['reference', 'candidate'], errors))
  } else {
    const scene = findSceneForShot(snapshot, asset)
    if (referenceImagePath) {
      const explicitReference = selectedShotReferenceImages(snapshot, asset, preset.id)
        .find(file => file.path === referenceImagePath)
      if (!explicitReference) {
        errors.push('指定参考图不属于当前镜头可用的已选参考素材。')
        return uploads
      }
      add('referenceImage', explicitReference)
      if (preset.id === 'shot-first-frame-img2img-v1') warnings.push('首帧图生图将使用指定参考图。')
      else if (preset.id === 'shot-last-frame-img2img-v1') warnings.push('尾帧图生图将使用指定参考图。')
      return uploads
    }
    const characterSource = characterSourceForShot(snapshot, asset, scene, warnings)
    const characterImage = characterSource
      ? selectedCharacterVisual(characterSource.source, ['turnaround', 'costume', 'reference'], errors)
      : undefined
    const locationImage = selectedLocationImageForShot(snapshot, asset, scene, errors)
    const legacySceneImage = scene
      ? selectedSlotImage(scene, ['setting', 'reference', 'firstFrame', 'lastFrame'], errors)
      : undefined
    const propImage = selectedPropImageForShot(snapshot, asset, scene, errors)
    const shotReference = selectedSlotImage(asset, ['reference', 'candidate'], errors)
    const firstFrame = selectedSlotImage(asset, ['firstFrame'], errors)
    const lastFrame = selectedSlotImage(asset, ['lastFrame'], errors)
    if (characterSource?.hasMultipleCharacters && acceptedRoles.has('characterReference')) {
      errors.push('当前镜头关联了多个人物，但这个工作流只支持单张人物参考。请先只保留一位出场角色，或改用支持多人参考图的工作流。')
    }
    if (preset.id === 'shot-first-frame-img2img-v1') {
      const reference = shotReference ?? locationImage ?? legacySceneImage ?? characterImage ?? propImage
      add('referenceImage', reference)
      if (reference && reference === shotReference) warnings.push('首帧图生图将使用当前镜头已选参考图。')
      else if (reference && reference === locationImage) warnings.push('首帧图生图将使用当前场次地点/环境的已选场景图。')
      else if (reference && reference === legacySceneImage) warnings.push('首帧图生图将使用当前场次已选场景图。')
      else if (reference && reference === characterImage) warnings.push('首帧图生图将使用本镜头出场人物的已选视觉图。')
      else if (reference && reference === propImage) warnings.push('首帧图生图将使用本镜头道具的已选参考图。')
      const ignoredReferences = [characterImage, locationImage ?? legacySceneImage, propImage]
        .filter(image => image && image !== reference)
      if (reference && ignoredReferences.length) {
        warnings.push('当前首帧图生图工作流只支持一张参考图，其余人物、场景或道具参考不会上传。')
      }
    } else if (preset.id === 'shot-last-frame-img2img-v1') {
      add('referenceImage', firstFrame)
      if (firstFrame) warnings.push('尾帧图生图将使用当前镜头已选首帧。')
    } else {
      add('characterReference', characterImage)
      add('sceneReference', locationImage ?? legacySceneImage)
      add('referenceImage', shotReference)
      add('firstFrame', firstFrame)
      add('lastFrame', lastFrame)
    }
  }

  for (const definition of preset.uploadRoles) {
    if (!definition.required || uploads.some(item => item.role === definition.role)) continue
    if (preset.id === 'shot-first-frame-img2img-v1') {
      errors.push('镜头首帧图生图需要一张已选输入图。请先选择镜头、场景、人物或道具参考图。')
    } else if (preset.id === 'shot-last-frame-img2img-v1') {
      errors.push('镜头尾帧图生图需要当前镜头的已选首帧。请先生成或上传首帧并设为“已选”。')
    } else {
      errors.push(`${preset.label}需要已选${roleLabel(definition.role)}。请先在对应资料槽中将图片设为“已选”。`)
    }
  }
  return uploads
}

async function deriveGenerationPlan(root, body) {
  const assetType = requireText(body.assetType, '资产类型', { maximum: 32 })
  if (!SUPPORTED_ASSET_TYPES.has(assetType)) throw new ComfyApiError(400, '资产类型不支持 ComfyUI 生成。')
  const assetPath = requireText(body.assetPath, '资产路径', { maximum: 1_024 })
  const presetId = requireText(body.presetId, '工作流预设', { maximum: 128 })
  const requestedLookPath = optionalText(body.lookPath, '角色造型路径', { maximum: 1_024 })
  if (assetType !== 'character' && requestedLookPath) {
    throw new ComfyApiError(400, '只有人物资产可以指定角色造型。')
  }

  const preset = getComfyWorkflowPreset(presetId)
  const snapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
  const asset = findWorkspaceAsset(snapshot, assetType, assetPath)
  if (!asset) throw new ComfyApiError(404, '当前资产不存在、尚未建立，或不属于活动项目。')
  if (assetType === 'shot' && asset.isDraft) {
    throw new ComfyApiError(400, '请先建立镜头资产，再提交 ComfyUI 生成任务。')
  }
  let look
  if (requestedLookPath) {
    look = asset.looks.find(item => item.rootPath === requestedLookPath)
    if (!look) throw new ComfyApiError(400, '指定的角色造型不属于当前人物。')
  }

  const derivedPrompt = derivePrompt(asset, assetType, look, preset.id)
  const sourcePrompt = assetType === 'shot' && preset.id === 'h3-first-last-video-v1'
    ? buildShotVideoBrief(snapshot, asset)
    : derivedPrompt.prompt
  const overrides = temporaryPromptOverrides(body, preset)
  // Presence is intentional: an explicit empty prompt must preflight as empty
  // instead of silently falling back to the saved Markdown value.
  const prompt = overrides.hasPrompt ? overrides.prompt : sourcePrompt
  const negativePrompt = overrides.hasNegativePrompt ? overrides.negativePrompt : derivedPrompt.negativePrompt
  const warnings = []
  const errors = []
  if (!prompt) errors.push('本次任务没有可用提示词。')
  const useReferenceImages = referenceImagesOptionForPreset(preset, body.options)
  const referenceImagePath = referenceImagePathOptionForPreset(preset, body.options)
  const supportsExplicitShotReference = assetType === 'shot'
    && ['shot-first-frame-img2img-v1', 'shot-last-frame-img2img-v1'].includes(preset.id)
  if (referenceImagePath && !supportsExplicitShotReference) {
    throw new ComfyApiError(400, '指定参考图仅支持镜头首尾帧图生图。')
  }
  if (referenceImagePath && !useReferenceImages) {
    throw new ComfyApiError(400, '指定参考图时不能关闭图生图。')
  }
  const uploads = deriveUploads(snapshot, asset, assetType, look, preset, warnings, errors, useReferenceImages, referenceImagePath)
  // A Markdown shot may still carry a negative prompt, but only include it
  // when the selected preset explicitly declares that input.  MiniMax H3's
  // ImageToVideo node has no negative-prompt socket; forwarding this field
  // would make the Bridge reject an otherwise valid first/last-frame job.
  const inputs = {
    prompt,
    ...(negativePrompt && preset.inputs.some(input => input.key === 'negativePrompt')
      ? { negativePrompt }
      : {}),
    ...inputOptionsForPreset(preset, body.options),
  }
  const target = outputTargetForPreset(preset, assetType, assetPath, look?.rootPath)
  const outputSlot = preset.output.targetSlots.find(item => item.assetType === assetType)?.slot
  const outputSlotLabel = outputSlot === 'turnaround' ? '三视图'
    : outputSlot === 'costume' ? '定妆'
      : outputSlot === 'setting' ? '场景图'
        : outputSlot === 'reference' ? '参考图'
        : outputSlot === 'firstFrame' ? '首帧'
          : outputSlot === 'lastFrame' ? '尾帧'
            : '候选'
  return {
    preset,
    target,
    inputs,
    uploads,
    preview: {
      summary: overrides.hasPrompt || overrides.hasNegativePrompt
        ? `将使用“${preset.label}”${preset.output.kind === 'image' && !useReferenceImages ? '进行纯文生图' : '生成图片'}，本次使用临时提示词，不回写已保存的 Markdown。`
        : preset.output.kind === 'image' && !useReferenceImages
          ? `将使用“${preset.label}”进行纯文生图，只读取已保存的 Markdown，不上传参考图。`
        : `将使用“${preset.label}”读取当前已保存的 Markdown 与已选资料。`,
      outputSlotLabel,
      prompt: inputs.prompt,
      negativePrompt: inputs.negativePrompt ?? '',
      attachments: uploads.map(upload => ({
        role: preset.id === 'shot-first-frame-img2img-v1'
          ? '首帧输入图'
          : preset.id === 'shot-last-frame-img2img-v1'
            ? referenceImagePath ? '尾帧输入图' : '已选首帧'
            : roleLabel(upload.role),
        name: upload.fileName,
      })),
      warnings,
      errors,
    },
  }
}

function publicProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    configured: Boolean(profile.bridgeUrl && profile.hasToken),
    bridgeUrl: profile.bridgeUrl,
  }
}

function publicConfig(config, configPath) {
  const safe = getPublicComfyConfig(config)
  return {
    activeProfileId: safe.activeProfile,
    profiles: safe.profiles.map(publicProfile),
    configPath,
  }
}

function publicJob(job) {
  let presetLabel = job.workflowId
  try { presetLabel = getComfyWorkflowPreset(job.workflowId).label } catch { /* A persisted unsupported job remains visible. */ }
  const latestHistory = job.history[job.history.length - 1]
  // `inputs` is the immutable submission snapshot. Older records without a
  // negative prompt remain readable, while the UI can show the exact prompt
  // that was sent to the Bridge for every supported job.
  const prompt = typeof job.inputs?.prompt === 'string' ? job.inputs.prompt : undefined
  const negativePrompt = typeof job.inputs?.negativePrompt === 'string' ? job.inputs.negativePrompt : undefined
  return {
    id: job.id,
    status: job.status,
    presetLabel,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(negativePrompt !== undefined ? { negativePrompt } : {}),
    ...(latestHistory?.message ? { message: latestHistory.message } : {}),
    ...(job.error?.message ? { error: job.error.message } : {}),
    ...(job.error?.code ? { errorCode: job.error.code } : {}),
    outputPaths: job.outputs.map(output => output.path),
  }
}

function remoteProgress(remote) {
  const value = Number(remote?.progress?.value)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0
}

function remoteStatus(remote) {
  return typeof remote?.status === 'string' ? remote.status.trim().toLowerCase() : ''
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function responseText(response, maximum = MAX_BRIDGE_RESPONSE_BYTES) {
  const declaredLength = response.headers?.get?.('content-length')
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > maximum) {
    await response.body?.cancel?.().catch(() => undefined)
    throw new BridgeRequestError('Comfy Bridge 的响应过大。')
  }
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maximum) throw new BridgeRequestError('Comfy Bridge 的响应过大。')
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      size += chunk.byteLength
      if (size > maximum) {
        await reader.cancel().catch(() => undefined)
        throw new BridgeRequestError('Comfy Bridge 的响应过大。')
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function responseJson(response) {
  const text = await responseText(response)
  let body
  try { body = text ? JSON.parse(text) : {} } catch { throw new BridgeRequestError('Comfy Bridge 返回了无效 JSON。', response.status) }
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`
    throw new BridgeRequestError(`Comfy Bridge 请求失败：${detail}`, response.status)
  }
  if (!isRecord(body)) throw new BridgeRequestError('Comfy Bridge 返回了无效 JSON。', response.status)
  return body
}

async function bridgeFetch(fetchImpl, request, profile, { binary = false, contentLength = undefined, timeoutMs = undefined } = {}) {
  const effectiveTimeoutMs = timeoutMs ?? profile.requestTimeoutMs
  const controller = new AbortController()
  let timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs)
  try {
    const headers = { ...request.headers }
    if (contentLength !== undefined) headers['content-length'] = String(contentLength)
    const isStreamBody = request.body
      && (typeof request.body.pipe === 'function' || typeof request.body[Symbol.asyncIterator] === 'function')
    const body = isRecord(request.body) && !isStreamBody ? JSON.stringify(request.body) : request.body
    const init = {
      method: request.method,
      headers,
      ...(body !== undefined ? { body, ...(typeof body === 'string' ? {} : { duplex: 'half' }) } : {}),
      redirect: 'error',
      signal: controller.signal,
    }
    const response = await fetchImpl(request.url, init)
    if (binary) {
      if (!response.ok) {
        const text = await responseText(response)
        throw new BridgeRequestError(`Comfy Bridge 下载失败：${text.slice(0, 500) || `HTTP ${response.status}`}`, response.status)
      }
      if (!response.body) throw new BridgeRequestError('Comfy Bridge 没有返回输出文件。', response.status)
      // fetch() considers a request finished once headers arrive. Keep a
      // separate deadline until the binary body has actually been consumed.
      clearTimeout(timeout)
      timeout = undefined
      const stream = Readable.fromWeb(response.body)
      let released = false
      const downloadTimeout = setTimeout(() => {
        const error = new BridgeRequestError(`Comfy Bridge 下载超时（${Math.round(effectiveTimeoutMs / 1000)} 秒）。`)
        controller.abort()
        stream.destroy(error)
      }, effectiveTimeoutMs)
      const release = () => {
        if (released) return
        released = true
        clearTimeout(downloadTimeout)
        if (!stream.destroyed) stream.destroy()
      }
      const complete = () => {
        if (released) return
        released = true
        clearTimeout(downloadTimeout)
      }
      stream.once('end', complete)
      stream.once('error', complete)
      stream.once('close', complete)
      return { response, stream, release }
    }
    return responseJson(response)
  } catch (error) {
    if (error instanceof BridgeRequestError) throw error
    if (error?.name === 'AbortError') throw new BridgeRequestError(`Comfy Bridge 请求超时（${Math.round(effectiveTimeoutMs / 1000)} 秒）。`)
    const cause = error && typeof error === 'object' && error.cause ? `（${errorMessage(error.cause)}）` : ''
    throw new BridgeRequestError(`无法连接 Comfy Bridge：${errorMessage(error)}${cause}`)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function getUploadPath(root, upload) {
  if (!upload.sourcePath) throw new ComfyJobError('生成任务缺少本地参考素材路径。')
  const expectedName = upload.fileName ?? upload.sourcePath.split('/').at(-1)
  if (!isSelectedImageName(expectedName)) {
    throw new FrozenSelectionError('已选参考图在任务开始前被切换，请重新检查并提交任务。')
  }
  let absolutePath
  let info
  try {
    absolutePath = await withProjectRoot(root, () => resolveExistingPath(upload.sourcePath))
    info = await fs.stat(absolutePath)
  } catch {
    throw new FrozenSelectionError('已选参考图在任务开始前被切换，请重新检查并提交任务。')
  }
  if (!info.isFile() || info.size < 1) throw new ComfyJobError('生成任务引用的本地素材已不存在。')
  if (!isSelectedImageName(path.basename(absolutePath))) {
    throw new FrozenSelectionError('已选参考图在任务开始前被切换，请重新检查并提交任务。')
  }
  return { absolutePath, size: info.size }
}

async function resolveQueuedUploads(root, uploads) {
  // Verify every frozen selection before anything is uploaded to the cloud.
  return Promise.all(uploads.map(async upload => ({ upload, local: await getUploadPath(root, upload) })))
}

function bridgeOutputManifest(value) {
  if (!isRecord(value) || typeof value.fileName !== 'string' || !value.fileName) {
    throw new BridgeRequestError('Comfy Bridge 返回了无效输出文件。')
  }
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > COMFY_MAX_OUTPUT_FILE_BYTES) {
    throw new BridgeRequestError('Comfy Bridge 返回的输出文件大小无效。')
  }
  const sha256 = typeof value.sha256 === 'string' ? value.sha256.toLowerCase() : ''
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new BridgeRequestError('Comfy Bridge 返回的输出文件校验和无效。')
  }
  return { fileName: value.fileName, size: value.size, sha256 }
}

function bridgeJobErrorMessage(remote) {
  if (typeof remote?.error === 'string' && remote.error.trim()) return remote.error.trim()
  if (isRecord(remote?.error) && typeof remote.error.message === 'string' && remote.error.message.trim()) {
    return remote.error.message.trim()
  }
  return 'Comfy Bridge 任务未能完成。'
}

function declaredContentLength(response) {
  const raw = response.headers?.get?.('content-length')
  if (raw === null || raw === undefined || raw === '') return undefined
  if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new BridgeRequestError('Comfy Bridge 返回了无效的下载长度。')
  }
  return Number(raw)
}

async function transitionFailed(store, jobId, code, error) {
  try {
    const job = await store.get(jobId)
    if (!['queued', 'uploading', 'running', 'downloading', 'archiving'].includes(job.status)) return
    await store.transition(jobId, 'failed', {
      error: { code, message: boundedErrorMessage(error), at: new Date().toISOString() },
    })
  } catch (failure) {
    console.error('[ai-drama-workbench] 无法记录 ComfyUI 任务失败状态。', failure)
  }
}

function uploadsForCurrentPreset(job) {
  const preset = getComfyWorkflowPreset(job.workflowId)
  // A queued record can predate the text-to-image default. Strip its stale
  // reference before recovery or execution.
  if (preset.output.kind === 'image' && !preset.referenceImagesEnabled) return []
  return job.uploads
}

async function submitQueuedJob({ root, store, config, fetchImpl, jobId }) {
  let job = await store.get(jobId)
  const profile = getRunnableComfyProfile(config, job.profileId)
  if (job.status !== 'queued') return { job, profile }
  const currentUploads = uploadsForCurrentPreset(job)
  if (currentUploads.length !== job.uploads.length) {
    job = await store.update(job.id, { uploads: currentUploads })
  }
  await resolveQueuedUploads(root, job.uploads)
  await store.transition(job.id, 'uploading', {
    progress: 0.05,
    message: job.uploads.length ? '正在上传已选参考素材。' : '无需上传参考素材，正在提交任务。',
  })

  const uploaded = []
  for (let index = 0; index < job.uploads.length; index += 1) {
    const upload = job.uploads[index]
    // Re-check immediately before streaming to close the gap after the preflight.
    const local = await getUploadPath(root, upload)
    const request = createComfyBridgeUploadRequest(profile, {
      fileName: upload.fileName ?? upload.sourcePath.split('/').at(-1),
      body: createReadStream(local.absolutePath),
    })
    const result = await bridgeFetch(fetchImpl, request, profile, { contentLength: local.size })
    if (typeof result.uploadId !== 'string' || !result.uploadId) {
      throw new ComfyJobError('Comfy Bridge 没有返回素材上传编号。')
    }
    uploaded.push({ ...upload, uploadId: result.uploadId, fileName: result.fileName || upload.fileName })
    job = await store.update(job.id, {
      uploads: [...uploaded, ...job.uploads.slice(index + 1)],
      progress: 0.05 + 0.2 * ((index + 1) / Math.max(job.uploads.length, 1)),
    })
  }
  job = await store.get(jobId)
  const submitRequest = createComfyBridgeJobRequest(profile, job)
  const submitted = await bridgeFetch(fetchImpl, submitRequest, profile)
  if (typeof submitted.id !== 'string' || !submitted.id) {
    throw new ComfyJobError('Comfy Bridge 没有返回任务编号。')
  }
  const now = new Date().toISOString()
  job = await store.transition(job.id, 'running', {
    progress: Math.max(0.25, remoteProgress(submitted)),
    remote: {
      bridgeJobId: submitted.id,
      status: remoteStatus(submitted) || 'queued',
      progress: remoteProgress(submitted),
      submittedAt: now,
      updatedAt: now,
    },
    message: 'ComfyUI 任务已提交。',
  })
  return { job, profile }
}

async function pollAndArchiveJob({ root, store, config, fetchImpl, jobId, pollIntervalMs, maxPollMs }) {
  let job = await store.get(jobId)
  const profile = getRunnableComfyProfile(config, job.profileId)
  if (job.status !== 'running' || !job.remote?.bridgeJobId) return job
  const startedAt = Date.now()
  while (Date.now() - startedAt < maxPollMs) {
    job = await store.get(jobId)
    if (job.status !== 'running') return job
    const request = createComfyBridgePollRequest(profile, job.remote?.bridgeJobId)
    const remote = await bridgeFetch(fetchImpl, request, profile)
    const status = remoteStatus(remote)
    const now = new Date().toISOString()
    if (['failed', 'interrupted', 'cancelled'].includes(status)) {
      throw new BridgeRequestError(bridgeJobErrorMessage(remote))
    }
    if (status !== 'completed') {
      await store.update(jobId, {
        progress: Math.max(0.25, remoteProgress(remote)),
        remote: {
          bridgeJobId: job.remote.bridgeJobId,
          status: status || 'running',
          progress: remoteProgress(remote),
          submittedAt: job.remote.submittedAt,
          updatedAt: now,
        },
      })
      await sleep(pollIntervalMs)
      continue
    }

    const outputs = Array.isArray(remote.outputs) ? remote.outputs : []
    if (remote.dryRun) {
      // The bridge's safe mock mode proves the protocol but deliberately has no media to archive.
      await store.transition(jobId, 'downloading', { progress: 0.9, message: 'Comfy Bridge 模拟任务已完成。' })
      await store.transition(jobId, 'archiving', { progress: 0.95, message: '模拟模式不写入媒体文件。' })
      return store.transition(jobId, 'completed', { progress: 1, message: 'Comfy Bridge 模拟验证完成。' })
    }
    if (!outputs.length) throw new BridgeRequestError('Comfy Bridge 已完成任务，但没有返回可下载的媒体文件。')
    if (outputs.length > MAX_BRIDGE_OUTPUT_FILES) throw new BridgeRequestError(`Comfy Bridge 返回的输出文件超过 ${MAX_BRIDGE_OUTPUT_FILES} 个限制。`)
    const manifests = outputs.map(bridgeOutputManifest)
    const totalBytes = manifests.reduce((total, output) => total + output.size, 0)
    if (!Number.isSafeInteger(totalBytes) || totalBytes > COMFY_MAX_OUTPUT_TOTAL_BYTES) {
      throw new BridgeRequestError('Comfy Bridge 返回的输出总大小超过本地归档限制。')
    }

    await store.transition(jobId, 'downloading', { progress: 0.8, message: '正在下载 ComfyUI 输出。' })
    await store.transition(jobId, 'archiving', { progress: 0.85, message: '正在归档到项目资料槽。' })
    for (let index = 0; index < manifests.length; index += 1) {
      const output = manifests[index]
      const downloadRequest = createComfyBridgeDownloadRequest(profile, job.remote.bridgeJobId, output.fileName)
      const download = await bridgeFetch(fetchImpl, downloadRequest, profile, {
        binary: true,
        timeoutMs: profile.downloadTimeoutMs,
      })
      try {
        const contentLength = declaredContentLength(download.response)
        if (contentLength !== undefined && contentLength !== output.size) {
          throw new BridgeRequestError('Comfy Bridge 下载长度与任务清单不一致。')
        }
        await store.archiveOutput(jobId, {
          remoteFileName: output.fileName,
          data: download.stream,
          expectedBytes: output.size,
          expectedSha256: output.sha256,
          outputIndex: index + 1,
        })
      } finally {
        download.release()
      }
      await store.update(jobId, { progress: 0.85 + 0.14 * ((index + 1) / manifests.length) })
    }
    return store.transition(jobId, 'completed', { progress: 1, message: '输出已归档到资料槽。' })
  }
  throw new BridgeRequestError('等待 ComfyUI 输出超时。')
}

/**
 * Owns the local server-side queue. Browser code only talks to this API; it
 * never gets a bridge token or a direct route to the cloud ComfyUI instance.
 */
export function createComfyApi(state, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('This Node runtime does not provide fetch().')
  const configOptions = options.configPath ? { configPath: options.configPath } : {}
  const configPath = options.configPath ?? getDefaultComfyConfigPath()
  const pollIntervalMs = Math.max(50, Number(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS))
  const maxPollMs = Math.max(1_000, Number(options.maxPollMs ?? DEFAULT_MAX_POLL_MS))
  const queues = new Map()
  const activeCounts = new Map()
  const drainingProfiles = new Set()
  const scheduled = new Set()
  const executing = new Set()
  const resumedRoots = new Set()
  const recoveringRoots = new Map()

  const loadConfig = async () => {
    const config = await loadComfyConfig(configOptions)
    try {
      await fs.access(configPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      // Materialize the safe placeholder once so the user has one clear file to fill later.
      await saveComfyConfig(config, configOptions)
    }
    return config
  }

  const queueKey = profileId => profileId
  const scheduledKey = (root, jobId) => `${root}\u0000${jobId}`

  const removeQueuedJob = (root, jobId, profileId) => {
    const key = queueKey(profileId)
    const queue = queues.get(key)
    if (!queue?.length) return false
    const next = queue.filter(item => item.root !== root || item.jobId !== jobId)
    if (next.length === queue.length) return false
    queues.set(key, next)
    scheduled.delete(scheduledKey(root, jobId))
    return true
  }

  const executeJob = async (root, jobId) => {
    const store = createComfyJobStore(root)
    try {
      const config = await loadConfig()
      let job = await store.get(jobId)
      if (job.status === 'queued') {
        ({ job } = await submitQueuedJob({ root, store, config, fetchImpl, jobId }))
      }
      if (job.status === 'running') {
        await pollAndArchiveJob({ root, store, config, fetchImpl, jobId, pollIntervalMs, maxPollMs })
      }
    } catch (error) {
      const code = error instanceof FrozenSelectionError
        ? 'REFERENCE_SELECTION_CHANGED'
        : error instanceof ComfyArchiveError
          ? 'OUTPUT_INTEGRITY_FAILED'
          : error instanceof BridgeRequestError
            ? 'BRIDGE_REQUEST_FAILED'
            : 'COMFY_JOB_FAILED'
      await transitionFailed(store, jobId, code, error)
    }
  }

  const drain = async profileId => {
    if (drainingProfiles.has(profileId)) return
    drainingProfiles.add(profileId)
    try {
      const key = queueKey(profileId)
      while ((queues.get(key) ?? []).length) {
        let profile
        try {
          profile = getRunnableComfyProfile(await loadConfig(), profileId)
        } catch (error) {
          const item = queues.get(key).shift()
          if (item) {
            scheduled.delete(scheduledKey(item.root, item.jobId))
            await transitionFailed(createComfyJobStore(item.root), item.jobId, 'PROFILE_UNAVAILABLE', error)
          }
          continue
        }
        const active = activeCounts.get(key) ?? 0
        if (active >= profile.maxConcurrentJobs) return
        const item = queues.get(key).shift()
        if (!item) continue
        const executionKey = scheduledKey(item.root, item.jobId)
        executing.add(executionKey)
        activeCounts.set(key, active + 1)
        void executeJob(item.root, item.jobId).finally(() => {
          executing.delete(executionKey)
          activeCounts.set(key, Math.max(0, (activeCounts.get(key) ?? 1) - 1))
          scheduled.delete(executionKey)
          void drain(profileId)
        })
      }
    } finally {
      drainingProfiles.delete(profileId)
    }
  }

  const schedule = (root, jobId, profileId) => {
    const id = scheduledKey(root, jobId)
    if (scheduled.has(id)) return
    scheduled.add(id)
    const key = queueKey(profileId)
    const queue = queues.get(key) ?? []
    queue.push({ root, jobId })
    queues.set(key, queue)
    void drain(profileId)
  }

  const resumeRemoteJobs = async root => {
    if (resumedRoots.has(root)) return
    const existing = recoveringRoots.get(root)
    if (existing) return existing
    const recovery = (async () => {
      try {
        const store = createComfyJobStore(root)
        const jobs = await store.list()
        for (const job of jobs) {
          if (job.status === 'queued') {
            schedule(root, job.id, job.profileId)
            continue
          }
          if (job.status === 'running' && job.remote?.bridgeJobId) {
            schedule(root, job.id, job.profileId)
            continue
          }
          if (['uploading', 'downloading', 'archiving'].includes(job.status)
            || (job.status === 'running' && !job.remote?.bridgeJobId)) {
            await transitionFailed(
              store,
              job.id,
              'RECOVERY_REQUIRED',
              '工作台在本地任务未完成时重启。为避免重复提交或重复归档，请确认资料后重新生成。',
            )
          }
        }
        resumedRoots.add(root)
      } catch (error) {
        console.error('[ai-drama-workbench] 无法恢复 ComfyUI 任务。', error)
      } finally {
        recoveringRoots.delete(root)
      }
    })()
    recoveringRoots.set(root, recovery)
    return recovery
  }

  // Recover persisted work for every safe project, not only whichever project
  // happened to be active when the host started.
  void Promise.resolve().then(async () => {
    try {
      if (typeof state.listProjects === 'function' && typeof state.resolveProject === 'function') {
        const registry = await state.listProjects()
        for (const project of registry.projects ?? []) {
          try {
            await resumeRemoteJobs((await state.resolveProject(project.id)).root)
          } catch (error) {
            console.error(`[ai-drama-workbench] 无法恢复项目 ${project.id} 的 ComfyUI 任务。`, error)
          }
        }
      } else {
        await resumeRemoteJobs(await state.root())
      }
    } catch (error) {
      console.error('[ai-drama-workbench] 无法在启动时恢复 ComfyUI 任务。', error)
    }
  })

  const handle = async (req, res, url, responseJson) => {
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) return false
    try {
      if (url.pathname === `${API_PREFIX}/config` && req.method === 'GET') {
        responseJson(res, 200, publicConfig(await loadConfig(), configPath))
        return true
      }
      if (url.pathname === `${API_PREFIX}/config/active` && req.method === 'POST') {
        if (!isAllowedOrigin(req)) throw new ComfyApiError(403, '不允许跨来源修改 ComfyUI 配置。')
        const body = await readJson(req)
        const profileId = requireText(body.profileId, '服务器配置', { maximum: 64 })
        const next = setActiveComfyProfile(await loadConfig(), profileId)
        await saveComfyConfig(next, configOptions)
        responseJson(res, 200, publicConfig(next, configPath))
        return true
      }
      if (url.pathname === `${API_PREFIX}/presets` && req.method === 'GET') {
        responseJson(res, 200, { presets: getComfyWorkflowPresets() })
        return true
      }
      const project = await resolveRequestProject(state, url)
      const { root } = project
      if (url.pathname === `${API_PREFIX}/jobs/preview` && req.method === 'POST') {
        if (!isAllowedOrigin(req)) throw new ComfyApiError(403, '不允许跨来源检查 ComfyUI 任务。')
        const plan = await deriveGenerationPlan(root, await readJson(req))
        responseJson(res, 200, { preview: plan.preview })
        return true
      }
      if (url.pathname === `${API_PREFIX}/jobs` && req.method === 'GET') {
        const assetPath = requireText(url.searchParams.get('assetPath'), '资产路径', { maximum: 1_024 })
        const snapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
        if (!['character', 'scene', 'location', 'prop', 'shot'].some(type => findWorkspaceAsset(snapshot, type, assetPath))) {
          throw new ComfyApiError(404, '当前资产不存在或不属于活动项目。')
        }
        await resumeRemoteJobs(root)
        const jobs = await createComfyJobStore(root).list()
        responseJson(res, 200, { jobs: jobs.filter(job => job.target.assetPath === assetPath).map(publicJob) })
        return true
      }
      if (url.pathname === `${API_PREFIX}/jobs` && req.method === 'POST') {
        if (!isAllowedOrigin(req)) throw new ComfyApiError(403, '不允许跨来源提交 ComfyUI 任务。')
        const body = await readJson(req)
        const config = await loadConfig()
        const profileId = optionalText(body.profileId, '服务器配置', { maximum: 64 }) ?? getPublicComfyConfig(config).activeProfile
        const profile = getRunnableComfyProfile(config, profileId)
        const plan = await deriveGenerationPlan(root, body)
        if (plan.preview.errors.length) {
          throw new ComfyApiError(400, plan.preview.errors[0])
        }
        const store = createComfyJobStore(root)
        const job = await store.create({
          profileId: profile.id,
          workflowId: plan.preset.id,
          inputs: plan.inputs,
          uploads: plan.uploads,
          target: plan.target,
        })
        schedule(root, job.id, profile.id)
        responseJson(res, 202, { job: publicJob(job) })
        return true
      }
      const cancelAction = new RegExp(`^${API_PREFIX}/jobs/(job_[A-Za-z0-9-]{8,128})/cancel$`, 'u').exec(url.pathname)
      if (cancelAction && req.method === 'POST') {
        if (!isAllowedOrigin(req)) throw new ComfyApiError(403, '不允许跨来源修改 ComfyUI 任务。')
        await resumeRemoteJobs(root)
        const [, jobId] = cancelAction
        const store = createComfyJobStore(root)
        const job = await store.get(jobId)
        const id = scheduledKey(root, job.id)
        if (job.status !== 'queued') {
          throw new ComfyApiError(409, '只有尚未提交到 Comfy Bridge 的排队任务可以取消。', 'JOB_NOT_CANCELLABLE')
        }
        if (executing.has(id)) {
          throw new ComfyApiError(409, '任务已开始提交，无法安全取消。', 'JOB_ALREADY_STARTING')
        }
        removeQueuedJob(root, job.id, job.profileId)
        const cancelled = await store.transition(job.id, 'cancelled', {
          progress: 0,
          message: '已取消本地排队任务，未请求取消云端 ComfyUI。',
        })
        responseJson(res, 200, { job: publicJob(cancelled) })
        return true
      }
      responseJson(res, 404, { error: '找不到 ComfyUI 工作台接口。' })
      return true
    } catch (error) {
      if (error instanceof ComfyApiError) {
        responseJson(res, error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) })
      } else if (error instanceof ComfyCoreError || error instanceof ProjectPathError || error instanceof ComfyArchiveError || error instanceof ComfyConfigurationError || error instanceof ComfyJobError) {
        responseJson(res, 400, { error: error.message })
      } else {
        console.error('[ai-drama-workbench] ComfyUI 接口异常。', error)
        responseJson(res, 500, { error: 'ComfyUI 工作台操作未能完成。' })
      }
      return true
    }
  }

  return { handle }
}
