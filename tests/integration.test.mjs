import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectVisual } from '../src/index.js'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bridgePath = path.join(pluginRoot, 'engine', 'planner_bridge.py')

async function runBridge(operation, input, stateDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [bridgePath, operation], {
      env: { ...process.env, AI_DRAMA_PLANNER_STATE_DIR: stateDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      try {
        resolve({ code, body: JSON.parse(stdout), stderr })
      } catch (error) {
        reject(new Error(`规划器没有返回 JSON：${stderr || error.message}`))
      }
    })
    child.stdin.end(JSON.stringify(input))
  })
}

function fullPlan() {
  return {
    title: '测试拆解',
    summary: '创建可复用人物、场景、道具和一个场次。',
    new_characters: [{
      name: '测试角色',
      role_category: '配角',
      identity: '边关信使',
      identity_baseline: '青年，短发，身形利落。',
      traits: ['左眉短疤'],
      baseline_presentation: ['黑色便装'],
      looks: [{
        name: '雨夜装',
        applicable_story: 'EP001',
        costume: '深色短斗篷',
        hair_makeup: '雨水打湿的短发',
        fixed_props: '铜哨',
        continuity: '斗篷前襟破损',
      }],
    }],
    look_additions: [],
    reuse_characters: [],
    new_locations: [{ name: '测试渡口', description: '雾中的石渡口。', key_visuals: ['湿石阶'] }],
    reuse_locations: [],
    new_props: [{ name: '测试铜哨', description: '旧铜制哨子。', continuity: ['始终挂在腰间'] }],
    reuse_props: [],
    new_scenes: [{
      scene_id: 'EP001-SC001',
      title: '渡口相遇',
      time_place: '外景，夜，测试渡口',
      summary: '信使在雾中抵达渡口。',
      mood: '低饱和雨夜',
      continuity: '斗篷前襟保持破损。',
      character_refs: ['测试角色'],
      location_refs: ['测试渡口'],
      prop_refs: ['测试铜哨'],
      cast: [{ character: '测试角色', look: 'LOOK-001', state: '淋雨', continuity: '衣物湿透', start_shot_id: 'SH001', end_shot_id: 'SH001' }],
      shots: [{
        id: 'SH001',
        title: '雾中抵达',
        timecode: '00:00:00:00-00:00:03:00',
        duration: '3 秒',
        framing: '全景，平视',
        content: '测试角色从雾中走上石阶。',
        dialogue: '无',
        camera: '缓慢推进',
        prompt: 'cinematic foggy dock',
        negative_prompt: 'text, watermark',
        references: '测试角色、测试渡口、测试铜哨',
        character_overrides: [{ character: '测试角色', mode: 'inherit', state: '衣角滴水' }],
        status: '待准备',
      }],
    }],
    reuse_scenes: [],
    notes: ['测试不会创建媒体文件。'],
  }
}

function propOnlyPlan() {
  return {
    title: '指纹冲突测试',
    summary: '仅新增一个道具。',
    new_characters: [], look_additions: [], reuse_characters: [],
    new_locations: [], reuse_locations: [],
    new_props: [{ name: '第二测试道具', description: '用于确认指纹变化会阻止写入。', continuity: [] }],
    reuse_props: [], new_scenes: [], reuse_scenes: [], notes: [],
  }
}

test('planner bridge stages, confirms, commits, and rejects stale or repeated proposals', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-planner-'))
  const project = path.join(temporary, 'project')
  const stateDir = path.join(temporary, 'state')
  await mkdir(project)

  try {
    const inspected = await runBridge('inspect', { project_path: project }, stateDir)
    assert.equal(inspected.code, 0)
    assert.equal(inspected.body.ok, true)
    const fingerprint = inspected.body.result.project_fingerprint

    const staged = await runBridge('stage', {
      project_path: project,
      project_fingerprint: fingerprint,
      novel_excerpt: '测试小说片段。',
      plan: fullPlan(),
    }, stateDir)
    assert.equal(staged.code, 0)
    assert.equal(staged.body.ok, true)
    const proposalId = staged.body.result.proposal_id
    assert.match(proposalId, /^proposal_/)

    const fetched = await runBridge('get', { proposal_id: proposalId }, stateDir)
    assert.equal(fetched.body.ok, true)
    assert.equal(fetched.body.result.status, 'staged')

    const wrongConfirmation = await runBridge('apply', { proposal_id: proposalId, confirmation: '确认写入错误编号' }, stateDir)
    assert.equal(wrongConfirmation.body.ok, false)
    assert.match(wrongConfirmation.body.error, /确认语句必须精确/)

    const committed = await runBridge('apply', { proposal_id: proposalId, confirmation: `确认写入 ${proposalId}` }, stateDir)
    assert.equal(committed.code, 0)
    assert.equal(committed.body.result.status, 'applied')
    assert.match(await readFile(path.join(project, '主要人物', '测试角色', '角色设定.md'), 'utf8'), /角色分类：\*\* 配角/)
    assert.match(await readFile(path.join(project, '主要人物', '测试角色', '造型', 'LOOK-001-雨夜装', '造型设定.md'), 'utf8'), /LOOK-001/)
    assert.match(await readFile(path.join(project, '分镜', 'EP001-SC001', 'SH001-雾中抵达', '镜头.md'), 'utf8'), /继承场次/)
    assert.match(await readFile(path.join(project, '分镜', 'EP001-SC001', '出场与造型表.md'), 'utf8'), /LOOK-001-雨夜装/)

    const repeated = await runBridge('apply', { proposal_id: proposalId, confirmation: `确认写入 ${proposalId}` }, stateDir)
    assert.equal(repeated.body.ok, false)
    assert.match(repeated.body.error, /不是待确认状态/)

    const afterCommit = await runBridge('inspect', { project_path: project }, stateDir)
    const staleStage = await runBridge('stage', {
      project_path: project,
      project_fingerprint: afterCommit.body.result.project_fingerprint,
      novel_excerpt: '第二段测试小说片段。',
      plan: propOnlyPlan(),
    }, stateDir)
    const staleId = staleStage.body.result.proposal_id
    await writeFile(path.join(project, '主要人物', '测试角色', '角色设定.md'), '# 外部修改\n', 'utf8')
    const staleApply = await runBridge('apply', { proposal_id: staleId, confirmation: `确认写入 ${staleId}` }, stateDir)
    assert.equal(staleApply.body.ok, false)
    assert.match(staleApply.body.error, /项目在提案后已变化/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('selected visual rename only accepts recognized asset slots', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-ai-drama-visual-'))
  const project = path.join(temporary, 'project')
  const image = Buffer.from('not-a-real-image-but-a-safe-test-file')

  try {
    const characterSlot = path.join(project, '主要人物', '测试人物', '三视图')
    await mkdir(characterSlot, { recursive: true })
    await writeFile(path.join(project, '主要人物', '测试人物', '角色设定.md'), '# 测试人物\n', 'utf8')
    await writeFile(path.join(characterSlot, '01-已选.png'), image)
    await writeFile(path.join(characterSlot, '02.png'), image)
    const resolvedProject = await realpath(project)

    const selected = await selectVisual(resolvedProject, '主要人物/测试人物/三视图/02.png')
    assert.equal(selected.selectedPath, '主要人物/测试人物/三视图/02-已选.png')
    assert.equal((await readFile(path.join(characterSlot, '01.png'))).toString(), image.toString())
    assert.equal((await readFile(path.join(characterSlot, '02-已选.png'))).toString(), image.toString())

    const shotSlot = path.join(project, '分镜', 'EP001-SC001', 'SH001-测试', '候选')
    await mkdir(shotSlot, { recursive: true })
    await writeFile(path.join(project, '分镜', 'EP001-SC001', 'SH001-测试', '镜头.md'), '# SH001 测试\n', 'utf8')
    await writeFile(path.join(shotSlot, '镜头候选.png'), image)
    await selectVisual(resolvedProject, '分镜/EP001-SC001/SH001-测试/候选/镜头候选.png')
    assert.equal((await readFile(path.join(shotSlot, '镜头候选-已选.png'))).toString(), image.toString())

    const untrackedSlot = path.join(project, '未归档', '三视图')
    await mkdir(untrackedSlot, { recursive: true })
    await writeFile(path.join(untrackedSlot, '不应改名.png'), image)
    await assert.rejects(() => selectVisual(resolvedProject, '未归档/三视图/不应改名.png'), /工作台识别的视觉资料槽/)

    await writeFile(path.join(characterSlot, '文本.txt'), 'not media', 'utf8')
    await assert.rejects(() => selectVisual(resolvedProject, '主要人物/测试人物/三视图/文本.txt'), /只能将当前资料槽中的图片/)

    const external = path.join(temporary, 'external.png')
    await writeFile(external, image)
    await symlink(external, path.join(characterSlot, '外部链接.png'))
    await assert.rejects(() => selectVisual(resolvedProject, '主要人物/测试人物/三视图/外部链接.png'), /不允许读取软链接媒体/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
