const ACTIVE_COMFY_JOB_STATUSES = new Set([
  'queued',
  'uploading',
  'submitted',
  'running',
  'downloading',
  'archiving',
])

function isArchivedComfyJob(job) {
  return job?.status === 'completed'
    && Array.isArray(job.outputPaths)
    && job.outputPaths.length > 0
}

export function reconcileComfyJobWatches(currentWatches, assetPath, jobs) {
  const watches = new Map(currentWatches)
  let archivedCount = 0

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job.id !== 'string' || !job.id) continue
    if (ACTIVE_COMFY_JOB_STATUSES.has(job.status)) {
      watches.set(job.id, assetPath)
      continue
    }
    if (!watches.has(job.id)) continue
    watches.delete(job.id)
    if (isArchivedComfyJob(job)) archivedCount += 1
  }

  return { watches, archivedCount }
}

export function watchedComfyAssetPaths(watches) {
  return [...new Set(watches.values())].sort((left, right) => left.localeCompare(right, 'zh-CN'))
}
