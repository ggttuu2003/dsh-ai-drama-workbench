import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  ProjectPathError,
  getAssetWorkspaceSnapshot,
  getProjectRoot,
  resolveExistingPath,
  resolveWritablePath,
} from '../lib/workspace-core.js'

export const VIDEO_CANDIDATE_SLOT_PRIORITY = Object.freeze(['video', 'final', 'candidate'])
export const DEFAULT_VIDEO_ASSEMBLY_PATH = '成片/总片.mp4'
export const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000
const VIDEO_EXTENSIONS = new Set(['.mkv', '.mov', '.mp4', '.webm'])

export class VideoAssemblyError extends ProjectPathError {}

function text(value, label, maximum = 1024) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new VideoAssemblyError(`${label}无效。`)
  }
  return value.trim()
}

function relativePath(value, label) {
  const candidate = text(value, label)
  if (candidate.includes('\\') || candidate.includes('\u0000') || path.isAbsolute(candidate)) {
    throw new VideoAssemblyError(`${label}必须是项目内相对路径。`)
  }
  const normalized = path.posix.normalize(candidate)
  if (normalized !== candidate || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new VideoAssemblyError(`${label}必须是项目内相对路径。`)
  }
  if (normalized.split('/').some(part => !part || part.startsWith('.'))) {
    throw new VideoAssemblyError(`${label}不能访问隐藏路径。`)
  }
  return normalized
}

function outputPath(value = DEFAULT_VIDEO_ASSEMBLY_PATH) {
  const normalized = relativePath(value, '输出路径')
  if (path.posix.dirname(normalized) !== '成片' || path.posix.extname(normalized).toLowerCase() !== '.mp4') {
    throw new VideoAssemblyError('输出路径必须是成片目录下的 MP4 文件。')
  }
  return normalized
}

function nextOutputPath(outputs) {
  const existing = new Set((outputs ?? []).map(file => file.path))
  const first = DEFAULT_VIDEO_ASSEMBLY_PATH
  if (!existing.has(first)) return first
  for (let index = 2; index <= 9999; index += 1) {
    const candidate = `成片/总片-${String(index).padStart(2, '0')}.mp4`
    if (!existing.has(candidate)) return candidate
  }
  throw new VideoAssemblyError('成片目录中没有可用的输出文件名。')
}

function compareShots(left, right) {
  const leftDesign = left?.design ?? {}
  const rightDesign = right?.design ?? {}
  return String(leftDesign.sceneId ?? '').localeCompare(String(rightDesign.sceneId ?? ''), 'zh-Hans-CN', { numeric: true })
    || String(leftDesign.shotId ?? '').localeCompare(String(rightDesign.shotId ?? ''), 'zh-Hans-CN', { numeric: true })
    || String(left.rootPath ?? '').localeCompare(String(right.rootPath ?? ''), 'zh-Hans-CN')
}

function isVideoFile(file) {
  return file?.kind === 'video'
    && (file.size === undefined || file.size > 0)
    && VIDEO_EXTENSIONS.has(path.extname(String(file.name ?? '')).toLowerCase())
}

function candidateFiles(shot) {
  const slots = new Map((shot?.slots ?? []).map(slot => [slot.key, slot]))
  return VIDEO_CANDIDATE_SLOT_PRIORITY.flatMap(slotKey =>
    (slots.get(slotKey)?.files ?? []).filter(isVideoFile).map(file => ({
      path: file.path,
      name: file.name,
      kind: file.kind,
      size: file.size,
      updatedAt: file.updatedAt,
      slot: slotKey,
    })),
  )
}

function newestFirst(files) {
  return [...files].sort((left, right) =>
    String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
      || String(right.name ?? '').localeCompare(String(left.name ?? ''), 'zh-Hans-CN'),
  )
}

function pickDefaultCandidate(candidates, selectedPath) {
  if (selectedPath) return candidates.find(candidate => candidate.path === selectedPath)
  for (const slot of VIDEO_CANDIDATE_SLOT_PRIORITY) {
    const inSlot = newestFirst(candidates.filter(candidate => candidate.slot === slot))
    if (inSlot.length) return inSlot[0]
  }
  return undefined
}

/** Build a side-effect-free plan from an already scanned workspace snapshot. */
export function buildVideoAssemblyPlanFromSnapshot(snapshot, options = {}) {
  if (!snapshot || !Array.isArray(snapshot.shots)) {
    throw new VideoAssemblyError('项目镜头数据无效。')
  }
  const selections = options.selections instanceof Map ? options.selections : new Map()
  const shots = snapshot.shots
    .filter(shot => !shot.isDraft && shot.rootPath)
    .sort(compareShots)
    .map((shot, index) => {
      const candidates = candidateFiles(shot)
      const selectedPath = selections.get(shot.rootPath)
      if (selectedPath !== undefined) relativePath(selectedPath, '镜头视频路径')
      const selected = pickDefaultCandidate(candidates, selectedPath)
      if (selectedPath && !selected) {
        throw new VideoAssemblyError(`镜头 ${shot.design?.shotId || index + 1} 未找到指定的视频候选。`)
      }
      return {
        index: index + 1,
        shotPath: shot.rootPath,
        sceneId: shot.design?.sceneId ?? '',
        shotId: shot.design?.shotId ?? '',
        title: shot.design?.title ?? '',
        duration: shot.design?.duration ?? '',
        status: selected ? 'ready' : 'missing',
        selected: selected ?? null,
        candidates: newestFirst(candidates),
      }
    })
  for (const shotPath of selections.keys()) {
    if (!shots.some(shot => shot.shotPath === shotPath)) {
      throw new VideoAssemblyError('指定的视频选择不属于项目中的镜头。')
    }
  }
  return {
    outputPath: outputPath(options.outputPath),
    shots,
    outputs: newestFirst(Array.isArray(options.outputs) ? options.outputs : []),
    ready: shots.length > 0 && shots.every(shot => shot.status === 'ready'),
    missingShotPaths: shots.filter(shot => shot.status !== 'ready').map(shot => shot.shotPath),
    candidatePriority: [...VIDEO_CANDIDATE_SLOT_PRIORITY],
  }
}

export async function getVideoAssemblyPlan(options = {}) {
  const root = await getProjectRoot()
  const snapshot = await getAssetWorkspaceSnapshot()
  await refreshShotVideoSlots(snapshot)
  const outputs = await scanVideoOutputs(root)
  return buildVideoAssemblyPlanFromSnapshot(snapshot, {
    ...options,
    outputPath: options.outputPath ?? nextOutputPath(outputs),
    outputs,
  })
}

function parseSelections(value) {
  if (value === undefined) return new Map()
  if (!Array.isArray(value) || value.length > 10000) {
    throw new VideoAssemblyError('镜头视频选择无效。')
  }
  const selections = new Map()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new VideoAssemblyError('镜头视频选择无效。')
    }
    const shotPath = relativePath(entry.shotPath, '镜头路径')
    const videoPath = relativePath(entry.videoPath, '镜头视频路径')
    if (selections.has(shotPath)) throw new VideoAssemblyError('同一个镜头不能重复选择视频。')
    selections.set(shotPath, videoPath)
  }
  return selections
}

export function parseVideoAssemblyRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new VideoAssemblyError('合片请求无效。')
  }
  return {
    selections: parseSelections(body.selections),
    outputPath: body.outputPath === undefined ? undefined : outputPath(body.outputPath),
    explicitOutputPath: body.outputPath !== undefined,
  }
}

function concatFileLine(absolutePath) {
  // concat demuxer uses its own quoting rules; no shell is involved.
  return `file '${absolutePath.replaceAll('\\', '\\\\').replaceAll("'", "'\\''")}'`
}

function runFfmpeg(ffmpeg, args) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    let child
    let timedOut = false
    let timeoutHandle
    let killHandle
    const clearTimers = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (killHandle) clearTimeout(killHandle)
    }
    try {
      child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 32 * 1024) stderr = stderr.slice(-32 * 1024)
    })
    timeoutHandle = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {
        // The close handler still owns cleanup when a process exits concurrently.
      }
      killHandle = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // The process may have exited after SIGTERM.
        }
      }, 5000)
    }, FFMPEG_TIMEOUT_MS)
    child.once('error', error => {
      clearTimers()
      reject(error)
    })
    child.once('close', code => {
      clearTimers()
      resolve({ code, stderr, timedOut })
    })
  })
}

async function assertRegularFile(filePath, label) {
  let info
  try {
    info = await fs.lstat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new VideoAssemblyError(`${label}不存在。`)
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new VideoAssemblyError(`${label}必须是普通文件。`)
  if (!info.size) throw new VideoAssemblyError(`${label}不能为空。`)
}

async function readVideoFiles(directory, root) {
  let directoryInfo
  try {
    directoryInfo = await fs.lstat(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new VideoAssemblyError('镜头视频目录必须是普通目录。')
  }
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const absolutePath = path.join(directory, entry.name)
    let info
    try {
      info = await fs.lstat(absolutePath)
    } catch (error) {
      // Generation/archive jobs can publish or clean a file while the list is read.
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (!info.isFile() || info.isSymbolicLink()) continue
    if (!VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
    files.push({
      name: entry.name,
      path: path.relative(root, absolutePath).split(path.sep).join('/'),
      kind: 'video',
      size: info.size,
      updatedAt: info.mtime.toISOString(),
    })
  }
  return files
}

async function refreshShotVideoSlots(snapshot) {
  const root = await getProjectRoot()
  for (const shot of snapshot.shots.filter(item => !item.isDraft && item.rootPath)) {
    let shotDirectory
    try {
      shotDirectory = await resolveExistingPath(shot.rootPath)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    for (const slotKey of VIDEO_CANDIDATE_SLOT_PRIORITY) {
      const slot = shot.slots.find(item => item.key === slotKey)
      if (!slot) continue
      const slotDirectory = path.join(shotDirectory, { video: '成片', final: '定稿', candidate: '候选' }[slotKey])
      const freshVideos = await readVideoFiles(slotDirectory, root)
      slot.files = [
        ...slot.files.filter(file => !isVideoFile(file)),
        ...freshVideos,
      ]
    }
  }
}

async function scanVideoOutputs(root) {
  const directory = path.join(root, '成片')
  const files = await readVideoFiles(directory, root)
  return newestFirst(files)
}

async function ensureOutputDirectory(root) {
  const directory = path.join(root, '成片')
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await fs.lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new VideoAssemblyError('成片目录必须是普通目录。')
  return directory
}

async function ensureWorkbenchDirectory(root) {
  const directory = path.join(root, '.workbench')
  try {
    const info = await fs.lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new VideoAssemblyError('工作台内部目录必须是普通目录。')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await fs.mkdir(directory, { recursive: false, mode: 0o700 })
    const info = await fs.lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new VideoAssemblyError('工作台内部目录必须是普通目录。')
  }
  return directory
}

/** Merge the selected shot videos and publish the result with an atomic rename. */
export async function assembleProjectVideo(request = {}) {
  const parsed = parseVideoAssemblyRequest(request)
  const plan = await getVideoAssemblyPlan(parsed)
  if (!plan.shots.length) throw new VideoAssemblyError('项目中没有可合并的镜头。')
  if (!plan.ready) throw new VideoAssemblyError(`仍有 ${plan.missingShotPaths.length} 个镜头没有可用视频。`)

  const root = await getProjectRoot()
  const selectedPaths = []
  for (const shot of plan.shots) {
    const candidate = shot.selected
    const absolutePath = await resolveExistingPath(candidate.path)
    await assertRegularFile(absolutePath, `镜头 ${shot.shotId || shot.index} 的视频`)
    selectedPaths.push(absolutePath)
  }

  const outputRelativePath = plan.outputPath
  const outputAbsolutePath = await resolveWritablePath(outputRelativePath)
  const outputDirectory = await ensureOutputDirectory(root)
  if (path.dirname(outputAbsolutePath) !== outputDirectory) {
    throw new VideoAssemblyError('输出路径必须位于成片目录。')
  }
  try {
    const existing = await fs.lstat(outputAbsolutePath)
    if (existing.isSymbolicLink() || !existing.isFile()) throw new VideoAssemblyError('输出文件必须是普通文件。')
    if (!parsed.explicitOutputPath) throw new VideoAssemblyError('默认总片已存在，请重新合片或指定输出路径。')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const token = randomUUID()
  const listPath = path.join(root, '.workbench', `video-assembly-${token}.txt`)
  const temporaryOutput = path.join(outputDirectory, `.${path.basename(outputAbsolutePath)}.${token}.tmp.mp4`)
  const ffmpeg = process.env.DSH_AI_DRAMA_FFMPEG_PATH?.trim()
    || process.env.WORKBENCH_FFMPEG_PATH?.trim()
    || 'ffmpeg'
  try {
    const workbenchDirectory = await ensureWorkbenchDirectory(root)
    if (path.dirname(listPath) !== workbenchDirectory) throw new VideoAssemblyError('合片临时目录无效。')
    await fs.writeFile(listPath, `${selectedPaths.map(concatFileLine).join('\n')}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    const result = await runFfmpeg(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', temporaryOutput,
    ])
    if (result.timedOut) throw new VideoAssemblyError('ffmpeg 合片超时（最长 30 分钟）。')
    if (result.code !== 0) {
      const detail = result.stderr.trim()
      throw new VideoAssemblyError(detail ? `ffmpeg 合片失败：${detail}` : 'ffmpeg 合片失败。')
    }
    await assertRegularFile(temporaryOutput, 'ffmpeg 输出文件')
    if (parsed.explicitOutputPath) {
      await fs.rename(temporaryOutput, outputAbsolutePath)
    } else {
      try {
        // A hard link publishes without replacing a file another merge may have created.
        await fs.link(temporaryOutput, outputAbsolutePath)
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw new VideoAssemblyError('默认总片已存在，请重新合片或指定输出路径。')
        }
        throw error
      }
      await fs.rm(temporaryOutput, { force: true })
    }
  } catch (error) {
    if (error?.code === 'ENOENT' && error?.path === ffmpeg) {
      throw new VideoAssemblyError('未找到 ffmpeg，无法合并视频。')
    }
    throw error
  } finally {
    await fs.rm(listPath, { force: true }).catch(() => undefined)
    await fs.rm(temporaryOutput, { force: true }).catch(() => undefined)
  }

  const info = await fs.stat(outputAbsolutePath)
  const file = {
    name: path.basename(outputRelativePath),
    path: outputRelativePath,
    kind: 'video',
    size: info.size,
    updatedAt: info.mtime.toISOString(),
  }
  return {
    ok: true,
    path: outputRelativePath,
    file,
    output: file,
    plan: {
      ...plan,
      outputPath: outputRelativePath,
      outputs: newestFirst([...(plan.outputs ?? []), file]),
    },
  }
}
