import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createCharacterAsset,
  createShotAsset,
  getAssetWorkspaceSnapshot,
  rebuildProjectIndex,
  renameWorkspaceAsset,
  setCharacterVisualSelection,
  withProjectRoot,
} from '../lib/workspace-core.js'

const IMAGE = Buffer.from('workspace-core-write-safety-image')

test('shot discovery reads design.json without falling back to 镜头.md', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-json-shot-'))
  const root = await realpath(temporary)
  const shotDirectory = path.join(root, '分镜', 'EP001-SC001', 'SH001-仅有旧文档')

  try {
    await mkdir(shotDirectory, { recursive: true })
    await writeFile(path.join(shotDirectory, '镜头.md'), '# SH001 仅有旧文档\n', 'utf8')
    const legacySnapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    assert.equal(legacySnapshot.shots.filter(shot => !shot.isDraft).length, 0)

    await writeFile(path.join(shotDirectory, 'design.json'), JSON.stringify({
      sceneId: 'EP001-SC001',
      shotId: 'SH001',
      title: 'JSON 镜头',
      timecode: '',
      duration: '',
      framing: '',
      content: '只从 JSON 读取。',
      dialogue: '',
      camera: '',
      prompt: '',
      negativePrompt: '',
      firstFramePrompt: '',
      firstFrameNegativePrompt: '',
      lastFramePrompt: '',
      lastFrameNegativePrompt: '',
      references: '',
      videoPrompt: '',
      characterOverrides: [],
      status: '待生成',
    }), 'utf8')
    const jsonSnapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    assert.equal(jsonSnapshot.shots.find(shot => !shot.isDraft)?.design.title, 'JSON 镜头')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('a v1 project cache upgrades known shot data into design.json once', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-shot-cache-upgrade-'))
  const root = await realpath(temporary)
  const shotPath = '分镜/EP001-SC001/SH001-缓存升级'
  const shotDirectory = path.join(root, ...shotPath.split('/'))
  const design = {
    sceneId: 'EP001-SC001',
    shotId: 'SH001',
    title: '缓存升级',
    timecode: '',
    duration: '',
    framing: '',
    content: '由旧项目缓存升级。',
    dialogue: '',
    camera: '',
    prompt: '',
    negativePrompt: '',
    firstFramePrompt: '',
    firstFrameNegativePrompt: '',
    lastFramePrompt: '',
    lastFrameNegativePrompt: '',
    references: '',
    characterOverrides: [],
    status: '待生成',
  }

  try {
    await mkdir(path.join(root, '.workbench'), { recursive: true })
    await mkdir(shotDirectory, { recursive: true })
    await writeFile(path.join(shotDirectory, '镜头.md'), '# SH001 缓存升级\n', 'utf8')
    await writeFile(path.join(root, '.workbench', 'project.json'), JSON.stringify({
      schemaVersion: 1,
      rootName: path.basename(root),
      shots: [{ rootPath: shotPath, designPath: `${shotPath}/镜头.md`, design }],
    }), 'utf8')

    const snapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    assert.equal(snapshot.shots.find(shot => shot.rootPath === shotPath)?.design.title, '缓存升级')
    assert.equal(JSON.parse(await readFile(path.join(shotDirectory, 'design.json'), 'utf8')).title, '缓存升级')
    assert.equal(JSON.parse(await readFile(path.join(root, '.workbench', 'project.json'), 'utf8')).schemaVersion, 3)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('character assets expose only the turnaround slot and keep legacy folders untouched', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-selection-repair-'))
  const root = await realpath(temporary)

  try {
    const characterPath = await withProjectRoot(root, () => createCharacterAsset('选图修复人物'))
    const turnaroundDirectory = path.join(root, '主要人物', '选图修复人物', '三视图')
    const legacyCostumeDirectory = path.join(root, '主要人物', '选图修复人物', '定妆')
    const legacyReferenceDirectory = path.join(root, '主要人物', '选图修复人物', '参考图')
    await Promise.all([
      mkdir(legacyCostumeDirectory, { recursive: true }),
      mkdir(legacyReferenceDirectory, { recursive: true }),
    ])
    await Promise.all([
      writeFile(path.join(turnaroundDirectory, '01-已选.png'), IMAGE),
      writeFile(path.join(turnaroundDirectory, '02-已选.png'), IMAGE),
      writeFile(path.join(turnaroundDirectory, '03.png'), IMAGE),
      writeFile(path.join(legacyCostumeDirectory, '旧定妆.png'), IMAGE),
      writeFile(path.join(legacyReferenceDirectory, '旧参考.png'), IMAGE),
    ])

    const selectedPath = await withProjectRoot(root, () => setCharacterVisualSelection(
      characterPath,
      'turnaround',
      '02-已选.png',
    ))
    assert.equal(selectedPath, '主要人物/选图修复人物/三视图/02-已选.png')
    assert.deepEqual((await readdir(turnaroundDirectory)).sort(), [
      '01.png',
      '02-已选.png',
      '03.png',
    ])

    // Re-selecting the sole confirmed file is a no-op and must not create
    // temporary files or change the current disk-backed selection.
    await withProjectRoot(root, () => setCharacterVisualSelection(
      characterPath,
      'turnaround',
      '02-已选.png',
    ))
    assert.deepEqual((await readdir(turnaroundDirectory)).sort(), [
      '01.png',
      '02-已选.png',
      '03.png',
    ])

    const snapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    const character = snapshot.characters.find(asset => asset.rootPath === characterPath)
    assert.deepEqual(character?.slots.map(slot => slot.key), ['turnaround'])
    assert.equal(character?.confirmedVisuals.turnaround?.name, '02-已选.png')
    assert.equal(await readdir(legacyCostumeDirectory).then(files => files[0]), '旧定妆.png')
    assert.equal(await readdir(legacyReferenceDirectory).then(files => files[0]), '旧参考.png')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('concurrent creation and shot renaming publish complete visible assets only', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-write-transaction-'))
  const root = await realpath(temporary)

  try {
    const creation = await withProjectRoot(root, () => Promise.allSettled([
      createCharacterAsset('并发人物'),
      createCharacterAsset('并发人物'),
    ]))
    assert.equal(creation.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(creation.filter(result => result.status === 'rejected').length, 1)

    const characterDirectory = path.join(root, '主要人物', '并发人物')
    assert.deepEqual((await readdir(characterDirectory)).sort(), [
      '三视图',
      '角色设定.json',
      '角色设定.md',
    ].sort())
    assert.match(await readFile(path.join(characterDirectory, '角色设定.md'), 'utf8'), /角色分类/u)

    const shotPath = await withProjectRoot(root, () => createShotAsset(
      'EP001-SC001',
      'SH001',
      '原镜头标题',
    ))
    const renamedPath = await withProjectRoot(root, () => renameWorkspaceAsset(
      'shot',
      shotPath,
      '更新后的镜头标题',
    ))
    assert.equal(renamedPath, '分镜/EP001-SC001/SH001-更新后的镜头标题')

    const shotDirectory = path.join(root, ...renamedPath.split('/'))
    assert.ok((await readdir(shotDirectory)).every(name => !name.startsWith('.')))
    assert.match(await readFile(path.join(shotDirectory, '镜头.md'), 'utf8'), /^# SH001 更新后的镜头标题$/mu)
    const shotDesign = JSON.parse(await readFile(path.join(shotDirectory, 'design.json'), 'utf8'))
    assert.equal(shotDesign.title, '更新后的镜头标题')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('project asset index is parsed from JSON and can be rebuilt without a database', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-project-index-'))
  const root = await realpath(temporary)

  try {
    const characterPath = await withProjectRoot(root, () => createCharacterAsset('索引人物'))
    const indexDirectory = path.join(root, '.workbench')
    await mkdir(indexDirectory, { recursive: true })
    await writeFile(path.join(indexDirectory, 'index.json'), JSON.stringify({
      schemaVersion: 1,
      projectName: path.basename(root),
      generatedAt: '2026-08-31T00:00:00Z',
      chapters: [{
        id: 'CH001',
        title: '第一章',
        characterPaths: [characterPath],
        locationPaths: [],
        propPaths: [],
        scenePaths: [],
        status: 'draft',
      }],
    }), 'utf8')

    const parsed = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    assert.equal(parsed.projectIndex?.chapters[0].id, 'CH001')
    assert.deepEqual(parsed.projectIndex?.chapters[0].characterPaths, [characterPath])

    await withProjectRoot(root, () => rebuildProjectIndex())
    const rebuilt = JSON.parse(await readFile(path.join(indexDirectory, 'index.json'), 'utf8'))
    assert.equal(rebuilt.schemaVersion, 1)
    assert.equal(rebuilt.projectName, path.basename(root))
    assert.equal(rebuilt.chapters[0].id, 'CH001')

    // Once the JSON projection exists, the page snapshot can be served without
    // reparsing the Markdown document.
    await rm(path.join(root, ...characterPath.split('/'), '角色设定.md'))
    const jsonOnly = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    assert.equal(jsonOnly.characters[0].name, '索引人物')
    assert.equal(jsonOnly.characters[0].profileContent?.includes('索引人物'), true)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
