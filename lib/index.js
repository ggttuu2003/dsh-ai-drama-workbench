import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { createComfyApi } from './comfy-api.js'
import { loadComfyConfig } from './comfy-core.js'
import { handleWorkbenchRequest } from './workbench-api.js'

export const name = 'ai-drama-workbench'
export const inject = ['webServer', 'tools']

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PLANNER_BRIDGE = path.resolve(MODULE_DIR, '..', 'engine', 'planner_bridge.py')
const STATE_PATH = process.env.DSH_AI_DRAMA_STATE_PATH
  ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'ai-drama-workbench.json')
const SSH_CONFIG_PATH = process.env.DSH_AI_DRAMA_SSH_STATE_PATH
  ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'ai-drama-workbench-ssh.json')
const SSH_CONFIG_VERSION = 1
const SSH_STATUS_INTERVAL_MS = 10_000
const SSH_PORT_MIN = 1
const SSH_PORT_MAX = 65_535
const SSH_PASSWORD_MAX = 4_096
const SSH_PASSWORD_ENV = 'DSH_AI_DRAMA_SSH_PASSWORD'
let sshProcess = null
let sshProcessError = ''
let sshAskpassCleanup = null

const MAX_BODY_BYTES = 1024 * 1024
const MAX_TEXT_BYTES = 256 * 1024
const MAX_SLOT_ITEMS = 80
const PROJECT_STATE_VERSION = 2
const MAX_PROJECT_NAME_LENGTH = 120
const CHARACTER_SLOTS = ['三视图', '定妆', '参考图']
const SCENE_SLOTS = ['场景图', '参考图', '首帧', '尾帧', '候选', '定稿', '成片']
const SHOT_SLOTS = ['参考图', '首帧', '尾帧', '候选', '定稿', '成片']
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v'])
const SELECTED_SUFFIX = /(?:-|_)已选$/u
const ROLE_CATEGORIES = new Set(['待分类', '主角', '女主', '重要配角', '配角', '反派', '群像', '其他'])

class WorkbenchError extends Error {}

function sshText(value, label, maximum = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\0\r\n]/u.test(value)) {
    throw new WorkbenchError(`${label}无效。`)
  }
  return value.trim()
}

function sshPort(value, label) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < SSH_PORT_MIN || port > SSH_PORT_MAX) {
    throw new WorkbenchError(`${label}必须是 1 到 65535 之间的端口。`)
  }
  return port
}

function sshPassword(value) {
  if (typeof value !== 'string' || !value || value.length > SSH_PASSWORD_MAX || /[\0\r\n]/u.test(value)) {
    throw new WorkbenchError('SSH 密码无效，不能为空且不能包含换行。')
  }
  return value
}

function normalizeSshConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkbenchError('SSH 配置格式无效。')
  const config = {
    version: SSH_CONFIG_VERSION,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '云服务器',
    host: value.host ? sshText(value.host, 'SSH 主机') : '',
    port: value.port === undefined || value.port === '' ? 22 : sshPort(value.port, 'SSH 端口'),
    user: value.user ? sshText(value.user, 'SSH 用户名', 120) : '',
    localPort: value.localPort === undefined || value.localPort === '' ? 8188 : sshPort(value.localPort, '本地端口'),
    remoteHost: value.remoteHost ? sshText(value.remoteHost, '远端转发主机', 120) : '127.0.0.1',
    remotePort: value.remotePort === undefined || value.remotePort === '' ? 8188 : sshPort(value.remotePort, '远端转发端口'),
  }
  return config
}

async function readSshConfig() {
  try {
    const parsed = JSON.parse(await fs.readFile(SSH_CONFIG_PATH, 'utf8'))
    return normalizeSshConfig(parsed)
  } catch (error) {
    if (error && error.code === 'ENOENT') return normalizeSshConfig()
    if (error instanceof WorkbenchError) throw error
    throw new WorkbenchError('无法读取 SSH 配置文件。')
  }
}

async function writeSshConfig(value) {
  const config = normalizeSshConfig(value)
  await fs.mkdir(path.dirname(SSH_CONFIG_PATH), { recursive: true, mode: 0o700 })
  const temporary = `${SSH_CONFIG_PATH}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, SSH_CONFIG_PATH)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw new WorkbenchError(`无法保存 SSH 配置：${errorMessage(error)}`)
  }
  return config
}

// OpenSSH only asks for a password through SSH_ASKPASS when it has no TTY.
// Keep the helper itself secret-free and remove it as soon as the tunnel exits.
async function createSshAskpass() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-ssh-'))
  const helperPath = path.join(directory, 'askpass.sh')
  const helper = '#!/bin/sh\n'
    + 'if [ "$' + '{' + SSH_PASSWORD_ENV + '+x}" != x ]; then exit 1; fi\n'
    + 'printf \'%s\\n\' "$' + SSH_PASSWORD_ENV + '"\n'
  try {
    await fs.writeFile(helperPath, helper, { encoding: 'utf8', flag: 'wx', mode: 0o700 })
    await fs.chmod(helperPath, 0o700)
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw new WorkbenchError(`无法创建 SSH 密码助手：${errorMessage(error)}`)
  }
  return {
    path: helperPath,
    cleanup: async () => fs.rm(directory, { recursive: true, force: true }).catch(() => undefined),
  }
}

function releaseSshAskpass(cleanup) {
  if (typeof cleanup !== 'function') return
  if (sshAskpassCleanup === cleanup) sshAskpassCleanup = null
  void cleanup()
}

function cleanupSshAskpass() {
  const cleanup = sshAskpassCleanup
  sshAskpassCleanup = null
  releaseSshAskpass(cleanup)
}

function sshPublicConfig(config, status) {
  return {
    configured: Boolean(config.host && config.user),
    name: config.name,
    host: config.host,
    port: config.port,
    user: config.user,
    localPort: config.localPort,
    remoteHost: config.remoteHost,
    remotePort: config.remotePort,
    status,
  }
}

function checkLocalPort(port, timeoutMs = 700) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const finish = value => { socket.destroy(); resolve(value) }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function getSshStatus(config = undefined) {
  const resolvedConfig = config ?? await readSshConfig()
  if (!resolvedConfig.host || !resolvedConfig.user) return { state: 'unconfigured', label: '未配置' }
  if (sshProcess && !sshProcess.killed) {
    const open = await checkLocalPort(resolvedConfig.localPort)
    if (!open) return { state: 'connecting', label: '连接中' }
    try {
      const comfy = await loadComfyConfig()
      const profile = comfy.profiles.find(item => item.id === comfy.activeProfile)
      if (!profile?.enabled || !profile.token) return { state: 'error', label: 'Bridge 未配置', detail: 'SSH 已建立，但 Comfy Bridge 配置不完整。' }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3_000)
      try {
        const response = await fetch(`http://127.0.0.1:${resolvedConfig.localPort}/health`, {
          headers: { authorization: `Bearer ${profile.token}` }, signal: controller.signal,
        })
        if (!response.ok) return { state: 'error', label: 'Bridge 异常', detail: `SSH 已建立，但 Comfy Bridge 返回 HTTP ${response.status}。` }
        return { state: 'connected', label: '已连接', detail: `SSH 隧道和 Comfy Bridge 均正常（127.0.0.1:${resolvedConfig.localPort}）。` }
      } finally { clearTimeout(timer) }
    } catch (error) {
      const detail = error?.name === 'AbortError' ? 'Comfy Bridge 健康检查超时。' : `无法连接 Comfy Bridge：${errorMessage(error)}`
      return { state: 'error', label: 'Bridge 异常', detail }
    }
  }
  return sshProcessError
    ? { state: 'error', label: '连接异常', detail: sshProcessError }
    : { state: 'stopped', label: '已停止' }
}

async function startSshTunnel(rawConfig) {
  const input = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {}
  const config = normalizeSshConfig(input)
  if (!config.host || !config.user) throw new WorkbenchError('SSH 主机和用户名不能为空。')
  const password = sshPassword(input.password)
  if (sshProcess && !sshProcess.killed) {
    const saved = await writeSshConfig(config)
    return sshPublicConfig(saved, await getSshStatus(saved))
  }
  const saved = await writeSshConfig(config)
  const destination = `${config.user}@${config.host}`
  const args = ['-N', '-T', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=15', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-p', String(config.port), '-L', `127.0.0.1:${config.localPort}:${config.remoteHost}:${config.remotePort}`]
  args.push('-o', 'BatchMode=no', '-o', 'PubkeyAuthentication=no', '-o', 'PasswordAuthentication=yes', '-o', 'PreferredAuthentications=password', '-o', 'ControlPath=none', '-o', 'IdentityAgent=none')
  args.push(destination)
  sshProcessError = ''
  let askpass = null
  let transientPassword = password
  let environment = process.env
  try {
    askpass = await createSshAskpass()
    sshAskpassCleanup = askpass.cleanup
    environment = {
      ...process.env,
      SSH_ASKPASS: askpass.path,
      SSH_ASKPASS_REQUIRE: 'force',
      // Older macOS OpenSSH releases also require a non-empty DISPLAY.
      DISPLAY: process.env.DISPLAY || ':0',
      [SSH_PASSWORD_ENV]: password,
    }
    const child = spawn('ssh', args, { env: environment, stdio: ['ignore', 'ignore', 'pipe'] })
    sshProcess = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      const text = String(chunk).trim()
      sshProcessError = (transientPassword && text.includes(transientPassword)
        ? text.split(transientPassword).join('[已隐藏]')
        : text).slice(-500)
    })
    const release = () => {
      transientPassword = ''
      releaseSshAskpass(askpass?.cleanup)
    }
    child.once('error', error => {
      sshProcessError = errorMessage(error)
      release()
    })
    child.once('close', code => {
      if (code !== 0) sshProcessError = sshProcessError || `ssh 已退出（${code}）`
      release()
      if (sshProcess === child) sshProcess = null
    })
  } catch (error) {
    transientPassword = ''
    releaseSshAskpass(askpass?.cleanup)
    throw error
  }
  return sshPublicConfig(saved, await getSshStatus(saved))
}

async function stopSshTunnel() {
  if (sshProcess && !sshProcess.killed) {
    sshProcess.kill('SIGTERM')
    sshProcess = null
  }
  cleanupSshAskpass()
  return sshPublicConfig(await readSshConfig(), await getSshStatus())
}

async function handleSshRequest(req, res, url) {
  if (!url.pathname.startsWith('/ai-drama/api/ssh')) return false
  if (req.method === 'GET') {
    const config = await readSshConfig()
    return responseJson(res, 200, sshPublicConfig(config, await getSshStatus(config))) || true
  }
  requireSameOrigin(req)
  const body = await readRequestJson(req)
  if (url.pathname === '/ai-drama/api/ssh/config' && req.method === 'POST') {
    const config = await writeSshConfig(body)
    return responseJson(res, 200, sshPublicConfig(config, await getSshStatus(config))) || true
  }
  if (url.pathname === '/ai-drama/api/ssh/start' && req.method === 'POST') {
    const saved = await readSshConfig()
    const config = Object.keys(body).length ? { ...saved, ...body } : saved
    return responseJson(res, 200, await startSshTunnel(config)) || true
  }
  if (url.pathname === '/ai-drama/api/ssh/stop' && req.method === 'POST') {
    return responseJson(res, 200, await stopSshTunnel()) || true
  }
  throw new WorkbenchError('找不到 SSH 接口。')
}

function jsonText(value) {
  return JSON.stringify(value, null, 2)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function redactPlannerProjectPaths(value) {
  if (Array.isArray(value)) return value.map(redactPlannerProjectPaths)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const [key, nested] of Object.entries(value)) {
    // The model only needs stable asset-relative paths and the project
    // fingerprint. Never hand it an absolute local project path to reuse.
    if (key === 'project_path') continue
    result[key] = redactPlannerProjectPaths(nested)
  }
  return result
}

function responseJson(res, status, value) {
  if (res.headersSent) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function responseError(res, error) {
  const status = error instanceof WorkbenchError ? 400 : 500
  responseJson(res, status, { ok: false, error: errorMessage(error) })
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
  if (!origin) {
    // Browser writes include Origin. Origin-less local command-line requests are
    // accepted only when the socket is provably loopback (tests have no socket).
    return !req.socket?.remoteAddress || isLoopbackAddress(req.socket.remoteAddress)
  }
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

function requireSameOrigin(req) {
  if (!isAllowedOrigin(req)) {
    throw new WorkbenchError('不允许跨来源修改工作台项目。')
  }
}

async function readRequestJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new WorkbenchError('请求内容超过 1 MB。')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new WorkbenchError('请求 JSON 必须是对象。')
    }
    return parsed
  } catch (error) {
    if (error instanceof WorkbenchError) throw error
    throw new WorkbenchError('请求 JSON 格式无效。')
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function normalizedRelative(root, target) {
  const relative = path.relative(root, target)
  if (!isWithin(root, target)) throw new WorkbenchError('目标不在当前项目目录内。')
  return relative.split(path.sep).join('/')
}

async function exists(target) {
  try {
    await fs.lstat(target)
    return true
  } catch (error) {
    if (error && error.code === 'ENOENT') return false
    throw error
  }
}

async function normalDirectory(target, label) {
  try {
    const info = await fs.lstat(target)
    if (info.isSymbolicLink()) throw new WorkbenchError(`${label} 不能是软链接。`)
    return info.isDirectory()
  } catch (error) {
    if (error && error.code === 'ENOENT') return false
    throw error
  }
}

async function normalFile(target) {
  try {
    const info = await fs.lstat(target)
    return info.isFile() && !info.isSymbolicLink()
  } catch (error) {
    if (error && error.code === 'ENOENT') return false
    throw error
  }
}

function normalizeProjectId(value, label = '项目名称') {
  if (typeof value !== 'string') throw new WorkbenchError(`${label}必须是文本。`)
  const projectId = value.trim()
  if (
    !projectId
    || projectId.length > MAX_PROJECT_NAME_LENGTH
    || projectId.startsWith('.')
    || projectId === '.'
    || projectId === '..'
    || projectId !== path.basename(projectId)
    || /[\\/\\\\\0-\x1f]/u.test(projectId)
  ) {
    throw new WorkbenchError(`${label}只能使用单层目录名，不能包含路径分隔符或控制字符。`)
  }
  return projectId
}

async function resolveProjectLibraryRoot(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new WorkbenchError('尚未配置 AI 漫剧资产库目录。')
  }
  const input = rawPath.trim()
  if (input.length > 4096 || !path.isAbsolute(input)) {
    throw new WorkbenchError('资产库目录必须是有效的绝对路径。')
  }
  let root
  try {
    root = await fs.realpath(input)
  } catch {
    throw new WorkbenchError('无法访问配置的 AI 漫剧资产库目录。')
  }
  const home = await fs.realpath(os.homedir())
  if (root === path.parse(root).root || root === home) {
    throw new WorkbenchError('资产库目录不能是系统根目录或整个用户目录。')
  }
  const info = await fs.stat(root)
  if (!info.isDirectory()) throw new WorkbenchError('资产库目录必须是普通目录。')
  return root
}

function projectDirectoryCandidate(libraryRoot, projectId) {
  const id = normalizeProjectId(projectId, '项目 ID')
  const candidate = path.resolve(libraryRoot, id)
  if (!isWithin(libraryRoot, candidate) || path.dirname(candidate) !== libraryRoot) {
    throw new WorkbenchError('项目必须位于资产库的一级目录中。')
  }
  return { id, candidate }
}

async function resolveLibraryProject(libraryRoot, projectId) {
  const { id, candidate } = projectDirectoryCandidate(libraryRoot, projectId)
  let info
  try {
    info = await fs.lstat(candidate)
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new WorkbenchError('找不到所选项目。')
    throw error
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new WorkbenchError('项目目录必须是资产库中的普通一级目录。')
  }
  const actual = await fs.realpath(candidate)
  if (actual !== candidate || !isWithin(libraryRoot, actual)) {
    throw new WorkbenchError('不允许使用包含软链接的项目目录。')
  }
  return { id, root: actual }
}

async function isInitializedProject(projectRoot) {
  const characterDirectory = path.join(projectRoot, '主要人物')
  const storyboardDirectory = path.join(projectRoot, '分镜')
  try {
    const [characters, storyboard] = await Promise.all([
      fs.lstat(characterDirectory),
      fs.lstat(storyboardDirectory),
    ])
    if (!characters.isDirectory() || characters.isSymbolicLink()
      || !storyboard.isDirectory() || storyboard.isSymbolicLink()) return false

    // Projects created before the multi-project workbench often have the two
    // real asset roots but no project-settings Markdown yet. Treat those as
    // usable legacy projects instead of making the project picker mislabel
    // the user's existing work as uninitialized.
    try {
      const document = await fs.lstat(path.join(projectRoot, '项目设定.md'))
      return document.isFile() && !document.isSymbolicLink()
    } catch (error) {
      return Boolean(error && error.code === 'ENOENT')
    }
  } catch {
    return false
  }
}

async function resolveProjectRoot(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new WorkbenchError('请先输入具体的项目绝对路径。')
  }
  if (rawPath.length > 4096 || !path.isAbsolute(rawPath)) {
    throw new WorkbenchError('项目路径必须是有效的绝对路径。')
  }
  let root
  try {
    root = await fs.realpath(rawPath.trim())
  } catch {
    throw new WorkbenchError('无法访问该项目路径。')
  }
  const home = await fs.realpath(os.homedir())
  if (root === path.parse(root).root || root === home) {
    throw new WorkbenchError('请指定具体项目目录，不要使用系统根目录或整个用户目录。')
  }
  const info = await fs.stat(root)
  if (!info.isDirectory()) throw new WorkbenchError('项目路径必须是目录。')
  return root
}

async function resolveExistingProjectChild(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.length > 4096) {
    throw new WorkbenchError('媒体路径无效。')
  }
  if (path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new WorkbenchError('媒体路径必须相对当前项目。')
  }
  const candidate = path.resolve(root, relativePath)
  if (!isWithin(root, candidate)) throw new WorkbenchError('媒体路径越界。')
  let info
  try {
    info = await fs.lstat(candidate)
  } catch {
    throw new WorkbenchError('找不到该媒体文件。')
  }
  if (info.isSymbolicLink()) throw new WorkbenchError('不允许读取软链接媒体。')
  let real
  try {
    real = await fs.realpath(candidate)
  } catch {
    throw new WorkbenchError('无法解析该媒体文件。')
  }
  if (!isWithin(root, real)) throw new WorkbenchError('媒体文件越出当前项目。')
  return real
}

function mediaKind(fileName) {
  const extension = path.extname(fileName).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return undefined
}

function contentType(fileName) {
  const extension = path.extname(fileName).toLowerCase()
  return {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
  }[extension] ?? 'application/octet-stream'
}

function parseByteRange(value, totalSize) {
  if (typeof value !== 'string' || totalSize <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim())
  if (!match || (!match[1] && !match[2])) return null
  const startValue = match[1] ? Number(match[1]) : null
  const endValue = match[2] ? Number(match[2]) : null
  if ((startValue !== null && !Number.isSafeInteger(startValue)) || (endValue !== null && !Number.isSafeInteger(endValue))) {
    return null
  }
  if (startValue === null) {
    if (endValue === null || endValue <= 0) return null
    const start = Math.max(totalSize - endValue, 0)
    return { start, end: totalSize - 1 }
  }
  if (startValue >= totalSize) return null
  const end = endValue === null ? totalSize - 1 : Math.min(endValue, totalSize - 1)
  return end >= startValue ? { start: startValue, end } : null
}

function isSelectedFile(fileName) {
  return SELECTED_SUFFIX.test(path.parse(fileName).name)
}

function removeSelectedSuffix(fileName) {
  const extension = path.extname(fileName)
  const stem = path.basename(fileName, extension)
  return `${stem.replace(SELECTED_SUFFIX, '')}${extension}`
}

function addSelectedSuffix(fileName) {
  if (isSelectedFile(fileName)) return fileName
  const extension = path.extname(fileName)
  const stem = path.basename(fileName, extension)
  return `${stem}-已选${extension}`
}

function parseHeading(markdown, fallback) {
  const found = markdown.split(/\r?\n/u).find(line => line.trim().startsWith('# '))
  return found ? found.trim().slice(2).trim() || fallback : fallback
}

function parseRoleCategory(markdown) {
  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trim()
    const match = /^(?:[-*]\s*)?(?:\*\*)?(?:角色分类|人物分类|角色类型|人物类型)(?:\s*[：:]\*\*|\*\*\s*[：:]|\s*[：:])\s*(.+?)\s*$/u.exec(line)
    if (!match) continue
    const role = match[1].trim()
    return ROLE_CATEGORIES.has(role) ? role : '待分类'
  }
  return '待分类'
}

function previewText(markdown) {
  return markdown
    .split(/\r?\n/u)
    .map(line => line.replace(/^\s*(?:#|[-*]|>)+\s*/u, '').trim())
    .find(line => line && !line.startsWith('<!--'))
    ?.slice(0, 100) ?? ''
}

async function readSmallText(target, warnings) {
  if (!(await normalFile(target))) return ''
  try {
    const stats = await fs.stat(target)
    if (stats.size > MAX_TEXT_BYTES) {
      warnings.push(`${path.basename(target)} 超过 256 KB，未读取正文。`)
      return ''
    }
    return await fs.readFile(target, 'utf8')
  } catch {
    warnings.push(`无法读取 ${path.basename(target)}。`)
    return ''
  }
}

async function visibleChildren(directory, warnings) {
  if (!(await normalDirectory(directory, `目录 ${path.basename(directory)}`))) return []
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    warnings.push(`无法读取目录 ${path.basename(directory)}。`)
    return []
  }
  const children = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const target = path.join(directory, entry.name)
    let info
    try {
      info = await fs.lstat(target)
    } catch {
      warnings.push(`无法读取 ${entry.name}，已跳过。`)
      continue
    }
    if (info.isSymbolicLink()) {
      warnings.push(`已跳过软链接：${entry.name}`)
      continue
    }
    if (!info.isDirectory() && !info.isFile()) continue
    children.push({ name: entry.name, target, info })
  }
  return children.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
}

async function scanSlot(root, slotPath, warnings) {
  const slotName = path.basename(slotPath)
  const items = await visibleChildren(slotPath, warnings)
  const media = []
  for (const item of items) {
    if (!item.info.isFile()) continue
    const kind = mediaKind(item.name)
    if (!kind) continue
    media.push({
      name: item.name,
      path: normalizedRelative(root, item.target),
      url: `/ai-drama/media?path=${encodeURIComponent(normalizedRelative(root, item.target))}`,
      kind,
      selected: isSelectedFile(item.name),
      size: item.info.size,
      updatedAt: item.info.mtime.toISOString(),
    })
    if (media.length >= MAX_SLOT_ITEMS) {
      warnings.push(`${slotName} 最多展示 ${MAX_SLOT_ITEMS} 个媒体文件。`)
      break
    }
  }
  media.sort((left, right) => Number(right.selected) - Number(left.selected) || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  return { name: slotName, media, selected: media.find(item => item.selected) ?? null }
}

async function scanSlots(root, basePath, slotNames, warnings) {
  const slots = []
  for (const slotName of slotNames) slots.push(await scanSlot(root, path.join(basePath, slotName), warnings))
  return slots
}

function firstMedia(slots) {
  for (const slot of slots) {
    if (slot.selected) return slot.selected
  }
  for (const slot of slots) {
    if (slot.media[0]) return slot.media[0]
  }
  return null
}

function parseLookDirectory(name) {
  const match = /^((?:[A-Za-z0-9]+-)?LOOK-\d{1,6})(?:[-_\s]+(.+))?$/iu.exec(name)
  return match ? { id: match[1].toUpperCase(), name: (match[2] || match[1]).trim() } : { id: name, name }
}

async function scanProjectWorkspace(root) {
  const warnings = []
  const characters = []
  const characterRoot = path.join(root, '主要人物')
  for (const item of await visibleChildren(characterRoot, warnings)) {
    if (!item.info.isDirectory()) continue
    const profilePath = path.join(item.target, '角色设定.md')
    const profile = await readSmallText(profilePath, warnings)
    const identitySlots = await scanSlots(root, item.target, CHARACTER_SLOTS, warnings)
    const looks = []
    for (const look of await visibleChildren(path.join(item.target, '造型'), warnings)) {
      if (!look.info.isDirectory()) continue
      const parsed = parseLookDirectory(look.name)
      const document = await readSmallText(path.join(look.target, '造型设定.md'), warnings)
      const slots = await scanSlots(root, look.target, CHARACTER_SLOTS, warnings)
      looks.push({
        ...parsed,
        path: normalizedRelative(root, look.target),
        title: parseHeading(document, parsed.name),
        description: previewText(document),
        documentPath: normalizedRelative(root, path.join(look.target, '造型设定.md')),
        documentContent: document,
        slots,
        preview: firstMedia(slots),
      })
    }
    looks.sort((left, right) => left.id.localeCompare(right.id, 'en') || left.name.localeCompare(right.name, 'zh-Hans-CN'))
    characters.push({
      name: item.name,
      path: normalizedRelative(root, item.target),
      role: parseRoleCategory(profile),
      title: parseHeading(profile, item.name),
      description: previewText(profile),
      profilePath: normalizedRelative(root, profilePath),
      profileContent: profile,
      identitySlots,
      preview: firstMedia(identitySlots),
      looks,
    })
  }
  characters.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))

  const scenes = []
  const sceneRoot = path.join(root, '分镜')
  for (const scene of await visibleChildren(sceneRoot, warnings)) {
    if (!scene.info.isDirectory()) continue
    const sceneMarkdown = await readSmallText(path.join(scene.target, '场次.md'), warnings)
    const slots = await scanSlots(root, scene.target, SCENE_SLOTS, warnings)
    const shots = []
    for (const child of await visibleChildren(scene.target, warnings)) {
      if (!child.info.isDirectory()) continue
      const shotMarkdownPath = path.join(child.target, '镜头.md')
      if (!(await normalFile(shotMarkdownPath))) continue
      const markdown = await readSmallText(shotMarkdownPath, warnings)
      const shotSlots = await scanSlots(root, child.target, SHOT_SLOTS, warnings)
      const id = /^((?:SH)?\d+)/iu.exec(child.name)?.[1]?.toUpperCase() ?? child.name
      shots.push({
        id,
        name: child.name,
        path: normalizedRelative(root, child.target),
        title: parseHeading(markdown, child.name),
        description: previewText(markdown),
        designPath: normalizedRelative(root, shotMarkdownPath),
        designContent: markdown,
        slots: shotSlots,
        preview: firstMedia(shotSlots),
      })
    }
    shots.sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true }))
    scenes.push({
      id: scene.name,
      path: normalizedRelative(root, scene.target),
      title: parseHeading(sceneMarkdown, scene.name),
      description: previewText(sceneMarkdown),
      scenePath: normalizedRelative(root, path.join(scene.target, '场次.md')),
      sceneContent: sceneMarkdown,
      castPath: normalizedRelative(root, path.join(scene.target, '出场与造型表.md')),
      castContent: await readSmallText(path.join(scene.target, '出场与造型表.md'), warnings),
      slots,
      preview: firstMedia(slots),
      shots,
    })
  }
  scenes.sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true }))

  return {
    ok: true,
    projectPath: root,
    projectName: path.basename(root),
    characters,
    scenes,
    counts: {
      characters: characters.length,
      looks: characters.reduce((sum, character) => sum + character.looks.length, 0),
      scenes: scenes.length,
      shots: scenes.reduce((sum, scene) => sum + scene.shots.length, 0),
    },
    warnings: [...new Set(warnings)],
    scannedAt: new Date().toISOString(),
  }
}

export class WorkbenchState {
  constructor(config = {}) {
    this.defaultProjectPath = typeof config.defaultProjectPath === 'string'
      ? config.defaultProjectPath : (process.env.DSH_AI_DRAMA_PROJECT ?? '')
    this.configuredLibraryPath = typeof config.projectLibraryPath === 'string' ? config.projectLibraryPath : ''
    this.libraryLabel = typeof config.projectLibraryLabel === 'string' && config.projectLibraryLabel.trim()
      ? config.projectLibraryLabel.trim() : 'AI 漫剧资产库'
    this.statePath = typeof config.statePath === 'string' && config.statePath.trim() ? config.statePath.trim() : STATE_PATH
    this.projectLibraryRoot = ''
    this.activeProjectId = ''
    this.initialized = null
    this.libraryOperationTail = Promise.resolve()
  }

  async persist() {
    const stateDirectory = path.dirname(this.statePath)
    await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 })
    const temporary = `${this.statePath}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify({
        version: PROJECT_STATE_VERSION,
        libraryRoot: this.projectLibraryRoot,
        activeProjectId: this.activeProjectId,
      }, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await fs.rename(temporary, this.statePath)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async withLibraryOperation(operation) {
    const previous = this.libraryOperationTail
    let release = () => undefined
    const gate = new Promise(resolve => { release = resolve })
    this.libraryOperationTail = previous.then(() => gate, () => gate)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async initialize() {
    if (this.initialized) return this.initialized
    this.initialized = (async () => {
      let persisted = {}
      try {
        const content = await fs.readFile(this.statePath, 'utf8')
        const parsed = JSON.parse(content)
        if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') persisted = parsed
      } catch (error) {
        if (!(error && error.code === 'ENOENT')) {
          console.warn('[ai-drama-workbench] 无法读取工作台状态，将迁移到受控项目库。')
        }
      }

      const persistedLibraryPath = typeof persisted.libraryRoot === 'string' ? persisted.libraryRoot : ''
      const persistedProjectId = typeof persisted.activeProjectId === 'string' ? persisted.activeProjectId : ''
      const legacyProjectPath = typeof persisted.projectPath === 'string' ? persisted.projectPath : this.defaultProjectPath
      let legacyProjectRoot = ''
      if (legacyProjectPath) {
        try {
          // This accepts only a locally saved legacy value during one-time migration.
          legacyProjectRoot = await resolveProjectRoot(legacyProjectPath)
        } catch (error) {
          if (!this.configuredLibraryPath && !process.env.DSH_AI_DRAMA_LIBRARY_ROOT && !persistedLibraryPath) {
            throw new WorkbenchError('旧项目路径不可用；请配置 projectLibraryPath 或 DSH_AI_DRAMA_LIBRARY_ROOT。')
          }
        }
      }

      const librarySource = this.configuredLibraryPath
        || process.env.DSH_AI_DRAMA_LIBRARY_ROOT
        || persistedLibraryPath
        || (legacyProjectRoot ? path.dirname(legacyProjectRoot) : '')
      this.projectLibraryRoot = await resolveProjectLibraryRoot(librarySource)

      let activeProjectId = ''
      // A configured library is an explicit workspace boundary.  Never carry
      // an active ID across libraries merely because a project with the same
      // name exists in both locations; doing so would silently open the wrong
      // project after a machine/profile switch.  Compare canonical paths so a
      // harmless symlink/relative spelling change within the same library is
      // still treated as the same store.
      const explicitLibrarySource = this.configuredLibraryPath
        || process.env.DSH_AI_DRAMA_LIBRARY_ROOT
        || ''
      let persistedLibraryMatches = !explicitLibrarySource
      if (explicitLibrarySource) {
        if (persistedLibraryPath) {
          try {
            const persistedLibraryRoot = await resolveProjectLibraryRoot(persistedLibraryPath)
            persistedLibraryMatches = persistedLibraryRoot === this.projectLibraryRoot
          } catch {
            persistedLibraryMatches = false
          }
        } else {
          // A state record without a libraryRoot cannot prove that its active
          // project belongs to the explicitly configured library.
          persistedLibraryMatches = false
        }
      }

      if (persistedProjectId && persistedLibraryMatches) {
        try {
          activeProjectId = normalizeProjectId(persistedProjectId, '已保存的项目 ID')
        } catch {
          console.warn('[ai-drama-workbench] 已保存的项目 ID 无效，等待用户重新选择项目。')
        }
      } else if (persistedProjectId && explicitLibrarySource) {
        console.warn('[ai-drama-workbench] 当前资产库与已保存项目不一致，已清空活动项目并等待重新选择。')
      } else if (legacyProjectRoot) {
        const legacyProjectId = path.basename(legacyProjectRoot)
        const expectedProjectRoot = path.join(this.projectLibraryRoot, legacyProjectId)
        if (expectedProjectRoot === legacyProjectRoot) {
          activeProjectId = normalizeProjectId(legacyProjectId, '旧项目名称')
        } else {
          console.warn('[ai-drama-workbench] 旧项目不在受控资产库一级目录中，未自动迁移为当前项目。')
        }
      }
      this.activeProjectId = activeProjectId

      // Rewrite legacy { projectPath } state after deriving the fixed library root.
      if (
        persisted.version !== PROJECT_STATE_VERSION
        || persisted.libraryRoot !== this.projectLibraryRoot
        || persisted.activeProjectId !== this.activeProjectId
        || Object.hasOwn(persisted, 'projectPath')
      ) {
        await this.persist()
      }
    })()
    return this.initialized
  }

  async libraryRoot() {
    await this.initialize()
    return this.projectLibraryRoot
  }

  async root() {
    return (await this.resolveProject()).root
  }

  /**
   * Resolve a project for one request.  Callers should pass the project ID
   * captured by the browser so a tab that was opened before a project switch
   * can never silently write into the new global default project.
   */
  async resolveProject(projectId = undefined) {
    const libraryRoot = await this.libraryRoot()
    const requestedId = projectId === undefined || projectId === null || projectId === ''
      ? this.activeProjectId
      : normalizeProjectId(projectId, '项目 ID')
    if (!requestedId) {
      throw new WorkbenchError('尚未选择项目。请先在工作台中选择或新建项目。')
    }
    const resolved = await resolveLibraryProject(libraryRoot, requestedId)
    return { id: resolved.id, root: resolved.root, libraryRoot }
  }

  async listProjects() {
    const libraryRoot = await this.libraryRoot()
    const entries = await fs.readdir(libraryRoot, { withFileTypes: true })
    const projects = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      try {
        const { id, root } = await resolveLibraryProject(libraryRoot, entry.name)
        const [info, initialized] = await Promise.all([fs.stat(root), isInitializedProject(root)])
        projects.push({ id, name: id, updatedAt: info.mtime.toISOString(), initialized })
      } catch {
        // Ignore malformed, hidden, and symlinked siblings instead of exposing them to the UI.
      }
    }
    projects.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true }))
    return {
      libraryLabel: this.libraryLabel,
      activeProjectId: this.activeProjectId || null,
      projects,
    }
  }

  async selectProject(projectId) {
    const id = normalizeProjectId(projectId, '项目 ID')
    await this.initialize()
    return this.withLibraryOperation(async () => {
      const libraryRoot = await this.libraryRoot()
      await resolveLibraryProject(libraryRoot, id)
      const previousProjectId = this.activeProjectId
      this.activeProjectId = id
      try {
        await this.persist()
      } catch (error) {
        this.activeProjectId = previousProjectId
        throw new WorkbenchError(`无法保存当前项目：${errorMessage(error)}`)
      }
      return this.listProjects()
    })
  }

  async createProject(name) {
    const id = normalizeProjectId(name)
    await this.initialize()
    return this.withLibraryOperation(async () => {
      const libraryRoot = await this.libraryRoot()
      const { candidate: target } = projectDirectoryCandidate(libraryRoot, id)
      try {
        await fs.lstat(target)
        throw new WorkbenchError('同名项目已经存在。')
      } catch (error) {
        if (!(error && error.code === 'ENOENT')) throw error
      }

      let temporary = path.join(libraryRoot, `.${id}.${randomBytes(8).toString('hex')}.creating`)
      try {
        await fs.mkdir(temporary, { mode: 0o755 })
        await fs.mkdir(path.join(temporary, '主要人物'), { mode: 0o755 })
        await fs.mkdir(path.join(temporary, '分镜'), { mode: 0o755 })
        await fs.writeFile(path.join(temporary, '项目设定.md'), [
          `# ${id}`,
          '',
          '## 项目设定',
          '',
          `- **项目名称：** ${id}`,
          '- **项目简介：** 请在这里补充故事定位、画幅、帧率和制作规则。',
          '- **默认画幅：** 16:9',
          '- **默认帧率：** 24 fps',
          '',
        ].join('\n'), { encoding: 'utf8', flag: 'wx' })

        // Recheck immediately before rename. The in-process lock prevents two UI
        // requests from racing; a pre-existing sibling is never replaced by design.
        try {
          await fs.lstat(target)
          throw new WorkbenchError('同名项目已经存在。')
        } catch (error) {
          if (!(error && error.code === 'ENOENT')) throw error
        }
        await fs.rename(temporary, target)
        temporary = ''
      } catch (error) {
        if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }

      const previousProjectId = this.activeProjectId
      this.activeProjectId = id
      try {
        await this.persist()
      } catch (error) {
        this.activeProjectId = previousProjectId
        throw new WorkbenchError(`项目已创建，但无法保存当前项目：${errorMessage(error)}`)
      }
      return this.listProjects()
    })
  }
}

export async function selectVisual(root, relativePath) {
  const target = await resolveExistingProjectChild(root, relativePath)
  const targetInfo = await fs.lstat(target)
  if (!targetInfo.isFile() || mediaKind(target) !== 'image') {
    throw new WorkbenchError('只能将当前资料槽中的图片设为已选。')
  }
  const directory = path.dirname(target)
  if (!(await visualSlotFor(root, target))) {
    throw new WorkbenchError('该文件不在工作台识别的视觉资料槽中。')
  }
  const entries = await visibleChildren(directory, [])
  const selected = entries.filter(item => item.info.isFile() && mediaKind(item.name) === 'image' && isSelectedFile(item.name))
  const targetName = path.basename(target)
  if (isSelectedFile(targetName)) {
    return { ok: true, selectedPath: normalizedRelative(root, target), message: '该图片已经是已选版本。' }
  }
  const selectedElsewhere = selected.filter(item => item.target !== target)
  if (selectedElsewhere.length > 1) {
    throw new WorkbenchError('该资料槽存在多张已选图片，请先手动修复后再切换。')
  }
  const nextName = addSelectedSuffix(targetName)
  const nextTarget = path.join(directory, nextName)
  if (await exists(nextTarget)) throw new WorkbenchError('目标已选文件名已存在，无法安全切换。')
  const previous = selectedElsewhere[0]
  const previousPlain = previous ? path.join(directory, removeSelectedSuffix(previous.name)) : null
  if (previousPlain && previousPlain !== target && await exists(previousPlain)) {
    throw new WorkbenchError('旧已选图片的原始文件名已被占用，无法安全切换。')
  }
  const temporary = previous ? path.join(directory, `.${previous.name}.${randomBytes(6).toString('hex')}.swap`) : null
  let previousMoved = false
  let targetMoved = false
  try {
    if (previous && temporary) {
      await fs.rename(previous.target, temporary)
      previousMoved = true
    }
    await fs.rename(target, nextTarget)
    targetMoved = true
    if (previous && temporary && previousPlain) await fs.rename(temporary, previousPlain)
  } catch (error) {
    // Best-effort rollback retains the old selected file whenever a rename fails.
    if (targetMoved && await exists(nextTarget)) {
      try { await fs.rename(nextTarget, target) } catch {}
    }
    if (previousMoved && temporary && await exists(temporary) && previous) {
      try { await fs.rename(temporary, previous.target) } catch {}
    }
    throw new WorkbenchError(`切换已选图片失败：${errorMessage(error)}`)
  }
  return { ok: true, selectedPath: normalizedRelative(root, nextTarget), message: '已通过真实文件名标记为已选。' }
}

async function visualSlotFor(root, target) {
  // A familiar slot name alone is not enough: only direct children of known
  // asset layouts may be renamed by the selected-image workflow.
  const parts = normalizedRelative(root, target).split('/')
  const slotName = parts.at(-2)

  if (parts[0] === '主要人物') {
    if (parts.length === 4 && CHARACTER_SLOTS.includes(slotName)) return 'character'
    if (parts.length === 6 && parts[2] === '造型' && CHARACTER_SLOTS.includes(slotName)) return 'look'
    return null
  }

  if (parts[0] === '分镜') {
    if (parts.length === 4 && SCENE_SLOTS.includes(slotName)) return 'scene'
    if (parts.length === 5 && SHOT_SLOTS.includes(slotName)) {
      const shotDocument = path.join(root, ...parts.slice(0, 3), '镜头.md')
      return (await normalFile(shotDocument)) ? 'shot' : null
    }
  }
  return null
}

async function resolveRequestProject(state, url) {
  const rawProjectId = url.searchParams.get('projectId')
  if (rawProjectId !== null && rawProjectId.trim() === '') {
    throw new WorkbenchError('项目 ID 不能为空。')
  }
  if (typeof state.resolveProject === 'function') {
    return state.resolveProject(rawProjectId ?? undefined)
  }
  return { id: undefined, root: await state.root() }
}

async function callPlanner(state, operation, plannerInput, project = undefined) {
  if (!(await normalFile(PLANNER_BRIDGE))) throw new WorkbenchError('本地安全规划器文件缺失。')
  const [libraryRoot, activeProjectRoot] = project
    ? [project.libraryRoot, project.root]
    : await Promise.all([state.libraryRoot(), state.root()])
  return new Promise((resolve, reject) => {
    // The Python engine receives the current controlled roots through its
    // process environment, never from an AI-supplied argument.
    const child = spawn('python3', [PLANNER_BRIDGE, operation], {
      env: {
        ...process.env,
        AI_DRAMA_PLANNER_ACTIVE_PROJECT_ROOT: activeProjectRoot,
        AI_DRAMA_PLANNER_LIBRARY_ROOT: libraryRoot,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new WorkbenchError('本地规划器响应超时。'))
    }, 30_000)
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(result)
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      if (stdout.length > 2 * 1024 * 1024) child.kill('SIGTERM')
    })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => finish(new WorkbenchError(`无法启动本地规划器：${errorMessage(error)}`)))
    child.on('close', () => {
      try {
        const payload = JSON.parse(stdout)
        if (!payload.ok) throw new WorkbenchError(typeof payload.error === 'string' ? payload.error : '本地规划器调用失败。')
        finish(null, redactPlannerProjectPaths(payload.result))
      } catch (error) {
        const detail = stderr.trim() ? `（${stderr.trim().slice(0, 400)}）` : ''
        finish(error instanceof WorkbenchError ? error : new WorkbenchError(`本地规划器返回无效结果${detail}`))
      }
    })
    child.stdin.end(JSON.stringify(plannerInput))
  })
}

async function plannerArguments(state, input, project = undefined) {
  const {
    project_path: _ignoredProjectPath,
    project_id: _projectId,
    ...argumentsWithoutProjectPath
  } = input ?? {}
  return { ...argumentsWithoutProjectPath, project_path: project?.root ?? await state.root() }
}

async function plannerProjectFromArguments(state, input) {
  const projectId = input?.project_id
  if (projectId !== undefined && projectId !== null && projectId !== '') {
    return state.resolveProject(projectId)
  }
  return undefined
}

function registerPlannerTools(ctx, state) {
  const render = (_args, value) => [{ type: 'text', text: jsonText(value) }]
  ctx.tools.register(defineTool({
    name: 'ai_drama_inspect',
    description: '只读扫描指定 AI 漫剧项目的人物、LOOK、场次、镜头、场景和道具。project_id 是资产库中的项目名称（例如 my-test 或书名），不是路径；不会写入文件。未提供时使用工作台当前项目。',
    parameters: {
      project_id: { type: 'string', required: true, description: '资产库中的一级项目名称；例如 my-test 或小说书名。' },
    },
    output: { schema: { type: 'json' }, render },
    async execute(args) {
      const project = await plannerProjectFromArguments(state, args)
      return callPlanner(state, 'inspect', await plannerArguments(state, args, project), project)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'ai_drama_stage_proposal',
    description: '校验并暂存指定项目的 AI 漫剧拆解提案。必须先对同一 project_id 调用 ai_drama_inspect 并使用其 project_fingerprint。此工具绝不创建项目文件；plan_json 必须是符合工作台结构的 JSON 对象。',
    parameters: {
      project_id: { type: 'string', required: true, description: '资产库中的一级项目名称；必须与 inspect 使用的项目一致。' },
      project_fingerprint: { type: 'string', required: true, description: 'ai_drama_inspect 返回的项目指纹。' },
      novel_excerpt: { type: 'string', required: true, description: '用户提供的小说或剧本片段。' },
      plan_json: { type: 'string', required: true, description: '严格 JSON：new_characters、look_additions、new_locations、new_props、new_scenes 等提案。' },
    },
    output: { schema: { type: 'json' }, render },
    async execute(args) {
      let plan
      try { plan = JSON.parse(args.plan_json) } catch { throw new WorkbenchError('plan_json 必须是有效 JSON。') }
      const project = await plannerProjectFromArguments(state, args)
      return callPlanner(state, 'stage', await plannerArguments(state, { ...args, plan }, project), project)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'ai_drama_get_proposal',
    description: '只读查看已暂存的 AI 漫剧提案、目录清单和精确确认语句；不会写入任何文件。',
    parameters: {
      project_id: { type: 'string', required: true, description: '提案所属的资产库一级项目名称。' },
      proposal_id: { type: 'string', required: true, description: '暂存提案 ID。' },
    },
    output: { schema: { type: 'json' }, render },
    async execute(args) {
      const project = await plannerProjectFromArguments(state, args)
      return callPlanner(state, 'get', await plannerArguments(state, args, project), project)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'ai_drama_apply_proposal',
    description: '执行已审核的提案。只有在用户明确输入精确确认语句“确认写入 <proposal_id>”后才能调用；会再次校验项目变化，并以事务方式创建真实空目录和 Markdown，绝不生成虚假图片。',
    parameters: {
      project_id: { type: 'string', required: true, description: '提案所属的资产库一级项目名称。' },
      proposal_id: { type: 'string', required: true, description: '暂存提案 ID。' },
      confirmation: { type: 'string', required: true, description: '必须原样为“确认写入 <proposal_id>”。' },
    },
    output: { schema: { type: 'json' }, render },
    async execute(args) {
      const project = await plannerProjectFromArguments(state, args)
      return callPlanner(state, 'apply', await plannerArguments(state, args, project), project)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'ai_drama_discard_proposal',
    description: '丢弃未写入的 AI 漫剧提案；不会改动项目资产。',
    parameters: {
      project_id: { type: 'string', required: true, description: '提案所属的资产库一级项目名称。' },
      proposal_id: { type: 'string', required: true, description: '暂存提案 ID。' },
    },
    output: { schema: { type: 'json' }, render },
    async execute(args) {
      const project = await plannerProjectFromArguments(state, args)
      return callPlanner(state, 'discard', await plannerArguments(state, args, project), project)
    },
  }))
}

async function serveMedia(state, req, url, res) {
  const { root } = await resolveRequestProject(state, url)
  const relativePath = url.searchParams.get('path')
  const target = await resolveExistingProjectChild(root, relativePath)
  const kind = mediaKind(target)
  if (!kind) throw new WorkbenchError('该文件不是可预览的图片或视频。')
  const info = await fs.stat(target)
  const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : ''
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, info.size)
    if (!range) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}`, 'accept-ranges': 'bytes' })
      res.end()
      return
    }
    const length = range.end - range.start + 1
    res.writeHead(206, {
      'content-type': contentType(target),
      'content-length': length,
      'content-range': `bytes ${range.start}-${range.end}/${info.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    })
    const stream = createReadStream(target, range)
    stream.on('error', () => { if (!res.writableEnded) res.destroy() })
    stream.pipe(res)
    return
  }
  res.writeHead(200, {
    'content-type': contentType(target),
    'content-length': info.size,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff',
  })
  const stream = createReadStream(target)
  stream.on('error', () => { if (!res.writableEnded) res.destroy() })
  stream.pipe(res)
}

async function route(state, comfyApi, req, res) {
  // Prefix web-server adapters may strip the registered `/ai-drama` prefix
  // before invoking the handler. Normalize both forms for every endpoint.
  const requestUrl = req.url ?? '/'
  const normalizedUrl = requestUrl === '/ai-drama' || requestUrl.startsWith('/ai-drama/')
    ? requestUrl
    : `/ai-drama${requestUrl.startsWith('/') ? requestUrl : `/${requestUrl}`}`
  const url = new URL(normalizedUrl, 'http://127.0.0.1')
  if (await handleSshRequest(req, res, url)) return
  if (await comfyApi.handle(req, res, url, responseJson)) return
  if (await handleWorkbenchRequest({ state, req, res, url, responseJson })) return
  if (url.pathname === '/ai-drama/media' && req.method === 'GET') return serveMedia(state, req, url, res)
  if (url.pathname === '/ai-drama/api/health' && req.method === 'GET') {
    return responseJson(res, 200, { ok: true, plugin: 'dsh-ai-drama-workbench' })
  }
  if (url.pathname === '/ai-drama/api/snapshot' && req.method === 'GET') {
    // This legacy endpoint used to expose an absolute projectPath. Keep a
    // clear tombstone instead of leaking local paths to old clients.
    return responseJson(res, 410, { ok: false, error: '旧快照接口已停用，请使用 /ai-drama/workbench/project。' })
  }
  if (url.pathname === '/ai-drama/api/project' && req.method === 'POST') {
    return responseJson(res, 410, { ok: false, error: '旧项目路径接口已停用，请使用工作台顶部的项目切换器。' })
  }
  if (url.pathname === '/ai-drama/api/select-visual' && req.method === 'POST') {
    requireSameOrigin(req)
    const body = await readRequestJson(req)
    const project = await resolveRequestProject(state, url)
    const result = await selectVisual(project.root, body.path)
    const snapshot = await withProjectRoot(project.root, () => getAssetWorkspaceSnapshot())
    return responseJson(res, 200, {
      ...result,
      snapshot: project.id
        ? redactPlannerProjectPaths({ ...snapshot, projectId: project.id })
        : snapshot,
    })
  }
  if (url.pathname === '/ai-drama/api/proposals/stage' && req.method === 'POST') {
    requireSameOrigin(req)
    const body = await readRequestJson(req)
    const project = await resolveRequestProject(state, url)
    return responseJson(res, 200, await callPlanner(state, 'stage', await plannerArguments(state, body, project), project))
  }
  const proposalMatch = /^\/ai-drama\/api\/proposals\/([^/]+)\/(apply|discard)$/u.exec(url.pathname)
  if (proposalMatch && req.method === 'POST') {
    requireSameOrigin(req)
    const body = await readRequestJson(req)
    const operation = proposalMatch[2]
    const plannerInput = { ...body, proposal_id: proposalMatch[1] }
    const project = await resolveRequestProject(state, url)
    return responseJson(res, 200, await callPlanner(state, operation, plannerInput, project))
  }
  const getProposalMatch = /^\/ai-drama\/api\/proposals\/([^/]+)$/u.exec(url.pathname)
  if (getProposalMatch && req.method === 'GET') {
    const project = await resolveRequestProject(state, url)
    return responseJson(res, 200, await callPlanner(state, 'get', { proposal_id: getProposalMatch[1] }, project))
  }
  throw new WorkbenchError('找不到工作台接口。')
}

export function apply(ctx, config = {}) {
  const state = new WorkbenchState(config)
  const comfyApi = createComfyApi(state)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/ai-drama',
    handler: async (req, res) => {
      try { await route(state, comfyApi, req, res) } catch (error) { responseError(res, error) }
    },
  }), 'ai-drama-workbench: local asset API')
  registerPlannerTools(ctx, state)
  ctx.effect(() => () => {
    if (sshProcess && !sshProcess.killed) sshProcess.kill('SIGTERM')
    sshProcess = null
    cleanupSshAskpass()
  }, 'ai-drama-workbench: SSH tunnel cleanup')
}
