import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  getAssetWorkspaceSnapshot,
  importStoryboardDrafts,
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
