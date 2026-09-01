import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { WorkbenchState } from '../src/index.js'
import { handleWorkbenchRequest } from '../src/workbench-api.js'
import { Readable } from 'node:stream'

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

test('project registry creates and changes the active project before state.root is read', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-project-registry-'))
  const library = path.join(temporary, 'library')
  const statePath = path.join(temporary, 'state', 'workbench.json')
  await mkdir(library)

  try {
    const state = new WorkbenchState({ projectLibraryPath: library, statePath })
    const initially = await call(state, getRequest(), 'http://127.0.0.1/ai-drama/workbench/projects')
    assert.equal(initially.status, 200)
    assert.deepEqual(initially.payload.projects, [])
    assert.equal(initially.payload.activeProjectId, null)

    const created = await call(state, jsonRequest({ action: 'create', name: '边关篇' }), 'http://127.0.0.1/ai-drama/workbench/projects')
    assert.equal(created.status, 201)
    assert.equal(created.payload.activeProjectId, '边关篇')
    assert.equal(created.payload.projects[0].initialized, true)
    assert.equal((await stat(path.join(library, '边关篇', '主要人物'))).isDirectory(), true)
    assert.match(await readFile(path.join(library, '边关篇', '项目设定.md'), 'utf8'), /# 边关篇/)
    assert.equal(path.basename(await state.root()), '边关篇')

    await mkdir(path.join(library, '第二季'))
    const selected = await call(state, jsonRequest({ action: 'select', projectId: '第二季' }), 'http://127.0.0.1/ai-drama/workbench/projects')
    assert.equal(selected.status, 200)
    assert.equal(selected.payload.activeProjectId, '第二季')
    assert.equal(path.basename(await state.root()), '第二季')

    const reloaded = new WorkbenchState({ projectLibraryPath: library, statePath })
    assert.equal(path.basename(await reloaded.root()), '第二季')
    await assert.rejects(() => reloaded.selectProject('../outside'), /项目 ID/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('legacy single-project state migrates into its direct parent asset library', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-project-migration-'))
  const library = path.join(temporary, 'library')
  const project = path.join(library, 'my-first-01')
  const statePath = path.join(temporary, 'state', 'workbench.json')
  await mkdir(project, { recursive: true })
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, JSON.stringify({ projectPath: project }), 'utf8')

  try {
    const state = new WorkbenchState({ statePath })
    assert.equal(await state.root(), await realpath(project))
    const stored = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(stored.version, 2)
    assert.equal(stored.activeProjectId, 'my-first-01')
    assert.equal(Object.hasOwn(stored, 'projectPath'), false)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('a legacy project with real asset roots remains initialized without a project settings file', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-legacy-project-roots-'))
  const library = path.join(temporary, 'library')
  const statePath = path.join(temporary, 'state', 'workbench.json')
  const projectId = '旧项目'
  await mkdir(path.join(library, projectId, '主要人物'), { recursive: true })
  await mkdir(path.join(library, projectId, '分镜'), { recursive: true })

  try {
    const state = new WorkbenchState({ projectLibraryPath: library, statePath })
    const registry = await state.listProjects()
    assert.equal(registry.projects.length, 1)
    assert.equal(registry.projects[0].id, projectId)
    assert.equal(registry.projects[0].initialized, true)
    await assert.rejects(() => readFile(path.join(library, projectId, '项目设定.md'), 'utf8'), /ENOENT/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('explicitly switching the asset library clears a stale active project id', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-project-library-switch-'))
  const previousLibrary = path.join(temporary, 'previous-library')
  const nextLibrary = path.join(temporary, 'next-library')
  const statePath = path.join(temporary, 'state', 'workbench.json')
  const projectName = '同名项目'
  await mkdir(path.join(previousLibrary, projectName), { recursive: true })
  await mkdir(path.join(nextLibrary, projectName), { recursive: true })
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, JSON.stringify({
    version: 2,
    libraryRoot: previousLibrary,
    activeProjectId: projectName,
  }), 'utf8')

  try {
    const state = new WorkbenchState({ projectLibraryPath: nextLibrary, statePath })
    const projects = await state.listProjects()
    assert.equal(projects.activeProjectId, null)
    assert.deepEqual(projects.projects.map((project) => project.id), [projectName])
    await assert.rejects(
      () => state.root(),
      /尚未选择项目/,
    )

    const stored = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(stored.libraryRoot, await realpath(nextLibrary))
    assert.equal(stored.activeProjectId, '')

    await state.selectProject(projectName)
    assert.equal(await state.root(), await realpath(path.join(nextLibrary, projectName)))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('a request pinned to its project id cannot write into a project selected by another tab', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-project-request-pin-'))
  const library = path.join(temporary, 'library')
  const statePath = path.join(temporary, 'state', 'workbench.json')
  await mkdir(library)

  try {
    const state = new WorkbenchState({ projectLibraryPath: library, statePath })
    await state.createProject('项目甲')
    await state.createProject('项目乙')
    assert.equal((await state.listProjects()).activeProjectId, '项目乙')

    const createdInA = await call(
      state,
      jsonRequest({ action: 'createCharacter', name: '只属于甲的人物' }),
      `http://127.0.0.1/ai-drama/workbench/assets?projectId=${encodeURIComponent('项目甲')}`,
    )
    assert.equal(createdInA.status, 200)

    const projectA = await call(
      state,
      getRequest(),
      `http://127.0.0.1/ai-drama/workbench/project?projectId=${encodeURIComponent('项目甲')}`,
    )
    assert.equal(projectA.payload.projectId, '项目甲')
    assert.equal(projectA.payload.characters[0].name, '只属于甲的人物')

    const projectB = await call(
      state,
      getRequest(),
      `http://127.0.0.1/ai-drama/workbench/project?projectId=${encodeURIComponent('项目乙')}`,
    )
    assert.equal(projectB.payload.projectId, '项目乙')
    assert.equal(projectB.payload.characters.length, 0)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
