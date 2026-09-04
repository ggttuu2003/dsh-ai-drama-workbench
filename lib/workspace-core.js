// src/workspace-core.ts
import { promises as fs } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

// src/workspace-types.ts
var CHARACTER_VISUAL_SLOT_KEYS = ["turnaround"];

// src/workspace-core.ts
var DEFAULT_LIBRARY_ROOT = path.resolve(
  process.cwd(),
  "../ai-play-test"
);
var DEFAULT_PROJECT_ID = "my-first-01";
var HIDDEN_DIRECTORIES = /* @__PURE__ */ new Set([".git", "node_modules", ".next", ".workbench"]);
var PROJECT_INDEX_PATH = ".workbench/index.json";
var PROJECT_JSON_PATH = ".workbench/project.json";
var PROJECT_SNAPSHOT_SCHEMA_VERSION = 3;
var LEGACY_PROJECT_SNAPSHOT_SCHEMA_VERSIONS = /* @__PURE__ */ new Set([1, 2]);
var MAX_PROJECT_JSON_BYTES = 20 * 1024 * 1024;
var MAX_PROJECT_INDEX_BYTES = 1024 * 1024;
var MAX_TEXT_ASSET_BYTES = 2e6;
var SELECTED_VISUAL_SUFFIX = "-\u5DF2\u9009";
var TRASH_METADATA_FILE = ".workbench-trash.json";
var TRASH_ENTRY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
var CHARACTER_LOOK_DIRECTORY = "\u9020\u578B";
var CHARACTER_LOOK_DOCUMENT = "\u9020\u578B\u8BBE\u5B9A.md";
var CHARACTER_PROFILE_JSON = "\u89D2\u8272\u8BBE\u5B9A.json";
var CHARACTER_LOOK_JSON = "\u9020\u578B\u8BBE\u5B9A.json";
var LOCATION_PROFILE_JSON = "\u573A\u666F\u8BBE\u5B9A.json";
var PROP_PROFILE_JSON = "\u9053\u5177\u8BBE\u5B9A.json";
var SCENE_DOCUMENT_JSON = "\u573A\u6B21.json";
var SCENE_CAST_DOCUMENT = "\u51FA\u573A\u4E0E\u9020\u578B\u8868.md";
var SCENE_CAST_MARKER_START = "<!-- workbench:scene-cast:start -->";
var SCENE_CAST_MARKER_END = "<!-- workbench:scene-cast:end -->";
var SCENE_CAST_PROJECTION_MARKER_START = "<!-- workbench:scene-cast:projection:start -->";
var SCENE_CAST_PROJECTION_MARKER_END = "<!-- workbench:scene-cast:projection:end -->";
var SCENE_ASSET_BINDINGS_DOCUMENT = "\u573A\u6B21\u8D44\u4EA7\u8868.md";
var SCENE_ASSET_BINDINGS_MARKER_START = "<!-- workbench:scene-assets:start -->";
var SCENE_ASSET_BINDINGS_MARKER_END = "<!-- workbench:scene-assets:end -->";
var SCENE_ASSET_BINDINGS_PROJECTION_MARKER_START = "<!-- workbench:scene-assets:projection:start -->";
var SCENE_ASSET_BINDINGS_PROJECTION_MARKER_END = "<!-- workbench:scene-assets:projection:end -->";
var SHOT_CHARACTER_OVERRIDES_MARKER_START = "<!-- workbench:shot-character-overrides:start -->";
var SHOT_CHARACTER_OVERRIDES_MARKER_END = "<!-- workbench:shot-character-overrides:end -->";
var DOCUMENT_SIDECAR_VERSION = 1;
var DEFAULT_CHARACTER_ROLE_CATEGORY = "\u5F85\u5206\u7C7B";
var CHARACTER_ROLE_SORT_ORDER = [
  "\u4E3B\u89D2",
  "\u5973\u4E3B",
  "\u91CD\u8981\u914D\u89D2",
  "\u914D\u89D2",
  "\u53CD\u6D3E",
  "\u7FA4\u50CF",
  "\u5176\u4ED6",
  "\u5F85\u5206\u7C7B"
];
var CHARACTER_SLOT_DEFINITIONS = [
  { key: "turnaround", label: "\u4E09\u89C6\u56FE", directory: "\u4E09\u89C6\u56FE" }
];
var LEGACY_CHARACTER_SLOT_DIRECTORIES = /* @__PURE__ */ new Set(["\u53C2\u8003\u56FE", "\u5B9A\u5986"]);
var SHOT_SLOT_DEFINITIONS = [
  { key: "reference", label: "\u53C2\u8003\u56FE", directory: "\u53C2\u8003\u56FE" },
  { key: "firstFrame", label: "\u9996\u5E27", directory: "\u9996\u5E27" },
  { key: "lastFrame", label: "\u5C3E\u5E27", directory: "\u5C3E\u5E27" },
  { key: "candidate", label: "\u5019\u9009", directory: "\u5019\u9009" },
  { key: "final", label: "\u5B9A\u7A3F", directory: "\u5B9A\u7A3F" },
  { key: "video", label: "\u6210\u7247", directory: "\u6210\u7247" }
];
var SCENE_SLOT_DEFINITIONS = [
  { key: "candidate", label: "\u5019\u9009", directory: "\u5019\u9009" },
  { key: "final", label: "\u5B9A\u7A3F", directory: "\u5B9A\u7A3F" }
];
var LEGACY_SCENE_SLOT_DIRECTORIES = /* @__PURE__ */ new Set(["\u573A\u666F\u56FE", "\u53C2\u8003\u56FE", "\u9996\u5E27", "\u5C3E\u5E27", "\u6210\u7247"]);
var LOCATION_SLOT_DEFINITIONS = [
  { key: "setting", label: "\u573A\u666F\u56FE", directory: "\u573A\u666F\u56FE" },
  { key: "reference", label: "\u53C2\u8003\u56FE", directory: "\u53C2\u8003\u56FE" },
  { key: "candidate", label: "\u5019\u9009", directory: "\u5019\u9009" },
  { key: "final", label: "\u5B9A\u7A3F", directory: "\u5B9A\u7A3F" }
];
var PROP_SLOT_DEFINITIONS = [
  { key: "reference", label: "\u53C2\u8003\u56FE", directory: "\u53C2\u8003\u56FE" },
  { key: "candidate", label: "\u5019\u9009", directory: "\u5019\u9009" },
  { key: "final", label: "\u5B9A\u7A3F", directory: "\u5B9A\u7A3F" }
];
var imageExtensions = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
var videoExtensions = /* @__PURE__ */ new Set([".mp4", ".webm", ".mov", ".mkv"]);
var documentExtensions = /* @__PURE__ */ new Set([".json", ".yaml", ".yml", ".txt", ".csv"]);
var ProjectPathError = class extends Error {
};
var ProjectConflictError = class extends ProjectPathError {
};
var ProjectPayloadTooLargeError = class extends ProjectPathError {
};
var projectRootContext = new AsyncLocalStorage();
function withProjectRoot(root, operation) {
  return projectRootContext.run(root, operation);
}
function getActiveProjectId() {
  const projectId = (process.env.WORKBENCH_ACTIVE_PROJECT || DEFAULT_PROJECT_ID).trim();
  if (!projectId || projectId.startsWith(".") || projectId !== path.basename(projectId) || /[\\/\\\\\u0000-\u001f]/.test(projectId)) {
    throw new ProjectPathError("The active project name must be a single folder name.");
  }
  return projectId;
}
async function getProjectRoot() {
  const contextualRoot = projectRootContext.getStore();
  if (contextualRoot) return contextualRoot;
  const directProjectRoot = process.env.WORKBENCH_PROJECT_ROOT;
  try {
    if (directProjectRoot) {
      const root2 = await fs.realpath(
        /* turbopackIgnore: true */
        directProjectRoot
      );
      if (!(await fs.stat(root2)).isDirectory()) {
        throw new ProjectPathError("The configured project root must be a directory.");
      }
      return root2;
    }
    const libraryRoot = await fs.realpath(
      /* turbopackIgnore: true */
      process.env.WORKBENCH_LIBRARY_ROOT || DEFAULT_LIBRARY_ROOT
    );
    if (!(await fs.stat(libraryRoot)).isDirectory()) {
      throw new ProjectPathError("The configured asset library must be a directory.");
    }
    const candidate = path.resolve(libraryRoot, getActiveProjectId());
    assertInsideRoot(libraryRoot, candidate);
    const root = await fs.realpath(
      /* turbopackIgnore: true */
      candidate
    );
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
function getAssetKind(fileName, isDirectory = false) {
  if (isDirectory) return "folder";
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".md" || extension === ".mdx") return "markdown";
  if (imageExtensions.has(extension)) return "image";
  if (videoExtensions.has(extension)) return "video";
  if (documentExtensions.has(extension)) return "document";
  return "other";
}
function normalizeRelativePath(relativePath) {
  const candidate = relativePath?.trim() || "";
  if (candidate.includes("\0") || candidate.includes("\\")) {
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
function assertVisibleProjectPath(relativePath, allowRoot = false) {
  const normalized = normalizeRelativePath(relativePath);
  if (!allowRoot && !normalized) {
    throw new ProjectPathError("The project root cannot be changed from the workbench.");
  }
  if (normalized.split(path.sep).some((segment) => segment.startsWith("."))) {
    throw new ProjectPathError("Hidden and workbench-internal paths are not available here.");
  }
  return normalized;
}
function assertInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ProjectPathError("The requested path escapes the project root.");
  }
}
async function resolveExistingPath(relativePath) {
  const root = await getProjectRoot();
  const candidate = path.resolve(root, assertVisibleProjectPath(relativePath));
  assertInsideRoot(root, candidate);
  const actualPath = await fs.realpath(
    /* turbopackIgnore: true */
    candidate
  );
  assertInsideRoot(root, actualPath);
  if (actualPath !== candidate) {
    throw new ProjectPathError("Paths containing symbolic links are not available from the workbench.");
  }
  assertVisibleProjectPath(makeRelative(root, actualPath));
  return actualPath;
}
async function resolveMutableExistingPath(relativePath) {
  const root = await getProjectRoot();
  const candidate = path.resolve(root, assertVisibleProjectPath(relativePath));
  assertInsideRoot(root, candidate);
  const entry = await fs.lstat(candidate);
  if (entry.isSymbolicLink()) {
    throw new ProjectPathError("Symbolic links cannot be changed from the workbench.");
  }
  const actualPath = await fs.realpath(
    /* turbopackIgnore: true */
    candidate
  );
  assertInsideRoot(root, actualPath);
  if (actualPath !== candidate) {
    throw new ProjectPathError("Paths containing symbolic links cannot be changed from the workbench.");
  }
  return candidate;
}
async function resolveWritablePath(relativePath) {
  const root = await getProjectRoot();
  const candidate = path.resolve(root, normalizeRelativePath(relativePath));
  assertInsideRoot(root, candidate);
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
      if (error.code !== "ENOENT") throw error;
      parent = path.dirname(parent);
    }
  }
  const actualRoot = await fs.realpath(
    /* turbopackIgnore: true */
    root
  );
  assertInsideRoot(actualRoot, candidate);
  return candidate;
}
function makeRelative(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}
function createTextRevision(content) {
  return createHash("sha256").update(content, "utf8").digest("base64url");
}
function validateExpectedRevision(value) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ProjectPathError("Refresh this asset before saving it.");
  }
  return value;
}
function assertCurrentTextRevision(expectedRevision, currentContent) {
  if (validateExpectedRevision(expectedRevision) !== createTextRevision(currentContent)) {
    throw new ProjectConflictError("This document changed outside the current editor. Reload the latest version before saving.");
  }
}
async function scanVisibleProject(root) {
  const directories = [];
  const files = [];
  function isLegacySlotDirectory(parent, name) {
    const parentSegments = makeRelative(root, parent).split("/").filter(Boolean);
    if (LEGACY_CHARACTER_SLOT_DIRECTORIES.has(name) && parentSegments[0] === "\u4E3B\u8981\u4EBA\u7269" && (parentSegments.length === 2 || parentSegments.length === 4 && parentSegments[2] === "\u9020\u578B")) return true;
    return LEGACY_SCENE_SLOT_DIRECTORIES.has(name) && parentSegments[0] === "\u5206\u955C" && parentSegments.length === 2;
  }
  async function visit(absoluteDirectory) {
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || HIDDEN_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const stats = await fs.lstat(absolutePath);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory() && isLegacySlotDirectory(absoluteDirectory, entry.name)) continue;
      const indexedEntry = {
        absolutePath,
        relativePath: makeRelative(root, absolutePath),
        name: entry.name,
        stats
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
  const filesByDirectory = /* @__PURE__ */ new Map();
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
function toAssetFile(entry) {
  return {
    name: entry.name,
    path: entry.relativePath,
    kind: getAssetKind(entry.name),
    size: entry.stats.size,
    updatedAt: entry.stats.mtime.toISOString()
  };
}
var CHARACTER_ROLE_ALIASES = [
  ["\u91CD\u8981\u914D\u89D2", "\u91CD\u8981\u914D\u89D2"],
  ["\u5973\u4E3B\u89D2", "\u5973\u4E3B"],
  ["\u7537\u4E3B\u89D2", "\u4E3B\u89D2"],
  ["\u5973\u914D\u89D2", "\u914D\u89D2"],
  ["\u7537\u914D\u89D2", "\u914D\u89D2"],
  ["\u7537\u4E3B", "\u4E3B\u89D2"],
  ["\u5973\u914D", "\u914D\u89D2"],
  ["\u7537\u914D", "\u914D\u89D2"],
  ["\u5F85\u5206\u7C7B", "\u5F85\u5206\u7C7B"],
  ["\u4E3B\u89D2", "\u4E3B\u89D2"],
  ["\u5973\u4E3B", "\u5973\u4E3B"],
  ["\u914D\u89D2", "\u914D\u89D2"],
  ["\u53CD\u6D3E", "\u53CD\u6D3E"],
  ["\u7FA4\u50CF", "\u7FA4\u50CF"],
  ["\u5176\u4ED6", "\u5176\u4ED6"]
];
function parseRoleCategoryValue(value) {
  const normalized = value.replace(/[>*_`#：:；;。！？!?（）()\[\]"'“”‘’/、,，|丨]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!normalized) return void 0;
  for (const [alias, category] of CHARACTER_ROLE_ALIASES) {
    if (normalized === alias || normalized.startsWith(`${alias} `)) return category;
  }
  return void 0;
}
function isCharacterVisualSlotKey(value) {
  return CHARACTER_VISUAL_SLOT_KEYS.includes(value);
}
function isSelectedVisualFileName(fileName) {
  return getAssetKind(fileName) === "image" && path.basename(fileName, path.extname(fileName)).endsWith(SELECTED_VISUAL_SUFFIX);
}
function makeSelectedVisualFileName(fileName) {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  return `${stem}${SELECTED_VISUAL_SUFFIX}${extension}`;
}
function makeUnselectedVisualFileName(fileName) {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  if (!stem.endsWith(SELECTED_VISUAL_SUFFIX)) {
    throw new ProjectPathError("The selected visual filename is invalid.");
  }
  return `${stem.slice(0, -SELECTED_VISUAL_SUFFIX.length)}${extension}`;
}
function normalizeUploadedCandidateFileName(fileName) {
  return isSelectedVisualFileName(fileName) ? makeUnselectedVisualFileName(fileName) : fileName;
}
function findConfirmedVisual(visualFiles) {
  const candidates = visualFiles.filter((file) => file.kind === "image" && isSelectedVisualFileName(file.name)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return candidates[0];
}
function createEmptySlots(definitions) {
  return definitions.map(({ key, label }) => ({ key, label, files: [] }));
}
function readAssetSlots(assetDirectory, definitions, filesByDirectory) {
  return definitions.map(({ key, label, directory }) => ({
    key,
    label,
    files: (filesByDirectory.get(path.join(assetDirectory, directory)) ?? []).map(toAssetFile)
  }));
}
function pickCover(slots, priority) {
  for (const slotKey of priority) {
    const image = slots.find((slot) => slot.key === slotKey)?.files.find((file) => file.kind === "image");
    if (image) return image;
  }
  return void 0;
}
function latestUpdatedAt(fallback, entries) {
  const timestamp = entries.reduce(
    (latest, entry) => Math.max(latest, entry.stats.mtimeMs),
    fallback.stats.mtimeMs
  );
  return new Date(timestamp).toISOString();
}
function getConfirmedVisualMetadata(slots) {
  const confirmedVisuals = {};
  const confirmedVisualSourcePaths = {};
  for (const slotKey of CHARACTER_VISUAL_SLOT_KEYS) {
    const confirmedVisual = findConfirmedVisual(
      slots.find((slot) => slot.key === slotKey)?.files ?? []
    );
    if (!confirmedVisual) continue;
    confirmedVisuals[slotKey] = confirmedVisual;
    confirmedVisualSourcePaths[slotKey] = confirmedVisual.path;
  }
  return { confirmedVisuals, confirmedVisualSourcePaths };
}
function parseCharacterLookDirectoryName(directoryName) {
  const match = directoryName.match(/^((?:[A-Za-z0-9]+-)?LOOK-\d{1,6})(?:[-_\s]+(.+))?$/iu);
  if (match) {
    return {
      id: match[1].toLocaleUpperCase("en-US"),
      name: match[2]?.trim() || match[1].toLocaleUpperCase("en-US")
    };
  }
  return { id: directoryName, name: directoryName };
}
async function buildCharacterLooks(characterDirectory, index) {
  const lookRoot = path.join(characterDirectory.absolutePath, CHARACTER_LOOK_DIRECTORY);
  const lookDirectories = index.directories.filter((directory) => path.dirname(directory.absolutePath) === lookRoot);
  const looks = await Promise.all(lookDirectories.map(async (directory) => {
    const pairedDocument = await readPairedDocument(index, directory, CHARACTER_LOOK_DOCUMENT, CHARACTER_LOOK_JSON, "look");
    const document = pairedDocument.markdown;
    const documentContent = pairedDocument.content;
    const slots = readAssetSlots(directory.absolutePath, CHARACTER_SLOT_DEFINITIONS, index.filesByDirectory);
    const { confirmedVisuals, confirmedVisualSourcePaths } = getConfirmedVisualMetadata(slots);
    const slotFiles = slots.flatMap((slot) => slot.files.map(
      (file) => index.files.find((entry) => entry.relativePath === file.path)
    )).filter((entry) => Boolean(entry));
    const parsedName = parseCharacterLookDirectoryName(directory.name);
    return {
      rootPath: directory.relativePath,
      characterRootPath: characterDirectory.relativePath,
      id: parsedName.id,
      name: parsedName.name,
      ...document ? { documentPath: document.relativePath, documentContent } : {},
      ...pairedDocument.json ? { documentJsonPath: pairedDocument.json.relativePath } : {},
      ...pairedDocument.prompt ? { prompt: pairedDocument.prompt } : {},
      ...pairedDocument.negativePrompt ? { negativePrompt: pairedDocument.negativePrompt } : {},
      documentRevision: createTextRevision(documentContent),
      slots,
      confirmedVisuals,
      confirmedVisualSourcePaths,
      cover: confirmedVisuals.turnaround ?? pickCover(slots, ["turnaround"]),
      updatedAt: latestUpdatedAt(directory, [...document ? [document] : [], ...slotFiles])
    };
  }));
  return looks.sort((left, right) => left.id.localeCompare(right.id, "zh-Hans-CN", { numeric: true }) || left.name.localeCompare(right.name, "zh-Hans-CN"));
}
function normalizeShotId(value) {
  const match = value.trim().match(/^(?:SH)?(\d{1,6})$/i);
  return match ? `SH${match[1].padStart(3, "0")}` : null;
}
function findSceneId(value) {
  const match = value.match(/(?:EP\s*\d+\s*[-_]\s*)?SC\s*\d+/iu);
  return match?.[0].replace(/\s+/gu, "").replaceAll("_", "-").toLocaleUpperCase("en-US");
}
function extractSceneId(fileName, markdown) {
  const headingSceneId = [...markdown.matchAll(/^#{1,6}\s+(.+?)\s*$/gmu)].map((heading) => findSceneId(heading[1])).find((sceneId) => Boolean(sceneId));
  if (headingSceneId) return headingSceneId;
  const candidate = path.basename(fileName, path.extname(fileName));
  const fileNameSceneId = findSceneId(candidate);
  if (fileNameSceneId) return fileNameSceneId;
  return candidate.replace(/[-_]?分镜.*$/u, "").trim() || "\u672A\u5F52\u6863\u573A\u6B21";
}
function isSceneHeading(heading, level) {
  const sceneId = findSceneId(heading);
  if (!sceneId) return void 0;
  const normalizedHeading = heading.trim();
  if (/^(?:镜头|shot)\s*(?:SH\s*)?\d+/iu.test(normalizedHeading)) return void 0;
  const startsWithSceneId = /^(?:[【\[（(]\s*)?(?:EP\s*\d+\s*[-_]\s*)?SC\s*\d+/iu.test(normalizedHeading);
  const hasSceneLabel = /(?:场次|场景|分镜|storyboard|scene)/iu.test(normalizedHeading);
  return startsWithSceneId || hasSceneLabel || level <= 2 ? sceneId : void 0;
}
function splitStoryboardSceneSections(source, markdown) {
  const sceneHeadings = [];
  for (const heading of markdown.matchAll(/^(#{1,6})\s+(.+?)\s*$/gmu)) {
    if (heading.index === void 0) continue;
    const sceneId = isSceneHeading(heading[2], heading[1].length);
    if (!sceneId) continue;
    if (sceneHeadings.at(-1)?.sceneId === sceneId) continue;
    sceneHeadings.push({ sceneId, start: heading.index });
  }
  if (!sceneHeadings.length) {
    return [{
      sceneId: extractSceneId(source.name, markdown),
      markdown,
      hasMultipleScenes: false
    }];
  }
  const hasMultipleScenes = sceneHeadings.length > 1;
  return sceneHeadings.map((heading, index) => ({
    sceneId: heading.sceneId,
    // Preserve a document preamble with the first scene. This keeps existing
    // single-scene files compatible while every later table is unambiguously scoped.
    markdown: markdown.slice(index === 0 ? 0 : heading.start, sceneHeadings[index + 1]?.start ?? markdown.length),
    hasMultipleScenes
  }));
}
function parseBoldFields(markdown) {
  const fields = /* @__PURE__ */ new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+\*\*([^*]+?)(?:[：:]\*\*|\*\*\s*[：:])\s*(.*?)\s*$/u);
    if (match) fields.set(match[1].trim(), match[2].trim());
  }
  return fields;
}
function readField(fields, ...names) {
  for (const name of names) {
    const value = fields.get(name);
    if (value !== void 0) return value;
  }
  return "";
}
function parseCharacterRoleCategory(markdown) {
  const roleFieldNames = ["\u89D2\u8272\u5206\u7C7B", "\u4EBA\u7269\u5206\u7C7B", "\u89D2\u8272\u7C7B\u578B", "\u4EBA\u7269\u7C7B\u578B"];
  const lines = markdown.split(/\r?\n/u);
  let inCodeBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || !trimmed) continue;
    const fieldMatch = [
      /^(?:[-*]\s*)?\*\*(角色分类|人物分类|角色类型|人物类型)\s*[：:]\*\*\s*(.+?)\s*$/u,
      /^(?:[-*]\s*)?\*\*(角色分类|人物分类|角色类型|人物类型)\*\*\s*[：:]\s*(.+?)\s*$/u,
      /^(?:[-*]\s*)?(角色分类|人物分类|角色类型|人物类型)\s*[：:]\s*(.+?)\s*$/u
    ].map((pattern) => trimmed.match(pattern)).find(Boolean);
    if (fieldMatch && roleFieldNames.includes(fieldMatch[1])) {
      const category = parseRoleCategoryValue(fieldMatch[2]);
      if (category) return category;
    }
    const yamlMatch = trimmed.match(/^(?:role|characterRole|角色分类)\s*[：:]\s*(.+?)\s*$/iu);
    if (yamlMatch) {
      const category = parseRoleCategoryValue(yamlMatch[1]);
      if (category) return category;
    }
  }
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
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function readMarkdownSection(markdown, heading) {
  const normalizeTitle = (value) => value.trim().replace(/\s+/gu, " ").replace(/\s*#+\s*$/u, "").replace(/\s*\{#[^}]+[}]\s*$/u, "").replace(/[：:]\s*$/u, "").toLocaleLowerCase("zh-Hans-CN");
  const expected = normalizeTitle(heading);
  if (!expected) return "";
  const lines = String(markdown ?? "").replace(/\r\n?/gu, "\n").split("\n");
  let start = -1;
  let level = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{2,6})\s+(.+?)\s*#?\s*$/u);
    if (!match) continue;
    const title = normalizeTitle(match[2]);
    if (title === expected) {
      start = index + 1;
      level = match[1].length;
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+.+?\s*#?\s*$/u);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}
var TURNAROUND_PROMPT_HEADINGS = [
  "\u4E09\u89C6\u56FE\u63D0\u793A\u8BCD",
  "\u4EBA\u7269\u4E09\u89C6\u56FE\u63D0\u793A\u8BCD",
  "\u89D2\u8272\u4E09\u89C6\u56FE\u63D0\u793A\u8BCD",
  "\u8EAB\u4EFD\u4E09\u89C6\u56FE\u63D0\u793A\u8BCD",
  "\u89C6\u89C9\u63D0\u793A\u8BCD",
  "\u4EBA\u7269\u89C6\u89C9\u63D0\u793A\u8BCD",
  "\u63D0\u793A\u8BCD",
  "turnaround_prompt",
  "turnaround prompt",
  "character_turnaround_prompt",
  "character turnaround prompt"
];
var TURNAROUND_NEGATIVE_HEADINGS = [
  "\u4E09\u89C6\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u4EBA\u7269\u4E09\u89C6\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u89D2\u8272\u4E09\u89C6\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u8EAB\u4EFD\u4E09\u89C6\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u89C6\u89C9\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u8D1F\u9762\u63D0\u793A\u8BCD",
  "turnaround_negative_prompt",
  "turnaround negative prompt",
  "character_turnaround_negative_prompt",
  "character turnaround negative prompt"
];
var LOOK_PROMPT_HEADINGS = [
  "\u9020\u578B\u56FE\u63D0\u793A\u8BCD",
  "\u4EBA\u7269\u9020\u578B\u56FE\u63D0\u793A\u8BCD",
  "\u5B9A\u5986\u56FE\u63D0\u793A\u8BCD",
  "\u9020\u578B\u63D0\u793A\u8BCD",
  // Newer projects keep every character visual in the same 三视图 slot.
  // Accept that label on LOOK documents while retaining the older name.
  "\u4E09\u89C6\u56FE\u63D0\u793A\u8BCD",
  "costume_prompt",
  "costume prompt",
  "look_prompt",
  "look prompt"
];
var LOOK_NEGATIVE_HEADINGS = [
  "\u9020\u578B\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u4EBA\u7269\u9020\u578B\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u5B9A\u5986\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u9020\u578B\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u4E09\u89C6\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u8D1F\u9762\u63D0\u793A\u8BCD",
  "costume_negative_prompt",
  "costume negative prompt",
  "look_negative_prompt",
  "look negative prompt"
];
var PROMPT_METADATA_PREFIXES = [
  "\u63D0\u6848\u6765\u6E90",
  "\u5236\u4F5C\u5907\u6CE8",
  "\u65E7\u8D44\u6599\u69FD\u517C\u5BB9",
  "\u4EBA\u7269\u6839\u76EE\u5F55",
  "\u9002\u7528\u5267\u60C5",
  "\u9020\u578B\u7F16\u53F7",
  "\u9020\u578B\u540D\u79F0",
  "\u89D2\u8272\u5206\u7C7B",
  "\u4EBA\u7269\u5206\u7C7B"
];
var PROMPT_METADATA_LINE_PATTERN = new RegExp(
  `^(?:${[
    ...PROMPT_METADATA_PREFIXES,
    "\u4EBA\u7269",
    "\u89D2\u8272",
    "\u72B6\u6001",
    "\u8BF4\u660E",
    "\u7528\u9014",
    "\u5730\u70B9"
  ].map(escapeRegExp).join("|")})\\s*(?:[\uFF1A:]|$)`,
  "u"
);
var VISUAL_FIELD_PREFIXES = [
  // Prompt sections are sometimes authored as a labelled list item rather
  // than as plain prose (for example `- **提示词：** ...`). Strip that
  // wrapper before the value reaches the image workflow.
  "\u63D0\u793A\u8BCD",
  "\u8D1F\u9762\u63D0\u793A\u8BCD",
  "turnaround_prompt",
  "turnaround_negative_prompt",
  "three_view_prompt",
  "three_view_negative_prompt",
  "visual_prompt",
  "visual_negative_prompt",
  "costume_prompt",
  "costume_negative_prompt",
  "\u8EAB\u4EFD\u57FA\u51C6\u8BF4\u660E",
  "\u8EAB\u4EFD",
  "\u5916\u5F62",
  "\u5916\u8C8C",
  "\u8138\u90E8\u7279\u5F81",
  "\u8138\u90E8",
  "\u8138\u578B",
  "\u4E94\u5B98",
  "\u773C\u775B",
  "\u773C\u795E",
  "\u7709\u6BDB",
  "\u53D1\u578B",
  "\u53D1\u8272",
  "\u4F53\u6001",
  "\u8EAB\u6750",
  "\u4F53\u578B",
  "\u80A4\u8272",
  "\u5E74\u9F84",
  "\u5E74\u9F84\u611F",
  "\u6027\u522B",
  "\u8EAB\u9AD8",
  "\u53EF\u89C1\u6807\u8BB0",
  "\u6807\u5FD7",
  "\u4F24\u75D5",
  "\u57FA\u7840\u670D\u9970",
  "\u670D\u9970",
  "\u8863\u7740",
  "\u670D\u88C5",
  "\u5986\u53D1",
  "\u56FA\u5B9A\u9053\u5177",
  "\u8FDE\u7EED\u6027"
];
function normalizePromptKey(value) {
  return value.replace(/[\s_*`#-]/gu, "").replace(/[：:]/gu, "").toLocaleLowerCase("zh-Hans-CN");
}
function cleanPromptText(value, { dropMetadata = false } = {}) {
  if (typeof value !== "string") return "";
  const lines = value.replace(/\r\n?/gu, "\n").split("\n");
  const cleaned = [];
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || /^`{3,}(?:json)?\s*$/iu.test(line) || /^---+$/.test(line)) continue;
    if (/^#{1,6}\s+/u.test(line)) continue;
    line = line.replace(/^[-*+]\s+/u, "").replace(/^>\s*/u, "");
    line = line.replace(/\*\*(.+?)\*\*/gu, "$1").replace(/__(.+?)__/gu, "$1");
    line = line.replace(/`([^`]+)`/gu, "$1").trim();
    if (!line) continue;
    if (dropMetadata && PROMPT_METADATA_LINE_PATTERN.test(line)) continue;
    if (dropMetadata && /^(?:请在这里补充|请描述|待补充|未补充|暂无)/u.test(line)) continue;
    if (dropMetadata) {
      const fieldPattern = new RegExp(`^(?:${VISUAL_FIELD_PREFIXES.map(escapeRegExp).join("|")})\\s*[\uFF1A:]\\s*`, "u");
      line = line.replace(fieldPattern, "").trim();
      if (!line || /^(?:请在这里补充|请描述|待补充|未补充|暂无)/u.test(line)) continue;
    }
    cleaned.push(line);
  }
  return cleaned.join("\uFF1B").replace(/；{2,}/gu, "\uFF1B").trim();
}
function parseJsonPromptObjects(markdown) {
  const source = String(markdown ?? "");
  const candidates = [source];
  for (const match of source.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/giu)) {
    candidates.unshift(match[1]);
  }
  const objects = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value;
    objects.push(record);
    Object.values(record).forEach(visit);
  };
  for (const candidate of candidates) {
    try {
      visit(JSON.parse(candidate.trim()));
    } catch {
    }
  }
  return objects;
}
function readStructuredPromptValue(markdown, aliases) {
  const expected = new Set(aliases.map(normalizePromptKey));
  for (const record of parseJsonPromptObjects(markdown)) {
    for (const [key, value] of Object.entries(record)) {
      if (!expected.has(normalizePromptKey(key)) || typeof value !== "string") continue;
      const prompt = cleanPromptText(value, { dropMetadata: true });
      if (prompt) return prompt;
    }
  }
  return "";
}
function readPromptFieldLine(markdown, aliases) {
  const expected = new Set(aliases.map(normalizePromptKey));
  for (const [key, value] of parseBoldFields(String(markdown ?? ""))) {
    if (!expected.has(normalizePromptKey(key))) continue;
    const prompt = cleanPromptText(value, { dropMetadata: true });
    if (prompt) return prompt;
  }
  for (const rawLine of String(markdown ?? "").replace(/\r\n?/gu, "\n").split("\n")) {
    const line = rawLine.trim().replace(/^[-*+]\s+/u, "");
    const match = line.match(/^(?:\*\*|__)?([^：:]+?)(?:\*\*|__)?\s*[：:]\s*(.+?)\s*$/u);
    if (!match || !expected.has(normalizePromptKey(match[1]))) continue;
    const prompt = cleanPromptText(match[2], { dropMetadata: true });
    if (prompt) return prompt;
  }
  return "";
}
function readMarkdownSectionAliases(markdown, headings) {
  for (const heading of headings) {
    const section = readMarkdownSection(markdown, heading);
    if (section) return cleanPromptText(section, { dropMetadata: true });
  }
  return "";
}
function readPromptFields(markdown, promptHeadings, negativeHeadings, promptAliases, negativeAliases) {
  const prompt = readMarkdownSectionAliases(markdown, promptHeadings) || readStructuredPromptValue(markdown, promptAliases) || readPromptFieldLine(markdown, promptAliases);
  const negativePrompt = readMarkdownSectionAliases(markdown, negativeHeadings) || readStructuredPromptValue(markdown, negativeAliases) || readPromptFieldLine(markdown, negativeAliases);
  return { prompt, negativePrompt };
}
function readCharacterTurnaroundPromptFields(markdown) {
  return readPromptFields(
    markdown,
    TURNAROUND_PROMPT_HEADINGS,
    TURNAROUND_NEGATIVE_HEADINGS,
    [
      "turnaround_prompt",
      "turnaroundPrompt",
      "three_view_prompt",
      "threeViewPrompt",
      "visual_prompt",
      "visualPrompt",
      "prompt",
      "\u89C6\u89C9\u63D0\u793A\u8BCD",
      "\u4EBA\u7269\u4E09\u89C6\u56FE\u63D0\u793A\u8BCD",
      "\u4E09\u89C6\u56FE\u63D0\u793A\u8BCD"
    ],
    [
      "turnaround_negative_prompt",
      "turnaroundNegativePrompt",
      "visual_negative_prompt",
      "visualNegativePrompt",
      "negative_prompt",
      "negativePrompt",
      "\u89C6\u89C9\u8D1F\u9762\u63D0\u793A\u8BCD",
      "\u4EBA\u7269\u4E09\u89C6\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
      "\u4E09\u89C6\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
      "\u8D1F\u9762\u63D0\u793A\u8BCD"
    ]
  );
}
function readCharacterLookPromptFields(markdown) {
  return readPromptFields(
    markdown,
    LOOK_PROMPT_HEADINGS,
    LOOK_NEGATIVE_HEADINGS,
    [
      "prompt",
      "costume_prompt",
      "costumePrompt",
      "visual_prompt",
      "visualPrompt",
      "\u89C6\u89C9\u63D0\u793A\u8BCD",
      "\u9020\u578B\u56FE\u63D0\u793A\u8BCD",
      "\u9020\u578B\u63D0\u793A\u8BCD",
      "\u4E09\u89C6\u56FE\u63D0\u793A\u8BCD",
      "\u63D0\u793A\u8BCD"
    ],
    [
      "negative_prompt",
      "negativePrompt",
      "costume_negative_prompt",
      "costumeNegativePrompt",
      "visual_negative_prompt",
      "visualNegativePrompt",
      "\u89C6\u89C9\u8D1F\u9762\u63D0\u793A\u8BCD",
      "\u9020\u578B\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
      "\u9020\u578B\u8D1F\u9762\u63D0\u793A\u8BCD",
      "\u4E09\u89C6\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
      "\u8D1F\u9762\u63D0\u793A\u8BCD"
    ]
  );
}
function readVisualFields(fields, ...names) {
  const parts = names.map((name) => cleanPromptText(fields.get(name) ?? "", { dropMetadata: true })).filter(Boolean);
  return [...new Set(parts)].join("\uFF1B");
}
function readVisualListSections(markdown, headings) {
  const parts = headings.map((heading) => readMarkdownSection(markdown, heading)).map((section) => cleanPromptText(section, { dropMetadata: true })).flatMap((section) => section.split(/[；\n]/u)).map((part) => part.trim()).filter((part) => part && !/(?:提案|来源|出身|之孙|之子|正在修炼|剧情|编号|名称)/u.test(part));
  return [...new Set(parts)].join("\uFF1B");
}
function joinUniquePromptParts(parts) {
  const values = parts.flatMap((part) => part.split(/[；\n]/u)).map((part) => part.trim()).filter(Boolean);
  const unique = [];
  const comparable = (value) => value.replace(/[\s，。；、：:的]/gu, "").toLocaleLowerCase("zh-Hans-CN");
  for (const value of values) {
    if (unique.some((existing) => existing === value)) continue;
    const compactValue = comparable(value);
    if (compactValue.length >= 2 && unique.some((existing) => {
      const compactExisting = comparable(existing);
      return compactExisting.length > compactValue.length && compactExisting.includes(compactValue);
    })) {
      continue;
    }
    for (let index = unique.length - 1; index >= 0; index -= 1) {
      const compactExisting = comparable(unique[index]);
      if (compactExisting.length >= 2 && compactValue.length > compactExisting.length && compactValue.includes(compactExisting)) {
        unique.splice(index, 1);
      }
    }
    unique.push(value);
  }
  return unique.join("\uFF1B");
}
var VISUAL_IDENTITY_HINT_PATTERN = /(?:\d{1,3}\s*岁|少年|少女|青年|老人|男孩|女孩|男性|女性|面庞|脸|五官|眼|眉|鼻|发|头发|肤色|皮肤|身姿|身材|体态|身高|体型|服饰|服装|衣着|衣服|短发|长发|长袍|短衣)/u;
function visualIdentityFallback(value) {
  return value.split(/[，。；、]/u).map((part) => part.trim()).filter((part) => part && VISUAL_IDENTITY_HINT_PATTERN.test(part)).join("\uFF1B");
}
function characterIdentityVisualCore(markdown) {
  const source = String(markdown ?? "");
  const fields = parseBoldFields(source);
  const structuredFields = readVisualFields(
    fields,
    "\u8EAB\u4EFD\u57FA\u51C6\u8BF4\u660E",
    "\u5916\u5F62",
    "\u5916\u8C8C",
    "\u8138\u90E8\u7279\u5F81",
    "\u8138\u90E8",
    "\u8138\u578B",
    "\u4E94\u5B98",
    "\u773C\u775B",
    "\u773C\u795E",
    "\u7709\u6BDB",
    "\u53D1\u578B",
    "\u53D1\u8272",
    "\u4F53\u6001",
    "\u8EAB\u6750",
    "\u4F53\u578B",
    "\u80A4\u8272",
    "\u5E74\u9F84",
    "\u5E74\u9F84\u611F",
    "\u6027\u522B",
    "\u8EAB\u9AD8",
    "\u53EF\u89C1\u6807\u8BB0",
    "\u6807\u5FD7",
    "\u4F24\u75D5",
    "\u57FA\u7840\u670D\u9970",
    "\u670D\u9970",
    "\u8863\u7740"
  );
  const identityFallback = structuredFields ? "" : visualIdentityFallback(cleanPromptText(fields.get("\u8EAB\u4EFD") ?? "", { dropMetadata: true }));
  const parts = [
    structuredFields || identityFallback,
    readVisualListSections(source, ["\u8EAB\u4EFD\u9501\u5B9A\u7279\u5F81", "\u8EAB\u4EFD\u9501\u5B9A\u89C6\u89C9\u7279\u5F81", "\u89C6\u89C9\u7279\u5F81"]),
    readVisualListSections(source, [
      "\u57FA\u7840\u5448\u73B0\uFF08\u4E0D\u7B49\u540C\u4E8E LOOK\uFF09",
      "\u57FA\u7840\u5448\u73B0",
      "\u5916\u5F62\u7279\u5F81",
      "\u5916\u8C8C\u7279\u5F81",
      "\u89C6\u89C9\u5F62\u8C61",
      "\u89C6\u89C9\u8BBE\u5B9A",
      "\u4EBA\u7269\u5916\u89C2",
      "\u57FA\u7840\u5916\u89C2"
    ])
  ].filter(Boolean);
  return joinUniquePromptParts(parts);
}
function lookVisualCore(markdown) {
  const source = String(markdown ?? "");
  const fields = parseBoldFields(source);
  const parts = [
    // Only visual fields belong in a static look image. The surrounding
    // sections also contain names, IDs, story applicability and production
    // notes, which must not leak into the prompt.
    readVisualFields(fields, "\u670D\u88C5", "\u5986\u53D1", "\u56FA\u5B9A\u9053\u5177")
  ].filter(Boolean);
  return joinUniquePromptParts(parts);
}
var TURNAROUND_LAYOUT_SUFFIX = "\u5168\u8EAB\u89D2\u8272\u8BBE\u8BA1\u4E09\u89C6\u56FE\uFF0C\u6B63\u9762\u3001\u4FA7\u9762\u3001\u80CC\u9762\u4E09\u89C6\u89D2\u5E76\u5217\uFF0C\u4E2D\u7ACB\u7AD9\u59FF\uFF0C\u7EDF\u4E00\u6BD4\u4F8B\u548C\u8EAB\u4EFD\u7279\u5F81\uFF0C\u5747\u5300\u68DA\u62CD\u5149\uFF0C\u5E72\u51C0\u6D45\u8272\u80CC\u666F\uFF0C\u65E0\u6587\u5B57\u3002";
var COSTUME_LAYOUT_SUFFIX = "\u4EBA\u7269\u5168\u8EAB\u5B9A\u5986\u8BBE\u5B9A\u56FE\uFF0C\u6B63\u9762\u3001\u4FA7\u9762\u3001\u80CC\u9762\u4E09\u89C6\u89D2\u5E76\u5217\uFF0C\u4E2D\u7ACB\u7AD9\u59FF\uFF0C\u670D\u88C5\u7EC6\u8282\u6E05\u6670\uFF0C\u5E72\u51C0\u6D45\u8272\u80CC\u666F\uFF0C\u65E0\u6587\u5B57\u3002";
function buildCharacterTurnaroundPrompt(markdown) {
  const explicit = readCharacterTurnaroundPromptFields(markdown).prompt;
  if (explicit) return explicit;
  const identity = characterIdentityVisualCore(markdown);
  return [identity, TURNAROUND_LAYOUT_SUFFIX].filter(Boolean).join("\uFF1B");
}
function buildCharacterCostumePrompt(profileMarkdown, lookMarkdown = "", promptOverride) {
  const lookFields = readCharacterLookPromptFields(lookMarkdown);
  const identity = characterIdentityVisualCore(profileMarkdown);
  const lookVisual = lookVisualCore(lookMarkdown);
  const explicit = typeof promptOverride === "string" ? cleanPromptText(promptOverride) : lookFields.prompt;
  const identityPart = identity && (!explicit || !explicit.includes(identity)) ? identity : "";
  return [identityPart, explicit || lookVisual, COSTUME_LAYOUT_SUFFIX].filter(Boolean).join("\uFF1B");
}
function parseShotDetails(markdown) {
  const details = /* @__PURE__ */ new Map();
  const headings = [...markdown.matchAll(
    /^#{2,4}\s*(?:(?:镜头|分镜)\s*)?((?:SH\s*)?\d+)(?:\s*(?:[：:—-]\s*|\s+)(.+?))?\s*$/gmu
  )];
  headings.forEach((heading, index) => {
    const shotId = normalizeShotId(heading[1].replace(/\s+/gu, ""));
    if (!shotId || heading.index === void 0) return;
    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = headings[index + 1]?.index ?? markdown.length;
    const rawContent = markdown.slice(bodyStart, bodyEnd).trim();
    details.set(shotId, {
      title: heading[2]?.trim() || "\u672A\u547D\u540D\u955C\u5934",
      fields: parseBoldFields(rawContent),
      rawContent
    });
  });
  return details;
}
function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return void 0;
  const content = trimmed.replace(/^\|/u, "").replace(/\|$/u, "");
  const cells = [];
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
  return cells.length > 1 ? cells : void 0;
}
function isMarkdownTableDivider(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}
function normalizeTableHeader(value) {
  return value.replace(/[\s*_`]/gu, "").trim();
}
function findTableColumn(headers, names) {
  const index = headers.findIndex((header) => names.some((name) => header === name || header.includes(name)));
  return index >= 0 ? index : void 0;
}
function readStoryboardTableColumns(cells) {
  const headers = cells.map(normalizeTableHeader);
  const shotId = findTableColumn(headers, ["\u955C\u53F7", "\u955C\u5934\u53F7", "\u955C\u5934\u7F16\u53F7", "shotid"]);
  if (shotId === void 0) return void 0;
  return {
    shotId,
    timecode: findTableColumn(headers, ["\u65F6\u95F4\u7801", "\u65F6\u7801", "timecode"]) ?? 1,
    duration: findTableColumn(headers, ["\u65F6\u957F", "duration"]) ?? 2,
    framing: findTableColumn(headers, ["\u666F\u522B", "\u673A\u4F4D", "framing"]) ?? 3,
    content: findTableColumn(headers, ["\u753B\u9762\u5185\u5BB9", "\u753B\u9762\u63CF\u8FF0", "\u6838\u5FC3\u5185\u5BB9", "\u5185\u5BB9", "content"]) ?? 4,
    dialogue: findTableColumn(headers, ["\u53F0\u8BCD", "\u5BF9\u767D", "dialogue"]) ?? 5
  };
}
function readStoryboardTableCell(cells, index) {
  return cells[index]?.trim() || "";
}
function makeShortTitle(content) {
  const clean = content.replace(/[*_`#]/g, "").trim();
  const phrase = clean.split(/[，。；：,.;:]/u)[0]?.trim() || "\u672A\u547D\u540D\u955C\u5934";
  return phrase.length > 18 ? `${phrase.slice(0, 18)}\u2026` : phrase;
}
function parseStoryboardSectionDrafts(source, sceneId, markdown, hasMultipleScenes) {
  const details = parseShotDetails(markdown);
  const drafts = [];
  let tableColumns;
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
      columns.dialogue
    )) continue;
    const shotId = normalizeShotId(readStoryboardTableCell(cells, columns.shotId));
    if (!shotId) continue;
    const detail = details.get(shotId);
    const hasTrailingUnescapedCells = columns.content === 4 && columns.dialogue === 5 && cells.length > 6;
    const content = hasTrailingUnescapedCells ? cells.slice(columns.content, -1).join(" | ") : readStoryboardTableCell(cells, columns.content);
    const dialogue = hasTrailingUnescapedCells ? cells.at(-1)?.trim() || "" : readStoryboardTableCell(cells, columns.dialogue);
    const design = {
      sceneId,
      shotId,
      title: detail?.title || makeShortTitle(content),
      timecode: readStoryboardTableCell(cells, columns.timecode),
      duration: readStoryboardTableCell(cells, columns.duration),
      framing: readStoryboardTableCell(cells, columns.framing),
      content,
      dialogue,
      camera: detail ? readField(detail.fields, "\u6444\u5F71\u8FD0\u52A8", "\u8FD0\u955C") : "",
      prompt: detail ? readField(detail.fields, "\u63D0\u793A\u8BCD") : "",
      negativePrompt: detail ? readField(detail.fields, "\u8D1F\u9762\u63D0\u793A\u8BCD") : "",
      firstFramePrompt: detail ? readField(detail.fields, "\u9996\u5E27\u63D0\u793A\u8BCD") : "",
      firstFrameNegativePrompt: detail ? readField(detail.fields, "\u9996\u5E27\u8D1F\u9762\u63D0\u793A\u8BCD") : "",
      lastFramePrompt: detail ? readField(detail.fields, "\u5C3E\u5E27\u63D0\u793A\u8BCD") : "",
      lastFrameNegativePrompt: detail ? readField(detail.fields, "\u5C3E\u5E27\u8D1F\u9762\u63D0\u793A\u8BCD") : "",
      references: detail ? readField(detail.fields, "\u53C2\u8003\u4EBA\u7269", "\u53C2\u8003\u89D2\u8272") : "",
      videoPrompt: detail ? readField(detail.fields, "\u89C6\u9891\u751F\u6210\u63D0\u793A\u8BCD") : "",
      status: "\u5F85\u521B\u5EFA\u955C\u5934\u8D44\u4EA7"
    };
    const warnings = [];
    if (!detail) warnings.push(`${shotId} \u6CA1\u6709\u5339\u914D\u5230\u9010\u955C\u8BE6\u7EC6\u8BBE\u8BA1\uFF0C\u5C06\u53EA\u5BFC\u5165\u603B\u8868\u4FE1\u606F\u3002`);
    if (hasMultipleScenes) {
      warnings.push("\u540C\u4E00\u4EFD\u5206\u955C\u811A\u672C\u5305\u542B\u591A\u4E2A\u573A\u6B21\uFF1B\u5DF2\u6309\u573A\u6B21\u6807\u9898\u5206\u522B\u8BC6\u522B\u3002");
    }
    if (!design.timecode || !design.duration || !design.content) {
      warnings.push(`${shotId} \u7F3A\u5C11\u65F6\u95F4\u7801\u3001\u65F6\u957F\u6216\u753B\u9762\u5185\u5BB9\u4E2D\u7684\u81F3\u5C11\u4E00\u9879\u3002`);
    }
    drafts.push({
      asset: {
        type: "shot",
        sourcePath: source.relativePath,
        design,
        slots: createEmptySlots(SHOT_SLOT_DEFINITIONS),
        updatedAt: source.stats.mtime.toISOString(),
        isDraft: true
      },
      source: {
        sourcePath: source.relativePath,
        sourceShotId: shotId,
        rawDetail: detail?.rawContent || ""
      },
      warnings
    });
  }
  return drafts;
}
function parseStoryboardDrafts(source, markdown) {
  return splitStoryboardSceneSections(source, markdown).flatMap((section) => parseStoryboardSectionDrafts(
    source,
    section.sceneId,
    section.markdown,
    section.hasMultipleScenes
  ));
}
function parseStoredShotSourcePath(markdown) {
  const sourcePath = readField(parseBoldFields(markdown), "\u6765\u6E90\u811A\u672C");
  if (!sourcePath || getAssetKind(path.basename(sourcePath)) !== "markdown") return void 0;
  try {
    return assertVisibleProjectPath(sourcePath);
  } catch {
    return void 0;
  }
}
async function readIndexedText(entry) {
  if (entry.stats.size > MAX_TEXT_ASSET_BYTES) {
    throw new ProjectPathError("Text assets must be smaller than 2 MB.");
  }
  return fs.readFile(entry.absolutePath, "utf8");
}
async function buildCharacterAssets(index) {
  const characterDirectories = index.directories.filter(
    (directory) => path.basename(path.dirname(directory.absolutePath)) === "\u4E3B\u8981\u4EBA\u7269"
  );
  const characters = await Promise.all(characterDirectories.map(async (directory) => {
    const pairedProfile = await readPairedDocument(index, directory, "\u89D2\u8272\u8BBE\u5B9A.md", CHARACTER_PROFILE_JSON, "character");
    const profile = pairedProfile.markdown;
    const profileContent = pairedProfile.content;
    const slots = readAssetSlots(directory.absolutePath, CHARACTER_SLOT_DEFINITIONS, index.filesByDirectory);
    const [looks, visualMetadata] = await Promise.all([
      buildCharacterLooks(directory, index),
      Promise.resolve(getConfirmedVisualMetadata(slots))
    ]);
    const { confirmedVisuals, confirmedVisualSourcePaths } = visualMetadata;
    const confirmedTurnaround = confirmedVisuals.turnaround;
    const confirmedTurnaroundSourcePath = confirmedTurnaround?.path;
    const slotFiles = slots.flatMap((slot) => slot.files.map(
      (file) => index.files.find((entry) => entry.relativePath === file.path)
    )).filter((entry) => Boolean(entry));
    return {
      type: "character",
      rootPath: directory.relativePath,
      name: directory.name,
      roleCategory: parseCharacterRoleCategory(profileContent),
      ...profile ? { profilePath: profile.relativePath, profileContent } : {},
      ...pairedProfile.json ? { profileJsonPath: pairedProfile.json.relativePath } : {},
      ...pairedProfile.prompt ? { turnaroundPrompt: pairedProfile.prompt } : {},
      ...pairedProfile.negativePrompt ? { turnaroundNegativePrompt: pairedProfile.negativePrompt } : {},
      profileRevision: createTextRevision(profileContent),
      slots,
      confirmedVisuals,
      confirmedVisualSourcePaths,
      ...confirmedTurnaround ? { confirmedTurnaround } : {},
      ...confirmedTurnaroundSourcePath ? { confirmedTurnaroundSourcePath } : {},
      looks,
      cover: confirmedTurnaround ?? pickCover(slots, ["turnaround"]),
      updatedAt: latestUpdatedAt(directory, [...profile ? [profile] : [], ...slotFiles])
    };
  }));
  return characters.sort((left, right) => {
    const roleDifference = CHARACTER_ROLE_SORT_ORDER.indexOf(left.roleCategory) - CHARACTER_ROLE_SORT_ORDER.indexOf(right.roleCategory);
    return roleDifference || left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}
var MAX_SHOT_DESIGN_JSON_BYTES = 1e6;
function parseShotDesignJson(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ProjectPathError("design.json \u4E0D\u662F\u6709\u6548 JSON\u3002");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProjectPathError("design.json \u5FC5\u987B\u662F JSON \u5BF9\u8C61\u3002");
  }
  const document = parsed;
  const design = validateShotDesign(document);
  if (document.source !== void 0 && (!document.source || typeof document.source !== "object" || Array.isArray(document.source))) {
    throw new ProjectPathError("design.json \u7684 source \u5FC5\u987B\u662F\u5BF9\u8C61\u3002");
  }
  const source = document.source === void 0 ? void 0 : normalizeShotSource(document.source, design.shotId);
  return { design, ...source ? { source } : {} };
}
async function readShotDesignJson(entry) {
  if (!entry.stats.isFile()) throw new ProjectPathError("design.json \u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\u3002");
  if (entry.stats.size > MAX_SHOT_DESIGN_JSON_BYTES) throw new ProjectPathError("design.json \u8D85\u8FC7 1 MB\u3002");
  const content = await readIndexedText(entry);
  return { content, ...parseShotDesignJson(content) };
}
function serializeShotDesignJson(design, source) {
  const validated = validateShotDesign(design);
  const normalizedSource = source ? normalizeShotSource(source, validated.shotId) : void 0;
  return `${JSON.stringify({
    ...validated,
    ...normalizedSource ? { source: normalizedSource } : {}
  }, null, 2)}
`;
}
async function writeShotDesignJson(targetPath, design, source) {
  await writeTextAtomically(targetPath, serializeShotDesignJson(design, source));
}
async function migrateCachedShotDesigns(root) {
  const cachePath = path.join(root, PROJECT_JSON_PATH);
  let info;
  try {
    info = await fs.lstat(cachePath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_PROJECT_JSON_BYTES) return;
  let value;
  try {
    value = JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const snapshot = value;
  if (!LEGACY_PROJECT_SNAPSHOT_SCHEMA_VERSIONS.has(snapshot.schemaVersion) || !Array.isArray(snapshot.shots)) return;
  for (const item of snapshot.shots) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const cachedShot = item;
    if (typeof cachedShot.rootPath !== "string" || typeof cachedShot.designPath !== "string") continue;
    let assetPath;
    let design;
    try {
      assetPath = assertVisibleProjectPath(cachedShot.rootPath);
      design = validateShotDesign(cachedShot.design);
    } catch {
      continue;
    }
    const segments = assetPath.split("/");
    if (segments.length !== 3 || segments[0] !== "\u5206\u955C" || segments[1] !== design.sceneId || segments[2] !== design.shotId && !segments[2].startsWith(`${design.shotId}-`) || cachedShot.designPath !== `${assetPath}/\u955C\u5934.md`) continue;
    const assetDirectory = path.join(root, ...segments);
    const markdownPath = path.join(assetDirectory, "\u955C\u5934.md");
    const designPath = path.join(assetDirectory, "design.json");
    try {
      const [directoryInfo, markdownInfo] = await Promise.all([fs.lstat(assetDirectory), fs.lstat(markdownPath)]);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !markdownInfo.isFile() || markdownInfo.isSymbolicLink()) continue;
      const existing = await fs.lstat(designPath).catch(
        (error) => error.code === "ENOENT" ? void 0 : Promise.reject(error)
      );
      if (existing) continue;
      await fs.writeFile(designPath, serializeShotDesignJson(design), { encoding: "utf8", flag: "wx", mode: 384 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}
async function buildStoredShotAssets(index) {
  const designFiles = index.files.filter((file) => {
    if (file.name !== "design.json") return false;
    const segments = file.relativePath.split("/");
    const storyboardIndex = segments.lastIndexOf("\u5206\u955C");
    return storyboardIndex >= 0 && storyboardIndex === segments.length - 4;
  });
  return Promise.all(designFiles.map(async (designFile) => {
    const assetDirectory = path.dirname(designFile.absolutePath);
    const assetDirectoryEntry = index.directories.find((entry) => entry.absolutePath === assetDirectory);
    if (!assetDirectoryEntry) {
      throw new ProjectPathError("A shot asset directory disappeared while it was being scanned.");
    }
    const slots = readAssetSlots(assetDirectory, SHOT_SLOT_DEFINITIONS, index.filesByDirectory);
    const slotFiles = slots.flatMap((slot) => slot.files.map(
      (file) => index.files.find((entry) => entry.relativePath === file.path)
    )).filter((entry) => Boolean(entry));
    const stored = await readShotDesignJson(designFile);
    return {
      type: "shot",
      rootPath: assetDirectoryEntry.relativePath,
      designPath: designFile.relativePath,
      designRevision: createTextRevision(stored.content),
      ...stored.source ? { sourcePath: stored.source.sourcePath } : {},
      design: stored.design,
      slots,
      cover: pickCover(slots, ["final", "candidate", "firstFrame", "lastFrame", "reference"]),
      updatedAt: latestUpdatedAt(assetDirectoryEntry, [designFile, ...slotFiles]),
      isDraft: false
    };
  }));
}
async function buildSimpleDocumentAssets(index, parentName, documentName, slotDefinitions, type) {
  const directories = index.directories.filter(
    (directory) => path.basename(path.dirname(directory.absolutePath)) === parentName
  );
  return Promise.all(directories.map(async (directory) => {
    const jsonName = type === "location" ? LOCATION_PROFILE_JSON : PROP_PROFILE_JSON;
    const pairedDocument = await readPairedDocument(index, directory, documentName, jsonName, type);
    const document = pairedDocument.markdown;
    const content = pairedDocument.content;
    const slots = readAssetSlots(directory.absolutePath, slotDefinitions, index.filesByDirectory);
    const confirmedVisuals = {};
    for (const slot of slots) confirmedVisuals[slot.key] = findConfirmedVisual(slot.files);
    const slotFiles = slots.flatMap((slot) => slot.files.map(
      (file) => index.files.find((entry) => entry.relativePath === file.path)
    )).filter((entry) => Boolean(entry));
    const base = {
      type,
      rootPath: directory.relativePath,
      name: directory.name,
      ...document ? { profilePath: document.relativePath, profileContent: content } : {},
      ...pairedDocument.json ? { profileJsonPath: pairedDocument.json.relativePath } : {},
      ...pairedDocument.prompt ? { prompt: pairedDocument.prompt } : {},
      ...pairedDocument.negativePrompt ? { negativePrompt: pairedDocument.negativePrompt } : {},
      profileRevision: createTextRevision(content),
      slots,
      confirmedVisuals,
      cover: confirmedVisuals.final ?? confirmedVisuals.setting ?? confirmedVisuals.candidate ?? confirmedVisuals.reference ?? pickCover(slots, ["final", "setting", "candidate", "reference"]),
      updatedAt: latestUpdatedAt(directory, [...document ? [document] : [], ...slotFiles])
    };
    return base;
  }));
}
function escapeMarkdownTableCell(value) {
  return value.replace(/\|/gu, "\\|").replace(/[\r\n]+/gu, " ").trim();
}
function parseSceneCastBindings(markdown) {
  const matcher = new RegExp(
    `${escapeRegExp(SCENE_CAST_MARKER_START)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(SCENE_CAST_MARKER_END)}`,
    "u"
  );
  const serialized = markdown.match(matcher)?.[1];
  if (!serialized) return [];
  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.bindings)) return [];
    return parsed.bindings.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const value = entry;
      if (typeof value.characterPath !== "string") return [];
      return [{
        characterPath: value.characterPath,
        ...typeof value.lookPath === "string" && value.lookPath.trim() ? { lookPath: value.lookPath } : {},
        state: typeof value.state === "string" ? value.state : "",
        continuity: typeof value.continuity === "string" ? value.continuity : "",
        startShotId: typeof value.startShotId === "string" ? value.startShotId : "",
        endShotId: typeof value.endShotId === "string" ? value.endShotId : ""
      }];
    });
  } catch {
    return [];
  }
}
function extractPreservedSceneCastContent(markdown) {
  const withoutProjection = extractMarkedContent(
    markdown,
    SCENE_CAST_PROJECTION_MARKER_START,
    SCENE_CAST_PROJECTION_MARKER_END
  ).remainder;
  let remainder = extractMarkedContent(
    withoutProjection,
    SCENE_CAST_MARKER_START,
    SCENE_CAST_MARKER_END
  ).remainder.replace(/^#\s+.*?出场与造型表\s*(?:\r?\n|$)/mu, "").replace(/^\s*本表定义本场默认的人物与造型；镜头只记录临时状态或换装覆盖。\s*(?:\r?\n|$)/mu, "");
  const lines = remainder.split(/\r?\n/u);
  const headerIndex = lines.findIndex((line) => line.trim() === "| \u4EBA\u7269 | \u9ED8\u8BA4\u9020\u578B | \u751F\u6548\u955C\u5934 | \u72B6\u6001 | \u8FDE\u7EED\u6027 |");
  if (headerIndex >= 0 && /^\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*$/u.test(lines[headerIndex + 1]?.trim() || "")) {
    let endIndex = headerIndex + 2;
    while (endIndex < lines.length && lines[endIndex].trim().startsWith("|")) endIndex += 1;
    lines.splice(headerIndex, endIndex - headerIndex);
    remainder = lines.join("\n");
  }
  return remainder.trim();
}
function serializeSceneCastDocument(sceneId, bindings, existingMarkdown) {
  const safeSceneId = validateNewName(sceneId);
  const rows = bindings.length ? bindings.map((binding) => [
    path.basename(binding.characterPath),
    binding.lookPath ? path.basename(binding.lookPath) : "\u8EAB\u4EFD\u57FA\u51C6",
    binding.startShotId || binding.endShotId ? `${binding.startShotId || "\u9996\u955C"} - ${binding.endShotId || "\u5C3E\u955C"}` : "\u5168\u573A",
    binding.state || "\u65E0",
    binding.continuity || "\u65E0"
  ]) : [["\u5C1A\u672A\u914D\u7F6E", "\u2014", "\u2014", "\u2014", "\u2014"]];
  const tableRows = rows.map((cells) => `| ${cells.map(escapeMarkdownTableCell).join(" | ")} |`);
  const generated = [
    SCENE_CAST_PROJECTION_MARKER_START,
    `# ${safeSceneId} \u51FA\u573A\u4E0E\u9020\u578B\u8868`,
    "",
    SCENE_CAST_MARKER_START,
    JSON.stringify({ version: 1, bindings }, null, 2),
    SCENE_CAST_MARKER_END,
    "",
    "\u672C\u8868\u5B9A\u4E49\u672C\u573A\u9ED8\u8BA4\u7684\u4EBA\u7269\u4E0E\u9020\u578B\uFF1B\u955C\u5934\u53EA\u8BB0\u5F55\u4E34\u65F6\u72B6\u6001\u6216\u6362\u88C5\u8986\u76D6\u3002",
    "",
    "| \u4EBA\u7269 | \u9ED8\u8BA4\u9020\u578B | \u751F\u6548\u955C\u5934 | \u72B6\u6001 | \u8FDE\u7EED\u6027 |",
    "| --- | --- | --- | --- | --- |",
    ...tableRows,
    SCENE_CAST_PROJECTION_MARKER_END
  ].join("\n");
  const preserved = existingMarkdown ? extractPreservedSceneCastContent(existingMarkdown) : "";
  return `${[generated, preserved].filter(Boolean).join("\n\n").trimEnd()}
`;
}
function parseSceneAssetBindings(markdown) {
  const matcher = new RegExp(
    `${escapeRegExp(SCENE_ASSET_BINDINGS_MARKER_START)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(SCENE_ASSET_BINDINGS_MARKER_END)}`,
    "u"
  );
  const serialized = markdown.match(matcher)?.[1];
  if (!serialized) return { locations: [], props: [] };
  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { locations: [], props: [] };
    const raw = parsed;
    const parse = (value, key) => {
      if (!Array.isArray(value)) return [];
      return value.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const item = entry;
        if (typeof item[key] !== "string") return [];
        return [{
          [key]: item[key],
          role: typeof item.role === "string" ? item.role : "",
          state: typeof item.state === "string" ? item.state : "",
          continuity: typeof item.continuity === "string" ? item.continuity : "",
          startShotId: typeof item.startShotId === "string" ? item.startShotId : typeof item.start_shot_id === "string" ? item.start_shot_id : "",
          endShotId: typeof item.endShotId === "string" ? item.endShotId : typeof item.end_shot_id === "string" ? item.end_shot_id : ""
        }];
      });
    };
    const directLocations = parse(raw.locations, "locationPath");
    const directProps = parse(raw.props, "propPath");
    const mixed = Array.isArray(raw.bindings) ? raw.bindings : [];
    for (const entry of mixed) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry;
      const type = item.type === "location" || item.type === "\u573A\u666F" ? "location" : item.type === "prop" || item.type === "\u9053\u5177" ? "prop" : "";
      const assetPath = typeof item.locationPath === "string" ? item.locationPath : typeof item.propPath === "string" ? item.propPath : void 0;
      if (!type || !assetPath) continue;
      const normalized = {
        [type === "location" ? "locationPath" : "propPath"]: assetPath,
        role: typeof item.role === "string" ? item.role : "",
        state: typeof item.state === "string" ? item.state : "",
        continuity: typeof item.continuity === "string" ? item.continuity : "",
        startShotId: typeof item.startShotId === "string" ? item.startShotId : typeof item.start_shot_id === "string" ? item.start_shot_id : "",
        endShotId: typeof item.endShotId === "string" ? item.endShotId : typeof item.end_shot_id === "string" ? item.end_shot_id : ""
      };
      if (type === "location") directLocations.push(normalized);
      else directProps.push(normalized);
    }
    return { locations: directLocations, props: directProps };
  } catch {
    return { locations: [], props: [] };
  }
}
function extractPreservedSceneAssetContent(markdown) {
  const withoutProjection = extractMarkedContent(
    markdown,
    SCENE_ASSET_BINDINGS_PROJECTION_MARKER_START,
    SCENE_ASSET_BINDINGS_PROJECTION_MARKER_END
  ).remainder;
  let remainder = extractMarkedContent(
    withoutProjection,
    SCENE_ASSET_BINDINGS_MARKER_START,
    SCENE_ASSET_BINDINGS_MARKER_END
  ).remainder;
  remainder = remainder.replace(/^#\s+.*?场次资产表\s*(?:\r?\n|$)/mu, "").replace(/^\s*本表(?:定义|记录).*?(?:\r?\n|$)/mu, "");
  const lines = remainder.split(/\r?\n/u);
  const headers = [
    "| \u5730\u70B9 | \u89D2\u8272 | \u751F\u6548\u955C\u5934 | \u72B6\u6001 | \u8FDE\u7EED\u6027 |",
    "| \u9053\u5177 | \u89D2\u8272 | \u751F\u6548\u955C\u5934 | \u72B6\u6001 | \u8FDE\u7EED\u6027 |",
    "| \u5730\u70B9/\u9053\u5177 | \u89D2\u8272 | \u751F\u6548\u955C\u5934 | \u72B6\u6001 | \u8FDE\u7EED\u6027 |"
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
function serializeSceneAssetBindingsDocument(sceneId, locations, props, existingMarkdown) {
  const range = (binding) => binding.startShotId || binding.endShotId ? `${binding.startShotId || "\u9996\u955C"} - ${binding.endShotId || "\u5C3E\u955C"}` : "\u5168\u573A";
  const rows = (items, label, key) => [
    `| ${label} | \u89D2\u8272 | \u751F\u6548\u955C\u5934 | \u72B6\u6001 | \u8FDE\u7EED\u6027 |`,
    "| --- | --- | --- | --- | --- |",
    ...items.length ? items.map((item) => `| ${escapeMarkdownTableCell(path.basename(item[key]))} | ${escapeMarkdownTableCell(item.role)} | ${range(item)} | ${escapeMarkdownTableCell(item.state)} | ${escapeMarkdownTableCell(item.continuity)} |`) : ["| \u5C1A\u672A\u914D\u7F6E | \u2014 | \u2014 | \u2014 | \u2014 |"]
  ];
  const generated = [
    SCENE_ASSET_BINDINGS_PROJECTION_MARKER_START,
    `# ${validateNewName(sceneId)} \u573A\u6B21\u8D44\u4EA7\u8868`,
    "",
    SCENE_ASSET_BINDINGS_MARKER_START,
    JSON.stringify({ version: 1, locations, props }, null, 2),
    SCENE_ASSET_BINDINGS_MARKER_END,
    "",
    "\u672C\u8868\u5B9A\u4E49\u672C\u573A\u4F7F\u7528\u7684\u5730\u70B9\u4E0E\u9053\u5177\uFF1B\u955C\u5934\u53EA\u8BB0\u5F55\u4E34\u65F6\u72B6\u6001\u8986\u76D6\u3002",
    "",
    ...rows(locations, "\u5730\u70B9", "locationPath"),
    "",
    ...rows(props, "\u9053\u5177", "propPath"),
    SCENE_ASSET_BINDINGS_PROJECTION_MARKER_END
  ].join("\n");
  const preserved = existingMarkdown ? extractPreservedSceneAssetContent(existingMarkdown) : "";
  return `${[generated, preserved].filter(Boolean).join("\n\n").trimEnd()}
`;
}
function parseLegacySceneAssetReferences(markdown, locations, props) {
  const fields = parseBoldFields(markdown);
  const parseNames = (...keys) => keys.flatMap((key) => (fields.get(key) || "").split(/[、,，;；|]/u)).map((item) => item.trim()).filter((item) => item && item !== "\u672A\u6307\u5B9A");
  const locationNames = parseNames("\u573A\u666F", "\u5730\u70B9", "\u573A\u666F\u5F15\u7528", "\u5730\u70B9\u5F15\u7528", "\u5F15\u7528\u8D44\u4EA7", "\u5F15\u7528\u5730\u70B9/\u9053\u5177", "\u5730\u70B9\u4E0E\u9053\u5177");
  const propNames = parseNames("\u9053\u5177", "\u9053\u5177\u5F15\u7528", "\u5F15\u7528\u8D44\u4EA7", "\u5F15\u7528\u5730\u70B9/\u9053\u5177", "\u5730\u70B9\u4E0E\u9053\u5177");
  const locationBindings = locations.filter((asset) => locationNames.includes(asset.name)).map((asset) => ({ locationPath: asset.rootPath, role: "", state: "", continuity: "", startShotId: "", endShotId: "" }));
  const propBindings = props.filter((asset) => propNames.includes(asset.name)).map((asset) => ({ propPath: asset.rootPath, role: "", state: "", continuity: "", startShotId: "", endShotId: "" }));
  return { locations: locationBindings, props: propBindings };
}
async function buildSceneAssets(index, storedShots, locations, props) {
  const sceneDirectories = index.directories.filter(
    (directory) => path.basename(path.dirname(directory.absolutePath)) === "\u5206\u955C"
  );
  const scenes = await Promise.all(sceneDirectories.map(async (directory) => {
    const pairedScene = await readPairedDocument(index, directory, "\u573A\u6B21.md", SCENE_DOCUMENT_JSON, "scene");
    const sceneFile = pairedScene.markdown;
    const castFile = (index.filesByDirectory.get(directory.absolutePath) ?? []).find((file) => file.name === SCENE_CAST_DOCUMENT);
    const assetBindingsFile = (index.filesByDirectory.get(directory.absolutePath) ?? []).find((file) => file.name === SCENE_ASSET_BINDINGS_DOCUMENT);
    const sceneContent = pairedScene.content;
    const castContent = castFile ? await readIndexedText(castFile) : "";
    const assetBindingsContent = assetBindingsFile ? await readIndexedText(assetBindingsFile) : "";
    const parsedBindings = assetBindingsFile ? parseSceneAssetBindings(assetBindingsContent) : parseLegacySceneAssetReferences(sceneContent, locations, props);
    const sceneId = directory.name;
    const slots = readAssetSlots(directory.absolutePath, SCENE_SLOT_DEFINITIONS, index.filesByDirectory);
    const slotFiles = slots.flatMap((slot) => slot.files.map(
      (file) => index.files.find((entry) => entry.relativePath === file.path)
    )).filter((entry) => Boolean(entry));
    const hasAllSlotDirectories = SCENE_SLOT_DEFINITIONS.every(
      (definition) => index.directories.some((candidate) => candidate.absolutePath === path.join(directory.absolutePath, definition.directory))
    );
    const shots = storedShots.filter((shot) => normalizeSceneIdentity(shot.design.sceneId) === normalizeSceneIdentity(sceneId));
    const sourcePath = parseStoredShotSourcePath(sceneContent) ?? shots.find((shot) => Boolean(shot.sourcePath))?.sourcePath;
    return {
      type: "scene",
      rootPath: directory.relativePath,
      sceneId,
      ...sceneFile ? { scenePath: sceneFile.relativePath, sceneContent } : {},
      ...pairedScene.json ? { sceneJsonPath: pairedScene.json.relativePath } : {},
      ...pairedScene.prompt ? { prompt: pairedScene.prompt } : {},
      ...pairedScene.negativePrompt ? { negativePrompt: pairedScene.negativePrompt } : {},
      sceneRevision: createTextRevision(sceneContent),
      ...castFile ? { castPath: castFile.relativePath } : {},
      castRevision: createTextRevision(castContent),
      castBindings: parseSceneCastBindings(castContent),
      ...assetBindingsFile ? { assetBindingsPath: assetBindingsFile.relativePath } : {},
      assetBindingsRevision: createTextRevision(assetBindingsContent),
      locationBindings: parsedBindings.locations,
      propBindings: parsedBindings.props,
      ...sourcePath ? { sourcePath } : {},
      slots,
      cover: pickCover(slots, ["final", "candidate", "video", "firstFrame", "lastFrame", "setting", "reference"]),
      updatedAt: latestUpdatedAt(directory, [
        ...sceneFile ? [sceneFile] : [],
        ...castFile ? [castFile] : [],
        ...assetBindingsFile ? [assetBindingsFile] : [],
        ...slotFiles
      ]),
      shotCount: shots.length,
      // A scene is not production-ready until its default cast/look plan exists too.
      isComplete: Boolean(sceneFile) && Boolean(castFile) && hasAllSlotDirectories
    };
  }));
  return scenes.sort((left, right) => left.sceneId.localeCompare(right.sceneId, "zh-Hans-CN", { numeric: true }));
}
function compareShots(left, right) {
  const sceneOrder = left.design.sceneId.localeCompare(right.design.sceneId, "zh-Hans-CN", { numeric: true });
  if (sceneOrder !== 0) return sceneOrder;
  return left.design.shotId.localeCompare(right.design.shotId, "zh-Hans-CN", { numeric: true });
}
function getShotIdentityKeyFromParts(sceneIdInput, shotIdInput) {
  const sceneId = sceneIdInput.trim().replaceAll("_", "-").toLocaleUpperCase("en-US");
  const shotId = normalizeShotId(shotIdInput) || shotIdInput.trim().toLocaleUpperCase("en-US");
  return `${sceneId}\0${shotId}`;
}
function getShotIdentityKey(design) {
  return getShotIdentityKeyFromParts(design.sceneId, design.shotId);
}
function getStoryboardDraftSelector(draft) {
  return `${normalizeSceneIdentity(draft.asset.design.sceneId)}/${draft.asset.design.shotId}`;
}
function parseStoryboardDraftRequest(value) {
  const requestedId = value.trim();
  if (!requestedId) return void 0;
  const qualified = requestedId.match(/^(.+?)\/((?:SH)?\d{1,6})$/iu);
  if (qualified) {
    const shotId = normalizeShotId(qualified[2]);
    const sceneId = qualified[1].trim();
    if (!shotId || !sceneId) return { requestedId };
    return {
      requestedId,
      identity: getShotIdentityKeyFromParts(sceneId, shotId),
      shotId
    };
  }
  return { requestedId, shotId: normalizeShotId(requestedId) ?? void 0 };
}
async function getAssetWorkspaceSnapshot() {
  const root = await getProjectRoot();
  await migrateCachedShotDesigns(root);
  const cached = await readProjectJsonSnapshot(root);
  if (cached) return cached;
  let index = await scanVisibleProject(root);
  if (await ensureMissingDocumentSidecars(index)) {
    index = await scanVisibleProject(root);
  }
  const projectSettingsFile = index.files.find((file) => file.relativePath === "\u9879\u76EE\u8BBE\u5B9A.md");
  const projectSettingsContent = projectSettingsFile ? await readIndexedText(projectSettingsFile) : "";
  const [characters, locations, props, storedShots] = await Promise.all([
    buildCharacterAssets(index),
    buildSimpleDocumentAssets(index, "\u573A\u666F", "\u573A\u666F\u8BBE\u5B9A.md", LOCATION_SLOT_DEFINITIONS, "location"),
    buildSimpleDocumentAssets(index, "\u9053\u5177", "\u9053\u5177\u8BBE\u5B9A.md", PROP_SLOT_DEFINITIONS, "prop"),
    buildStoredShotAssets(index)
  ]);
  const scenes = await buildSceneAssets(index, storedShots, locations, props);
  const storedKeys = new Set(storedShots.map((shot) => getShotIdentityKey(shot.design)));
  const draftKeys = /* @__PURE__ */ new Set();
  const drafts = [];
  const storyboardFiles = index.files.filter((file) => getAssetKind(file.name) === "markdown" && file.name.includes("\u5206\u955C")).sort((left, right) => {
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
  const snapshot = {
    rootName: path.basename(root),
    projectSettings: {
      path: "\u9879\u76EE\u8BBE\u5B9A.md",
      content: projectSettingsContent,
      revision: createTextRevision(projectSettingsContent)
    },
    characters,
    locations,
    props,
    scenes,
    shots: [...storedShots, ...drafts].sort(compareShots),
    projectIndex: await readProjectAssetIndex(root),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await writeProjectJsonSnapshot(root, snapshot);
  return snapshot;
}
async function readProjectJsonSnapshot(root) {
  const target = path.join(root, PROJECT_JSON_PATH);
  let info;
  try {
    info = await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new ProjectPathError(".workbench/project.json \u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\u3002");
  }
  if (info.size > MAX_PROJECT_JSON_BYTES) throw new ProjectPathError(".workbench/project.json \u8D85\u8FC7 20 MB\u3002");
  let value;
  try {
    value = JSON.parse(await fs.readFile(target, "utf8"));
  } catch {
    throw new ProjectPathError(".workbench/project.json \u4E0D\u662F\u6709\u6548 JSON\u3002");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectPathError(".workbench/project.json \u5FC5\u987B\u662F JSON \u5BF9\u8C61\u3002");
  }
  const raw = value;
  if (LEGACY_PROJECT_SNAPSHOT_SCHEMA_VERSIONS.has(raw.schemaVersion)) return void 0;
  const arrays = ["characters", "locations", "props", "scenes", "shots"];
  if (raw.schemaVersion !== PROJECT_SNAPSHOT_SCHEMA_VERSION || raw.rootName !== path.basename(root) || !raw.projectSettings || arrays.some((key) => !Array.isArray(raw[key]))) {
    throw new ProjectPathError(".workbench/project.json \u7684\u7248\u672C\u6216\u8D44\u4EA7\u7ED3\u6784\u65E0\u6548\u3002");
  }
  const hasStructuredIndex = Boolean(
    raw.projectIndex && typeof raw.projectIndex === "object" && Array.isArray(raw.projectIndex.chapters) && raw.projectIndex.chapters.length
  );
  if (cachedSnapshotUsesLegacySlots(raw)) return void 0;
  if (cachedSnapshotMissingDocumentJson(raw)) return void 0;
  if (!await projectJsonIsFresh(root, info.mtimeMs, hasStructuredIndex)) return void 0;
  hydrateCachedCharacterPromptFields(raw);
  for (const scene of raw.scenes) {
    if (!Array.isArray(scene.locationBindings)) scene.locationBindings = [];
    if (!Array.isArray(scene.propBindings)) scene.propBindings = [];
    if (typeof scene.assetBindingsRevision !== "string") scene.assetBindingsRevision = createTextRevision("");
  }
  return raw;
}
function cachedSnapshotMissingDocumentJson(raw) {
  const missing = (item, contentKey, jsonKey) => item && typeof item === "object" && !Array.isArray(item) && typeof item[contentKey] === "string" && typeof item[jsonKey] !== "string";
  const characters = Array.isArray(raw.characters) ? raw.characters : [];
  if (characters.some((character) => {
    if (missing(character, "profileContent", "profileJsonPath")) return true;
    const looks = character && typeof character === "object" && !Array.isArray(character) ? character.looks : void 0;
    return Array.isArray(looks) && looks.some((look) => missing(look, "documentContent", "documentJsonPath"));
  })) return true;
  for (const key of ["locations", "props"]) {
    const assets = Array.isArray(raw[key]) ? raw[key] : [];
    if (assets.some((asset) => missing(asset, "profileContent", "profileJsonPath"))) return true;
  }
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  return scenes.some((scene) => missing(scene, "sceneContent", "sceneJsonPath"));
}
function cachedSnapshotUsesLegacySlots(raw) {
  const hasSlot = (value, legacyKeys) => {
    if (!Array.isArray(value)) return false;
    return value.some((slot) => slot && typeof slot === "object" && !Array.isArray(slot) && legacyKeys.includes(slot.key));
  };
  const characters = Array.isArray(raw.characters) ? raw.characters : [];
  if (characters.some((character) => {
    if (!character || typeof character !== "object" || Array.isArray(character)) return false;
    const item = character;
    if (hasSlot(item.slots, ["costume", "reference"])) return true;
    return Array.isArray(item.looks) && item.looks.some((look) => look && typeof look === "object" && !Array.isArray(look) && hasSlot(look.slots, ["costume", "reference"]));
  })) return true;
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  return scenes.some((scene) => scene && typeof scene === "object" && !Array.isArray(scene) && hasSlot(scene.slots, ["setting", "reference", "firstFrame", "lastFrame", "video"]));
}
function hydrateCachedCharacterPromptFields(raw) {
  if (!Array.isArray(raw.characters)) return;
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const firstString = (value, keys) => {
    for (const key of keys) {
      if (typeof value[key] === "string") return value[key];
    }
    return void 0;
  };
  for (const item of raw.characters) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const character = item;
    const profile = typeof character.profileContent === "string" ? character.profileContent : "";
    if (!hasOwn(character, "turnaroundPrompt")) {
      const alias = firstString(character, [
        "turnaround_prompt",
        "threeViewPrompt",
        "three_view_prompt",
        "visualPrompt",
        "visual_prompt"
      ]);
      if (alias !== void 0) character.turnaroundPrompt = alias;
      else {
        const parsed = readCharacterTurnaroundPromptFields(profile);
        if (parsed.prompt) character.turnaroundPrompt = parsed.prompt;
      }
    }
    if (!hasOwn(character, "turnaroundNegativePrompt")) {
      const alias = firstString(character, [
        "turnaround_negative_prompt",
        "turnaroundNegative",
        "visualNegativePrompt",
        "visual_negative_prompt",
        "negativePrompt",
        "negative_prompt"
      ]);
      if (alias !== void 0) character.turnaroundNegativePrompt = alias;
      else {
        const parsed = readCharacterTurnaroundPromptFields(profile);
        if (parsed.negativePrompt) character.turnaroundNegativePrompt = parsed.negativePrompt;
      }
    }
    if (!Array.isArray(character.looks)) continue;
    for (const lookItem of character.looks) {
      if (!lookItem || typeof lookItem !== "object" || Array.isArray(lookItem)) continue;
      const look = lookItem;
      const document = typeof look.documentContent === "string" ? look.documentContent : "";
      if (!hasOwn(look, "prompt")) {
        const alias = firstString(look, [
          "costumePrompt",
          "costume_prompt",
          "visualPrompt",
          "visual_prompt"
        ]);
        if (alias !== void 0) look.prompt = alias;
        else {
          const parsed = readCharacterLookPromptFields(document);
          if (parsed.prompt) look.prompt = parsed.prompt;
        }
      }
      if (!hasOwn(look, "negativePrompt")) {
        const alias = firstString(look, [
          "costumeNegativePrompt",
          "costume_negative_prompt",
          "visualNegativePrompt",
          "visual_negative_prompt",
          "negative_prompt"
        ]);
        if (alias !== void 0) look.negativePrompt = alias;
        else {
          const parsed = readCharacterLookPromptFields(document);
          if (parsed.negativePrompt) look.negativePrompt = parsed.negativePrompt;
        }
      }
    }
  }
}
async function projectJsonIsFresh(root, cacheMtimeMs, hasStructuredIndex) {
  if (!hasStructuredIndex) {
    for (const metadataPath of [PROJECT_INDEX_PATH]) {
      try {
        const metadataStats = await fs.lstat(path.join(root, metadataPath));
        if (metadataStats.mtimeMs > cacheMtimeMs) return false;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  if (hasStructuredIndex) return true;
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || HIDDEN_DIRECTORIES.has(entry.name)) continue;
      const target = path.join(directory, entry.name);
      const stats = await fs.lstat(target);
      if (stats.isSymbolicLink()) continue;
      if (stats.mtimeMs > cacheMtimeMs) return false;
      if (stats.isDirectory() && !await visit(target)) return false;
    }
    return true;
  }
  return visit(root);
}
async function writeProjectJsonSnapshot(root, snapshot) {
  const directory = await getVerifiedWorkbenchDirectory(root);
  const target = path.join(directory, "project.json");
  const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: PROJECT_SNAPSHOT_SCHEMA_VERSION, ...snapshot }, null, 2)}
`, {
      encoding: "utf8",
      flag: "wx",
      mode: 384
    });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => void 0);
    throw error;
  }
}
function isSafeIndexPath(value) {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && !normalized.split("/").some((part) => !part || part.startsWith("."));
}
function parseProjectAssetIndex(value, projectName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectPathError(".workbench/index.json \u5FC5\u987B\u662F JSON \u5BF9\u8C61\u3002");
  }
  const raw = value;
  if (raw.schemaVersion !== 1 || raw.projectName !== projectName || !Array.isArray(raw.chapters)) {
    throw new ProjectPathError(".workbench/index.json \u7684\u7248\u672C\u3001\u9879\u76EE\u540D\u6216\u7AE0\u8282\u7ED3\u6784\u65E0\u6548\u3002");
  }
  if (raw.chapters.length > 1e3) throw new ProjectPathError(".workbench/index.json \u7684\u7AE0\u8282\u6570\u91CF\u8D85\u8FC7\u4E0A\u9650\u3002");
  const chapters = raw.chapters.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ProjectPathError(`.workbench/index.json \u7B2C ${index + 1} \u4E2A\u7AE0\u8282\u65E0\u6548\u3002`);
    }
    const chapter = item;
    const text = (key, required = true) => {
      const value2 = chapter[key];
      if (value2 === void 0 && !required) return "";
      if (typeof value2 !== "string" || required && !value2.trim() || value2.length > 240) {
        throw new ProjectPathError(`.workbench/index.json \u7AE0\u8282\u5B57\u6BB5 ${key} \u65E0\u6548\u3002`);
      }
      return value2.trim();
    };
    const paths = (key) => {
      const value2 = chapter[key];
      if (!Array.isArray(value2) || value2.length > 200 || !value2.every(isSafeIndexPath)) {
        throw new ProjectPathError(`.workbench/index.json \u7AE0\u8282\u5B57\u6BB5 ${key} \u5FC5\u987B\u662F\u9879\u76EE\u76F8\u5BF9\u8DEF\u5F84\u6570\u7EC4\u3002`);
      }
      return [...new Set(value2)];
    };
    return {
      id: text("id"),
      title: text("title"),
      ...text("sourcePath", false) ? { sourcePath: text("sourcePath", false) } : {},
      characterPaths: paths("characterPaths"),
      locationPaths: paths("locationPaths"),
      propPaths: paths("propPaths"),
      scenePaths: paths("scenePaths"),
      ...text("status", false) ? { status: text("status", false) } : {}
    };
  });
  return {
    schemaVersion: 1,
    projectName,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    chapters
  };
}
async function readProjectAssetIndex(root) {
  const target = path.join(root, PROJECT_INDEX_PATH);
  let info;
  try {
    info = await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new ProjectPathError(".workbench/index.json \u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\u3002");
  }
  if (info.size > MAX_PROJECT_INDEX_BYTES) throw new ProjectPathError(".workbench/index.json \u8D85\u8FC7 1 MB\u3002");
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(target, "utf8"));
  } catch {
    throw new ProjectPathError(".workbench/index.json \u4E0D\u662F\u6709\u6548 JSON\u3002");
  }
  return parseProjectAssetIndex(parsed, path.basename(root));
}
async function readProjectIndex() {
  return readProjectAssetIndex(await getProjectRoot());
}
async function rebuildProjectIndex() {
  const root = await getProjectRoot();
  const existingIndex = await readProjectAssetIndex(root);
  await fs.rm(path.join(root, PROJECT_JSON_PATH), { force: true });
  const snapshot = await getAssetWorkspaceSnapshot();
  const index = {
    schemaVersion: 1,
    projectName: snapshot.rootName,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    chapters: existingIndex?.chapters ?? snapshot.projectIndex?.chapters ?? []
  };
  const directory = await getVerifiedWorkbenchDirectory(root);
  const target = path.join(directory, "index.json");
  const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(index, null, 2)}
`, { encoding: "utf8", flag: "wx", mode: 384 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => void 0);
    throw error;
  }
  await writeAudit({ action: "rebuild-project-index", path: PROJECT_INDEX_PATH });
  return PROJECT_INDEX_PATH;
}
async function getProjectSnapshot() {
  return getAssetWorkspaceSnapshot();
}
function structureParentPath(relativePath) {
  const separatorIndex = relativePath.lastIndexOf("/");
  return separatorIndex < 0 ? "" : relativePath.slice(0, separatorIndex);
}
function sortStructureNodes(nodes) {
  nodes.sort((left, right) => {
    const kindOrder = Number(left.kind !== "folder") - Number(right.kind !== "folder");
    return kindOrder || left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true });
  });
  for (const node of nodes) {
    if (node.children?.length) sortStructureNodes(node.children);
  }
}
async function getProjectStructureSnapshot() {
  const root = await getProjectRoot();
  const index = await scanVisibleProject(root);
  const rootStats = await fs.stat(
    /* turbopackIgnore: true */
    root
  );
  const roots = [];
  const directories = /* @__PURE__ */ new Map();
  const appendNode = (node, parentPath) => {
    const parent = parentPath ? directories.get(parentPath) : void 0;
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
    const node = {
      name: directory.name,
      path: directory.relativePath,
      kind: "folder",
      updatedAt: directory.stats.mtime.toISOString(),
      children: []
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
      updatedAt: file.stats.mtime.toISOString()
    }, structureParentPath(file.relativePath));
  }
  sortStructureNodes(roots);
  return {
    rootName: path.basename(root),
    tree: roots,
    updatedAt: new Date(Math.max(
      rootStats.mtimeMs,
      ...index.directories.map((entry) => entry.stats.mtimeMs),
      ...index.files.map((entry) => entry.stats.mtimeMs)
    )).toISOString()
  };
}
async function readTextAsset(relativePath) {
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
      updatedAt: stats.mtime.toISOString()
    };
  } finally {
    await handle.close();
  }
}
async function updateProjectSettings(content, expectedRevision) {
  const root = await getProjectRoot();
  const safeContent = validateLongText(content, "Project settings");
  const target = await resolveWritablePath("\u9879\u76EE\u8BBE\u5B9A.md");
  await withDirectoryLock(root, async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    const nextContent = safeContent.endsWith("\n") ? safeContent : `${safeContent}
`;
    await writeTextAtomically(target, nextContent);
  });
  await writeAudit({ action: "update-project-settings", path: "\u9879\u76EE\u8BBE\u5B9A.md" });
  return "\u9879\u76EE\u8BBE\u5B9A.md";
}
function validateNewName(name) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.startsWith(".") || trimmed === "." || trimmed === ".." || trimmed !== path.basename(trimmed) || /[\\/\\\\\u0000-\u001f]/.test(trimmed)) {
    throw new ProjectPathError("Use a non-empty filename without path separators.");
  }
  return trimmed;
}
var directoryLocks = /* @__PURE__ */ new Map();
async function ensureVerifiedInternalDirectory(root, parent, name) {
  const candidate = path.join(parent, name);
  assertInsideRoot(root, candidate);
  try {
    await fs.mkdir(candidate);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const entry = await fs.lstat(candidate);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new ProjectPathError("The workbench storage directory must be a regular directory.");
  }
  const actualPath = await fs.realpath(candidate);
  assertInsideRoot(root, actualPath);
  return actualPath;
}
async function getVerifiedWorkbenchDirectory(root) {
  return ensureVerifiedInternalDirectory(root, root, ".workbench");
}
async function getVerifiedTrashDirectory(root) {
  const workbenchDirectory = await getVerifiedWorkbenchDirectory(root);
  return ensureVerifiedInternalDirectory(root, workbenchDirectory, ".Trash");
}
async function withDirectoryLock(directory, operation) {
  const previous = directoryLocks.get(directory) ?? Promise.resolve();
  let release = () => void 0;
  const gate = new Promise((resolve) => {
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
async function assertTargetDoesNotExist(target) {
  try {
    await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new ProjectPathError("A file with that name already exists.");
}
async function writeAudit(event) {
  try {
    const root = await getProjectRoot();
    await fs.rm(path.join(root, PROJECT_JSON_PATH), { force: true });
    const auditDirectory = await getVerifiedWorkbenchDirectory(root);
    const auditPath = path.join(auditDirectory, "audit.ndjson");
    await withDirectoryLock(auditPath, async () => {
      await fs.appendFile(
        auditPath,
        `${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...event })}
`
      );
    });
    await getAssetWorkspaceSnapshot();
  } catch (error) {
    console.error("Unable to append workbench audit event.", {
      action: event.action,
      error
    });
  }
}
async function createFolder(relativePath) {
  const visiblePath = assertVisibleProjectPath(relativePath);
  const target = await resolveWritablePath(visiblePath);
  await getVerifiedWorkbenchDirectory(await getProjectRoot());
  await fs.mkdir(target, { recursive: false });
  await writeAudit({ action: "mkdir", path: visiblePath });
}
async function renameAsset(relativePath, newName) {
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
function validateTrashEntryId(value) {
  const id = value.trim();
  if (!TRASH_ENTRY_ID_PATTERN.test(id)) {
    throw new ProjectPathError("\u56DE\u6536\u7AD9\u9879\u76EE\u7F16\u53F7\u65E0\u6548\u3002");
  }
  return id;
}
function parseTrashEntryMetadata(value, payloadName) {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version !== 1 || typeof parsed.originalPath !== "string" || typeof parsed.trashedAt !== "string") {
      return void 0;
    }
    const originalPath = assertVisibleProjectPath(parsed.originalPath);
    if (path.basename(originalPath) !== payloadName || Number.isNaN(Date.parse(parsed.trashedAt))) {
      return void 0;
    }
    return { version: 1, originalPath, trashedAt: parsed.trashedAt };
  } catch {
    return void 0;
  }
}
async function inspectTrashEntry(root, trashDirectory, entryName) {
  if (!TRASH_ENTRY_ID_PATTERN.test(entryName)) return void 0;
  const entryDirectory = path.join(trashDirectory, entryName);
  assertInsideRoot(root, entryDirectory);
  const entryStats = await fs.lstat(entryDirectory);
  if (!entryStats.isDirectory() || entryStats.isSymbolicLink()) return void 0;
  const entries = await fs.readdir(entryDirectory, { withFileTypes: true });
  const payloadEntries = entries.filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isFile()) && !entry.isSymbolicLink());
  const payload = payloadEntries.length === 1 ? payloadEntries[0] : void 0;
  if (!payload) {
    return {
      id: entryName,
      name: "\u65E0\u6CD5\u8BC6\u522B\u7684\u56DE\u6536\u9879\u76EE",
      trashedAt: entryStats.mtime.toISOString(),
      kind: "other",
      isDirectory: false,
      recoverable: false
    };
  }
  const payloadPath = path.join(entryDirectory, payload.name);
  const payloadStats = await fs.lstat(payloadPath);
  const metadataPath = path.join(entryDirectory, TRASH_METADATA_FILE);
  let metadata;
  try {
    const metadataStats = await fs.lstat(metadataPath);
    if (metadataStats.isFile() && !metadataStats.isSymbolicLink() && metadataStats.size <= 64 * 1024) {
      metadata = parseTrashEntryMetadata(await fs.readFile(metadataPath, "utf8"), payload.name);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    id: entryName,
    name: payload.name,
    ...metadata ? { originalPath: metadata.originalPath } : {},
    trashedAt: metadata?.trashedAt ?? entryStats.mtime.toISOString(),
    kind: getAssetKind(payload.name, payload.isDirectory()),
    isDirectory: payload.isDirectory(),
    ...payload.isFile() ? { size: payloadStats.size } : {},
    recoverable: Boolean(metadata)
  };
}
async function getVerifiedTrashPayload(root, entryId) {
  const trashDirectory = await getVerifiedTrashDirectory(root);
  const id = validateTrashEntryId(entryId);
  const entryDirectory = path.join(trashDirectory, id);
  assertInsideRoot(root, entryDirectory);
  const entryStats = await fs.lstat(entryDirectory);
  if (!entryStats.isDirectory() || entryStats.isSymbolicLink()) {
    throw new ProjectPathError("\u56DE\u6536\u7AD9\u9879\u76EE\u5DF2\u4E0D\u53EF\u7528\u3002");
  }
  const actualEntryDirectory = await fs.realpath(entryDirectory);
  assertInsideRoot(root, actualEntryDirectory);
  if (actualEntryDirectory !== entryDirectory) {
    throw new ProjectPathError("\u56DE\u6536\u7AD9\u9879\u76EE\u4E0D\u80FD\u5305\u542B\u8F6F\u94FE\u63A5\u3002");
  }
  const entries = await fs.readdir(entryDirectory, { withFileTypes: true });
  const payloadEntries = entries.filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isFile()) && !entry.isSymbolicLink());
  if (payloadEntries.length !== 1) {
    throw new ProjectPathError("\u8FD9\u4E2A\u65E7\u56DE\u6536\u7AD9\u9879\u76EE\u6CA1\u6709\u53EF\u5B89\u5168\u6062\u590D\u7684\u5355\u4E00\u7D20\u6750\u3002");
  }
  const payload = payloadEntries[0];
  const payloadPath = path.join(entryDirectory, payload.name);
  const payloadStats = await fs.lstat(payloadPath);
  if (!payloadStats.isFile() && !payloadStats.isDirectory() || payloadStats.isSymbolicLink()) {
    throw new ProjectPathError("\u56DE\u6536\u7AD9\u4E2D\u7684\u7D20\u6750\u5DF2\u4E0D\u53EF\u7528\u3002");
  }
  const metadataPath = path.join(entryDirectory, TRASH_METADATA_FILE);
  const metadataStats = await fs.lstat(metadataPath);
  if (!metadataStats.isFile() || metadataStats.isSymbolicLink() || metadataStats.size > 64 * 1024) {
    throw new ProjectPathError("\u8FD9\u4E2A\u65E7\u56DE\u6536\u7AD9\u9879\u76EE\u7F3A\u5C11\u6062\u590D\u4FE1\u606F\uFF0C\u65E0\u6CD5\u81EA\u52A8\u6062\u590D\u3002");
  }
  const metadata = parseTrashEntryMetadata(await fs.readFile(metadataPath, "utf8"), payload.name);
  if (!metadata) {
    throw new ProjectPathError("\u8FD9\u4E2A\u65E7\u56DE\u6536\u7AD9\u9879\u76EE\u7684\u6062\u590D\u4FE1\u606F\u65E0\u6548\uFF0C\u65E0\u6CD5\u81EA\u52A8\u6062\u590D\u3002");
  }
  return { entryDirectory, metadataPath, payloadPath, payloadName: payload.name, metadata };
}
async function getTrashEntries() {
  const root = await getProjectRoot();
  const trashDirectory = await getVerifiedTrashDirectory(root);
  const entries = await fs.readdir(trashDirectory, { withFileTypes: true });
  const inspected = await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".")).map((entry) => inspectTrashEntry(root, trashDirectory, entry.name)));
  return inspected.filter((entry) => Boolean(entry)).sort((left, right) => right.trashedAt.localeCompare(left.trashedAt));
}
async function restoreTrashEntry(entryId) {
  const root = await getProjectRoot();
  const trash = await getVerifiedTrashPayload(root, entryId);
  const target = await resolveWritablePath(trash.metadata.originalPath);
  const targetParent = path.dirname(target);
  const parentStats = await fs.lstat(targetParent).catch((error) => {
    if (error.code === "ENOENT") {
      throw new ProjectPathError("\u539F\u4F4D\u7F6E\u7684\u4E0A\u7EA7\u8D44\u4EA7\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5148\u6062\u590D\u4E0A\u7EA7\u8D44\u4EA7\u540E\u518D\u6062\u590D\u6B64\u9879\u3002");
    }
    throw error;
  });
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new ProjectPathError("\u539F\u4F4D\u7F6E\u7684\u4E0A\u7EA7\u76EE\u5F55\u4E0D\u53EF\u7528\u4E8E\u6062\u590D\u3002");
  }
  const actualParent = await fs.realpath(targetParent);
  assertInsideRoot(root, actualParent);
  if (actualParent !== targetParent) {
    throw new ProjectPathError("\u539F\u4F4D\u7F6E\u4E0D\u80FD\u5305\u542B\u8F6F\u94FE\u63A5\uFF0C\u65E0\u6CD5\u6062\u590D\u3002");
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
              rollbackError
            });
            throw new ProjectPathError("\u6062\u590D\u540E\u6E05\u7406\u56DE\u6536\u7AD9\u5931\u8D25\uFF0C\u6587\u4EF6\u53EF\u80FD\u5DF2\u6062\u590D\u3002\u8BF7\u5237\u65B0\u9879\u76EE\u76EE\u5F55\u540E\u786E\u8BA4\u7D20\u6750\u4F4D\u7F6E\u3002");
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
async function moveToTrash(relativePath) {
  const visiblePath = assertVisibleProjectPath(relativePath);
  const source = await resolveMutableExistingPath(visiblePath);
  const root = await getProjectRoot();
  const baseName = path.basename(source);
  const trashDirectory = await getVerifiedTrashDirectory(root);
  const trashEntryDirectory = path.join(trashDirectory, randomUUID());
  await fs.mkdir(trashEntryDirectory);
  const target = path.join(trashEntryDirectory, baseName);
  const metadataPath = path.join(trashEntryDirectory, TRASH_METADATA_FILE);
  const metadata = {
    version: 1,
    originalPath: visiblePath,
    trashedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  try {
    await fs.writeFile(metadataPath, JSON.stringify(metadata), { encoding: "utf8", flag: "wx", mode: 384 });
    await fs.rename(source, target);
  } catch (error) {
    await fs.rm(trashEntryDirectory, { recursive: true, force: true }).catch(() => void 0);
    throw error;
  }
  const trashPath = makeRelative(root, target);
  await writeAudit({ action: "trash", from: visiblePath, to: trashPath });
  return trashPath;
}
function getSlotDefinition(assetType, slotKey) {
  const definitions = assetType === "character" ? CHARACTER_SLOT_DEFINITIONS : assetType === "location" ? LOCATION_SLOT_DEFINITIONS : assetType === "prop" ? PROP_SLOT_DEFINITIONS : assetType === "scene" ? SCENE_SLOT_DEFINITIONS : SHOT_SLOT_DEFINITIONS;
  const definition = definitions.find(({ key }) => key === slotKey);
  if (!definition) {
    throw new ProjectPathError("That material slot is not available for this asset type.");
  }
  return definition;
}
var MAX_ASSET_UPLOAD_BYTES = 200 * 1024 * 1024;
var UPLOAD_PROBE_BYTES = 4096;
var UPLOAD_FORMAT_BY_EXTENSION = {
  ".avif": "avif",
  ".gif": "gif",
  ".jpeg": "jpeg",
  ".jpg": "jpeg",
  ".mkv": "mkv",
  ".mov": "mov",
  ".mp4": "mp4",
  ".png": "png",
  ".webm": "webm",
  ".webp": "webp"
};
function getUploadFormatKind(format) {
  return format === "mp4" || format === "mov" || format === "webm" || format === "mkv" ? "video" : "image";
}
function hasAsciiAt(data, offset, value) {
  if (offset < 0 || offset + value.length > data.length) return false;
  return data.subarray(offset, offset + value.length).toString("ascii") === value;
}
function detectUploadMediaFormat(data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "png";
  }
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "jpeg";
  if (hasAsciiAt(data, 0, "GIF87a") || hasAsciiAt(data, 0, "GIF89a")) return "gif";
  if (hasAsciiAt(data, 0, "RIFF") && hasAsciiAt(data, 8, "WEBP")) return "webp";
  if (data.length >= 16 && hasAsciiAt(data, 4, "ftyp")) {
    const boxSize = data.readUInt32BE(0);
    if (boxSize >= 16 && boxSize <= data.length) {
      const brands = [];
      for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
        brands.push(data.subarray(offset, offset + 4).toString("ascii"));
      }
      if (brands.includes("avif") || brands.includes("avis")) return "avif";
      if (brands.includes("qt  ")) return "mov";
      return "mp4";
    }
  }
  if (data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) {
    if (data.includes(Buffer.from("webm", "ascii"))) return "webm";
    if (data.includes(Buffer.from("matroska", "ascii"))) return "mkv";
  }
  return void 0;
}
function assertValidUploadMedia(assetType, slotKey, fileName, probe) {
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
async function writeBufferFully(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset);
    if (!bytesWritten) throw new ProjectPathError("The upload stream stopped before the file could be written.");
    offset += bytesWritten;
  }
}
async function getVerifiedUploadDirectory(root) {
  const workbenchDirectory = await getVerifiedWorkbenchDirectory(root);
  return ensureVerifiedInternalDirectory(root, workbenchDirectory, ".uploads");
}
async function getVerifiedWorkspaceAsset(assetType, assetPath) {
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
    if (!location) throw new ProjectPathError("\u6240\u9009\u573A\u666F\u8D44\u4EA7\u5DF2\u4E0D\u5B58\u5728\u3002");
    await resolveMutableExistingPath(location.rootPath);
    return { rootPath: location.rootPath, slots: location.slots, location };
  }
  if (assetType === "prop") {
    const prop = snapshot.props.find((candidate) => candidate.rootPath === visiblePath);
    if (!prop) throw new ProjectPathError("\u6240\u9009\u9053\u5177\u8D44\u4EA7\u5DF2\u4E0D\u5B58\u5728\u3002");
    await resolveMutableExistingPath(prop.rootPath);
    return { rootPath: prop.rootPath, slots: prop.slots, prop };
  }
  const shot = snapshot.shots.find((asset) => !asset.isDraft && asset.rootPath === visiblePath);
  if (!shot?.rootPath) throw new ProjectPathError("Create this shot asset before changing its files.");
  await resolveMutableExistingPath(shot.rootPath);
  return { rootPath: shot.rootPath, slots: shot.slots, shot };
}
function resolveCharacterReference(snapshot, characterPath, lookPath) {
  const safeCharacterPath = assertVisibleProjectPath(characterPath);
  const character = snapshot.characters.find((asset) => asset.rootPath === safeCharacterPath);
  if (!character) throw new ProjectPathError("Choose a character that exists in the active project.");
  if (!lookPath?.trim()) return { character, characterPath: safeCharacterPath };
  const safeLookPath = assertVisibleProjectPath(lookPath);
  const look = character.looks.find((candidate) => candidate.rootPath === safeLookPath);
  if (!look) throw new ProjectPathError("Choose a costume look that belongs to the selected character.");
  return { character, look, characterPath: safeCharacterPath, lookPath: safeLookPath };
}
async function getVerifiedCharacterLook(characterPath, lookPath) {
  const snapshot = await getAssetWorkspaceSnapshot();
  const reference = resolveCharacterReference(snapshot, characterPath, lookPath);
  if (!reference.look) throw new ProjectPathError("Choose a reusable character costume look.");
  await resolveMutableExistingPath(reference.character.rootPath);
  await resolveMutableExistingPath(reference.look.rootPath);
  return { character: reference.character, look: reference.look };
}
function getCharacterReferenceLocations(snapshot, characterPath) {
  const locations = [];
  for (const scene of snapshot.scenes) {
    if (scene.castBindings.some((binding) => binding.characterPath === characterPath)) {
      locations.push(`${scene.sceneId} \u7684\u51FA\u573A\u4E0E\u9020\u578B\u8868`);
    }
  }
  for (const shot of snapshot.shots) {
    if (shot.isDraft || !shot.design.characterOverrides?.some((override) => override.characterPath === characterPath)) {
      continue;
    }
    locations.push(`${shot.design.sceneId} / ${shot.design.shotId} \u7684\u955C\u5934\u8986\u76D6`);
  }
  return locations;
}
function assertCharacterIsNotReferenced(snapshot, character, action) {
  const locations = getCharacterReferenceLocations(snapshot, character.rootPath);
  if (!locations.length) return;
  const visibleLocations = locations.slice(0, 3).join("\u3001");
  const suffix = locations.length > 3 ? ` \u7B49 ${locations.length} \u5904` : "";
  throw new ProjectPathError(
    `\u4EBA\u7269\u201C${character.name}\u201D\u5DF2\u88AB ${visibleLocations}${suffix}\u5F15\u7528\u3002\u4E3A\u907F\u514D\u573A\u6B21\u548C\u955C\u5934\u5931\u53BB\u4EBA\u7269\u5173\u7CFB\uFF0C\u6682\u4E0D\u80FD${action}\uFF1B\u8BF7\u5148\u5728\u5206\u955C\u4E2D\u89E3\u9664\u6216\u66FF\u6362\u8FD9\u4E9B\u5F15\u7528\u3002`
  );
}
function assertSimpleAssetIsNotReferenced(snapshot, asset, assetType, action) {
  const locations = [];
  for (const scene of snapshot.scenes) {
    const bindings = assetType === "location" ? scene.locationBindings ?? [] : scene.propBindings ?? [];
    const pathKey = assetType === "location" ? "locationPath" : "propPath";
    if (bindings.some((binding) => binding[pathKey] === asset.rootPath)) locations.push(`${scene.sceneId} \u7684\u573A\u6B21\u8D44\u4EA7\u8868`);
  }
  if (!locations.length) return;
  throw new ProjectPathError(`${assetType === "location" ? "\u5730\u70B9/\u73AF\u5883" : "\u9053\u5177"}\u201C${asset.name}\u201D\u5DF2\u88AB ${locations.slice(0, 3).join("\u3001")}${locations.length > 3 ? ` \u7B49 ${locations.length} \u5904` : ""}\u5F15\u7528\uFF0C\u6682\u4E0D\u80FD${action}\uFF1B\u8BF7\u5148\u5728\u5206\u955C\u4E2D\u89E3\u9664\u6216\u66FF\u6362\u8FD9\u4E9B\u5F15\u7528\u3002`);
}
function normalizeSceneRangeShotId(value, label) {
  const text = validateOneLine(value, label, 120);
  if (!text) return "";
  const shotId = normalizeShotId(text);
  if (!shotId) throw new ProjectPathError(`${label} must use a shot number such as SH001.`);
  return shotId;
}
function shotNumber(shotId, fallback) {
  const normalized = normalizeShotId(shotId);
  return normalized ? Number.parseInt(normalized.slice(2), 10) : fallback;
}
function doShotRangesOverlap(left, right) {
  const leftStart = shotNumber(left.startShotId, Number.NEGATIVE_INFINITY);
  const leftEnd = shotNumber(left.endShotId, Number.POSITIVE_INFINITY);
  const rightStart = shotNumber(right.startShotId, Number.NEGATIVE_INFINITY);
  const rightEnd = shotNumber(right.endShotId, Number.POSITIVE_INFINITY);
  return leftStart <= rightEnd && rightStart <= leftEnd;
}
function sceneCastBindingAppliesToShot(binding, shotId) {
  const currentShot = normalizeShotId(shotId);
  if (!currentShot) return false;
  const current = shotNumber(currentShot, Number.NaN);
  const start = binding.startShotId ? shotNumber(binding.startShotId, Number.NaN) : Number.NEGATIVE_INFINITY;
  const end = binding.endShotId ? shotNumber(binding.endShotId, Number.NaN) : Number.POSITIVE_INFINITY;
  return Number.isFinite(current) && current >= start && current <= end;
}
function getSceneBindingsForShot(snapshot, sceneId, shotId) {
  const normalizedSceneId = normalizeSceneIdentity(sceneId);
  return snapshot.scenes.find((scene) => normalizeSceneIdentity(scene.sceneId) === normalizedSceneId)?.castBindings.filter((binding) => sceneCastBindingAppliesToShot(binding, shotId)) ?? [];
}
function validateSceneCastBindings(bindings, snapshot) {
  if (!Array.isArray(bindings) || bindings.length > 120) {
    throw new ProjectPathError("A scene cast sheet must be a short list of bindings.");
  }
  const normalized = bindings.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ProjectPathError("Each scene cast binding must be an object.");
    }
    const candidate = item;
    const characterPathInput = validateOneLine(candidate.characterPath, "Scene character path", 500);
    const lookPathInput = candidate.lookPath === void 0 ? void 0 : validateOneLine(candidate.lookPath, "Scene look path", 500) || void 0;
    const reference = resolveCharacterReference(snapshot, characterPathInput, lookPathInput);
    const startShotId = normalizeSceneRangeShotId(candidate.startShotId, "Scene cast start shot");
    const endShotId = normalizeSceneRangeShotId(candidate.endShotId, "Scene cast end shot");
    if (startShotId && endShotId && shotNumber(startShotId, 0) > shotNumber(endShotId, 0)) {
      throw new ProjectPathError("A scene cast binding cannot end before it starts.");
    }
    return {
      characterPath: reference.characterPath,
      ...reference.lookPath ? { lookPath: reference.lookPath } : {},
      state: validateOneLine(candidate.state, "Scene character state", 500),
      continuity: validateOneLine(candidate.continuity, "Scene continuity", 500),
      startShotId,
      endShotId
    };
  });
  for (let index = 0; index < normalized.length; index += 1) {
    for (let other = index + 1; other < normalized.length; other += 1) {
      if (normalized[index].characterPath === normalized[other].characterPath && doShotRangesOverlap(normalized[index], normalized[other])) {
        throw new ProjectPathError("\u540C\u4E00\u4EBA\u7269\u5728\u91CD\u53E0\u955C\u5934\u8303\u56F4\u5185\u53EA\u80FD\u6709\u4E00\u5957\u9ED8\u8BA4\u9020\u578B\u3002");
      }
    }
  }
  return normalized;
}
function validateSceneAssetBindings(locations, props, snapshot, sceneId) {
  const sceneShotIds = new Set(
    snapshot.shots.filter((shot) => !shot.isDraft && normalizeSceneIdentity(shot.design.sceneId) === normalizeSceneIdentity(sceneId)).map((shot) => normalizeShotId(shot.design.shotId)).filter((shotId) => Boolean(shotId))
  );
  const validate = (items, key, label) => {
    if (!Array.isArray(items) || items.length > 120) throw new ProjectPathError("\u573A\u6B21\u8D44\u4EA7\u8868\u6700\u591A\u53EA\u80FD\u5305\u542B 120 \u6761\u7ED1\u5B9A\u3002");
    const normalized = items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new ProjectPathError("\u6BCF\u6761\u573A\u6B21\u8D44\u4EA7\u7ED1\u5B9A\u5FC5\u987B\u662F\u5BF9\u8C61\u3002");
      const candidate = item;
      const input = validateOneLine(candidate[key], `${label} path`, 500);
      const safePath = assertVisibleProjectPath(input);
      const found = key === "locationPath" ? snapshot.locations.find((asset) => asset.rootPath === safePath) : snapshot.props.find((asset) => asset.rootPath === safePath);
      if (!found) throw new ProjectPathError(`${label} \u5FC5\u987B\u5C5E\u4E8E\u5F53\u524D\u9879\u76EE\u7684\u9876\u5C42\u8D44\u4EA7\u76EE\u5F55\u3002`);
      const startShotId = normalizeSceneRangeShotId(candidate.startShotId, `${label} start shot`);
      const endShotId = normalizeSceneRangeShotId(candidate.endShotId, `${label} end shot`);
      if (startShotId && endShotId && shotNumber(startShotId, 0) > shotNumber(endShotId, 0)) {
        throw new ProjectPathError(`${label} \u7ED1\u5B9A\u7684\u7ED3\u675F\u955C\u53F7\u4E0D\u80FD\u65E9\u4E8E\u5F00\u59CB\u955C\u53F7\u3002`);
      }
      if (startShotId && !sceneShotIds.has(startShotId)) {
        throw new ProjectPathError(`${label} \u7ED1\u5B9A\u7684\u8D77\u59CB\u955C\u53F7\u4E0D\u5C5E\u4E8E\u5F53\u524D\u573A\u6B21\u3002`);
      }
      if (endShotId && !sceneShotIds.has(endShotId)) {
        throw new ProjectPathError(`${label} \u7ED1\u5B9A\u7684\u7ED3\u675F\u955C\u53F7\u4E0D\u5C5E\u4E8E\u5F53\u524D\u573A\u6B21\u3002`);
      }
      return {
        [key]: safePath,
        role: validateOneLine(candidate.role, `${label} role`, 500),
        state: validateOneLine(candidate.state, `${label} state`, 500),
        continuity: validateOneLine(candidate.continuity, `${label} continuity`, 500),
        startShotId,
        endShotId
      };
    });
    for (let index = 0; index < normalized.length; index += 1) {
      for (let other = index + 1; other < normalized.length; other += 1) {
        if (normalized[index][key] === normalized[other][key] && doShotRangesOverlap(normalized[index], normalized[other])) {
          throw new ProjectPathError(`\u540C\u4E00${label}\u5728\u91CD\u53E0\u955C\u5934\u8303\u56F4\u5185\u4E0D\u80FD\u91CD\u590D\u7ED1\u5B9A\u3002`);
        }
      }
    }
    return normalized;
  };
  return {
    locations: validate(locations, "locationPath", "\u5730\u70B9"),
    props: validate(props, "propPath", "\u9053\u5177")
  };
}
function validateResolvedShotCharacterOverrides(overrides, snapshot, sceneId, shotId) {
  const inheritedBindings = getSceneBindingsForShot(snapshot, sceneId, shotId);
  const seenCharacters = /* @__PURE__ */ new Set();
  return overrides.map((override) => {
    const reference = resolveCharacterReference(
      snapshot,
      override.characterPath,
      override.mode === "look" ? override.lookPath : void 0
    );
    if (seenCharacters.has(reference.characterPath)) {
      throw new ProjectPathError("\u540C\u4E00\u955C\u5934\u4E2D\u7684\u540C\u4E00\u4EBA\u7269\u53EA\u80FD\u8BBE\u7F6E\u4E00\u6761\u9020\u578B\u8986\u76D6\u3002");
    }
    seenCharacters.add(reference.characterPath);
    if (override.mode === "look" && !reference.lookPath) {
      throw new ProjectPathError("\u955C\u5934\u9020\u578B\u8986\u76D6\u9700\u8981\u9009\u62E9\u8BE5\u4EBA\u7269\u7684\u4E00\u5957\u9020\u578B\u3002");
    }
    if (override.mode === "inherit" && !inheritedBindings.some((binding) => binding.characterPath === reference.characterPath)) {
      throw new ProjectPathError("\u53EA\u6709\u5DF2\u5728\u672C\u573A\u5BF9\u5E94\u955C\u5934\u8303\u56F4\u5185\u51FA\u573A\u7684\u4EBA\u7269\u624D\u80FD\u7EE7\u627F\u573A\u6B21\u9ED8\u8BA4\u9020\u578B\u3002");
    }
    return {
      characterPath: reference.characterPath,
      mode: override.mode,
      ...override.mode === "look" && reference.lookPath ? { lookPath: reference.lookPath } : {},
      state: override.state
    };
  });
}
function validateOneLine(value, label, maxLength = 240) {
  if (typeof value !== "string" || value.includes("\0") || /[\r\n]/.test(value)) {
    throw new ProjectPathError(`${label} must be a single line of text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ProjectPathError(`${label} is too long.`);
  }
  return trimmed;
}
function validateLongText(value, label) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new ProjectPathError(`${label} must be text.`);
  }
  if (Buffer.byteLength(value, "utf8") > MAX_TEXT_ASSET_BYTES / 2) {
    throw new ProjectPathError(`${label} is too long.`);
  }
  return value.trim();
}
function validateShotCharacterOverrides(value) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > 80) {
    throw new ProjectPathError("Shot character overrides must be a short list.");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ProjectPathError("Each shot character override must be an object.");
    }
    const candidate = item;
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
    if (candidate.lookPath !== void 0 && candidate.lookPath !== "") {
      throw new ProjectPathError("Only a look override may include a look path.");
    }
    return { characterPath, mode, state };
  });
}
function validateShotDesign(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectPathError("Shot design must be an object.");
  }
  const design = value;
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
    firstFrameNegativePrompt: validateLongText(
      design.firstFrameNegativePrompt ?? "",
      "First-frame negative prompt"
    ),
    lastFramePrompt: validateLongText(design.lastFramePrompt ?? "", "Last-frame prompt"),
    lastFrameNegativePrompt: validateLongText(
      design.lastFrameNegativePrompt ?? "",
      "Last-frame negative prompt"
    ),
    references: validateOneLine(design.references, "Character references", 500),
    videoPrompt: validateLongText(design.videoPrompt ?? "", "Video prompt"),
    characterOverrides: validateShotCharacterOverrides(design.characterOverrides),
    status: validateOneLine(design.status, "Status", 120)
  };
}
var PRESERVED_SHOT_MARKER_START = "<!-- workbench:preserved:start -->";
var PRESERVED_SHOT_MARKER_END = "<!-- workbench:preserved:end -->";
var SOURCE_SHOT_DETAIL_MARKER_START = "<!-- workbench:source-detail:start -->";
var SOURCE_SHOT_DETAIL_MARKER_END = "<!-- workbench:source-detail:end -->";
var MODELED_SHOT_FIELDS = /* @__PURE__ */ new Set([
  "\u573A\u6B21",
  "\u955C\u53F7",
  "\u65F6\u95F4\u7801",
  "\u65F6\u957F",
  "\u666F\u522B\uFF0F\u673A\u4F4D",
  "\u666F\u522B/\u673A\u4F4D",
  "\u666F\u522B",
  "\u8FD0\u955C",
  "\u6444\u5F71\u8FD0\u52A8",
  "\u72B6\u6001",
  "\u53C2\u8003\u4EBA\u7269",
  "\u53C2\u8003\u89D2\u8272",
  "\u6765\u6E90\u811A\u672C",
  "\u6765\u6E90\u955C\u53F7"
]);
var MODELED_SHOT_SECTIONS = /* @__PURE__ */ new Set([
  "\u753B\u9762\u63CF\u8FF0",
  "\u53F0\u8BCD",
  "\u63D0\u793A\u8BCD",
  "\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u9996\u5E27\u63D0\u793A\u8BCD",
  "\u9996\u5E27\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u5C3E\u5E27\u63D0\u793A\u8BCD",
  "\u5C3E\u5E27\u8D1F\u9762\u63D0\u793A\u8BCD",
  "\u89C6\u9891\u751F\u6210\u63D0\u793A\u8BCD",
  "\u4EBA\u7269\u9020\u578B\u8986\u76D6",
  "\u6765\u6E90\u5173\u8054"
]);
function rangesWithoutModeledShotContent(markdown) {
  const ranges = [];
  const title = /^#\s+.*(?:\r?\n|$)/m.exec(markdown);
  if (title?.index !== void 0) {
    ranges.push({ start: title.index, end: title.index + title[0].length });
  }
  for (const match of markdown.matchAll(/^\s*-\s+\*\*([^*]+?)[：:]\*\*.*(?:\r?\n|$)/gmu)) {
    const fieldName = match[1].trim();
    if (MODELED_SHOT_FIELDS.has(fieldName) && match.index !== void 0) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  const headings = [...markdown.matchAll(/^##\s+(.+?)\s*$/gmu)];
  headings.forEach((heading, index) => {
    if (!MODELED_SHOT_SECTIONS.has(heading[1].trim()) || heading.index === void 0) return;
    ranges.push({
      start: heading.index,
      end: headings[index + 1]?.index ?? markdown.length
    });
  });
  ranges.sort((left, right) => left.start - right.start);
  const merged = ranges.reduce((result, range) => {
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
function extractMarkedContent(markdown, startMarker, endMarker) {
  const content = [];
  const markerPattern = new RegExp(
    `${escapeRegExp(startMarker)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(endMarker)}`,
    "g"
  );
  const remainder = markdown.replace(markerPattern, (_match, captured) => {
    const trimmed = captured.trim();
    if (trimmed) content.push(trimmed);
    return "";
  });
  return { content: content.join("\n\n").trim(), remainder };
}
function extractPreservedShotContent(markdown) {
  const previous = extractMarkedContent(markdown, PRESERVED_SHOT_MARKER_START, PRESERVED_SHOT_MARKER_END);
  const preserved = previous.content ? [previous.content] : [];
  const withoutPreviousPreservedBlocks = previous.remainder;
  const unmodeled = rangesWithoutModeledShotContent(withoutPreviousPreservedBlocks);
  if (unmodeled) preserved.unshift(unmodeled);
  return preserved.join("\n\n").trim();
}
function readShotSource(markdown, fallbackShotId) {
  const fields = parseBoldFields(markdown);
  const sourcePath = readField(fields, "\u6765\u6E90\u811A\u672C");
  if (!sourcePath || getAssetKind(path.basename(sourcePath)) !== "markdown") return void 0;
  try {
    return {
      sourcePath: assertVisibleProjectPath(sourcePath),
      sourceShotId: normalizeShotId(readField(fields, "\u6765\u6E90\u955C\u53F7")) || fallbackShotId,
      rawDetail: extractMarkedContent(
        markdown,
        SOURCE_SHOT_DETAIL_MARKER_START,
        SOURCE_SHOT_DETAIL_MARKER_END
      ).content
    };
  } catch {
    return void 0;
  }
}
function normalizeShotSource(source, shotId) {
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
    rawDetail: validateLongText(source.rawDetail, "Source shot detail")
  };
}
function serializeShotCharacterOverrides(overrides) {
  const rows = overrides.length ? overrides.map((override) => [
    path.basename(override.characterPath),
    override.mode === "inherit" ? "\u7EE7\u627F\u573A\u6B21" : override.mode === "identity" ? "\u4F7F\u7528\u8EAB\u4EFD\u57FA\u51C6" : "\u8986\u76D6\u9020\u578B",
    override.mode === "look" && override.lookPath ? path.basename(override.lookPath) : "\u2014",
    override.state || "\u65E0"
  ]) : [["\u65E0", "\u7EE7\u627F\u573A\u6B21", "\u2014", "\u65E0"]];
  return [
    "## \u4EBA\u7269\u9020\u578B\u8986\u76D6",
    "",
    SHOT_CHARACTER_OVERRIDES_MARKER_START,
    JSON.stringify({ version: 1, overrides }, null, 2),
    SHOT_CHARACTER_OVERRIDES_MARKER_END,
    "",
    "| \u4EBA\u7269 | \u5904\u7406\u65B9\u5F0F | \u9020\u578B | \u5C40\u90E8\u72B6\u6001 |",
    "| --- | --- | --- | --- |",
    ...rows.map((cells) => `| ${cells.map(escapeMarkdownTableCell).join(" | ")} |`)
  ];
}
function serializeShotDesign(input, existingMarkdown, source) {
  const design = validateShotDesign(input);
  const modeledMarkdown = [
    `# ${design.shotId} ${design.title}`,
    "",
    `- **\u573A\u6B21\uFF1A** ${design.sceneId}`,
    `- **\u955C\u53F7\uFF1A** ${design.shotId}`,
    `- **\u65F6\u95F4\u7801\uFF1A** ${design.timecode}`,
    `- **\u65F6\u957F\uFF1A** ${design.duration}`,
    `- **\u666F\u522B\uFF0F\u673A\u4F4D\uFF1A** ${design.framing}`,
    `- **\u8FD0\u955C\uFF1A** ${design.camera}`,
    `- **\u72B6\u6001\uFF1A** ${design.status}`,
    `- **\u53C2\u8003\u4EBA\u7269\uFF1A** ${design.references}`,
    "",
    "## \u753B\u9762\u63CF\u8FF0",
    "",
    design.content,
    "",
    "## \u53F0\u8BCD",
    "",
    design.dialogue,
    "",
    "## \u63D0\u793A\u8BCD",
    "",
    design.prompt,
    "",
    "## \u8D1F\u9762\u63D0\u793A\u8BCD",
    "",
    design.negativePrompt,
    "",
    "## \u9996\u5E27\u63D0\u793A\u8BCD",
    "",
    design.firstFramePrompt,
    "",
    "## \u9996\u5E27\u8D1F\u9762\u63D0\u793A\u8BCD",
    "",
    design.firstFrameNegativePrompt,
    "",
    "## \u5C3E\u5E27\u63D0\u793A\u8BCD",
    "",
    design.lastFramePrompt,
    "",
    "## \u5C3E\u5E27\u8D1F\u9762\u63D0\u793A\u8BCD",
    "",
    design.lastFrameNegativePrompt,
    "",
    "## \u89C6\u9891\u751F\u6210\u63D0\u793A\u8BCD",
    "",
    design.videoPrompt,
    "",
    ...serializeShotCharacterOverrides(design.characterOverrides ?? []),
    ""
  ].join("\n");
  const existingSource = existingMarkdown ? readShotSource(existingMarkdown, design.shotId) : void 0;
  const normalizedSource = source ? normalizeShotSource(source, design.shotId) : existingSource;
  const withoutSourceDetail = existingMarkdown ? extractMarkedContent(existingMarkdown, SOURCE_SHOT_DETAIL_MARKER_START, SOURCE_SHOT_DETAIL_MARKER_END).remainder : "";
  const preserved = withoutSourceDetail ? extractPreservedShotContent(withoutSourceDetail) : "";
  const blocks = [modeledMarkdown];
  if (normalizedSource) {
    blocks.push([
      "## \u6765\u6E90\u5173\u8054",
      "",
      `- **\u6765\u6E90\u811A\u672C\uFF1A** ${normalizedSource.sourcePath}`,
      `- **\u6765\u6E90\u955C\u53F7\uFF1A** ${normalizedSource.sourceShotId}`,
      ...normalizedSource.rawDetail ? [
        "",
        SOURCE_SHOT_DETAIL_MARKER_START,
        "",
        normalizedSource.rawDetail,
        "",
        SOURCE_SHOT_DETAIL_MARKER_END
      ] : []
    ].join("\n"));
  }
  if (preserved) {
    blocks.push(`${PRESERVED_SHOT_MARKER_START}

${preserved}

${PRESERVED_SHOT_MARKER_END}`);
  }
  return `${blocks.join("\n\n").trimEnd()}
`;
}
function serializeSceneDocument(sceneId, source) {
  const safeSceneId = validateNewName(sceneId);
  const normalizedSource = source ? normalizeShotSource(source, source.sourceShotId) : void 0;
  return [
    `# ${safeSceneId} \u573A\u6B21`,
    "",
    "## \u573A\u6B21\u8BF4\u660E",
    "",
    ...normalizedSource ? [`- **\u6765\u6E90\u811A\u672C\uFF1A** ${normalizedSource.sourcePath}`] : [],
    "- **\u5236\u4F5C\u72B6\u6001\uFF1A** \u5F85\u51C6\u5907",
    "- **\u8BF4\u660E\uFF1A** \u5728\u8FD9\u91CC\u8865\u5145\u672C\u573A\u7684\u7A7A\u95F4\u5173\u7CFB\u3001\u7EDF\u4E00\u89C6\u89C9\u3001\u8FDE\u7EED\u6027\u548C\u4EA4\u4ED8\u8981\u6C42\u3002",
    "",
    "## \u63D0\u793A\u8BCD",
    "",
    "",
    "## \u8D1F\u9762\u63D0\u793A\u8BCD",
    "",
    ""
  ].join("\n");
}
function serializeSceneLocationPrompt(sceneId, shot) {
  const prompt = (shot.design.prompt || shot.design.content || "").trim();
  return [
    `# ${validateNewName(sceneId)}\u573A\u666F\u8BBE\u5B9A`,
    "",
    "## \u573A\u666F\u56FE\u63D0\u793A\u8BCD",
    "",
    prompt,
    ""
  ].join("\n");
}
function readPairedDocumentPrompt(kind, content) {
  if (kind === "character") return readCharacterTurnaroundPromptFields(content);
  if (kind === "look") return readCharacterLookPromptFields(content);
  if (kind === "location") return readPromptFields(
    content,
    ["\u573A\u666F\u56FE\u63D0\u793A\u8BCD", "\u63D0\u793A\u8BCD"],
    ["\u8D1F\u9762\u63D0\u793A\u8BCD", "\u573A\u666F\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD"],
    ["prompt", "visual_prompt", "\u573A\u666F\u56FE\u63D0\u793A\u8BCD", "\u63D0\u793A\u8BCD"],
    ["negative_prompt", "negativePrompt", "\u8D1F\u9762\u63D0\u793A\u8BCD", "\u573A\u666F\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD"]
  );
  if (kind === "prop") return readPromptFields(
    content,
    ["\u9053\u5177\u56FE\u63D0\u793A\u8BCD", "\u63D0\u793A\u8BCD"],
    ["\u8D1F\u9762\u63D0\u793A\u8BCD", "\u9053\u5177\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD"],
    ["prompt", "visual_prompt", "\u9053\u5177\u56FE\u63D0\u793A\u8BCD", "\u63D0\u793A\u8BCD"],
    ["negative_prompt", "negativePrompt", "\u8D1F\u9762\u63D0\u793A\u8BCD", "\u9053\u5177\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD"]
  );
  return readPromptFields(
    content,
    ["\u63D0\u793A\u8BCD"],
    ["\u8D1F\u9762\u63D0\u793A\u8BCD"],
    ["prompt"],
    ["negative_prompt", "negativePrompt"]
  );
}
function serializeDocumentSidecar(kind, content, promptFields = readPairedDocumentPrompt(kind, content)) {
  return `${JSON.stringify({
    version: DOCUMENT_SIDECAR_VERSION,
    type: kind,
    prompt: promptFields.prompt,
    negativePrompt: promptFields.negativePrompt,
    content
  }, null, 2)}
`;
}
async function writeDocumentPair(directory, markdownName, jsonName, kind, content) {
  const safeContent = content.endsWith("\n") ? content : `${content}
`;
  await writeTextAtomically(path.join(directory, markdownName), safeContent);
  await writeTextAtomically(
    path.join(directory, jsonName),
    serializeDocumentSidecar(kind, safeContent)
  );
}
async function readPairedDocument(index, directory, markdownName, jsonName, kind) {
  const entries = index.filesByDirectory.get(directory.absolutePath) ?? [];
  const markdown = entries.find((file) => file.name === markdownName);
  const json = entries.find((file) => file.name === jsonName);
  let content = markdown ? await readIndexedText(markdown) : "";
  if (json && (!markdown || json.stats.mtimeMs > markdown.stats.mtimeMs)) {
    try {
      const parsed = JSON.parse(await readIndexedText(json));
      if (parsed.type === kind && typeof parsed.content === "string") content = parsed.content;
    } catch {
    }
  }
  const promptFields = readPairedDocumentPrompt(kind, content);
  return { markdown, json, content, ...promptFields };
}
async function ensureMissingDocumentSidecars(index) {
  const pairs = index.files.flatMap((file) => {
    const segments = file.relativePath.split("/");
    const parentSegments = segments.slice(0, -1);
    const parent = parentSegments.join("/");
    let jsonName = "";
    let kind = "";
    if (file.name === "\u89D2\u8272\u8BBE\u5B9A.md" && parentSegments[0] === "\u4E3B\u8981\u4EBA\u7269" && parentSegments.length === 2) {
      jsonName = CHARACTER_PROFILE_JSON;
      kind = "character";
    } else if (file.name === CHARACTER_LOOK_DOCUMENT && parentSegments[0] === "\u4E3B\u8981\u4EBA\u7269" && parentSegments.length === 4 && parentSegments[2] === CHARACTER_LOOK_DIRECTORY) {
      jsonName = CHARACTER_LOOK_JSON;
      kind = "look";
    } else if (file.name === "\u573A\u666F\u8BBE\u5B9A.md" && parentSegments[0] === "\u573A\u666F" && parentSegments.length === 2) {
      jsonName = LOCATION_PROFILE_JSON;
      kind = "location";
    } else if (file.name === "\u9053\u5177\u8BBE\u5B9A.md" && parentSegments[0] === "\u9053\u5177" && parentSegments.length === 2) {
      jsonName = PROP_PROFILE_JSON;
      kind = "prop";
    } else if (file.name === "\u573A\u6B21.md" && parentSegments[0] === "\u5206\u955C" && parentSegments.length === 2) {
      jsonName = SCENE_DOCUMENT_JSON;
      kind = "scene";
    }
    return kind ? [{ file, parent, jsonName, kind }] : [];
  });
  let created = false;
  for (const pair of pairs) {
    const directory = path.dirname(pair.file.absolutePath);
    const jsonPath = path.join(directory, pair.jsonName);
    if ((index.filesByDirectory.get(directory) ?? []).some((file) => file.name === pair.jsonName)) continue;
    await withDirectoryLock(directory, async () => {
      try {
        await fs.lstat(jsonPath);
        return;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const content = await readIndexedText(pair.file);
      await writeTextAtomically(jsonPath, serializeDocumentSidecar(pair.kind, content));
      created = true;
    });
  }
  return created;
}
async function writeTextAtomically(target, content) {
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
    if (error.code !== "ENOENT") throw error;
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
async function readEditableShotMarkdown(target) {
  const entry = await fs.lstat(target);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new ProjectPathError("The asset document must be a regular file.");
  }
  if (entry.size > MAX_TEXT_ASSET_BYTES) {
    throw new ProjectPathError("Text assets must be smaller than 2 MB.");
  }
  return fs.readFile(target, "utf8");
}
async function readEditableShotJson(target) {
  const entry = await fs.lstat(target);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new ProjectPathError("design.json \u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\u3002");
  }
  if (entry.size > MAX_SHOT_DESIGN_JSON_BYTES) {
    throw new ProjectPathError("design.json \u8D85\u8FC7 1 MB\u3002");
  }
  const content = await fs.readFile(target, "utf8");
  return { content, ...parseShotDesignJson(content) };
}
async function readEditableTextOrEmpty(target) {
  try {
    return await readEditableShotMarkdown(target);
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
function normalizeSceneIdentity(sceneId) {
  return sceneId.trim().replaceAll("_", "-").toLocaleUpperCase("en-US");
}
function assertUnchangedShotIdentity(incoming, stored) {
  if (normalizeSceneIdentity(incoming.sceneId) !== normalizeSceneIdentity(stored.sceneId) || normalizeShotId(incoming.shotId) !== normalizeShotId(stored.shotId)) {
    throw new ProjectPathError("Scene and shot IDs are fixed after a shot asset is created.");
  }
}
function assertUnchangedShotTitle(incoming, stored) {
  if (incoming.title !== stored.title) {
    throw new ProjectPathError("Rename the shot asset to change its title and directory name together.");
  }
}
async function createAssetDirectory(parent, directoryName, slotDefinitions, initialize, options = {}) {
  const root = await getProjectRoot();
  const target = path.join(parent, directoryName);
  const temporary = path.join(parent, `.${directoryName}.${randomUUID()}.creating`);
  assertInsideRoot(root, target);
  assertInsideRoot(root, temporary);
  try {
    await fs.mkdir(temporary);
    for (const slot of slotDefinitions) {
      await fs.mkdir(path.join(temporary, slot.directory));
    }
    await initialize(temporary);
    await withDirectoryLock(parent, async () => {
      const siblings = await fs.readdir(parent, { withFileTypes: true });
      if (options.identityPrefix) {
        const duplicate = siblings.some(
          (entry) => entry.isDirectory() && (entry.name === options.identityPrefix || entry.name.startsWith(`${options.identityPrefix}-`))
        );
        if (duplicate) {
          throw new ProjectPathError(
            options.identityDuplicateMessage || "An asset with that stable ID already exists."
          );
        }
      }
      if (options.normalizedCharacterName) {
        const duplicate = siblings.some(
          (entry) => entry.isDirectory() && entry.name.toLocaleLowerCase("en-US") === options.normalizedCharacterName
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
        cleanupError
      });
    }
    throw error;
  }
  return target;
}
async function ensureSceneAssetDirectory(sceneId, source) {
  const safeSceneId = validateNewName(sceneId);
  const root = await getProjectRoot();
  await getVerifiedWorkbenchDirectory(root);
  const storyboardRoot = await ensureVerifiedInternalDirectory(root, root, "\u5206\u955C");
  const relativePath = path.posix.join("\u5206\u955C", safeSceneId);
  const candidate = path.join(storyboardRoot, safeSceneId);
  assertInsideRoot(root, candidate);
  try {
    const entry = await fs.lstat(candidate);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new ProjectPathError("The scene asset folder must be a regular directory.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const directory2 = await createAssetDirectory(
      storyboardRoot,
      safeSceneId,
      SCENE_SLOT_DEFINITIONS,
      async (temporary) => {
        await writeDocumentPair(
          temporary,
          "\u573A\u6B21.md",
          SCENE_DOCUMENT_JSON,
          "scene",
          serializeSceneDocument(safeSceneId, source)
        );
        await fs.writeFile(
          path.join(temporary, SCENE_CAST_DOCUMENT),
          serializeSceneCastDocument(safeSceneId, []),
          { flag: "wx" }
        );
        await fs.writeFile(
          path.join(temporary, SCENE_ASSET_BINDINGS_DOCUMENT),
          serializeSceneAssetBindingsDocument(safeSceneId, [], []),
          { flag: "wx" }
        );
      }
    );
    return { directory: directory2, created: true };
  }
  const directory = await resolveMutableExistingPath(relativePath);
  await withDirectoryLock(directory, async () => {
    for (const definition of SCENE_SLOT_DEFINITIONS) {
      await ensureVerifiedInternalDirectory(root, directory, definition.directory);
    }
    const sceneDocument = path.join(directory, "\u573A\u6B21.md");
    try {
      const entry = await fs.lstat(sceneDocument);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new ProjectPathError("The scene document must be a regular file.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeTextAtomically(sceneDocument, serializeSceneDocument(safeSceneId, source));
    }
    const sceneJson = path.join(directory, SCENE_DOCUMENT_JSON);
    try {
      const entry = await fs.lstat(sceneJson);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new ProjectPathError("The scene JSON document must be a regular file.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeTextAtomically(sceneJson, serializeDocumentSidecar("scene", await readEditableTextOrEmpty(sceneDocument)));
    }
    const castDocument = path.join(directory, SCENE_CAST_DOCUMENT);
    try {
      const entry = await fs.lstat(castDocument);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new ProjectPathError("The scene cast document must be a regular file.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeTextAtomically(castDocument, serializeSceneCastDocument(safeSceneId, []));
    }
    const assetBindingsDocument = path.join(directory, SCENE_ASSET_BINDINGS_DOCUMENT);
    try {
      const entry = await fs.lstat(assetBindingsDocument);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new ProjectPathError("The scene asset bindings document must be a regular file.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeTextAtomically(assetBindingsDocument, serializeSceneAssetBindingsDocument(safeSceneId, [], []));
    }
  });
  return { directory, created: false };
}
async function createSceneAsset(sceneId) {
  const { directory, created } = await ensureSceneAssetDirectory(sceneId);
  const root = await getProjectRoot();
  const relativePath = makeRelative(root, directory);
  await writeAudit({ action: created ? "create-scene" : "complete-scene", path: relativePath });
  return relativePath;
}
async function ensureSceneLocationAsset(sceneId) {
  const safeSceneId = validateNewName(sceneId);
  const locationPath = path.posix.join("\u573A\u666F", safeSceneId);
  let snapshot = await getAssetWorkspaceSnapshot();
  const existing = snapshot.locations.find((asset) => asset.rootPath === locationPath);
  if (existing) return { location: existing, created: false };
  let created = false;
  try {
    await createLocationAsset(safeSceneId);
    created = true;
  } catch (error) {
    snapshot = await getAssetWorkspaceSnapshot();
    const concurrent = snapshot.locations.find((asset) => asset.rootPath === locationPath);
    if (!concurrent) throw error;
    return { location: concurrent, created: false };
  }
  snapshot = await getAssetWorkspaceSnapshot();
  const location = snapshot.locations.find((asset) => asset.rootPath === locationPath);
  if (!location) throw new ProjectPathError("\u5730\u70B9/\u73AF\u5883\u8D44\u4EA7\u5DF2\u5EFA\u7ACB\uFF0C\u4F46\u65E0\u6CD5\u8BFB\u53D6\u5176\u8BBE\u5B9A\u3002");
  return { location, created };
}
async function ensureSceneLocationBinding(scenePath, locationPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await getAssetWorkspaceSnapshot();
    const scene = snapshot.scenes.find((asset) => asset.rootPath === scenePath);
    if (!scene) throw new ProjectPathError("\u5F53\u524D\u573A\u6B21\u8D44\u4EA7\u5DF2\u4E0D\u5B58\u5728\u3002");
    if (scene.locationBindings.some((binding) => binding.locationPath === locationPath)) return;
    try {
      await updateSceneAssetBindings(
        scene.rootPath,
        {
          locations: [
            ...scene.locationBindings,
            {
              locationPath,
              role: "\u4E3B\u73AF\u5883",
              state: "",
              continuity: "",
              startShotId: "",
              endShotId: ""
            }
          ],
          props: scene.propBindings
        },
        scene.assetBindingsRevision
      );
      return;
    } catch (error) {
      if (error instanceof ProjectConflictError && attempt === 0) continue;
      throw error;
    }
  }
}
async function prepareSceneImageFromShot(shotPath) {
  const verifiedShot = await getVerifiedWorkspaceAsset("shot", shotPath);
  const shot = verifiedShot.shot;
  if (!shot) throw new ProjectPathError("\u5F53\u524D\u955C\u5934\u8D44\u4EA7\u5DF2\u4E0D\u5B58\u5728\u3002");
  const prompt = (shot.design.prompt || shot.design.content || "").trim();
  if (!prompt) throw new ProjectPathError("\u8BF7\u5148\u4FDD\u5B58\u955C\u5934\u753B\u9762\u6216\u63D0\u793A\u8BCD\uFF0C\u518D\u751F\u6210\u573A\u666F\u56FE\u3002");
  const scenePath = await createSceneAsset(shot.design.sceneId);
  const { location, created } = await ensureSceneLocationAsset(shot.design.sceneId);
  if (created) {
    await updateLocationDocument(
      location.rootPath,
      serializeSceneLocationPrompt(shot.design.sceneId, shot),
      location.profileRevision
    );
  }
  await ensureSceneLocationBinding(scenePath, location.rootPath);
  return location.rootPath;
}
async function createSimpleDocumentAsset(name, parentName, documentName, slotDefinitions, type) {
  const safeName = validateNewName(name);
  const root = await getProjectRoot();
  await getVerifiedWorkbenchDirectory(root);
  const parent = await ensureVerifiedInternalDirectory(root, root, parentName);
  const target = await createAssetDirectory(
    parent,
    safeName,
    slotDefinitions,
    async (directory) => {
      const heading = type === "location" ? "\u573A\u666F\u8BBE\u5B9A" : "\u9053\u5177\u8BBE\u5B9A";
      await writeDocumentPair(
        directory,
        documentName,
        type === "location" ? LOCATION_PROFILE_JSON : PROP_PROFILE_JSON,
        type,
        `# ${safeName}${heading}

## \u57FA\u7840\u8BBE\u5B9A

- **\u7528\u9014\uFF1A** \u8BF7\u8865\u5145\u8BE5\u8D44\u4EA7\u5728\u6545\u4E8B\u4E2D\u7684\u7528\u9014\u3001\u5916\u89C2\u548C\u8FDE\u7EED\u6027\u8981\u6C42\u3002

## \u63D0\u793A\u8BCD



## \u8D1F\u9762\u63D0\u793A\u8BCD

`
      );
    }
  );
  const relativePath = makeRelative(root, target);
  await writeAudit({ action: `create-${type}`, path: relativePath });
  return relativePath;
}
async function createLocationAsset(name) {
  return createSimpleDocumentAsset(name, "\u573A\u666F", "\u573A\u666F\u8BBE\u5B9A.md", LOCATION_SLOT_DEFINITIONS, "location");
}
async function createPropAsset(name) {
  return createSimpleDocumentAsset(name, "\u9053\u5177", "\u9053\u5177\u8BBE\u5B9A.md", PROP_SLOT_DEFINITIONS, "prop");
}
async function createCharacterAsset(name) {
  const safeName = validateNewName(name);
  const existingSnapshot = await getAssetWorkspaceSnapshot();
  const normalizedName = safeName.toLocaleLowerCase("en-US");
  if (existingSnapshot.characters.some(
    (character) => character.name.toLocaleLowerCase("en-US") === normalizedName
  )) {
    throw new ProjectPathError("A character with that name already exists.");
  }
  const root = await getProjectRoot();
  await getVerifiedWorkbenchDirectory(root);
  const characterRoot = await ensureVerifiedInternalDirectory(root, root, "\u4E3B\u8981\u4EBA\u7269");
  const target = await createAssetDirectory(
    characterRoot,
    safeName,
    CHARACTER_SLOT_DEFINITIONS,
    async (directory) => {
      await writeDocumentPair(
        directory,
        "\u89D2\u8272\u8BBE\u5B9A.md",
        CHARACTER_PROFILE_JSON,
        "character",
        `# ${safeName}\u89D2\u8272\u8BBE\u5B9A

## \u89D2\u8272\u5B9A\u4F4D

- **\u89D2\u8272\u5206\u7C7B\uFF1A** \u5F85\u5206\u7C7B
- **\u8EAB\u4EFD\uFF1A** \u8BF7\u5728\u8FD9\u91CC\u8865\u5145\u4EBA\u7269\u8EAB\u4EFD\u3001\u5916\u5F62\u3001\u670D\u88C5\u4E0E\u8868\u6F14\u8BBE\u5B9A\u3002

## \u4E09\u89C6\u56FE\u63D0\u793A\u8BCD



## \u4E09\u89C6\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD

`
      );
    },
    { normalizedCharacterName: normalizedName }
  );
  const relativePath = makeRelative(root, target);
  await writeAudit({ action: "create-character", path: relativePath });
  return relativePath;
}
function nextCharacterLookId(looks) {
  const largest = looks.reduce((current, look) => {
    const match = look.id.match(/(?:^|-)LOOK-(\d{1,6})$/iu) ?? look.id.match(/LOOK-(\d{1,6})/iu);
    return match ? Math.max(current, Number.parseInt(match[1], 10)) : current;
  }, 0);
  return `LOOK-${String(largest + 1).padStart(3, "0")}`;
}
async function createCharacterLookAsset(characterPath, name) {
  const safeName = validateNewName(name);
  const characterAsset = await getVerifiedWorkspaceAsset("character", characterPath);
  if (!characterAsset.character) throw new ProjectPathError("The selected character asset no longer exists.");
  const duplicateName = characterAsset.character.looks.some(
    (look) => look.name.toLocaleLowerCase("en-US") === safeName.toLocaleLowerCase("en-US")
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
      await writeDocumentPair(
        directory,
        CHARACTER_LOOK_DOCUMENT,
        CHARACTER_LOOK_JSON,
        "look",
        [
          `# ${lookId} ${safeName}`,
          "",
          "## \u9020\u578B\u5B9A\u4F4D",
          "",
          `- **\u4EBA\u7269\uFF1A** ${characterAsset.character.name}`,
          `- **\u9020\u578B\u7F16\u53F7\uFF1A** ${lookId}`,
          `- **\u9020\u578B\u540D\u79F0\uFF1A** ${safeName}`,
          "- **\u9002\u7528\u5267\u60C5\uFF1A** \u8BF7\u586B\u5199\u9002\u7528\u573A\u6B21\u3001\u5267\u60C5\u9636\u6BB5\u6216\u89D2\u8272\u72B6\u6001\u3002",
          "",
          "## \u670D\u88C5\u4E0E\u8FDE\u7EED\u6027",
          "",
          "- **\u670D\u88C5\uFF1A** \u8BF7\u63CF\u8FF0\u670D\u88C5\u5C42\u6B21\u3001\u6750\u8D28\u3001\u989C\u8272\u4E0E\u56FA\u5B9A\u914D\u4EF6\u3002",
          "- **\u5986\u53D1\uFF1A** \u8BF7\u63CF\u8FF0\u53D1\u578B\u3001\u5986\u9762\u3001\u4F24\u75D5\u6216\u7279\u6B8A\u6807\u8BB0\u3002",
          "- **\u56FA\u5B9A\u9053\u5177\uFF1A** \u8BF7\u63CF\u8FF0\u5FC5\u987B\u4FDD\u6301\u4E00\u81F4\u7684\u9053\u5177\u3002",
          "- **\u8FDE\u7EED\u6027\uFF1A** \u8BF7\u63CF\u8FF0\u8DE8\u955C\u5934\u4E0D\u80FD\u53D8\u5316\u7684\u7EC6\u8282\u3002",
          "",
          "## \u4E09\u89C6\u56FE\u63D0\u793A\u8BCD",
          "",
          "",
          "## \u4E09\u89C6\u56FE\u8D1F\u9762\u63D0\u793A\u8BCD",
          "",
          ""
        ].join("\n")
      );
    },
    {
      // The LOOK prefix is a relation key used by scenes and shots, not only a directory decoration.
      identityPrefix: lookId,
      identityDuplicateMessage: "This character already has a costume look with that stable LOOK ID."
    }
  );
  const relativePath = makeRelative(root, target);
  await writeAudit({
    action: "create-character-look",
    characterPath: characterAsset.character.rootPath,
    path: relativePath,
    lookId
  });
  return relativePath;
}
async function createShotAsset(sceneId, shotId, title, draft, source) {
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
    videoPrompt: draft?.videoPrompt ?? "",
    characterOverrides: draft?.characterOverrides ?? [],
    status: draft?.status === "\u5F85\u521B\u5EFA\u955C\u5934\u8D44\u4EA7" ? "\u5F85\u751F\u6210" : draft?.status ?? "\u5F85\u751F\u6210"
  });
  const snapshot = await getAssetWorkspaceSnapshot();
  design.characterOverrides = validateResolvedShotCharacterOverrides(
    design.characterOverrides ?? [],
    snapshot,
    design.sceneId,
    design.shotId
  );
  const duplicate = snapshot.shots.some(
    (shot) => !shot.isDraft && getShotIdentityKey(shot.design) === getShotIdentityKey(design)
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
      const jsonPath = path.join(directory, "design.json");
      await writeShotDesignJson(jsonPath, design, source);
      const mdPath = path.join(directory, "\u955C\u5934.md");
      const markdown = serializeShotDesign(design, void 0, source);
      await fs.writeFile(mdPath, markdown, { flag: "wx" });
    },
    { identityPrefix: safeShotId }
  );
  const relativePath = makeRelative(root, target);
  await writeAudit({ action: "create-shot", path: relativePath, sceneCreated });
  return relativePath;
}
function isStoryboardMarkdown(file) {
  return getAssetKind(file.name) === "markdown" && file.name.includes("\u5206\u955C");
}
async function importStoryboardDrafts(sourcePath, selectedShotIds) {
  const visibleSourcePath = assertVisibleProjectPath(sourcePath);
  const root = await getProjectRoot();
  const index = await scanVisibleProject(root);
  const source = index.files.find((file) => file.relativePath === visibleSourcePath && isStoryboardMarkdown(file));
  if (!source) {
    throw new ProjectPathError("Choose a discovered storyboard script inside the active project.");
  }
  const parsedDrafts = parseStoryboardDrafts(source, await readIndexedText(source));
  const result = {
    sourcePath: visibleSourcePath,
    created: [],
    skipped: [],
    errors: [],
    warnings: []
  };
  const draftsByIdentity = /* @__PURE__ */ new Map();
  const draftsByShotId = /* @__PURE__ */ new Map();
  const duplicateSourceIdentities = /* @__PURE__ */ new Set();
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
    snapshot.shots.filter((shot) => !shot.isDraft).map((shot) => getShotIdentityKey(shot.design))
  );
  const requests = selectedShotIds === void 0 ? [...draftsByIdentity.values()].map((draft) => ({
    requestedId: getStoryboardDraftSelector(draft),
    identity: getShotIdentityKey(draft.asset.design),
    shotId: draft.asset.design.shotId
  })) : [...new Set(selectedShotIds.map((shotId) => shotId.trim()).filter(Boolean))].map(parseStoryboardDraftRequest).filter((request) => Boolean(request));
  for (const request of requests) {
    let draft;
    if (request.identity) {
      draft = draftsByIdentity.get(request.identity);
    } else if (request.shotId) {
      const matches = draftsByShotId.get(request.shotId) ?? [];
      if (matches.length > 1) {
        const choices = matches.map(getStoryboardDraftSelector).join("\u3001");
        result.errors.push({
          shotId: request.requestedId,
          error: `\u6765\u6E90\u811A\u672C\u4E2D\u201C${request.shotId}\u201D\u5B58\u5728\u4E8E\u591A\u4E2A\u573A\u6B21\uFF1B\u8BF7\u4F7F\u7528\u573A\u6B21\u9650\u5B9A\u7684\u955C\u5934\u7F16\u53F7\uFF0C\u4F8B\u5982\uFF1A${choices}\u3002`
        });
        continue;
      }
      draft = matches[0];
    }
    if (!draft) {
      result.errors.push({ shotId: request.requestedId || "\u672A\u547D\u540D\u955C\u5934", error: "\u6765\u6E90\u811A\u672C\u4E2D\u627E\u4E0D\u5230\u8FD9\u4E2A\u955C\u5934\u3002" });
      continue;
    }
    const identity = getShotIdentityKey(draft.asset.design);
    const resultShotId = (draftsByShotId.get(draft.asset.design.shotId)?.length ?? 0) > 1 ? getStoryboardDraftSelector(draft) : draft.asset.design.shotId;
    if (duplicateSourceIdentities.has(identity)) {
      result.skipped.push({ shotId: resultShotId, reason: "\u6765\u6E90\u811A\u672C\u4E2D\u540C\u573A\u6B21\u5B58\u5728\u91CD\u590D\u955C\u53F7\uFF0C\u9700\u5148\u5728\u5267\u672C\u4E2D\u6D88\u9664\u6B67\u4E49\u3002" });
      continue;
    }
    if (storedKeys.has(identity)) {
      result.skipped.push({ shotId: resultShotId, reason: "\u5F53\u524D\u9879\u76EE\u5DF2\u5EFA\u7ACB\u540C\u573A\u6B21\u3001\u540C\u955C\u53F7\u7684\u955C\u5934\u8D44\u4EA7\u3002" });
      continue;
    }
    result.warnings.push(...draft.warnings);
    try {
      const path2 = await createShotAsset(
        draft.asset.design.sceneId,
        draft.asset.design.shotId,
        draft.asset.design.title,
        draft.asset.design,
        draft.source
      );
      storedKeys.add(identity);
      result.created.push({ shotId: resultShotId, path: path2 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "\u65E0\u6CD5\u5EFA\u7ACB\u955C\u5934\u8D44\u4EA7\u3002";
      if (message.includes("already exists")) {
        result.skipped.push({ shotId: resultShotId, reason: "\u5F53\u524D\u9879\u76EE\u5DF2\u5EFA\u7ACB\u540C\u573A\u6B21\u3001\u540C\u955C\u53F7\u7684\u955C\u5934\u8D44\u4EA7\u3002" });
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
    errors: result.errors.map((entry) => entry.shotId)
  });
  return result;
}
async function updateCharacterProfile(assetPath, content, expectedRevision) {
  const asset = await getVerifiedWorkspaceAsset("character", assetPath);
  const safeContent = validateLongText(content, "Character profile");
  const absoluteRoot = await resolveMutableExistingPath(asset.rootPath);
  const target = path.join(absoluteRoot, "\u89D2\u8272\u8BBE\u5B9A.md");
  await withDirectoryLock(absoluteRoot, async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    const nextContent = safeContent.endsWith("\n") ? safeContent : `${safeContent}
`;
    await writeTextAtomically(target, nextContent);
    await writeTextAtomically(
      path.join(absoluteRoot, CHARACTER_PROFILE_JSON),
      serializeDocumentSidecar("character", nextContent)
    );
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({ action: "update-character-profile", path: relativePath });
  return relativePath;
}
async function updateCharacterLookDocument(characterPath, lookPath, content, expectedRevision) {
  const { character, look } = await getVerifiedCharacterLook(characterPath, lookPath);
  const safeContent = validateLongText(content, "Character look document");
  const absoluteRoot = await resolveMutableExistingPath(look.rootPath);
  const target = path.join(absoluteRoot, CHARACTER_LOOK_DOCUMENT);
  await withDirectoryLock(absoluteRoot, async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    const nextContent = safeContent.endsWith("\n") ? safeContent : `${safeContent}
`;
    await writeTextAtomically(target, nextContent);
    await writeTextAtomically(
      path.join(path.dirname(target), CHARACTER_LOOK_JSON),
      serializeDocumentSidecar("look", nextContent)
    );
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({
    action: "update-character-look-document",
    characterPath: character.rootPath,
    lookPath: look.rootPath,
    path: relativePath
  });
  return relativePath;
}
async function updateSceneDocument(assetPath, content, expectedRevision) {
  const asset = await getVerifiedWorkspaceAsset("scene", assetPath);
  if (!asset.scene?.scenePath) {
    throw new ProjectPathError("Complete this scene asset before editing its scene document.");
  }
  const safeContent = validateLongText(content, "Scene document");
  const target = await resolveMutableExistingPath(asset.scene.scenePath);
  await withDirectoryLock(path.dirname(target), async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    const nextContent = safeContent.endsWith("\n") ? safeContent : `${safeContent}
`;
    await writeTextAtomically(target, nextContent);
    await writeTextAtomically(
      path.join(path.dirname(target), SCENE_DOCUMENT_JSON),
      serializeDocumentSidecar("scene", nextContent)
    );
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({ action: "update-scene-document", path: relativePath });
  return relativePath;
}
async function updateSimpleDocument(assetType, assetPath, content, expectedRevision) {
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  const selected = assetType === "location" ? asset.location : asset.prop;
  const documentName = assetType === "location" ? "\u573A\u666F\u8BBE\u5B9A.md" : "\u9053\u5177\u8BBE\u5B9A.md";
  if (!selected) throw new ProjectPathError("\u6240\u9009\u8D44\u4EA7\u5DF2\u4E0D\u5B58\u5728\u3002");
  const safeContent = validateLongText(content, assetType === "location" ? "Location document" : "Prop document");
  const absoluteRoot = await resolveMutableExistingPath(selected.rootPath);
  const target = path.join(absoluteRoot, documentName);
  await withDirectoryLock(absoluteRoot, async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    const nextContent = safeContent.endsWith("\n") ? safeContent : `${safeContent}
`;
    await writeTextAtomically(target, nextContent);
    await writeTextAtomically(
      path.join(absoluteRoot, assetType === "location" ? LOCATION_PROFILE_JSON : PROP_PROFILE_JSON),
      serializeDocumentSidecar(assetType, nextContent)
    );
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({ action: `update-${assetType}-document`, path: relativePath });
  return relativePath;
}
async function updateLocationDocument(assetPath, content, expectedRevision) {
  return updateSimpleDocument("location", assetPath, content, expectedRevision);
}
async function updatePropDocument(assetPath, content, expectedRevision) {
  return updateSimpleDocument("prop", assetPath, content, expectedRevision);
}
async function updateSceneCastBindings(assetPath, bindings, expectedRevision) {
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
      serializeSceneCastDocument(asset.scene.sceneId, safeBindings, currentContent)
    );
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({
    action: "update-scene-cast-bindings",
    path: relativePath,
    bindings: safeBindings.map((binding) => ({
      characterPath: binding.characterPath,
      ...binding.lookPath ? { lookPath: binding.lookPath } : {},
      startShotId: binding.startShotId,
      endShotId: binding.endShotId
    }))
  });
  return relativePath;
}
async function updateSceneAssetBindings(assetPath, bindings, expectedRevision) {
  const asset = await getVerifiedWorkspaceAsset("scene", assetPath);
  if (!asset.scene) throw new ProjectPathError("\u6240\u9009\u573A\u6B21\u8D44\u4EA7\u5DF2\u4E0D\u5B58\u5728\u3002");
  const snapshot = await getAssetWorkspaceSnapshot();
  const safeBindings = validateSceneAssetBindings(bindings?.locations, bindings?.props, snapshot, asset.scene.sceneId);
  const target = path.join(await resolveMutableExistingPath(asset.scene.rootPath), SCENE_ASSET_BINDINGS_DOCUMENT);
  await withDirectoryLock(path.dirname(target), async () => {
    const currentContent = await readEditableTextOrEmpty(target);
    assertCurrentTextRevision(expectedRevision, currentContent);
    await writeTextAtomically(
      target,
      serializeSceneAssetBindingsDocument(asset.scene.sceneId, safeBindings.locations, safeBindings.props, currentContent)
    );
  });
  const relativePath = makeRelative(await getProjectRoot(), target);
  await writeAudit({
    action: "update-scene-asset-bindings",
    path: relativePath,
    locations: safeBindings.locations.map((binding) => binding.locationPath),
    props: safeBindings.props.map((binding) => binding.propPath)
  });
  return relativePath;
}
function getCharacterVisualSlotDefinition(slotKey) {
  const definition = CHARACTER_SLOT_DEFINITIONS.find((slot) => slot.key === slotKey);
  if (!definition) {
    throw new ProjectPathError("That visual material slot is not available for character selection.");
  }
  return definition;
}
async function setCharacterVisualSelection(assetPath, slotKey, fileName, lookPath) {
  if (!isCharacterVisualSlotKey(slotKey)) {
    throw new ProjectPathError("That visual material slot is not available for character selection.");
  }
  return setWorkspaceVisualSelection("character", assetPath, slotKey, fileName, lookPath);
}
async function setWorkspaceVisualSelection(assetType, assetPath, slotKey, fileName, lookPath) {
  const definition = getSlotDefinition(assetType, slotKey);
  if (assetType !== "character" && lookPath?.trim()) {
    throw new ProjectPathError("Only character assets may target a costume look.");
  }
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  if (assetType === "character" && !asset.character) {
    throw new ProjectPathError("The selected character asset no longer exists.");
  }
  const selectedLook = assetType === "character" && lookPath?.trim() && asset.character ? (await getVerifiedCharacterLook(asset.character.rootPath, lookPath)).look : void 0;
  const visualAssetRoot = selectedLook?.rootPath ?? asset.rootPath;
  const visualAssetSlots = selectedLook?.slots ?? asset.slots;
  const safeName = validateNewName(fileName);
  const candidate = visualAssetSlots.find((slot) => slot.key === slotKey)?.files.find((file) => file.name === safeName);
  if (!candidate || candidate.kind !== "image") {
    throw new ProjectPathError(`Choose an image from this asset's ${definition.label} candidates.`);
  }
  const root = await getProjectRoot();
  const assetRoot = await resolveMutableExistingPath(asset.rootPath);
  const visualDirectory = await resolveMutableExistingPath(
    path.posix.join(visualAssetRoot, definition.directory)
  );
  assertInsideRoot(assetRoot, visualDirectory);
  const finalPath = await withDirectoryLock(visualDirectory, async () => {
    const directoryEntry = await fs.lstat(visualDirectory);
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink()) {
      throw new ProjectPathError(`The ${definition.label} candidate folder is unavailable.`);
    }
    const source = path.join(
      /* turbopackIgnore: true */
      visualDirectory,
      safeName
    );
    assertInsideRoot(root, source);
    const sourceEntry = await fs.lstat(source);
    if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink() || getAssetKind(safeName) !== "image") {
      throw new ProjectPathError(`Choose a regular image from this character's ${definition.label} candidates.`);
    }
    const sourceIsSelected = isSelectedVisualFileName(safeName);
    const selectedName = sourceIsSelected ? safeName : makeSelectedVisualFileName(safeName);
    const target = path.join(visualDirectory, selectedName);
    assertInsideRoot(root, target);
    if (!sourceIsSelected) await assertTargetDoesNotExist(target);
    const selectedCandidates = await Promise.all((await fs.readdir(
      /* turbopackIgnore: true */
      visualDirectory,
      { withFileTypes: true }
    )).filter((entry) => !entry.name.startsWith(".") && entry.isFile() && !entry.isSymbolicLink() && isSelectedVisualFileName(entry.name) && entry.name !== safeName).map(async (entry) => {
      const selectedPath = path.join(
        /* turbopackIgnore: true */
        visualDirectory,
        entry.name
      );
      const selectedEntry = await fs.lstat(selectedPath);
      if (!selectedEntry.isFile() || selectedEntry.isSymbolicLink()) {
        throw new ProjectPathError(`The current selected ${definition.label} candidate is unavailable.`);
      }
      const restoredName = makeUnselectedVisualFileName(entry.name);
      const restoredPath = path.join(
        /* turbopackIgnore: true */
        visualDirectory,
        restoredName
      );
      assertInsideRoot(root, restoredPath);
      await assertTargetDoesNotExist(restoredPath);
      return {
        selectedName: entry.name,
        selectedPath,
        restoredName,
        restoredPath,
        temporaryPath: path.join(visualDirectory, `.${entry.name}.${randomUUID()}.tmp`)
      };
    }));
    const previousSelections = selectedCandidates;
    if (sourceIsSelected && !previousSelections.length) {
      return makeRelative(root, source);
    }
    let targetCreated = false;
    const movedSelections = [];
    const restoredSelections = [];
    try {
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
      const rollbackErrors = [];
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
          rollbackErrors
        });
        throw new ProjectPathError(
          `Unable to switch the ${definition.label} selection and fully restore its previous filenames. Refresh this asset before retrying.`
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
    ...selectedLook ? { lookPath: selectedLook.rootPath } : {},
    slot: slotKey,
    finalPath
  });
  return finalPath;
}
async function setCharacterTurnaround(assetPath, fileName) {
  return setCharacterVisualSelection(assetPath, "turnaround", fileName);
}
async function updateShotDesign(assetPath, design, expectedRevision) {
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
    shot.design.shotId
  );
  assertUnchangedShotIdentity(validatedDesign, shot.design);
  assertUnchangedShotTitle(validatedDesign, shot.design);
  await withDirectoryLock(path.dirname(target), async () => {
    const stored = await readEditableShotJson(target);
    assertCurrentTextRevision(expectedRevision, stored.content);
    const fullDesign = {
      ...validatedDesign,
      sceneId: shot.design.sceneId,
      shotId: shot.design.shotId
    };
    const mdPath = path.join(path.dirname(target), "\u955C\u5934.md");
    const existingMarkdown = await readEditableTextOrEmpty(mdPath);
    await writeShotDesignJson(target, fullDesign, stored.source);
    await writeTextAtomically(mdPath, serializeShotDesign(fullDesign, existingMarkdown, stored.source));
  });
  await writeAudit({ action: "update-shot-design", path: shot.designPath });
  return shot.designPath;
}
async function renameWorkspaceAsset(assetType, assetPath, name) {
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  if (assetType === "character") {
    const safeName = validateNewName(name);
    if (safeName === path.basename(asset.rootPath)) return asset.rootPath;
    const normalizedName = safeName.toLocaleLowerCase("en-US");
    const snapshot = await getAssetWorkspaceSnapshot();
    if (!asset.character) throw new ProjectPathError("The selected character asset no longer exists.");
    assertCharacterIsNotReferenced(snapshot, asset.character, "\u91CD\u547D\u540D");
    const duplicate2 = snapshot.characters.some(
      (character) => character.rootPath !== asset.rootPath && character.name.toLocaleLowerCase("en-US") === normalizedName
    );
    if (duplicate2) throw new ProjectPathError("A character with that name already exists.");
    return renameAsset(asset.rootPath, safeName);
  }
  if (assetType === "scene") {
    throw new ProjectPathError("\u573A\u6B21\u7F16\u53F7\u540C\u65F6\u662F\u5176\u4E0B\u955C\u5934\u7684\u7A33\u5B9A\u8EAB\u4EFD\uFF0C\u5F53\u524D\u4E0D\u652F\u6301\u91CD\u547D\u540D\u573A\u6B21\u8D44\u4EA7\u3002");
  }
  if (assetType === "location" || assetType === "prop") {
    const selected = assetType === "location" ? asset.location : asset.prop;
    if (!selected) throw new ProjectPathError("\u6240\u9009\u8D44\u4EA7\u5DF2\u4E0D\u5B58\u5728\u3002");
    const safeName = validateNewName(name);
    if (safeName === path.basename(selected.rootPath)) return selected.rootPath;
    const snapshot = await getAssetWorkspaceSnapshot();
    assertSimpleAssetIsNotReferenced(snapshot, selected, assetType, "\u91CD\u547D\u540D");
    const siblings = assetType === "location" ? snapshot.locations : snapshot.props;
    if (siblings.some(
      (candidate) => candidate.rootPath !== selected.rootPath && candidate.name.toLocaleLowerCase("en-US") === safeName.toLocaleLowerCase("en-US")
    )) {
      throw new ProjectPathError("\u540C\u7C7B\u578B\u8D44\u4EA7\u4E2D\u5DF2\u7ECF\u5B58\u5728\u540C\u540D\u9879\u76EE\u3002");
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
  const duplicate = (await getAssetWorkspaceSnapshot()).shots.some(
    (shot) => !shot.isDraft && shot.rootPath !== asset.rootPath && getShotIdentityKey(shot.design) === identity
  );
  if (duplicate) throw new ProjectPathError("A shot with that scene and shot ID already exists.");
  const root = await getProjectRoot();
  const source = await resolveMutableExistingPath(asset.rootPath);
  const parent = path.dirname(source);
  const target = await resolveWritablePath(path.join(path.dirname(asset.rootPath), directoryName));
  const destination = await withDirectoryLock(parent, async () => {
    const siblings = await fs.readdir(parent, { withFileTypes: true });
    const sameIdentityAlreadyExists = siblings.some(
      (entry) => entry.isDirectory() && entry.name !== path.basename(source) && (entry.name === asset.shot.design.shotId || entry.name.startsWith(`${asset.shot.design.shotId}-`))
    );
    if (sameIdentityAlreadyExists) {
      throw new ProjectPathError("A shot with that scene and shot ID already exists.");
    }
    await assertTargetDoesNotExist(target);
    const sourceJsonPath = path.join(source, "design.json");
    const stored = await readEditableShotJson(sourceJsonPath);
    const sourceMarkdownPath = path.join(source, "\u955C\u5934.md");
    const existingMarkdown = await readEditableTextOrEmpty(sourceMarkdownPath);
    const nextDesign = { ...stored.design, title };
    const nextJson = serializeShotDesignJson(nextDesign, stored.source);
    const nextMarkdown = serializeShotDesign(nextDesign, existingMarkdown, stored.source);
    if (Buffer.byteLength(nextMarkdown, "utf8") > MAX_TEXT_ASSET_BYTES) {
      throw new ProjectPathError("Text assets must be smaller than 2 MB.");
    }
    const temporaryId = randomUUID();
    const temporaryJsonName = `.design.json.${temporaryId}.rename`;
    const temporaryMarkdownName = `.\u955C\u5934.md.${temporaryId}.rename`;
    const temporaryJsonPath = path.join(source, temporaryJsonName);
    const temporaryMarkdownPath = path.join(source, temporaryMarkdownName);
    await Promise.all([
      fs.writeFile(temporaryJsonPath, nextJson, { flag: "wx" }),
      fs.writeFile(temporaryMarkdownPath, nextMarkdown, { flag: "wx" })
    ]);
    let directoryRenamed = false;
    try {
      await fs.rename(source, target);
      directoryRenamed = true;
      await fs.rename(path.join(target, temporaryMarkdownName), path.join(target, "\u955C\u5934.md"));
      await fs.rename(path.join(target, temporaryJsonName), path.join(target, "design.json"));
    } catch (error) {
      if (directoryRenamed) {
        try {
          await fs.rename(target, source);
          await writeTextAtomically(sourceMarkdownPath, existingMarkdown);
        } catch (rollbackError) {
          console.error("Unable to restore a shot directory after its title update failed.", {
            source,
            target,
            rollbackError
          });
        }
      }
      await Promise.all([temporaryJsonPath, temporaryMarkdownPath].map(
        (temporaryPath) => fs.rm(temporaryPath, { force: true }).catch((cleanupError) => {
          console.error("Unable to remove a staged shot title update.", { temporaryPath, cleanupError });
        })
      ));
      throw error;
    }
    return makeRelative(root, target);
  });
  await writeAudit({ action: "rename-shot-title", from: asset.rootPath, path: destination, title });
  return destination;
}
async function trashWorkspaceAsset(assetType, assetPath) {
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  if (assetType === "character" && asset.character) {
    assertCharacterIsNotReferenced(
      await getAssetWorkspaceSnapshot(),
      asset.character,
      "\u79FB\u5165\u56DE\u6536\u7AD9"
    );
  }
  if (assetType === "location" && asset.location || assetType === "prop" && asset.prop) {
    assertSimpleAssetIsNotReferenced(await getAssetWorkspaceSnapshot(), assetType === "location" ? asset.location : asset.prop, assetType, "\u79FB\u5165\u56DE\u6536\u7AD9");
  }
  return moveToTrash(asset.rootPath);
}
async function trashWorkspaceAssetFile(assetType, assetPath, slotKey, fileName, lookPath) {
  getSlotDefinition(assetType, slotKey);
  if (assetType !== "character" && lookPath?.trim()) {
    throw new ProjectPathError("Only character assets may target a costume look.");
  }
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  const selectedLook = assetType === "character" && lookPath?.trim() && asset.character ? (await getVerifiedCharacterLook(asset.character.rootPath, lookPath)).look : void 0;
  const slots = selectedLook?.slots ?? asset.slots;
  const safeName = validateNewName(fileName);
  const file = slots.find((slot) => slot.key === slotKey)?.files.find((candidate) => candidate.name === safeName);
  if (!file) throw new ProjectPathError("That file is not part of the selected asset slot.");
  if (file.kind === "image" && isSelectedVisualFileName(file.name)) {
    throw new ProjectPathError("Choose another image before removing the current selected visual reference.");
  }
  if (assetType === "character" && isCharacterVisualSlotKey(slotKey) && (selectedLook?.confirmedVisualSourcePaths[slotKey] ?? asset.character?.confirmedVisualSourcePaths[slotKey]) === file.path) {
    const label = getCharacterVisualSlotDefinition(slotKey).label;
    throw new ProjectPathError(`Choose another ${label} candidate before removing the current confirmed one.`);
  }
  return moveToTrash(file.path);
}
async function saveAssetUploadStream(assetType, assetPath, slotKey, fileName, source, lookPath) {
  const definition = getSlotDefinition(assetType, slotKey);
  if (assetType !== "character" && lookPath?.trim()) {
    throw new ProjectPathError("Only character assets may target a costume look.");
  }
  const asset = await getVerifiedWorkspaceAsset(assetType, assetPath);
  const selectedLook = assetType === "character" && lookPath?.trim() && asset.character ? (await getVerifiedCharacterLook(asset.character.rootPath, lookPath)).look : void 0;
  const safeName = normalizeUploadedCandidateFileName(validateNewName(fileName));
  const root = await getProjectRoot();
  const absoluteRoot = await resolveMutableExistingPath(selectedLook?.rootPath ?? asset.rootPath);
  const uploadDirectory = await getVerifiedUploadDirectory(root);
  const temporary = path.join(uploadDirectory, `${randomUUID()}.part`);
  assertInsideRoot(root, temporary);
  let handle;
  let totalBytes = 0;
  const probeChunks = [];
  let probeBytes = 0;
  try {
    handle = await fs.open(temporary, "wx", 384);
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
    handle = void 0;
    if (!totalBytes) throw new ProjectPathError("Upload a non-empty media file.");
    assertValidUploadMedia(assetType, slotKey, safeName, Buffer.concat(probeChunks, probeBytes));
    const slotDirectory = await ensureVerifiedInternalDirectory(root, absoluteRoot, definition.directory);
    const target = path.join(slotDirectory, safeName);
    assertInsideRoot(root, target);
    await withDirectoryLock(slotDirectory, async () => {
      await fs.link(temporary, target);
    });
    const relativePath = makeRelative(root, target);
    await writeAudit({
      action: "upload-asset-file",
      assetType,
      assetPath: asset.rootPath,
      ...selectedLook ? { lookPath: selectedLook.rootPath } : {},
      slot: slotKey,
      path: relativePath,
      bytes: totalBytes
    });
    return relativePath;
  } finally {
    if (handle) await handle.close().catch(() => void 0);
    await fs.rm(temporary, { force: true }).catch(() => void 0);
  }
}
async function createShotFolder(episodeId, shotId, title) {
  return createShotAsset(episodeId, shotId, title);
}
export {
  MAX_ASSET_UPLOAD_BYTES,
  ProjectConflictError,
  ProjectPathError,
  ProjectPayloadTooLargeError,
  buildCharacterCostumePrompt,
  buildCharacterTurnaroundPrompt,
  createCharacterAsset,
  createCharacterLookAsset,
  createFolder,
  createLocationAsset,
  createPropAsset,
  createSceneAsset,
  createShotAsset,
  createShotFolder,
  getAssetKind,
  getAssetWorkspaceSnapshot,
  getProjectRoot,
  getProjectSnapshot,
  getProjectStructureSnapshot,
  getTrashEntries,
  importStoryboardDrafts,
  moveToTrash,
  prepareSceneImageFromShot,
  readCharacterLookPromptFields,
  readCharacterTurnaroundPromptFields,
  readProjectIndex,
  readTextAsset,
  rebuildProjectIndex,
  renameAsset,
  renameWorkspaceAsset,
  resolveExistingPath,
  resolveWritablePath,
  restoreTrashEntry,
  saveAssetUploadStream,
  setCharacterTurnaround,
  setCharacterVisualSelection,
  setWorkspaceVisualSelection,
  trashWorkspaceAsset,
  trashWorkspaceAssetFile,
  updateCharacterLookDocument,
  updateCharacterProfile,
  updateLocationDocument,
  updateProjectSettings,
  updatePropDocument,
  updateSceneAssetBindings,
  updateSceneCastBindings,
  updateSceneDocument,
  updateShotDesign,
  withProjectRoot
};
