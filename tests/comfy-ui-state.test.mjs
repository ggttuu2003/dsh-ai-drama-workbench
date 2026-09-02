import assert from 'node:assert/strict'
import test from 'node:test'

import {
  reconcileComfyJobWatches,
  watchedComfyAssetPaths,
} from '../src/comfy-ui-state.js'

test('active Comfy jobs are added to the watch map', () => {
  const activeStatuses = [
    'queued',
    'uploading',
    'submitted',
    'running',
    'downloading',
    'archiving',
  ]
  const jobs = activeStatuses.map((status, index) => ({
    id: `job-${index + 1}`,
    status,
  }))

  const result = reconcileComfyJobWatches(new Map(), 'characters/gu-lin', jobs)

  assert.equal(result.archivedCount, 0)
  assert.deepEqual(
    [...result.watches.entries()],
    jobs.map((job) => [job.id, 'characters/gu-lin']),
  )
})

test('a watched completed job with output paths triggers one archive refresh and is removed', () => {
  const active = reconcileComfyJobWatches(new Map(), 'characters/gu-lin', [
    { id: 'job-completed', status: 'running' },
  ])

  const completed = reconcileComfyJobWatches(active.watches, 'characters/gu-lin', [
    {
      id: 'job-completed',
      status: 'completed',
      outputPaths: ['characters/gu-lin/turnaround/result.png'],
    },
  ])

  assert.equal(completed.archivedCount, 1)
  assert.deepEqual(completed.archivedJobs, [{
    id: 'job-completed',
    status: 'completed',
    outputPaths: ['characters/gu-lin/turnaround/result.png'],
  }])
  assert.equal(completed.watches.has('job-completed'), false)

  const observedAgain = reconcileComfyJobWatches(completed.watches, 'characters/gu-lin', [
    {
      id: 'job-completed',
      status: 'completed',
      outputPaths: ['characters/gu-lin/turnaround/result.png'],
    },
  ])

  assert.equal(observedAgain.archivedCount, 0)
  assert.equal(observedAgain.watches.size, 0)
})

test('an untracked historical completed job does not trigger an archive refresh', () => {
  const result = reconcileComfyJobWatches(new Map(), 'characters/gu-lin', [
    {
      id: 'historical-job',
      status: 'completed',
      outputPaths: ['characters/gu-lin/turnaround/old-result.png'],
    },
  ])

  assert.equal(result.archivedCount, 0)
  assert.equal(result.watches.size, 0)
})

test('failed and cancelled watched jobs are removed without triggering an archive refresh', () => {
  const watches = new Map([
    ['failed-job', 'characters/gu-lin'],
    ['cancelled-job', 'shots/EP001-SC001/SH001'],
  ])

  const result = reconcileComfyJobWatches(watches, 'characters/gu-lin', [
    { id: 'failed-job', status: 'failed', error: 'workflow failed' },
    { id: 'cancelled-job', status: 'cancelled' },
  ])

  assert.equal(result.archivedCount, 0)
  assert.equal(result.watches.size, 0)
})

test('multiple jobs share one deduplicated asset path while different assets remain distinct', () => {
  const firstAsset = reconcileComfyJobWatches(new Map(), 'characters/gu-lin', [
    { id: 'job-a', status: 'queued' },
    { id: 'job-b', status: 'running' },
    { id: 'job-a', status: 'running' },
  ])
  const multipleAssets = reconcileComfyJobWatches(
    firstAsset.watches,
    'shots/EP001-SC001/SH001',
    [
      { id: 'job-c', status: 'submitted' },
      { id: 'job-d', status: 'archiving' },
    ],
  )

  assert.equal(multipleAssets.watches.size, 4)
  assert.deepEqual(watchedComfyAssetPaths(multipleAssets.watches), [
    'characters/gu-lin',
    'shots/EP001-SC001/SH001',
  ])
})
