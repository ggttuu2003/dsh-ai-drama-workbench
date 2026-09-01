"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { reconcileComfyJobWatches, watchedComfyAssetPaths } from "./comfy-ui-state.js";

import type {
  AssetFile,
  AssetSlot,
  AssetWorkspaceSnapshot,
  CharacterAsset,
  CharacterLook,
  CharacterVisualSlotKey,
  LocationAsset,
  PropAsset,
  ProjectStructureSnapshot,
  SceneCastBinding,
  SceneLocationBinding,
  ScenePropBinding,
  SceneAsset,
  ShotAsset,
  ShotCharacterOverride,
  ShotDesign,
  TrashEntry,
  TreeNode,
} from "@/lib/types";

type Snapshot = AssetWorkspaceSnapshot & { error?: string };
type ProjectBoundSnapshot = Snapshot & { projectId?: string };
type ActiveTab = "characters" | "locations" | "props" | "shots";
type ModalKind = "character" | "location" | "prop" | "look" | "scene" | "shot" | "rename" | "trash" | "trashList" | "import" | "generation" | "projectSettings" | null;

type ImportSourceGroup = {
  sourcePath: string;
  shots: ShotAsset[];
};

type SceneGroup = {
  sceneId: string;
  scene?: SceneAsset;
  shots: ShotAsset[];
  draftCount: number;
};

type StoryboardImportResponse = {
  ok?: boolean;
  sourcePath: string;
  created: Array<{ shotId: string; path: string }>;
  skipped: Array<{ shotId: string; reason: string }>;
  errors: Array<{ shotId: string; error: string }>;
  warnings: string[];
};

type WorkbenchProject = {
  id: string;
  name: string;
  updatedAt?: string;
  initialized?: boolean;
};

type ProjectRegistryResponse = {
  libraryLabel?: string;
  activeProjectId?: string;
  projects?: WorkbenchProject[];
  error?: string;
};

type ProjectRegistryAction =
  | { action: "select"; projectId: string }
  | { action: "create"; name: string };

class AssetApiError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function normalizeSnapshot(value: unknown): ProjectBoundSnapshot {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const arrayField = <T,>(key: string): T[] => Array.isArray(source[key]) ? source[key] as T[] : [];
  return {
    ...source,
    rootName: typeof source.rootName === "string" ? source.rootName : "ai-play-test",
    projectSettings: source.projectSettings && typeof source.projectSettings === "object"
      ? source.projectSettings as AssetWorkspaceSnapshot["projectSettings"]
      : { path: "项目设定.md", content: "", revision: "" },
    characters: arrayField<CharacterAsset>("characters"),
    locations: arrayField<LocationAsset>("locations"),
    props: arrayField<PropAsset>("props"),
    scenes: arrayField<SceneAsset>("scenes"),
    shots: arrayField<ShotAsset>("shots"),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString(),
  } as ProjectBoundSnapshot;
}

const EMPTY_DESIGN: ShotDesign = {
  sceneId: "",
  shotId: "",
  title: "",
  timecode: "",
  duration: "",
  framing: "",
  content: "",
  dialogue: "",
  camera: "",
  prompt: "",
  negativePrompt: "",
  references: "",
  characterOverrides: [],
  status: "待生成",
};

const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 500 * 1024 * 1024;
const WORKBENCH_API_BASE = "/ai-drama/workbench";
const SELECTED_VISUAL_SUFFIX = /(?:-|_)已选$/u;
const SELECTABLE_VISUAL_SLOTS = new Set(["turnaround", "costume", "reference", "setting", "firstFrame", "lastFrame", "candidate"]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function mediaUrl(file: AssetFile): string {
  const query = new URLSearchParams({ path: file.path });
  if (file.projectId) query.set("projectId", file.projectId);
  return `${WORKBENCH_API_BASE}/asset?${query.toString()}`;
}

function isImage(file: AssetFile): boolean {
  return file.kind === "image";
}

function isVideo(file: AssetFile): boolean {
  return file.kind === "video";
}

function isSelectedVisual(file: AssetFile): boolean {
  if (!isImage(file)) return false;
  const extensionIndex = file.name.lastIndexOf(".");
  const stem = extensionIndex > 0 ? file.name.slice(0, extensionIndex) : file.name;
  return SELECTED_VISUAL_SUFFIX.test(stem);
}

function selectedSlotVisualFiles(slot: AssetSlot): AssetFile[] {
  return slot.files
    .filter(isSelectedVisual)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function selectedSlotVisual(slot: AssetSlot): AssetFile | undefined {
  return selectedSlotVisualFiles(slot)[0];
}

function assetSlot(asset: { slots: AssetSlot[] }, key: string): AssetSlot | undefined {
  return asset.slots.find((slot) => slot.key === key);
}

function hasSingleSelectedSlotVisual(asset: { slots: AssetSlot[] }, key: string): boolean {
  const slot = assetSlot(asset, key);
  return Boolean(slot && selectedSlotVisualFiles(slot).length === 1);
}

function isCharacterVisualSlotKey(slotKey: string): slotKey is CharacterVisualSlotKey {
  return slotKey === "turnaround" || slotKey === "costume" || slotKey === "reference";
}

type WorkspaceSelectionAsset = CharacterAsset | LocationAsset | PropAsset | SceneAsset | ShotAsset;

function firstMedia(asset: WorkspaceSelectionAsset): AssetFile | undefined {
  if (asset.cover && (isImage(asset.cover) || isVideo(asset.cover))) return asset.cover;
  return asset.slots.flatMap((slot) => slot.files).find((file) => isImage(file) || isVideo(file));
}

type SceneAssetBinding = SceneLocationBinding | ScenePropBinding;

function isSceneBindingValue(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ["role", "state", "continuity", "startShotId", "endShotId"].every((key) => typeof record[key] === "string");
}

function sceneLocationBindings(scene: SceneAsset): SceneLocationBinding[] {
  return Array.isArray(scene.locationBindings)
    ? scene.locationBindings.filter((binding): binding is SceneLocationBinding => (
      isSceneBindingValue(binding) && typeof binding.locationPath === "string"
    )).map((binding) => ({ ...binding }))
    : [];
}

function scenePropBindings(scene: SceneAsset): ScenePropBinding[] {
  return Array.isArray(scene.propBindings)
    ? scene.propBindings.filter((binding): binding is ScenePropBinding => (
      isSceneBindingValue(binding) && typeof binding.propPath === "string"
    )).map((binding) => ({ ...binding }))
    : [];
}

function bindingReferencesAsset(binding: SceneAssetBinding, asset: LocationAsset | PropAsset): boolean {
  return asset.type === "location"
    ? "locationPath" in binding && binding.locationPath === asset.rootPath
    : "propPath" in binding && binding.propPath === asset.rootPath;
}

const CHARACTER_VISUAL_SLOT_LABELS: Record<CharacterVisualSlotKey, string> = {
  turnaround: "三视图",
  costume: "定妆",
  reference: "参考图",
};

type CharacterVisual = {
  slot: CharacterVisualSlotKey;
  label: string;
  file: AssetFile;
};

type CharacterVisualSource = {
  key: string;
  label: string;
  isIdentity: boolean;
  rootPath?: string;
  documentContent?: string;
  documentRevision?: string;
  slots: AssetSlot[];
  confirmedVisuals: Partial<Record<CharacterVisualSlotKey, AssetFile>>;
  confirmedVisualSourcePaths: Partial<Record<CharacterVisualSlotKey, string>>;
};

function characterVisualSources(asset: CharacterAsset): CharacterVisualSource[] {
  return [
    {
      key: "identity",
      label: "身份基准",
      isIdentity: true,
      slots: asset.slots,
      confirmedVisuals: asset.confirmedVisuals,
      confirmedVisualSourcePaths: asset.confirmedVisualSourcePaths,
    },
    ...asset.looks.map((look) => ({
      key: look.rootPath,
      label: `${look.id} · ${look.name}`,
      isIdentity: false,
      rootPath: look.rootPath,
      documentContent: look.documentContent,
      documentRevision: look.documentRevision,
      slots: look.slots,
      confirmedVisuals: look.confirmedVisuals,
      confirmedVisualSourcePaths: look.confirmedVisualSourcePaths,
    })),
  ];
}

function selectedCharacterVisuals(source: CharacterVisualSource): CharacterVisual[] {
  const visuals: CharacterVisual[] = [];
  for (const slot of ["turnaround", "costume", "reference"] as const) {
    const file = source.confirmedVisuals[slot];
    if (!file || !isImage(file)) continue;
    visuals.push({ slot, label: CHARACTER_VISUAL_SLOT_LABELS[slot], file });
  }
  return visuals;
}

function getLookForPath(character: CharacterAsset | undefined, lookPath: string | undefined): CharacterLook | undefined {
  return lookPath ? character?.looks.find((look) => look.rootPath === lookPath) : undefined;
}

function displayLookLabel(character: CharacterAsset | undefined, lookPath: string | undefined): string {
  const look = getLookForPath(character, lookPath);
  return look ? `${look.id} · ${look.name}` : "身份基准";
}

function shotNumericValue(shotId: string): number | undefined {
  const match = shotId.match(/^(?:SH)?(\d{1,6})$/iu);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function shotDurationSeconds(value: string): string | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:秒(?:钟)?|s(?:ec(?:onds?)?)?)?$/iu);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 60 ? String(seconds) : undefined;
}

function bindingAppliesToShot(
  binding: Pick<SceneCastBinding, "startShotId" | "endShotId">,
  shotId: string,
): boolean {
  const current = shotNumericValue(shotId);
  if (current === undefined) return !binding.startShotId && !binding.endShotId;
  const start = binding.startShotId ? shotNumericValue(binding.startShotId) : undefined;
  const end = binding.endShotId ? shotNumericValue(binding.endShotId) : undefined;
  return (start === undefined || current >= start) && (end === undefined || current <= end);
}

function formatBindingRange(binding: SceneCastBinding): string {
  if (!binding.startShotId && !binding.endShotId) return "全场";
  return `${binding.startShotId || "首镜"} - ${binding.endShotId || "尾镜"}`;
}

function assetKey(asset: WorkspaceSelectionAsset): string {
  if (asset.type === "character") return `character:${asset.rootPath}`;
  if (asset.type === "location") return `location:${asset.rootPath}`;
  if (asset.type === "prop") return `prop:${asset.rootPath}`;
  if (asset.type === "scene") return `scene:${asset.rootPath}`;
  return `shot:${asset.rootPath || `${asset.design.sceneId}:${asset.design.shotId}`}`;
}

function displayShotTitle(shot: ShotAsset): string {
  return shot.design.title || "未命名镜头";
}

function storyboardImportSelector(shot: ShotAsset): string {
  // A source Markdown may restart at SH001 for every scene. Keep the scene
  // identity attached even when the current UI is scoped to one scene.
  return `${shot.design.sceneId}/${shot.design.shotId}`;
}

function displayWorkspaceAssetTitle(asset: WorkspaceSelectionAsset): string {
  if (asset.type === "character") return asset.name;
  if (asset.type === "location" || asset.type === "prop") return asset.name;
  if (asset.type === "scene") return `${asset.sceneId} · 场次资料`;
  return `${asset.design.shotId} · ${displayShotTitle(asset)}`;
}

function displayFileName(relativePath: string): string {
  return relativePath.split(/[\\/]/).filter(Boolean).pop() || relativePath;
}

function displaySelectedVisualName(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
  // `-已选` is persistence metadata. The surrounding UI already conveys selection.
  return `${baseName.replace(/-已选$/u, "")}${extension}`;
}

function characterInitial(name: string): string {
  return Array.from(name.trim())[0] || "人";
}

function assetMatchesSearch(asset: WorkspaceSelectionAsset, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  const searchableText = asset.type === "character"
    ? `${asset.name} ${asset.roleCategory} ${asset.profileContent || ""}`
    : asset.type === "scene"
      ? `${asset.sceneId} ${asset.sceneContent || ""}`
      : asset.type === "location" || asset.type === "prop"
        ? `${asset.name} ${asset.profileContent || ""}`
      : `${asset.design.shotId} ${asset.design.title} ${asset.design.content} ${asset.design.sceneId}`;
  return searchableText.toLocaleLowerCase().includes(normalizedQuery);
}

function suggestNextShotId(shots: ShotAsset[]): string {
  const largestNumber = shots.reduce((largest, shot) => {
    const match = shot.design.shotId.match(/^(?:SH)?(\d+)$/i);
    return match ? Math.max(largest, Number.parseInt(match[1], 10)) : largest;
  }, 0);
  return `SH${String(largestNumber + 1).padStart(3, "0")}`;
}

function previewFile(file: AssetFile | undefined, label: string): React.ReactNode {
  if (!file) {
    return <span className="asset-placeholder-mark" aria-hidden="true">＋</span>;
  }
  if (isImage(file)) {
    return <img className="asset-thumb" src={mediaUrl(file)} alt={label} loading="lazy" />;
  }
  if (isVideo(file)) {
    return <video className="asset-thumb" src={mediaUrl(file)} muted preload="metadata" aria-label={label} />;
  }
  return <span className="asset-file-mark">{file.kind === "markdown" ? "文档" : "文件"}</span>;
}

function PrimaryMedia({
  file,
  label,
  onPreview,
}: {
  file: AssetFile;
  label: string;
  onPreview: () => void;
}) {
  return (
    <section className="asset-primary-media" aria-label={`${label}主预览`}>
      <div className="asset-primary-visual">
        {isImage(file) ? (
          <button
            aria-label={`放大查看${file.name}`}
            className="asset-primary-image-button"
            onClick={onPreview}
            type="button"
          >
            <img src={mediaUrl(file)} alt={`${label} · ${file.name}`} />
          </button>
        ) : (
          <video className="asset-primary-video" controls playsInline preload="metadata" src={mediaUrl(file)}>
            当前浏览器无法播放此视频。
          </video>
        )}
      </div>
      <div className="asset-primary-meta">
        <div>
          <p className="eyebrow">主预览</p>
          <strong title={file.name}>{file.name}</strong>
          <small>{formatSize(file.size)}</small>
        </div>
        <button className="asset-primary-open" onClick={onPreview} type="button">
          {isImage(file) ? "查看大图" : "全屏播放"}
        </button>
      </div>
    </section>
  );
}

function CharacterVisualBoard({
  characterName,
  sourceLabel,
  visuals,
  onPreview,
}: {
  characterName: string;
  sourceLabel: string;
  visuals: CharacterVisual[];
  onPreview: (file: AssetFile) => void;
}) {
  const primary = visuals.find((visual) => visual.slot === "turnaround") ?? visuals[0];
  const supportingVisuals = visuals.filter((visual) => visual.file.path !== primary.file.path);

  return (
    <section className="character-visual-board" aria-label={`${characterName}${sourceLabel}已选视觉资料`}>
      <div className="character-visual-main">
        <div className="character-visual-board-heading">
          <div>
            <p className="eyebrow">{sourceLabel}</p>
            <strong>{primary.label}</strong>
          </div>
          <span>已选</span>
        </div>
        <button
          aria-label={`放大查看已选${primary.label}${primary.file.name}`}
          className="character-visual-main-button"
          onClick={() => onPreview(primary.file)}
          type="button"
        >
          <img alt={`${characterName} · ${sourceLabel} · 已选${primary.label}`} src={mediaUrl(primary.file)} />
        </button>
        <p className="character-visual-file-name" title={primary.file.name}>{displaySelectedVisualName(primary.file.name)}</p>
      </div>
      {supportingVisuals.length ? <div className="character-visual-supporting" aria-label="已选辅助视觉">
        <p className="eyebrow">已选定妆与参考</p>
        <div className="character-visual-supporting-grid">
          {supportingVisuals.map((visual) => <article className="character-visual-supporting-card" key={visual.slot}>
            <button
              aria-label={`放大查看已选${visual.label}${visual.file.name}`}
              className="character-visual-supporting-button"
              onClick={() => onPreview(visual.file)}
              type="button"
            >
              <img alt={`${characterName} · ${sourceLabel} · 已选${visual.label}`} src={mediaUrl(visual.file)} />
            </button>
            <div>
              <strong>{visual.label}</strong>
              <small title={visual.file.name}>{displaySelectedVisualName(visual.file.name)}</small>
            </div>
          </article>)}
        </div>
      </div> : null}
    </section>
  );
}

function MediaLightbox({ file, onClose }: { file: AssetFile; onClose: () => void }) {
  return (
    <div
      className="media-lightbox-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="media-lightbox-title"
        aria-modal="true"
        className="media-lightbox"
        role="dialog"
      >
        <header className="media-lightbox-head">
          <div>
            <strong id="media-lightbox-title" title={file.name}>{file.name}</strong>
            <small>{formatSize(file.size)}</small>
          </div>
          <button aria-label="关闭媒体预览" autoFocus className="media-lightbox-close" onClick={onClose} type="button">×</button>
        </header>
        <div className="media-lightbox-stage">
          {isImage(file) ? (
            <img className="media-lightbox-image" src={mediaUrl(file)} alt={file.name} />
          ) : (
            <video autoPlay className="media-lightbox-video" controls playsInline src={mediaUrl(file)}>
              当前浏览器无法播放此视频。
            </video>
          )}
        </div>
      </section>
    </div>
  );
}

function AssetCard({
  asset,
  active,
  sceneReferenceCount,
  onClick,
}: {
  asset: WorkspaceSelectionAsset;
  active: boolean;
  sceneReferenceCount?: number;
  onClick: () => void;
}) {
  if (asset.type === "shot") {
    return (
      <button aria-current={active ? "true" : undefined} className={`asset-card shot-list-item ${active ? "is-active" : ""}`} onClick={onClick} type="button">
        <span className="shot-list-id">{asset.design.shotId || "未编号"}</span>
        <span className="shot-list-copy">
          <strong>{displayShotTitle(asset)}</strong>
          <small>{asset.design.duration || "未设时长"}</small>
        </span>
        {asset.isDraft ? <span className="shot-list-state">待导入</span> : null}
      </button>
    );
  }

  const media = firstMedia(asset);
  const simpleAsset = asset.type === "location" || asset.type === "prop";
  return (
    <button aria-current={active ? "true" : undefined} className={`asset-card character-list-item ${simpleAsset ? "simple-asset-list-item" : ""} ${active ? "is-active" : ""}`} onClick={onClick} type="button">
      <div className="asset-card-cover">
        {media ? previewFile(media, asset.name) : <span className="character-avatar-letter" aria-hidden="true">{characterInitial(asset.name)}</span>}
      </div>
      <span className="asset-card-copy">
        <strong>{asset.name}</strong>
        <small className="character-role-label">{asset.type === "character" ? asset.roleCategory : asset.type === "location" ? "地点/环境资产" : "道具资产"}</small>
        {asset.type === "location" || asset.type === "prop" ? <small className="asset-reference-count">{sceneReferenceCount ? `被 ${sceneReferenceCount} 个场次引用` : "尚未被场次引用"}</small> : null}
      </span>
    </button>
  );
}

function SceneAssetCard({
  scene,
  active,
  onClick,
}: {
  scene: SceneAsset;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={`scene-asset-card ${active ? "is-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="scene-asset-card-mark">场</span>
      <span className="scene-asset-card-copy">
        <small>场次资产</small>
        <strong>{scene.sceneId}</strong>
        <em>{scene.shotCount} 个镜头 · {scene.isComplete ? "场次资料已就绪" : "待补齐场次资料"}</em>
      </span>
    </button>
  );
}

type ShotWorkflowStepId = "design" | "reference" | "firstFrame" | "lastFrame" | "video";

type ShotWorkflowNode = {
  id: ShotWorkflowStepId;
  label: string;
  state: "done" | "current" | "pending";
};

function ShotWorkflowStepper({
  activeStep,
  disabled = false,
  nodes,
  onSelect,
}: {
  activeStep: ShotWorkflowStepId;
  disabled?: boolean;
  nodes: ShotWorkflowNode[];
  onSelect: (step: ShotWorkflowStepId) => void | Promise<void>;
}) {
  return <nav aria-label="当前镜头制作流程" className="storyboard-stepper">
    {nodes.map((node, index) => <button
      aria-current={activeStep === node.id ? "step" : undefined}
      className={`storyboard-step is-${node.state}`}
      disabled={disabled}
      key={node.id}
      onClick={() => onSelect(node.id)}
      type="button"
    >
      <span className="storyboard-step-index">{node.state === "done" ? "✓" : String(index + 1).padStart(2, "0")}</span>
      <span className="storyboard-step-copy"><strong>{node.label}</strong></span>
    </button>)}
  </nav>;
}

function WorkflowFramePreview({
  file,
  label,
  onPreview,
}: {
  file?: AssetFile;
  label: string;
  onPreview: (file: AssetFile) => void;
}) {
  return <article className={`workflow-frame-preview ${file ? "has-file" : ""}`}>
    <p className="eyebrow">{label}</p>
    {file && isImage(file) ? <button aria-label={`查看${label}`} onClick={() => onPreview(file)} type="button"><img alt={label} src={mediaUrl(file)} /></button> : <div className="workflow-frame-empty">未选择</div>}
    <strong title={file?.name}>{file ? displaySelectedVisualName(file.name) : label}</strong>
  </article>;
}

function WorkflowStepFooter({
  disabled,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return <footer className="workflow-step-footer"><button className="submit-button" disabled={disabled} onClick={onClick} type="button">{label}</button></footer>;
}

function SlotPanel({
  slot,
  disabled,
  confirmedFile,
  confirmedSourcePath,
  onUpload,
  onTrash,
  onPreview,
  onSetConfirmed,
}: {
  slot: AssetSlot;
  disabled?: boolean;
  confirmedFile?: AssetFile;
  confirmedSourcePath?: string;
  onUpload: (files: FileList | null) => void;
  onTrash: (file: AssetFile) => void;
  onPreview: (file: AssetFile) => void;
  onSetConfirmed?: (file: AssetFile) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canConfirmSelection = Boolean(onSetConfirmed);
  const visualFiles = slot.files.filter((file) => isImage(file) || isVideo(file));
  const selectionCandidates = visualFiles.filter(isImage);
  // A user may rename files outside the workbench. Do not silently choose the
  // newest one when more than one candidate claims the persisted `-已选` state.
  const markedSelectedFiles = selectionCandidates.filter(isSelectedVisual);
  const hasSelectionConflict = canConfirmSelection && markedSelectedFiles.length > 1;
  const effectiveConfirmedFile = hasSelectionConflict
    ? undefined
    : confirmedFile ?? markedSelectedFiles[0];
  const effectiveConfirmedSourcePath = effectiveConfirmedFile?.path;
  const candidateCountLabel = `${selectionCandidates.length} 张候选`;
  const confirmedName = effectiveConfirmedFile?.name;
  const selectionAction = slot.key === "firstFrame" || slot.key === "lastFrame" ? "设为已选" : "设为参考";
  const uploadLabel = canConfirmSelection
    ? visualFiles.length ? "继续添加候选" : `添加${slot.label}候选`
    : `添加${slot.label}`;
  return (
    <article className={`asset-slot ${disabled ? "is-disabled" : ""}`}>
      <div className="asset-slot-heading">
        <div>
          <p className="eyebrow">{canConfirmSelection ? "候选池 · 多张可选" : "资料槽"}</p>
          <h3>{slot.label}</h3>
        </div>
        <div className="asset-slot-heading-actions">
          {hasSelectionConflict ? <span className="asset-slot-confirmed is-conflict" title="同一资料槽中不应有多张带 -已选 的图片">需整理</span> : null}
          {effectiveConfirmedFile ? <span className="asset-slot-confirmed" title={`当前选择：${effectiveConfirmedFile.name}`}>已选</span> : null}
          <span className={`asset-slot-count ${canConfirmSelection ? "asset-slot-candidate-count" : ""}`} title={canConfirmSelection ? candidateCountLabel : `${visualFiles.length} 个资料`}>
            {canConfirmSelection ? candidateCountLabel : visualFiles.length}
          </span>
        </div>
      </div>
      <div className="asset-slot-body">
        {canConfirmSelection ? <div className={`turnaround-selection-summary ${effectiveConfirmedFile ? "has-confirmed" : ""} ${hasSelectionConflict ? "has-conflict" : ""}`}>
          <div>
            <strong>{hasSelectionConflict ? "检测到多个已选图" : effectiveConfirmedFile ? "当前选择" : "尚未选择参考图"}</strong>
            <span title={hasSelectionConflict ? markedSelectedFiles.map((file) => file.name).join("、") : confirmedName}>{hasSelectionConflict ? `${markedSelectedFiles.length} 张候选被同时标为已选` : confirmedName || "从下方候选中任选一张"}</span>
          </div>
          <small>{hasSelectionConflict ? "点击任意一张“统一选此图”即可自动恢复其余候选名。" : visualFiles.length ? "其余候选会保留，可随时重新选择。" : "可一次或分批添加多张候选图。"}</small>
        </div> : null}
        {visualFiles.length ? (
          <div className="asset-file-grid">
            {visualFiles.map((file) => {
              const isConfirmed = effectiveConfirmedSourcePath === file.path;
              const isMarkedSelected = isSelectedVisual(file);
              return (
              <div className={`asset-file-card ${isConfirmed ? "is-confirmed" : ""} ${hasSelectionConflict && isMarkedSelected ? "has-selection-conflict" : ""}`} key={file.path}>
                <button
                  aria-label={`预览${file.name}`}
                  className="asset-file-preview asset-file-preview-button"
                  onClick={() => onPreview(file)}
                  type="button"
                >
                  {previewFile(file, file.name)}
                </button>
                <div className="asset-file-meta">
                  <strong title={file.name}>{file.name}</strong>
                  <small>{formatSize(file.size)}</small>
                </div>
                {canConfirmSelection && isImage(file) ? <button
                  aria-label={hasSelectionConflict ? `将 ${file.name} 作为唯一${slot.label}${selectionAction === "设为已选" ? "已选图" : "参考"}，并恢复同槽其他已选候选` : isConfirmed ? `${file.name} 是当前选择` : `将 ${file.name} ${selectionAction}`}
                  className={`asset-file-confirm ${isConfirmed ? "is-confirmed" : ""}`}
                  disabled={disabled || isConfirmed}
                  onClick={() => onSetConfirmed?.(file)}
                  type="button"
                >{hasSelectionConflict ? "统一选此图" : isConfirmed ? "当前选择" : selectionAction}</button> : null}
                <button
                  aria-label={isConfirmed || isMarkedSelected ? `${file.name} 带有已选标记，请先选择另一张候选图或统一资料槽状态` : `将 ${file.name} 移入回收站`}
                  className="asset-file-remove"
                  disabled={disabled || isConfirmed || isMarkedSelected}
                  onClick={() => onTrash(file)}
                  type="button"
                >
                  ×
                </button>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="slot-empty"><span className="slot-empty-icon" aria-hidden="true">＋</span><span>尚无资料</span><small>{canConfirmSelection ? `${slot.label}文件夹中还没有候选图片` : `${slot.label}文件夹中还没有图片或视频`}</small></div>
        )}
      </div>
      <input
        accept={canConfirmSelection ? "image/*" : "image/*,video/*"}
        aria-label={canConfirmSelection ? `选择${slot.label}候选文件` : `选择${slot.label}文件`}
        className="visually-hidden"
        disabled={disabled}
        multiple
        onChange={(event) => {
          onUpload(event.target.files);
          event.currentTarget.value = "";
        }}
        ref={inputRef}
        type="file"
      />
      <button className="slot-upload-button" disabled={disabled} onClick={() => inputRef.current?.click()} type="button">
        <span aria-hidden="true">↑</span>{disabled ? "创建资产后可上传" : uploadLabel}
      </button>
    </article>
  );
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`asset-field ${multiline ? "is-multiline" : ""}`}>
      <span>{label}</span>
      {multiline ? (
        <textarea disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
      ) : (
        <input disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
      )}
    </label>
  );
}

type SelectOption = {
  value: string;
  label: ReactNode;
};

function SelectField({
  ariaLabel,
  className = "",
  disabled = false,
  label,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return;
    const nextIndex = Math.min(highlightedIndex, Math.max(options.length - 1, 0));
    optionRefs.current[nextIndex]?.focus();
  }, [highlightedIndex, open, options.length]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current || !event.composedPath().includes(rootRef.current)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "Tab") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const chooseOption = (nextValue: string) => {
    onChange(nextValue);
    const nextIndex = options.findIndex((option) => option.value === nextValue);
    if (nextIndex >= 0) setHighlightedIndex(nextIndex);
    closeMenu();
  };

  const moveOption = (offset: number) => {
    if (!options.length) return;
    const nextIndex = (highlightedIndex + offset + options.length) % options.length;
    setHighlightedIndex(nextIndex);
  };

  const openMenu = () => {
    setHighlightedIndex(selectedIndex);
    setOpen(true);
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveOption(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveOption(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(Math.max(options.length - 1, 0));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseOption(options[index].value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      if (!open) openMenu();
      else moveOption(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (!open) openMenu();
      else moveOption(-1);
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setHighlightedIndex(options.length - 1);
    } else if ((event.key === "Enter" || event.key === " ") && !open) {
      event.preventDefault();
      openMenu();
    }
  };

  return (
    <div className={`select-field ${className} ${disabled ? "is-disabled" : ""}`.trim()} ref={rootRef}>
      {label ? <span className="select-field-label">{label}</span> : null}
      <div className="select-control">
        <button
          aria-controls={open ? menuId : undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className="select-trigger"
          disabled={disabled || !options.length}
          onClick={() => { if (open) closeMenu(); else openMenu(); }}
          onKeyDown={handleTriggerKeyDown}
          ref={triggerRef}
          type="button"
        >
          <span className="select-trigger-value">{selectedOption?.label ?? "暂无选项"}</span>
          <span aria-hidden="true" className={`select-trigger-chevron ${open ? "is-open" : ""}`} />
        </button>
        {open && options.length ? <div className="select-menu" id={menuId} role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => <button
            aria-selected={option.value === value}
            className={`select-option ${option.value === value ? "is-selected" : ""} ${index === highlightedIndex ? "is-highlighted" : ""}`}
            id={`${menuId}-option-${index}`}
            key={option.value}
            onClick={() => chooseOption(option.value)}
            onKeyDown={(event) => handleOptionKeyDown(event, index)}
            ref={(element) => { optionRefs.current[index] = element; }}
            role="option"
            type="button"
          >
            <span>{option.label}</span>
            {option.value === value ? <span aria-hidden="true" className="select-option-check">✓</span> : null}
          </button>)}
        </div> : null}
      </div>
    </div>
  );
}

function formatProjectUpdatedAt(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日更新`;
}

function formatTimestamp(value?: string): string {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function ProjectPicker({
  currentProjectId,
  activeProjectName,
  disabled = false,
  onProjectAction,
}: {
  currentProjectId?: string | null;
  activeProjectName: string;
  disabled?: boolean;
  onProjectAction: (action: ProjectRegistryAction) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "create">("list");
  const [projects, setProjects] = useState<WorkbenchProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [libraryLabel, setLibraryLabel] = useState("");
  const [search, setSearch] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  const closePicker = useCallback((restoreFocus = false) => {
    setOpen(false);
    setMode("list");
    setSearch("");
    setNewProjectName("");
    setError("");
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${WORKBENCH_API_BASE}/projects`, { cache: "no-store" });
      const data = (await response.json()) as ProjectRegistryResponse;
      if (!response.ok) throw new Error(data.error || "无法读取项目列表");
      const nextProjects = Array.isArray(data.projects)
        ? data.projects.filter((project): project is WorkbenchProject => Boolean(
          project
          && typeof project.id === "string"
          && typeof project.name === "string",
        ))
        : [];
      setProjects(nextProjects);
      setActiveProjectId(currentProjectId || (typeof data.activeProjectId === "string" ? data.activeProjectId : ""));
      setLibraryLabel(typeof data.libraryLabel === "string" ? data.libraryLabel : "");
    } catch (loadError) {
      setProjects([]);
      setError(loadError instanceof Error ? loadError.message : "无法读取项目列表");
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    if (!open || mode !== "list") return;
    void loadProjects();
  }, [loadProjects, mode, open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current || !event.composedPath().includes(rootRef.current)) closePicker();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePicker(true);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePicker, open]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => {
      if (mode === "create") createInputRef.current?.focus();
      else searchRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [mode, open]);

  useEffect(() => {
    if (!disabled || !open) return;
    closePicker();
  }, [closePicker, disabled, open]);

  const openPicker = () => {
    if (disabled) return;
    if (open) {
      closePicker(true);
      return;
    }
    setMode("list");
    setSearch("");
    setNewProjectName("");
    setError("");
    setOpen(true);
  };

  const runAction = async (action: ProjectRegistryAction) => {
    setSubmitting(true);
    setError("");
    try {
      const completed = await onProjectAction(action);
      if (completed) closePicker(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "项目操作未能完成");
    } finally {
      setSubmitting(false);
    }
  };

  const visibleProjects = projects.filter((project) => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return !keyword || project.name.toLocaleLowerCase("zh-CN").includes(keyword);
  });

  const openCreate = () => {
    setMode("create");
    setNewProjectName("");
    setError("");
  };

  const showList = () => {
    setMode("list");
    setError("");
  };

  const handleCreateSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name || submitting) return;
    void runAction({ action: "create", name });
  };

  return (
    <div className={`topbar-center project-switcher ${open ? "is-open" : ""}`.trim()} ref={rootRef}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`切换项目，当前项目：${activeProjectName}`}
        className="project-switcher-trigger"
        disabled={disabled}
        onClick={openPicker}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="status-dot" />
        <span className="project-switcher-label">当前项目</span>
        <strong>{activeProjectName}</strong>
        <span aria-hidden="true" className="project-switcher-chevron" />
      </button>

      {open ? <section aria-label="项目切换" className={`project-picker ${mode === "create" ? "is-create" : ""}`} id={panelId} role="dialog">
        {mode === "list" ? <>
          <header className="project-picker-heading">
            <div>
              <p className="eyebrow">{libraryLabel || "项目库"}</p>
              <h2>项目</h2>
            </div>
            <button aria-label="关闭项目选择器" className="project-picker-close" disabled={submitting} onClick={() => closePicker(true)} type="button">×</button>
          </header>
          <label className="project-picker-search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="搜索项目" onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目" ref={searchRef} value={search} />
            {search ? <button aria-label="清空项目搜索" onClick={() => setSearch("")} type="button">×</button> : null}
          </label>
          <div aria-busy={loading || submitting} className="project-picker-list" role="list">
            {loading ? <p className="project-picker-status">正在读取项目…</p> : error ? <div className="project-picker-status is-error"><span>{error}</span><button disabled={submitting} onClick={() => void loadProjects()} type="button">重试</button></div> : visibleProjects.length ? visibleProjects.map((project) => {
              const current = project.id === activeProjectId;
              const updatedAt = formatProjectUpdatedAt(project.updatedAt);
              return <button
                aria-current={current ? "page" : undefined}
                className={`project-picker-option ${current ? "is-current" : ""}`}
                disabled={submitting}
                key={project.id}
                onClick={() => { if (current) closePicker(true); else void runAction({ action: "select", projectId: project.id }); }}
                role="listitem"
                type="button"
              >
                <span className="project-picker-option-copy"><strong>{project.name}</strong>{updatedAt ? <small>{updatedAt}</small> : null}</span>
                {current ? <span className="project-picker-current">当前</span> : null}
              </button>;
            }) : <p className="project-picker-status">{search ? "没有匹配的项目" : "项目库中还没有可切换项目"}</p>}
          </div>
          <footer className="project-picker-footer">
            <button className="project-picker-create" disabled={loading || submitting} onClick={openCreate} type="button"><span aria-hidden="true">＋</span>新建项目</button>
          </footer>
        </> : <form className="project-create-form" onSubmit={handleCreateSubmit}>
          <header className="project-picker-heading">
            <div>
              <p className="eyebrow">{libraryLabel || "项目库"}</p>
              <h2>新建项目</h2>
            </div>
            <button aria-label="返回项目列表" className="project-picker-close" disabled={submitting} onClick={showList} type="button">←</button>
          </header>
          <label className="project-create-field">
            <span>项目名称</span>
            <input autoComplete="off" disabled={submitting} onChange={(event) => setNewProjectName(event.target.value)} placeholder="例如：第一季-边关篇" ref={createInputRef} value={newProjectName} />
          </label>
          <p className="project-create-hint">会在当前项目库中建立同名文件夹，并准备分镜主工作流与人物、地点/环境、道具资产库。</p>
          {error ? <p className="project-create-error" role="alert">{error}</p> : null}
          <footer className="project-create-actions">
            <button className="text-button" disabled={submitting} onClick={showList} type="button">取消</button>
            <button className="submit-button" disabled={submitting || !newProjectName.trim()} type="submit">{submitting ? "创建中…" : "创建项目"}</button>
          </footer>
        </form>}
      </section> : null}
    </div>
  );
}

function StructureBranch({
  depth,
  expandedPaths,
  nodes,
  onTogglePath,
}: {
  depth: number;
  expandedPaths: ReadonlySet<string>;
  nodes: readonly TreeNode[];
  onTogglePath: (path: string) => void;
}) {
  return (
    <ul className={depth === 0 ? "structure-tree" : "structure-tree-branch"}>
      {nodes.map((node) => {
        const isFolder = node.kind === "folder";
        const hasChildren = Boolean(node.children?.length);
        const expanded = expandedPaths.has(node.path);
        const rowStyle = { paddingLeft: `${8 + depth * 15}px` };

        return (
          <li key={node.path}>
            {isFolder && hasChildren ? (
              <button
                aria-expanded={expanded}
                className="structure-tree-row structure-tree-folder"
                onClick={() => onTogglePath(node.path)}
                style={rowStyle}
                title={node.path}
                type="button"
              >
                <span aria-hidden="true" className={`structure-tree-disclosure ${expanded ? "is-expanded" : ""}`} />
                <span aria-hidden="true" className="structure-tree-icon is-folder" />
                <span className="structure-tree-name">{node.name}</span>
              </button>
            ) : (
              <div className="structure-tree-row" style={rowStyle} title={node.path}>
                <span aria-hidden="true" className="structure-tree-disclosure is-empty" />
                <span aria-hidden="true" className={`structure-tree-icon ${isFolder ? "is-folder" : "is-file"}`} />
                <span className="structure-tree-name">{node.name}</span>
              </div>
            )}
            {isFolder && hasChildren && expanded ? <StructureBranch
              depth={depth + 1}
              expandedPaths={expandedPaths}
              nodes={node.children || []}
              onTogglePath={onTogglePath}
            /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function ProjectStructureViewer({
  error,
  expandedPaths,
  hideTrigger = false,
  loading,
  onRefresh,
  onTogglePath,
  open,
  setOpen,
  structure,
}: {
  error: string | null;
  expandedPaths: ReadonlySet<string>;
  hideTrigger?: boolean;
  loading: boolean;
  onRefresh: () => void;
  onTogglePath: (path: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  structure: ProjectStructureSnapshot | null;
}) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (!viewerRef.current || !event.composedPath().includes(viewerRef.current)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, setOpen]);

  return (
    <div className="project-structure-float" ref={viewerRef}>
      {open ? <section aria-label="项目目录和文件结构" className="project-structure-panel" id={panelId}>
        <header className="project-structure-head">
          <div>
            <p className="eyebrow">只读项目结构</p>
            <h2>{structure?.rootName || "项目目录"}</h2>
          </div>
          <div className="project-structure-actions">
            <button aria-label="刷新项目结构" className="project-structure-refresh" disabled={loading} onClick={onRefresh} title="刷新目录" type="button">
              <span aria-hidden="true">&#8635;</span>
            </button>
            {hideTrigger ? <button aria-label="关闭项目结构" className="project-structure-refresh" onClick={() => setOpen(false)} title="关闭目录" type="button">×</button> : null}
          </div>
        </header>
        <div aria-busy={loading} aria-live="polite" className="project-structure-body">
          {loading ? <p className="project-structure-status">正在读取目录...</p> : error ? <p className="project-structure-status is-error">{error}</p> : structure?.tree.length ? <StructureBranch
            depth={0}
            expandedPaths={expandedPaths}
            nodes={structure.tree}
            onTogglePath={onTogglePath}
          /> : <p className="project-structure-status">项目中还没有可展示的文件。</p>}
        </div>
      </section> : null}
      {!hideTrigger ? <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={open ? "关闭项目结构" : "查看项目目录和文件结构"}
        className={`project-structure-fab ${open ? "is-open" : ""}`}
        onClick={() => setOpen(!open)}
        title={open ? "关闭目录" : "查看目录"}
        type="button"
      >
        <span aria-hidden="true" className="project-structure-fab-icon" />
      </button> : null}
    </div>
  );
}

function ProfilePreview({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const cleanInline = (value: string) => value.replace(/\*\*/g, "").replace(/`/g, "");

  if (!content.trim()) {
    return <div className="profile-preview is-empty">还没有角色设定，点击“编辑”开始补充。</div>;
  }

  let inCodeBlock = false;
  return (
    <div aria-label="角色设定预览" className="profile-preview">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div className="profile-preview-space" key={`space-${index}`} />;
        if (trimmed.startsWith("```")) {
          inCodeBlock = !inCodeBlock;
          return null;
        }
        if (inCodeBlock) return <p className="profile-preview-code" key={`code-${index}`}>{cleanInline(trimmed)}</p>;
        const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
        if (heading) {
          return <h4 key={`heading-${index}`}>{cleanInline(heading[1])}</h4>;
        }
        const listItem = trimmed.match(/^[-*]\s+(.+)$/);
        if (listItem) {
          return <p className="profile-preview-list-item" key={`list-${index}`}><span aria-hidden="true">•</span><span>{cleanInline(listItem[1])}</span></p>;
        }
        return <p key={`paragraph-${index}`}>{cleanInline(trimmed)}</p>;
      })}
    </div>
  );
}

function DraftSummary({ design }: { design: ShotDesign }) {
  const items = [
    ["时码", design.timecode],
    ["时长", design.duration],
    ["景别 / 机位", design.framing],
  ] as const;
  return (
    <section className="draft-summary" aria-label="分镜草稿摘要">
      <div className="draft-summary-lead">
        <span className="draft-summary-mark" aria-hidden="true">剧</span>
        <div>
          <strong>这是可导入的剧本镜头</strong>
          <p>确认内容后建立资产，原始剧本不会被改写。</p>
        </div>
      </div>
      <dl className="draft-summary-grid">
        {items.map(([label, value]) => <div className="draft-summary-item" key={label}><dt>{label}</dt><dd>{value || "未填写"}</dd></div>)}
      </dl>
      <div className="draft-summary-block"><h4>画面描述</h4><p>{design.content || "原始脚本没有填写画面描述。"}</p></div>
      <div className="draft-summary-block"><h4>台词</h4><p>{design.dialogue || "无台词"}</p></div>
      <div className="draft-summary-block"><h4>运镜</h4><p>{design.camera || "未填写"}</p></div>
    </section>
  );
}

function ShotDesignPreview({ design }: { design: ShotDesign }) {
  const primaryText = design.content.trim() || design.prompt.trim();
  const textBlocks = [
    ["台词", design.dialogue],
    ["运镜", design.camera],
    ["提示词", design.prompt && design.prompt.trim() !== primaryText ? design.prompt : ""],
    ["人物备注", design.references],
  ] as const;
  const meta = [
    ["时码", design.timecode],
    ["时长", design.duration],
    ["景别 / 机位", design.framing],
  ] as const;
  return <div aria-label="镜头设计预览" className="shot-design-preview">
    <div className="shot-design-preview-main">
      <span className="shot-design-preview-label">画面描述</span>
      <p>{primaryText || "暂无镜头描述"}</p>
    </div>
    <dl className="shot-design-preview-meta">
      {meta.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "未填写"}</dd></div>)}
    </dl>
    {textBlocks.some(([, value]) => value.trim()) ? <div className="shot-design-preview-notes">
      {textBlocks.map(([label, value]) => value.trim() ? <div key={label}><span>{label}</span><p>{value}</p></div> : null)}
    </div> : null}
  </div>;
}

type ComfyProfile = {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  bridgeUrl?: string;
};

type ComfyPreset = {
  id: string;
  label: string;
  description: string;
  assetTypes: WorkspaceSelectionAsset["type"][];
  outputSlotLabel: string;
  outputKind: "image" | "video";
  referenceImagesEnabled?: boolean;
  defaults?: { width?: number; height?: number; seed?: number; denoise?: number; frames?: number; fps?: number; durationSeconds?: number };
  inputs?: Array<{ key: string; type: "string" | "integer" | "number" }>;
};

type ComfyJob = {
  id: string;
  status: string;
  presetLabel?: string;
  createdAt?: string;
  updatedAt?: string;
  message?: string;
  error?: string;
  errorCode?: string;
  outputPaths?: string[];
};

type ComfyPreview = {
  summary?: string;
  outputSlotLabel?: string;
  prompt?: string;
  negativePrompt?: string;
  attachments?: Array<{ role: string; name: string }>;
  warnings?: string[];
  errors?: string[];
};

function isLegacyReferenceUploadFailure(job: ComfyJob): boolean {
  return job.status === "failed" && /upload role:\s*referenceImage/iu.test(job.error || "");
}

function formatComfyJobStatus(job: ComfyJob): string {
  if (job.status === "completed") {
    if (job.outputPaths?.length) return "候选已归档";
    if (job.message === "Comfy Bridge 模拟验证完成。") return "模拟验证完成（未生成媒体）";
    return "任务已完成";
  }
  if (isLegacyReferenceUploadFailure(job)) return "历史任务失败（旧版参考图）";
  return ({
    queued: "待提交",
    uploading: "上传素材中",
    submitted: "已提交 ComfyUI",
    running: "生成中",
    downloading: "下载归档中",
    archiving: "正在归档",
    failed: "生成失败",
    cancelled: "已取消",
  } as Record<string, string>)[job.status] || job.status;
}

function formatComfyJobDetail(job: ComfyJob): string {
  if (isLegacyReferenceUploadFailure(job)) return " · 点击重试会按当前纯文生图重新提交";
  return job.error ? ` · ${job.error}` : "";
}

function GenerationModal({
  asset,
  initialDurationSeconds,
  initialPresetId,
  lookPath,
  projectId,
  onClose,
  onJobsObserved,
  onQueued,
}: {
  asset: WorkspaceSelectionAsset;
  initialDurationSeconds?: string;
  initialPresetId?: string;
  lookPath?: string;
  projectId?: string;
  onClose: () => void;
  onJobsObserved: (assetPath: string, jobs: ComfyJob[]) => void;
  onQueued: (assetPath: string, job: ComfyJob) => void;
}) {
  const [profiles, setProfiles] = useState<ComfyProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [presets, setPresets] = useState<ComfyPreset[]>([]);
  const [presetId, setPresetId] = useState("");
  const [jobs, setJobs] = useState<ComfyJob[]>([]);
  const [preview, setPreview] = useState<ComfyPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actingJobId, setActingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState("1024");
  const [height, setHeight] = useState("1024");
  const [seed, setSeed] = useState("");
  const [denoise, setDenoise] = useState("0.65");
  const [frames, setFrames] = useState("121");
  const [fps, setFps] = useState("24");
  const [durationSeconds, setDurationSeconds] = useState("5");
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const [negativePromptDraft, setNegativePromptDraft] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const promptInitializationKeyRef = useRef<string | null>(null);
  const assetPath = asset.rootPath;
  const availablePresets = presets.filter((preset) => preset.assetTypes.includes(asset.type));
  // A workflow opened from a shot step is intentionally locked. If the
  // server does not expose that preset, keep the modal unavailable instead
  // of silently falling back to an unrelated workflow.
  const activePreset = initialPresetId
    ? availablePresets.find((preset) => preset.id === initialPresetId)
    : availablePresets.find((preset) => preset.id === presetId) ?? availablePresets[0];
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const isVideo = activePreset?.outputKind === "video";
  const promptInitializationKey = !isVideo && activePreset
    ? [projectId || "", asset.type, assetPath, lookPath || "", activePreset.id].join("\u0000")
    : "";
  const promptHydrationBody = useMemo(() => ({
    assetType: asset.type,
    assetPath,
    ...(asset.type === "character" && lookPath ? { lookPath } : {}),
    presetId: activePreset?.id,
    ...(projectId ? { projectId } : {}),
    options: { useReferenceImages: Boolean(activePreset?.referenceImagesEnabled) },
  }), [activePreset?.id, activePreset?.referenceImagesEnabled, asset.type, assetPath, lookPath, projectId]);

  useEffect(() => {
    document.body.dataset.aiDramaGeneration = "open";
    return () => { delete document.body.dataset.aiDramaGeneration; };
  }, []);

  const request = useCallback(async <T extends object>(endpoint: string, init?: RequestInit): Promise<T> => {
    const url = new URL(`${WORKBENCH_API_BASE}/comfy${endpoint}`, window.location.origin);
    if (projectId) url.searchParams.set("projectId", projectId);
    const response = await fetch(`${url.pathname}${url.search}`, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || "ComfyUI 任务操作失败");
    return data;
  }, [projectId]);

  const reload = useCallback(async () => {
    if (!assetPath) return;
    setLoading(true);
    setError(null);
    try {
      const [configResponse, presetResponse, jobResponse] = await Promise.all([
        request<{ profiles: ComfyProfile[]; activeProfileId: string; configPath?: string }>("/config"),
        request<{ presets: ComfyPreset[] }>("/presets"),
        request<{ jobs: ComfyJob[] }>(`/jobs?assetPath=${encodeURIComponent(assetPath)}`),
      ]);
      setProfiles(configResponse.profiles);
      setActiveProfileId(configResponse.activeProfileId);
      setConfigPath(configResponse.configPath || "");
      setPresets(presetResponse.presets);
      setJobs(jobResponse.jobs);
      onJobsObserved(assetPath, jobResponse.jobs);
      const matching = presetResponse.presets.filter((preset) => preset.assetTypes.includes(asset.type));
      const next = initialPresetId
        ? matching.find((preset) => preset.id === initialPresetId)
        : matching.find((preset) => preset.id === presetId) ?? matching[0];
      if (!next) {
        if (initialPresetId) setError("当前流程所需的受控工作流不可用，请检查 ComfyUI 预设配置。");
        return;
      }
      setPresetId(next.id);
      setWidth(String(next.defaults?.width ?? 1024));
      setHeight(String(next.defaults?.height ?? 1024));
      setSeed(next.defaults?.seed === undefined ? "" : String(next.defaults.seed));
      setDenoise(String(next.defaults?.denoise ?? 0.65));
      setFrames(String(next.defaults?.frames ?? 121));
      setFps(String(next.defaults?.fps ?? 24));
      setDurationSeconds(initialPresetId === "h3-first-last-video-v1" && initialDurationSeconds
        ? initialDurationSeconds
        : String(next.defaults?.durationSeconds ?? 5));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取 ComfyUI 配置");
    } finally {
      setLoading(false);
    }
  }, [asset.type, assetPath, initialDurationSeconds, initialPresetId, onJobsObserved, presetId, request]);

  useEffect(() => { void reload(); }, [reload]);
  // A preflight result is tied to the exact server, preset, and parameter
  // values that produced it. Any edit invalidates that result so a stale
  // approval cannot be submitted accidentally.
  useEffect(() => {
    setPreview(null);
  }, [activeProfileId, activePreset?.id, denoise, durationSeconds, frames, fps, height, negativePromptDraft, promptDraft, seed, width]);
  useEffect(() => {
    if (!assetPath) return undefined;
    const timer = window.setInterval(() => { void request<{ jobs: ComfyJob[] }>(`/jobs?assetPath=${encodeURIComponent(assetPath)}`)
      .then((data) => {
        setJobs(data.jobs);
        onJobsObserved(assetPath, data.jobs);
      }).catch(() => undefined); }, 3_500);
    return () => window.clearInterval(timer);
  }, [assetPath, onJobsObserved, request]);

  const payload = () => ({
    assetType: asset.type,
    assetPath,
    ...(asset.type === "character" && lookPath ? { lookPath } : {}),
    presetId: activePreset?.id,
    profileId: activeProfileId,
    ...(projectId ? { projectId } : {}),
    // Keep prompt edits task-local. Null means the initial server preview has
    // not arrived yet, so omit overrides and let the server derive its value.
    ...(!isVideo && promptDraft !== null ? {
      prompt: promptDraft,
      negativePrompt: negativePromptDraft ?? "",
    } : {}),
    options: {
      width,
      height,
      seed,
      denoise,
      frames,
      fps,
      durationSeconds,
      useReferenceImages: Boolean(activePreset?.referenceImagesEnabled),
    },
  });

  useEffect(() => {
    setPromptDraft(null);
    setNegativePromptDraft(null);
    setPromptLoading(false);
    if (!promptInitializationKey) promptInitializationKeyRef.current = null;
  }, [promptInitializationKey]);

  useEffect(() => {
    if (!promptInitializationKey || loading || !activePreset) return;
    if (promptInitializationKeyRef.current === promptInitializationKey) return;
    promptInitializationKeyRef.current = promptInitializationKey;
    let cancelled = false;
    setPromptLoading(true);
    // The first preflight is intentionally silent: it only hydrates the
    // editable values with the exact prompt the server derives from Markdown.
    void request<{ preview: ComfyPreview }>("/jobs/preview", { body: JSON.stringify(promptHydrationBody), method: "POST" })
      .then(({ preview: nextPreview }) => {
        if (cancelled) return;
        setPromptDraft(typeof nextPreview.prompt === "string" ? nextPreview.prompt : "");
        setNegativePromptDraft(typeof nextPreview.negativePrompt === "string" ? nextPreview.negativePrompt : "");
      })
      .catch(() => {
        if (cancelled) return;
        // Keep the fields usable if an older server does not yet expose prompt
        // values in previews, or if this read-only request cannot complete.
        setPromptDraft("");
        setNegativePromptDraft("");
      })
      .finally(() => {
        if (!cancelled) setPromptLoading(false);
      });
    return () => { cancelled = true; };
  }, [loading, promptHydrationBody, promptInitializationKey, request]);

  const chooseProfile = async (profileId: string) => {
    setActiveProfileId(profileId);
    setPreview(null);
    try {
      await request<{ activeProfileId: string }>("/config/active", { body: JSON.stringify({ profileId }), method: "POST" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法切换服务器");
      await reload();
    }
  };

  const choosePreset = (nextId: string) => {
    const next = availablePresets.find((preset) => preset.id === nextId);
    setPresetId(nextId);
    setPreview(null);
    if (!next) return;
    setWidth(String(next.defaults?.width ?? 1024));
    setHeight(String(next.defaults?.height ?? 1024));
    setSeed(next.defaults?.seed === undefined ? "" : String(next.defaults.seed));
    setDenoise(String(next.defaults?.denoise ?? 0.65));
    setFrames(String(next.defaults?.frames ?? 121));
    setFps(String(next.defaults?.fps ?? 24));
    setDurationSeconds(String(next.defaults?.durationSeconds ?? 5));
  };

  const inspectInputs = async () => {
    if (!assetPath || !activePreset) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await request<{ preview: ComfyPreview }>("/jobs/preview", { body: JSON.stringify(payload()), method: "POST" });
      setPreview(data.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法检查生成输入");
    } finally {
      setSubmitting(false);
    }
  };

  const queueJob = async () => {
    if (!assetPath || !activePreset) return;
    setSubmitting(true);
    setError(null);
    try {
      // Always run the preflight immediately before submission so the primary
      // action does not require a separate manual click.
      const previewData = await request<{ preview: ComfyPreview }>("/jobs/preview", { body: JSON.stringify(payload()), method: "POST" });
      setPreview(previewData.preview);
      if (previewData.preview.errors?.length) return;
      const data = await request<{ job: ComfyJob }>("/jobs", { body: JSON.stringify(payload()), method: "POST" });
      setJobs((current) => [data.job, ...current]);
      setPreview(null);
      onQueued(assetPath, data.job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法提交生成任务");
    } finally {
      setSubmitting(false);
    }
  };

  const actOnJob = async (job: ComfyJob, action: "retry" | "cancel") => {
    setActingJobId(job.id);
    setError(null);
    try {
      const data = await request<{ job: ComfyJob }>(`/jobs/${encodeURIComponent(job.id)}/${action}`, { body: "{}", method: "POST" });
      setJobs((current) => action === "retry"
        ? [data.job, ...current.filter((item) => item.id !== job.id)]
        : current.map((item) => item.id === data.job.id ? data.job : item));
      if (action === "retry") onQueued(assetPath, data.job);
      else onJobsObserved(assetPath, [data.job]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : action === "retry" ? "无法重新排队任务" : "无法取消排队任务");
    } finally {
      setActingJobId(null);
    }
  };

  if (!assetPath) {
    return <div className="modal-backdrop"><section aria-modal="true" className="modal-card generation-modal" role="dialog"><div className="modal-heading"><div><p className="eyebrow">ComfyUI 生成</p><h2>先建立镜头资产</h2></div><button aria-label="关闭" className="icon-button" onClick={onClose} type="button">×</button></div><p className="modal-copy">剧本草稿还没有对应的真实镜头目录。先建立镜头资产，工作台才能安全地归档首帧、尾帧和视频候选。</p><div className="modal-actions"><button className="text-button" onClick={onClose} type="button">知道了</button></div></section></div>;
  }

  const profileReady = Boolean(activeProfile?.enabled && activeProfile?.configured);
  const canSubmit = Boolean(activePreset && profileReady);
  const supportsInput = (key: string) => Boolean(activePreset?.inputs?.some((input) => input.key === key));
  const hasEditableVideoSpec = ["width", "height", "durationSeconds", "frames", "fps"].some(supportsInput);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-labelledby="generation-modal-title" aria-modal="true" className="modal-card generation-modal" role="dialog">
      <header className="modal-heading generation-modal-heading">
        <div><p className="eyebrow">ComfyUI 生成</p><h2 id="generation-modal-title">{displayWorkspaceAssetTitle(asset)}</h2></div>
        <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">×</button>
      </header>
      <div className="generation-modal-body">
          <div className="generation-asset-strip">
          <div className="generation-asset-strip-copy"><span>当前资产</span><strong>{displayWorkspaceAssetTitle(asset)}</strong><small>{isVideo ? "读取已保存设定，并使用已选首帧和尾帧" : activePreset?.referenceImagesEnabled ? "图生图：可临时改提示词，上传检查页列出的已选输入图" : "纯文生图：可临时改提示词，不上传参考图"}</small></div>
          <span className="generation-output-kind">{isVideo ? "视频候选" : "图片候选"}</span>
        </div>
        {loading ? <p className="generation-loading">正在读取服务器配置与工作流预设…</p> : <>
          <div className="generation-layout">
            <div className="generation-main-column">
              <section className="generation-section">
                <div className="generation-section-heading"><div><strong>任务设置</strong><span>选择生成服务器和受控工作流</span></div></div>
                <div className="generation-form-grid">
                  <SelectField ariaLabel="选择 ComfyUI 服务器" label="生成服务器" onChange={(value) => void chooseProfile(value)} options={profiles.map((profile) => ({ label: `${profile.name}${profile.configured && profile.enabled ? "" : " · 未配置"}`, value: profile.id }))} value={activeProfileId} />
                  {initialPresetId ? <div className="generation-fixed-preset"><span>工作流</span><strong>{activePreset?.label || (loading ? "正在读取…" : "工作流不可用")}</strong></div> : <SelectField ariaLabel="选择 ComfyUI 工作流" label="工作流" disabled={!availablePresets.length} onChange={choosePreset} options={availablePresets.map((preset) => ({ label: preset.label, value: preset.id }))} value={activePreset?.id || ""} />}
                </div>
              </section>
              {!isVideo && activePreset ? <section className="generation-section">
                <div className="generation-section-heading"><div><strong>提示词</strong><span>仅本次生成</span></div></div>
                <div className="generation-prompt-fields">
                  <TextField disabled={promptDraft === null} label="提示词" multiline onChange={(value) => { setPromptDraft(value); setPreview(null); }} placeholder={promptLoading ? "正在读取…" : "输入提示词"} value={promptDraft ?? ""} />
                  <TextField disabled={negativePromptDraft === null} label="负面提示词" multiline onChange={(value) => { setNegativePromptDraft(value); setPreview(null); }} placeholder={promptLoading ? "正在读取…" : "输入负面提示词"} value={negativePromptDraft ?? ""} />
                </div>
              </section> : null}
              <section className="generation-section generation-output-settings">
                <div className="generation-section-heading"><div><strong>输出规格</strong><span>{isVideo ? "只显示当前云端工作流允许覆盖的参数" : "设置候选图的画幅"}</span></div></div>
                {!isVideo || hasEditableVideoSpec ? <div className={`generation-parameter-grid ${isVideo ? "is-video" : ""}`}>
                  {supportsInput("width") ? <TextField label="宽度" onChange={setWidth} value={width} /> : null}
                  {supportsInput("height") ? <TextField label="高度" onChange={setHeight} value={height} /> : null}
                  {supportsInput("denoise") ? <TextField label="重绘强度（0-1）" onChange={setDenoise} value={denoise} /> : null}
                  {supportsInput("durationSeconds") ? <TextField label="时长（秒）" onChange={setDurationSeconds} value={durationSeconds} /> : null}
                  {supportsInput("frames") ? <TextField label="帧数" onChange={setFrames} value={frames} /> : null}
                  {supportsInput("fps") ? <TextField label="帧率" onChange={setFps} value={fps} /> : null}
                </div> : null}
                <details className="generation-advanced"><summary><span>高级参数</span><small>Seed 留空则随机</small></summary><TextField label="Seed" onChange={setSeed} value={seed} /></details>
                {isVideo && activePreset?.id === "h3-first-last-video-v1" ? <div className="generation-mode-note"><strong>首尾帧模式</strong><span>上传已选首帧和尾帧；分辨率与 24 fps 沿用你的原始工作流，时长会由工作流自动对齐到 H3 所需帧数。</span></div> : null}
                {!isVideo && activePreset?.referenceImagesEnabled ? <div className="generation-mode-note"><strong>当前模式：图生图</strong><span>{activePreset.id === "shot-last-frame-img2img-v1" ? "固定读取当前镜头已选首帧，生成尾帧候选。" : "优先读取镜头已选参考图，其次读取地点/环境已选场景图，再其次读取单人物已选视觉图。"}</span></div> : null}
                {!isVideo && !activePreset?.referenceImagesEnabled ? <div className="generation-mode-note"><strong>当前模式：纯文生图</strong><span>已选三视图、定妆和参考图不会自动上传。需要图生图时，请先配置独立的图生图工作流。</span></div> : null}
              </section>
            </div>
            <aside className="generation-side-column">
              <section className={`generation-status-card ${profileReady ? "is-ready" : ""}`}>
                <span className="generation-card-kicker">服务器状态</span>
                <strong>{profileReady ? "可以提交" : "尚未配置"}</strong>
                <p>{profileReady ? `将通过 ${activeProfile?.name || "当前服务器"} 提交任务。` : "填写 Bridge 地址和令牌后，即可在这里直接生成。"}</p>
                {!profileReady && configPath ? <details className="generation-config-path"><summary>查看本机配置文件</summary><code>{configPath}</code></details> : null}
              </section>
              {activePreset ? <section className="generation-preset-card"><span className="generation-card-kicker">受控工作流</span><strong>{activePreset.label}</strong><p>{activePreset.description}</p><div><span>自动归档</span><b>{activePreset.outputSlotLabel}</b></div></section> : <section className="generation-status-card"><span className="generation-card-kicker">受控工作流</span><strong>没有可用工作流</strong><p>当前资产没有匹配的生成预设。</p></section>}
            </aside>
          </div>
          {preview ? <section className={`generation-preview ${preview.errors?.length ? "has-error" : ""}`}><div className="generation-result-heading"><strong>{preview.summary || "输入检查"}</strong><span>{preview.errors?.length ? "需要处理" : "可以生成"}</span></div>{preview.attachments?.length ? <ul>{preview.attachments.map((item) => <li key={`${item.role}-${item.name}`}><span>{item.role}</span><b>{item.name}</b></li>)}</ul> : null}{preview.warnings?.map((warning) => <p key={warning}>{warning}</p>)}{preview.errors?.map((item) => <p className="generation-preview-error" key={item}>{item}</p>)}</section> : null}
          {error ? <p className="generation-preview-error" role="alert">{error}</p> : null}
          {jobs.length ? <section className="generation-job-list"><div><p className="eyebrow">当前资产任务</p><strong>{jobs.length} 个</strong></div>{jobs.slice(0, 4).map((job) => <article key={job.id}><span className={`generation-job-dot is-${job.status}`} /><div><strong>{job.presetLabel || "ComfyUI 任务"}</strong><small>{formatComfyJobStatus(job)}{formatComfyJobDetail(job)}</small></div>{job.outputPaths?.length ? <em>已归档</em> : null}{job.status === "queued" ? <button className="text-button generation-job-action" disabled={actingJobId === job.id} onClick={() => void actOnJob(job, "cancel")} type="button">取消排队</button> : null}{["failed", "cancelled"].includes(job.status) ? <button className="text-button generation-job-action" disabled={actingJobId === job.id} onClick={() => void actOnJob(job, "retry")} type="button">{actingJobId === job.id ? "处理中…" : "重试"}</button> : null}</article>)}</section> : null}
        </>}
      </div>
      <footer className="modal-actions generation-modal-actions"><button className="text-button" onClick={onClose} type="button">取消</button><button className="text-button" disabled={loading || submitting || !activePreset} onClick={() => void inspectInputs()} type="button">检查输入</button><button className="submit-button" disabled={loading || submitting || !canSubmit} onClick={() => void queueJob()} type="button">{submitting ? "检查并提交…" : isVideo ? "提交图生视频" : "生成图片"}</button></footer>
    </section>
  </div>;
}

function TrashModal({
  busy,
  entries,
  error,
  loading,
  onClose,
  onRefresh,
  onRestore,
}: {
  busy: boolean;
  entries: TrashEntry[];
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onRestore: (entry: TrashEntry) => void;
}) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-labelledby="trash-modal-title" aria-modal="true" className="modal-card asset-modal trash-modal" role="dialog">
      <div className="modal-heading">
        <div><p className="eyebrow">安全回收站</p><h2 id="trash-modal-title">已移入的资产</h2></div>
        <button aria-label="关闭回收站" className="icon-button" onClick={onClose} type="button">×</button>
      </div>
      <p className="modal-copy">恢复时只会回到它原来的项目路径；若原位置已有同名文件，系统不会覆盖。</p>
      <div aria-busy={loading} className="trash-entry-list">
        {loading ? <p className="trash-empty">正在读取回收站…</p> : error ? <div className="trash-empty is-error"><p>{error}</p><button className="text-button" disabled={busy} onClick={onRefresh} type="button">重试</button></div> : entries.length ? entries.map((entry) => <article className={`trash-entry ${entry.recoverable ? "" : "is-legacy"}`} key={entry.id}>
          <span aria-hidden="true" className="trash-entry-mark">↺</span>
          <div className="trash-entry-copy">
            <strong title={entry.name}>{entry.name}</strong>
            <small title={entry.originalPath}>{entry.recoverable ? entry.originalPath : "旧回收项缺少原始位置，暂不能自动恢复"}</small>
            <em>{formatTimestamp(entry.trashedAt)}{entry.size !== undefined ? ` · ${formatSize(entry.size)}` : entry.isDirectory ? " · 文件夹" : ""}</em>
          </div>
          {entry.recoverable ? <button className="studio-action-button" disabled={busy} onClick={() => onRestore(entry)} type="button">恢复</button> : <span className="trash-entry-unavailable">不可恢复</span>}
        </article>) : <p className="trash-empty">回收站为空。</p>}
      </div>
      <div className="modal-actions"><button className="text-button" disabled={busy || loading} onClick={onRefresh} type="button">刷新</button><button className="submit-button" disabled={busy} onClick={onClose} type="button">完成</button></div>
    </section>
  </div>;
}

export function Workbench({ externalStructureTrigger = false }: { externalStructureTrigger?: boolean } = {}) {
  const [snapshot, setSnapshot] = useState<ProjectBoundSnapshot | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("shots");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [newName, setNewName] = useState("");
  const [newSimpleAssetName, setNewSimpleAssetName] = useState("");
  const [newLookName, setNewLookName] = useState("");
  const [selectedLookPath, setSelectedLookPath] = useState("identity");
  const [lookDraft, setLookDraft] = useState("");
  const [lookMode, setLookMode] = useState<"preview" | "edit">("preview");
  const [activeSceneId, setActiveSceneId] = useState("");
  const [newSceneId, setNewSceneId] = useState("");
  const [newShotId, setNewShotId] = useState("SH001");
  const [newShotTitle, setNewShotTitle] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [profileDraft, setProfileDraft] = useState("");
  const [profileMode, setProfileMode] = useState<"preview" | "edit">("preview");
  const [projectSettingsDraft, setProjectSettingsDraft] = useState("");
  const [projectSettingsMode, setProjectSettingsMode] = useState<"preview" | "edit">("preview");
  const [sceneDraft, setSceneDraft] = useState("");
  const [sceneMode, setSceneMode] = useState<"preview" | "edit">("preview");
  const [sceneCastDraft, setSceneCastDraft] = useState<SceneCastBinding[]>([]);
  const [sceneLocationBindingsDraft, setSceneLocationBindingsDraft] = useState<SceneLocationBinding[]>([]);
  const [scenePropBindingsDraft, setScenePropBindingsDraft] = useState<ScenePropBinding[]>([]);
  const [designDraft, setDesignDraft] = useState<ShotDesign>(EMPTY_DESIGN);
  const [shotDesignMode, setShotDesignMode] = useState<"preview" | "edit">("preview");
  const [activeShotWorkflowStep, setActiveShotWorkflowStep] = useState<ShotWorkflowStepId>("design");
  const [generationTarget, setGenerationTarget] = useState<WorkspaceSelectionAsset | null>(null);
  const [pendingSceneImageLocationPath, setPendingSceneImageLocationPath] = useState<string | null>(null);
  const [generationPresetId, setGenerationPresetId] = useState<string | undefined>();
  const [generationDurationSeconds, setGenerationDurationSeconds] = useState<string | undefined>();
  const workflowShotRootRef = useRef<string | null>(null);
  const [revisionConflictKey, setRevisionConflictKey] = useState<string | null>(null);
  const [importSourcePath, setImportSourcePath] = useState<string | null>(null);
  const [importShotIds, setImportShotIds] = useState<string[]>([]);
  const [sourceContextOpen, setSourceContextOpen] = useState(false);
  const [sourceContext, setSourceContext] = useState<{
    path: string | null;
    content: string;
    error: string | null;
    loading: boolean;
  }>({ path: null, content: "", error: null, loading: false });
  const [mediaPreview, setMediaPreview] = useState<AssetFile | null>(null);
  const [structureOpen, setStructureOpen] = useState(false);
  const [projectStructure, setProjectStructure] = useState<ProjectStructureSnapshot | null>(null);
  const [projectStructureError, setProjectStructureError] = useState<string | null>(null);
  const [projectStructureLoading, setProjectStructureLoading] = useState(false);
  const [expandedStructurePaths, setExpandedStructurePaths] = useState<Set<string>>(new Set());
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [trashLoading, setTrashLoading] = useState(false);
  const [generationWatchPaths, setGenerationWatchPaths] = useState<string[]>([]);
  const [pendingGenerationRefreshes, setPendingGenerationRefreshes] = useState(0);
  const [generationRefreshInFlight, setGenerationRefreshInFlight] = useState(false);
  const noticeTimerRef = useRef<number | null>(null);
  const projectEpochRef = useRef(0);
  const projectIdRef = useRef<string | null>(null);
  const generationJobWatchesRef = useRef<Map<string, string>>(new Map());

  const projectUrl = useCallback((endpoint: string, targetProjectId?: string | null): string => {
    const url = new URL(`${WORKBENCH_API_BASE}${endpoint}`, window.location.origin);
    const resolvedProjectId = targetProjectId ?? projectIdRef.current;
    if (resolvedProjectId) url.searchParams.set("projectId", resolvedProjectId);
    return `${url.pathname}${url.search}`;
  }, []);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // A project switch may finish before an older network request. Keep every
  // request tied to both its switch epoch and the project that initiated it.
  const isProjectRequestCurrent = useCallback((targetProjectId: string | null | undefined, epoch: number) => (
    epoch === projectEpochRef.current
    && (!targetProjectId || !projectIdRef.current || projectIdRef.current === targetProjectId)
  ), []);

  const loadSnapshot = useCallback(async (
    keepSelection = true,
    targetProjectId = projectIdRef.current,
    epoch = projectEpochRef.current,
  ): Promise<boolean> => {
    setLoading(true);
    try {
      const response = await fetch(projectUrl("/project", targetProjectId), { cache: "no-store" });
      const data = normalizeSnapshot(await response.json());
      if (!response.ok) throw new Error(data.error || "无法读取资产库");
      if (!isProjectRequestCurrent(targetProjectId, epoch) || (targetProjectId && data.projectId && data.projectId !== targetProjectId)) return false;
      if (!targetProjectId && data.projectId) {
        projectIdRef.current = data.projectId;
        setProjectId(data.projectId);
      }
      setSnapshot(data);
      setProjectStructure(null);
      setProjectStructureError(null);
      setExpandedStructurePaths(new Set());
      const all = [...data.characters, ...data.locations, ...data.props, ...data.scenes, ...data.shots];
      setSelectedKey((current) => {
        if (!keepSelection) return null;
        return current && all.some((asset) => assetKey(asset) === current) ? current : null;
      });
      return true;
    } catch (error) {
      if (isProjectRequestCurrent(targetProjectId, epoch)) {
        setSnapshot({
          rootName: "ai-play-test",
          projectSettings: { path: "项目设定.md", content: "", revision: "" },
          characters: [],
          locations: [],
          props: [],
          scenes: [],
          shots: [],
          updatedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "读取失败",
        });
      }
      return false;
    } finally {
      if (isProjectRequestCurrent(targetProjectId, epoch)) setLoading(false);
    }
  }, [isProjectRequestCurrent, projectUrl]);

  useEffect(() => {
    void loadSnapshot(false);
  }, [loadSnapshot]);

  const loadProjectStructure = useCallback(async (resetExpansion = false) => {
    const requestProjectId = projectIdRef.current;
    const epoch = projectEpochRef.current;
    setProjectStructureLoading(true);
    setProjectStructureError(null);
    try {
      const response = await fetch(projectUrl("/structure", requestProjectId), { cache: "no-store" });
      const data = (await response.json()) as ProjectStructureSnapshot & { error?: string };
      if (!response.ok) throw new Error(data.error || "无法读取项目目录");
      if (!isProjectRequestCurrent(requestProjectId, epoch)) return;
      setProjectStructure(data);
      const topLevelFolders = data.tree.filter((node) => node.kind === "folder").map((node) => node.path);
      setExpandedStructurePaths((current) => resetExpansion || !current.size ? new Set(topLevelFolders) : current);
    } catch (error) {
      if (isProjectRequestCurrent(requestProjectId, epoch)) setProjectStructureError(error instanceof Error ? error.message : "无法读取项目目录");
    } finally {
      if (isProjectRequestCurrent(requestProjectId, epoch)) setProjectStructureLoading(false);
    }
  }, [isProjectRequestCurrent, projectUrl]);

  const loadTrashEntries = useCallback(async () => {
    const requestProjectId = projectIdRef.current;
    const epoch = projectEpochRef.current;
    setTrashLoading(true);
    setTrashError(null);
    try {
      const response = await fetch(projectUrl("/trash", requestProjectId), { cache: "no-store" });
      const data = (await response.json()) as { entries?: TrashEntry[]; error?: string; projectId?: string };
      if (!response.ok) throw new Error(data.error || "无法读取回收站");
      if (!isProjectRequestCurrent(requestProjectId, epoch) || (requestProjectId && data.projectId && data.projectId !== requestProjectId)) return;
      setTrashEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (error) {
      if (isProjectRequestCurrent(requestProjectId, epoch)) {
        setTrashEntries([]);
        setTrashError(error instanceof Error ? error.message : "无法读取回收站");
      }
    } finally {
      if (isProjectRequestCurrent(requestProjectId, epoch)) setTrashLoading(false);
    }
  }, [isProjectRequestCurrent, projectUrl]);

  useEffect(() => {
    if (structureOpen && !projectStructure && !projectStructureLoading) {
      void loadProjectStructure();
    }
  }, [loadProjectStructure, projectStructure, projectStructureLoading, structureOpen]);

  useEffect(() => {
    if (!externalStructureTrigger) return;
    const openProjectStructure = () => setStructureOpen(true);
    window.addEventListener("ai-drama:open-project-structure", openProjectStructure);
    return () => window.removeEventListener("ai-drama:open-project-structure", openProjectStructure);
  }, [externalStructureTrigger]);

  const characterAssets = snapshot?.characters ?? [];
  const locationAssets = snapshot?.locations ?? [];
  const propAssets = snapshot?.props ?? [];
  const sceneAssets = snapshot?.scenes ?? [];
  const shotAssets = snapshot?.shots ?? [];
  const sceneReferenceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of [...locationAssets, ...propAssets]) {
      const count = sceneAssets.filter((scene) => {
        const bindings = asset.type === "location" ? sceneLocationBindings(scene) : scenePropBindings(scene);
        return bindings.some((binding) => bindingReferencesAsset(binding, asset));
      }).length;
      counts.set(asset.rootPath, count);
    }
    return counts;
  }, [locationAssets, propAssets, sceneAssets]);
  const characterByPath = useMemo(
    () => new Map(characterAssets.map((character) => [character.rootPath, character])),
    [characterAssets],
  );
  const sceneGroups = useMemo<SceneGroup[]>(() => {
    const groups = new Map<string, { scene?: SceneAsset; shots: ShotAsset[] }>();
    for (const scene of sceneAssets) {
      groups.set(scene.sceneId, { scene, shots: [] });
    }
    for (const shot of shotAssets) {
      const sceneId = shot.design.sceneId || "未归类";
      const group = groups.get(sceneId) || { shots: [] };
      group.shots.push(shot);
      groups.set(sceneId, group);
    }
    return Array.from(groups, ([sceneId, group]) => ({
      sceneId,
      ...(group.scene ? { scene: group.scene } : {}),
      shots: [...group.shots].sort((left, right) => left.design.shotId.localeCompare(right.design.shotId, "zh-CN", { numeric: true })),
      draftCount: group.shots.filter((shot) => shot.isDraft).length,
    })).sort((left, right) => left.sceneId.localeCompare(right.sceneId, "zh-CN", { numeric: true }));
  }, [sceneAssets, shotAssets]);
  const activeScene = useMemo(
    () => sceneGroups.find((scene) => scene.sceneId === activeSceneId) ?? sceneGroups[0] ?? null,
    [activeSceneId, sceneGroups],
  );
  const activeShotAssets = activeScene?.shots ?? [];
  const draftGroups = useMemo<ImportSourceGroup[]>(() => {
    const groups = new Map<string, ShotAsset[]>();
    for (const shot of shotAssets) {
      if (!shot.isDraft || !shot.sourcePath) continue;
      const group = groups.get(shot.sourcePath) || [];
      group.push(shot);
      groups.set(shot.sourcePath, group);
    }
    return Array.from(groups, ([sourcePath, shots]) => ({
      sourcePath,
      shots: [...shots].sort((left, right) => left.design.shotId.localeCompare(right.design.shotId, "zh-CN", { numeric: true })),
    })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "zh-CN"));
  }, [shotAssets]);
  const activeDraftGroups = useMemo(
    () => draftGroups.map((group) => ({
      ...group,
      shots: group.shots.filter((shot) => shot.design.sceneId === activeScene?.sceneId),
    })).filter((group) => group.shots.length > 0),
    [activeScene?.sceneId, draftGroups],
  );
  const visibleAssets = useMemo(() => {
    const source = activeTab === "characters" ? characterAssets
      : activeTab === "locations" ? locationAssets
        : activeTab === "props" ? propAssets
          : activeShotAssets;
    return source.filter((asset) => assetMatchesSearch(asset, search));
  }, [activeShotAssets, activeTab, characterAssets, locationAssets, propAssets, search]);

  const selectedAsset = useMemo(() => {
    if (!snapshot) return null;
    const all = [...snapshot.characters, ...snapshot.locations, ...snapshot.props, ...snapshot.scenes, ...snapshot.shots];
    return all.find((asset) => assetKey(asset) === selectedKey) ?? null;
  }, [selectedKey, snapshot]);
  const selectedSceneAssetBindings = useMemo(() => ({
    locations: sceneLocationBindingsDraft,
    props: scenePropBindingsDraft,
  }), [sceneLocationBindingsDraft, scenePropBindingsDraft]);

  const selectedShotIndex = selectedAsset?.type === "shot"
    ? activeShotAssets.findIndex((shot) => assetKey(shot) === selectedKey)
    : -1;

  const selectedSourcePath = selectedAsset?.type === "scene" || selectedAsset?.type === "shot"
    ? selectedAsset.sourcePath
    : undefined;
  const selectedSceneMedia = selectedAsset?.type === "scene" ? firstMedia(selectedAsset) : undefined;
  const selectedShotMedia = selectedAsset?.type === "shot" ? firstMedia(selectedAsset) : undefined;
  const selectedCharacterVisualSources = useMemo(
    () => selectedAsset?.type === "character" ? characterVisualSources(selectedAsset) : [],
    [selectedAsset],
  );
  const selectedCharacterVisualSource = selectedCharacterVisualSources.find((source) => source.key === selectedLookPath)
    ?? selectedCharacterVisualSources[0];
  const selectedCharacterLook = selectedAsset?.type === "character"
    ? getLookForPath(selectedAsset, selectedCharacterVisualSource?.rootPath)
    : undefined;
  const selectedCharacterVisualSet = selectedCharacterVisualSource
    ? selectedCharacterVisuals(selectedCharacterVisualSource)
    : [];
  const inheritedSceneCastForSelectedShot = useMemo(() => {
    if (selectedAsset?.type !== "shot" || !activeScene?.scene) return [];
    return activeScene.scene.castBindings.filter((binding) => bindingAppliesToShot(binding, selectedAsset.design.shotId));
  }, [activeScene?.scene, selectedAsset]);
  const effectiveCastForSelectedShot = useMemo(() => {
    const effective = new Map<string, {
      characterPath: string;
      lookPath?: string;
      state: string;
      continuity: string;
      sourceLabel: string;
    }>();
    for (const binding of inheritedSceneCastForSelectedShot) {
      effective.set(binding.characterPath, {
        characterPath: binding.characterPath,
        ...(binding.lookPath ? { lookPath: binding.lookPath } : {}),
        state: binding.state,
        continuity: binding.continuity,
        sourceLabel: "场次默认",
      });
    }
    for (const override of designDraft.characterOverrides ?? []) {
      const inherited = effective.get(override.characterPath);
      if (override.mode === "inherit") {
        if (!inherited) continue;
        effective.set(override.characterPath, {
          ...inherited,
          state: override.state || inherited.state,
          sourceLabel: override.state ? "场次默认 · 本镜头状态" : inherited.sourceLabel,
        });
        continue;
      }
      effective.set(override.characterPath, {
        characterPath: override.characterPath,
        ...(override.mode === "look" && override.lookPath ? { lookPath: override.lookPath } : {}),
        state: override.state || inherited?.state || "",
        continuity: inherited?.continuity || "",
        sourceLabel: override.mode === "look" ? "本镜头 · 覆盖造型" : "本镜头 · 身份基准",
      });
    }
    return [...effective.values()];
  }, [designDraft.characterOverrides, inheritedSceneCastForSelectedShot]);
  const effectiveLocationAssetsForSelectedShot = useMemo(() => {
    if (selectedAsset?.type !== "shot" || !activeScene?.scene) return [];
    const seen = new Set<string>();
    return sceneLocationBindings(activeScene.scene)
      .filter((binding) => bindingAppliesToShot(binding, selectedAsset.design.shotId))
      .flatMap((binding) => {
        if (seen.has(binding.locationPath)) return [];
        seen.add(binding.locationPath);
        const location = locationAssets.find((asset) => asset.rootPath === binding.locationPath);
        return location ? [location] : [];
      });
  }, [activeScene?.scene, locationAssets, selectedAsset]);
  const inheritedLocationsForSelectedShot = useMemo(() => {
    if (selectedAsset?.type !== "shot" || !activeScene?.scene) return [];
    return sceneLocationBindings(activeScene.scene)
      .filter((binding) => bindingAppliesToShot(binding, selectedAsset.design.shotId))
      .map((binding) => ({
        label: locationAssets.find((asset) => asset.rootPath === binding.locationPath)?.name || displayFileName(binding.locationPath),
        detail: [binding.role, binding.state].filter(Boolean).join(" · "),
      }));
  }, [activeScene?.scene, locationAssets, selectedAsset]);
  const inheritedPropsForSelectedShot = useMemo(() => {
    if (selectedAsset?.type !== "shot" || !activeScene?.scene) return [];
    return scenePropBindings(activeScene.scene)
      .filter((binding) => bindingAppliesToShot(binding, selectedAsset.design.shotId))
      .map((binding) => ({
        label: propAssets.find((asset) => asset.rootPath === binding.propPath)?.name || displayFileName(binding.propPath),
        detail: [binding.role, binding.state].filter(Boolean).join(" · "),
      }));
  }, [activeScene?.scene, propAssets, selectedAsset]);
  const selectedShotReferenceSlot = selectedAsset?.type === "shot" ? assetSlot(selectedAsset, "reference") : undefined;
  const selectedShotFirstFrameSlot = selectedAsset?.type === "shot" ? assetSlot(selectedAsset, "firstFrame") : undefined;
  const selectedShotLastFrameSlot = selectedAsset?.type === "shot" ? assetSlot(selectedAsset, "lastFrame") : undefined;
  const selectedShotCandidateSlot = selectedAsset?.type === "shot" ? assetSlot(selectedAsset, "candidate") : undefined;
  const selectedShotFirstFrame = selectedShotFirstFrameSlot ? selectedSlotVisual(selectedShotFirstFrameSlot) : undefined;
  const selectedShotLastFrame = selectedShotLastFrameSlot ? selectedSlotVisual(selectedShotLastFrameSlot) : undefined;
  const hasSelectedShotReference = Boolean(selectedAsset?.type === "shot" && hasSingleSelectedSlotVisual(selectedAsset, "reference"));
  const hasSelectedLocationReference = effectiveLocationAssetsForSelectedShot.some((location) => (
    ["setting", "reference", "candidate"].some((key) => hasSingleSelectedSlotVisual(location, key))
  ));
  // Project-level location visuals supersede the legacy scene-folder slots.
  const hasSelectedSceneReference = hasSelectedLocationReference || Boolean(
    activeScene?.scene && ["setting", "reference", "firstFrame", "lastFrame"].some((key) => hasSingleSelectedSlotVisual(activeScene.scene!, key)),
  );
  const hasSelectedCharacterReference = effectiveCastForSelectedShot.some((entry) => {
    const character = characterByPath.get(entry.characterPath);
    const look = getLookForPath(character, entry.lookPath);
    return Boolean(
      look?.confirmedVisuals.reference
      ?? look?.confirmedVisuals.turnaround
      ?? look?.confirmedVisuals.costume
      ?? character?.confirmedVisuals.reference
      ?? character?.confirmedVisuals.turnaround
      ?? character?.confirmedVisuals.costume,
    );
  });
  const hasShotReference = hasSelectedShotReference || hasSelectedSceneReference || hasSelectedCharacterReference;
  const hasSavedShotBrief = Boolean(
    selectedAsset?.type === "shot"
    && !selectedAsset.isDraft
    && (selectedAsset.design.prompt.trim() || selectedAsset.design.content.trim()),
  );
  const hasSelectedFirstFrame = Boolean(selectedAsset?.type === "shot" && hasSingleSelectedSlotVisual(selectedAsset, "firstFrame"));
  const hasSelectedLastFrame = Boolean(selectedAsset?.type === "shot" && hasSingleSelectedSlotVisual(selectedAsset, "lastFrame"));
  const hasGeneratedShotVideo = Boolean(selectedAsset?.type === "shot" && selectedAsset.slots.some((slot) => (
    ["candidate", "final", "video"].includes(slot.key) && slot.files.some(isVideo)
  )));
  const shotWorkflowNodes = useMemo<ShotWorkflowNode[]>(() => {
    const completed = {
      design: hasSavedShotBrief,
      reference: hasShotReference || ["firstFrame", "lastFrame", "video"].includes(activeShotWorkflowStep),
      firstFrame: hasSelectedFirstFrame,
      lastFrame: hasSelectedLastFrame,
      video: hasGeneratedShotVideo,
    };
    return [
      { id: "design", label: "镜头设计", state: activeShotWorkflowStep === "design" ? "current" : completed.design ? "done" : "pending" },
      { id: "reference", label: "画面参考", state: activeShotWorkflowStep === "reference" ? "current" : completed.reference ? "done" : "pending" },
      { id: "firstFrame", label: "首帧", state: activeShotWorkflowStep === "firstFrame" ? "current" : completed.firstFrame ? "done" : "pending" },
      { id: "lastFrame", label: "尾帧", state: activeShotWorkflowStep === "lastFrame" ? "current" : completed.lastFrame ? "done" : "pending" },
      { id: "video", label: "图生视频", state: activeShotWorkflowStep === "video" ? "current" : completed.video ? "done" : "pending" },
    ];
  }, [activeShotWorkflowStep, hasGeneratedShotVideo, hasSavedShotBrief, hasSelectedFirstFrame, hasSelectedLastFrame, hasShotReference]);
  const firstIncompleteShotWorkflowStep = useMemo<ShotWorkflowStepId>(() => (
    !hasSavedShotBrief ? "design"
      : !hasSelectedFirstFrame ? "firstFrame"
        : !hasSelectedLastFrame ? "lastFrame"
          : "video"
  ), [hasSavedShotBrief, hasSelectedFirstFrame, hasSelectedLastFrame]);
  useEffect(() => {
    const rootPath = selectedAsset?.type === "shot" && !selectedAsset.isDraft
      ? selectedAsset.rootPath || null
      : null;
    if (!rootPath) {
      workflowShotRootRef.current = null;
      return;
    }
    if (workflowShotRootRef.current === rootPath) return;
    workflowShotRootRef.current = rootPath;
    setActiveShotWorkflowStep(firstIncompleteShotWorkflowStep);
    // Selecting another shot should resume at its first unfinished step. A
    // media refresh must not advance the current step: selection and Next are
    // deliberately separate actions in this production flow.
  }, [firstIncompleteShotWorkflowStep, selectedAsset]);
  const selectedImportGroup = useMemo(
    () => activeDraftGroups.find((group) => group.sourcePath === importSourcePath) ?? null,
    [activeDraftGroups, importSourcePath],
  );
  const hasUnsavedProfileDraft = selectedAsset?.type === "character"
    && profileDraft !== (selectedAsset.profileContent || "");
  const hasUnsavedLookDraft = Boolean(
    selectedAsset?.type === "character"
    && selectedCharacterLook
    && lookDraft !== (selectedCharacterLook.documentContent || ""),
  );
  const hasUnsavedProjectSettingsDraft = Boolean(
    snapshot && projectSettingsDraft !== snapshot.projectSettings.content,
  );
  const hasUnsavedSceneAssetBindings = Boolean(
    selectedAsset?.type === "scene"
    && (
      JSON.stringify(sceneLocationBindingsDraft) !== JSON.stringify(sceneLocationBindings(selectedAsset))
      || JSON.stringify(scenePropBindingsDraft) !== JSON.stringify(scenePropBindings(selectedAsset))
    ),
  );
  const hasUnsavedShotDesign = Boolean(
    selectedAsset?.type === "shot"
    && !selectedAsset.isDraft
    && JSON.stringify(designDraft) !== JSON.stringify(selectedAsset.design),
  );

  useEffect(() => {
    setActiveSceneId((current) => sceneGroups.some((scene) => scene.sceneId === current)
      ? current
      : sceneGroups[0]?.sceneId || "");
  }, [sceneGroups]);

  // Keep navigation and browser exits from silently replacing an in-progress edit.
  const isDirty = useMemo(() => {
    if (!selectedAsset) return hasUnsavedProjectSettingsDraft;
    if (selectedAsset.type === "character") {
      return hasUnsavedProfileDraft || hasUnsavedLookDraft || hasUnsavedProjectSettingsDraft;
    }
    if (selectedAsset.type === "scene") {
      return sceneDraft !== (selectedAsset.sceneContent || "")
        || JSON.stringify(sceneCastDraft) !== JSON.stringify(selectedAsset.castBindings)
        || hasUnsavedSceneAssetBindings
        || hasUnsavedProjectSettingsDraft;
    }
    if (selectedAsset.type === "location" || selectedAsset.type === "prop") {
      return sceneDraft !== (selectedAsset.profileContent || "") || hasUnsavedProjectSettingsDraft;
    }
    return hasUnsavedShotDesign || hasUnsavedProjectSettingsDraft;
  }, [hasUnsavedLookDraft, hasUnsavedProfileDraft, hasUnsavedProjectSettingsDraft, hasUnsavedSceneAssetBindings, hasUnsavedShotDesign, sceneCastDraft, selectedAsset]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!selectedAsset) {
      const first = activeTab === "shots" ? activeScene?.scene ?? visibleAssets[0] : visibleAssets[0];
      if (first) setSelectedKey(assetKey(first));
    }
  }, [activeScene?.scene, activeTab, selectedAsset, visibleAssets]);

  const selectedCharacterLookRoots = selectedAsset?.type === "character"
    ? selectedAsset.looks.map((look) => look.rootPath).join("\u0000")
    : "";

  // Media-only snapshot refreshes must not replace an editor draft. Rehydrate
  // text only when the selected asset or its Markdown revision actually changes.
  useEffect(() => {
    if (selectedAsset?.type === "character") {
      setProfileDraft(selectedAsset.profileContent || "");
      setProfileMode("preview");
      setSelectedLookPath((current) => current === "identity" || selectedAsset.looks.some((look) => look.rootPath === current)
        ? current
        : "identity");
    }
    if (selectedAsset?.type === "location" || selectedAsset?.type === "prop") {
      setSceneDraft(selectedAsset.profileContent || "");
      setSceneMode("preview");
    }
    if (selectedAsset?.type === "shot") {
      setDesignDraft({ ...selectedAsset.design });
      setShotDesignMode("preview");
    }
  }, [
    selectedAsset?.type === "character" ? selectedAsset.profileRevision : "",
    selectedAsset?.type === "location" || selectedAsset?.type === "prop" ? selectedAsset.profileRevision : "",
    selectedAsset?.type === "shot" ? selectedAsset.designRevision : "",
    selectedCharacterLookRoots,
    selectedKey,
  ]);

  // Scene documents, cast, and reusable-asset bindings save independently.
  // Rehydrate only the part whose revision changed so another in-progress
  // scene editor draft is never replaced by an unrelated save.
  useEffect(() => {
    if (selectedAsset?.type !== "scene") return;
    setSceneDraft(selectedAsset.sceneContent || "");
    setSceneMode("preview");
  }, [selectedAsset?.type === "scene" ? selectedAsset.sceneRevision : "", selectedKey]);

  useEffect(() => {
    if (selectedAsset?.type !== "scene") return;
    setSceneCastDraft(selectedAsset.castBindings);
  }, [selectedAsset?.type === "scene" ? selectedAsset.castRevision : "", selectedKey]);

  useEffect(() => {
    if (selectedAsset?.type !== "scene") return;
    setSceneLocationBindingsDraft(sceneLocationBindings(selectedAsset));
    setScenePropBindingsDraft(scenePropBindings(selectedAsset));
  }, [selectedAsset?.type === "scene" ? selectedAsset.assetBindingsRevision : "", selectedKey]);

  useEffect(() => {
    setLookDraft(selectedCharacterLook?.documentContent || "");
    setLookMode("preview");
  }, [selectedAsset?.type === "character" ? selectedAsset.rootPath : "", selectedCharacterLook?.documentRevision, selectedCharacterLook?.rootPath]);

  useEffect(() => {
    setProjectSettingsDraft(snapshot?.projectSettings.content || "");
    setProjectSettingsMode("preview");
  }, [snapshot?.projectSettings.revision]);

  useEffect(() => {
    setSourceContextOpen(false);
  }, [selectedSourcePath]);

  useEffect(() => {
    if (!modal && !mediaPreview) return;
    const lockTarget = document.querySelector<HTMLElement>(".adw-workbench-shadow-host") ?? document.body;
    const previousOverflow = lockTarget.style.overflow;
    lockTarget.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (mediaPreview) setMediaPreview(null);
      else {
        setModal(null);
        if (modal === "generation") {
          setGenerationTarget(null);
          setGenerationDurationSeconds(undefined);
          setGenerationPresetId(undefined);
        }
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      lockTarget.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mediaPreview, modal]);

  const notify = useCallback((tone: "success" | "error", text: string) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice({ tone, text });
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, 3600);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!pendingSceneImageLocationPath) return;
    const location = locationAssets.find((asset) => asset.rootPath === pendingSceneImageLocationPath);
    if (!location) return;
    setPendingSceneImageLocationPath(null);
    setGenerationTarget(location);
    setGenerationDurationSeconds(undefined);
    setGenerationPresetId("scene-image-v1");
    setModal("generation");
    notify("success", "场景资产已准备并关联");
  }, [locationAssets, notify, pendingSceneImageLocationPath]);

  const handleGenerationJobsObserved = useCallback((assetPath: string, jobs: ComfyJob[]) => {
    const result = reconcileComfyJobWatches(generationJobWatchesRef.current, assetPath, jobs);
    generationJobWatchesRef.current = result.watches;
    const nextPaths = watchedComfyAssetPaths(result.watches);
    setGenerationWatchPaths((current) => (
      current.length === nextPaths.length && current.every((path, index) => path === nextPaths[index])
        ? current
        : nextPaths
    ));
    if (result.archivedCount > 0) {
      setPendingGenerationRefreshes((current) => current + result.archivedCount);
    }
  }, []);

  const handleGenerationQueued = useCallback((assetPath: string, job: ComfyJob) => {
    handleGenerationJobsObserved(assetPath, [job]);
    notify("success", "ComfyUI 任务已进入队列；完成后会自动显示在候选资料槽");
  }, [handleGenerationJobsObserved, notify]);

  // Keep watching queued jobs after the generation dialog closes. Only the
  // project that started the request may update this workspace.
  useEffect(() => {
    if (!generationWatchPaths.length) return undefined;
    const requestProjectId = projectIdRef.current;
    const requestEpoch = projectEpochRef.current;
    let disposed = false;
    let polling = false;

    const pollGenerationJobs = async () => {
      if (polling || disposed || !isProjectRequestCurrent(requestProjectId, requestEpoch)) return;
      polling = true;
      try {
        await Promise.all(generationWatchPaths.map(async (assetPath) => {
          const response = await fetch(
            projectUrl(`/comfy/jobs?assetPath=${encodeURIComponent(assetPath)}`, requestProjectId),
            { cache: "no-store" },
          );
          const data = (await response.json()) as { jobs?: ComfyJob[]; error?: string };
          if (!response.ok) throw new Error(data.error || "无法读取 ComfyUI 任务状态");
          if (disposed || !isProjectRequestCurrent(requestProjectId, requestEpoch)) return;
          handleGenerationJobsObserved(assetPath, Array.isArray(data.jobs) ? data.jobs : []);
        }));
      } catch {
        // A temporary tunnel or Bridge outage should not discard the watch.
      } finally {
        polling = false;
      }
    };

    void pollGenerationJobs();
    const timer = window.setInterval(() => { void pollGenerationJobs(); }, 3_500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [generationWatchPaths, handleGenerationJobsObserved, isProjectRequestCurrent, projectUrl]);

  useEffect(() => {
    if (!pendingGenerationRefreshes || !isDirty || generationRefreshInFlight) return;
    notify("success", "生成候选已归档；保存当前编辑后会自动刷新资料槽");
  }, [generationRefreshInFlight, isDirty, notify, pendingGenerationRefreshes]);

  useEffect(() => {
    if (!pendingGenerationRefreshes || isDirty || generationRefreshInFlight) return;
    const refreshCount = pendingGenerationRefreshes;
    const requestProjectId = projectIdRef.current;
    const requestEpoch = projectEpochRef.current;
    setGenerationRefreshInFlight(true);
    void loadSnapshot(true, requestProjectId, requestEpoch).then((loaded) => {
      if (!isProjectRequestCurrent(requestProjectId, requestEpoch)) return;
      setPendingGenerationRefreshes((current) => Math.max(0, current - refreshCount));
      notify(
        loaded ? "success" : "error",
        loaded ? "生成候选已归档并显示在资料槽" : "生成候选已归档，但自动刷新失败，请手动刷新",
      );
    }).finally(() => {
      if (isProjectRequestCurrent(requestProjectId, requestEpoch)) setGenerationRefreshInFlight(false);
    });
  }, [generationRefreshInFlight, isDirty, isProjectRequestCurrent, loadSnapshot, notify, pendingGenerationRefreshes]);

  const postAction = useCallback(async <T extends object = { error?: string; path?: string }>(payload: Record<string, unknown>) => {
    const response = await fetch(projectUrl("/assets"), {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const data = (await response.json()) as T & { code?: string; error?: string };
    if (!response.ok) throw new AssetApiError(data.error || "操作失败", data.code);
    return data;
  }, [projectUrl]);

  const refreshAndSelect = useCallback(async (key?: string) => {
    await loadSnapshot(false);
    if (key) setSelectedKey(key);
  }, [loadSnapshot]);

  const confirmLeaveDraft = useCallback((message = "当前资产有未保存修改，继续操作将丢失这些内容。是否继续？") => {
    if (!isDirty) return true;
    return window.confirm(message);
  }, [isDirty]);

  const handleProjectAction = useCallback(async (action: ProjectRegistryAction): Promise<boolean> => {
    const actionLabel = action.action === "create" ? "新建项目" : "切换项目";
    if (!confirmLeaveDraft(`${actionLabel}会离开当前项目，未保存的编辑将丢失。是否继续？`)) return false;

    setBusy(true);
    try {
      const response = await fetch(`${WORKBENCH_API_BASE}/projects`, {
        body: JSON.stringify(action),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as ProjectRegistryResponse;
      if (!response.ok) throw new Error(data.error || `${actionLabel}失败`);

      const nextProjectId = typeof data.activeProjectId === "string" ? data.activeProjectId : (
        action.action === "select" ? action.projectId : action.name
      );
      const nextEpoch = projectEpochRef.current + 1;
      projectEpochRef.current = nextEpoch;

      // Reset every project-local selection before reading the new project's real files.
      setModal(null);
      setGenerationTarget(null);
      setPendingSceneGenerationPath(null);
      setGenerationDurationSeconds(undefined);
      setGenerationPresetId(undefined);
      setMediaPreview(null);
      setSourceContextOpen(false);
      setImportSourcePath(null);
      setImportShotIds([]);
      setSearch("");
      setSelectedKey(null);
      setActiveSceneId("");
      setActiveTab("shots");
      setRevisionConflictKey(null);
      // Do not let the previous project's cards remain visible while the new
      // project is loading; that is misleading even though writes are pinned.
      setSnapshot(null);
      setProjectStructure(null);
      setProjectStructureError(null);
      setProjectStructureLoading(false);
      setTrashEntries([]);
      setTrashError(null);
      setTrashLoading(false);
      generationJobWatchesRef.current.clear();
      setGenerationWatchPaths([]);
      setPendingGenerationRefreshes(0);
      setGenerationRefreshInFlight(false);
      projectIdRef.current = nextProjectId;
      setProjectId(nextProjectId);
      const loaded = await loadSnapshot(false, nextProjectId, nextEpoch);
      if (!loaded) throw new Error(`${actionLabel}已完成，但无法读取项目资产。请点击“刷新”重试。`);
      notify("success", action.action === "create" ? `已建立并打开项目“${action.name}”` : "已切换项目");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${actionLabel}失败`;
      notify("error", message);
      throw error;
    } finally {
      setBusy(false);
    }
  }, [confirmLeaveDraft, loadSnapshot, notify]);

  const confirmLeaveCharacterDraft = useCallback((action: string) => {
    if (!hasUnsavedProfileDraft && !hasUnsavedLookDraft) return true;
    const unsavedItems = [
      hasUnsavedProfileDraft ? "角色设定" : "",
      hasUnsavedLookDraft ? `“${selectedCharacterLook?.name || "当前"}”造型设定` : "",
    ].filter(Boolean).join("和");
    return window.confirm(`当前${unsavedItems}有未保存修改，${action}将丢失这些内容。是否继续？`);
  }, [hasUnsavedLookDraft, hasUnsavedProfileDraft, selectedCharacterLook?.name]);

  const changeCharacterLook = useCallback((nextLookPath: string) => {
    if (nextLookPath === selectedCharacterVisualSource?.key) return;
    if (hasUnsavedLookDraft && !window.confirm(`当前“${selectedCharacterLook?.name || "当前"}”造型设定有未保存修改，切换造型将丢失这些内容。是否继续？`)) return;
    setSelectedLookPath(nextLookPath);
  }, [hasUnsavedLookDraft, selectedCharacterLook?.name, selectedCharacterVisualSource?.key]);

  const openCreateCharacterLook = useCallback(() => {
    if (!confirmLeaveCharacterDraft("新建造型")) return;
    setNewLookName("");
    setModal("look");
  }, [confirmLeaveCharacterDraft]);

  const refreshWorkspace = useCallback(() => {
    if (selectedAsset?.type === "character") {
      if (!confirmLeaveCharacterDraft("刷新工作台")) return;
    } else if (!confirmLeaveDraft("刷新后会重新读取磁盘资料，当前未保存修改将丢失。是否继续？")) return;
    void loadSnapshot(true);
  }, [confirmLeaveCharacterDraft, confirmLeaveDraft, loadSnapshot, selectedAsset?.type]);

  const changeSearch = useCallback((value: string) => {
    const source = activeTab === "characters" ? characterAssets
      : activeTab === "locations" ? locationAssets
        : activeTab === "props" ? propAssets
          : activeShotAssets;
    const nextVisibleAssets = source.filter((asset) => assetMatchesSearch(asset, value));
    const keepsCurrentSelection = selectedKey
      ? nextVisibleAssets.some((asset) => assetKey(asset) === selectedKey)
      : false;

    if (!keepsCurrentSelection && selectedKey && !confirmLeaveDraft("当前筛选会隐藏正在编辑的资产，未保存修改将丢失。是否继续？")) return;
    setSearch(value);
    if (!keepsCurrentSelection) setSelectedKey(nextVisibleAssets[0] ? assetKey(nextVisibleAssets[0]) : null);
  }, [activeShotAssets, activeTab, characterAssets, confirmLeaveDraft, locationAssets, propAssets, selectedKey]);

  const selectAsset = useCallback((key: string) => {
    if (key === selectedKey) return;
    if (selectedAsset?.type === "character") {
      if (!confirmLeaveCharacterDraft("切换人物")) return;
    } else if (!confirmLeaveDraft()) return;
    setSelectedKey(key);
  }, [confirmLeaveCharacterDraft, confirmLeaveDraft, selectedAsset?.type, selectedKey]);

  const moveSelectedShot = useCallback((offset: number) => {
    if (selectedShotIndex < 0) return;
    const nextShot = activeShotAssets[selectedShotIndex + offset];
    if (nextShot) selectAsset(assetKey(nextShot));
  }, [activeShotAssets, selectAsset, selectedShotIndex]);

  const changeTab = useCallback((tab: ActiveTab) => {
    if (tab === activeTab || !confirmLeaveDraft()) return;
    const firstAsset = tab === "characters"
      ? characterAssets[0]
      : tab === "locations"
        ? locationAssets[0]
        : tab === "props"
          ? propAssets[0]
          : activeScene?.scene ?? activeShotAssets[0];
    setActiveTab(tab);
    setSearch("");
    setSelectedKey(firstAsset ? assetKey(firstAsset) : null);
  }, [activeScene?.scene, activeShotAssets, activeTab, characterAssets, confirmLeaveDraft, locationAssets, propAssets]);

  const changeScene = useCallback((sceneId: string) => {
    if (sceneId === activeScene?.sceneId) return false;
    if (!confirmLeaveDraft()) return false;
    const nextScene = sceneGroups.find((scene) => scene.sceneId === sceneId);
    setActiveSceneId(sceneId);
    setSearch("");
    const nextAsset = nextScene?.scene ?? nextScene?.shots[0];
    setSelectedKey(nextAsset ? assetKey(nextAsset) : null);
    return true;
  }, [activeScene?.sceneId, confirmLeaveDraft, sceneGroups]);

  const toggleStructurePath = useCallback((treePath: string) => {
    setExpandedStructurePaths((current) => {
      const next = new Set(current);
      if (next.has(treePath)) next.delete(treePath);
      else next.add(treePath);
      return next;
    });
  }, []);

  const refreshProjectStructure = useCallback(() => {
    void loadProjectStructure(true);
  }, [loadProjectStructure]);

  const openTrash = () => {
    setModal("trashList");
    void loadTrashEntries();
  };

  const handleRestoreTrashEntry = async (entry: TrashEntry) => {
    if (!entry.recoverable || busy) return;
    if (!window.confirm(`确认将“${entry.name}”恢复到原位置吗？如果原位置已有同名文件，系统不会覆盖。`)) return;
    if (!confirmLeaveDraft("恢复资产后会重新读取工作台，当前未保存的编辑将丢失。是否继续？")) return;
    setBusy(true);
    try {
      const response = await fetch(projectUrl("/trash"), {
        body: JSON.stringify({ action: "restore", entryId: entry.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; path?: string };
      if (!response.ok) throw new Error(data.error || "恢复资产失败");
      await Promise.all([loadTrashEntries(), loadSnapshot(true)]);
      notify("success", `已恢复“${entry.name}”`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "恢复资产失败");
    } finally {
      setBusy(false);
    }
  };

  const openStoryboardImport = () => {
    const firstGroup = activeDraftGroups[0];
    if (!firstGroup) {
      notify("error", "当前场次没有可导入的分镜草稿");
      return;
    }
    setImportSourcePath(firstGroup.sourcePath);
    setImportShotIds(firstGroup.shots.map(storyboardImportSelector));
    setModal("import");
  };

  const chooseImportSource = (sourcePath: string) => {
    const group = activeDraftGroups.find((candidate) => candidate.sourcePath === sourcePath);
    setImportSourcePath(sourcePath);
    setImportShotIds(group?.shots.map(storyboardImportSelector) || []);
  };

  const toggleImportShot = (selector: string) => {
    setImportShotIds((current) => current.includes(selector)
      ? current.filter((id) => id !== selector)
      : [...current, selector]);
  };

  const toggleAllImportShots = () => {
    if (!selectedImportGroup) return;
    const ids = selectedImportGroup.shots.map(storyboardImportSelector);
    const allSelected = ids.every((id) => importShotIds.includes(id));
    setImportShotIds(allSelected ? [] : ids);
  };

  const handleImportStoryboard = async (sourcePath: string, shotIds: string[], dirtyMessage?: string) => {
    if (!sourcePath || !shotIds.length) {
      notify("error", "请至少选择一个镜头草稿");
      return;
    }
    if (!confirmLeaveDraft(dirtyMessage)) return;
    setBusy(true);
    try {
      const result = await postAction<StoryboardImportResponse>({
        action: "importStoryboardDrafts",
        sourcePath,
        shotIds,
      });
      setModal(null);
      const firstCreated = result.created[0];
      if (firstCreated) {
        await refreshAndSelect(`shot:${firstCreated.path}`);
      } else {
        await loadSnapshot(true);
      }
      const details = [
        result.created.length ? `已建立 ${result.created.length} 个镜头` : "没有建立新镜头",
        result.skipped.length ? `跳过 ${result.skipped.length} 个重复项` : "",
        result.errors.length ? `${result.errors.length} 个未完成` : "",
      ].filter(Boolean);
      const warning = result.warnings[0] ? `；${result.warnings[0]}` : "";
      notify(result.created.length ? "success" : "error", `${details.join("，")}${warning}`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "导入剧本失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSelectedDraft = () => {
    if (!selectedAsset || selectedAsset.type !== "shot" || !selectedAsset.isDraft) return;
    if (!selectedAsset.sourcePath) {
      notify("error", "此草稿没有可追溯的剧本来源，暂时无法安全导入");
      return;
    }
    void handleImportStoryboard(
      selectedAsset.sourcePath,
      [storyboardImportSelector(selectedAsset)],
      "当前草稿有未保存修改。建立资产会按原始剧本导入并丢弃这些临时修改，是否继续？",
    );
  };

  const toggleSourceContext = async () => {
    const sourcePath = selectedSourcePath;
    if (!sourcePath) return;
    if (sourceContextOpen) {
      setSourceContextOpen(false);
      return;
    }

    const requestProjectId = projectId;
    const requestEpoch = projectEpochRef.current;
    setSourceContextOpen(true);
    if (sourceContext.path === sourcePath && (sourceContext.content || sourceContext.loading)) return;
    setSourceContext({ path: sourcePath, content: "", error: null, loading: true });
    try {
      const response = await fetch(projectUrl(`/file?path=${encodeURIComponent(sourcePath)}`), { cache: "no-store" });
      const data = (await response.json()) as { content?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "无法读取原始剧本");
      if (requestEpoch !== projectEpochRef.current || (requestProjectId && projectIdRef.current !== requestProjectId)) return;
      setSourceContext((current) => current.path === sourcePath
        ? { path: sourcePath, content: data.content || "", error: null, loading: false }
        : current);
    } catch (error) {
      if (requestEpoch !== projectEpochRef.current || (requestProjectId && projectIdRef.current !== requestProjectId)) return;
      setSourceContext((current) => current.path === sourcePath
        ? {
          path: sourcePath,
          content: "",
          error: error instanceof Error ? error.message : "无法读取原始剧本",
          loading: false,
        }
        : current);
    }
  };

  const handleCreateCharacter = async () => {
    if (!newName.trim()) return;
    if (!confirmLeaveDraft("建立新人物后会刷新资产列表，当前未保存的编辑将丢失。是否继续？")) return;
    setBusy(true);
    try {
      const result = await postAction({
        action: "createCharacter",
        name: newName.trim(),
      });
      setModal(null);
      setNewName("");
      setActiveTab("characters");
      setSearch("");
      await refreshAndSelect(result.path ? `character:${result.path}` : undefined);
      notify("success", "人物资产已建立");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "建立人物失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSimpleAsset = async (assetType: "location" | "prop") => {
    if (!newSimpleAssetName.trim()) return;
    if (!confirmLeaveDraft("建立新资产后会刷新资产列表，当前未保存的编辑将丢失。是否继续？")) return;
    setBusy(true);
    try {
      const result = await postAction({ action: assetType === "location" ? "createLocation" : "createProp", name: newSimpleAssetName.trim() });
      setModal(null);
      setNewSimpleAssetName("");
      setActiveTab(assetType === "location" ? "locations" : "props");
      setSearch("");
      await refreshAndSelect(result.path ? `${assetType}:${result.path}` : undefined);
      notify("success", assetType === "location" ? "地点/环境资产已建立" : "道具资产已建立");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "建立资产失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCharacterLook = async () => {
    if (!selectedAsset || selectedAsset.type !== "character" || !newLookName.trim()) return;
    setBusy(true);
    try {
      const result = await postAction({
        action: "createCharacterLook",
        characterPath: selectedAsset.rootPath,
        name: newLookName.trim(),
      });
      setModal(null);
      setNewLookName("");
      await loadSnapshot(true);
      if (result.path) setSelectedLookPath(result.path);
      notify("success", "人物造型已建立，可分别准备三视图、定妆和参考图");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "建立人物造型失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateScene = async (sceneIdInput = newSceneId) => {
    if (!sceneIdInput.trim()) return;
    if (!confirmLeaveDraft("建立场次资产后会刷新当前列表，未保存的编辑将丢失。是否继续？")) return;
    setBusy(true);
    try {
      const sceneId = sceneIdInput.trim();
      const result = await postAction({ action: "createScene", sceneId });
      setModal(null);
      setActiveTab("shots");
      setActiveSceneId(sceneId);
      setSearch("");
      await refreshAndSelect(result.path ? `scene:${result.path}` : undefined);
      notify("success", "场次资产已建立，可先准备场景图、首尾帧和成片资料");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "建立场次资产失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateShot = async () => {
    if (!newSceneId.trim() || !newShotId.trim() || !newShotTitle.trim()) return;
    if (!confirmLeaveDraft("建立新镜头后会刷新资产列表，当前未保存的编辑将丢失。是否继续？")) return;
    setBusy(true);
    try {
      const sceneId = newSceneId.trim();
      const result = await postAction({ action: "createShot", sceneId, shotId: newShotId.trim(), title: newShotTitle.trim() });
      setModal(null);
      setNewShotTitle("");
      setActiveTab("shots");
      setActiveSceneId(sceneId);
      setSearch("");
      await refreshAndSelect(result.path ? `shot:${result.path}` : undefined);
      notify("success", "镜头资产已建立");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "建立镜头失败");
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!selectedAsset || selectedAsset.type === "shot" && selectedAsset.isDraft) return false;
    setBusy(true);
    try {
      if (selectedAsset.type === "character") {
        await postAction({
          action: "updateCharacterProfile",
          assetPath: selectedAsset.rootPath,
          content: profileDraft,
          expectedRevision: selectedAsset.profileRevision,
        });
        notify("success", "角色设定已保存");
      } else if (selectedAsset.type === "location" || selectedAsset.type === "prop") {
        await postAction({
          action: selectedAsset.type === "location" ? "updateLocationDocument" : "updatePropDocument",
          assetPath: selectedAsset.rootPath,
          content: sceneDraft,
          expectedRevision: selectedAsset.profileRevision,
        });
        notify("success", selectedAsset.type === "location" ? "地点/环境设定已保存" : "道具设定已保存");
      } else if (selectedAsset.type === "scene") {
        if (!selectedAsset.scenePath) throw new Error("请先补齐场次资产后再编辑场次说明。");
        await postAction({
          action: "updateSceneDocument",
          assetPath: selectedAsset.rootPath,
          content: sceneDraft,
          expectedRevision: selectedAsset.sceneRevision,
        });
        notify("success", "场次说明已保存");
      } else {
        if (!selectedAsset.designRevision) throw new Error("请先刷新镜头后再保存。");
        await postAction({
          action: "updateShotDesign",
          assetPath: selectedAsset.rootPath,
          design: designDraft,
          expectedRevision: selectedAsset.designRevision,
        });
        notify("success", "镜头设计已保存");
      }
      await loadSnapshot(true);
      setRevisionConflictKey(null);
      if (selectedAsset.type === "shot") setShotDesignMode("preview");
      return true;
    } catch (error) {
      if (error instanceof AssetApiError && error.code === "REVISION_CONFLICT") {
        setRevisionConflictKey(assetKey(selectedAsset));
        notify("error", "文件已在其他位置更新；当前草稿仍保留，请重新读取最新版本后再保存。");
      } else {
        notify("error", error instanceof Error ? error.message : "保存失败");
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Switching away from the design step must persist the draft first. The
  // later frame/video steps read the saved Markdown on the server, so letting
  // a node click bypass this save would make the preview and submitted prompt
  // disagree with what the editor shows.
  const selectShotWorkflowStep = useCallback(async (nextStep: ShotWorkflowStepId) => {
    if (selectedAsset?.type !== "shot" || selectedAsset.isDraft || nextStep === activeShotWorkflowStep) return;
    if (activeShotWorkflowStep === "design" && hasUnsavedShotDesign) {
      if (!(await handleSave())) return;
    }
    setActiveShotWorkflowStep(nextStep);
  }, [activeShotWorkflowStep, handleSave, hasUnsavedShotDesign, selectedAsset]);

  const handleSaveLook = async () => {
    if (!selectedAsset || selectedAsset.type !== "character" || !selectedCharacterLook?.documentRevision) return;
    setBusy(true);
    try {
      await postAction({
        action: "updateCharacterLookDocument",
        characterPath: selectedAsset.rootPath,
        lookPath: selectedCharacterLook.rootPath,
        content: lookDraft,
        expectedRevision: selectedCharacterLook.documentRevision,
      });
      await loadSnapshot(true);
      setRevisionConflictKey(null);
      notify("success", "造型设定已保存");
    } catch (error) {
      if (error instanceof AssetApiError && error.code === "REVISION_CONFLICT") {
        setRevisionConflictKey(assetKey(selectedAsset));
        notify("error", "造型设定已在其他位置更新；当前草稿仍保留，请重新读取后再保存。");
      } else {
        notify("error", error instanceof Error ? error.message : "保存造型设定失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProjectSettings = async () => {
    if (!snapshot) return;
    setBusy(true);
    try {
      await postAction({
        action: "updateProjectSettings",
        content: projectSettingsDraft,
        expectedRevision: snapshot.projectSettings.revision,
      });
      await loadSnapshot(true);
      notify("success", "项目设定已保存");
    } catch (error) {
      if (error instanceof AssetApiError && error.code === "REVISION_CONFLICT") {
        notify("error", "项目设定已在其他位置更新；当前草稿仍保留，请重新读取最新版本后再保存。");
      } else {
        notify("error", error instanceof Error ? error.message : "保存项目设定失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSceneCast = async () => {
    if (!selectedAsset || selectedAsset.type !== "scene" || !selectedAsset.castPath) return;
    setBusy(true);
    try {
      await postAction({
        action: "updateSceneCastBindings",
        assetPath: selectedAsset.rootPath,
        bindings: sceneCastDraft,
        expectedRevision: selectedAsset.castRevision,
      });
      await loadSnapshot(true);
      setRevisionConflictKey(null);
      notify("success", "本场人物与造型已保存");
    } catch (error) {
      if (error instanceof AssetApiError && error.code === "REVISION_CONFLICT") {
        setRevisionConflictKey(assetKey(selectedAsset));
        notify("error", "出场与造型表已在其他位置更新；当前草稿仍保留，请重新读取后再保存。");
      } else {
        notify("error", error instanceof Error ? error.message : "保存本场人物与造型失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const addSceneCastBinding = () => {
    const character = characterAssets[0];
    if (!character) {
      notify("error", "请先建立人物资产，再为场次绑定造型");
      return;
    }
    setSceneCastDraft((current) => [...current, {
      characterPath: character.rootPath,
      state: "",
      continuity: "",
      startShotId: "",
      endShotId: "",
    }]);
  };

  const updateSceneCastBinding = (index: number, patch: Partial<SceneCastBinding>) => {
    setSceneCastDraft((current) => current.map((binding, bindingIndex) => bindingIndex === index
      ? { ...binding, ...patch }
      : binding));
  };

  const removeSceneCastBinding = (index: number) => {
    setSceneCastDraft((current) => current.filter((_, bindingIndex) => bindingIndex !== index));
  };

  const addSceneLocationBinding = () => {
    if (!locationAssets.length) {
      notify("error", "请先在资产库建立地点/环境，再为本场添加引用");
      return;
    }
    setSceneLocationBindingsDraft((current) => [...current, {
      locationPath: "",
      role: "",
      state: "",
      continuity: "",
      startShotId: "",
      endShotId: "",
    }]);
  };

  const addScenePropBinding = () => {
    if (!propAssets.length) {
      notify("error", "请先在资产库建立道具，再为本场添加引用");
      return;
    }
    setScenePropBindingsDraft((current) => [...current, {
      propPath: "",
      role: "",
      state: "",
      continuity: "",
      startShotId: "",
      endShotId: "",
    }]);
  };

  const updateSceneLocationBinding = (index: number, patch: Partial<SceneLocationBinding>) => {
    setSceneLocationBindingsDraft((current) => current.map((binding, bindingIndex) => bindingIndex === index
      ? { ...binding, ...patch }
      : binding));
  };

  const updateScenePropBinding = (index: number, patch: Partial<ScenePropBinding>) => {
    setScenePropBindingsDraft((current) => current.map((binding, bindingIndex) => bindingIndex === index
      ? { ...binding, ...patch }
      : binding));
  };

  const removeSceneLocationBinding = (index: number) => {
    setSceneLocationBindingsDraft((current) => current.filter((_, bindingIndex) => bindingIndex !== index));
  };

  const removeScenePropBinding = (index: number) => {
    setScenePropBindingsDraft((current) => current.filter((_, bindingIndex) => bindingIndex !== index));
  };

  const handleSaveSceneAssetBindings = async () => {
    if (!selectedAsset || selectedAsset.type !== "scene") return;
    if (sceneLocationBindingsDraft.some((binding) => !binding.locationPath) || scenePropBindingsDraft.some((binding) => !binding.propPath)) {
      notify("error", "请为每条引用选择地点/环境或道具");
      return;
    }
    setBusy(true);
    try {
      await postAction({
        action: "updateSceneAssetBindings",
        assetPath: selectedAsset.rootPath,
        bindings: {
          locations: sceneLocationBindingsDraft,
          props: scenePropBindingsDraft,
        },
        expectedRevision: selectedAsset.assetBindingsRevision,
      });
      await loadSnapshot(true);
      setRevisionConflictKey(null);
      notify("success", "本场地点/环境与道具引用已保存");
    } catch (error) {
      if (error instanceof AssetApiError && error.code === "REVISION_CONFLICT") {
        setRevisionConflictKey(assetKey(selectedAsset));
        notify("error", "场次资产表已在其他位置更新；当前草稿仍保留，请重新读取后再保存。");
      } else {
        notify("error", error instanceof Error ? error.message : "保存本场引用资产失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const addShotCharacterOverride = () => {
    if (!selectedAsset || selectedAsset.type !== "shot") return;
    const inherited = inheritedSceneCastForSelectedShot[0];
    const character = inherited ? characterByPath.get(inherited.characterPath) : characterAssets[0];
    if (!character) {
      notify("error", "请先建立人物资产，再为镜头设置人物造型");
      return;
    }
    const existing = designDraft.characterOverrides ?? [];
    if (existing.some((override) => override.characterPath === character.rootPath)) {
      notify("error", "该人物已经有镜头级造型覆盖");
      return;
    }
    setDesignDraft((draft) => ({
      ...draft,
      characterOverrides: [...(draft.characterOverrides ?? []), {
        characterPath: character.rootPath,
        mode: "inherit",
        state: "",
      }],
    }));
  };

  const updateShotCharacterOverride = (index: number, patch: Partial<ShotCharacterOverride>) => {
    setDesignDraft((draft) => ({
      ...draft,
      characterOverrides: (draft.characterOverrides ?? []).map((override, overrideIndex) => overrideIndex === index
        ? { ...override, ...patch }
        : override),
    }));
  };

  const removeShotCharacterOverride = (index: number) => {
    setDesignDraft((draft) => ({
      ...draft,
      characterOverrides: (draft.characterOverrides ?? []).filter((_, overrideIndex) => overrideIndex !== index),
    }));
  };

  const reloadCurrentRevision = async () => {
    if (!selectedAsset) return;
    if (!window.confirm("重新读取会放弃当前未保存的内容。是否继续？")) return;
    setBusy(true);
    try {
      await loadSnapshot(true);
      setRevisionConflictKey(null);
      notify("success", "已读取文件的最新版本");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "重新读取失败");
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (slot: AssetSlot, files: FileList | null) => {
    if (!selectedAsset || !files?.length || selectedAsset.type === "shot" && selectedAsset.isDraft) return;
    if (!confirmLeaveDraft("上传资料后会重新读取当前资产，未保存的编辑将丢失。是否继续？")) return;
    const selectedFiles = Array.from(files);
    const totalBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
    if (selectedFiles.length > MAX_UPLOAD_FILES) {
      notify("error", `一次最多上传 ${MAX_UPLOAD_FILES} 个文件`);
      return;
    }
    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES || selectedFiles.some((file) => file.size > MAX_UPLOAD_FILE_BYTES)) {
      notify("error", "单个文件不能超过 200 MB，一次上传总量不能超过 500 MB");
      return;
    }
    const assetType = selectedAsset.type;
    const assetPath = selectedAsset.rootPath || "";
    const lookPath = assetType === "character" ? selectedCharacterLook?.rootPath : undefined;
    setBusy(true);
    try {
      const failures: string[] = [];
      let uploaded = 0;
      for (const file of selectedFiles) {
        const query = new URLSearchParams({ assetPath, assetType, fileName: file.name, slot: slot.key });
        if (lookPath) query.set("lookPath", lookPath);
        if (projectId) query.set("projectId", projectId);
        const response = await fetch(`${WORKBENCH_API_BASE}/assets/upload?${query.toString()}`, {
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
          method: "POST",
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          failures.push(`${file.name}：${data.error || "上传失败"}`);
          continue;
        }
        uploaded += 1;
      }
      if (uploaded) await loadSnapshot(true);
      if (failures.length) {
        notify("error", `${uploaded} 个文件已上传，${failures.length} 个失败。${failures[0]}`);
      } else {
        notify("success", `${slot.label}资料已加入资产`);
      }
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "上传失败");
    } finally {
      setBusy(false);
    }
  };

  const handleSetCharacterVisualSelection = async (slot: CharacterVisualSlotKey, file: AssetFile) => {
    if (!selectedAsset || selectedAsset.type !== "character" || !isImage(file)) return;
    const selectedFiles = selectedSlotVisualFiles(
      selectedCharacterVisualSource?.slots.find((candidate) => candidate.key === slot) ?? { key: slot, label: slot, files: [] },
    );
    if (selectedFiles.length === 1 && selectedFiles[0]?.path === file.path) return;
    if (!confirmLeaveDraft("设为定稿后会刷新当前人物，未保存的角色设定将丢失。是否继续？")) return;
    setBusy(true);
    try {
      await postAction({
        action: "setCharacterVisualSelection",
        assetPath: selectedAsset.rootPath,
        slot,
        fileName: file.name,
        ...(selectedCharacterLook ? { lookPath: selectedCharacterLook.rootPath } : {}),
      });
      await loadSnapshot(true);
      const slotLabel = selectedCharacterVisualSource?.slots.find((candidate) => candidate.key === slot)?.label || "视觉资料";
      notify("success", `已选为当前${slotLabel}，文件名已标记 -已选`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "无法设为当前定稿");
    } finally {
      setBusy(false);
    }
  };

  const handleSetWorkspaceVisualSelection = async (slot: AssetSlot, file: AssetFile) => {
    if (!selectedAsset || selectedAsset.type === "character" || selectedAsset.type === "shot" && selectedAsset.isDraft || !isImage(file)) return;
    const selectedFiles = selectedSlotVisualFiles(slot);
    if (selectedFiles.length === 1 && selectedFiles[0]?.path === file.path) return;
    if (!confirmLeaveDraft("设为当前参考图后会重新读取资料槽，未保存的编辑将丢失。是否继续？")) return;
    setBusy(true);
    try {
      await postAction({
        action: "setWorkspaceVisualSelection",
        assetType: selectedAsset.type,
        assetPath: selectedAsset.rootPath,
        slot: slot.key,
        fileName: file.name,
      });
      await loadSnapshot(true);
      const selectedLabel = slot.key === "firstFrame" || slot.key === "lastFrame" ? `${slot.label}已选图` : `${slot.label}参考图`;
      notify("success", `已选为当前${selectedLabel}，文件名已标记 -已选`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "无法设为当前参考图");
    } finally {
      setBusy(false);
    }
  };

  const handleTrashFile = async (slot: AssetSlot, file: AssetFile) => {
    if (!selectedAsset || selectedAsset.type === "shot" && selectedAsset.isDraft) return;
    if (!window.confirm(`确认移除“${file.name}”？文件会进入资产库回收站。`)) return;
    if (!confirmLeaveDraft("移除资料后会重新读取当前资产，未保存的编辑将丢失。是否继续？")) return;
    setBusy(true);
    try {
      await postAction({
        action: "trashAssetFile",
        assetType: selectedAsset.type,
        assetPath: selectedAsset.rootPath,
        slot: slot.key,
        fileName: file.name,
        ...(selectedAsset.type === "character" && selectedCharacterLook ? { lookPath: selectedCharacterLook.rootPath } : {}),
      });
      notify("success", "资料已移入回收站");
      await loadSnapshot(true);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "移除失败");
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!selectedAsset || !renameValue.trim()) return;
    if (!confirmLeaveDraft("重命名会重新选择该资产，当前未保存的编辑将丢失。是否继续？")) return;
    setBusy(true);
    try {
      const result = await postAction({ action: "renameAsset", assetType: selectedAsset.type, assetPath: selectedAsset.rootPath, name: renameValue.trim() });
      setModal(null);
      notify("success", "资产名称已更新");
      await refreshAndSelect(result.path ? `${selectedAsset.type}:${result.path}` : undefined);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "重命名失败");
    } finally {
      setBusy(false);
    }
  };

  const handleTrashAsset = async () => {
    if (!selectedAsset) return;
    const assetLabel = selectedAsset.type === "character"
      ? selectedAsset.name
      : selectedAsset.type === "location" || selectedAsset.type === "prop"
        ? selectedAsset.name
      : selectedAsset.type === "scene"
        ? `${selectedAsset.sceneId} 场次及其全部镜头`
        : selectedAsset.design.shotId;
    if (!window.confirm(`确认将“${assetLabel}”移入回收站？`)) return;
    if (!confirmLeaveDraft("移入回收站会放弃当前未保存的编辑。是否继续？")) return;
    setBusy(true);
    try {
      await postAction({ action: "trashAsset", assetType: selectedAsset.type, assetPath: selectedAsset.rootPath });
      setModal(null);
      setSelectedKey(null);
      notify("success", "资产已移入回收站");
      await loadSnapshot(false);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "移入回收站失败");
    } finally {
      setBusy(false);
    }
  };

  const openRename = () => {
    if (!selectedAsset) return;
    if (selectedAsset.type === "scene" || selectedAsset.type === "location" || selectedAsset.type === "prop") {
      if (selectedAsset.type !== "scene") {
        setRenameValue(selectedAsset.name);
        setModal("rename");
        return;
      }
      notify("error", "场次编号同时是镜头身份，当前不支持在工作台内重命名。");
      return;
    }
    setRenameValue(selectedAsset.type === "character" ? selectedAsset.name : selectedAsset.design.title);
    setModal("rename");
  };

  const openCreate = () => {
    if (activeTab === "characters") {
      setModal("character");
      return;
    }
    if (activeTab === "locations" || activeTab === "props") {
      setNewSimpleAssetName("");
      setModal(activeTab === "locations" ? "location" : "prop");
      return;
    }
    setNewSceneId(activeScene?.sceneId || "");
    setNewShotId(suggestNextShotId(activeShotAssets));
    setNewShotTitle("");
    setModal("shot");
  };

  const openCreateScene = () => {
    setNewSceneId("");
    setModal("scene");
  };

  const openGeneration = async (initialPresetId?: string, skipLeaveDraftCheck = false) => {
    if (!selectedAsset) return;
    if (initialPresetId && selectedAsset.type === "shot" && !selectedAsset.isDraft && hasUnsavedShotDesign && !skipLeaveDraftCheck) {
      const saved = await handleSave();
      if (!saved) return;
      skipLeaveDraftCheck = true;
    }
    setGenerationDurationSeconds(
      initialPresetId === "h3-first-last-video-v1" && selectedAsset.type === "shot"
        ? shotDurationSeconds(designDraft.duration)
        : undefined,
    );
    if (selectedAsset.type === "shot" && selectedAsset.isDraft) {
      setGenerationTarget(selectedAsset);
      setGenerationPresetId(initialPresetId);
      setModal("generation");
      return;
    }
    if (!skipLeaveDraftCheck && !confirmLeaveDraft("生成任务只读取当前已保存的 Markdown；纯文生图不上传参考图，图生图和视频工作流会在检查输入后上传明确列出的已选图片。未保存的编辑不会带入本次任务，是否继续？")) return;
    setGenerationTarget(selectedAsset);
    setGenerationPresetId(initialPresetId);
    setModal("generation");
  };

  const handleGenerateSceneImageFromShot = async () => {
    if (!selectedAsset || selectedAsset.type !== "shot" || selectedAsset.isDraft) return;
    if (!designDraft.prompt.trim() && !designDraft.content.trim()) {
      notify("error", "请先保存镜头画面或提示词");
      return;
    }
    if (hasUnsavedShotDesign && !(await handleSave())) return;

    setBusy(true);
    try {
      const result = await postAction<{ path?: string }>({
        action: "prepareSceneImageFromShot",
        shotPath: selectedAsset.rootPath,
      });
      if (!result.path) throw new Error("无法准备场景资产");
      if (!(await loadSnapshot(true))) throw new Error("场景资产已准备，但刷新失败。请重试。");
      setPendingSceneImageLocationPath(result.path);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "无法准备场景图");
    } finally {
      setBusy(false);
    }
  };

  const advanceShotWorkflow = async () => {
    if (selectedAsset?.type !== "shot" || selectedAsset.isDraft) return;
    if (activeShotWorkflowStep === "design") {
      if (!designDraft.prompt.trim() && !designDraft.content.trim()) {
        notify("error", "请先填写镜头画面或提示词");
        return;
      }
      const saved = await handleSave();
      if (saved) setActiveShotWorkflowStep("reference");
      return;
    }
    if (activeShotWorkflowStep === "reference") {
      setActiveShotWorkflowStep("firstFrame");
      return;
    }
    if (activeShotWorkflowStep === "firstFrame") {
      if (!hasSelectedFirstFrame) {
        notify("error", "请先将一张首帧设为已选");
        return;
      }
      setActiveShotWorkflowStep("lastFrame");
      return;
    }
    if (activeShotWorkflowStep === "lastFrame") {
      if (!hasSelectedLastFrame) {
        notify("error", "请先将一张尾帧设为已选");
        return;
      }
      setActiveShotWorkflowStep("video");
      return;
    }
    if (!hasSelectedFirstFrame || !hasSelectedLastFrame) {
      notify("error", "图生视频需要当前镜头已选的首帧和尾帧");
      return;
    }
    if (hasUnsavedShotDesign && !(await handleSave())) return;
    void openGeneration("h3-first-last-video-v1", true);
  };

  return (
    <main className="workbench-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-sigil" aria-hidden="true"><i /><i /><i /></span>
          <div><p className="brand-name">漫剧工作台</p><p className="brand-subtitle">人物 · 分镜 · 成片</p></div>
        </div>
        <ProjectPicker
          currentProjectId={projectId}
          activeProjectName={snapshot?.error ? "选择项目" : snapshot?.rootName || "选择项目"}
          disabled={busy}
          onProjectAction={handleProjectAction}
        />
          <div className="topbar-actions">
          <button className="refresh-button" disabled={busy || !snapshot} onClick={() => setModal("projectSettings")} type="button"><b>项目设定</b></button>
          <button className="refresh-button" disabled={busy} onClick={openTrash} type="button"><span aria-hidden="true">↺</span><b>回收站</b></button>
          <button className="refresh-button" disabled={loading || busy} onClick={refreshWorkspace} type="button"><span aria-hidden="true">↻</span><b>{loading ? "刷新中" : "刷新"}</b></button>
        </div>
      </header>

      {notice ? <div aria-live="polite" className={`notice notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}><span aria-hidden="true">{notice.tone === "success" ? "✓" : "!"}</span>{notice.text}<button aria-label="关闭提示" onClick={() => setNotice(null)} type="button">×</button></div> : null}

      <div className="asset-workspace-grid">
        <aside className="asset-library-rail">
          <div className="asset-rail-heading"><p className="eyebrow">项目导航</p><h1>资产</h1></div>
          <div className="asset-tabs" role="tablist" aria-label="制作与资产库">
            <button aria-controls="asset-list-panel" aria-selected={activeTab === "shots"} className={`is-primary-tab ${activeTab === "shots" ? "is-active" : ""}`} id="shots-tab" onClick={() => changeTab("shots")} role="tab" tabIndex={activeTab === "shots" ? 0 : -1} type="button"><span>分镜</span><b>{sceneGroups.length}</b></button>
            <button aria-controls="asset-list-panel" aria-selected={activeTab === "characters"} className={activeTab === "characters" ? "is-active" : ""} id="characters-tab" onClick={() => changeTab("characters")} role="tab" tabIndex={activeTab === "characters" ? 0 : -1} type="button"><span>人物</span><b>{characterAssets.length}</b></button>
            <button aria-controls="asset-list-panel" aria-selected={activeTab === "locations"} className={activeTab === "locations" ? "is-active" : ""} id="locations-tab" onClick={() => changeTab("locations")} role="tab" tabIndex={activeTab === "locations" ? 0 : -1} type="button"><span>地点/环境</span><b>{locationAssets.length}</b></button>
            <button aria-controls="asset-list-panel" aria-selected={activeTab === "props"} className={activeTab === "props" ? "is-active" : ""} id="props-tab" onClick={() => changeTab("props")} role="tab" tabIndex={activeTab === "props" ? 0 : -1} type="button"><span>道具</span><b>{propAssets.length}</b></button>
          </div>
          {activeTab === "shots" ? <div className="scene-scope">
            <SelectField
              ariaLabel="选择场次"
              className="scene-picker"
              disabled={!sceneGroups.length}
              label="当前场次"
              onChange={(sceneId) => {
                changeScene(sceneId);
              }}
              options={sceneGroups.map((scene) => ({ label: `${scene.sceneId} · ${scene.shots.length} 镜头`, value: scene.sceneId }))}
              value={activeScene?.sceneId || ""}
            />
            {activeScene ? <small>{sceneGroups.length} 场 · 当前 {activeScene.shots.length} 镜头{activeScene.draftCount ? ` · ${activeScene.draftCount} 待导入` : ""}</small> : <small>还没有可用场次</small>}
          </div> : null}
          <div className="asset-list-tools"><div className="asset-search"><span aria-hidden="true">⌕</span><input aria-label={activeTab === "characters" ? "搜索人物" : activeTab === "locations" ? "搜索地点/环境" : activeTab === "props" ? "搜索道具" : "搜索当前场次镜头"} onChange={(event) => changeSearch(event.target.value)} placeholder={activeTab === "characters" ? "搜索人物" : activeTab === "locations" ? "搜索地点/环境" : activeTab === "props" ? "搜索道具" : "搜索当前场次镜头"} value={search} />{search ? <button aria-label="清空搜索" className="asset-search-clear" onClick={() => changeSearch("")} type="button">×</button> : null}</div>{activeTab === "characters" || activeTab === "locations" || activeTab === "props" ? <button aria-label="新建资产" className="add-asset-button" onClick={openCreate} type="button"><span aria-hidden="true">＋</span><b>新建</b></button> : <div className="scene-create-actions"><button aria-label="新建场次" className="add-asset-button is-secondary" onClick={openCreateScene} type="button"><span aria-hidden="true">＋</span><b>场次</b></button><button aria-label="新建镜头" className="add-asset-button" onClick={openCreate} type="button"><span aria-hidden="true">＋</span><b>镜头</b></button></div>}</div>
          {activeTab === "shots" ? <button className="import-storyboard-button" disabled={busy || !activeDraftGroups.length} onClick={openStoryboardImport} type="button"><span aria-hidden="true">⇣</span>导入当前场次剧本{activeDraftGroups.length ? <b>{activeDraftGroups.reduce((total, group) => total + group.shots.length, 0)}</b> : null}</button> : null}
          {activeTab === "shots" && activeScene?.scene ? <div className="scene-asset-summary"><SceneAssetCard active={assetKey(activeScene.scene) === selectedKey} onClick={() => selectAsset(assetKey(activeScene.scene!))} scene={activeScene.scene} /></div> : activeTab === "shots" && activeScene ? <button className="scene-asset-create-note" disabled={busy} onClick={() => void handleCreateScene(activeScene.sceneId)} type="button"><span>当前场次还没有独立资料文件夹</span><b>建立场次资产</b></button> : null}
          <div className="asset-list-heading"><span>{activeTab === "characters" ? "资产库 · 人物" : activeTab === "locations" ? "资产库 · 地点/环境" : activeTab === "props" ? "资产库 · 道具" : activeScene ? "当前场次镜头列表" : "全部分镜"}</span><small>{activeTab === "characters" ? `${characterAssets.length} 个` : activeTab === "locations" ? `${locationAssets.length} 个` : activeTab === "props" ? `${propAssets.length} 个` : `${activeShotAssets.length} 个`}</small></div>
          <div aria-labelledby={`${activeTab}-tab`} className="asset-card-list" id="asset-list-panel" role="tabpanel">
            {loading ? <div className="asset-list-empty">正在整理资产…</div> : snapshot?.error ? <div className="asset-list-empty error-copy">{snapshot.error}</div> : visibleAssets.length ? visibleAssets.map((asset) => <AssetCard active={assetKey(asset) === selectedKey} asset={asset} key={assetKey(asset)} onClick={() => selectAsset(assetKey(asset))} sceneReferenceCount={asset.type === "location" || asset.type === "prop" ? sceneReferenceCounts.get(asset.rootPath) : undefined} />) : <div className="asset-list-empty"><strong>{search ? "没有匹配资产" : activeTab === "characters" ? "还没有人物" : activeTab === "locations" ? "还没有地点/环境" : activeTab === "props" ? "还没有道具" : "当前场次还没有镜头"}</strong><span>{search ? "换个名称或关键词试试。" : activeTab === "shots" ? "点击“场次”或“镜头”开始分镜生产。" : "点击“新建”建立第一个资产。"}</span></div>}
          </div>
        </aside>

        <section className="asset-studio-column">
          <div className={`asset-studio-head asset-studio-toolbar ${selectedAsset?.type === "character" ? "is-character-studio" : ""} ${selectedAsset?.type === "scene" ? "is-scene-studio" : ""}`}>
            <div>
              <p className="asset-breadcrumb">{selectedAsset?.type === "location" ? "资产库 / 地点/环境" : selectedAsset?.type === "prop" ? "资产库 / 道具" : activeTab === "characters" ? selectedAsset?.type === "character" ? `资产库 / 人物 / ${selectedAsset.roleCategory}` : "资产库 / 人物" : activeScene ? `分镜 / ${activeScene.sceneId}` : "分镜 / 资产"}</p>
              <div className="asset-title-row">
                <h2>{selectedAsset ? displayWorkspaceAssetTitle(selectedAsset) : "选择一个资产开始"}</h2>
                {selectedAsset?.type === "character" ? <span
                  aria-label={`人物分类：${selectedAsset.roleCategory}`}
                  className="character-role-badge"
                  title="分类来自角色设定.md；保存或刷新后更新"
                >
                  <span aria-hidden="true" className="character-role-badge-lock">⌁</span>
                  {selectedAsset.roleCategory}
                </span> : null}
              </div>
              {activeTab === "shots" && activeScene ? <p className="studio-context">{activeScene.sceneId} · {activeScene.shots.length} 个镜头</p> : null}
            </div>
            {selectedAsset ? <div className="asset-studio-actions">
              {isDirty || selectedAsset.type === "shot" && selectedAsset.isDraft ? <span className={`asset-state-pill ${isDirty ? "is-dirty" : ""}`}>{isDirty ? "未保存" : "待导入"}</span> : null}
              {selectedAsset.type === "shot" && selectedShotIndex >= 0 ? <div className="shot-stepper" aria-label="镜头导航"><span>{String(selectedShotIndex + 1).padStart(2, "0")} / {String(activeShotAssets.length).padStart(2, "0")}</span><button aria-label="上一个镜头" disabled={busy || selectedShotIndex === 0} onClick={() => moveSelectedShot(-1)} type="button">‹</button><button aria-label="下一个镜头" disabled={busy || selectedShotIndex === activeShotAssets.length - 1} onClick={() => moveSelectedShot(1)} type="button">›</button></div> : null}
              {selectedAsset.type === "character" || selectedAsset.type === "location" ? <button className="studio-action-button generation-open-button" disabled={busy} onClick={() => void openGeneration()} type="button">生成</button> : null}
              {selectedAsset.type !== "shot" || !selectedAsset.isDraft ? <>
                {selectedAsset.type !== "scene" ? <button className="studio-action-button" disabled={busy} onClick={openRename} type="button">重命名</button> : null}
                <button className="studio-action-button is-danger" disabled={busy} onClick={() => setModal("trash")} type="button">移入回收站</button>
              </> : null}
            </div> : null}
          </div>
          {selectedAsset && revisionConflictKey === assetKey(selectedAsset) ? <section className="revision-conflict-notice" role="alert">
            <div>
              <strong>文件已在其他位置更新</strong>
              <p>当前输入没有被覆盖。重新读取后会放弃这份本地草稿，并加载磁盘中的最新内容。</p>
            </div>
            <button disabled={busy} onClick={() => void reloadCurrentRevision()} type="button">重新读取最新内容</button>
          </section> : null}
          {!selectedAsset ? <div className="studio-empty"><span className="studio-empty-symbol">◇</span><h3>从左侧选择创作对象</h3><p>这里会显示角色设定、三视图、镜头设计和对应资料槽。</p></div> : selectedAsset.type === "character" ? (
            <div className={`character-editor ${selectedCharacterVisualSet.length ? "has-character-visuals" : ""}`}>
              <section className="character-look-switcher" aria-label="人物造型选择">
                <div><p className="eyebrow">人物造型</p><h3>{selectedCharacterVisualSource?.isIdentity ? "身份基准" : selectedCharacterVisualSource?.label || "选择造型"}</h3><p>身份资料不随服装变化；每套造型独立保存候选三视图、定妆和参考图。</p></div>
                <div className="character-look-switcher-actions">
                  <SelectField
                    ariaLabel="选择人物造型"
                    className="character-look-picker"
                    disabled={busy || !selectedCharacterVisualSources.length}
                    onChange={changeCharacterLook}
                    options={selectedCharacterVisualSources.map((source) => ({ label: source.label, value: source.key }))}
                    value={selectedCharacterVisualSource?.key || "identity"}
                  />
                  <button className="studio-action-button" disabled={busy} onClick={openCreateCharacterLook} type="button">新建造型</button>
                </div>
              </section>
              <div className="character-work-area">
                <div className="character-copy-column">
                  {selectedCharacterLook ? <section className="editor-card look-document-editor"><div className="editor-card-heading"><div><p className="eyebrow">当前造型</p><h3>{selectedCharacterLook.id} · {selectedCharacterLook.name}</h3></div><div className="editor-card-heading-actions"><button aria-pressed={lookMode === "edit"} className="editor-mode-button" onClick={() => setLookMode((mode) => mode === "preview" ? "edit" : "preview")} type="button">{lookMode === "preview" ? "编辑" : "预览"}</button><button className="save-button" disabled={busy || lookDraft === (selectedCharacterLook.documentContent || "")} onClick={() => void handleSaveLook()} type="button">{busy ? "处理中…" : lookDraft === (selectedCharacterLook.documentContent || "") ? "已保存" : "保存造型"}</button></div></div>{lookMode === "preview" ? <ProfilePreview content={lookDraft} /> : <textarea aria-label={`${selectedCharacterLook.name}造型设定`} className="profile-textarea" onChange={(event) => { setLookDraft(event.target.value); setLookMode("edit"); }} placeholder="补充服装、妆发、固定道具和跨镜头连续性…" value={lookDraft} />}<p className="editor-hint">这一页只描述当前服装与状态；人物分类、脸部和身份仍在“角色设定”中维护。</p></section> : null}
                  <section className="editor-card profile-editor"><div className="editor-card-heading"><div><p className="eyebrow">身份资料</p><h3>角色设定</h3></div><div className="editor-card-heading-actions"><button aria-pressed={profileMode === "edit"} className="editor-mode-button" onClick={() => setProfileMode((mode) => mode === "preview" ? "edit" : "preview")} type="button">{profileMode === "preview" ? "编辑" : "预览"}</button><button className="save-button" disabled={busy || profileDraft === (selectedAsset.profileContent || "")} onClick={() => void handleSave()} type="button">{busy ? "处理中…" : profileDraft === (selectedAsset.profileContent || "") ? "已保存" : "保存设定"}</button></div></div>{profileMode === "preview" ? <ProfilePreview content={profileDraft} /> : <textarea aria-label={`${selectedAsset.name}角色设定`} className="profile-textarea" onChange={(event) => { setProfileDraft(event.target.value); setProfileMode("edit"); }} placeholder="补充人物身份、外形、服装和表演设定…" value={profileDraft} />}<p className="editor-hint">角色分类只从本文件解析；要修改分类，请在 Markdown 中编辑“角色分类”后保存并刷新。</p></section>
                </div>
                <div className="character-media-column">
                  {selectedCharacterVisualSet.length && selectedCharacterVisualSource ? <CharacterVisualBoard characterName={selectedAsset.name} onPreview={setMediaPreview} sourceLabel={selectedCharacterVisualSource.label} visuals={selectedCharacterVisualSet} /> : null}
                  <section className="slot-section"><div className="section-heading"><div><p className="eyebrow">视觉资料</p><h3>{selectedCharacterVisualSource?.isIdentity ? "身份基准资料槽" : "当前造型资料槽"}</h3></div><span>仅显示当前资料文件夹中的真实素材 · 每个资料槽可多图选择一张定稿</span></div><div className="slot-grid character-slot-grid">{(selectedCharacterVisualSource?.slots || []).map((slot) => {
                const visualSlotKey = isCharacterVisualSlotKey(slot.key) ? slot.key : undefined;
                const confirmedFile = visualSlotKey
                  ? selectedCharacterVisualSource?.confirmedVisuals?.[visualSlotKey]
                  : undefined;
                const confirmedSourcePath = visualSlotKey
                  ? selectedCharacterVisualSource?.confirmedVisualSourcePaths?.[visualSlotKey]
                  : undefined;
                return <SlotPanel
                  disabled={busy}
                  confirmedFile={confirmedFile}
                  confirmedSourcePath={confirmedSourcePath}
                  key={slot.key}
                  onPreview={setMediaPreview}
                  onSetConfirmed={visualSlotKey ? (file) => void handleSetCharacterVisualSelection(visualSlotKey, file) : undefined}
                  onTrash={(file) => void handleTrashFile(slot, file)}
                  onUpload={(files) => void handleUpload(slot, files)}
                  slot={slot}
                />;
                  })}</div></section>
                </div>
              </div>
            </div>
          ) : selectedAsset.type === "location" || selectedAsset.type === "prop" ? (
            <div className="scene-editor">
              {firstMedia(selectedAsset) ? <PrimaryMedia file={firstMedia(selectedAsset)!} label={selectedAsset.name} onPreview={() => setMediaPreview(firstMedia(selectedAsset)!)} /> : null}
              <section className="editor-card scene-document-editor">
                <div className="editor-card-heading">
                  <div><p className="eyebrow">{selectedAsset.type === "location" ? "地点/环境资产" : "道具资产"}</p><h3>{selectedAsset.type === "location" ? "地点/环境设定" : "道具设定"}</h3></div>
                  <div className="editor-card-heading-actions">
                    <button aria-pressed={sceneMode === "edit"} className="editor-mode-button" onClick={() => setSceneMode((mode) => mode === "preview" ? "edit" : "preview")} type="button">{sceneMode === "preview" ? "编辑" : "预览"}</button>
                    <button className="save-button" disabled={busy || sceneDraft === (selectedAsset.profileContent || "")} onClick={() => void handleSave()} type="button">{busy ? "处理中…" : sceneDraft === (selectedAsset.profileContent || "") ? "已保存" : "保存设定"}</button>
                  </div>
                </div>
                {sceneMode === "preview" ? <ProfilePreview content={sceneDraft} /> : <textarea aria-label={`${selectedAsset.name}设定`} className="profile-textarea" onChange={(event) => { setSceneDraft(event.target.value); setSceneMode("edit"); }} placeholder={selectedAsset.type === "location" ? "补充空间关系、光线、时代和连续性要求…" : "补充道具用途、材质、尺寸、磨损和连续性要求…"} value={sceneDraft} />}
              </section>
              <section className="slot-section"><div className="section-heading"><div><p className="eyebrow">制作资料</p><h3>{selectedAsset.type === "location" ? "地点/环境资料槽" : "道具资料槽"}</h3></div><span>上传真实素材，并在候选图中选择当前参考</span></div><p className="asset-library-managed-note">由分镜场次统一管理引用关系 · 当前资产被 {sceneReferenceCounts.get(selectedAsset.rootPath) || 0} 个场次引用</p><div className="slot-grid scene-slot-grid">{selectedAsset.slots.map((slot) => <SlotPanel confirmedFile={SELECTABLE_VISUAL_SLOTS.has(slot.key) ? selectedSlotVisual(slot) : undefined} confirmedSourcePath={SELECTABLE_VISUAL_SLOTS.has(slot.key) ? selectedSlotVisual(slot)?.path : undefined} disabled={busy} key={slot.key} onPreview={setMediaPreview} onSetConfirmed={SELECTABLE_VISUAL_SLOTS.has(slot.key) ? (file) => void handleSetWorkspaceVisualSelection(slot, file) : undefined} onTrash={(file) => void handleTrashFile(slot, file)} onUpload={(files) => void handleUpload(slot, files)} slot={slot} />)}</div></section>
            </div>
          ) : selectedAsset.type === "scene" ? (
            <div className="scene-editor">
              {selectedSceneMedia ? <PrimaryMedia file={selectedSceneMedia} label={`${selectedAsset.sceneId} 场次`} onPreview={() => setMediaPreview(selectedSceneMedia)} /> : null}
              <section className="editor-card scene-document-editor">
                <div className="editor-card-heading">
                  <div>
                    <p className="eyebrow">大分镜资料</p>
                    <h3>场次说明</h3>
                  </div>
                  {selectedAsset.scenePath ? <div className="editor-card-heading-actions">
                    <button aria-pressed={sceneMode === "edit"} className="editor-mode-button" onClick={() => setSceneMode((mode) => mode === "preview" ? "edit" : "preview")} type="button">{sceneMode === "preview" ? "编辑" : "预览"}</button>
                    <button className="save-button" disabled={busy || sceneDraft === (selectedAsset.sceneContent || "")} onClick={() => void handleSave()} type="button">{busy ? "处理中…" : sceneDraft === (selectedAsset.sceneContent || "") ? "已保存" : "保存场次说明"}</button>
                  </div> : null}
                </div>
                {!selectedAsset.scenePath ? <div className="scene-setup-empty">
                  <strong>这个场次还没有独立资料文件夹</strong>
                  <p>补齐后会创建“场次.md”以及地点/环境图、参考图、首帧、尾帧、候选、定稿和成片资料槽；原始分镜脚本不会被改写。</p>
                  <button className="save-button primary" disabled={busy} onClick={() => void handleCreateScene(selectedAsset.sceneId)} type="button">{busy ? "建立中…" : "补齐场次资产"}</button>
                </div> : <>
                  {sceneMode === "preview" ? <ProfilePreview content={sceneDraft} /> : <textarea aria-label={`${selectedAsset.sceneId}场次说明`} className="profile-textarea" onChange={(event) => { setSceneDraft(event.target.value); setSceneMode("edit"); }} placeholder="补充本场的空间关系、统一视觉、连续性和交付要求…" value={sceneDraft} />}
                  <p className="editor-hint">这里记录整场统一要求；具体镜头的动作和提示词仍在各自的“镜头.md”中。</p>
                  {!selectedAsset.isComplete ? <button className="scene-complete-button" disabled={busy} onClick={() => void handleCreateScene(selectedAsset.sceneId)} type="button">补齐场次资料（含出场与造型表）</button> : null}
                </>}
              </section>
              {selectedAsset.castPath ? <section className="scene-cast-editor">
                <div className="section-heading">
                  <div><p className="eyebrow">出场与造型</p><h3>本场默认人物</h3></div>
                  <div className="scene-cast-actions"><button className="studio-action-button" disabled={busy || !characterAssets.length} onClick={addSceneCastBinding} type="button">添加人物</button><button className="save-button" disabled={busy || JSON.stringify(sceneCastDraft) === JSON.stringify(selectedAsset.castBindings)} onClick={() => void handleSaveSceneCast()} type="button">{busy ? "处理中…" : JSON.stringify(sceneCastDraft) === JSON.stringify(selectedAsset.castBindings) ? "已保存" : "保存绑定"}</button></div>
                </div>
                <p className="scene-cast-intro">先给整个场次确定角色和服装；镜头默认继承，只有临时换装、受伤或局部状态才在镜头内覆盖。</p>
                {sceneCastDraft.length ? <div className="scene-cast-list">{sceneCastDraft.map((binding, index) => {
                  const character = characterByPath.get(binding.characterPath);
                  const lookOptions = [
                    { label: "身份基准", value: "__identity__" },
                    ...(character?.looks.map((look) => ({ label: `${look.id} · ${look.name}`, value: look.rootPath })) || []),
                  ];
                  return <article className="scene-cast-row" key={`${binding.characterPath}-${index}`}>
                    <div className="scene-cast-row-head"><strong>角色 {String(index + 1).padStart(2, "0")}</strong><button aria-label={`移除第 ${index + 1} 条场次人物绑定`} className="asset-file-remove" disabled={busy} onClick={() => removeSceneCastBinding(index)} type="button">×</button></div>
                    <div className="scene-cast-row-grid">
                      <SelectField ariaLabel={`选择第 ${index + 1} 位场次人物`} label="人物" disabled={busy || !characterAssets.length} onChange={(characterPath) => updateSceneCastBinding(index, { characterPath, lookPath: undefined })} options={characterAssets.map((asset) => ({ label: `${asset.name} · ${asset.roleCategory}`, value: asset.rootPath }))} value={binding.characterPath} />
                      <SelectField ariaLabel={`选择${character?.name || "人物"}的默认造型`} label="默认造型" disabled={busy || !character} onChange={(value) => updateSceneCastBinding(index, { lookPath: value === "__identity__" ? undefined : value })} options={lookOptions} value={binding.lookPath || "__identity__"} />
                      <TextField label="起始镜号" onChange={(startShotId) => updateSceneCastBinding(index, { startShotId })} placeholder="留空表示从首镜" value={binding.startShotId} />
                      <TextField label="结束镜号" onChange={(endShotId) => updateSceneCastBinding(index, { endShotId })} placeholder="留空表示到尾镜" value={binding.endShotId} />
                    </div>
                    <div className="scene-cast-row-notes"><TextField label="人物状态" onChange={(state) => updateSceneCastBinding(index, { state })} placeholder="如：衣袍完整、闭眼静止" value={binding.state} /><TextField label="连续性" onChange={(continuity) => updateSceneCastBinding(index, { continuity })} placeholder="如：左肩铁链始终绕向背部" value={binding.continuity} /></div>
                  </article>;
                })}</div> : <div className="scene-cast-empty"><strong>尚未绑定本场人物</strong><p>先添加角色和默认造型，后续镜头就能直接继承。</p></div>}
              </section> : null}
              <section className="scene-cast-editor scene-asset-bindings" aria-label="本场引用资产">
                <div className="section-heading">
                  <div><p className="eyebrow">分镜生产容器</p><h3>本场引用资产</h3></div>
                  <div className="scene-cast-actions">
                    <button className="studio-action-button" disabled={busy || !locationAssets.length} onClick={addSceneLocationBinding} type="button">添加地点/环境</button>
                    <button className="studio-action-button" disabled={busy || !propAssets.length} onClick={addScenePropBinding} type="button">添加道具</button>
                    <button className="save-button" disabled={busy || !hasUnsavedSceneAssetBindings} onClick={() => void handleSaveSceneAssetBindings()} type="button">{busy ? "处理中…" : hasUnsavedSceneAssetBindings ? "保存引用" : "已保存"}</button>
                  </div>
                </div>
                <p className="scene-cast-intro">地点/环境与道具保留在项目资产库中；本场只记录引用、用途和连续性，镜头在设定的范围内继承。</p>
                <p className="scene-asset-binding-hint">起止镜号留空表示覆盖全场；填写时必须使用当前场次已有的镜号。</p>
                <div className="scene-asset-binding-categories">
                  <div className="scene-asset-binding-category">
                    <div className="scene-asset-binding-category-heading"><strong>地点/环境</strong><small>空间、环境和主视觉基底</small></div>
                    {selectedSceneAssetBindings.locations.length ? <div className="scene-cast-list">{selectedSceneAssetBindings.locations.map((binding, index) => <article className="scene-cast-row" key={`location-${index}`}>
                      <div className="scene-cast-row-head"><strong>地点/环境 {String(index + 1).padStart(2, "0")}</strong><button aria-label={`移除第 ${index + 1} 条地点/环境绑定`} className="asset-file-remove" disabled={busy} onClick={() => removeSceneLocationBinding(index)} type="button">×</button></div>
                      <div className="scene-cast-row-grid">
                        <SelectField ariaLabel={`选择第 ${index + 1} 条地点/环境`} label="地点/环境" disabled={busy || !locationAssets.length} onChange={(locationPath) => updateSceneLocationBinding(index, { locationPath })} options={[{ label: "选择地点/环境", value: "" }, ...locationAssets.map((asset) => ({ label: asset.name, value: asset.rootPath }))]} value={binding.locationPath} />
                        <TextField label="用途 / 角色" onChange={(role) => updateSceneLocationBinding(index, { role })} placeholder="如：主环境、转场地点" value={binding.role} />
                        <TextField label="起始镜号" onChange={(startShotId) => updateSceneLocationBinding(index, { startShotId })} placeholder="留空表示从首镜" value={binding.startShotId} />
                        <TextField label="结束镜号" onChange={(endShotId) => updateSceneLocationBinding(index, { endShotId })} placeholder="留空表示到尾镜" value={binding.endShotId} />
                      </div>
                      <div className="scene-cast-row-notes"><TextField label="状态" onChange={(state) => updateSceneLocationBinding(index, { state })} placeholder="如：雨后、夜景、门扉关闭" value={binding.state} /><TextField label="连续性" onChange={(continuity) => updateSceneLocationBinding(index, { continuity })} placeholder="如：火把始终在画面左侧" value={binding.continuity} /></div>
                    </article>)}</div> : <div className="scene-cast-empty"><strong>尚未绑定地点/环境</strong><p>从项目资产库选择本场需要的空间或环境，原始地点资料不会被复制。</p></div>}
                  </div>
                  <div className="scene-asset-binding-category">
                    <div className="scene-asset-binding-category-heading"><strong>道具</strong><small>关键物件、线索和连续性道具</small></div>
                    {selectedSceneAssetBindings.props.length ? <div className="scene-cast-list">{selectedSceneAssetBindings.props.map((binding, index) => <article className="scene-cast-row" key={`prop-${index}`}>
                      <div className="scene-cast-row-head"><strong>道具 {String(index + 1).padStart(2, "0")}</strong><button aria-label={`移除第 ${index + 1} 条道具绑定`} className="asset-file-remove" disabled={busy} onClick={() => removeScenePropBinding(index)} type="button">×</button></div>
                      <div className="scene-cast-row-grid">
                        <SelectField ariaLabel={`选择第 ${index + 1} 条道具`} label="道具" disabled={busy || !propAssets.length} onChange={(propPath) => updateScenePropBinding(index, { propPath })} options={[{ label: "选择道具", value: "" }, ...propAssets.map((asset) => ({ label: asset.name, value: asset.rootPath }))]} value={binding.propPath} />
                        <TextField label="用途 / 角色" onChange={(role) => updateScenePropBinding(index, { role })} placeholder="如：关键线索、角色持有" value={binding.role} />
                        <TextField label="起始镜号" onChange={(startShotId) => updateScenePropBinding(index, { startShotId })} placeholder="留空表示从首镜" value={binding.startShotId} />
                        <TextField label="结束镜号" onChange={(endShotId) => updateScenePropBinding(index, { endShotId })} placeholder="留空表示到尾镜" value={binding.endShotId} />
                      </div>
                      <div className="scene-cast-row-notes"><TextField label="状态" onChange={(state) => updateScenePropBinding(index, { state })} placeholder="如：出鞘、沾血、破损" value={binding.state} /><TextField label="连续性" onChange={(continuity) => updateScenePropBinding(index, { continuity })} placeholder="如：始终由右手持有" value={binding.continuity} /></div>
                    </article>)}</div> : <div className="scene-cast-empty"><strong>尚未绑定道具</strong><p>只在本场需要的道具建立引用，避免为每个分镜重复复制同一主档。</p></div>}
                  </div>
                </div>
              </section>
              {selectedSourcePath ? <section className="source-context-card"><div className="source-context-heading"><div><p className="eyebrow">来源上下文</p><h3>{displayFileName(selectedSourcePath)}</h3><small title={selectedSourcePath}>原始分镜脚本</small></div><button className="source-context-toggle" disabled={sourceContext.loading} onClick={() => void toggleSourceContext()} type="button">{sourceContextOpen ? "收起原文" : sourceContext.error && sourceContext.path === selectedSourcePath ? "重新读取" : "查看原文"}</button></div>{sourceContextOpen ? <div className="source-context-body">{sourceContext.path !== selectedSourcePath || sourceContext.loading ? <p>正在读取原始剧本…</p> : sourceContext.error ? <p className="source-context-error">{sourceContext.error}</p> : <pre>{sourceContext.content || "原始剧本为空。"}</pre>}</div> : null}</section> : null}
              {selectedAsset.scenePath ? <section className="slot-section"><div className="section-heading"><div><p className="eyebrow">整场制作资料</p><h3>场次资料槽</h3></div><span>场景图、统一参考、首尾承接帧与整场成片分别管理</span></div><div className="slot-grid scene-slot-grid">{selectedAsset.slots.map((slot) => <SlotPanel confirmedFile={SELECTABLE_VISUAL_SLOTS.has(slot.key) ? selectedSlotVisual(slot) : undefined} confirmedSourcePath={SELECTABLE_VISUAL_SLOTS.has(slot.key) ? selectedSlotVisual(slot)?.path : undefined} disabled={busy} key={slot.key} onPreview={setMediaPreview} onSetConfirmed={SELECTABLE_VISUAL_SLOTS.has(slot.key) ? (file) => void handleSetWorkspaceVisualSelection(slot, file) : undefined} onTrash={(file) => void handleTrashFile(slot, file)} onUpload={(files) => void handleUpload(slot, files)} slot={slot} />)}</div></section> : null}
            </div>
          ) : (
            <div className={`shot-editor ${selectedAsset.isDraft ? "" : "is-workflow"}`}>
              {selectedAsset.isDraft && selectedShotMedia ? <PrimaryMedia file={selectedShotMedia} label={`${selectedAsset.design.shotId} ${displayShotTitle(selectedAsset)}`} onPreview={() => setMediaPreview(selectedShotMedia)} /> : null}
              {!selectedAsset.isDraft ? <ShotWorkflowStepper activeStep={activeShotWorkflowStep} disabled={busy} nodes={shotWorkflowNodes} onSelect={(step) => void selectShotWorkflowStep(step)} /> : null}
              <div className="workflow-step-panel">
              {selectedAsset.isDraft || activeShotWorkflowStep === "design" ? <section className="editor-card shot-design-editor"><div className="editor-card-heading"><div><p className="eyebrow">镜头设计</p><h3>{selectedAsset.isDraft ? "分镜草稿 · 尚未建立资产" : "镜头描述"}</h3></div>{selectedAsset.isDraft ? <button className="save-button primary" disabled={busy || !selectedAsset.sourcePath} onClick={handleCreateSelectedDraft} type="button">{busy ? "建立中…" : "建立镜头资产"}</button> : <div className="editor-card-heading-actions"><button aria-pressed={shotDesignMode === "edit"} className="editor-mode-button" onClick={() => setShotDesignMode((mode) => mode === "preview" ? "edit" : "preview")} type="button">{shotDesignMode === "preview" ? "修改" : "预览"}</button>{shotDesignMode === "edit" ? <button className="save-button" disabled={busy || !hasUnsavedShotDesign} onClick={() => void handleSave()} type="button">{busy ? "处理中…" : hasUnsavedShotDesign ? "保存" : "已保存"}</button> : null}</div>}</div>
                {selectedAsset.isDraft ? <DraftSummary design={designDraft} /> : shotDesignMode === "preview" ? <ShotDesignPreview design={designDraft} /> : <>
                  <div className="design-grid">
                    <TextField label="时码" onChange={(value) => setDesignDraft((draft) => ({ ...draft, timecode: value }))} value={designDraft.timecode} />
                    <TextField label="时长" onChange={(value) => setDesignDraft((draft) => ({ ...draft, duration: value }))} value={designDraft.duration} />
                    <TextField label="景别 / 机位" onChange={(value) => setDesignDraft((draft) => ({ ...draft, framing: value }))} value={designDraft.framing} />
                  </div>
                  <div className="design-long-fields">
                    <TextField label="画面描述" multiline onChange={(value) => setDesignDraft((draft) => ({ ...draft, content: value }))} value={designDraft.content} />
                    <TextField label="台词" multiline onChange={(value) => setDesignDraft((draft) => ({ ...draft, dialogue: value }))} value={designDraft.dialogue} />
                    <TextField label="运镜" onChange={(value) => setDesignDraft((draft) => ({ ...draft, camera: value }))} value={designDraft.camera} />
                    <TextField label="人物备注（兼容旧剧本）" onChange={(value) => setDesignDraft((draft) => ({ ...draft, references: value }))} placeholder="补充不能结构化的角色提示" value={designDraft.references} />
                  </div>
                  <section className="shot-character-plan">
                    <div className="section-heading"><div><p className="eyebrow">人物与造型</p><h3>本镜头引用</h3></div><button className="studio-action-button" disabled={busy || !characterAssets.length} onClick={addShotCharacterOverride} type="button">添加覆盖</button></div>
                    <p className="shot-character-plan-intro">默认继承本场的人物和造型；这里仅记录某个镜头的换装或局部状态例外。</p>
                    {inheritedSceneCastForSelectedShot.length ? <div className="shot-inherited-cast" aria-label="继承的场次人物与造型">{inheritedSceneCastForSelectedShot.map((binding) => {
                      const character = characterByPath.get(binding.characterPath);
                      const look = getLookForPath(character, binding.lookPath);
                      const preview = look?.confirmedVisuals.turnaround ?? look?.confirmedVisuals.costume ?? character?.confirmedVisuals.turnaround;
                      return <article className="shot-inherited-cast-card" key={`${binding.characterPath}-${binding.startShotId}-${binding.endShotId}`}>
                        {preview && isImage(preview) ? <button aria-label={`查看${character?.name || "人物"}当前造型`} className="shot-inherited-cast-image" onClick={() => setMediaPreview(preview)} type="button"><img alt={`${character?.name || "人物"}造型参考`} src={mediaUrl(preview)} /></button> : <span className="shot-inherited-cast-mark">人</span>}
                        <div><strong>{character?.name || displayFileName(binding.characterPath)}</strong><small>{displayLookLabel(character, binding.lookPath)} · {formatBindingRange(binding)}</small>{binding.state ? <em>{binding.state}</em> : null}</div>
                      </article>;
                    })}</div> : <div className="shot-inherited-empty">本场尚未设置默认人物与造型。可先回到场次资料完成绑定，或在这里添加一次性覆盖。</div>}
                    {(designDraft.characterOverrides ?? []).length ? <div className="shot-character-override-list">{(designDraft.characterOverrides ?? []).map((override, index) => {
                      const character = characterByPath.get(override.characterPath);
                      const hasInheritedBinding = inheritedSceneCastForSelectedShot.some((binding) => binding.characterPath === override.characterPath);
                      const appearanceOptions = [
                        ...(hasInheritedBinding ? [{ label: "继承场次默认造型", value: "__inherit__" }] : []),
                        { label: "使用身份基准", value: "__identity__" },
                        ...(character?.looks.map((look) => ({ label: `${look.id} · ${look.name}`, value: look.rootPath })) || []),
                      ];
                      const appearanceValue = override.mode === "inherit" ? "__inherit__" : override.mode === "identity" ? "__identity__" : override.lookPath || "__identity__";
                      return <article className="shot-character-override" key={`${override.characterPath}-${index}`}>
                        <div className="scene-cast-row-head"><strong>镜头覆盖 {String(index + 1).padStart(2, "0")}</strong><button aria-label={`移除第 ${index + 1} 条镜头人物覆盖`} className="asset-file-remove" disabled={busy} onClick={() => removeShotCharacterOverride(index)} type="button">×</button></div>
                        <div className="scene-cast-row-grid">
                          <SelectField ariaLabel={`选择第 ${index + 1} 条镜头覆盖人物`} label="人物" disabled={busy || !characterAssets.length} onChange={(characterPath) => updateShotCharacterOverride(index, { characterPath, mode: inheritedSceneCastForSelectedShot.some((binding) => binding.characterPath === characterPath) ? "inherit" : "identity", lookPath: undefined })} options={characterAssets.map((asset) => ({ label: `${asset.name} · ${asset.roleCategory}`, value: asset.rootPath }))} value={override.characterPath} />
                          <SelectField ariaLabel={`选择${character?.name || "人物"}在本镜头的造型`} label="本镜头造型" disabled={busy || !appearanceOptions.length} onChange={(value) => updateShotCharacterOverride(index, value === "__inherit__" ? { mode: "inherit", lookPath: undefined } : value === "__identity__" ? { mode: "identity", lookPath: undefined } : { mode: "look", lookPath: value })} options={appearanceOptions} value={appearanceValue} />
                          <TextField label="局部状态" onChange={(state) => updateShotCharacterOverride(index, { state })} placeholder="如：沾灰、眉心红线清晰" value={override.state} />
                        </div>
                      </article>;
                    })}</div> : null}
                    {effectiveCastForSelectedShot.length ? <div className="shot-effective-cast" aria-label="本镜头最终生效的人物与造型">
                      <div className="shot-effective-cast-heading"><strong>最终生效的人物与造型</strong><small>已合并场次默认与当前镜头覆盖；生成参考以这里为准。</small></div>
                      <div className="shot-inherited-cast">{effectiveCastForSelectedShot.map((entry) => {
                        const character = characterByPath.get(entry.characterPath);
                        const look = getLookForPath(character, entry.lookPath);
                        const preview = look?.confirmedVisuals.turnaround
                          ?? look?.confirmedVisuals.costume
                          ?? character?.confirmedVisuals.turnaround
                          ?? character?.confirmedVisuals.costume;
                        return <article className="shot-inherited-cast-card" key={`effective-${entry.characterPath}`}>
                          {preview && isImage(preview) ? <button aria-label={`查看${character?.name || "人物"}最终生效造型`} className="shot-inherited-cast-image" onClick={() => setMediaPreview(preview)} type="button"><img alt={`${character?.name || "人物"}最终生效造型`} src={mediaUrl(preview)} /></button> : <span className="shot-inherited-cast-mark">人</span>}
                          <div><strong>{character?.name || displayFileName(entry.characterPath)}</strong><small>{displayLookLabel(character, entry.lookPath)} · {entry.sourceLabel}</small>{entry.state ? <em>{entry.state}</em> : entry.continuity ? <em>{entry.continuity}</em> : null}</div>
                        </article>;
                      })}</div>
                    </div> : null}
                  </section>
                  <details className="generation-settings">
                    <summary><span>生成设置</span><small>提示词、负面提示词和状态</small></summary>
                    <div className="generation-settings-fields">
                      <TextField label="状态" onChange={(value) => setDesignDraft((draft) => ({ ...draft, status: value }))} value={designDraft.status} />
                      <TextField label="提示词" multiline onChange={(value) => setDesignDraft((draft) => ({ ...draft, prompt: value }))} value={designDraft.prompt} />
                      <TextField label="负面提示词" multiline onChange={(value) => setDesignDraft((draft) => ({ ...draft, negativePrompt: value }))} value={designDraft.negativePrompt} />
                    </div>
                  </details>
                  <p className="editor-hint">场次和镜号固定；如需改标题，请使用右上角“重命名”。</p>
                </>}
              </section> : null}
              {(selectedAsset.isDraft || activeShotWorkflowStep === "design") && selectedSourcePath ? <section className="source-context-card"><div className="source-context-heading"><div><p className="eyebrow">来源上下文</p><h3>{displayFileName(selectedSourcePath)}</h3><small title={selectedSourcePath}>原始分镜脚本</small></div><button className="source-context-toggle" disabled={sourceContext.loading} onClick={() => void toggleSourceContext()} type="button">{sourceContextOpen ? "收起原文" : sourceContext.error && sourceContext.path === selectedSourcePath ? "重新读取" : "查看原文"}</button></div>{sourceContextOpen ? <div className="source-context-body">{sourceContext.path !== selectedSourcePath || sourceContext.loading ? <p>正在读取原始剧本…</p> : sourceContext.error ? <p className="source-context-error">{sourceContext.error}</p> : <pre>{sourceContext.content || "原始剧本为空。"}</pre>}</div> : null}</section> : null}
              {!selectedAsset.isDraft && activeShotWorkflowStep === "design" ? <WorkflowStepFooter disabled={busy} label="保存并下一步" onClick={() => void advanceShotWorkflow()} /> : null}
              {!selectedAsset.isDraft && activeShotWorkflowStep === "reference" ? <section className="workflow-step-content">
                <div className="workflow-step-heading"><div><p className="eyebrow">02 / 05</p><h3>画面参考</h3></div><button className="studio-action-button generation-open-button" disabled={busy} onClick={() => void handleGenerateSceneImageFromShot()} type="button">生成场景图</button></div>
                <div className="workflow-reference-overview" aria-label="当前镜头继承资料">
                  <span className="workflow-reference-chip">{activeScene?.sceneId || selectedAsset.design.sceneId}</span>
                  {effectiveCastForSelectedShot.map((entry) => {
                    const character = characterByPath.get(entry.characterPath);
                    return <span className="workflow-reference-chip" key={`reference-character-${entry.characterPath}`}>{character?.name || displayFileName(entry.characterPath)}{entry.state ? ` · ${entry.state}` : ""}</span>;
                  })}
                  {inheritedLocationsForSelectedShot.map((entry, index) => <span className="workflow-reference-chip" key={`reference-location-${index}`}>{entry.label}{entry.detail ? ` · ${entry.detail}` : ""}</span>)}
                  {inheritedPropsForSelectedShot.map((entry, index) => <span className="workflow-reference-chip" key={`reference-prop-${index}`}>{entry.label}{entry.detail ? ` · ${entry.detail}` : ""}</span>)}
                </div>
                {selectedShotReferenceSlot ? <div className="workflow-slot"><SlotPanel
                  confirmedFile={selectedSlotVisual(selectedShotReferenceSlot)}
                  confirmedSourcePath={selectedSlotVisual(selectedShotReferenceSlot)?.path}
                  disabled={busy}
                  onPreview={setMediaPreview}
                  onSetConfirmed={(file) => void handleSetWorkspaceVisualSelection(selectedShotReferenceSlot, file)}
                  onTrash={(file) => void handleTrashFile(selectedShotReferenceSlot, file)}
                  onUpload={(files) => void handleUpload(selectedShotReferenceSlot, files)}
                  slot={selectedShotReferenceSlot}
                /></div> : null}
                <WorkflowStepFooter disabled={busy} label="下一步：首帧" onClick={() => void advanceShotWorkflow()} />
              </section> : null}
              {!selectedAsset.isDraft && activeShotWorkflowStep === "firstFrame" ? <section className="workflow-step-content">
                <div className="workflow-step-heading"><div><p className="eyebrow">03 / 05</p><h3>首帧</h3></div><button className="studio-action-button generation-open-button" disabled={busy || !hasSavedShotBrief} onClick={() => void openGeneration(hasShotReference ? "shot-first-frame-img2img-v1" : "shot-first-frame-v1")} type="button">生成首帧</button></div>
                {selectedShotFirstFrameSlot ? <div className="workflow-slot"><SlotPanel
                  confirmedFile={selectedSlotVisual(selectedShotFirstFrameSlot)}
                  confirmedSourcePath={selectedSlotVisual(selectedShotFirstFrameSlot)?.path}
                  disabled={busy}
                  onPreview={setMediaPreview}
                  onSetConfirmed={(file) => void handleSetWorkspaceVisualSelection(selectedShotFirstFrameSlot, file)}
                  onTrash={(file) => void handleTrashFile(selectedShotFirstFrameSlot, file)}
                  onUpload={(files) => void handleUpload(selectedShotFirstFrameSlot, files)}
                  slot={selectedShotFirstFrameSlot}
                /></div> : null}
                <WorkflowStepFooter disabled={busy} label="下一步：尾帧" onClick={() => void advanceShotWorkflow()} />
              </section> : null}
              {!selectedAsset.isDraft && activeShotWorkflowStep === "lastFrame" ? <section className="workflow-step-content">
                <div className="workflow-step-heading"><div><p className="eyebrow">04 / 05</p><h3>尾帧</h3></div><button className="studio-action-button generation-open-button" disabled={busy || !hasSelectedFirstFrame} onClick={() => void openGeneration("shot-last-frame-img2img-v1")} type="button">生成尾帧</button></div>
                <div className="workflow-frame-pair is-single"><WorkflowFramePreview file={selectedShotFirstFrame} label="已选首帧" onPreview={setMediaPreview} /></div>
                {selectedShotLastFrameSlot ? <div className="workflow-slot"><SlotPanel
                  confirmedFile={selectedSlotVisual(selectedShotLastFrameSlot)}
                  confirmedSourcePath={selectedSlotVisual(selectedShotLastFrameSlot)?.path}
                  disabled={busy}
                  onPreview={setMediaPreview}
                  onSetConfirmed={(file) => void handleSetWorkspaceVisualSelection(selectedShotLastFrameSlot, file)}
                  onTrash={(file) => void handleTrashFile(selectedShotLastFrameSlot, file)}
                  onUpload={(files) => void handleUpload(selectedShotLastFrameSlot, files)}
                  slot={selectedShotLastFrameSlot}
                /></div> : null}
                <WorkflowStepFooter disabled={busy} label="下一步：图生视频" onClick={() => void advanceShotWorkflow()} />
              </section> : null}
              {!selectedAsset.isDraft && activeShotWorkflowStep === "video" ? <section className="workflow-step-content">
                <div className="workflow-step-heading"><div><p className="eyebrow">05 / 05</p><h3>图生视频</h3></div></div>
                <div className="workflow-frame-pair"><WorkflowFramePreview file={selectedShotFirstFrame} label="首帧" onPreview={setMediaPreview} /><WorkflowFramePreview file={selectedShotLastFrame} label="尾帧" onPreview={setMediaPreview} /></div>
                <dl className="workflow-video-brief">
                  <div><dt>画面</dt><dd>{designDraft.content || designDraft.prompt || "未填写"}</dd></div>
                  <div><dt>运镜</dt><dd>{designDraft.camera || "未填写"}</dd></div>
                  <div><dt>时长</dt><dd>{designDraft.duration || "默认"}</dd></div>
                  {designDraft.dialogue ? <div><dt>台词</dt><dd>{designDraft.dialogue}</dd></div> : null}
                </dl>
                {selectedShotCandidateSlot && hasGeneratedShotVideo ? <div className="workflow-slot"><SlotPanel
                  confirmedFile={selectedSlotVisual(selectedShotCandidateSlot)}
                  confirmedSourcePath={selectedSlotVisual(selectedShotCandidateSlot)?.path}
                  disabled={busy}
                  onPreview={setMediaPreview}
                  onSetConfirmed={(file) => void handleSetWorkspaceVisualSelection(selectedShotCandidateSlot, file)}
                  onTrash={(file) => void handleTrashFile(selectedShotCandidateSlot, file)}
                  onUpload={(files) => void handleUpload(selectedShotCandidateSlot, files)}
                  slot={selectedShotCandidateSlot}
                /></div> : null}
                <WorkflowStepFooter disabled={busy} label={hasGeneratedShotVideo ? "再次生成图生视频" : "提交图生视频"} onClick={() => void advanceShotWorkflow()} />
              </section> : null}
              {selectedAsset.isDraft ? <section className="draft-asset-note"><p className="eyebrow">下一步</p><p>建立镜头资产后，可添加参考图、首帧、尾帧和候选资料。</p></section> : null}
              </div>
            </div>
          )}
        </section>
      </div>

      {mediaPreview ? <MediaLightbox file={mediaPreview} onClose={() => setMediaPreview(null)} /> : null}

      <ProjectStructureViewer
        error={projectStructureError}
        expandedPaths={expandedStructurePaths}
        hideTrigger={externalStructureTrigger}
        loading={projectStructureLoading}
        onRefresh={refreshProjectStructure}
        onTogglePath={toggleStructurePath}
        open={structureOpen}
        setOpen={setStructureOpen}
        structure={projectStructure}
      />

      {modal === "generation" && generationTarget ? <GenerationModal
        asset={generationTarget}
        initialDurationSeconds={generationDurationSeconds}
        initialPresetId={generationPresetId}
        lookPath={generationTarget.type === "character" && selectedAsset?.type === "character" ? selectedCharacterLook?.rootPath : undefined}
        projectId={projectId ?? undefined}
        onClose={() => { setModal(null); setGenerationTarget(null); setGenerationDurationSeconds(undefined); setGenerationPresetId(undefined); }}
        onJobsObserved={handleGenerationJobsObserved}
        onQueued={handleGenerationQueued}
      /> : modal === "trashList" ? <TrashModal
        busy={busy}
        entries={trashEntries}
        error={trashError}
        loading={trashLoading}
        onClose={() => setModal(null)}
        onRefresh={() => void loadTrashEntries()}
        onRestore={(entry) => void handleRestoreTrashEntry(entry)}
      /> : modal ? (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <section aria-labelledby="asset-modal-title" aria-modal="true" className="modal-card asset-modal" role="dialog">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">资产操作</p>
                <h2 id="asset-modal-title">{modal === "projectSettings" ? "项目设定" : modal === "character" ? "新建人物资产" : modal === "location" ? "新建地点/环境资产" : modal === "prop" ? "新建道具资产" : modal === "look" ? "新建人物造型" : modal === "scene" ? "新建场次资产" : modal === "shot" ? "新建镜头资产" : modal === "import" ? "导入剧本" : modal === "rename" ? "重命名资产" : "移入回收站"}</h2>
              </div>
              <button aria-label="关闭" className="icon-button" onClick={() => setModal(null)} type="button">×</button>
            </div>
            {modal === "projectSettings" ? <>
              <p className="modal-copy">维护当前项目的故事简介、制作规范和交付要求，内容会保存到项目根目录的“项目设定.md”。</p>
              <div className="editor-card project-settings-editor">
                <div className="editor-card-heading">
                  <div><p className="eyebrow">项目级文档</p><h3>项目设定.md</h3></div>
                  <button aria-pressed={projectSettingsMode === "edit"} className="editor-mode-button" onClick={() => setProjectSettingsMode((mode) => mode === "preview" ? "edit" : "preview")} type="button">{projectSettingsMode === "preview" ? "编辑" : "预览"}</button>
                </div>
                {projectSettingsMode === "preview"
                  ? <ProfilePreview content={projectSettingsDraft} />
                  : <textarea aria-label="项目设定" className="profile-textarea" onChange={(event) => { setProjectSettingsDraft(event.target.value); setProjectSettingsMode("edit"); }} placeholder="补充故事简介、世界观、画面风格、画幅和交付要求…" value={projectSettingsDraft} />}
              </div>
              <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)} type="button">取消</button><button className="submit-button" disabled={busy || !hasUnsavedProjectSettingsDraft} onClick={() => void handleSaveProjectSettings()} type="button">{busy ? "保存中…" : "保存项目设定"}</button></div>
            </> : modal === "character" ? <>
              <p className="modal-copy">建立后会自动准备角色设定、三视图、定妆和参考图资料槽。</p>
              <TextField label="人物名称" onChange={setNewName} placeholder="例如：顾霖" value={newName} />
              <p className="modal-field-hint">人物分类会从新建的“角色设定.md”中读取，建立后在文档里填写“角色分类”。</p>
              <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)} type="button">取消</button><button className="submit-button" disabled={busy || !newName.trim()} onClick={() => void handleCreateCharacter()} type="button">建立人物</button></div>
            </> : modal === "location" || modal === "prop" ? <>
              <p className="modal-copy">{modal === "location" ? "建立后会自动准备地点/环境设定、地点图、参考图、候选和定稿资料槽。" : "建立后会自动准备道具设定、参考图、候选和定稿资料槽。"}</p>
              <TextField label={modal === "location" ? "地点/环境名称" : "道具名称"} onChange={setNewSimpleAssetName} placeholder={modal === "location" ? "例如：废弃车站月台" : "例如：青铜短剑"} value={newSimpleAssetName} />
              <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)} type="button">取消</button><button className="submit-button" disabled={busy || !newSimpleAssetName.trim()} onClick={() => void handleCreateSimpleAsset(modal)} type="button">建立资产</button></div>
            </> : modal === "look" ? <>
              <p className="modal-copy">新造型会建立独立的三视图、定妆、参考图和“造型设定.md”。它不会复制或移动人物已有资料。</p>
              <TextField label="造型名称" onChange={setNewLookName} placeholder="例如：边关黑衣僧" value={newLookName} />
              <p className="modal-field-hint">系统会自动分配稳定编号，例如 LOOK-001；以后场次和镜头会引用这个造型，而不是复制图片。</p>
              <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)} type="button">取消</button><button className="submit-button" disabled={busy || !newLookName.trim()} onClick={() => void handleCreateCharacterLook()} type="button">建立造型</button></div>
            </> : modal === "scene" ? <>
              <p className="modal-copy">一个场次就是一个大分镜文件夹。建立后可先上传场景图、参考图、首尾帧、候选、定稿和整场成片。</p>
              <TextField label="场次编号" onChange={setNewSceneId} placeholder="例如：EP001-SC001" value={newSceneId} />
              <p className="modal-field-hint">场次编号是其下镜头的稳定身份；建立后不能在工作台内直接改名。</p>
              <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)} type="button">取消</button><button className="submit-button" disabled={busy || !newSceneId.trim()} onClick={() => void handleCreateScene()} type="button">建立场次</button></div>
            </> : modal === "shot" ? <>
              <p className="modal-copy">镜头会归入对应场次文件夹；如果该场次还不存在，系统会先安全建立它。</p>
              <div className="field-grid"><TextField label="场次" onChange={(sceneId) => {
                setNewSceneId(sceneId);
                setNewShotId(suggestNextShotId(sceneGroups.find((scene) => scene.sceneId === sceneId)?.shots || []));
              }} value={newSceneId} /><TextField label="镜号" onChange={setNewShotId} value={newShotId} /></div>
              <TextField label="镜头标题" onChange={setNewShotTitle} placeholder="例如：焦土尽头" value={newShotTitle} />
              <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)} type="button">取消</button><button className="submit-button" disabled={busy || !newSceneId.trim() || !newShotId.trim() || !newShotTitle.trim()} onClick={() => void handleCreateShot()} type="button">建立镜头</button></div>
            </> : modal === "import" ? <>
              <p className="modal-copy">从当前场次的分镜脚本建立镜头资产。导入会保留原始说明，并自动跳过已有镜号。</p>
              <div className="storyboard-import-layout">
                <div className="import-source-list" aria-label="剧本来源">
                  <p className="eyebrow">选择剧本</p>
                  {activeDraftGroups.map((group) => <button className={group.sourcePath === importSourcePath ? "is-active" : ""} key={group.sourcePath} onClick={() => chooseImportSource(group.sourcePath)} type="button"><span>{displayFileName(group.sourcePath)}</span><b>{group.shots.length} 镜头</b></button>)}
                </div>
                <div className="import-shot-list">
                  {selectedImportGroup ? <>
                    <div className="import-shot-list-heading"><div><p className="eyebrow">待建立镜头</p><h3>{displayFileName(selectedImportGroup.sourcePath)}</h3></div><label className="import-select-all"><input checked={selectedImportGroup.shots.length > 0 && selectedImportGroup.shots.every((shot) => importShotIds.includes(storyboardImportSelector(shot)))} onChange={toggleAllImportShots} type="checkbox" />全选</label></div>
                    <div className="import-shot-options">{selectedImportGroup.shots.map((shot) => { const selector = storyboardImportSelector(shot); return <label className="import-shot-option" key={selector}><input checked={importShotIds.includes(selector)} onChange={() => toggleImportShot(selector)} type="checkbox" /><span className="import-shot-id">{shot.design.shotId}</span><span className="import-shot-title">{displayShotTitle(shot)}</span><small>{shot.design.timecode || "未设时码"} · {shot.design.duration || "未设时长"}</small></label>; })}</div>
                  </> : <p className="import-empty">没有可导入的剧本草稿。</p>}
                </div>
              </div>
              <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)} type="button">取消</button><button className="submit-button" disabled={busy || !importSourcePath || !importShotIds.length} onClick={() => { if (importSourcePath) void handleImportStoryboard(importSourcePath, importShotIds); }} type="button">建立 {importShotIds.length} 个镜头</button></div>
            </> : modal === "rename" ? <>
              <p className="modal-copy">只改变当前资产名称，不会改变它所属的创作对象类型。</p>
              <TextField label="新名称" onChange={setRenameValue} value={renameValue} />
              <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)} type="button">取消</button><button className="submit-button" disabled={busy || !renameValue.trim()} onClick={() => void handleRename()} type="button">确认重命名</button></div>
            </> : <>
              <div className="trash-warning"><span>!</span><p><b>确认移入回收站？</b><br />整个资产会被移动到本地回收站，之后仍可恢复。</p></div>
              <div className="modal-actions"><button className="text-button" onClick={() => setModal(null)} type="button">取消</button><button className="submit-button destructive" disabled={busy} onClick={() => void handleTrashAsset()} type="button">移入回收站</button></div>
            </>}
          </section>
        </div>
      ) : null}
    </main>
  );
}
