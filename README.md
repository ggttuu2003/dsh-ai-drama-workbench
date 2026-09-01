# AI 漫剧工作台（DeepSeek Harness）

这是一个安装到 DeepSeek Harness Web 档案的本地插件。它不是 Codex 插件，也不会启动单独的 Next.js 服务。

打开 Harness 后，先看到的是普通的 DeepSeek Harness 界面（原生侧栏和会话仍可用）。点击右上角的“进入 AI 漫剧工作台”才会切换为全景资产工作台。工作台不再固定占用聊天栏；左下角只有一个“工具”悬浮入口，展开后可选择“目录预览”或“问 AI”。

## 已实现的工作流

- 从受信任的资产库中选择一个一级项目；浏览器和 AI 只拿到项目 ID 与项目内相对路径，只读取真实文件夹、Markdown、图片和视频。
- 展示 `主要人物/` 的身份基准、多个三视图 / 定妆 / 参考图候选，以及人物下的 `造型/LOOK-*`。
- 展示 `分镜/<场次>/` 和 `SH*` 镜头目录中的场景图、首尾帧、候选、定稿、成片等真实资料槽。
- 对图片执行“设为已选”：同一资料槽中，当前文件改名加 `-已选`，旧选中图恢复原文件名；不复制、不伪造图片。
- 如果有人在 Finder 中手动把同一资料槽的多张图片改成 `-已选`，工作台会明确提示冲突；点击任意一张“统一选此图”会恢复其余候选名，只保留一张真实已选图。
- 删除资产或资料后可在工作台右上角“回收站”查看并恢复；恢复只会回到原项目路径，若已有同名文件则拒绝覆盖。
- Harness 内的 AI 可调用 `ai_drama_inspect`、`ai_drama_stage_proposal`、`ai_drama_get_proposal`、`ai_drama_apply_proposal`、`ai_drama_discard_proposal`。
- AI 的拆解先暂存；只有用户输入精确的“确认写入 `<proposal_id>`”后，才会以可回滚事务创建真实目录和 Markdown。
- 工作台中的人物、场景图和基础镜头图片默认是纯文生图：只读取当前已保存的 Markdown，不会因为资料槽存在 `-已选` 图片就自动上传。镜头首帧/尾帧另有明确的图生图预设：首帧优先读取镜头参考图，其次读取场景图或单人物视觉图；尾帧固定读取已选首帧。视频工作流仍会按要求读取已选首帧和尾帧。任务通过本机服务安全提交到云端 Comfy Bridge；结果会自动格式化并归档到对应资料槽，绝不覆盖现有定稿。

## 安装

先确保 DeepSeek Harness 已安装，并使用 Web 档案。开发目录安装：

```bash
dsh plugin --profile web add /Users/yizhoucp/plugins/dsh-ai-drama-workbench
dsh --profile web --dump-config
dsh web
```

## 新建与切换项目

工作台顶部的“当前项目”是项目入口：点击它可以搜索、切换项目，或选择“＋ 新建项目”。新建后会自动切换到该项目，不需要重启 Harness，也不会出现任意本机路径输入框。

项目库是一个受信任的父目录；每一个项目都是其一级子文件夹。例如：

```text
ai-play-test/
├── my-first-01/
├── 苍龙边关-第一季/
└── 新项目名称/
```

首次安装时，在插件配置中设置 `projectLibraryPath`（推荐）或 `defaultProjectPath`。如果已有旧状态文件，插件会把原项目的父目录自动迁移为项目库。新项目只会真实创建下列基础文件，不会生成示例人物、图片或分镜：

```text
新项目名称/
├── 项目设定.md
├── 主要人物/
└── 分镜/
```

默认状态文件为 `~/.dsh/ai-drama-workbench.json`；若设置了 `DSH_HOME`，则位于 `$DSH_HOME/ai-drama-workbench.json`。它只保存活动项目 ID 与受信任项目库，不会把任意路径暴露给浏览器。

## 用 AI 拆小说

项目名就是书名对应的项目 ID，例如 `my-test`。小说拆解 Skill 会把它传给规划工具，避免误写当前选中的另一个项目：

1. 点击左下角“工具”，再选择“问 AI”打开 Harness 原生对话。
2. 提供书名/项目名和小说片段，要求 AI 使用 `ai_drama_inspect(project_id)` 扫描该项目，再使用同一项目的 `project_fingerprint` 调用 `ai_drama_stage_proposal`。
3. 检查提案摘要和路径后，再让 AI 调用 `ai_drama_get_proposal(project_id, proposal_id)`。
4. 只有确认无误时，在对话中明确输入 `确认写入 <proposal_id>`，再让 AI 调用 `ai_drama_apply_proposal(project_id, proposal_id, confirmation)`。

该流程会生成真实的角色、造型、场景、道具、场次、镜头 Markdown 和标准资料槽；不会伪造图片或视频。Skill 文件位于 `skills/novel-to-drama-assets/`，安装到 Codex 后也可直接复用。

### JSON 结构化索引

项目会在首次扫描时把已有 Markdown 转换为隐藏目录中的 `.workbench/project.json`。之后工作台页面和资产快照优先只读取这个 JSON，不再解析 Markdown；资产发生写入后会自动重新生成 JSON。`.workbench/index.json` 额外保存章节与资产的关系，供章节级关联使用。Markdown 文件仍保留为可读、可编辑的正文，不依赖数据库。

工作台资产接口支持 `{"action":"rebuildProjectIndex"}`，会根据当前项目重建索引并保留已有章节关系。该操作不会删除或覆盖任何 Markdown、图片或视频。

## 接入 ComfyUI

工作台不让浏览器直接访问云端 ComfyUI。完整链路是：

```text
工作台页面
  -> 本机 DSH 插件（令牌只保存在本机）
  -> 云端 Comfy Bridge
  -> 云端 127.0.0.1:8188 的 ComfyUI
```

### 顶部云服务器连接

工作台顶部的“云服务器”可管理本机 SSH 隧道，不需要每次手动输入转发命令。填写服务器地址、SSH 用户、SSH 密码、本地端口及云端服务端口后，点击“启动连接”。工作台会以 `ssh -N -L` 建立只绑定 `127.0.0.1` 的本地转发，并每 10 秒检查隧道进程和本地端口状态；此连接强制使用密码认证，禁用公钥、SSH agent 和复用连接。

配置保存在本机 `~/.dsh/ai-drama-workbench-ssh.json`（或 `$DSH_HOME/ai-drama-workbench-ssh.json`），权限为 `0600`。文件只记录连接参数，不保存 SSH 密码。密码只在本次启动请求中临时传给本机 `ssh` 进程，隧道停止或插件关闭时会清理临时密码助手；停止插件后需按需重新启动隧道。

### 1. 准备云端 Bridge

把本插件的 `cloud-bridge/` 目录复制到 **与 ComfyUI 同一台服务器**。按其中的 [部署说明](cloud-bridge/README.md) 启动；首次请保持 `COMFY_BRIDGE_MODE=mock`，确认连通后再替换真实工作流并改为 `live`。文生图使用 `image-generate`，图生图使用 `image-to-image`：原始 ComfyUI API 导出分别位于 `cloud-bridge/api-workflows/`，`cloud-bridge/workflows/` 中的同名文件只保存节点映射，不要把两者合并。

Bridge 默认只监听服务器回环地址。建议使用 HTTPS 反向代理、Tailscale，或 SSH 隧道把它安全地提供给本机工作台；不要把 ComfyUI 的 `8188` 端口直接暴露到公网。

### 2. 填写本机服务器占位配置

第一次在工作台中点击“生成”时，插件会创建一个权限为 `0600` 的本机配置文件：

```text
~/.dsh/ai-drama-workbench-comfy.json
```

若设置了 `DSH_HOME`，路径会变为 `$DSH_HOME/ai-drama-workbench-comfy.json`。初始文件已经含有两个禁用的占位服务器“云端 A / 云端 B”；把其中一个或两个 profile 替换为你的 Bridge 地址与令牌。令牌不会由配置读取接口返回给浏览器，也不会写入项目资产目录。例如：

```json
{
  "version": 1,
  "activeProfile": "my-cloud-a",
  "profiles": [
    {
      "id": "my-cloud-a",
      "name": "云端 A（H3）",
      "enabled": true,
      "bridgeUrl": "https://REPLACE_WITH_YOUR_BRIDGE_HOST",
      "token": "REPLACE_WITH_THE_LONG_BRIDGE_TOKEN",
      "requestTimeoutMs": 30000,
      "downloadTimeoutMs": 1800000,
      "maxConcurrentJobs": 1,
      "workflowMap": {
        "character-turnaround-v1": "image-generate",
        "character-costume-v1": "image-generate",
        "scene-image-v1": "image-generate",
        "shot-image-v1": "image-generate",
        "shot-first-frame-v1": "image-generate",
        "shot-last-frame-v1": "image-generate",
        "shot-first-frame-img2img-v1": "image-to-image",
        "shot-last-frame-img2img-v1": "image-to-image",
        "h3-first-last-video-v1": "video-first-last"
      }
    },
    {
      "id": "my-cloud-b",
      "name": "备用服务器（先不启用）",
      "enabled": false,
      "bridgeUrl": "",
      "token": ""
    }
  ]
}
```

以后更换服务器时，在同一份配置中新增 profile，然后在“生成”弹窗顶部的“生成服务器”下拉框一键切换即可。每个 profile 都可以有自己的 `workflowMap`，因此不同服务器的工作流名称不必保持一致。

### 3. 在工作台生成

1. 先保存人物、场次或镜头 Markdown；生成只使用磁盘中已保存的内容。
2. 人物、场景图、镜头候选以及纯文生图首尾帧预设不需要选择参考图；场景资产上选择“场景图”即可把结果归档到 `场景图/`。
3. 生成图生图首帧前，先在镜头参考图或场景图中设一张为 `-已选`；若两处都没有，单人物镜头可回退到人物已选视觉图。生成图生图尾帧前，必须先把当前镜头的一张首帧设为 `-已选`。
4. H3 首尾帧视频需要在镜头的首帧和尾帧资料槽中各设一张为 `-已选`。选中资产后点击右上“生成”，选择服务器与固定预设，再点“检查输入”。
5. 确认无误后点“确认生成”。人物三视图/定妆、场景图、镜头候选、首帧、尾帧和 H3 视频都会进入各自对应资料槽；不会自动标为已选或覆盖定稿。

需要拖入 ComfyUI 画布时，请使用 `cloud-bridge/comfyui-workflows/z-image-turbo-image-to-image.json`。Bridge 实际执行的是 `cloud-bridge/api-workflows/image-to-image.api.json`，并由 `cloud-bridge/workflows/image-to-image.json` 声明允许替换的节点字段；后两者都不是画布文件，不能拖入 ComfyUI。三个文件沿用当前 Z-Image Turbo 模型并只使用 ComfyUI 内置的 `LoadImage`、`ImageScale`、`VAEEncode`、`KSampler`、`VAEDecode` 节点。ComfyUI 官方的通用图生图节点连接方式可在 [Image-to-Image 官方示例](https://comfyanonymous.github.io/ComfyUI_examples/img2img/) 查看；官方示例使用 SD1.5，仅用于理解节点连接，不应直接替换本项目的 Z-Image 模型文件。

`H3 首尾帧视频` 会严格要求镜头的首帧和尾帧都已标为 `-已选`。任务开始前会再次校验这些已选文件仍然存在，避免排队期间换图却误用旧参考。任务状态和归档结果会显示在同一生成弹窗内；失败或取消的本地任务可点“重试”，尚未提交到云端的排队任务可点“取消排队”。任务记录保存在项目的隐藏目录 `.workbench/jobs/`，不会出现在资产列表中。

H3 的生成弹窗填写“时长（秒）”。工作台只覆盖 raw API 工作流中的 `140:133.value`，原工作流继续负责分辨率、24 fps 和 `17k+5` 帧数对齐。`downloadTimeoutMs` 只用于把完整视频从 Bridge 下载到本机，默认 30 分钟；普通状态查询仍使用较短的 `requestTimeoutMs`。

本机工作台重启时，会自动恢复尚未提交的本地队列及已有远端编号的轮询；上传、下载、归档等无法确定是否完成的中间态会标为“需要重试”，不会盲目重复提交或覆盖资料。下载后会校验 Bridge 声明的文件大小和 SHA-256，再原子归档到资料槽。

## 回收站与候选图整理

- “移入回收站”不会直接删除文件。每个新移入的项目会记录其原始相对路径；点击右上角“回收站”可查看并恢复。
- 恢复不会覆盖任何现有文件。若先恢复了资料、后恢复其所属人物或镜头导致上级目录不存在，先恢复上级资产即可。
- `-已选` 是文件名中的持久选择状态。请通过“设为参考 / 统一选此图”切换，而不是手动复制定稿；图生图与视频工作流会读取检查页明确列出的已选素材，纯文生图不会上传它。

## 分发给其他人

发布前执行：

```bash
pnpm install
pnpm run build
pnpm pack
```

其他人可用 `dsh plugin --profile web add ./dsh-ai-drama-workbench-0.1.0.tgz` 安装。若直接从 Git 仓库安装，Harness 的 pnpm 可能要求在目标 profile 的 `pnpm-workspace.yaml` 内明确允许此插件的 `prepare` 构建脚本。
