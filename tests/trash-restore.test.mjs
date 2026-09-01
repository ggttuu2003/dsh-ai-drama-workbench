import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, realpath, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createCharacterAsset,
  getTrashEntries,
  moveToTrash,
  restoreTrashEntry,
  withProjectRoot,
} from '../lib/workspace-core.js'

test('a moved asset records a recoverable original location and restores without overwriting', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-trash-restore-'))
  const root = await realpath(temporary)

  try {
    const characterPath = await withProjectRoot(root, () => createCharacterAsset('可恢复人物'))
    const profilePath = path.join(root, ...characterPath.split('/'), '角色设定.md')
    const originalProfile = await readFile(profilePath, 'utf8')

    const trashPath = await withProjectRoot(root, () => moveToTrash(characterPath))
    assert.match(trashPath, /^\.workbench\/\.Trash\/[0-9a-f-]+\/可恢复人物$/u)

    const entries = await withProjectRoot(root, () => getTrashEntries())
    assert.equal(entries.length, 1)
    assert.equal(entries[0].name, '可恢复人物')
    assert.equal(entries[0].originalPath, characterPath)
    assert.equal(entries[0].recoverable, true)
    assert.equal(entries[0].isDirectory, true)

    // A real item at the original location must block recovery rather than be overwritten.
    await mkdir(path.join(root, ...characterPath.split('/')))
    await assert.rejects(
      () => withProjectRoot(root, () => restoreTrashEntry(entries[0].id)),
      /already exists/u,
    )
    assert.equal((await withProjectRoot(root, () => getTrashEntries())).length, 1)

    await rm(path.join(root, ...characterPath.split('/')), { recursive: true, force: true })
    const restored = await withProjectRoot(root, () => restoreTrashEntry(entries[0].id))
    assert.equal(restored, characterPath)
    assert.equal(await readFile(profilePath, 'utf8'), originalProfile)
    assert.deepEqual(await withProjectRoot(root, () => getTrashEntries()), [])

    const trashDirectory = path.join(root, '.workbench', '.Trash')
    assert.deepEqual(await readdir(trashDirectory), [])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
