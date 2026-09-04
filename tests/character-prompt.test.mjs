import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCharacterCostumePrompt,
  buildCharacterTurnaroundPrompt,
  readCharacterLookPromptFields,
  readCharacterTurnaroundPromptFields,
} from '../lib/workspace-core.js'

test('character turnaround prefers a dedicated section and reads fenced JSON', () => {
  const markdown = `# 测试人物角色设定

\`\`\`json
{
  "turnaround_prompt": "JSON 三视图提示词，不应优先于专用章节。",
  "negative_prompt": "JSON 负面提示词"
}
\`\`\`

## 三视图提示词

人物三视图设定图，单人全身，正面、左侧面、背面并列，短黑发，深色短衣。

## 三视图负面提示词

文字，水印，重复人物。
`

  assert.deepEqual(readCharacterTurnaroundPromptFields(markdown), {
    prompt: '人物三视图设定图，单人全身，正面、左侧面、背面并列，短黑发，深色短衣。',
    negativePrompt: '文字，水印，重复人物。',
  })
  assert.equal(
    buildCharacterTurnaroundPrompt(markdown),
    '人物三视图设定图，单人全身，正面、左侧面、背面并列，短黑发，深色短衣。',
  )

  const jsonOnly = `# JSON 人物

人物身份说明：这段普通 Markdown 不应成为提示词。

\`\`\`json
{"turnaround_prompt":"人物三视图，正面、侧面、背面，银发。","negative_prompt":"文字，水印"}
\`\`\``
  assert.deepEqual(readCharacterTurnaroundPromptFields(jsonOnly), {
    prompt: '人物三视图，正面、侧面、背面，银发。',
    negativePrompt: '文字，水印',
  })
  assert.equal(
    buildCharacterTurnaroundPrompt(jsonOnly),
    '人物三视图，正面、侧面、背面，银发。',
  )
})

test('prompt sections remove an optional labelled-list wrapper', () => {
  const markdown = `# 标签写法

## 三视图提示词

- **提示词：** 人物三视图，正面、侧面、背面，黑色短发。

## 三视图负面提示词

- **负面提示词：** 文字、水印。
`

  assert.deepEqual(readCharacterTurnaroundPromptFields(markdown), {
    prompt: '人物三视图，正面、侧面、背面，黑色短发。',
    negativePrompt: '文字、水印。',
  })

  assert.deepEqual(readCharacterTurnaroundPromptFields(`## turnaround_prompt\n\n正面、侧面、背面，银发。`), {
    prompt: '正面、侧面、背面，银发。',
    negativePrompt: '',
  })
})

test('legacy character Markdown falls back to visual turnaround content only', () => {
  const legacyProfile = `# 陆鸣角色设定

## 身份基准

- **角色分类：** 主角
- **身份：** 十四五岁的雷火馆少年弟子，陆瑾之孙、陆青炎之子，正在修炼神通之道。
- **身份基准说明：** 身姿挺拔，背脊如枪，面庞带少年稚气，眼神明亮沉稳。
- **提案来源：** proposal_legacy

人物根目录是身份基准，具体服装和妆发写入造型目录。

## 身份锁定特征

- 十四五岁
- 明亮沉稳的眼神

## 基础呈现（不等同于 LOOK）

- 赤红雷火馆服
- 雷霆与火焰纹样

## 旧资料槽兼容

根目录保留三视图和参考图资料槽。

## 制作备注

本章不锁定具体功法手印。`

  const prompt = buildCharacterTurnaroundPrompt(legacyProfile)

  for (const excluded of [
    '# 陆鸣角色设定',
    '提案来源',
    'proposal_legacy',
    '陆瑾之孙',
    '陆青炎之子',
    '正在修炼神通之道',
    '人物根目录',
    '旧资料槽',
    '制作备注',
  ]) {
    assert.equal(prompt.includes(excluded), false, `fallback must exclude: ${excluded}`)
  }
  for (const required of ['身姿挺拔', '正面', '侧面', '背面']) {
    assert.equal(prompt.includes(required), true, `fallback must include: ${required}`)
  }
})

test('legacy visual fields also accept a colon outside the bold label', () => {
  const markdown = `# 人物\n\n## 身份基准\n\n- **身份基准说明**：少年，黑色短发，身姿挺拔。\n- **基础服饰**：深色短衣。`
  const prompt = buildCharacterTurnaroundPrompt(markdown)
  assert.match(prompt, /黑色短发/u)
  assert.match(prompt, /深色短衣/u)
  assert.match(prompt, /正面、侧面、背面/u)
})

test('LOOK prompt fields prefer a dedicated section and read fenced JSON', () => {
  const markdown = `# LOOK-001

\`\`\`json
{"prompt":"JSON 造型提示词，不应优先于专用章节。","negative_prompt":"JSON 负面提示词"}
\`\`\`

## 造型图提示词

人物定妆图，赤红馆服，少年短发，正面、侧面、背面。

## 造型图负面提示词

文字，水印，重复人物。
`

  assert.deepEqual(readCharacterLookPromptFields(markdown), {
    prompt: '人物定妆图，赤红馆服，少年短发，正面、侧面、背面。',
    negativePrompt: '文字，水印，重复人物。',
  })

  const jsonOnly = `# LOOK-002

造型说明：这段普通 Markdown 不应成为提示词。

\`\`\`json
{"prompt":"造型三视图，青色长袍，整洁发髻。","negative_prompt":"文字，水印"}
\`\`\``
  assert.deepEqual(readCharacterLookPromptFields(jsonOnly), {
    prompt: '造型三视图，青色长袍，整洁发髻。',
    negativePrompt: '文字，水印',
  })
})

test('legacy LOOK fallback keeps visual wardrobe details without document metadata', () => {
  const profile = `# 陆鸣角色设定

## 身份基准

- **身份基准说明：** 十四五岁少年，短黑发，身姿挺拔，眼神沉稳。

## 身份锁定特征

- 左眉细疤

## 基础呈现

- 赤红馆服`
  const look = `# LOOK-001 雷火馆修炼服

## 造型定位

- **人物：** 陆鸣
- **造型编号：** LOOK-001
- **造型名称：** 雷火馆修炼服
- **提案来源：** proposal_legacy

## 服装与连续性

- **服装：** 赤红馆服，雷火纹样
- **妆发：** 少年短发，干净利落
- **固定道具：** 待补充
- **连续性：** 进入主院保持同一馆服。

## 制作备注

待补充`

  const prompt = buildCharacterCostumePrompt(profile, look)

  for (const excluded of ['人物：', '陆鸣', '造型编号', 'LOOK-001', '待补充', '提案来源', '进入主院']) {
    assert.equal(prompt.includes(excluded), false, `LOOK fallback must exclude: ${excluded}`)
  }
  for (const required of ['赤红馆服，雷火纹样', '少年短发，干净利落', '正面', '侧面', '背面']) {
    assert.equal(prompt.includes(required), true, `LOOK fallback must include: ${required}`)
  }
})
