---
name: novel-to-drama-assets
description: 将用户提供的小说或剧本片段拆解为 AI 漫剧项目中的人物、造型、场景、道具、场次和镜头 Markdown 资产；当用户给出书名/项目名并要求建立首章或片段资产时使用。
---

# 小说转漫剧资产

把书名当作项目 ID 使用。项目 ID 是受信任资产库中的一级目录名，例如 `my-test` 或实际书名，不是本机路径。

## 工作流

1. 调用 `ai_drama_inspect`，传入用户给出的书名作为 `project_id`。如果找不到项目，先提示用户在工作台创建项目，不要自行创建项目或猜测路径。
2. 阅读扫描结果，基于小说片段生成严格 JSON 计划，并调用 `ai_drama_stage_proposal`，使用同一个 `project_id` 和 `project_fingerprint`。不要跳过暂存。
3. 向用户展示提案摘要、将创建的相对路径、识别出的复用资产和不确定项。计划至少覆盖片段中实际出现且可复用的角色、身份基准/造型、地点、道具、场次和镜头；不确定的信息写入 Markdown 的待补充项，不要编造媒体文件。
4. 只有用户明确确认后，才调用 `ai_drama_apply_proposal`，传入 `project_id`、`proposal_id` 和精确确认语句 `确认写入 <proposal_id>`。
5. 写入完成后说明真实创建了哪些 Markdown 和空资料槽；图片/视频生成是后续工作流，不能把空资料槽说成已生成媒体。

## 计划约束

计划字段必须包含：`title`、`summary`、`new_characters`、`look_additions`、`reuse_characters`、`new_locations`、`reuse_locations`、`new_props`、`reuse_props`、`new_scenes`、`reuse_scenes`、`notes`。

场次下要提供 `scene_id`、`title`、`summary`、`character_refs`、`location_refs`、`prop_refs`、`cast`、`shots`。每个镜头要提供 `id`、`title`、`content`，并补齐时间码、景别、运镜、台词、提示词、参考资产和状态；人物造型覆盖必须使用 `inherit`、`identity` 或 `look`。

已有资产放入对应的 `reuse_*`，不能放进 `new_*` 以覆盖。一个片段若只产生新人物或道具，也可以单独形成提案；若没有任何新资产或新增 LOOK，则不创建空提案。
