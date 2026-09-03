import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createLocationAsset,
  createPropAsset,
  createSceneAsset,
  createShotAsset,
  getAssetWorkspaceSnapshot,
  importStoryboardDrafts,
  renameWorkspaceAsset,
  trashWorkspaceAsset,
  updateSceneAssetBindings,
  withProjectRoot,
} from '../lib/workspace-core.js'

const MULTI_SCENE_STORYBOARD = `# EP001-SC001 分镜脚本

## 镜头总表

| 镜号 | 时间码 | 时长 | 景别 | 核心内容 | 台词 |
| --- | --- | --- | --- | --- | --- |
| 01 | 00:00-00:02 | 2 秒 | 全景 | 第一场的雾中关隘 | 无 |

### 镜头 01：第一场建立

- **摄影运动：** 缓慢推进
- **提示词：** first-scene-prompt

第一场细节：城门在雾中显现。

# EP001-SC002 分镜脚本

## 镜头总表

| 镜号 | 时间码 | 时长 | 景别 | 核心内容 | 台词 |
| --- | --- | --- | --- | --- | --- |
| 01 | 00:00-00:03 | 3 秒 | 近景 | 第二场的雨夜巷道 | 继续前进 |

### 镜头 01：第二场建立

- **摄影运动：** 手持跟拍
- **提示词：** second-scene-prompt

第二场细节：雨水从屋檐落下。
`

const SINGLE_SCENE_STORYBOARD = `# EP099-SC003 分镜脚本

## 镜头总表

| 镜号 | 时间码 | 时长 | 景别 | 核心内容 | 台词 |
| --- | --- | --- | --- | --- | --- |
| 01 | 00:00-00:02 | 2 秒 | 中景 | 单场镜头内容 | 无 |

### 镜头 01：单场标题

- **摄影运动：** 固定机位

单场详细说明。
`

test('a multi-scene storyboard scopes repeated SH001 drafts and imports them without cross-scene loss', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-multi-storyboard-'))
  const root = await realpath(temporary)
  const sourcePath = 'EP001-多场次-分镜脚本.md'

  try {
    await writeFile(path.join(root, sourcePath), MULTI_SCENE_STORYBOARD, 'utf8')

    const initial = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    const drafts = initial.shots.filter(shot => shot.isDraft)
    assert.deepEqual(
      drafts.map(shot => [shot.design.sceneId, shot.design.shotId, shot.design.title]),
      [
        ['EP001-SC001', 'SH001', '第一场建立'],
        ['EP001-SC002', 'SH001', '第二场建立'],
      ],
    )
    assert.ok(drafts.every(shot => shot.sourcePath === sourcePath))

    // The legacy bare SH001 selector is unsafe once a source restarts shot IDs.
    const ambiguous = await withProjectRoot(root, () => importStoryboardDrafts(sourcePath, ['SH001']))
    assert.equal(ambiguous.created.length, 0)
    assert.equal(ambiguous.errors.length, 1)
    assert.match(ambiguous.errors[0].error, /EP001-SC001\/SH001.*EP001-SC002\/SH001/u)

    const secondOnly = await withProjectRoot(root, () => importStoryboardDrafts(sourcePath, ['EP001-SC002/SH001']))
    assert.deepEqual(secondOnly.created.map(entry => entry.path), ['分镜/EP001-SC002/SH001-第二场建立'])
    const secondMarkdown = await readFile(path.join(root, '分镜', 'EP001-SC002', 'SH001-第二场建立', '镜头.md'), 'utf8')
    assert.match(secondMarkdown, /第二场细节/u)
    assert.doesNotMatch(secondMarkdown, /第一场细节/u)
    const secondDesign = JSON.parse(await readFile(
      path.join(root, '分镜', 'EP001-SC002', 'SH001-第二场建立', 'design.json'),
      'utf8',
    ))
    assert.equal(secondDesign.source.sourcePath, sourcePath)
    assert.equal(secondDesign.source.sourceShotId, 'SH001')

    // No selector means "import every unambiguous draft"; it must still create
    // the remaining SH001 from SC001 rather than de-duplicating by shot number.
    const allRemaining = await withProjectRoot(root, () => importStoryboardDrafts(sourcePath))
    assert.deepEqual(allRemaining.created.map(entry => entry.path), ['分镜/EP001-SC001/SH001-第一场建立'])
    assert.equal(allRemaining.skipped.length, 1)
    assert.equal(allRemaining.skipped[0].shotId, 'EP001-SC002/SH001')

    const completed = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    assert.deepEqual(
      completed.shots.filter(shot => !shot.isDraft).map(shot => [shot.design.sceneId, shot.design.shotId]),
      [
        ['EP001-SC001', 'SH001'],
        ['EP001-SC002', 'SH001'],
      ],
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('single-scene storyboard import keeps the existing bare SH001 selector behavior', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-single-storyboard-'))
  const root = await realpath(temporary)
  const sourcePath = 'EP099-SC003-分镜脚本.md'

  try {
    await writeFile(path.join(root, sourcePath), SINGLE_SCENE_STORYBOARD, 'utf8')
    const imported = await withProjectRoot(root, () => importStoryboardDrafts(sourcePath, ['SH001']))
    assert.deepEqual(imported.created.map(entry => entry.path), ['分镜/EP099-SC003/SH001-单场标题'])

    const snapshot = await withProjectRoot(root, () => getAssetWorkspaceSnapshot())
    const stored = snapshot.shots.find(shot => !shot.isDraft)
    assert.equal(stored?.design.sceneId, 'EP099-SC003')
    assert.equal(stored?.design.shotId, 'SH001')
    assert.equal(stored?.design.title, '单场标题')
    assert.equal(stored?.sourcePath, sourcePath)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('scene asset bindings are created, persisted, validated, and protect referenced reusable assets', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-scene-asset-bindings-'))
  const root = await realpath(temporary)

  try {
    await withProjectRoot(root, async () => {
      const locationPath = await createLocationAsset('雨夜巷道')
      const propPath = await createPropAsset('铜钥匙')
      const scenePath = await createSceneAsset('EP001-SC001')
      await createShotAsset('EP001-SC001', 'SH001', '巷口建立')
      await createShotAsset('EP001-SC001', 'SH002', '钥匙特写')

      const sceneDocument = await readFile(path.join(root, '分镜', 'EP001-SC001', '场次.md'), 'utf8')
      assert.match(sceneDocument, /^# EP001-SC001 场次$/mu)
      assert.doesNotMatch(sceneDocument, /场次资产/u)

      const assetSheetPath = '分镜/EP001-SC001/场次资产表.md'
      const initialSheet = await readFile(path.join(root, ...assetSheetPath.split('/')), 'utf8')
      assert.match(initialSheet, /workbench:scene-assets:start/u)
      assert.match(initialSheet, /"locations": \[\]/u)
      assert.match(initialSheet, /"props": \[\]/u)

      const initial = await getAssetWorkspaceSnapshot()
      const initialScene = initial.scenes.find(scene => scene.rootPath === scenePath)
      assert.ok(initialScene)
      assert.equal(initialScene?.assetBindingsPath, assetSheetPath)
      assert.deepEqual(initialScene?.locationBindings, [])
      assert.deepEqual(initialScene?.propBindings, [])

      const bindings = {
        locations: [{
          locationPath,
          role: '主要行动空间',
          state: '夜雨积水',
          continuity: '站牌缺角保持可见',
          startShotId: 'SH001',
          endShotId: 'SH002',
        }],
        props: [{
          propPath,
          role: '关键线索',
          state: '被雨水打湿',
          continuity: '始终握在主角右手',
          startShotId: '',
          endShotId: '',
        }],
      }
      const saved = await updateSceneAssetBindings(scenePath, bindings, initialScene.assetBindingsRevision)
      assert.equal(saved, assetSheetPath)

      const persisted = await getAssetWorkspaceSnapshot()
      const persistedScene = persisted.scenes.find(scene => scene.rootPath === scenePath)
      assert.ok(persistedScene)
      assert.deepEqual(persistedScene?.locationBindings, bindings.locations)
      assert.deepEqual(persistedScene?.propBindings, bindings.props)
      const persistedSheet = await readFile(path.join(root, ...assetSheetPath.split('/')), 'utf8')
      assert.match(persistedSheet, /"locationPath": "场景\/雨夜巷道"/u)
      assert.match(persistedSheet, /"propPath": "道具\/铜钥匙"/u)

      const revision = persistedScene.assetBindingsRevision
      await assert.rejects(
        () => updateSceneAssetBindings(scenePath, {
          locations: [{ ...bindings.locations[0], locationPath: '场景/不存在的地点' }],
          props: [],
        }, revision),
        /地点.*当前项目/u,
      )
      await assert.rejects(
        () => updateSceneAssetBindings(scenePath, {
          locations: [{ ...bindings.locations[0], startShotId: 'SH002', endShotId: 'SH001' }],
          props: [],
        }, revision),
        /结束镜号/u,
      )
      await assert.rejects(
        () => updateSceneAssetBindings(scenePath, {
          locations: [{ ...bindings.locations[0], startShotId: 'SH003', endShotId: '' }],
          props: [],
        }, revision),
        /起始镜号不属于当前场次/u,
      )
      await assert.rejects(
        () => updateSceneAssetBindings(scenePath, {
          locations: [
            { ...bindings.locations[0], startShotId: 'SH001', endShotId: 'SH001' },
            { ...bindings.locations[0], startShotId: 'SH001', endShotId: 'SH002' },
          ],
          props: [],
        }, revision),
        /重叠镜头范围/u,
      )

      await assert.rejects(
        () => renameWorkspaceAsset('location', locationPath, '新巷道'),
        /暂不能重命名/u,
      )
      await assert.rejects(
        () => trashWorkspaceAsset('location', locationPath),
        /暂不能移入回收站/u,
      )
      await assert.rejects(
        () => renameWorkspaceAsset('prop', propPath, '新钥匙'),
        /暂不能重命名/u,
      )
      await assert.rejects(
        () => trashWorkspaceAsset('prop', propPath),
        /暂不能移入回收站/u,
      )
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('legacy scene Markdown maps separate people, location, and prop fields to reusable asset bindings', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-legacy-scene-bindings-'))
  const root = await realpath(temporary)

  try {
    await withProjectRoot(root, async () => {
      const locationPath = await createLocationAsset('旧城门')
      const propPath = await createPropAsset('旧钥匙')
      const sceneDirectory = path.join(root, '分镜', 'EP099-SC001')
      await mkdir(sceneDirectory, { recursive: true })
      await writeFile(path.join(sceneDirectory, '场次.md'), [
        '# EP099-SC001 场次设定',
        '',
        '- **人物：** 沈砚',
        '- **场景：** 旧城门',
        '- **道具：** 旧钥匙',
        '',
      ].join('\n'), 'utf8')

      const snapshot = await getAssetWorkspaceSnapshot()
      const scene = snapshot.scenes.find(asset => asset.sceneId === 'EP099-SC001')
      assert.equal(scene?.assetBindingsPath, undefined)
      assert.deepEqual(scene?.locationBindings, [{
        locationPath,
        role: '',
        state: '',
        continuity: '',
        startShotId: '',
        endShotId: '',
      }])
      assert.deepEqual(scene?.propBindings, [{
        propPath,
        role: '',
        state: '',
        continuity: '',
        startShotId: '',
        endShotId: '',
      }])
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
