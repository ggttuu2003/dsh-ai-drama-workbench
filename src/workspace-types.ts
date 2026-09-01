export type AssetKind = "folder" | "markdown" | "image" | "video" | "document" | "other";

export type WorkspaceAssetType = "character" | "location" | "prop" | "scene" | "shot";

export type AssetFileKind = Exclude<AssetKind, "folder">;

export const CHARACTER_VISUAL_SLOT_KEYS = ["turnaround", "costume", "reference"] as const;

export type CharacterVisualSlotKey = (typeof CHARACTER_VISUAL_SLOT_KEYS)[number];

export const CHARACTER_ROLE_CATEGORIES = [
  "待分类",
  "主角",
  "女主",
  "重要配角",
  "配角",
  "反派",
  "群像",
  "其他",
] as const;

export type CharacterRoleCategory = (typeof CHARACTER_ROLE_CATEGORIES)[number];

export interface AssetFile {
  name: string;
  path: string;
  kind: AssetFileKind;
  size: number;
  updatedAt: string;
  /** The project ID that owns this media response; used to pin preview URLs. */
  projectId?: string;
}

export interface AssetSlot {
  key: string;
  label: string;
  files: AssetFile[];
}

export interface CharacterAsset {
  type: "character";
  rootPath: string;
  name: string;
  roleCategory: CharacterRoleCategory;
  profilePath?: string;
  profileContent?: string;
  /** SHA-256 revision of the raw profile Markdown used to reject stale saves. */
  profileRevision: string;
  slots: AssetSlot[];
  /** The selected candidate in each visual slot, persisted by the `-已选` filename suffix. */
  confirmedVisuals: Partial<Record<CharacterVisualSlotKey, AssetFile>>;
  confirmedVisualSourcePaths: Partial<Record<CharacterVisualSlotKey, string>>;
  // Kept while callers move to the slot-keyed selection model.
  confirmedTurnaround?: AssetFile;
  confirmedTurnaroundSourcePath?: string;
  /**
   * Reusable costume / appearance variants. The character root remains the
   * identity baseline so existing projects do not need a destructive migration.
   */
  looks: CharacterLook[];
  cover?: AssetFile;
  updatedAt: string;
}

/** A reusable character costume and appearance package stored under `造型/`. */
export interface CharacterLook {
  rootPath: string;
  characterRootPath: string;
  /** Stable directory prefix, for example `LOOK-001`. */
  id: string;
  name: string;
  documentPath?: string;
  documentContent?: string;
  /** SHA-256 revision of `造型设定.md` used to reject stale saves. */
  documentRevision: string;
  slots: AssetSlot[];
  confirmedVisuals: Partial<Record<CharacterVisualSlotKey, AssetFile>>;
  confirmedVisualSourcePaths: Partial<Record<CharacterVisualSlotKey, string>>;
  cover?: AssetFile;
  updatedAt: string;
}

/** The default character appearance used by a scene. Blank bounds mean the whole scene. */
export interface SceneCastBinding {
  characterPath: string;
  /** Omit this field to use the character's identity baseline. */
  lookPath?: string;
  state: string;
  continuity: string;
  startShotId: string;
  endShotId: string;
}

/** A reusable location referenced by a scene, optionally limited to a shot range. */
export interface SceneLocationBinding {
  locationPath: string;
  role: string;
  state: string;
  continuity: string;
  startShotId: string;
  endShotId: string;
}

/** A reusable prop referenced by a scene, optionally limited to a shot range. */
export interface ScenePropBinding {
  propPath: string;
  role: string;
  state: string;
  continuity: string;
  startShotId: string;
  endShotId: string;
}

export type ShotCharacterOverrideMode = "inherit" | "identity" | "look";

/** A shot-specific exception to the scene-level character and costume plan. */
export interface ShotCharacterOverride {
  characterPath: string;
  mode: ShotCharacterOverrideMode;
  /** Required only when `mode` is `look`. */
  lookPath?: string;
  state: string;
}

/** A scene is the production-level "large storyboard" folder above its shots. */
export interface SceneAsset {
  type: "scene";
  rootPath: string;
  sceneId: string;
  scenePath?: string;
  sceneContent?: string;
  /** SHA-256 revision of the scene Markdown used to reject stale saves. */
  sceneRevision: string;
  /** Human-readable cast sheet with machine-readable bindings. */
  castPath?: string;
  castRevision: string;
  castBindings: SceneCastBinding[];
  /** Human-readable scene asset sheet with structured location/prop bindings. */
  assetBindingsPath?: string;
  assetBindingsRevision: string;
  locationBindings: SceneLocationBinding[];
  propBindings: ScenePropBinding[];
  sourcePath?: string;
  slots: AssetSlot[];
  cover?: AssetFile;
  updatedAt: string;
  shotCount: number;
  /** Legacy scene folders can be read before the user explicitly completes their scene asset setup. */
  isComplete: boolean;
}

export interface LocationAsset {
  type: "location";
  rootPath: string;
  name: string;
  profilePath?: string;
  profileContent?: string;
  profileRevision: string;
  slots: AssetSlot[];
  confirmedVisuals: Record<string, AssetFile | undefined>;
  cover?: AssetFile;
  updatedAt: string;
}

export interface PropAsset {
  type: "prop";
  rootPath: string;
  name: string;
  profilePath?: string;
  profileContent?: string;
  profileRevision: string;
  slots: AssetSlot[];
  confirmedVisuals: Record<string, AssetFile | undefined>;
  cover?: AssetFile;
  updatedAt: string;
}

export interface ShotDesign {
  sceneId: string;
  shotId: string;
  title: string;
  timecode: string;
  duration: string;
  framing: string;
  content: string;
  dialogue: string;
  camera: string;
  prompt: string;
  negativePrompt: string;
  references: string;
  /** Structured role/costume overrides. Older Markdown files simply omit this. */
  characterOverrides?: ShotCharacterOverride[];
  status: string;
}

export interface ShotAsset {
  type: "shot";
  rootPath?: string;
  designPath?: string;
  /** SHA-256 revision of the raw shot Markdown; drafts have no editable asset file yet. */
  designRevision?: string;
  sourcePath?: string;
  design: ShotDesign;
  slots: AssetSlot[];
  cover?: AssetFile;
  updatedAt: string;
  isDraft: boolean;
}

export interface StoryboardImportCreated {
  shotId: string;
  path: string;
}

export interface StoryboardImportIssue {
  shotId: string;
  reason: string;
}

export interface StoryboardImportError {
  shotId: string;
  error: string;
}

export interface StoryboardImportResult {
  sourcePath: string;
  created: StoryboardImportCreated[];
  skipped: StoryboardImportIssue[];
  errors: StoryboardImportError[];
  warnings: string[];
}

export interface AssetWorkspaceSnapshot {
  rootName: string;
  /** Present on HTTP snapshots; omitted by the core scanner for compatibility. */
  projectId?: string;
  projectSettings: ProjectSettings;
  characters: CharacterAsset[];
  locations: LocationAsset[];
  props: PropAsset[];
  scenes: SceneAsset[];
  shots: ShotAsset[];
  /** Optional structured relations loaded from .workbench/index.json. */
  projectIndex?: ProjectAssetIndex;
  updatedAt: string;
}

export interface ProjectAssetIndexChapter {
  id: string;
  title: string;
  sourcePath?: string;
  characterPaths: string[];
  locationPaths: string[];
  propPaths: string[];
  scenePaths: string[];
  status?: string;
}

/** Rebuildable JSON metadata; Markdown files remain the source of asset content. */
export interface ProjectAssetIndex {
  schemaVersion: 1;
  projectName: string;
  generatedAt: string;
  chapters: ProjectAssetIndexChapter[];
}

export interface ProjectSettings {
  path: string;
  content: string;
  /** SHA-256 revision used to reject stale saves. */
  revision: string;
}

/** A project is a real direct child of the configured, trusted asset library. */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  /** Whether the project's standard root files and asset folders exist. */
  initialized: boolean;
}

/** Safe project selector data: deliberately contains no local absolute paths. */
export interface ProjectRegistrySnapshot {
  libraryLabel: string;
  activeProjectId: string;
  projects: ProjectSummary[];
}

// `/api/project` keeps its original endpoint while returning the asset-centric model.
export type ProjectSnapshot = AssetWorkspaceSnapshot;

// These legacy types remain exported while the old generic file API is phased out.
export interface TreeNode {
  name: string;
  path: string;
  kind: AssetKind;
  size?: number;
  updatedAt: string;
  children?: TreeNode[];
  isSymlink?: boolean;
}

export interface ProjectStructureSnapshot {
  rootName: string;
  tree: TreeNode[];
  updatedAt: string;
}

/** A recoverable item stored under the project's private workbench trash. */
export interface TrashEntry {
  /** Opaque entry ID; it is not a filesystem path. */
  id: string;
  name: string;
  /** The visible project-relative destination used when restoring the item. */
  originalPath?: string;
  trashedAt: string;
  kind: AssetKind;
  isDirectory: boolean;
  size?: number;
  /** Older entries made before restore metadata existed remain visible but cannot be restored automatically. */
  recoverable: boolean;
}

export interface AssetSummary {
  name: string;
  path: string;
  kind: Exclude<AssetKind, "folder">;
  size: number;
  updatedAt: string;
}

export interface StoryboardShot {
  id: string;
  timecode: string;
  duration: string;
  framing: string;
  content: string;
  dialogue: string;
}

export interface TextAsset {
  path: string;
  content: string;
  updatedAt: string;
}
