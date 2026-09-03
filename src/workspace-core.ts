import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import { CHARACTER_VISUAL_SLOT_KEYS } from "./workspace-types";
import type {
  AssetFile,
  AssetKind,
  AssetSlot,
  AssetWorkspaceSnapshot,
  ProjectAssetIndex,
  CharacterAsset,
  CharacterLook,
  CharacterRoleCategory,
  CharacterVisualSlotKey,
  LocationAsset,
  PropAsset,
  ProjectStructureSnapshot,
  ProjectSnapshot,
  ProjectSettings,
  SceneCastBinding,
  SceneLocationBinding,
  ScenePropBinding,
  SceneAsset,
  ShotAsset,
  ShotCharacterOverride,
  ShotDesign,
  StoryboardImportResult,
  TextAsset,
  TrashEntry,
  TreeNode,
  WorkspaceAssetType,
} from "./workspace-types";

const DEFAULT_LIBRARY_ROOT = path.resolve(
  process.cwd(),
  "../ai-play-test",
);
const DEFAULT_PROJECT_ID = "my-first-01";
const HIDDEN_DIRECTORIES = new Set([".git", "node_modules", ".next", ".workbench"]);
const PROJECT_INDEX_PATH = ".workbench/index.json";
const PROJECT_JSON_PATH = ".workbench/project.json";
const MAX_PROJECT_JSON_BYTES = 20 * 1024 * 1024;
const MAX_PROJECT_INDEX_BYTES = 1024 * 1024;
const MAX_TEXT_ASSET_BYTES = 2_000_000;
// A selected visual candidate stays in its slot folder so the disk layout is the source of truth.
const SELECTED_VISUAL_SUFFIX = "-已选";
const TRASH_METADATA_FILE = ".workbench-trash.json";
const TRASH_ENTRY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CHARACTER_LOOK_DIRECTORY = "造型";
const CHARACTER_LOOK_DOCUMENT = "造型设定.md";
const SCENE_CAST_DOCUMENT = "出场与造型表.md";
const SCENE_CAST_MARKER_START = "<!-- workbench:scene-cast:start -->";
const SCENE_CAST_MARKER_END = "<!-- workbench:scene-cast:end -->";
const SCENE_CAST_PROJECTION_MARKER_START = "<!-- workbench:scene-cast:projection:start -->";
const SCENE_CAST_PROJECTION_MARKER_END = "<!-- workbench:scene-cast:projection:end -->";
const SCENE_ASSET_BINDINGS_DOCUMENT = "场次资产表.md";
const SCENE_ASSET_BINDINGS_MARKER_START = "<!-- workbench:scene-assets:start -->";
const SCENE_ASSET_BINDINGS_MARKER_END = "<!-- workbench:scene-assets:end -->";
const SCENE_ASSET_BINDINGS_PROJECTION_MARKER_START = "<!-- workbench:scene-assets:projection:start -->";
const SCENE_ASSET_BINDINGS_PROJECTION_MARKER_END = "<!-- workbench:scene-assets:projection:end -->";
const SHOT_CHARACTER_OVERRIDES_MARKER_START = "<!-- workbench:shot-character-overrides:start -->";
const SHOT_CHARACTER_OVERRIDES_MARKER_END = "<!-- workbench:shot-character-overrides:end -->";
const DEFAULT_CHARACTER_ROLE_CATEGORY: CharacterRoleCategory = "待分类";
const CHARACTER_ROLE_SORT_ORDER: readonly CharacterRoleCategory[] = [
  "主角",
  "女主",
  "重要配角",
  "配角",
  "反派",
  "群像",
  "其他",
  "待分类",
];

const CHARACTER_SLOT_DEFINITIONS = [
  { key: "turnaround", label: "三视图", directory: "三视图" },
  { key: "costume", label: "定妆", directory: "定妆" },
  { key: "reference", label: "参考图", directory: "参考图" },
] as const;

const SHOT_SLOT_DEFINITIONS = [
  { key: "reference", label: "参考图", directory: "参考图" },
  { key: "firstFrame", label: "首帧", directory: "首帧" },
  { key: "lastFrame", label: "尾帧", directory: "尾帧" },
  { key: "candidate", label: "候选", directory: "候选" },
  { key: "final", label: "定稿", directory: "定稿" },
  { key: "video", label: "成片", directory: "成片" },
] as const;

// A scene is the large storyboard container above individual shot folders.
const SCENE_SLOT_DEFINITIONS = [
  { key: "setting", label: "场景图", directory: "场景图" },
  { key: "reference", label: "参考图", directory: "参考图" },
  { key: "firstFrame", label: "首帧", directory: "首帧" },
  { key: "lastFrame", label: "尾帧", directory: "尾帧" },
  { key: "candidate", label: "候选", directory: "候选" },
  { key: "final", label: "定稿", directory: "定稿" },
  { key: "video", label: "成片", directory: "成片" },
] as const;

const LOCATION_SLOT_DEFINITIONS = [
  { key: "setting", label: "场景图", directory: "场景图" },
  { key: "reference", label: "参考图", directory: "参考图" },
  { key: "candidate", label: "候选", directory: "候选" },
  { key: "final", label: "定稿", directory: "定稿" },
] as const;

const PROP_SLOT_DEFINITIONS = [
  { key: "reference", label: "参考图", directory: "参考图" },
  { key: "candidate", label: "候选", directory: "候选" },
  { key: "final", label: "定稿", directory: "定稿" },
] as const;

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const videoExtensions = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const documentExtensions = new Set([".json", ".yaml", ".yml", ".txt", ".csv"]);

export class ProjectPathError extends Error {}

export class ProjectConflictError extends ProjectPathError {}

export class ProjectPayloadTooLargeError extends ProjectPathError {}

// Harness serves multiple browser requests through one Node process. Keep the
// active project in async-local state so concurrent workspaces cannot leak into
// each other through process-wide environment variables.
const projectRootContext = new AsyncLocalStorage<string>();

export function withProjectRoot<T>(root: string, operation: () => Promise<T>): Promise<T> {
  return projectRootContext.run(root, operation);
}

function getActiveProjectId(): string {
  const projectId = (process.env.WORKBENCH_ACTIVE_PROJECT || DEFAULT_PROJECT_ID).trim();
  if (
    !projectId
    || projectId.startsWith(".")
    || projectId !== path.basename(projectId)
    || /[\\/\\\\\u0000-\u001f]/.test(projectId)
  ) {
    throw new ProjectPathError("The active project name must be a single folder name.");
  }
  return projectId;
}

export async function getProjectRoot(): Promise<string> {
  const contextualRoot = projectRootContext.getStore();
  if (contextualRoot) return contextualRoot;

  // WORKBENCH_PROJECT_ROOT remains a direct-project override for existing setups.
  const directProjectRoot = process.env.WORKBENCH_PROJECT_ROOT;
  try {
    if (directProjectRoot) {
      const root = await fs.realpath(/* turbopackIgnore: true */ directProjectRoot);
      if (!(await fs.stat(root)).isDirectory()) {
        throw new ProjectPathError("The configured project root must be a directory.");
      }
      return root;
    }

    const libraryRoot = await fs.realpath(
      /* turbopackIgnore: true */ process.env.WORKBENCH_LIBRARY_ROOT || DEFAULT_LIBRARY_ROOT,
    );
    if (!(await fs.stat(libraryRoot)).isDirectory()) {
      throw new ProjectPathError("The configured asset library must be a directory.");
    }
    const candidate = path.resolve(libraryRoot, getActiveProjectId());
    assertInsideRoot(libraryRoot, candidate);
    const root = await fs.realpath(/* turbopackIgnore: true */ candidate);
    assertInsideRoot(libraryRoot, root);
    if (!(await fs.stat(root)).isDirectory()) {
      throw new ProjectPathError("The configured project root must be a directory.");
    }
    return root;
  } catch (error) {
    if (error instanceof ProjectPathError) throw error;
    throw new ProjectPathError("The configured project directory is unavailable.");
  }
}

export function getAssetKind(fileName: string, isDirectory = false): AssetKind {
  if (isDirectory) return "folder";
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".md" || extension === ".mdx") return "markdown";
  if (imageExtensions.has(extension)) return "image";
  if (videoExtensions.has(extension)) return "video";
  if (documentExtensions.has(extension)) return "document";
  return "other";
}

function normalizeRelativePath(relativePath: string | null | undefined): string {
  const candidate = relativePath?.trim() || "";
  if (candidate.includes("\u0000") || candidate.includes("\\")) {
    throw new ProjectPathError("Use forward-slash project-relative paths only.");
  }
  if (path.isAbsolute(candidate)) {
    throw new ProjectPathError("Absolute paths are not allowed.");
  }

  const normalized = path.normalize(candidate).replace(/^([/\\])+/, "");
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new ProjectPathError("Paths outside the project are not allowed.");
  }
  return normalized === "." ? "" : normalized;
}

function assertVisibleProjectPath(relativePath: string, allowRoot = false): string {
  const normalized = normalizeRelativePath(relativePath);
  if (!allowRoot && !normalized) {
    throw new ProjectPathError("The project root cannot be changed from the workbench.");
  }
  if (normalized.split(path.sep).some((segment) => segment.startsWith("."))) {
    throw new ProjectPathError("Hidden and workbench-internal paths are not available here.");
  }
  return normalized;
}

function assertInsideRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ProjectPathError("The requested path escapes the project root.");
  }
}

export async function resolveExistingPath(relativePath: string): Promise<string> {
  const root = await getProjectRoot();
  const candidate = path.resolve(root, assertVisibleProjectPath(relativePath));
  assertInsideRoot(root, candidate);
  const actualPath = await fs.realpath(/* turbopackIgnore: true */ candidate);
  assertInsideRoot(root, actualPath);
  if (actualPath !== candidate) {
    throw new ProjectPathError("Paths containing symbolic links are not available from the workbench.");
  }
  assertVisibleProjectPath(makeRelative(root, actualPath));
  return actualPath;
}

async function resolveMutableExistingPath(relativePath: string): Promise<string> {
  const root = await getProjectRoot();
  const candidate = path.resolve(root, assertVisibleProjectPath(relativePath));
  assertInsideRoot(root, candidate);

  const entry = await fs.lstat(candidate);
  if (entry.isSymbolicLink()) {
    throw new ProjectPathError("Symbolic links cannot be changed from the workbench.");
  }

  const actualPath = await fs.realpath(/* turbopackIgnore: true */ candidate);
  assertInsideRoot(root, actualPath);
  if (actualPath !== candidate) {
    throw new ProjectPathError("Paths containing symbolic links cannot be changed from the workbench.");
  }
  return candidate;
}

export async function resolveWritablePath(relativePath: string): Promise<string> {
  const root = await getProjectRoot();
  const candidate = path.resolve(root, normalizeRelativePath(relativePath));
  assertInsideRoot(root, candidate);

  // Resolve the nearest existing parent to prevent writes through a symlink outside the root.
  let parent = path.dirname(candidate);
  while (parent !== root) {
    try {
      const actualParent = await fs.realpath(parent);
      assertInsideRoot(root, actualParent);
      if (actualParent !== parent) {
        throw new ProjectPathError("Paths containing symbolic links cannot be changed from the workbench.");
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      parent = path.dirname(parent);
    }
  }
  const actualRoot = await fs.realpath(/* turbopackIgnore: true */ root);
  assertInsideRoot(actualRoot, candidate);
  return candidate;
}

function makeRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function createTextRevision(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("base64url");
}

function validateExpectedRevision(value: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ProjectPathError("Refresh this asset before saving it.");
  }
  return value;
}

function assertCurrentTextRevision(expectedRevision: string, currentContent: string): void {
  if (validateExpectedRevision(expectedRevision) !== createTextRevision(currentContent)) {
    throw new ProjectConflictError("This document changed outside the current editor. Reload the latest version before saving.");
  }
}

interface IndexedEntry {
  absolutePath: string;
  relativePath: string;
  name: string;
  stats: Stats;
}

interface ProjectIndex {
  directories: IndexedEntry[];
  files: IndexedEntry[];
  filesByDirectory: Map<string, IndexedEntry[]>;
}

interface SlotDefinition {
  readonly key: string;
  readonly label: string;
  readonly directory: string;
}

interface ShotDetail {
  title: string;
  fields: Map<string, string>;
  rawContent: string;
}

interface ShotSource {
  sourcePath: string;
  sourceShotId: string;
  rawDetail: string;
}

interface ParsedStoryboardDraft {
  asset: ShotAsset;
  source: ShotSource;
  warnings: string[];
}

async function scanVisibleProject(root: string): Promise<ProjectIndex> {
  const directories: IndexedEntry[] = [];
  const files: IndexedEntry[] = [];

  async function visit(absoluteDirectory: string): Promise<void> {
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));

    for (const entry of entries) {
      if (entry.name.startsWith(".") || HIDDEN_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const stats: Stats = await fs.lstat(absolutePath);
      // Assets never follow links, even when a link happens to point back inside the library.
      if (stats.isSymbolicLink()) continue;

      const indexedEntry: IndexedEntry = {
        absolutePath,
        relativePath: makeRelative(root, absolutePath),
        name: entry.name,
        stats,
      };
      if (stats.isDirectory()) {
        directories.push(indexedEntry);
        await visit(absolutePath);
      } else if (stats.isFile()) {
        files.push(indexedEntry);
      }
    }
  }

  await visit(root);
  const filesByDirectory = new Map<string, IndexedEntry[]>();
  for (const file of files) {
    const directory = path.dirname(file.absolutePath);
    const siblings = filesByDirectory.get(directory) ?? [];
    siblings.push(file);
    filesByDirectory.set(directory, siblings);
  }
  for (const siblings of filesByDirectory.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  }
  return { directories, files, filesByDirectory };
}

function toAssetFile(entry: IndexedEntry): AssetFile {
  return {
    name: entry.name,
    path: entry.relativePath,
    kind: getAssetKind(entry.name) as AssetFile["kind"],
    size: entry.stats.size,
    updatedAt: entry.stats.mtime.toISOString(),
  };
}

const CHARACTER_ROLE_ALIASES: readonly [string, CharacterRoleCategory][] = [
  ["重要配角", "重要配角"],
  ["女主角", "女主"],
  ["男主角", "主角"],
  ["女配角", "配角"],
  ["男配角", "配角"],
  ["男主", "主角"],
  ["女配", "配角"],
  ["男配", "配角"],
  ["待分类", "待分类"],
  ["主角", "主角"],
  ["女主", "女主"],
  ["配角", "配角"],
  ["反派", "反派"],
  ["群像", "群像"],
  ["其他", "其他"],
];

function parseRoleCategoryValue(value: string): CharacterRoleCategory | undefined {
  const normalized = value
    .replace(/[>*_`#：:；;。！？!?（）()\[\]"'“”‘’/、,，|丨]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return undefined;
  for (const [alias, category] of CHARACTER_ROLE_ALIASES) {
    if (normalized === alias || normalized.startsWith(`${alias} `)) return category;
  }
  return undefined;
}

function isCharacterVisualSlotKey(value: string): value is CharacterVisualSlotKey {
  return (CHARACTER_VISUAL_SLOT_KEYS as readonly string[]).includes(value);
}

function isSelectedVisualFileName(fileName: string): boolean {
  return getAssetKind(fileName) === "image"
    && path.basename(fileName, path.extname(fileName)).endsWith(SELECTED_VISUAL_SUFFIX);
}

function makeSelectedVisualFileName(fileName: string): string {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  return `${stem}${SELECTED_VISUAL_SUFFIX}${extension}`;
}

function makeUnselectedVisualFileName(fileName: string): string {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  if (!stem.endsWith(SELECTED_VISUAL_SUFFIX)) {
    throw new ProjectPathError("The selected visual filename is invalid.");
  }
  return `${stem.slice(0, -SELECTED_VISUAL_SUFFIX.length)}${extension}`;
}

function normalizeUploadedCandidateFileName(fileName: string): string {
  // `-已选` is persistent approval state, not a filename a newly uploaded
  // candidate may grant itself. Selection is performed explicitly afterwards.
  return isSelectedVisualFileName(fileName) ? makeUnselectedVisualFileName(fileName) : fileName;
}

function findConfirmedVisual(visualFiles: readonly AssetFile[]): AssetFile | undefined {
  const candidates = visualFiles
    .filter((file) => file.kind === "image" && isSelectedVisualFileName(file.name))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return candidates[0];
}

function createEmptySlots(definitions: readonly SlotDefinition[]): AssetSlot[] {
  return definitions.map(({ key, label }) => ({ key, label, files: [] }));
}

function readAssetSlots(
  assetDirectory: string,
  definitions: readonly SlotDefinition[],
  filesByDirectory: Map<string, IndexedEntry[]>,
): AssetSlot[] {
  return definitions.map(({ key, label, directory }) => ({
    key,
    label,
    files: (filesByDirectory.get(path.join(assetDirectory, directory)) ?? []).map(toAssetFile),
  }));
}

function pickCover(slots: AssetSlot[], priority: readonly string[]): AssetFile | undefined {
  for (const slotKey of priority) {
    const image = slots.find((slot) => slot.key === slotKey)?.files.find((file) => file.kind === "image");
    if (image) return image;
  }
  return undefined;
}

function latestUpdatedAt(fallback: IndexedEntry, entries: readonly IndexedEntry[]): string {
  const timestamp = entries.reduce(
    (latest, entry) => Math.max(latest, entry.stats.mtimeMs),
    fallback.stats.mtimeMs,
  );
  return new Date(timestamp).toISOString();
}

function getConfirmedVisualMetadata(slots: AssetSlot[]): {
  confirmedVisuals: Partial<Record<CharacterVisualSlotKey, AssetFile>>;
  confirmedVisualSourcePaths: Partial<Record<CharacterVisualSlotKey, string>>;
} {
  const confirmedVisuals: Partial<Record<CharacterVisualSlotKey, AssetFile>> = {};
  const confirmedVisualSourcePaths: Partial<Record<CharacterVisualSlotKey, string>> = {};
  for (const slotKey of CHARACTER_VISUAL_SLOT_KEYS) {
    const confirmedVisual = findConfirmedVisual(
      slots.find((slot) => slot.key === slotKey)?.files ?? [],
    );
    if (!confirmedVisual) continue;
    confirmedVisuals[slotKey] = confirmedVisual;
    confirmedVisualSourcePaths[slotKey] = confirmedVisual.path;
  }
  return { confirmedVisuals, confirmedVisualSourcePaths };
}

function parseCharacterLookDirectoryName(directoryName: string): { id: string; name: string } {
  const match = directoryName.match(/^((?:[A-Za-z0-9]+-)?LOOK-\d{1,6})(?:[-_\s]+(.+))?$/iu);
  if (match) {
    return {
      id: match[1].toLocaleUpperCase("en-US"),
      name: match[2]?.trim() || match[1].toLocaleUpperCase("en-US"),
    };
  }
  // A manually created folder remains usable. New looks always use the stable LOOK-xxx prefix.
  return { id: directoryName, name: directoryName };
}

async function buildCharacterLooks(
  characterDirectory: IndexedEntry,
  index: ProjectIndex,
): Promise<CharacterLook[]> {
  const lookRoot = path.join(characterDirectory.absolutePath, CHARACTER_LOOK_DIRECTORY);
  const lookDirectories = index.directories.filter((directory) => path.dirname(directory.absolutePath) === lookRoot);

  const looks = await Promise.all(lookDirectories.map(async (directory) => {
    const document = (index.filesByDirectory.get(directory.absolutePath) ?? [])
      .find((file) => file.name === CHARACTER_LOOK_DOCUMENT);
    const documentContent = document ? await readIndexedText(document) : "";
    const slots = readAssetSlots(directory.absolutePath, CHARACTER_SLOT_DEFINITIONS, index.filesByDirectory);
    const { confirmedVisuals, confirmedVisualSourcePaths } = getConfirmedVisualMetadata(slots);
    const slotFiles = slots.flatMap((slot) => slot.files.map((file) =>
      index.files.find((entry) => entry.relativePath === file.path),
    )).filter((entry): entry is IndexedEntry => Boolean(entry));
    const parsedName = parseCharacterLookDirectoryName(directory.name);

    return {
      rootPath: directory.relativePath,
      characterRootPath: characterDirectory.relativePath,
      id: parsedName.id,
      name: parsedName.name,
      ...(document ? { documentPath: document.relativePath, documentContent } : {}),
      documentRevision: createTextRevision(documentContent),
      slots,
      confirmedVisuals,
      confirmedVisualSourcePaths,
      cover: confirmedVisuals.turnaround
        ?? confirmedVisuals.costume
        ?? confirmedVisuals.reference
        ?? pickCover(slots, ["turnaround", "costume", "reference"]),
      updatedAt: latestUpdatedAt(directory, [...(document ? [document] : []), ...slotFiles]),
    } satisfies CharacterLook;
  }));

  return looks.sort((left, right) => left.id.localeCompare(right.id, "zh-Hans-CN", { numeric: true })
    || left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function normalizeShotId(value: string): string | null {
  const match = value.trim().match(/^(?:SH)?(\d{1,6})$/i);
  return match ? `SH${match[1].padStart(3, "0")}` : null;
}

function findSceneId(value: string): string | undefined {
  // Accept the common EP001-SC001, EP001_SC001, and SC001 forms without
  // changing the stored spelling of unrelated non-standard scene names.
  const match = value.match(/(?:EP\s*\d+\s*[-_]\s*)?SC\s*\d+/iu);
  return match?.[0]
    .replace(/\s+/gu, "")
    .replaceAll("_", "-")
    .toLocaleUpperCase("en-US");
}

function extractSceneId(fileName: string, markdown: string): string {
  const headingSceneId = [...markdown.matchAll(/^#{1,6}\s+(.+?)\s*$/gmu)]
    .map((heading) => findSceneId(heading[1]))
    .find((sceneId): sceneId is string => Boolean(sceneId));
  if (headingSceneId) return headingSceneId;

  const candidate = path.basename(fileName, path.extname(fileName));
  const fileNameSceneId = findSceneId(candidate);
  if (fileNameSceneId) return fileNameSceneId;
  return candidate.replace(/[-_]?分镜.*$/u, "").trim() || "未归档场次";
}

interface StoryboardSceneSection {
  sceneId: string;
  markdown: string;
  hasMultipleScenes: boolean;
}

interface StoryboardSceneHeading {
  sceneId: string;
  start: number;
}

function isSceneHeading(heading: string, level: number): string | undefined {
  const sceneId = findSceneId(heading);
  if (!sceneId) return undefined;

  const normalizedHeading = heading.trim();
  // A detail heading may mention a scene ID in its title. It must remain part
  // of its current scene rather than becoming a new scene boundary.
  if (/^(?:镜头|shot)\s*(?:SH\s*)?\d+/iu.test(normalizedHeading)) return undefined;
  const startsWithSceneId = /^(?:[【\[（(]\s*)?(?:EP\s*\d+\s*[-_]\s*)?SC\s*\d+/iu.test(normalizedHeading);
  const hasSceneLabel = /(?:场次|场景|分镜|storyboard|scene)/iu.test(normalizedHeading);
  return startsWithSceneId || hasSceneLabel || level <= 2 ? sceneId : undefined;
}

function splitStoryboardSceneSections(source: IndexedEntry, markdown: string): StoryboardSceneSection[] {
  const sceneHeadings: StoryboardSceneHeading[] = [];
  for (const heading of markdown.matchAll(/^(#{1,6})\s+(.+?)\s*$/gmu)) {
    if (heading.index === undefined) continue;
    const sceneId = isSceneHeading(heading[2], heading[1].length);
    if (!sceneId) continue;
    // A single scene often repeats its ID for "总表" and "逐镜设计". Keep
    // those sections together so the table and detail records can still join.
    if (sceneHeadings.at(-1)?.sceneId === sceneId) continue;
    sceneHeadings.push({ sceneId, start: heading.index });
  }

  if (!sceneHeadings.length) {
    return [{
      sceneId: extractSceneId(source.name, markdown),
      markdown,
      hasMultipleScenes: false,
    }];
  }

  const hasMultipleScenes = sceneHeadings.length > 1;
  return sceneHeadings.map((heading, index) => ({
    sceneId: heading.sceneId,
    // Preserve a document preamble with the first scene. This keeps existing
    // single-scene files compatible while every later table is unambiguously scoped.
    markdown: markdown.slice(index === 0 ? 0 : heading.start, sceneHeadings[index + 1]?.start ?? markdown.length),
    hasMultipleScenes,
  }));
}

function parseBoldFields(markdown: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+\*\*([^*]+?)[：:]\*\*\s*(.*?)\s*$/u);
    if (match) fields.set(match[1].trim(), match[2].trim());
  }
  return fields;
}

function readField(fields: Map<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = fields.get(name);
    if (value !== undefined) return value;
  }
  return "";
}

/** Read the role from the character Markdown so the document remains the source of truth. */
function parseCharacterRoleCategory(markdown: string): CharacterRoleCategory {
  const roleFieldNames = ["角色分类", "人物分类", "角色类型", "人物类型"];
  const lines = markdown.split(/\r?\n/u);
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || !trimmed) continue;

    // Authors commonly put the colon either inside or outside the bold marker.
    const fieldMatch = [
      /^(?:[-*]\s*)?\*\*(角色分类|人物分类|角色类型|人物类型)\s*[：:]\*\*\s*(.+?)\s*$/u,
      /^(?:[-*]\s*)?\*\*(角色分类|人物分类|角色类型|人物类型)\*\*\s*[：:]\s*(.+?)\s*$/u,
      /^(?:[-*]\s*)?(角色分类|人物分类|角色类型|人物类型)\s*[：:]\s*(.+?)\s*$/u,
    ].map((pattern) => trimmed.match(pattern)).find(Boolean);
    if (fieldMatch && roleFieldNames.includes(fieldMatch[1])) {
      const category = parseRoleCategoryValue(fieldMatch[2]);
      if (category) return category;
    }

    // Also accept a small YAML/front-matter style key for hand-authored files.
    const yamlMatch = trimmed.match(/^(?:role|characterRole|角色分类)\s*[：:]\s*(.+?)\s*$/iu);
    if (yamlMatch) {
      const category = parseRoleCategoryValue(yamlMatch[1]);
      if (category) return category;
    }
  }

  // A dedicated heading may put the value on the following line.
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^#{1,6}\s*(角色分类|人物分类|角色类型|人物类型)\s*$/u.test(lines[index].trim())) continue;
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (!candidate) continue;
      if (candidate.startsWith("#")) break;
      const category = parseRoleCategoryValue(candidate.replace(/^[-*]\s*/u, ""));
      if (category) return category;
      break;
    }
  }

  return DEFAULT_CHARACTER_ROLE_CATEGORY;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readMarkdownSection(markdown: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "mu");
  const match = pattern.exec(markdown);
  if (!match || match.index === undefined) return "";
  const contentStart = match.index + match[0].length;
  const remainder = markdown.slice(contentStart);
  const nextHeading = /^##\s+/mu.exec(remainder);
  return remainder.slice(0, nextHeading?.index ?? remainder.length).trim();
}

function parseShotDetails(markdown: string): Map<string, ShotDetail> {
  const details = new Map<string, ShotDetail>();
  const headings = [...markdown.matchAll(
    /^#{2,4}\s*(?:(?:镜头|分镜)\s*)?((?:SH\s*)?\d+)(?:\s*(?:[：:—-]\s*|\s+)(.+?))?\s*$/gmu,
  )];

  headings.forEach((heading, index) => {
    const shotId = normalizeShotId(heading[1].replace(/\s+/gu, ""));
    if (!shotId || heading.index === undefined) return;
    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = headings[index + 1]?.index ?? markdown.length;
    const rawContent = markdown.slice(bodyStart, bodyEnd).trim();
    details.set(shotId, {
      title: heading[2]?.trim() || "未命名镜头",
      fields: parseBoldFields(rawContent),
      rawContent,
    });
  });
  return details;
}

function splitMarkdownTableRow(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return undefined;
  const content = trimmed.replace(/^\|/u, "").replace(/\|$/u, "");
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\\" && content[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (character === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells.length > 1 ? cells : undefined;
}

function isMarkdownTableDivider(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

function normalizeTableHeader(value: string): string {
  return value.replace(/[\s*_`]/gu, "").trim();
}

function findTableColumn(headers: readonly string[], names: readonly string[]): number | undefined {
  const index = headers.findIndex((header) => names.some((name) => header === name || header.includes(name)));
  return index >= 0 ? index : undefined;
}

interface StoryboardTableColumns {
  shotId: number;
  timecode: number;
  duration: number;
  framing: number;
  content: number;
  dialogue: number;
}

function readStoryboardTableColumns(cells: readonly string[]): StoryboardTableColumns | undefined {
  const headers = cells.map(normalizeTableHeader);
  const shotId = findTableColumn(headers, ["镜号", "镜头号", "镜头编号", "shotid"]);
  if (shotId === undefined) return undefined;
  return {
    shotId,
    timecode: findTableColumn(headers, ["时间码", "时码", "timecode"]) ?? 1,
    duration: findTableColumn(headers, ["时长", "duration"]) ?? 2,
    framing: findTableColumn(headers, ["景别", "机位", "framing"]) ?? 3,
    content: findTableColumn(headers, ["画面内容", "画面描述", "核心内容", "内容", "content"]) ?? 4,
    dialogue: findTableColumn(headers, ["台词", "对白", "dialogue"]) ?? 5,
  };
}

function readStoryboardTableCell(cells: readonly string[], index: number): string {
  return cells[index]?.trim() || "";
}

function makeShortTitle(content: string): string {
  const clean = content.replace(/[*_`#]/g, "").trim();
  const phrase = clean.split(/[，。；：,.;:]/u)[0]?.trim() || "未命名镜头";
  return phrase.length > 18 ? `${phrase.slice(0, 18)}…` : phrase;
}

function parseStoryboardSectionDrafts(
  source: IndexedEntry,
  sceneId: string,
  markdown: string,
  hasMultipleScenes: boolean,
): ParsedStoryboardDraft[] {
  const details = parseShotDetails(markdown);
  const drafts: ParsedStoryboardDraft[] = [];
  let tableColumns: StoryboardTableColumns | undefined;

  for (const line of markdown.split(/\r?\n/)) {
    const cells = splitMarkdownTableRow(line);
    if (!cells || isMarkdownTableDivider(cells)) continue;
    const nextColumns = readStoryboardTableColumns(cells);
    if (nextColumns) {
      tableColumns = nextColumns;
      continue;
    }
    const columns = tableColumns ?? { shotId: 0, timecode: 1, duration: 2, framing: 3, content: 4, dialogue: 5 };
    if (cells.length <= Math.max(
      columns.shotId,
      columns.timecode,
      columns.duration,
      columns.framing,
      columns.content,
      columns.dialogue,
    )) continue;
    const shotId = normalizeShotId(readStoryboardTableCell(cells, columns.shotId));
    if (!shotId) continue;

    const detail = details.get(shotId);
    const hasTrailingUnescapedCells = columns.content === 4
      && columns.dialogue === 5
      && cells.length > 6;
    const content = hasTrailingUnescapedCells
      ? cells.slice(columns.content, -1).join(" | ")
      : readStoryboardTableCell(cells, columns.content);
    const dialogue = hasTrailingUnescapedCells
      ? cells.at(-1)?.trim() || ""
      : readStoryboardTableCell(cells, columns.dialogue);
    const design: ShotDesign = {
      sceneId,
      shotId,
      title: detail?.title || makeShortTitle(content),
      timecode: readStoryboardTableCell(cells, columns.timecode),
      duration: readStoryboardTableCell(cells, columns.duration),
      framing: readStoryboardTableCell(cells, columns.framing),
      content,
      dialogue,
      camera: detail ? readField(detail.fields, "摄影运动", "运镜") : "",
      prompt: detail ? readField(detail.fields, "提示词") : "",
      negativePrompt: detail ? readField(detail.fields, "负面提示词") : "",
      firstFramePrompt: detail ? readField(detail.fields, "首帧提示词") : "",
      firstFrameNegativePrompt: detail ? readField(detail.fields, "首帧负面提示词") : "",
      lastFramePrompt: detail ? readField(detail.fields, "尾帧提示词") : "",
      lastFrameNegativePrompt: detail ? readField(detail.fields, "尾帧负面提示词") : "",
      references: detail ? readField(detail.fields, "参考人物", "参考角色") : "",
      videoPrompt: detail ? readField(detail.fields, "视频生成提示词") : "",
      status: "待创建镜头资产",
    };
    const warnings: string[] = [];
    if (!detail) warnings.push(`${shotId} 没有匹配到逐镜详细设计，将只导入总表信息。`);
    if (hasMultipleScenes) {
      warnings.push("同一份分镜脚本包含多个场次；已按场次标题分别识别。");
    }
    if (!design.timecode || !design.duration || !design.content) {
      warnings.push(`${shotId} 缺少时间码、时长或画面内容中的至少一项。`);
    }
    drafts.push({
      asset: {
        type: "shot",
        sourcePath: source.relativePath,
        design,
        slots: createEmptySlots(SHOT_SLOT_DEFINITIONS),
        updatedAt: source.stats.mtime.toISOString(),
        isDraft: true,
      },
      source: {
        sourcePath: source.relativePath,
        sourceShotId: shotId,
        rawDetail: detail?.rawContent || "",
      },
      warnings,
    });
  }
  return drafts;
}

function parseStoryboardDrafts(source: IndexedEntry, markdown: string): ParsedStoryboardDraft[] {
  return splitStoryboardSceneSections(source, markdown)
    .flatMap((section) => parseStoryboardSectionDrafts(
      source,
      section.sceneId,
      section.markdown,
      section.hasMultipleScenes,
    ));
}

function parseShotDirectoryName(directoryName: string): { shotId: string; title: string } {
  const match = directoryName.match(/^((?:SH)?\d+)(?:[-_\s]+(.+))?$/i);
  const shotId = normalizeShotId(match?.[1] || "") || directoryName;
  return { shotId, title: match?.[2]?.trim() || "未命名镜头" };
}

function parseShotCharacterOverrides(markdown: string): ShotCharacterOverride[] {
  const matcher = new RegExp(
    `${escapeRegExp(SHOT_CHARACTER_OVERRIDES_MARKER_START)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(SHOT_CHARACTER_OVERRIDES_MARKER_END)}`,
    "u",
  );
  const serialized = markdown.match(matcher)?.[1];
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { overrides?: unknown }).overrides)) return [];
    return (parsed as { overrides: unknown[] }).overrides.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const value = entry as Record<string, unknown>;
      if (typeof value.characterPath !== "string") return [];
      const mode = value.mode;
      if (mode !== "inherit" && mode !== "identity" && mode !== "look") return [];
      return [{
        characterPath: value.characterPath,
        mode,
        ...(typeof value.lookPath === "string" && value.lookPath.trim() ? { lookPath: value.lookPath } : {}),
        state: typeof value.state === "string" ? value.state : "",
      } satisfies ShotCharacterOverride];
    });
  } catch {
    return [];
  }
}

function parseStoredShotDesign(
  markdown: string,
  sceneId: string,
  directoryName: string,
): ShotDesign {
  const directoryDesign = parseShotDirectoryName(directoryName);
  const heading = markdown.match(/^#\s*((?:SH)?\d+)\s*(.*?)\s*$/imu);
  const fields = parseBoldFields(markdown);
  return {
    // Directory placement is the immutable asset identity. Markdown metadata is editable content.
    sceneId,
    shotId: directoryDesign.shotId,
    title: heading?.[2]?.trim() || directoryDesign.title,
    timecode: readField(fields, "时间码"),
    duration: readField(fields, "时长"),
    framing: readField(fields, "景别／机位", "景别/机位", "景别"),
    content: readMarkdownSection(markdown, "画面描述") || readField(fields, "核心内容", "画面描述"),
    dialogue: readMarkdownSection(markdown, "台词") || readField(fields, "台词"),
    camera: readField(fields, "运镜", "摄影运动"),
    prompt: readMarkdownSection(markdown, "提示词") || readField(fields, "提示词"),
    negativePrompt: readMarkdownSection(markdown, "负面提示词") || readField(fields, "负面提示词"),
    firstFramePrompt: readMarkdownSection(markdown, "首帧提示词"),
    firstFrameNegativePrompt: readMarkdownSection(markdown, "首帧负面提示词"),
    lastFramePrompt: readMarkdownSection(markdown, "尾帧提示词"),
    lastFrameNegativePrompt: readMarkdownSection(markdown, "尾帧负面提示词"),
    references: readField(fields, "参考人物", "参考角色"),
    videoPrompt: readMarkdownSection(markdown, "视频生成提示词"),
    characterOverrides: parseShotCharacterOverrides(markdown),
    status: readField(fields, "状态") || "待生成",
  };
}

function parseStoredShotSourcePath(markdown: string): string | undefined {
  const sourcePath = readField(parseBoldFields(markdown), "来源脚本");
  if (!sourcePath || getAssetKind(path.basename(sourcePath)) !== "markdown") return undefined;
  try {
    return assertVisibleProjectPath(sourcePath);
  } catch {
    // A hand-edited source value must never become a navigable project path.
    return undefined;
  }
}

async function readIndexedText(entry: IndexedEntry): Promise<string> {
  if (entry.stats.size > MAX_TEXT_ASSET_BYTES) {
    throw new ProjectPathError("Text assets must be smaller than 2 MB.");
  }
  return fs.readFile(entry.absolutePath, "utf8");
}

async function buildCharacterAssets(
  index: ProjectIndex,
): Promise<CharacterAsset[]> {
  const characterDirectories = index.directories.filter(
    (directory) => path.basename(path.dirname(directory.absolutePath)) === "主要人物",
  );

  const characters = await Promise.all(characterDirectories.map(async (directory) => {
    const profile = (index.filesByDirectory.get(directory.absolutePath) ?? [])
      .find((file) => file.name === "角色设定.md");
    const profileContent = profile ? await readIndexedText(profile) : "";
    const slots = readAssetSlots(directory.absolutePath, CHARACTER_SLOT_DEFINITIONS, index.filesByDirectory);
    const [looks, visualMetadata] = await Promise.all([
      buildCharacterLooks(directory, index),
      Promise.resolve(getConfirmedVisualMetadata(slots)),
    ]);
    const { confirmedVisuals, confirmedVisualSourcePaths } = visualMetadata;
    const confirmedTurnaround = confirmedVisuals.turnaround;
    const confirmedTurnaroundSourcePath = confirmedTurnaround?.path;
    const slotFiles = slots.flatMap((slot) => slot.files.map((file) =>
      index.files.find((entry) => entry.relativePath === file.path),
    )).filter((entry): entry is IndexedEntry => Boolean(entry));

    return {
      type: "character" as const,
      rootPath: directory.relativePath,
      name: directory.name,
      roleCategory: parseCharacterRoleCategory(profileContent),
      ...(profile ? { profilePath: profile.relativePath, profileContent } : {}),
      profileRevision: createTextRevision(profileContent),
      slots,
      confirmedVisuals,
      confirmedVisualSourcePaths,
      ...(confirmedTurnaround ? { confirmedTurnaround } : {}),
      ...(confirmedTurnaroundSourcePath ? { confirmedTurnaroundSourcePath } : {}),
      looks,
      cover: confirmedTurnaround
        ?? confirmedVisuals.costume
        ?? confirmedVisuals.reference
        ?? pickCover(slots, ["turnaround", "costume", "reference"]),
      updatedAt: latestUpdatedAt(directory, [...(profile ? [profile] : []), ...slotFiles]),
    };
  }));

  return characters.sort((left, right) => {
    const roleDifference = CHARACTER_ROLE_SORT_ORDER.indexOf(left.roleCategory)
      - CHARACTER_ROLE_SORT_ORDER.indexOf(right.roleCategory);
    return roleDifference || left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}

async function buildStoredShotAssets(index: ProjectIndex): Promise<ShotAsset[]> {
  const designFiles = index.files.filter((file) => {
    if (file.name !== "镜头.md") return false;
    const segments = file.relativePath.split("/");
    const storyboardIndex = segments.lastIndexOf("分镜");
    return storyboardIndex >= 0 && storyboardIndex === segments.length - 4;
  });

  return Promise.all(designFiles.map(async (designFile) => {
    const assetDirectory = path.dirname(designFile.absolutePath);
    const assetDirectoryEntry = index.directories.find((entry) => entry.absolutePath === assetDirectory);
    if (!assetDirectoryEntry) {
      throw new ProjectPathError("A shot asset directory disappeared while it was being scanned.");
    }
    const sceneId = path.basename(path.dirname(assetDirectory));
    const slots = readAssetSlots(assetDirectory, SHOT_SLOT_DEFINITIONS, index.filesByDirectory);
    const slotFiles = slots.flatMap((slot) => slot.files.map((file) =>
      index.files.find((entry) => entry.relativePath === file.path),
    )).filter((entry): entry is IndexedEntry => Boolean(entry));

    const markdown = await readIndexedText(designFile);
    const sourcePath = parseStoredShotSourcePath(markdown);
    return {
      type: "shot" as const,
      rootPath: assetDirectoryEntry.relativePath,
      designPath: designFile.relativePath,
      designRevision: createTextRevision(markdown),
      ...(sourcePath ? { sourcePath } : {}),
      design: parseStoredShotDesign(markdown, sceneId, path.basename(assetDirectory)),
      slots,
      cover: pickCover(slots, ["final", "candidate", "firstFrame", "lastFrame", "reference"]),
      updatedAt: latestUpdatedAt(assetDirectoryEntry, [designFile, ...slotFiles]),
      isDraft: false,
    };
  }));
}

async function buildSimpleDocumentAssets(
  index: ProjectIndex,
  parentName: string,
  documentName: string,
  slotDefinitions: readonly SlotDefinition[],
  type: "location" | "prop",
): Promise<Array<LocationAsset | PropAsset>> {
  const directories = index.directories.filter(
    (directory) => path.basename(path.dirname(directory.absolutePath)) === parentName,
  );
  return Promise.all(directories.map(async (directory) => {
    const document = (index.filesByDirectory.get(directory.absolutePath) ?? [])
      .find((file) => file.name === documentName);
    const content = document ? await readIndexedText(document) : "";
    const slots = readAssetSlots(directory.absolutePath, slotDefinitions, index.filesByDirectory);
    const confirmedVisuals: Record<string, AssetFile | undefined> = {};
    for (const slot of slots) confirmedVisuals[slot.key] = findConfirmedVisual(slot.files);
    const slotFiles = slots.flatMap((slot) => slot.files.map((file) =>
      index.files.find((entry) => entry.relativePath === file.path),
    )).filter((entry): entry is IndexedEntry => Boolean(entry));
    const base = {
      type,
      rootPath: directory.relativePath,
      name: directory.name,
      ...(document ? { profilePath: document.relativePath, profileContent: content } : {}),
      profileRevision: createTextRevision(content),
      slots,
      confirmedVisuals,
      cover: confirmedVisuals.final
        ?? confirmedVisuals.setting
        ?? confirmedVisuals.candidate
        ?? confirmedVisuals.reference
        ?? pickCover(slots, ["final", "setting", "candidate", "reference"]),
      updatedAt: latestUpdatedAt(directory, [...(document ? [document] : []), ...slotFiles]),
    };
    return base as LocationAsset | PropAsset;
  }));
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/[\r\n]+/gu, " ").trim();
}

function parseSceneCastBindings(markdown: string): SceneCastBinding[] {
  const matcher = new RegExp(
    `${escapeRegExp(SCENE_CAST_MARKER_START)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(SCENE_CAST_MARKER_END)}`,
    "u",
  );
  const serialized = markdown.match(matcher)?.[1];
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { bindings?: unknown }).bindings)) return [];
    return (parsed as { bindings: unknown[] }).bindings.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const value = entry as Record<string, unknown>;
      if (typeof value.characterPath !== "string") return [];
      return [{
        characterPath: value.characterPath,
        ...(typeof value.lookPath === "string" && value.lookPath.trim() ? { lookPath: value.lookPath } : {}),
        state: typeof value.state === "string" ? value.state : "",
        continuity: typeof value.continuity === "string" ? value.continuity : "",
        startShotId: typeof value.startShotId === "string" ? value.startShotId : "",
        endShotId: typeof value.endShotId === "string" ? value.endShotId : "",
      } satisfies SceneCastBinding];
    });
  } catch {
    // Hand-edited or malformed cast sheets should remain readable; the UI will ask the user to save a valid binding.
    return [];
  }
}

function extractPreservedSceneCastContent(markdown: string): string {
  // Newer documents wrap the generated projection, while this fallback also
  // protects free-form notes from the first generation of cast sheets.
  const withoutProjection = extractMarkedContent(
    markdown,
    SCENE_CAST_PROJECTION_MARKER_START,
    SCENE_CAST_PROJECTION_MARKER_END,
  ).remainder;
  let remainder = extractMarkedContent(
    withoutProjection,
    SCENE_CAST_MARKER_START,
    SCENE_CAST_MARKER_END,
  ).remainder
    .replace(/^#\s+.*?出场与造型表\s*(?:\r?\n|$)/mu, "")
    .replace(/^\s*本表定义本场默认的人物与造型；镜头只记录临时状态或换装覆盖。\s*(?:\r?\n|$)/mu, "");

  const lines = remainder.split(/\r?\n/u);
  const headerIndex = lines.findIndex((line) => line.trim() === "| 人物 | 默认造型 | 生效镜头 | 状态 | 连续性 |");
  if (headerIndex >= 0 && /^\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*$/u.test(lines[headerIndex + 1]?.trim() || "")) {
    let endIndex = headerIndex + 2;
    while (endIndex < lines.length && lines[endIndex].trim().startsWith("|")) endIndex += 1;
    lines.splice(headerIndex, endIndex - headerIndex);
    remainder = lines.join("\n");
  }
  return remainder.trim();
}

function serializeSceneCastDocument(
  sceneId: string,
  bindings: readonly SceneCastBinding[],
  existingMarkdown?: string,
): string {
  const safeSceneId = validateNewName(sceneId);
  const rows = bindings.length
    ? bindings.map((binding) => [
      path.basename(binding.characterPath),
      binding.lookPath ? path.basename(binding.lookPath) : "身份基准",
      binding.startShotId || binding.endShotId
        ? `${binding.startShotId || "首镜"} - ${binding.endShotId || "尾镜"}`
        : "全场",
      binding.state || "无",
      binding.continuity || "无",
    ])
    : [["尚未配置", "—", "—", "—", "—"]];
  const tableRows = rows.map((cells) => `| ${cells.map(escapeMarkdownTableCell).join(" | ")} |`);

  const generated = [
    SCENE_CAST_PROJECTION_MARKER_START,
    `# ${safeSceneId} 出场与造型表`,
    "",
    SCENE_CAST_MARKER_START,
    JSON.stringify({ version: 1, bindings }, null, 2),
    SCENE_CAST_MARKER_END,
    "",
    "本表定义本场默认的人物与造型；镜头只记录临时状态或换装覆盖。",
    "",
    "| 人物 | 默认造型 | 生效镜头 | 状态 | 连续性 |",
    "| --- | --- | --- | --- | --- |",
    ...tableRows,
    SCENE_CAST_PROJECTION_MARKER_END,
  ].join("\n");
  const preserved = existingMarkdown ? extractPreservedSceneCastContent(existingMarkdown) : "";
  return `${[generated, preserved].filter(Boolean).join("\n\n").trimEnd()}\n`;
}

function parseSceneAssetBindings(markdown: string): { locations: SceneLocationBinding[]; props: ScenePropBinding[] } {
  const matcher = new RegExp(
    `${escapeRegExp(SCENE_ASSET_BINDINGS_MARKER_START)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(SCENE_ASSET_BINDINGS_MARKER_END)}`,
    "u",
  );
  const serialized = markdown.match(matcher)?.[1];
  if (!serialized) return { locations: [], props: [] };
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { locations: [], props: [] };
    const raw = parsed as Record<string, unknown>;
    const parse = <T extends SceneLocationBinding | ScenePropBinding>(value: unknown, key: "locationPath" | "propPath"): T[] => {
      if (!Array.isArray(value)) return [];
      return value.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const item = entry as Record<string, unknown>;
        if (typeof item[key] !== "string") return [];
        return [{
          [key]: item[key],
          role: typeof item.role === "string" ? item.role : "",
          state: typeof item.state === "string" ? item.state : "",
          continuity: typeof item.continuity === "string" ? item.continuity : "",
          startShotId: typeof item.startShotId === "string" ? item.startShotId : typeof item.start_shot_id === "string" ? item.start_shot_id : "",
          endShotId: typeof item.endShotId === "string" ? item.endShotId : typeof item.end_shot_id === "string" ? item.end_shot_id : "",
        } as T];
      });
    };
    const directLocations = parse<SceneLocationBinding>(raw.locations, "locationPath");
    const directProps = parse<ScenePropBinding>(raw.props, "propPath");
    // Planner-generated sheets use one mixed `bindings` array and may use snake_case ranges.
    const mixed = Array.isArray(raw.bindings) ? raw.bindings : [];
    for (const entry of mixed) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      const type = item.type === "location" || item.type === "场景" ? "location" : item.type === "prop" || item.type === "道具" ? "prop" : "";
      const assetPath = typeof item.locationPath === "string" ? item.locationPath : typeof item.propPath === "string" ? item.propPath : undefined;
      if (!type || !assetPath) continue;
      const normalized = {
        [type === "location" ? "locationPath" : "propPath"]: assetPath,
        role: typeof item.role === "string" ? item.role : "",
        state: typeof item.state === "string" ? item.state : "",
        continuity: typeof item.continuity === "string" ? item.continuity : "",
        startShotId: typeof item.startShotId === "string" ? item.startShotId : typeof item.start_shot_id === "string" ? item.start_shot_id : "",
        endShotId: typeof item.endShotId === "string" ? item.endShotId : typeof item.end_shot_id === "string" ? item.end_shot_id : "",
      };
      if (type === "location") directLocations.push(normalized as SceneLocationBinding);
      else directProps.push(normalized as ScenePropBinding);
    }
    return { locations: directLocations, props: directProps };
  } catch {
    return { locations: [], props: [] };
  }
}

function extractPreservedSceneAssetContent(markdown: string): string {
  const withoutProjection = extractMarkedContent(
    markdown,
    SCENE_ASSET_BINDINGS_PROJECTION_MARKER_START,
    SCENE_ASSET_BINDINGS_PROJECTION_MARKER_END,
  ).remainder;
  let remainder = extractMarkedContent(
    withoutProjection,
    SCENE_ASSET_BINDINGS_MARKER_START,
    SCENE_ASSET_BINDINGS_MARKER_END,
  ).remainder;
  // Planner versions before the projection markers wrote the title, summary,
  // and one combined table directly around the JSON marker. Do not preserve
  // that generated projection when the user next saves a structured binding.
  remainder = remainder
    .replace(/^#\s+.*?场次资产表\s*(?:\r?\n|$)/mu, "")
    .replace(/^\s*本表(?:定义|记录).*?(?:\r?\n|$)/mu, "");
  const lines = remainder.split(/\r?\n/u);
  const headers = [
    "| 地点 | 角色 | 生效镜头 | 状态 | 连续性 |",
    "| 道具 | 角色 | 生效镜头 | 状态 | 连续性 |",
    "| 地点/道具 | 角色 | 生效镜头 | 状态 | 连续性 |",
  ];
  for (const header of headers) {
    const index = lines.findIndex((line) => line.trim() === header);
    if (index < 0 || !/^\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*$/u.test(lines[index + 1]?.trim() || "")) continue;
    let end = index + 2;
    while (end < lines.length && lines[end].trim().startsWith("|")) end += 1;
    lines.splice(index, end - index);
  }
  return lines.join("\n").trim();
}

function serializeSceneAssetBindingsDocument(
  sceneId: string,
  locations: readonly SceneLocationBinding[],
  props: readonly ScenePropBinding[],
  existingMarkdown?: string,
): string {
  const range = (binding: { startShotId: string; endShotId: string }) => binding.startShotId || binding.endShotId
    ? `${binding.startShotId || "首镜"} - ${binding.endShotId || "尾镜"}` : "全场";
  const rows = (items: readonly (SceneLocationBinding | ScenePropBinding)[], label: string, key: "locationPath" | "propPath") => [
    `| ${label} | 角色 | 生效镜头 | 状态 | 连续性 |`,
    "| --- | --- | --- | --- | --- |",
    ...(items.length ? items.map((item) => `| ${escapeMarkdownTableCell(path.basename(item[key]))} | ${escapeMarkdownTableCell(item.role)} | ${range(item)} | ${escapeMarkdownTableCell(item.state)} | ${escapeMarkdownTableCell(item.continuity)} |`) : ["| 尚未配置 | — | — | — | — |"]),
  ];
  const generated = [
    SCENE_ASSET_BINDINGS_PROJECTION_MARKER_START,
    `# ${validateNewName(sceneId)} 场次资产表`,
    "",
    SCENE_ASSET_BINDINGS_MARKER_START,
    JSON.stringify({ version: 1, locations, props }, null, 2),
    SCENE_ASSET_BINDINGS_MARKER_END,
    "",
    "本表定义本场使用的地点与道具；镜头只记录临时状态覆盖。",
    "",
    ...rows(locations, "地点", "locationPath"),
    "",
    ...rows(props, "道具", "propPath"),
    SCENE_ASSET_BINDINGS_PROJECTION_MARKER_END,
  ].join("\n");
  const preserved = existingMarkdown ? extractPreservedSceneAssetContent(existingMarkdown) : "";
  return `${[generated, preserved].filter(Boolean).join("\n\n").trimEnd()}\n`;
}

function parseLegacySceneAssetReferences(markdown: string, locations: readonly LocationAsset[], props: readonly PropAsset[]): { locations: SceneLocationBinding[]; props: ScenePropBinding[] } {
  const fields = parseBoldFields(markdown);
  const parseNames = (...keys: string[]) => keys.flatMap((key) => (fields.get(key) || "").split(/[、,，;；|]/u)).map((item) => item.trim()).filter((item) => item && item !== "未指定");
  const locationNames = parseNames("场景", "地点", "场景引用", "地点引用", "引用资产", "引用地点/道具", "地点与道具");
  const propNames = parseNames("道具", "道具引用", "引用资产", "引用地点/道具", "地点与道具");
  const locationBindings = locations.filter((asset) => locationNames.includes(asset.name)).map((asset) => ({ locationPath: asset.rootPath, role: "", state: "", continuity: "", startShotId: "", endShotId: "" }));
  const propBindings = props.filter((asset) => propNames.includes(asset.name)).map((asset) => ({ propPath: asset.rootPath, role: "", state: "", continuity: "", startShotId: "", endShotId: "" }));
  return { locations: locationBindings, props: propBindings };
}

async function buildSceneAssets(
  index: ProjectIndex,
  storedShots: readonly ShotAsset[],
  locations: readonly LocationAsset[],
  props: readonly PropAsset[],
): Promise<SceneAsset[]> {
  const sceneDirectories = index.directories.filter(
    (directory) => path.basename(path.dirname(directory.absolutePath)) === "分镜",
  );

  const scenes = await Promise.all(sceneDirectories.map(async (directory) => {
    const sceneFile = (index.filesByDirectory.get(directory.absolutePath) ?? [])
      .find((file) => file.name === "场次.md");
    const castFile = (index.filesByDirectory.get(directory.absolutePath) ?? [])
      .find((file) => file.name === SCENE_CAST_DOCUMENT);
    const assetBindingsFile = (index.filesByDirectory.get(directory.absolutePath) ?? [])
      .find((file) => file.name === SCENE_ASSET_BINDINGS_DOCUMENT);
    const sceneContent = sceneFile ? await readIndexedText(sceneFile) : "";
    const castContent = castFile ? await readIndexedText(castFile) : "";
    const assetBindingsContent = assetBindingsFile ? await readIndexedText(assetBindingsFile) : "";
    const parsedBindings = assetBindingsFile
      ? parseSceneAssetBindings(assetBindingsContent)
      : parseLegacySceneAssetReferences(sceneContent, locations, props);
    const sceneId = directory.name;
    const slots = readAssetSlots(directory.absolutePath, SCENE_SLOT_DEFINITIONS, index.filesByDirectory);
    const slotFiles = slots.flatMap((slot) => slot.files.map((file) =>
      index.files.find((entry) => entry.relativePath === file.path),
    )).filter((entry): entry is IndexedEntry => Boolean(entry));
    const hasAllSlotDirectories = SCENE_SLOT_DEFINITIONS.every((definition) =>
      index.directories.some((candidate) => candidate.absolutePath === path.join(directory.absolutePath, definition.directory)),
    );
    const shots = storedShots.filter((shot) => normalizeSceneIdentity(shot.design.sceneId) === normalizeSceneIdentity(sceneId));
    const sourcePath = parseStoredShotSourcePath(sceneContent)
      ?? shots.find((shot) => Boolean(shot.sourcePath))?.sourcePath;

    return {
      type: "scene" as const,
      rootPath: directory.relativePath,
      sceneId,
      ...(sceneFile ? { scenePath: sceneFile.relativePath, sceneContent } : {}),
      sceneRevision: createTextRevision(sceneContent),
      ...(castFile ? { castPath: castFile.relativePath } : {}),
      castRevision: createTextRevision(castContent),
      castBindings: parseSceneCastBindings(castContent),
      ...(assetBindingsFile ? { assetBindingsPath: assetBindingsFile.relativePath } : {}),
      assetBindingsRevision: createTextRevision(assetBindingsContent),
      locationBindings: parsedBindings.locations,
      propBindings: parsedBindings.props,
      ...(sourcePath ? { sourcePath } : {}),
      slots,
      cover: pickCover(slots, ["final", "candidate", "video", "firstFrame", "lastFrame", "setting", "reference"]),
      updatedAt: latestUpdatedAt(directory, [
        ...(sceneFile ? [sceneFile] : []),
        ...(castFile ? [castFile] : []),
        ...(assetBindingsFile ? [assetBindingsFile] : []),
        ...slotFiles,
      ]),
      shotCount: shots.length,
      // A scene is not production-ready until its default cast/look plan exists too.
      isComplete: Boolean(sceneFile) && Boolean(castFile) && hasAllSlotDirectories,
    };
  }));

  return scenes.sort((left, right) => left.sceneId.localeCompare(right.sceneId, "zh-Hans-CN", { numeric: true }));
}

function compareShots(left: ShotAsset, right: ShotAsset): number {
  const sceneOrder = left.design.sceneId.localeCompare(right.design.sceneId, "zh-Hans-CN", { numeric: true });
  if (sceneOrder !== 0) return sceneOrder;
  return left.design.shotId.localeCompare(right.design.shotId, "zh-Hans-CN", { numeric: true });
}

function getShotIdentityKeyFromParts(sceneIdInput: string, shotIdInput: string): string {
  const sceneId = sceneIdInput.trim().replaceAll("_", "-").toLocaleUpperCase("en-US");
  const shotId = normalizeShotId(shotIdInput) || shotIdInput.trim().toLocaleUpperCase("en-US");
  return `${sceneId}\u0000${shotId}`;
}

function getShotIdentityKey(design: ShotDesign): string {
  return getShotIdentityKeyFromParts(design.sceneId, design.shotId);
}

/** A scene-qualified selector avoids ambiguity when every scene restarts at SH001. */
function getStoryboardDraftSelector(draft: ParsedStoryboardDraft): string {
  return `${normalizeSceneIdentity(draft.asset.design.sceneId)}/${draft.asset.design.shotId}`;
}

interface StoryboardDraftRequest {
  requestedId: string;
  identity?: string;
  shotId?: string;
}

function parseStoryboardDraftRequest(value: string): StoryboardDraftRequest | undefined {
  const requestedId = value.trim();
  if (!requestedId) return undefined;

  // Keep bare SH001 compatible for sources where it is unambiguous. A caller
  // can use EP001-SC001/SH001 when a source has multiple scenes.
  const qualified = requestedId.match(/^(.+?)\/((?:SH)?\d{1,6})$/iu);
  if (qualified) {
    const shotId = normalizeShotId(qualified[2]);
    const sceneId = qualified[1].trim();
    if (!shotId || !sceneId) return { requestedId };
    return {
      requestedId,
      identity: getShotIdentityKeyFromParts(sceneId, shotId),
      shotId,
    };
  }

  return { requestedId, shotId: normalizeShotId(requestedId) ?? undefined };
}

export async function getAssetWorkspaceSnapshot(): Promise<AssetWorkspaceSnapshot> {
  const root = await getProjectRoot();
  const cached = await readProjectJsonSnapshot(root);
  if (cached) return cached;
  const index = await scanVisibleProject(root);
  const projectSettingsFile = index.files.find((file) => file.relativePath === "项目设定.md");
  const projectSettingsContent = projectSettingsFile
    ? await readIndexedText(projectSettingsFile)
    : "";
  const [characters, locations, props, storedShots] = await Promise.all([
    buildCharacterAssets(index),
    buildSimpleDocumentAssets(index, "场景", "场景设定.md", LOCATION_SLOT_DEFINITIONS, "location"),
    buildSimpleDocumentAssets(index, "道具", "道具设定.md", PROP_SLOT_DEFINITIONS, "prop"),
    buildStoredShotAssets(index),
  ]);
  const scenes = await buildSceneAssets(index, storedShots, locations as LocationAsset[], props as PropAsset[]);
  const storedKeys = new Set(storedShots.map((shot) => getShotIdentityKey(shot.design)));
  const draftKeys = new Set<string>();
  const drafts: ShotAsset[] = [];
  const storyboardFiles = index.files
    .filter((file) => getAssetKind(file.name) === "markdown" && file.name.includes("分镜"))
    .sort((left, right) => {
      const depthOrder = left.relativePath.split("/").length - right.relativePath.split("/").length;
      return depthOrder || left.relativePath.localeCompare(right.relativePath, "zh-Hans-CN");
    });

  for (const storyboardFile of storyboardFiles) {
    const parsedDrafts = parseStoryboardDrafts(storyboardFile, await readIndexedText(storyboardFile));
    for (const parsedDraft of parsedDrafts) {
      const draft = parsedDraft.asset;
      const key = getShotIdentityKey(draft.design);
      if (storedKeys.has(key) || draftKeys.has(key)) continue;
      draftKeys.add(key);
      drafts.push(draft);
    }
  }

  const snapshot: AssetWorkspaceSnapshot = {
    rootName: path.basename(root),
    projectSettings: {
      path: "项目设定.md",
      content: projectSettingsContent,
      revision: createTextRevision(projectSettingsContent),
    },
    characters,
    locations: locations as LocationAsset[],
    props: props as PropAsset[],
    scenes,
    shots: [...storedShots, ...drafts].sort(compareShots),
    projectIndex: await readProjectAssetIndex(root),
    updatedAt: new Date().toISOString(),
  };
  await writeProjectJsonSnapshot(root, snapshot);
  return snapshot;
}

async function readProjectJsonSnapshot(root: string): Promise<AssetWorkspaceSnapshot | undefined> {
  const target = path.join(root, PROJECT_JSON_PATH);
  let info: Stats;
  try {
    info = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new ProjectPathError(".workbench/project.json 必须是普通文件。");
  }
  if (info.size > MAX_PROJECT_JSON_BYTES) throw new ProjectPathError(".workbench/project.json 超过 20 MB。");
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(target, "utf8"));
  } catch {
    throw new ProjectPathError(".workbench/project.json 不是有效 JSON。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectPathError(".workbench/project.json 必须是 JSON 对象。");
  }
  const raw = value as Record<string, unknown>;
  const arrays = ["characters", "locations", "props", "scenes", "shots"];
  if (raw.schemaVersion !== 1 || raw.rootName !== path.basename(root)
    || !raw.projectSettings || arrays.some((key) => !Array.isArray(raw[key]))) {
    throw new ProjectPathError(".workbench/project.json 的版本或资产结构无效。");
  }
  const hasStructuredIndex = Boolean(
    raw.projectIndex && typeof raw.projectIndex === "object"
      && Array.isArray((raw.projectIndex as Record<string, unknown>).chapters)
      && (raw.projectIndex as Record<string, unknown>).chapters.length,
  );
  if (!(await projectJsonIsFresh(root, info.mtimeMs, hasStructuredIndex))) return undefined;
  // Keep schema v1 caches readable after the scene asset relation fields were added.
  for (const scene of raw.scenes as Array<Record<string, unknown>>) {
    if (!Array.isArray(scene.locationBindings)) scene.locationBindings = [];
    if (!Array.isArray(scene.propBindings)) scene.propBindings = [];
    if (typeof scene.assetBindingsRevision !== "string") scene.assetBindingsRevision = createTextRevision("");
  }
  return raw as unknown as AssetWorkspaceSnapshot;
}

async function projectJsonIsFresh(root: string, cacheMtimeMs: number, hasStructuredIndex: boolean): Promise<boolean> {
  if (!hasStructuredIndex) {
    for (const metadataPath of [PROJECT_INDEX_PATH]) {
      try {
        const metadataStats = await fs.lstat(path.join(root, metadataPath));
        if (metadataStats.mtimeMs > cacheMtimeMs) return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  // Once a project has an explicit chapter index, project.json is the
  // authoritative parsed projection. External edits are picked up by the
  // explicit rebuild action instead of falling back to Markdown parsing.
  if (hasStructuredIndex) return true;
  async function visit(directory: string): Promise<boolean> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || HIDDEN_DIRECTORIES.has(entry.name)) continue;
      const target = path.join(directory, entry.name);
      const stats = await fs.lstat(target);
      if (stats.isSymbolicLink()) continue;
      if (stats.mtimeMs > cacheMtimeMs) return false;
      if (stats.isDirectory() && !(await visit(target))) return false;
    }
    return true;
  }
  return visit(root);
}

async function writeProjectJsonSnapshot(root: string, snapshot: AssetWorkspaceSnapshot): Promise<void> {
  const directory = await getVerifiedWorkbenchDirectory(root);
  const target = path.join(directory, "project.json");
  const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, ...snapshot }, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isSafeIndexPath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value
    && !normalized.split("/").some((part) => !part || part.startsWith("."));
}

function parseProjectAssetIndex(value: unknown, projectName: string): ProjectAssetIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectPathError(".workbench/index.json 必须是 JSON 对象。");
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || raw.projectName !== projectName || !Array.isArray(raw.chapters)) {
    throw new ProjectPathError(".workbench/index.json 的版本、项目名或章节结构无效。");
  }
  if (raw.chapters.length > 1000) throw new ProjectPathError(".workbench/index.json 的章节数量超过上限。");
  const chapters: ProjectAssetIndexChapter[] = raw.chapters.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ProjectPathError(`.workbench/index.json 第 ${index + 1} 个章节无效。`);
    }
    const chapter = item as Record<string, unknown>;
    const text = (key: string, required = true): string => {
      const value = chapter[key];
      if (value === undefined && !required) return "";
      if (typeof value !== "string" || (required && !value.trim()) || value.length > 240) {
        throw new ProjectPathError(`.workbench/index.json 章节字段 ${key} 无效。`);
      }
      return value.trim();
    };
    const paths = (key: string): string[] => {
      const value = chapter[key];
      if (!Array.isArray(value) || value.length > 200 || !value.every(isSafeIndexPath)) {
        throw new ProjectPathError(`.workbench/index.json 章节字段 ${key} 必须是项目相对路径数组。`);
      }
      return [...new Set(value)];
    };
    return {
      id: text("id"),
      title: text("title"),
      ...(text("sourcePath", false) ? { sourcePath: text("sourcePath", false) } : {}),
      characterPaths: paths("characterPaths"),
      locationPaths: paths("locationPaths"),
      propPaths: paths("propPaths"),
      scenePaths: paths("scenePaths"),
      ...(text("status", false) ? { status: text("status", false) } : {}),
    };
  });
  return {
    schemaVersion: 1,
    projectName,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    chapters,
  };
}

async function readProjectAssetIndex(root: string): Promise<ProjectAssetIndex | undefined> {
  const target = path.join(root, PROJECT_INDEX_PATH);
  let info: Stats;
  try {
    info = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new ProjectPathError(".workbench/index.json 必须是普通文件。");
  }
  if (info.size > MAX_PROJECT_INDEX_BYTES) throw new ProjectPathError(".workbench/index.json 超过 1 MB。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(target, "utf8"));
  } catch {
    throw new ProjectPathError(".workbench/index.json 不是有效 JSON。");
  }
  return parseProjectAssetIndex(parsed, path.basename(root));
}

export async function readProjectIndex(): Promise<ProjectAssetIndex | undefined> {
  return readProjectAssetIndex(await getProjectRoot());
}

export async function rebuildProjectIndex(): Promise<string> {
  const root = await getProjectRoot();
  const existingIndex = await readProjectAssetIndex(root);
  await fs.rm(path.join(root, PROJECT_JSON_PATH), { force: true });
  const snapshot = await getAssetWorkspaceSnapshot();
  const index: ProjectAssetIndex = {
    schemaVersion: 1,
    projectName: snapshot.rootName,
    generatedAt: new Date().toISOString(),
    chapters: existingIndex?.chapters ?? snapshot.projectIndex?.chapters ?? [],
  };
  const directory = await getVerifiedWorkbenchDirectory(root);
  const target = path.join(directory, "index.json");
  const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  await writeAudit({ action: "rebuild-project-index", path: PROJECT_INDEX_PATH });
  return PROJECT_INDEX_PATH;
}

export async function getProjectSnapshot(): Promise<ProjectSnapshot> {
  return getAssetWorkspaceSnapshot();
}

function structureParentPath(relativePath: string): string {
  const separatorIndex = relativePath.lastIndexOf("/");
  return separatorIndex < 0 ? "" : relativePath.slice(0, separatorIndex);
}

function sortStructureNodes(nodes: TreeNode[]): void {
  nodes.sort((left, right) => {
    const kindOrder = Number(left.kind !== "folder") - Number(right.kind !== "folder");
    return kindOrder || left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true });
  });
  for (const node of nodes) {
    if (node.children?.length) sortStructureNodes(node.children);
  }
}

/** Build a read-only, visible-only tree for the compact structure viewer. */
export async function getProjectStructureSnapshot(): Promise<ProjectStructureSnapshot> {
  const root = await getProjectRoot();
  const index = await scanVisibleProject(root);
  const rootStats = await fs.stat(/* turbopackIgnore: true */ root);
  const roots: TreeNode[] = [];
  const directories = new Map<string, TreeNode>();

  const appendNode = (node: TreeNode, parentPath: string) => {
    const parent = parentPath ? directories.get(parentPath) : undefined;
    if (parent) {
      const children = parent.children ?? [];
      children.push(node);
      parent.children = children;
      return;
    }
    roots.push(node);
  };

  const sortedDirectories = [...index.directories].sort((left, right) => {
    const depthOrder = left.relativePath.split("/").length - right.relativePath.split("/").length;
    return depthOrder || left.relativePath.localeCompare(right.relativePath, "zh-Hans-CN", { numeric: true });
  });

  for (const directory of sortedDirectories) {
    const node: TreeNode = {
      name: directory.name,
      path: directory.relativePath,
      kind: "folder",
      updatedAt: directory.stats.mtime.toISOString(),
      children: [],
    };
    directories.set(directory.relativePath, node);
    appendNode(node, structureParentPath(directory.relativePath));
  }

  for (const file of index.files) {
    appendNode({
      name: file.name,
      path: file.relativePath,
      kind: getAssetKind(file.name),
      size: file.stats.size,
      updatedAt: file.stats.mtime.toISOString(),
    }, structureParentPath(file.relativePath));
  }

  sortStructureNodes(roots);
  return {
    rootName: path.basename(root),
    tree: roots,
    updatedAt: new Date(Math.max(
      rootStats.mtimeMs,
      ...index.directories.map((entry) => entry.stats.mtimeMs),
      ...index.files.map((entry) => entry.stats.mtimeMs),
    )).toISOString(),
  };
}

export async function readTextAsset(relativePath: string): Promise<TextAsset> {
  const absolutePath = await resolveExistingPath(relativePath);
  const kind = getAssetKind(path.basename(absolutePath));
  if (kind !== "markdown" && kind !== "document") {
    throw new ProjectPathError("Only Markdown and text documents can be previewed here.");
  }

  const handle = await fs.open(absolutePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new ProjectPathError("Only regular files can be previewed here.");
    }
    if (stats.size > MAX_TEXT_ASSET_BYTES) {
      throw new ProjectPathError("Text preview is limited to files smaller than 2 MB.");
    }
    return {
      path: relativePath,
      content: (await handle.readFile()).toString("utf8"),
      updatedAt: stats.mtime.toISOString(),
    };
  } finally {
    await handle.close();
  }
}

export async function updateProjectSettings(
  content: string,
  expectedRevision: string,
): Promise<string> {
  const root = await getProjectRoot();
  const safeContent = validateLongText(content, "Project settings");
  const target = await resolveWritablePath("项目设定.md");
  await withDirectoryLock(root, async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    await writeTextAtomically(target, safeContent.endsWith("\n") ? safeContent : `${safeContent}\n`);
  });
  await writeAudit({ action: "update-project-settings", path: "项目设定.md" });
  return "项目设定.md";
}

function validateNewName(name: string): string {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed.startsWith(".") ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed !== path.basename(trimmed) ||
    /[\\/\\\\\u0000-\u001f]/.test(trimmed)
  ) {
    throw new ProjectPathError("Use a non-empty filename without path separators.");
  }
  return trimmed;
}

const directoryLocks = new Map<string, Promise<void>>();

async function ensureVerifiedInternalDirectory(
  root: string,
  parent: string,
  name: string,
): Promise<string> {
  const candidate = path.join(parent, name);
  assertInsideRoot(root, candidate);
  try {
    await fs.mkdir(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const entry = await fs.lstat(candidate);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new ProjectPathError("The workbench storage directory must be a regular directory.");
  }
  const actualPath = await fs.realpath(candidate);
  assertInsideRoot(root, actualPath);
  return actualPath;
}

async function getVerifiedWorkbenchDirectory(root: string): Promise<string> {
  return ensureVerifiedInternalDirectory(root, root, ".workbench");
}

async function getVerifiedTrashDirectory(root: string): Promise<string> {
  const workbenchDirectory = await getVerifiedWorkbenchDirectory(root);
  return ensureVerifiedInternalDirectory(root, workbenchDirectory, ".Trash");
}

async function withDirectoryLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const previous = directoryLocks.get(directory) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queueTail = previous.then(() => gate);
  directoryLocks.set(directory, queueTail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (directoryLocks.get(directory) === queueTail) directoryLocks.delete(directory);
  }
}

async function assertTargetDoesNotExist(target: string): Promise<void> {
  try {
    await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new ProjectPathError("A file with that name already exists.");
}

async function writeAudit(event: Record<string, unknown>): Promise<void> {
  // Audit history is observational: a disk change must not be reported as failed only
  // because its follow-up audit append cannot be persisted.
  try {
    const root = await getProjectRoot();
    // Markdown remains the editable document, but the JSON projection must be
    // refreshed after every successful mutation before the next page load.
    await fs.rm(path.join(root, PROJECT_JSON_PATH), { force: true });
    const auditDirectory = await getVerifiedWorkbenchDirectory(root);
    const auditPath = path.join(auditDirectory, "audit.ndjson");
    await withDirectoryLock(auditPath, async () => {
      await fs.appendFile(
        auditPath,
        `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
      );
    });
    await getAssetWorkspaceSnapshot();
  } catch (error) {
    console.error("Unable to append workbench audit event.", {
      action: event.action,
      error,
    });
  }
}

export async function createFolder(relativePath: string): Promise<void> {
  const visiblePath = assertVisibleProjectPath(relativePath);
  const target = await resolveWritablePath(visiblePath);
  await getVerifiedWorkbenchDirectory(await getProjectRoot());
  await fs.mkdir(target, { recursive: false });
  await writeAudit({ action: "mkdir", path: visiblePath });
}

export async function renameAsset(
  relativePath: string,
  newName: string,
): Promise<string> {
  const visiblePath = assertVisibleProjectPath(relativePath);
  const source = await resolveMutableExistingPath(visiblePath);
  const safeName = validateNewName(newName);
  const root = await getProjectRoot();
  const target = await resolveWritablePath(path.join(path.dirname(visiblePath), safeName));
  await getVerifiedWorkbenchDirectory(root);
  await withDirectoryLock(path.dirname(source), async () => {
    await assertTargetDoesNotExist(target);
    await fs.rename(source, target);
  });
  const destination = makeRelative(root, target);
  await writeAudit({ action: "rename", from: visiblePath, to: destination });
  return destination;
}

interface TrashEntryMetadata {
  version: 1;
  originalPath: string;
  trashedAt: string;
}

interface VerifiedTrashPayload {
  entryDirectory: string;
  metadataPath: string;
  payloadPath: string;
  payloadName: string;
  metadata: TrashEntryMetadata;
}

function validateTrashEntryId(value: string): string {
  const id = value.trim();
  if (!TRASH_ENTRY_ID_PATTERN.test(id)) {
    throw new ProjectPathError("回收站项目编号无效。");
  }
  return id;
}

function parseTrashEntryMetadata(value: string, payloadName: string): TrashEntryMetadata | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<TrashEntryMetadata>;
    if (parsed?.version !== 1 || typeof parsed.originalPath !== "string" || typeof parsed.trashedAt !== "string") {
      return undefined;
    }
    const originalPath = assertVisibleProjectPath(parsed.originalPath);
    if (path.basename(originalPath) !== payloadName || Number.isNaN(Date.parse(parsed.trashedAt))) {
      return undefined;
    }
    return { version: 1, originalPath, trashedAt: parsed.trashedAt };
  } catch {
    return undefined;
  }
}

async function inspectTrashEntry(
  root: string,
  trashDirectory: string,
  entryName: string,
): Promise<TrashEntry | undefined> {
  if (!TRASH_ENTRY_ID_PATTERN.test(entryName)) return undefined;
  const entryDirectory = path.join(trashDirectory, entryName);
  assertInsideRoot(root, entryDirectory);
  const entryStats = await fs.lstat(entryDirectory);
  if (!entryStats.isDirectory() || entryStats.isSymbolicLink()) return undefined;

  const entries = await fs.readdir(entryDirectory, { withFileTypes: true });
  const payloadEntries = entries.filter((entry) => !entry.name.startsWith(".")
    && (entry.isDirectory() || entry.isFile())
    && !entry.isSymbolicLink());
  const payload = payloadEntries.length === 1 ? payloadEntries[0] : undefined;
  if (!payload) {
    return {
      id: entryName,
      name: "无法识别的回收项目",
      trashedAt: entryStats.mtime.toISOString(),
      kind: "other",
      isDirectory: false,
      recoverable: false,
    };
  }

  const payloadPath = path.join(entryDirectory, payload.name);
  const payloadStats = await fs.lstat(payloadPath);
  const metadataPath = path.join(entryDirectory, TRASH_METADATA_FILE);
  let metadata: TrashEntryMetadata | undefined;
  try {
    const metadataStats = await fs.lstat(metadataPath);
    if (metadataStats.isFile() && !metadataStats.isSymbolicLink() && metadataStats.size <= 64 * 1024) {
      metadata = parseTrashEntryMetadata(await fs.readFile(metadataPath, "utf8"), payload.name);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return {
    id: entryName,
    name: payload.name,
    ...(metadata ? { originalPath: metadata.originalPath } : {}),
    trashedAt: metadata?.trashedAt ?? entryStats.mtime.toISOString(),
    kind: getAssetKind(payload.name, payload.isDirectory()),
    isDirectory: payload.isDirectory(),
    ...(payload.isFile() ? { size: payloadStats.size } : {}),
    recoverable: Boolean(metadata),
  };
}

async function getVerifiedTrashPayload(root: string, entryId: string): Promise<VerifiedTrashPayload> {
  const trashDirectory = await getVerifiedTrashDirectory(root);
  const id = validateTrashEntryId(entryId);
  const entryDirectory = path.join(trashDirectory, id);
  assertInsideRoot(root, entryDirectory);
  const entryStats = await fs.lstat(entryDirectory);
  if (!entryStats.isDirectory() || entryStats.isSymbolicLink()) {
    throw new ProjectPathError("回收站项目已不可用。");
  }
  const actualEntryDirectory = await fs.realpath(entryDirectory);
  assertInsideRoot(root, actualEntryDirectory);
  if (actualEntryDirectory !== entryDirectory) {
    throw new ProjectPathError("回收站项目不能包含软链接。");
  }

  const entries = await fs.readdir(entryDirectory, { withFileTypes: true });
  const payloadEntries = entries.filter((entry) => !entry.name.startsWith(".")
    && (entry.isDirectory() || entry.isFile())
    && !entry.isSymbolicLink());
  if (payloadEntries.length !== 1) {
    throw new ProjectPathError("这个旧回收站项目没有可安全恢复的单一素材。");
  }
  const payload = payloadEntries[0];
  const payloadPath = path.join(entryDirectory, payload.name);
  const payloadStats = await fs.lstat(payloadPath);
  if ((!payloadStats.isFile() && !payloadStats.isDirectory()) || payloadStats.isSymbolicLink()) {
    throw new ProjectPathError("回收站中的素材已不可用。");
  }

  const metadataPath = path.join(entryDirectory, TRASH_METADATA_FILE);
  const metadataStats = await fs.lstat(metadataPath);
  if (!metadataStats.isFile() || metadataStats.isSymbolicLink() || metadataStats.size > 64 * 1024) {
    throw new ProjectPathError("这个旧回收站项目缺少恢复信息，无法自动恢复。");
  }
  const metadata = parseTrashEntryMetadata(await fs.readFile(metadataPath, "utf8"), payload.name);
  if (!metadata) {
    throw new ProjectPathError("这个旧回收站项目的恢复信息无效，无法自动恢复。");
  }

  return { entryDirectory, metadataPath, payloadPath, payloadName: payload.name, metadata };
}

/** Read the project-private recycle bin without exposing its internal paths. */
export async function getTrashEntries(): Promise<TrashEntry[]> {
  const root = await getProjectRoot();
  const trashDirectory = await getVerifiedTrashDirectory(root);
  const entries = await fs.readdir(trashDirectory, { withFileTypes: true });
  const inspected = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith("."))
    .map((entry) => inspectTrashEntry(root, trashDirectory, entry.name)));
  return inspected
    .filter((entry): entry is TrashEntry => Boolean(entry))
    .sort((left, right) => right.trashedAt.localeCompare(left.trashedAt));
}

/** Restore an item to its original visible project-relative path, never to an arbitrary path. */
export async function restoreTrashEntry(entryId: string): Promise<string> {
  const root = await getProjectRoot();
  const trash = await getVerifiedTrashPayload(root, entryId);
  const target = await resolveWritablePath(trash.metadata.originalPath);
  const targetParent = path.dirname(target);
  const parentStats = await fs.lstat(targetParent).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new ProjectPathError("原位置的上级资产已不存在，请先恢复上级资产后再恢复此项。");
    }
    throw error;
  });
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new ProjectPathError("原位置的上级目录不可用于恢复。");
  }
  const actualParent = await fs.realpath(targetParent);
  assertInsideRoot(root, actualParent);
  if (actualParent !== targetParent) {
    throw new ProjectPathError("原位置不能包含软链接，无法恢复。");
  }

  await withDirectoryLock(targetParent, async () => {
    await withDirectoryLock(trash.entryDirectory, async () => {
      await assertTargetDoesNotExist(target);
      let moved = false;
      try {
        await fs.rename(trash.payloadPath, target);
        moved = true;
        await fs.rm(trash.metadataPath, { force: false });
        await fs.rmdir(trash.entryDirectory);
      } catch (error) {
        if (moved) {
          try {
            await fs.rename(target, trash.payloadPath);
          } catch (rollbackError) {
            console.error("Unable to return a restored asset to the recycle bin after cleanup failed.", {
              entryId,
              target,
              rollbackError,
            });
            throw new ProjectPathError("恢复后清理回收站失败，文件可能已恢复。请刷新项目目录后确认素材位置。");
          }
        }
        throw error;
      }
    });
  });

  const restoredPath = makeRelative(root, target);
  await writeAudit({ action: "restore-trash", entryId, path: restoredPath });
  return restoredPath;
}

export async function moveToTrash(relativePath: string): Promise<string> {
  const visiblePath = assertVisibleProjectPath(relativePath);
  const source = await resolveMutableExistingPath(visiblePath);
  const root = await getProjectRoot();
  const baseName = path.basename(source);
  const trashDirectory = await getVerifiedTrashDirectory(root);
  const trashEntryDirectory = path.join(trashDirectory, randomUUID());
  await fs.mkdir(trashEntryDirectory);
  const target = path.join(trashEntryDirectory, baseName);
  const metadataPath = path.join(trashEntryDirectory, TRASH_METADATA_FILE);
  const metadata: TrashEntryMetadata = {
    version: 1,
    originalPath: visiblePath,
    trashedAt: new Date().toISOString(),
  };
  try {
    await fs.writeFile(metadataPath, JSON.stringify(metadata), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.rename(source, target);
  } catch (error) {
    // This UUID directory exists only for this failed move and contains no user data yet.
    await fs.rm(trashEntryDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  const trashPath = makeRelative(root, target);
  await writeAudit({ action: "trash", from: visiblePath, to: trashPath });
  return trashPath;
}

function getSlotDefinition(assetType: WorkspaceAssetType, slotKey: string): SlotDefinition {
  const definitions: readonly SlotDefinition[] = assetType === "character"
    ? CHARACTER_SLOT_DEFINITIONS
    : assetType === "location"
      ? LOCATION_SLOT_DEFINITIONS
      : assetType === "prop"
        ? PROP_SLOT_DEFINITIONS
        : assetType === "scene"
      ? SCENE_SLOT_DEFINITIONS
      : SHOT_SLOT_DEFINITIONS;
  const definition = definitions.find(({ key }) => key === slotKey);
  if (!definition) {
    throw new ProjectPathError("That material slot is not available for this asset type.");
  }
  return definition;
}

export const MAX_ASSET_UPLOAD_BYTES = 200 * 1024 * 1024;

type UploadMediaFormat = "png" | "jpeg" | "webp" | "gif" | "avif" | "mp4" | "mov" | "webm" | "mkv";

const UPLOAD_PROBE_BYTES = 4096;
const UPLOAD_FORMAT_BY_EXTENSION: Readonly<Record<string, UploadMediaFormat>> = {
  ".avif": "avif",
  ".gif": "gif",
  ".jpeg": "jpeg",
  ".jpg": "jpeg",
  ".mkv": "mkv",
  ".mov": "mov",
  ".mp4": "mp4",
  ".png": "png",
  ".webm": "webm",
  ".webp": "webp",
};

function getUploadFormatKind(format: UploadMediaFormat): "image" | "video" {
  return format === "mp4" || format === "mov" || format === "webm" || format === "mkv"
    ? "video"
    : "image";
}

function hasAsciiAt(data: Buffer, offset: number, value: string): boolean {
  if (offset < 0 || offset + value.length > data.length) return false;
  return data.subarray(offset, offset + value.length).toString("ascii") === value;
}

function detectUploadMediaFormat(data: Buffer): UploadMediaFormat | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (hasAsciiAt(data, 0, "GIF87a") || hasAsciiAt(data, 0, "GIF89a")) return "gif";
  if (hasAsciiAt(data, 0, "RIFF") && hasAsciiAt(data, 8, "WEBP")) return "webp";

  if (data.length >= 16 && hasAsciiAt(data, 4, "ftyp")) {
    const boxSize = data.readUInt32BE(0);
    if (boxSize >= 16 && boxSize <= data.length) {
      const brands: string[] = [];
      for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
        brands.push(data.subarray(offset, offset + 4).toString("ascii"));
      }
      if (brands.includes("avif") || brands.includes("avis")) return "avif";
      if (brands.includes("qt  ")) return "mov";
      return "mp4";
    }
  }

  if (data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    if (data.includes(Buffer.from("webm", "ascii"))) return "webm";
    if (data.includes(Buffer.from("matroska", "ascii"))) return "mkv";
  }
  return undefined;
}

function assertValidUploadMedia(
  assetType: WorkspaceAssetType,
  slotKey: string,
  fileName: string,
  probe: Buffer,
): void {
  getSlotDefinition(assetType, slotKey);
  const expectedFormat = UPLOAD_FORMAT_BY_EXTENSION[path.extname(fileName).toLowerCase()];
  if (!expectedFormat) {
    throw new ProjectPathError("Only supported image and video formats can be uploaded.");
  }
  const detectedFormat = detectUploadMediaFormat(probe);
  if (!detectedFormat || detectedFormat !== expectedFormat) {
    throw new ProjectPathError("The file extension does not match a supported media file signature.");
  }
  if (assetType === "character" && getUploadFormatKind(detectedFormat) !== "image") {
    throw new ProjectPathError("Character visual slots accept image files only.");
  }
}

async function writeBufferFully(handle: FileHandle, buffer: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset);
    if (!bytesWritten) throw new ProjectPathError("The upload stream stopped before the file could be written.");
    offset += bytesWritten;
  }
}

async function getVerifiedUploadDirectory(root: string): Promise<string> {
  const workbenchDirectory = await getVerifiedWorkbenchDirectory(root);
  return ensureVerifiedInternalDirectory(root, workbenchDirectory, ".uploads");
}

interface VerifiedWorkspaceAsset {
  rootPath: string;
  slots: AssetSlot[];
  character?: CharacterAsset;
  location?: LocationAsset;
  prop?: PropAsset;
  scene?: SceneAsset;
  shot?: ShotAsset;
}

async function getVerifiedWorkspaceAsset(
  assetType: WorkspaceAssetType,
  assetPath: string,
): Promise<VerifiedWorkspaceAsset> {
  const visiblePath = assertVisibleProjectPath(assetPath);
  const snapshot = await getAssetWorkspaceSnapshot();
  if (assetType === "character") {
    const character = snapshot.characters.find((asset) => asset.rootPath === visiblePath);
    if (!character) throw new ProjectPathError("The selected character asset no longer exists.");
    await resolveMutableExistingPath(character.rootPath);
    return { rootPath: character.rootPath, slots: character.slots, character };
  }

  if (assetType === "scene") {
    const scene = snapshot.scenes.find((asset) => asset.rootPath === visiblePath);
    if (!scene) throw new ProjectPathError("The selected scene asset no longer exists.");
    await resolveMutableExistingPath(scene.rootPath);
    return { rootPath: scene.rootPath, slots: scene.slots, scene };
  }

  if (assetType === "location") {
    const location = snapshot.locations.find((candidate) => candidate.rootPath === visiblePath);
    if (!location) throw new ProjectPathError("所选场景资产已不存在。");
    await resolveMutableExistingPath(location.rootPath);
    return { rootPath: location.rootPath, slots: location.slots, location };
  }

  if (assetType === "prop") {
    const prop = snapshot.props.find((candidate) => candidate.rootPath === visiblePath);
    if (!prop) throw new ProjectPathError("所选道具资产已不存在。");
    await resolveMutableExistingPath(prop.rootPath);
    return { rootPath: prop.rootPath, slots: prop.slots, prop };
  }

  const shot = snapshot.shots.find((asset) => !asset.isDraft && asset.rootPath === visiblePath);
  if (!shot?.rootPath) throw new ProjectPathError("Create this shot asset before changing its files.");
  await resolveMutableExistingPath(shot.rootPath);
  return { rootPath: shot.rootPath, slots: shot.slots, shot };
}

function resolveCharacterReference(
  snapshot: AssetWorkspaceSnapshot,
  characterPath: string,
  lookPath?: string,
): { character: CharacterAsset; look?: CharacterLook; characterPath: string; lookPath?: string } {
  const safeCharacterPath = assertVisibleProjectPath(characterPath);
  const character = snapshot.characters.find((asset) => asset.rootPath === safeCharacterPath);
  if (!character) throw new ProjectPathError("Choose a character that exists in the active project.");
  if (!lookPath?.trim()) return { character, characterPath: safeCharacterPath };
  const safeLookPath = assertVisibleProjectPath(lookPath);
  const look = character.looks.find((candidate) => candidate.rootPath === safeLookPath);
  if (!look) throw new ProjectPathError("Choose a costume look that belongs to the selected character.");
  return { character, look, characterPath: safeCharacterPath, lookPath: safeLookPath };
}

async function getVerifiedCharacterLook(
  characterPath: string,
  lookPath: string,
): Promise<{ character: CharacterAsset; look: CharacterLook }> {
  const snapshot = await getAssetWorkspaceSnapshot();
  const reference = resolveCharacterReference(snapshot, characterPath, lookPath);
  if (!reference.look) throw new ProjectPathError("Choose a reusable character costume look.");
  await resolveMutableExistingPath(reference.character.rootPath);
  await resolveMutableExistingPath(reference.look.rootPath);
  return { character: reference.character, look: reference.look };
}

function getCharacterReferenceLocations(
  snapshot: AssetWorkspaceSnapshot,
  characterPath: string,
): string[] {
  const locations: string[] = [];
  for (const scene of snapshot.scenes) {
    if (scene.castBindings.some((binding) => binding.characterPath === characterPath)) {
      locations.push(`${scene.sceneId} 的出场与造型表`);
    }
  }
  for (const shot of snapshot.shots) {
    if (shot.isDraft || !shot.design.characterOverrides?.some((override) => override.characterPath === characterPath)) {
      continue;
    }
    locations.push(`${shot.design.sceneId} / ${shot.design.shotId} 的镜头覆盖`);
  }
  return locations;
}

function assertCharacterIsNotReferenced(
  snapshot: AssetWorkspaceSnapshot,
  character: CharacterAsset,
  action: string,
): void {
  const locations = getCharacterReferenceLocations(snapshot, character.rootPath);
  if (!locations.length) return;
  const visibleLocations = locations.slice(0, 3).join("、");
  const suffix = locations.length > 3 ? ` 等 ${locations.length} 处` : "";
  throw new ProjectPathError(
    `人物“${character.name}”已被 ${visibleLocations}${suffix}引用。为避免场次和镜头失去人物关系，暂不能${action}；请先在分镜中解除或替换这些引用。`,
  );
}

function assertSimpleAssetIsNotReferenced(
  snapshot: AssetWorkspaceSnapshot,
  asset: LocationAsset | PropAsset,
  assetType: "location" | "prop",
  action: string,
): void {
  const locations: string[] = [];
  for (const scene of snapshot.scenes) {
    const bindings = assetType === "location" ? scene.locationBindings ?? [] : scene.propBindings ?? [];
    const pathKey = assetType === "location" ? "locationPath" : "propPath";
    if (bindings.some((binding) => (binding as unknown as Record<string, unknown>)[pathKey] === asset.rootPath)) locations.push(`${scene.sceneId} 的场次资产表`);
  }
  if (!locations.length) return;
  throw new ProjectPathError(`${assetType === "location" ? "地点/环境" : "道具"}“${asset.name}”已被 ${locations.slice(0, 3).join("、")}${locations.length > 3 ? ` 等 ${locations.length} 处` : ""}引用，暂不能${action}；请先在分镜中解除或替换这些引用。`);
}

function normalizeSceneRangeShotId(value: unknown, label: string): string {
  const text = validateOneLine(value, label, 120);
  if (!text) return "";
  const shotId = normalizeShotId(text);
  if (!shotId) throw new ProjectPathError(`${label} must use a shot number such as SH001.`);
  return shotId;
}

function shotNumber(shotId: string, fallback: number): number {
  const normalized = normalizeShotId(shotId);
  return normalized ? Number.parseInt(normalized.slice(2), 10) : fallback;
}

function doShotRangesOverlap(left: SceneCastBinding, right: SceneCastBinding): boolean {
  const leftStart = shotNumber(left.startShotId, Number.NEGATIVE_INFINITY);
  const leftEnd = shotNumber(left.endShotId, Number.POSITIVE_INFINITY);
  const rightStart = shotNumber(right.startShotId, Number.NEGATIVE_INFINITY);
  const rightEnd = shotNumber(right.endShotId, Number.POSITIVE_INFINITY);
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function sceneCastBindingAppliesToShot(binding: SceneCastBinding, shotId: string): boolean {
  const currentShot = normalizeShotId(shotId);
  if (!currentShot) return false;
  const current = shotNumber(currentShot, Number.NaN);
  const start = binding.startShotId ? shotNumber(binding.startShotId, Number.NaN) : Number.NEGATIVE_INFINITY;
  const end = binding.endShotId ? shotNumber(binding.endShotId, Number.NaN) : Number.POSITIVE_INFINITY;
  return Number.isFinite(current) && current >= start && current <= end;
}

function getSceneBindingsForShot(
  snapshot: AssetWorkspaceSnapshot,
  sceneId: string,
  shotId: string,
): SceneCastBinding[] {
  const normalizedSceneId = normalizeSceneIdentity(sceneId);
  return snapshot.scenes
    .find((scene) => normalizeSceneIdentity(scene.sceneId) === normalizedSceneId)
    ?.castBindings.filter((binding) => sceneCastBindingAppliesToShot(binding, shotId)) ?? [];
}

function validateSceneCastBindings(
  bindings: unknown,
  snapshot: AssetWorkspaceSnapshot,
): SceneCastBinding[] {
  if (!Array.isArray(bindings) || bindings.length > 120) {
    throw new ProjectPathError("A scene cast sheet must be a short list of bindings.");
  }
  const normalized = bindings.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ProjectPathError("Each scene cast binding must be an object.");
    }
    const candidate = item as Record<string, unknown>;
    const characterPathInput = validateOneLine(candidate.characterPath, "Scene character path", 500);
    const lookPathInput = candidate.lookPath === undefined
      ? undefined
      : validateOneLine(candidate.lookPath, "Scene look path", 500) || undefined;
    const reference = resolveCharacterReference(snapshot, characterPathInput, lookPathInput);
    const startShotId = normalizeSceneRangeShotId(candidate.startShotId, "Scene cast start shot");
    const endShotId = normalizeSceneRangeShotId(candidate.endShotId, "Scene cast end shot");
    if (startShotId && endShotId && shotNumber(startShotId, 0) > shotNumber(endShotId, 0)) {
      throw new ProjectPathError("A scene cast binding cannot end before it starts.");
    }
    return {
      characterPath: reference.characterPath,
      ...(reference.lookPath ? { lookPath: reference.lookPath } : {}),
      state: validateOneLine(candidate.state, "Scene character state", 500),
      continuity: validateOneLine(candidate.continuity, "Scene continuity", 500),
      startShotId,
      endShotId,
    } satisfies SceneCastBinding;
  });

  for (let index = 0; index < normalized.length; index += 1) {
    for (let other = index + 1; other < normalized.length; other += 1) {
      if (
        normalized[index].characterPath === normalized[other].characterPath
        && doShotRangesOverlap(normalized[index], normalized[other])
      ) {
        throw new ProjectPathError("同一人物在重叠镜头范围内只能有一套默认造型。");
      }
    }
  }
  return normalized;
}

function validateSceneAssetBindings(
  locations: unknown,
  props: unknown,
  snapshot: AssetWorkspaceSnapshot,
  sceneId: string,
): { locations: SceneLocationBinding[]; props: ScenePropBinding[] } {
  const sceneShotIds = new Set(
    snapshot.shots
      .filter((shot) => !shot.isDraft && normalizeSceneIdentity(shot.design.sceneId) === normalizeSceneIdentity(sceneId))
      .map((shot) => normalizeShotId(shot.design.shotId))
      .filter((shotId): shotId is string => Boolean(shotId)),
  );
  const validate = <T extends SceneLocationBinding | ScenePropBinding>(items: unknown, key: "locationPath" | "propPath", label: string): T[] => {
    if (!Array.isArray(items) || items.length > 120) throw new ProjectPathError("场次资产表最多只能包含 120 条绑定。");
    const normalized = items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new ProjectPathError("每条场次资产绑定必须是对象。");
      const candidate = item as Record<string, unknown>;
      const input = validateOneLine(candidate[key], `${label} path`, 500);
      const safePath = assertVisibleProjectPath(input);
      const found = key === "locationPath"
        ? snapshot.locations.find((asset) => asset.rootPath === safePath)
        : snapshot.props.find((asset) => asset.rootPath === safePath);
      if (!found) throw new ProjectPathError(`${label} 必须属于当前项目的顶层资产目录。`);
      const startShotId = normalizeSceneRangeShotId(candidate.startShotId, `${label} start shot`);
      const endShotId = normalizeSceneRangeShotId(candidate.endShotId, `${label} end shot`);
      if (startShotId && endShotId && shotNumber(startShotId, 0) > shotNumber(endShotId, 0)) {
        throw new ProjectPathError(`${label} 绑定的结束镜号不能早于开始镜号。`);
      }
      if (startShotId && !sceneShotIds.has(startShotId)) {
        throw new ProjectPathError(`${label} 绑定的起始镜号不属于当前场次。`);
      }
      if (endShotId && !sceneShotIds.has(endShotId)) {
        throw new ProjectPathError(`${label} 绑定的结束镜号不属于当前场次。`);
      }
      return {
        [key]: safePath,
        role: validateOneLine(candidate.role, `${label} role`, 500),
        state: validateOneLine(candidate.state, `${label} state`, 500),
        continuity: validateOneLine(candidate.continuity, `${label} continuity`, 500),
        startShotId,
        endShotId,
      } as T;
    });
    for (let index = 0; index < normalized.length; index += 1) {
      for (let other = index + 1; other < normalized.length; other += 1) {
        if ((normalized[index] as unknown as Record<string, unknown>)[key] === (normalized[other] as unknown as Record<string, unknown>)[key]
          && doShotRangesOverlap(normalized[index] as SceneCastBinding, normalized[other] as SceneCastBinding)) {
          throw new ProjectPathError(`同一${label}在重叠镜头范围内不能重复绑定。`);
        }
      }
    }
    return normalized;
  };
  return {
    locations: validate<SceneLocationBinding>(locations, "locationPath", "地点"),
    props: validate<ScenePropBinding>(props, "propPath", "道具"),
  };
}

function validateResolvedShotCharacterOverrides(
  overrides: readonly ShotCharacterOverride[],
  snapshot: AssetWorkspaceSnapshot,
  sceneId: string,
  shotId: string,
): ShotCharacterOverride[] {
  const inheritedBindings = getSceneBindingsForShot(snapshot, sceneId, shotId);
  const seenCharacters = new Set<string>();
  return overrides.map((override) => {
    const reference = resolveCharacterReference(
      snapshot,
      override.characterPath,
      override.mode === "look" ? override.lookPath : undefined,
    );
    if (seenCharacters.has(reference.characterPath)) {
      throw new ProjectPathError("同一镜头中的同一人物只能设置一条造型覆盖。");
    }
    seenCharacters.add(reference.characterPath);
    if (override.mode === "look" && !reference.lookPath) {
      throw new ProjectPathError("镜头造型覆盖需要选择该人物的一套造型。");
    }
    if (
      override.mode === "inherit"
      && !inheritedBindings.some((binding) => binding.characterPath === reference.characterPath)
    ) {
      throw new ProjectPathError("只有已在本场对应镜头范围内出场的人物才能继承场次默认造型。");
    }
    return {
      characterPath: reference.characterPath,
      mode: override.mode,
      ...(override.mode === "look" && reference.lookPath ? { lookPath: reference.lookPath } : {}),
      state: override.state,
    } satisfies ShotCharacterOverride;
  });
}

function validateOneLine(value: unknown, label: string, maxLength = 240): string {
  if (typeof value !== "string" || value.includes("\u0000") || /[\r\n]/.test(value)) {
    throw new ProjectPathError(`${label} must be a single line of text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ProjectPathError(`${label} is too long.`);
  }
  return trimmed;
}

function validateLongText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.includes("\u0000")) {
    throw new ProjectPathError(`${label} must be text.`);
  }
  if (Buffer.byteLength(value, "utf8") > MAX_TEXT_ASSET_BYTES / 2) {
    throw new ProjectPathError(`${label} is too long.`);
  }
  return value.trim();
}

function validateShotCharacterOverrides(value: unknown): ShotCharacterOverride[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 80) {
    throw new ProjectPathError("Shot character overrides must be a short list.");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ProjectPathError("Each shot character override must be an object.");
    }
    const candidate = item as Record<string, unknown>;
    const mode = candidate.mode;
    if (mode !== "inherit" && mode !== "identity" && mode !== "look") {
      throw new ProjectPathError("Each shot character override must choose inherit, identity, or a look.");
    }
    const characterPath = validateOneLine(candidate.characterPath, "Shot character path", 500);
    const state = validateOneLine(candidate.state, "Shot character state", 500);
    if (mode === "look") {
      const lookPath = validateOneLine(candidate.lookPath, "Shot character look path", 500);
      if (!lookPath) throw new ProjectPathError("A shot look override needs a selected look.");
      return { characterPath, mode, lookPath, state };
    }
    if (candidate.lookPath !== undefined && candidate.lookPath !== "") {
      throw new ProjectPathError("Only a look override may include a look path.");
    }
    return { characterPath, mode, state };
  });
}

function validateShotDesign(design: ShotDesign): ShotDesign {
  return {
    sceneId: validateOneLine(design.sceneId, "Scene ID", 120),
    shotId: validateOneLine(design.shotId, "Shot ID", 120),
    title: validateOneLine(design.title, "Shot title"),
    timecode: validateOneLine(design.timecode, "Timecode"),
    duration: validateOneLine(design.duration, "Duration"),
    framing: validateOneLine(design.framing, "Framing"),
    content: validateLongText(design.content, "Shot description"),
    dialogue: validateLongText(design.dialogue, "Dialogue"),
    camera: validateOneLine(design.camera, "Camera movement", 500),
    prompt: validateLongText(design.prompt, "Prompt"),
    negativePrompt: validateLongText(design.negativePrompt, "Negative prompt"),
    firstFramePrompt: validateLongText(design.firstFramePrompt ?? "", "First-frame prompt"),
    firstFrameNegativePrompt: validateLongText(design.firstFrameNegativePrompt ?? "", "First-frame negative prompt"),
    lastFramePrompt: validateLongText(design.lastFramePrompt ?? "", "Last-frame prompt"),
    lastFrameNegativePrompt: validateLongText(design.lastFrameNegativePrompt ?? "", "Last-frame negative prompt"),
    references: validateOneLine(design.references, "Character references", 500),
    characterOverrides: validateShotCharacterOverrides(design.characterOverrides),
    status: validateOneLine(design.status, "Status", 120),
  };
}

const PRESERVED_SHOT_MARKER_START = "<!-- workbench:preserved:start -->";
const PRESERVED_SHOT_MARKER_END = "<!-- workbench:preserved:end -->";
const SOURCE_SHOT_DETAIL_MARKER_START = "<!-- workbench:source-detail:start -->";
const SOURCE_SHOT_DETAIL_MARKER_END = "<!-- workbench:source-detail:end -->";
const MODELED_SHOT_FIELDS = new Set([
  "场次",
  "镜号",
  "时间码",
  "时长",
  "景别／机位",
  "景别/机位",
  "景别",
  "运镜",
  "摄影运动",
  "状态",
  "参考人物",
  "参考角色",
  "来源脚本",
  "来源镜号",
]);
const MODELED_SHOT_SECTIONS = new Set([
  "画面描述",
  "台词",
  "提示词",
  "负面提示词",
  "首帧提示词",
  "首帧负面提示词",
  "尾帧提示词",
  "尾帧负面提示词",
  "人物造型覆盖",
  "来源关联",
]);

function rangesWithoutModeledShotContent(markdown: string): string {
  const ranges: Array<{ start: number; end: number }> = [];
  const title = /^#\s+.*(?:\r?\n|$)/m.exec(markdown);
  if (title?.index !== undefined) {
    ranges.push({ start: title.index, end: title.index + title[0].length });
  }

  for (const match of markdown.matchAll(/^\s*-\s+\*\*([^*]+?)[：:]\*\*.*(?:\r?\n|$)/gmu)) {
    const fieldName = match[1].trim();
    if (MODELED_SHOT_FIELDS.has(fieldName) && match.index !== undefined) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  const headings = [...markdown.matchAll(/^##\s+(.+?)\s*$/gmu)];
  headings.forEach((heading, index) => {
    if (!MODELED_SHOT_SECTIONS.has(heading[1].trim()) || heading.index === undefined) return;
    ranges.push({
      start: heading.index,
      end: headings[index + 1]?.index ?? markdown.length,
    });
  });

  ranges.sort((left, right) => left.start - right.start);
  const merged = ranges.reduce<Array<{ start: number; end: number }>>((result, range) => {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      result.push({ ...range });
    }
    return result;
  }, []);

  let remainder = markdown;
  for (const range of merged.reverse()) {
    remainder = `${remainder.slice(0, range.start)}${remainder.slice(range.end)}`;
  }
  return remainder.trim();
}

function extractMarkedContent(
  markdown: string,
  startMarker: string,
  endMarker: string,
): { content: string; remainder: string } {
  const content: string[] = [];
  const markerPattern = new RegExp(
    `${escapeRegExp(startMarker)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(endMarker)}`,
    "g",
  );
  const remainder = markdown.replace(markerPattern, (_match, captured: string) => {
    const trimmed = captured.trim();
    if (trimmed) content.push(trimmed);
    return "";
  });
  return { content: content.join("\n\n").trim(), remainder };
}

function extractPreservedShotContent(markdown: string): string {
  const previous = extractMarkedContent(markdown, PRESERVED_SHOT_MARKER_START, PRESERVED_SHOT_MARKER_END);
  const preserved: string[] = previous.content ? [previous.content] : [];
  const withoutPreviousPreservedBlocks = previous.remainder;
  const unmodeled = rangesWithoutModeledShotContent(withoutPreviousPreservedBlocks);
  if (unmodeled) preserved.unshift(unmodeled);
  return preserved.join("\n\n").trim();
}

function readShotSource(markdown: string, fallbackShotId: string): ShotSource | undefined {
  const fields = parseBoldFields(markdown);
  const sourcePath = readField(fields, "来源脚本");
  if (!sourcePath || getAssetKind(path.basename(sourcePath)) !== "markdown") return undefined;
  try {
    return {
      sourcePath: assertVisibleProjectPath(sourcePath),
      sourceShotId: normalizeShotId(readField(fields, "来源镜号")) || fallbackShotId,
      rawDetail: extractMarkedContent(
        markdown,
        SOURCE_SHOT_DETAIL_MARKER_START,
        SOURCE_SHOT_DETAIL_MARKER_END,
      ).content,
    };
  } catch {
    return undefined;
  }
}

function normalizeShotSource(source: ShotSource, shotId: string): ShotSource {
  const sourcePath = assertVisibleProjectPath(source.sourcePath);
  if (getAssetKind(path.basename(sourcePath)) !== "markdown") {
    throw new ProjectPathError("Storyboard source must be a Markdown file inside the active project.");
  }
  const sourceShotId = normalizeShotId(source.sourceShotId);
  if (!sourceShotId || sourceShotId !== shotId) {
    throw new ProjectPathError("The source shot ID must match the imported shot asset.");
  }
  return {
    sourcePath,
    sourceShotId,
    rawDetail: validateLongText(source.rawDetail, "Source shot detail"),
  };
}

function serializeShotCharacterOverrides(overrides: readonly ShotCharacterOverride[]): string[] {
  const rows = overrides.length
    ? overrides.map((override) => [
      path.basename(override.characterPath),
      override.mode === "inherit" ? "继承场次" : override.mode === "identity" ? "使用身份基准" : "覆盖造型",
      override.mode === "look" && override.lookPath ? path.basename(override.lookPath) : "—",
      override.state || "无",
    ])
    : [["无", "继承场次", "—", "无"]];
  return [
    "## 人物造型覆盖",
    "",
    SHOT_CHARACTER_OVERRIDES_MARKER_START,
    JSON.stringify({ version: 1, overrides }, null, 2),
    SHOT_CHARACTER_OVERRIDES_MARKER_END,
    "",
    "| 人物 | 处理方式 | 造型 | 局部状态 |",
    "| --- | --- | --- | --- |",
    ...rows.map((cells) => `| ${cells.map(escapeMarkdownTableCell).join(" | ")} |`),
  ];
}

function serializeShotDesign(input: ShotDesign, existingMarkdown?: string, source?: ShotSource): string {
  const design = validateShotDesign(input);
  const modeledMarkdown = [
    `# ${design.shotId} ${design.title}`,
    "",
    `- **场次：** ${design.sceneId}`,
    `- **镜号：** ${design.shotId}`,
    `- **时间码：** ${design.timecode}`,
    `- **时长：** ${design.duration}`,
    `- **景别／机位：** ${design.framing}`,
    `- **运镜：** ${design.camera}`,
    `- **状态：** ${design.status}`,
    `- **参考人物：** ${design.references}`,
    "",
    "## 画面描述",
    "",
    design.content,
    "",
    "## 台词",
    "",
    design.dialogue,
    "",
    "## 提示词",
    "",
    design.prompt,
    "",
    "## 负面提示词",
    "",
    design.negativePrompt,
    "",
    "## 首帧提示词",
    "",
    design.firstFramePrompt,
    "",
    "## 首帧负面提示词",
    "",
    design.firstFrameNegativePrompt,
    "",
    "## 尾帧提示词",
    "",
    design.lastFramePrompt,
    "",
    "## 尾帧负面提示词",
    "",
    design.lastFrameNegativePrompt,
    "",
    "## 视频生成提示词",
    "",
    design.videoPrompt,
    "",
    ...serializeShotCharacterOverrides(design.characterOverrides ?? []),
    "",
  ].join("\n");
  const existingSource = existingMarkdown ? readShotSource(existingMarkdown, design.shotId) : undefined;
  const normalizedSource = source
    ? normalizeShotSource(source, design.shotId)
    : existingSource;
  const withoutSourceDetail = existingMarkdown
    ? extractMarkedContent(existingMarkdown, SOURCE_SHOT_DETAIL_MARKER_START, SOURCE_SHOT_DETAIL_MARKER_END).remainder
    : "";
  const preserved = withoutSourceDetail ? extractPreservedShotContent(withoutSourceDetail) : "";
  const blocks = [modeledMarkdown];
  if (normalizedSource) {
    blocks.push([
      "## 来源关联",
      "",
      `- **来源脚本：** ${normalizedSource.sourcePath}`,
      `- **来源镜号：** ${normalizedSource.sourceShotId}`,
      ...(normalizedSource.rawDetail
        ? [
          "",
          SOURCE_SHOT_DETAIL_MARKER_START,
          "",
          normalizedSource.rawDetail,
          "",
          SOURCE_SHOT_DETAIL_MARKER_END,
        ]
        : []),
    ].join("\n"));
  }
  if (preserved) {
    blocks.push(`${PRESERVED_SHOT_MARKER_START}\n\n${preserved}\n\n${PRESERVED_SHOT_MARKER_END}`);
  }
  return `${blocks.join("\n\n").trimEnd()}\n`;
}

function serializeSceneDocument(sceneId: string, source?: ShotSource): string {
  const safeSceneId = validateNewName(sceneId);
  const normalizedSource = source ? normalizeShotSource(source, source.sourceShotId) : undefined;
  return [
    `# ${safeSceneId} 场次`,
    "",
    "## 场次说明",
    "",
    ...(normalizedSource ? [`- **来源脚本：** ${normalizedSource.sourcePath}`] : []),
    "- **制作状态：** 待准备",
    "- **说明：** 在这里补充本场的空间关系、统一视觉、连续性和交付要求。",
    "",
  ].join("\n");
}

function serializeSceneLocationPrompt(sceneId: string, shot: ShotAsset): string {
  const prompt = (shot.design.prompt || shot.design.content || "").trim();
  return [
    `# ${validateNewName(sceneId)}场景设定`,
    "",
    "## 场景图提示词",
    "",
    prompt,
    "",
  ].join("\n");
}

async function writeTextAtomically(target: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_ASSET_BYTES) {
    throw new ProjectPathError("Text assets must be smaller than 2 MB.");
  }
  const parent = await fs.realpath(path.dirname(target));
  const root = await getProjectRoot();
  assertInsideRoot(root, parent);

  try {
    const existing = await fs.lstat(target);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new ProjectPathError("The asset document must be a regular file.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, content, { flag: "wx" });
    await fs.rename(temporary, target);
  } catch (error) {
    try {
      await fs.rm(temporary, { force: true });
    } catch (cleanupError) {
      console.error("Unable to remove failed temporary text asset.", { target: temporary, cleanupError });
    }
    throw error;
  }
}

async function readEditableShotMarkdown(target: string): Promise<string> {
  const entry = await fs.lstat(target);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new ProjectPathError("The asset document must be a regular file.");
  }
  if (entry.size > MAX_TEXT_ASSET_BYTES) {
    throw new ProjectPathError("Text assets must be smaller than 2 MB.");
  }
  return fs.readFile(target, "utf8");
}

async function readEditableTextOrEmpty(target: string): Promise<string> {
  try {
    return await readEditableShotMarkdown(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function normalizeSceneIdentity(sceneId: string): string {
  return sceneId.trim().replaceAll("_", "-").toLocaleUpperCase("en-US");
}

function assertUnchangedShotIdentity(incoming: ShotDesign, stored: ShotDesign): void {
  if (
    normalizeSceneIdentity(incoming.sceneId) !== normalizeSceneIdentity(stored.sceneId)
    || normalizeShotId(incoming.shotId) !== normalizeShotId(stored.shotId)
  ) {
    throw new ProjectPathError("Scene and shot IDs are fixed after a shot asset is created.");
  }
}

function assertUnchangedShotTitle(incoming: ShotDesign, stored: ShotDesign): void {
  if (incoming.title !== stored.title) {
    throw new ProjectPathError("Rename the shot asset to change its title and directory name together.");
  }
}

async function createAssetDirectory(
  parent: string,
  directoryName: string,
  slotDefinitions: readonly SlotDefinition[],
  initialize: (directory: string) => Promise<void>,
  options: {
    identityPrefix?: string;
    identityDuplicateMessage?: string;
    normalizedCharacterName?: string;
  } = {},
): Promise<string> {
  const root = await getProjectRoot();
  const target = path.join(parent, directoryName);
  const temporary = path.join(parent, `.${directoryName}.${randomUUID()}.creating`);
  assertInsideRoot(root, target);
  assertInsideRoot(root, temporary);

  try {
    // Build the complete asset in a hidden sibling so a failed create never becomes
    // a visible, partially populated character or shot.
    await fs.mkdir(temporary);
    for (const slot of slotDefinitions) {
      await fs.mkdir(path.join(temporary, slot.directory));
    }
    await initialize(temporary);

    await withDirectoryLock(parent, async () => {
      const siblings = await fs.readdir(parent, { withFileTypes: true });
      if (options.identityPrefix) {
        const duplicate = siblings.some((entry) =>
          entry.isDirectory()
          && (entry.name === options.identityPrefix || entry.name.startsWith(`${options.identityPrefix}-`)),
        );
        if (duplicate) {
          throw new ProjectPathError(
            options.identityDuplicateMessage || "An asset with that stable ID already exists.",
          );
        }
      }
      if (options.normalizedCharacterName) {
        const duplicate = siblings.some((entry) =>
          entry.isDirectory()
          && entry.name.toLocaleLowerCase("en-US") === options.normalizedCharacterName,
        );
        if (duplicate) throw new ProjectPathError("A character with that name already exists.");
      }
      await assertTargetDoesNotExist(target);
      await fs.rename(temporary, target);
    });
  } catch (error) {
    try {
      await fs.rm(temporary, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error("Unable to remove failed temporary asset directory.", {
        target: temporary,
        cleanupError,
      });
    }
    throw error;
  }

  return target;
}

async function ensureSceneAssetDirectory(
  sceneId: string,
  source?: ShotSource,
): Promise<{ directory: string; created: boolean }> {
  const safeSceneId = validateNewName(sceneId);
  const root = await getProjectRoot();
  await getVerifiedWorkbenchDirectory(root);
  const storyboardRoot = await ensureVerifiedInternalDirectory(root, root, "分镜");
  const relativePath = path.posix.join("分镜", safeSceneId);
  const candidate = path.join(storyboardRoot, safeSceneId);
  assertInsideRoot(root, candidate);

  try {
    const entry = await fs.lstat(candidate);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new ProjectPathError("The scene asset folder must be a regular directory.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const directory = await createAssetDirectory(
      storyboardRoot,
      safeSceneId,
      SCENE_SLOT_DEFINITIONS,
      async (temporary) => {
        await fs.writeFile(
          path.join(temporary, "场次.md"),
          serializeSceneDocument(safeSceneId, source),
          { flag: "wx" },
        );
        await fs.writeFile(
          path.join(temporary, SCENE_CAST_DOCUMENT),
          serializeSceneCastDocument(safeSceneId, []),
          { flag: "wx" },
        );
        await fs.writeFile(
          path.join(temporary, SCENE_ASSET_BINDINGS_DOCUMENT),
          serializeSceneAssetBindingsDocument(safeSceneId, [], []),
          { flag: "wx" },
        );
      },
    );
    return { directory, created: true };
  }

  const directory = await resolveMutableExistingPath(relativePath);
  await withDirectoryLock(directory, async () => {
    // Existing pre-scene folders are upgraded only during an explicit scene or shot creation.
    for (const definition of SCENE_SLOT_DEFINITIONS) {
      await ensureVerifiedInternalDirectory(root, directory, definition.directory);
    }
    const sceneDocument = path.join(directory, "场次.md");
    try {
      const entry = await fs.lstat(sceneDocument);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new ProjectPathError("The scene document must be a regular file.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeTextAtomically(sceneDocument, serializeSceneDocument(safeSceneId, source));
    }
    const castDocument = path.join(directory, SCENE_CAST_DOCUMENT);
    try {
      const entry = await fs.lstat(castDocument);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new ProjectPathError("The scene cast document must be a regular file.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeTextAtomically(castDocument, serializeSceneCastDocument(safeSceneId, []));
    }
    const assetBindingsDocument = path.join(directory, SCENE_ASSET_BINDINGS_DOCUMENT);
    try {
      const entry = await fs.lstat(assetBindingsDocument);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new ProjectPathError("The scene asset bindings document must be a regular file.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeTextAtomically(assetBindingsDocument, serializeSceneAssetBindingsDocument(safeSceneId, [], []));
    }
  });
  return { directory, created: false };
}

export async function createSceneAsset(sceneId: string): Promise<string> {
  const { directory, created } = await ensureSceneAssetDirectory(sceneId);
  const root = await getProjectRoot();
  const relativePath = makeRelative(root, directory);
  await writeAudit({ action: created ? "create-scene" : "complete-scene", path: relativePath });
  return relativePath;
}

async function ensureSceneLocationAsset(sceneId: string): Promise<{ location: LocationAsset; created: boolean }> {
  const safeSceneId = validateNewName(sceneId);
  const locationPath = path.posix.join("场景", safeSceneId);
  let snapshot = await getAssetWorkspaceSnapshot();
  const existing = snapshot.locations.find((asset) => asset.rootPath === locationPath);
  if (existing) return { location: existing, created: false };

  let created = false;
  try {
    await createLocationAsset(safeSceneId);
    created = true;
  } catch (error) {
    // A concurrent request may have created the same reusable asset first.
    snapshot = await getAssetWorkspaceSnapshot();
    const concurrent = snapshot.locations.find((asset) => asset.rootPath === locationPath);
    if (!concurrent) throw error;
    return { location: concurrent, created: false };
  }

  snapshot = await getAssetWorkspaceSnapshot();
  const location = snapshot.locations.find((asset) => asset.rootPath === locationPath);
  if (!location) throw new ProjectPathError("地点/环境资产已建立，但无法读取其设定。");
  return { location, created };
}

async function ensureSceneLocationBinding(scenePath: string, locationPath: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await getAssetWorkspaceSnapshot();
    const scene = snapshot.scenes.find((asset) => asset.rootPath === scenePath);
    if (!scene) throw new ProjectPathError("当前场次资产已不存在。");
    if (scene.locationBindings.some((binding) => binding.locationPath === locationPath)) return;

    try {
      await updateSceneAssetBindings(
        scene.rootPath,
        {
          locations: [
            ...scene.locationBindings,
            {
              locationPath,
              role: "主环境",
              state: "",
              continuity: "",
              startShotId: "",
              endShotId: "",
            },
          ],
          props: scene.propBindings,
        },
        scene.assetBindingsRevision,
      );
      return;
    } catch (error) {
      if (error instanceof ProjectConflictError && attempt === 0) continue;
      throw error;
    }
  }
}

/**
 * Prepares a reusable project-level environment for the current shot. The
 * storyboard scene only stores its reference to the environment; its scene
 * document is never repurposed as an image-prompt scratchpad.
 */
export async function prepareSceneImageFromShot(shotPath: string): Promise<string> {
  const verifiedShot = await getVerifiedWorkspaceAsset("shot", shotPath);
  const shot = verifiedShot.shot;
  if (!shot) throw new ProjectPathError("当前镜头资产已不存在。");
  const prompt = (shot.design.prompt || shot.design.content || "").trim();
  if (!prompt) throw new ProjectPathError("请先保存镜头画面或提示词，再生成场景图。");

  const scenePath = await createSceneAsset(shot.design.sceneId);
  const { location, created } = await ensureSceneLocationAsset(shot.design.sceneId);
  if (created) {
    await updateLocationDocument(
      location.rootPath,
      serializeSceneLocationPrompt(shot.design.sceneId, shot),
      location.profileRevision,
    );
  }
  await ensureSceneLocationBinding(scenePath, location.rootPath);
  return location.rootPath;
}

async function createSimpleDocumentAsset(
  name: string,
  parentName: string,
  documentName: string,
  slotDefinitions: readonly SlotDefinition[],
  type: "location" | "prop",
): Promise<string> {
  const safeName = validateNewName(name);
  const root = await getProjectRoot();
  await getVerifiedWorkbenchDirectory(root);
  const parent = await ensureVerifiedInternalDirectory(root, root, parentName);
  const target = await createAssetDirectory(
    parent,
    safeName,
    slotDefinitions,
    async (directory) => {
      const heading = type === "location" ? "场景设定" : "道具设定";
      await fs.writeFile(
        path.join(directory, documentName),
        `# ${safeName}${heading}\n\n## 基础设定\n\n- **用途：** 请补充该资产在故事中的用途、外观和连续性要求。\n`,
        { flag: "wx" },
      );
    },
  );
  const relativePath = makeRelative(root, target);
  await writeAudit({ action: `create-${type}`, path: relativePath });
  return relativePath;
}

export async function createLocationAsset(name: string): Promise<string> {
  return createSimpleDocumentAsset(name, "场景", "场景设定.md", LOCATION_SLOT_DEFINITIONS, "location");
}

export async function createPropAsset(name: string): Promise<string> {
  return createSimpleDocumentAsset(name, "道具", "道具设定.md", PROP_SLOT_DEFINITIONS, "prop");
}

export async function createCharacterAsset(name: string): Promise<string> {
  const safeName = validateNewName(name);
  const existingSnapshot = await getAssetWorkspaceSnapshot();
  const normalizedName = safeName.toLocaleLowerCase("en-US");
  if (existingSnapshot.characters.some((character) =>
    character.name.toLocaleLowerCase("en-US") === normalizedName,
  )) {
    throw new ProjectPathError("A character with that name already exists.");
  }
  const root = await getProjectRoot();
  await getVerifiedWorkbenchDirectory(root);
  const characterRoot = await ensureVerifiedInternalDirectory(root, root, "主要人物");
  const target = await createAssetDirectory(
    characterRoot,
    safeName,
    CHARACTER_SLOT_DEFINITIONS,
    async (directory) => {
      await fs.writeFile(
        path.join(directory, "角色设定.md"),
        `# ${safeName}角色设定\n\n## 角色定位\n\n- **角色分类：** 待分类\n- **身份：** 请在这里补充人物身份、外形、服装与表演设定。\n`,
        { flag: "wx" },
      );
    },
    { normalizedCharacterName: normalizedName },
  );
  const relativePath = makeRelative(root, target);
  await writeAudit({ action: "create-character", path: relativePath });
  return relativePath;
}

function nextCharacterLookId(looks: readonly CharacterLook[]): string {
  const largest = looks.reduce((current, look) => {
    const match = look.id.match(/(?:^|-)LOOK-(\d{1,6})$/iu) ?? look.id.match(/LOOK-(\d{1,6})/iu);
    return match ? Math.max(current, Number.parseInt(match[1], 10)) : current;
  }, 0);
  return `LOOK-${String(largest + 1).padStart(3, "0")}`;
}

export async function createCharacterLookAsset(
  characterPath: string,
  name: string,
): Promise<string> {
  const safeName = validateNewName(name);
  const characterAsset = await getVerifiedWorkspaceAsset("character", characterPath);
  if (!characterAsset.character) throw new ProjectPathError("The selected character asset no longer exists.");
  const duplicateName = characterAsset.character.looks.some((look) =>
    look.name.toLocaleLowerCase("en-US") === safeName.toLocaleLowerCase("en-US"),
  );
  if (duplicateName) throw new ProjectPathError("This character already has a costume look with that name.");

  const root = await getProjectRoot();
  const characterRoot = await resolveMutableExistingPath(characterAsset.character.rootPath);
  const lookRoot = await ensureVerifiedInternalDirectory(root, characterRoot, CHARACTER_LOOK_DIRECTORY);
  const lookId = nextCharacterLookId(characterAsset.character.looks);
  const directoryName = `${lookId}-${safeName}`;
  const target = await createAssetDirectory(
    lookRoot,
    directoryName,
    CHARACTER_SLOT_DEFINITIONS,
    async (directory) => {
      await fs.writeFile(
        path.join(directory, CHARACTER_LOOK_DOCUMENT),
        [
          `# ${lookId} ${safeName}`,
          "",
          "## 造型定位",
          "",
          `- **人物：** ${characterAsset.character!.name}`,
          `- **造型编号：** ${lookId}`,
          `- **造型名称：** ${safeName}`,
          "- **适用剧情：** 请填写适用场次、剧情阶段或角色状态。",
          "",
          "## 服装与连续性",
          "",
          "- **服装：** 请描述服装层次、材质、颜色与固定配件。",
          "- **妆发：** 请描述发型、妆面、伤痕或特殊标记。",
          "- **固定道具：** 请描述必须保持一致的道具。",
          "- **连续性：** 请描述跨镜头不能变化的细节。",
          "",
        ].join("\n"),
        { flag: "wx" },
      );
    },
    {
      // The LOOK prefix is a relation key used by scenes and shots, not only a directory decoration.
      identityPrefix: lookId,
      identityDuplicateMessage: "This character already has a costume look with that stable LOOK ID.",
    },
  );
  const relativePath = makeRelative(root, target);
  await writeAudit({
    action: "create-character-look",
    characterPath: characterAsset.character.rootPath,
    path: relativePath,
    lookId,
  });
  return relativePath;
}

export async function createShotAsset(
  sceneId: string,
  shotId: string,
  title: string,
  draft?: ShotDesign,
  source?: ShotSource,
): Promise<string> {
  const safeSceneId = validateNewName(sceneId);
  const safeShotId = normalizeShotId(shotId);
  if (!safeShotId) throw new ProjectPathError("Use a numeric shot ID such as SH001.");
  const safeTitle = validateNewName(title);
  const design = validateShotDesign({
    sceneId: safeSceneId,
    shotId: safeShotId,
    title: safeTitle,
    timecode: draft?.timecode ?? "",
    duration: draft?.duration ?? "",
    framing: draft?.framing ?? "",
    content: draft?.content ?? "",
    dialogue: draft?.dialogue ?? "",
    camera: draft?.camera ?? "",
    prompt: draft?.prompt ?? "",
    negativePrompt: draft?.negativePrompt ?? "",
    firstFramePrompt: draft?.firstFramePrompt ?? "",
    firstFrameNegativePrompt: draft?.firstFrameNegativePrompt ?? "",
    lastFramePrompt: draft?.lastFramePrompt ?? "",
    lastFrameNegativePrompt: draft?.lastFrameNegativePrompt ?? "",
    references: draft?.references ?? "",
    characterOverrides: draft?.characterOverrides ?? [],
    status: draft?.status === "待创建镜头资产" ? "待生成" : (draft?.status ?? "待生成"),
  });
  const snapshot = await getAssetWorkspaceSnapshot();
  design.characterOverrides = validateResolvedShotCharacterOverrides(
    design.characterOverrides ?? [],
    snapshot,
    design.sceneId,
    design.shotId,
  );
  const duplicate = snapshot.shots.some((shot) =>
    !shot.isDraft && getShotIdentityKey(shot.design) === getShotIdentityKey(design),
  );
  if (duplicate) throw new ProjectPathError("A shot with that scene and shot ID already exists.");
  const root = await getProjectRoot();
  await getVerifiedWorkbenchDirectory(root);
  const { directory: sceneRoot, created: sceneCreated } = await ensureSceneAssetDirectory(safeSceneId, source);
  const target = await createAssetDirectory(
    sceneRoot,
    `${safeShotId}-${safeTitle}`,
    SHOT_SLOT_DEFINITIONS,
    async (directory) => {
      await fs.writeFile(
        path.join(directory, "镜头.md"),
        serializeShotDesign(design, undefined, source),
        { flag: "wx" },
      );
    },
    { identityPrefix: safeShotId },
  );
  const relativePath = makeRelative(root, target);
  await writeAudit({ action: "create-shot", path: relativePath, sceneCreated });
  return relativePath;
}

function isStoryboardMarkdown(file: IndexedEntry): boolean {
  return getAssetKind(file.name) === "markdown" && file.name.includes("分镜");
}

export async function importStoryboardDrafts(
  sourcePath: string,
  selectedShotIds?: readonly string[],
): Promise<StoryboardImportResult> {
  const visibleSourcePath = assertVisibleProjectPath(sourcePath);
  const root = await getProjectRoot();
  const index = await scanVisibleProject(root);
  const source = index.files.find((file) => file.relativePath === visibleSourcePath && isStoryboardMarkdown(file));
  if (!source) {
    throw new ProjectPathError("Choose a discovered storyboard script inside the active project.");
  }

  const parsedDrafts = parseStoryboardDrafts(source, await readIndexedText(source));
  const result: StoryboardImportResult = {
    sourcePath: visibleSourcePath,
    created: [],
    skipped: [],
    errors: [],
    warnings: [],
  };
  const draftsByIdentity = new Map<string, ParsedStoryboardDraft>();
  const draftsByShotId = new Map<string, ParsedStoryboardDraft[]>();
  const duplicateSourceIdentities = new Set<string>();
  for (const draft of parsedDrafts) {
    const identity = getShotIdentityKey(draft.asset.design);
    if (draftsByIdentity.has(identity)) {
      duplicateSourceIdentities.add(identity);
      continue;
    }
    draftsByIdentity.set(identity, draft);
    const matchingShotIds = draftsByShotId.get(draft.asset.design.shotId) ?? [];
    matchingShotIds.push(draft);
    draftsByShotId.set(draft.asset.design.shotId, matchingShotIds);
  }

  const snapshot = await getAssetWorkspaceSnapshot();
  const storedKeys = new Set(
    snapshot.shots
      .filter((shot) => !shot.isDraft)
      .map((shot) => getShotIdentityKey(shot.design)),
  );

  const requests = selectedShotIds === undefined
    ? [...draftsByIdentity.values()].map((draft) => ({
      requestedId: getStoryboardDraftSelector(draft),
      identity: getShotIdentityKey(draft.asset.design),
      shotId: draft.asset.design.shotId,
    }))
    : [...new Set(selectedShotIds.map((shotId) => shotId.trim()).filter(Boolean))]
      .map(parseStoryboardDraftRequest)
      .filter((request): request is StoryboardDraftRequest => Boolean(request));

  for (const request of requests) {
    let draft: ParsedStoryboardDraft | undefined;
    if (request.identity) {
      draft = draftsByIdentity.get(request.identity);
    } else if (request.shotId) {
      const matches = draftsByShotId.get(request.shotId) ?? [];
      if (matches.length > 1) {
        const choices = matches.map(getStoryboardDraftSelector).join("、");
        result.errors.push({
          shotId: request.requestedId,
          error: `来源脚本中“${request.shotId}”存在于多个场次；请使用场次限定的镜头编号，例如：${choices}。`,
        });
        continue;
      }
      draft = matches[0];
    }

    if (!draft) {
      result.errors.push({ shotId: request.requestedId || "未命名镜头", error: "来源脚本中找不到这个镜头。" });
      continue;
    }
    const identity = getShotIdentityKey(draft.asset.design);
    const resultShotId = (draftsByShotId.get(draft.asset.design.shotId)?.length ?? 0) > 1
      ? getStoryboardDraftSelector(draft)
      : draft.asset.design.shotId;
    if (duplicateSourceIdentities.has(identity)) {
      result.skipped.push({ shotId: resultShotId, reason: "来源脚本中同场次存在重复镜号，需先在剧本中消除歧义。" });
      continue;
    }
    if (storedKeys.has(identity)) {
      result.skipped.push({ shotId: resultShotId, reason: "当前项目已建立同场次、同镜号的镜头资产。" });
      continue;
    }

    result.warnings.push(...draft.warnings);
    try {
      const path = await createShotAsset(
        draft.asset.design.sceneId,
        draft.asset.design.shotId,
        draft.asset.design.title,
        draft.asset.design,
        draft.source,
      );
      storedKeys.add(identity);
      result.created.push({ shotId: resultShotId, path });
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法建立镜头资产。";
      if (message.includes("already exists")) {
        result.skipped.push({ shotId: resultShotId, reason: "当前项目已建立同场次、同镜号的镜头资产。" });
      } else {
        result.errors.push({ shotId: resultShotId, error: message });
      }
    }
  }

  result.warnings = [...new Set(result.warnings)];
  await writeAudit({
    action: "import-storyboard-drafts",
    sourcePath: visibleSourcePath,
    requestedShotIds: requests.map((request) => request.requestedId),
    created: result.created.map((entry) => entry.shotId),
    skipped: result.skipped.map((entry) => entry.shotId),
    errors: result.errors.map((entry) => entry.shotId),
  });
  return result;
}

export async function updateCharacterProfile(
  assetPath: string,
  content: string,
  expectedRevision: string,
): Promise<string> {
  const asset = await getVerifiedWorkspaceAsset("character", assetPath);
  const safeContent = validateLongText(content, "Character profile");
  const absoluteRoot = await resolveMutableExistingPath(asset.rootPath);
  const target = path.join(absoluteRoot, "角色设定.md");
  await withDirectoryLock(absoluteRoot, async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    await writeTextAtomically(target, safeContent.endsWith("\n") ? safeContent : `${safeContent}\n`);
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({ action: "update-character-profile", path: relativePath });
  return relativePath;
}

export async function updateCharacterLookDocument(
  characterPath: string,
  lookPath: string,
  content: string,
  expectedRevision: string,
): Promise<string> {
  const { character, look } = await getVerifiedCharacterLook(characterPath, lookPath);
  const safeContent = validateLongText(content, "Character look document");
  const absoluteRoot = await resolveMutableExistingPath(look.rootPath);
  const target = path.join(absoluteRoot, CHARACTER_LOOK_DOCUMENT);
  await withDirectoryLock(absoluteRoot, async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    await writeTextAtomically(target, safeContent.endsWith("\n") ? safeContent : `${safeContent}\n`);
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({
    action: "update-character-look-document",
    characterPath: character.rootPath,
    lookPath: look.rootPath,
    path: relativePath,
  });
  return relativePath;
}

export async function updateSceneDocument(
  assetPath: string,
  content: string,
  expectedRevision: string,
): Promise<string> {
  const asset = await getVerifiedWorkspaceAsset("scene", assetPath);
  if (!asset.scene?.scenePath) {
    throw new ProjectPathError("Complete this scene asset before editing its scene document.");
  }
  const safeContent = validateLongText(content, "Scene document");
  const target = await resolveMutableExistingPath(asset.scene.scenePath);
  await withDirectoryLock(path.dirname(target), async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    await writeTextAtomically(target, safeContent.endsWith("\n") ? safeContent : `${safeContent}\n`);
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({ action: "update-scene-document", path: relativePath });
  return relativePath;
}

async function updateSimpleDocument(
  assetType: "location" | "prop",
  assetPath: string,
  content: string,
  expectedRevision: string,
): Promise<string> {
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  const selected = assetType === "location" ? asset.location : asset.prop;
  const documentName = assetType === "location" ? "场景设定.md" : "道具设定.md";
  if (!selected) throw new ProjectPathError("所选资产已不存在。");
  const safeContent = validateLongText(content, assetType === "location" ? "Location document" : "Prop document");
  const absoluteRoot = await resolveMutableExistingPath(selected.rootPath);
  const target = path.join(absoluteRoot, documentName);
  await withDirectoryLock(absoluteRoot, async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    await writeTextAtomically(target, safeContent.endsWith("\n") ? safeContent : `${safeContent}\n`);
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({ action: `update-${assetType}-document`, path: relativePath });
  return relativePath;
}

export async function updateLocationDocument(assetPath: string, content: string, expectedRevision: string): Promise<string> {
  return updateSimpleDocument("location", assetPath, content, expectedRevision);
}

export async function updatePropDocument(assetPath: string, content: string, expectedRevision: string): Promise<string> {
  return updateSimpleDocument("prop", assetPath, content, expectedRevision);
}

export async function updateSceneCastBindings(
  assetPath: string,
  bindings: SceneCastBinding[],
  expectedRevision: string,
): Promise<string> {
  const asset = await getVerifiedWorkspaceAsset("scene", assetPath);
  if (!asset.scene?.castPath) {
    throw new ProjectPathError("Complete this scene asset before editing its character and costume plan.");
  }
  const snapshot = await getAssetWorkspaceSnapshot();
  const safeBindings = validateSceneCastBindings(bindings, snapshot);
  const target = await resolveMutableExistingPath(asset.scene.castPath);
  await withDirectoryLock(path.dirname(target), async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    await writeTextAtomically(
      target,
      serializeSceneCastDocument(asset.scene!.sceneId, safeBindings, currentContent),
    );
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({
    action: "update-scene-cast-bindings",
    path: relativePath,
    bindings: safeBindings.map((binding) => ({
      characterPath: binding.characterPath,
      ...(binding.lookPath ? { lookPath: binding.lookPath } : {}),
      startShotId: binding.startShotId,
      endShotId: binding.endShotId,
    })),
  });
  return relativePath;
}

export async function updateSceneAssetBindings(
  assetPath: string,
  bindings: { locations: SceneLocationBinding[]; props: ScenePropBinding[] },
  expectedRevision: string,
): Promise<string> {
  const asset = await getVerifiedWorkspaceAsset("scene", assetPath);
  if (!asset.scene) throw new ProjectPathError("所选场次资产已不存在。");
  const snapshot = await getAssetWorkspaceSnapshot();
  const safeBindings = validateSceneAssetBindings(bindings?.locations, bindings?.props, snapshot, asset.scene.sceneId);
  const target = path.join(await resolveMutableExistingPath(asset.scene.rootPath), SCENE_ASSET_BINDINGS_DOCUMENT);
  await withDirectoryLock(path.dirname(target), async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    await writeTextAtomically(
      target,
      serializeSceneAssetBindingsDocument(asset.scene!.sceneId, safeBindings.locations, safeBindings.props, currentContent),
    );
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({
    action: "update-scene-asset-bindings",
    path: relativePath,
    locations: safeBindings.locations.map((binding) => binding.locationPath),
    props: safeBindings.props.map((binding) => binding.propPath),
  });
  return relativePath;
}

function getCharacterVisualSlotDefinition(slotKey: CharacterVisualSlotKey): SlotDefinition {
  const definition = CHARACTER_SLOT_DEFINITIONS.find((slot) => slot.key === slotKey);
  if (!definition) {
    throw new ProjectPathError("That visual material slot is not available for character selection.");
  }
  return definition;
}

export async function setCharacterVisualSelection(
  assetPath: string,
  slotKey: CharacterVisualSlotKey,
  fileName: string,
  lookPath?: string,
): Promise<string> {
  if (!isCharacterVisualSlotKey(slotKey)) {
    throw new ProjectPathError("That visual material slot is not available for character selection.");
  }
  return setWorkspaceVisualSelection("character", assetPath, slotKey, fileName, lookPath);
}

/**
 * Marks one image in any recognized visual slot as the selected reference.
 * The filename suffix is the persisted state, so no duplicate media copy is
 * needed and the same rule works for character, scene, and shot frame slots.
 */
export async function setWorkspaceVisualSelection(
  assetType: WorkspaceAssetType,
  assetPath: string,
  slotKey: string,
  fileName: string,
  lookPath?: string,
): Promise<string> {
  const definition = getSlotDefinition(assetType, slotKey);
  if (assetType !== "character" && lookPath?.trim()) {
    throw new ProjectPathError("Only character assets may target a costume look.");
  }
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  if (assetType === "character" && !asset.character) {
    throw new ProjectPathError("The selected character asset no longer exists.");
  }
  const selectedLook = assetType === "character" && lookPath?.trim() && asset.character
    ? (await getVerifiedCharacterLook(asset.character.rootPath, lookPath)).look
    : undefined;
  const visualAssetRoot = selectedLook?.rootPath ?? asset.rootPath;
  const visualAssetSlots = selectedLook?.slots ?? asset.slots;
  const safeName = validateNewName(fileName);
  const candidate = visualAssetSlots.find((slot) => slot.key === slotKey)?.files
    .find((file) => file.name === safeName);
  if (!candidate || candidate.kind !== "image") {
    throw new ProjectPathError(`Choose an image from this asset's ${definition.label} candidates.`);
  }

  const root = await getProjectRoot();
  const assetRoot = await resolveMutableExistingPath(asset.rootPath);
  const visualDirectory = await resolveMutableExistingPath(
    path.posix.join(visualAssetRoot, definition.directory),
  );
  assertInsideRoot(assetRoot, visualDirectory);

  const finalPath = await withDirectoryLock(visualDirectory, async () => {
    const directoryEntry = await fs.lstat(visualDirectory);
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink()) {
      throw new ProjectPathError(`The ${definition.label} candidate folder is unavailable.`);
    }

    const source = path.join(/* turbopackIgnore: true */ visualDirectory, safeName);
    assertInsideRoot(root, source);
    const sourceEntry = await fs.lstat(source);
    if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink() || getAssetKind(safeName) !== "image") {
      throw new ProjectPathError(`Choose a regular image from this character's ${definition.label} candidates.`);
    }

    // A manually renamed file may already have the selected suffix. It still
    // needs to participate in the transaction so one click can repair a slot
    // containing more than one selected candidate.
    const sourceIsSelected = isSelectedVisualFileName(safeName);
    const selectedName = sourceIsSelected ? safeName : makeSelectedVisualFileName(safeName);
    const target = path.join(visualDirectory, selectedName);
    assertInsideRoot(root, target);
    if (!sourceIsSelected) await assertTargetDoesNotExist(target);

    const selectedCandidates = await Promise.all((await fs.readdir(
      /* turbopackIgnore: true */ visualDirectory,
      { withFileTypes: true },
    ))
      .filter((entry) => !entry.name.startsWith(".")
        && entry.isFile()
        && !entry.isSymbolicLink()
        && isSelectedVisualFileName(entry.name)
        && entry.name !== safeName)
      .map(async (entry) => {
        const selectedPath = path.join(/* turbopackIgnore: true */ visualDirectory, entry.name);
        const selectedEntry = await fs.lstat(selectedPath);
        if (!selectedEntry.isFile() || selectedEntry.isSymbolicLink()) {
          throw new ProjectPathError(`The current selected ${definition.label} candidate is unavailable.`);
        }
        const restoredName = makeUnselectedVisualFileName(entry.name);
        const restoredPath = path.join(/* turbopackIgnore: true */ visualDirectory, restoredName);
        assertInsideRoot(root, restoredPath);
        await assertTargetDoesNotExist(restoredPath);
        return {
          selectedName: entry.name,
          selectedPath,
          restoredName,
          restoredPath,
          temporaryPath: path.join(visualDirectory, `.${entry.name}.${randomUUID()}.tmp`),
        };
      }));

    // Keep the chosen selected file in place and only restore every other
    // selected candidate. This makes a manually duplicated selection
    // recoverable through the normal UI rather than requiring shell access.
    const previousSelections = selectedCandidates;
    if (sourceIsSelected && !previousSelections.length) {
      return makeRelative(root, source);
    }

    let targetCreated = false;
    const movedSelections: typeof previousSelections = [];
    const restoredSelections: typeof previousSelections = [];
    try {
      // Stage old selections first so changing one selection never overwrites another candidate.
      for (const selection of previousSelections) {
        await fs.rename(selection.selectedPath, selection.temporaryPath);
        movedSelections.push(selection);
      }
      if (!sourceIsSelected) {
        await fs.rename(source, target);
        targetCreated = true;
      }
      for (const selection of previousSelections) {
        await fs.rename(selection.temporaryPath, selection.restoredPath);
        restoredSelections.push(selection);
      }
    } catch (error) {
      // Restore every completed step in reverse order. If another external
      // process prevents rollback, make that state explicit instead of
      // claiming a failed selection left the folder unchanged.
      const rollbackErrors: unknown[] = [];
      for (const selection of [...restoredSelections].reverse()) {
        try {
          await fs.rename(selection.restoredPath, selection.temporaryPath);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (targetCreated) {
        try {
          await fs.rename(target, source);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      for (const selection of [...movedSelections].reverse()) {
        try {
          await fs.rename(selection.temporaryPath, selection.selectedPath);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length) {
        console.error("Unable to fully restore a failed visual selection.", {
          assetType,
          assetPath: asset.rootPath,
          slotKey,
          visualDirectory,
          error,
          rollbackErrors,
        });
        throw new ProjectPathError(
          `Unable to switch the ${definition.label} selection and fully restore its previous filenames. Refresh this asset before retrying.`,
        );
      }
      throw error;
    }

    return makeRelative(root, target);
  });

  await writeAudit({
    action: assetType === "character" ? "set-character-visual-selection" : "set-workspace-visual-selection",
    assetType,
    assetPath: asset.rootPath,
    ...(selectedLook ? { lookPath: selectedLook.rootPath } : {}),
    slot: slotKey,
    finalPath,
  });
  return finalPath;
}

// Preserve the original public function while callers move to the generic visual-slot action.
export async function setCharacterTurnaround(assetPath: string, fileName: string): Promise<string> {
  return setCharacterVisualSelection(assetPath, "turnaround", fileName);
}

export async function updateShotDesign(
  assetPath: string,
  design: ShotDesign,
  expectedRevision: string,
): Promise<string> {
  const asset = await getVerifiedWorkspaceAsset("shot", assetPath);
  const shot = asset.shot;
  if (!shot?.designPath) throw new ProjectPathError("The selected shot has no design document.");
  const target = await resolveMutableExistingPath(shot.designPath);
  const validatedDesign = validateShotDesign(design);
  const snapshot = await getAssetWorkspaceSnapshot();
  validatedDesign.characterOverrides = validateResolvedShotCharacterOverrides(
    validatedDesign.characterOverrides ?? [],
    snapshot,
    shot.design.sceneId,
    shot.design.shotId,
  );
  assertUnchangedShotIdentity(validatedDesign, shot.design);
  assertUnchangedShotTitle(validatedDesign, shot.design);
  await withDirectoryLock(path.dirname(target), async () => {
    const existingMarkdown = await readEditableShotMarkdown(target);
    assertCurrentTextRevision(expectedRevision, existingMarkdown);
    await writeTextAtomically(target, serializeShotDesign({
      ...validatedDesign,
      sceneId: shot.design.sceneId,
      shotId: shot.design.shotId,
    }, existingMarkdown));
  });
  await writeAudit({ action: "update-shot-design", path: shot.designPath });
  return shot.designPath;
}

export async function renameWorkspaceAsset(
  assetType: WorkspaceAssetType,
  assetPath: string,
  name: string,
): Promise<string> {
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  if (assetType === "character") {
    const safeName = validateNewName(name);
    if (safeName === path.basename(asset.rootPath)) return asset.rootPath;
    const normalizedName = safeName.toLocaleLowerCase("en-US");
    const snapshot = await getAssetWorkspaceSnapshot();
    if (!asset.character) throw new ProjectPathError("The selected character asset no longer exists.");
    assertCharacterIsNotReferenced(snapshot, asset.character, "重命名");
    const duplicate = snapshot.characters.some((character) =>
      character.rootPath !== asset.rootPath
      && character.name.toLocaleLowerCase("en-US") === normalizedName,
    );
    if (duplicate) throw new ProjectPathError("A character with that name already exists.");
    return renameAsset(asset.rootPath, safeName);
  }

  if (assetType === "scene") {
    throw new ProjectPathError("场次编号同时是其下镜头的稳定身份，当前不支持重命名场次资产。");
  }

  if (assetType === "location" || assetType === "prop") {
    const selected = assetType === "location" ? asset.location : asset.prop;
    if (!selected) throw new ProjectPathError("所选资产已不存在。");
    const safeName = validateNewName(name);
    if (safeName === path.basename(selected.rootPath)) return selected.rootPath;
    const snapshot = await getAssetWorkspaceSnapshot();
    assertSimpleAssetIsNotReferenced(snapshot, selected, assetType, "重命名");
    const siblings = assetType === "location" ? snapshot.locations : snapshot.props;
    if (siblings.some((candidate) =>
      candidate.rootPath !== selected.rootPath
      && candidate.name.toLocaleLowerCase("en-US") === safeName.toLocaleLowerCase("en-US"),
    )) {
      throw new ProjectPathError("同类型资产中已经存在同名项目。");
    }
    const renamed = await renameAsset(selected.rootPath, safeName);
    await writeAudit({ action: `rename-${assetType}`, from: selected.rootPath, path: renamed });
    return renamed;
  }

  if (!asset.shot) throw new ProjectPathError("The selected shot asset no longer exists.");
  const safeInput = validateNewName(name);
  const prefixed = safeInput.match(/^((?:SH)?\d+)(?:[-_\s]+(.+))?$/i);
  if (prefixed && normalizeShotId(prefixed[1]) !== asset.shot.design.shotId) {
    throw new ProjectPathError("A shot rename cannot change its shot ID.");
  }
  const title = validateNewName(prefixed?.[2] || safeInput);
  const directoryName = `${asset.shot.design.shotId}-${title}`;
  if (directoryName === path.basename(asset.rootPath) && title === asset.shot.design.title) {
    return asset.rootPath;
  }
  const identity = getShotIdentityKey(asset.shot.design);
  const duplicate = (await getAssetWorkspaceSnapshot()).shots.some((shot) =>
    !shot.isDraft
    && shot.rootPath !== asset.rootPath
    && getShotIdentityKey(shot.design) === identity,
  );
  if (duplicate) throw new ProjectPathError("A shot with that scene and shot ID already exists.");
  const root = await getProjectRoot();
  const source = await resolveMutableExistingPath(asset.rootPath);
  const parent = path.dirname(source);
  const target = await resolveWritablePath(path.join(path.dirname(asset.rootPath), directoryName));
  const destination = await withDirectoryLock(parent, async () => {
    const siblings = await fs.readdir(parent, { withFileTypes: true });
    const sameIdentityAlreadyExists = siblings.some((entry) =>
      entry.isDirectory()
      && entry.name !== path.basename(source)
      && (entry.name === asset.shot!.design.shotId || entry.name.startsWith(`${asset.shot!.design.shotId}-`)),
    );
    if (sameIdentityAlreadyExists) {
      throw new ProjectPathError("A shot with that scene and shot ID already exists.");
    }
    await assertTargetDoesNotExist(target);

    const sourceDesignPath = path.join(source, "镜头.md");
    const existingMarkdown = await readEditableShotMarkdown(sourceDesignPath);
    const nextMarkdown = serializeShotDesign({ ...asset.shot!.design, title }, existingMarkdown);
    if (Buffer.byteLength(nextMarkdown, "utf8") > MAX_TEXT_ASSET_BYTES) {
      throw new ProjectPathError("Text assets must be smaller than 2 MB.");
    }

    // Prepare the new document before moving the directory so a failed write leaves no visible rename.
    const temporaryName = `.镜头.md.${randomUUID()}.rename`;
    const temporarySourcePath = path.join(source, temporaryName);
    await fs.writeFile(temporarySourcePath, nextMarkdown, { flag: "wx" });

    let directoryRenamed = false;
    try {
      await fs.rename(source, target);
      directoryRenamed = true;
      await fs.rename(path.join(target, temporaryName), path.join(target, "镜头.md"));
    } catch (error) {
      if (directoryRenamed) {
        try {
          await fs.rename(target, source);
        } catch (rollbackError) {
          console.error("Unable to restore a shot directory after its title update failed.", {
            source,
            target,
            rollbackError,
          });
        }
      }
      await fs.rm(temporarySourcePath, { force: true }).catch((cleanupError) => {
        console.error("Unable to remove the staged shot title update.", { temporarySourcePath, cleanupError });
      });
      throw error;
    }

    return makeRelative(root, target);
  });
  await writeAudit({ action: "rename-shot-title", from: asset.rootPath, path: destination, title });
  return destination;
}

export async function trashWorkspaceAsset(
  assetType: WorkspaceAssetType,
  assetPath: string,
): Promise<string> {
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  if (assetType === "character" && asset.character) {
    assertCharacterIsNotReferenced(
      await getAssetWorkspaceSnapshot(),
      asset.character,
      "移入回收站",
    );
  }
  if ((assetType === "location" && asset.location) || (assetType === "prop" && asset.prop)) {
    assertSimpleAssetIsNotReferenced(await getAssetWorkspaceSnapshot(), assetType === "location" ? asset.location! : asset.prop!, assetType, "移入回收站");
  }
  return moveToTrash(asset.rootPath);
}

export async function trashWorkspaceAssetFile(
  assetType: WorkspaceAssetType,
  assetPath: string,
  slotKey: string,
  fileName: string,
  lookPath?: string,
): Promise<string> {
  getSlotDefinition(assetType, slotKey);
  if (assetType !== "character" && lookPath?.trim()) {
    throw new ProjectPathError("Only character assets may target a costume look.");
  }
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  const selectedLook = assetType === "character" && lookPath?.trim() && asset.character
    ? (await getVerifiedCharacterLook(asset.character.rootPath, lookPath)).look
    : undefined;
  const slots = selectedLook?.slots ?? asset.slots;
  const safeName = validateNewName(fileName);
  const file = slots.find((slot) => slot.key === slotKey)?.files
    .find((candidate) => candidate.name === safeName);
  if (!file) throw new ProjectPathError("That file is not part of the selected asset slot.");
  if (file.kind === "image" && isSelectedVisualFileName(file.name)) {
    throw new ProjectPathError("Choose another image before removing the current selected visual reference.");
  }
  if (
    assetType === "character"
    && isCharacterVisualSlotKey(slotKey)
    && (selectedLook?.confirmedVisualSourcePaths[slotKey]
      ?? asset.character?.confirmedVisualSourcePaths[slotKey]) === file.path
  ) {
    const label = getCharacterVisualSlotDefinition(slotKey).label;
    throw new ProjectPathError(`Choose another ${label} candidate before removing the current confirmed one.`);
  }
  return moveToTrash(file.path);
}

export async function saveAssetUploadStream(
  assetType: WorkspaceAssetType,
  assetPath: string,
  slotKey: string,
  fileName: string,
  source: AsyncIterable<Uint8Array>,
  lookPath?: string,
): Promise<string> {
  const definition = getSlotDefinition(assetType, slotKey);
  if (assetType !== "character" && lookPath?.trim()) {
    throw new ProjectPathError("Only character assets may target a costume look.");
  }
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  const selectedLook = assetType === "character" && lookPath?.trim() && asset.character
    ? (await getVerifiedCharacterLook(asset.character.rootPath, lookPath)).look
    : undefined;
  const safeName = normalizeUploadedCandidateFileName(validateNewName(fileName));
  const root = await getProjectRoot();
  const absoluteRoot = await resolveMutableExistingPath(selectedLook?.rootPath ?? asset.rootPath);
  const uploadDirectory = await getVerifiedUploadDirectory(root);
  const temporary = path.join(uploadDirectory, `${randomUUID()}.part`);
  assertInsideRoot(root, temporary);

  let handle: FileHandle | undefined;
  let totalBytes = 0;
  const probeChunks: Buffer[] = [];
  let probeBytes = 0;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_ASSET_UPLOAD_BYTES) {
        throw new ProjectPayloadTooLargeError("Each uploaded file must be at most 200 MB.");
      }
      if (probeBytes < UPLOAD_PROBE_BYTES) {
        const portion = buffer.subarray(0, Math.min(buffer.byteLength, UPLOAD_PROBE_BYTES - probeBytes));
        if (portion.byteLength) {
          probeChunks.push(portion);
          probeBytes += portion.byteLength;
        }
      }
      await writeBufferFully(handle, buffer);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;

    if (!totalBytes) throw new ProjectPathError("Upload a non-empty media file.");
    assertValidUploadMedia(assetType, slotKey, safeName, Buffer.concat(probeChunks, probeBytes));

    const slotDirectory = await ensureVerifiedInternalDirectory(root, absoluteRoot, definition.directory);
    const target = path.join(slotDirectory, safeName);
    assertInsideRoot(root, target);
    await withDirectoryLock(slotDirectory, async () => {
      // link() publishes the fully-written staging file without ever replacing an existing user file.
      await fs.link(temporary, target);
    });

    const relativePath = makeRelative(root, target);
    await writeAudit({
      action: "upload-asset-file",
      assetType,
      assetPath: asset.rootPath,
      ...(selectedLook ? { lookPath: selectedLook.rootPath } : {}),
      slot: slotKey,
      path: relativePath,
      bytes: totalBytes,
    });
    return relativePath;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    // The target has its own hard link after publication; this only removes our hidden staging file.
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function createShotFolder(episodeId: string, shotId: string, title: string): Promise<string> {
  return createShotAsset(episodeId, shotId, title);
}
