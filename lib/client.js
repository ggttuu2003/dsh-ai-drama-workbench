window.__ModuleLoader__.load({
  id: "dsh-ai-drama-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.jsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react2 = __toESM(require("react"), 1);
var import_react_dom = require("react-dom");

// src/original-workbench.tsx
var import_react = __toESM(require("react"), 1);

// src/comfy-ui-state.js
var ACTIVE_COMFY_JOB_STATUSES = /* @__PURE__ */ new Set([
  "queued",
  "uploading",
  "submitted",
  "running",
  "downloading",
  "archiving"
]);
function isArchivedComfyJob(job) {
  return job?.status === "completed" && Array.isArray(job.outputPaths) && job.outputPaths.length > 0;
}
function reconcileComfyJobWatches(currentWatches, assetPath, jobs) {
  const watches = new Map(currentWatches);
  let archivedCount = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job.id !== "string" || !job.id) continue;
    if (ACTIVE_COMFY_JOB_STATUSES.has(job.status)) {
      watches.set(job.id, assetPath);
      continue;
    }
    if (!watches.has(job.id)) continue;
    watches.delete(job.id);
    if (isArchivedComfyJob(job)) archivedCount += 1;
  }
  return { watches, archivedCount };
}
function watchedComfyAssetPaths(watches) {
  return [...new Set(watches.values())].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

// src/original-workbench.tsx
var AssetApiError = class extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
function normalizeSnapshot(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const arrayField = (key) => Array.isArray(source[key]) ? source[key] : [];
  return {
    ...source,
    rootName: typeof source.rootName === "string" ? source.rootName : "ai-play-test",
    projectSettings: source.projectSettings && typeof source.projectSettings === "object" ? source.projectSettings : { path: "\u9879\u76EE\u8BBE\u5B9A.md", content: "", revision: "" },
    characters: arrayField("characters"),
    locations: arrayField("locations"),
    props: arrayField("props"),
    scenes: arrayField("scenes"),
    shots: arrayField("shots"),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : (/* @__PURE__ */ new Date()).toISOString()
  };
}
var EMPTY_DESIGN = {
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
  status: "\u5F85\u751F\u6210"
};
var MAX_UPLOAD_FILES = 20;
var MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024;
var MAX_UPLOAD_TOTAL_BYTES = 500 * 1024 * 1024;
var WORKBENCH_API_BASE = "/ai-drama/workbench";
var SELECTED_VISUAL_SUFFIX = /(?:-|_)已选$/u;
var SELECTABLE_VISUAL_SLOTS = /* @__PURE__ */ new Set(["turnaround", "costume", "reference", "setting", "firstFrame", "lastFrame", "candidate"]);
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
function mediaUrl(file) {
  const query = new URLSearchParams({ path: file.path });
  if (file.projectId) query.set("projectId", file.projectId);
  return `${WORKBENCH_API_BASE}/asset?${query.toString()}`;
}
function isImage(file) {
  return file.kind === "image";
}
function isVideo(file) {
  return file.kind === "video";
}
function isSelectedVisual(file) {
  if (!isImage(file)) return false;
  const extensionIndex = file.name.lastIndexOf(".");
  const stem = extensionIndex > 0 ? file.name.slice(0, extensionIndex) : file.name;
  return SELECTED_VISUAL_SUFFIX.test(stem);
}
function selectedSlotVisualFiles(slot) {
  return slot.files.filter(isSelectedVisual).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
function selectedSlotVisual(slot) {
  return selectedSlotVisualFiles(slot)[0];
}
function isCharacterVisualSlotKey(slotKey) {
  return slotKey === "turnaround" || slotKey === "costume" || slotKey === "reference";
}
function firstMedia(asset) {
  if (asset.cover && (isImage(asset.cover) || isVideo(asset.cover))) return asset.cover;
  return asset.slots.flatMap((slot) => slot.files).find((file) => isImage(file) || isVideo(file));
}
function isSceneBindingValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value;
  return ["role", "state", "continuity", "startShotId", "endShotId"].every((key) => typeof record[key] === "string");
}
function sceneLocationBindings(scene) {
  return Array.isArray(scene.locationBindings) ? scene.locationBindings.filter((binding) => isSceneBindingValue(binding) && typeof binding.locationPath === "string").map((binding) => ({ ...binding })) : [];
}
function scenePropBindings(scene) {
  return Array.isArray(scene.propBindings) ? scene.propBindings.filter((binding) => isSceneBindingValue(binding) && typeof binding.propPath === "string").map((binding) => ({ ...binding })) : [];
}
function bindingReferencesAsset(binding, asset) {
  return asset.type === "location" ? "locationPath" in binding && binding.locationPath === asset.rootPath : "propPath" in binding && binding.propPath === asset.rootPath;
}
var CHARACTER_VISUAL_SLOT_LABELS = {
  turnaround: "\u4E09\u89C6\u56FE",
  costume: "\u5B9A\u5986",
  reference: "\u53C2\u8003\u56FE"
};
function characterVisualSources(asset) {
  return [
    {
      key: "identity",
      label: "\u8EAB\u4EFD\u57FA\u51C6",
      isIdentity: true,
      slots: asset.slots,
      confirmedVisuals: asset.confirmedVisuals,
      confirmedVisualSourcePaths: asset.confirmedVisualSourcePaths
    },
    ...asset.looks.map((look) => ({
      key: look.rootPath,
      label: `${look.id} \xB7 ${look.name}`,
      isIdentity: false,
      rootPath: look.rootPath,
      documentContent: look.documentContent,
      documentRevision: look.documentRevision,
      slots: look.slots,
      confirmedVisuals: look.confirmedVisuals,
      confirmedVisualSourcePaths: look.confirmedVisualSourcePaths
    }))
  ];
}
function selectedCharacterVisuals(source) {
  const visuals = [];
  for (const slot of ["turnaround", "costume", "reference"]) {
    const file = source.confirmedVisuals[slot];
    if (!file || !isImage(file)) continue;
    visuals.push({ slot, label: CHARACTER_VISUAL_SLOT_LABELS[slot], file });
  }
  return visuals;
}
function getLookForPath(character, lookPath) {
  return lookPath ? character?.looks.find((look) => look.rootPath === lookPath) : void 0;
}
function displayLookLabel(character, lookPath) {
  const look = getLookForPath(character, lookPath);
  return look ? `${look.id} \xB7 ${look.name}` : "\u8EAB\u4EFD\u57FA\u51C6";
}
function shotNumericValue(shotId) {
  const match = shotId.match(/^(?:SH)?(\d{1,6})$/iu);
  return match ? Number.parseInt(match[1], 10) : void 0;
}
function bindingAppliesToShot(binding, shotId) {
  const current = shotNumericValue(shotId);
  if (current === void 0) return !binding.startShotId && !binding.endShotId;
  const start = binding.startShotId ? shotNumericValue(binding.startShotId) : void 0;
  const end = binding.endShotId ? shotNumericValue(binding.endShotId) : void 0;
  return (start === void 0 || current >= start) && (end === void 0 || current <= end);
}
function formatBindingRange(binding) {
  if (!binding.startShotId && !binding.endShotId) return "\u5168\u573A";
  return `${binding.startShotId || "\u9996\u955C"} - ${binding.endShotId || "\u5C3E\u955C"}`;
}
function assetKey(asset) {
  if (asset.type === "character") return `character:${asset.rootPath}`;
  if (asset.type === "location") return `location:${asset.rootPath}`;
  if (asset.type === "prop") return `prop:${asset.rootPath}`;
  if (asset.type === "scene") return `scene:${asset.rootPath}`;
  return `shot:${asset.rootPath || `${asset.design.sceneId}:${asset.design.shotId}`}`;
}
function displayShotTitle(shot) {
  return shot.design.title || "\u672A\u547D\u540D\u955C\u5934";
}
function storyboardImportSelector(shot) {
  return `${shot.design.sceneId}/${shot.design.shotId}`;
}
function displayWorkspaceAssetTitle(asset) {
  if (asset.type === "character") return asset.name;
  if (asset.type === "location" || asset.type === "prop") return asset.name;
  if (asset.type === "scene") return `${asset.sceneId} \xB7 \u573A\u6B21\u8D44\u6599`;
  return `${asset.design.shotId} \xB7 ${displayShotTitle(asset)}`;
}
function displayFileName(relativePath) {
  return relativePath.split(/[\\/]/).filter(Boolean).pop() || relativePath;
}
function displaySelectedVisualName(fileName) {
  const extensionIndex = fileName.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
  return `${baseName.replace(/-已选$/u, "")}${extension}`;
}
function characterInitial(name) {
  return Array.from(name.trim())[0] || "\u4EBA";
}
function assetMatchesSearch(asset, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  const searchableText = asset.type === "character" ? `${asset.name} ${asset.roleCategory} ${asset.profileContent || ""}` : asset.type === "scene" ? `${asset.sceneId} ${asset.sceneContent || ""}` : asset.type === "location" || asset.type === "prop" ? `${asset.name} ${asset.profileContent || ""}` : `${asset.design.shotId} ${asset.design.title} ${asset.design.content} ${asset.design.sceneId}`;
  return searchableText.toLocaleLowerCase().includes(normalizedQuery);
}
function suggestNextShotId(shots) {
  const largestNumber = shots.reduce((largest, shot) => {
    const match = shot.design.shotId.match(/^(?:SH)?(\d+)$/i);
    return match ? Math.max(largest, Number.parseInt(match[1], 10)) : largest;
  }, 0);
  return `SH${String(largestNumber + 1).padStart(3, "0")}`;
}
function previewFile(file, label) {
  if (!file) {
    return /* @__PURE__ */ import_react.default.createElement("span", { className: "asset-placeholder-mark", "aria-hidden": "true" }, "\uFF0B");
  }
  if (isImage(file)) {
    return /* @__PURE__ */ import_react.default.createElement("img", { className: "asset-thumb", src: mediaUrl(file), alt: label, loading: "lazy" });
  }
  if (isVideo(file)) {
    return /* @__PURE__ */ import_react.default.createElement("video", { className: "asset-thumb", src: mediaUrl(file), muted: true, preload: "metadata", "aria-label": label });
  }
  return /* @__PURE__ */ import_react.default.createElement("span", { className: "asset-file-mark" }, file.kind === "markdown" ? "\u6587\u6863" : "\u6587\u4EF6");
}
function PrimaryMedia({
  file,
  label,
  onPreview
}) {
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "asset-primary-media", "aria-label": `${label}\u4E3B\u9884\u89C8` }, /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-primary-visual" }, isImage(file) ? /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      "aria-label": `\u653E\u5927\u67E5\u770B${file.name}`,
      className: "asset-primary-image-button",
      onClick: onPreview,
      type: "button"
    },
    /* @__PURE__ */ import_react.default.createElement("img", { src: mediaUrl(file), alt: `${label} \xB7 ${file.name}` })
  ) : /* @__PURE__ */ import_react.default.createElement("video", { className: "asset-primary-video", controls: true, playsInline: true, preload: "metadata", src: mediaUrl(file) }, "\u5F53\u524D\u6D4F\u89C8\u5668\u65E0\u6CD5\u64AD\u653E\u6B64\u89C6\u9891\u3002")), /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-primary-meta" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u4E3B\u9884\u89C8"), /* @__PURE__ */ import_react.default.createElement("strong", { title: file.name }, file.name), /* @__PURE__ */ import_react.default.createElement("small", null, formatSize(file.size))), /* @__PURE__ */ import_react.default.createElement("button", { className: "asset-primary-open", onClick: onPreview, type: "button" }, isImage(file) ? "\u67E5\u770B\u5927\u56FE" : "\u5168\u5C4F\u64AD\u653E")));
}
function CharacterVisualBoard({
  characterName,
  sourceLabel,
  visuals,
  onPreview
}) {
  const primary = visuals.find((visual) => visual.slot === "turnaround") ?? visuals[0];
  const supportingVisuals = visuals.filter((visual) => visual.file.path !== primary.file.path);
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "character-visual-board", "aria-label": `${characterName}${sourceLabel}\u5DF2\u9009\u89C6\u89C9\u8D44\u6599` }, /* @__PURE__ */ import_react.default.createElement("div", { className: "character-visual-main" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "character-visual-board-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, sourceLabel), /* @__PURE__ */ import_react.default.createElement("strong", null, primary.label)), /* @__PURE__ */ import_react.default.createElement("span", null, "\u5DF2\u9009")), /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      "aria-label": `\u653E\u5927\u67E5\u770B\u5DF2\u9009${primary.label}${primary.file.name}`,
      className: "character-visual-main-button",
      onClick: () => onPreview(primary.file),
      type: "button"
    },
    /* @__PURE__ */ import_react.default.createElement("img", { alt: `${characterName} \xB7 ${sourceLabel} \xB7 \u5DF2\u9009${primary.label}`, src: mediaUrl(primary.file) })
  ), /* @__PURE__ */ import_react.default.createElement("p", { className: "character-visual-file-name", title: primary.file.name }, displaySelectedVisualName(primary.file.name))), supportingVisuals.length ? /* @__PURE__ */ import_react.default.createElement("div", { className: "character-visual-supporting", "aria-label": "\u5DF2\u9009\u8F85\u52A9\u89C6\u89C9" }, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u5DF2\u9009\u5B9A\u5986\u4E0E\u53C2\u8003"), /* @__PURE__ */ import_react.default.createElement("div", { className: "character-visual-supporting-grid" }, supportingVisuals.map((visual) => /* @__PURE__ */ import_react.default.createElement("article", { className: "character-visual-supporting-card", key: visual.slot }, /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      "aria-label": `\u653E\u5927\u67E5\u770B\u5DF2\u9009${visual.label}${visual.file.name}`,
      className: "character-visual-supporting-button",
      onClick: () => onPreview(visual.file),
      type: "button"
    },
    /* @__PURE__ */ import_react.default.createElement("img", { alt: `${characterName} \xB7 ${sourceLabel} \xB7 \u5DF2\u9009${visual.label}`, src: mediaUrl(visual.file) })
  ), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", null, visual.label), /* @__PURE__ */ import_react.default.createElement("small", { title: visual.file.name }, displaySelectedVisualName(visual.file.name))))))) : null);
}
function MediaLightbox({ file, onClose }) {
  return /* @__PURE__ */ import_react.default.createElement(
    "div",
    {
      className: "media-lightbox-backdrop",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose();
      }
    },
    /* @__PURE__ */ import_react.default.createElement(
      "section",
      {
        "aria-labelledby": "media-lightbox-title",
        "aria-modal": "true",
        className: "media-lightbox",
        role: "dialog"
      },
      /* @__PURE__ */ import_react.default.createElement("header", { className: "media-lightbox-head" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", { id: "media-lightbox-title", title: file.name }, file.name), /* @__PURE__ */ import_react.default.createElement("small", null, formatSize(file.size))), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u5173\u95ED\u5A92\u4F53\u9884\u89C8", autoFocus: true, className: "media-lightbox-close", onClick: onClose, type: "button" }, "\xD7")),
      /* @__PURE__ */ import_react.default.createElement("div", { className: "media-lightbox-stage" }, isImage(file) ? /* @__PURE__ */ import_react.default.createElement("img", { className: "media-lightbox-image", src: mediaUrl(file), alt: file.name }) : /* @__PURE__ */ import_react.default.createElement("video", { autoPlay: true, className: "media-lightbox-video", controls: true, playsInline: true, src: mediaUrl(file) }, "\u5F53\u524D\u6D4F\u89C8\u5668\u65E0\u6CD5\u64AD\u653E\u6B64\u89C6\u9891\u3002"))
    )
  );
}
function AssetCard({
  asset,
  active,
  sceneReferenceCount,
  onClick
}) {
  if (asset.type === "shot") {
    return /* @__PURE__ */ import_react.default.createElement("button", { "aria-current": active ? "true" : void 0, className: `asset-card shot-list-item ${active ? "is-active" : ""}`, onClick, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "shot-list-id" }, asset.design.shotId || "\u672A\u7F16\u53F7"), /* @__PURE__ */ import_react.default.createElement("span", { className: "shot-list-copy" }, /* @__PURE__ */ import_react.default.createElement("strong", null, displayShotTitle(asset)), /* @__PURE__ */ import_react.default.createElement("small", null, asset.design.duration || "\u672A\u8BBE\u65F6\u957F")), asset.isDraft ? /* @__PURE__ */ import_react.default.createElement("span", { className: "shot-list-state" }, "\u5F85\u5BFC\u5165") : null);
  }
  const media = firstMedia(asset);
  const simpleAsset = asset.type === "location" || asset.type === "prop";
  return /* @__PURE__ */ import_react.default.createElement("button", { "aria-current": active ? "true" : void 0, className: `asset-card character-list-item ${simpleAsset ? "simple-asset-list-item" : ""} ${active ? "is-active" : ""}`, onClick, type: "button" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-card-cover" }, media ? previewFile(media, asset.name) : /* @__PURE__ */ import_react.default.createElement("span", { className: "character-avatar-letter", "aria-hidden": "true" }, characterInitial(asset.name))), /* @__PURE__ */ import_react.default.createElement("span", { className: "asset-card-copy" }, /* @__PURE__ */ import_react.default.createElement("strong", null, asset.name), /* @__PURE__ */ import_react.default.createElement("small", { className: "character-role-label" }, asset.type === "character" ? asset.roleCategory : asset.type === "location" ? "\u5730\u70B9/\u73AF\u5883\u8D44\u4EA7" : "\u9053\u5177\u8D44\u4EA7"), asset.type === "location" || asset.type === "prop" ? /* @__PURE__ */ import_react.default.createElement("small", { className: "asset-reference-count" }, sceneReferenceCount ? `\u88AB ${sceneReferenceCount} \u4E2A\u573A\u6B21\u5F15\u7528` : "\u5C1A\u672A\u88AB\u573A\u6B21\u5F15\u7528") : null));
}
function SceneAssetCard({
  scene,
  active,
  onClick
}) {
  return /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      "aria-current": active ? "true" : void 0,
      className: `scene-asset-card ${active ? "is-active" : ""}`,
      onClick,
      type: "button"
    },
    /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: "scene-asset-card-mark" }, "\u573A"),
    /* @__PURE__ */ import_react.default.createElement("span", { className: "scene-asset-card-copy" }, /* @__PURE__ */ import_react.default.createElement("small", null, "\u573A\u6B21\u8D44\u4EA7"), /* @__PURE__ */ import_react.default.createElement("strong", null, scene.sceneId), /* @__PURE__ */ import_react.default.createElement("em", null, scene.shotCount, " \u4E2A\u955C\u5934 \xB7 ", scene.isComplete ? "\u573A\u6B21\u8D44\u6599\u5DF2\u5C31\u7EEA" : "\u5F85\u8865\u9F50\u573A\u6B21\u8D44\u6599"))
  );
}
function SlotPanel({
  slot,
  disabled,
  confirmedFile,
  confirmedSourcePath,
  onUpload,
  onTrash,
  onPreview,
  onSetConfirmed
}) {
  const inputRef = (0, import_react.useRef)(null);
  const canConfirmSelection = Boolean(onSetConfirmed);
  const visualFiles = slot.files.filter((file) => isImage(file) || isVideo(file));
  const selectionCandidates = visualFiles.filter(isImage);
  const markedSelectedFiles = selectionCandidates.filter(isSelectedVisual);
  const hasSelectionConflict = canConfirmSelection && markedSelectedFiles.length > 1;
  const effectiveConfirmedFile = hasSelectionConflict ? void 0 : confirmedFile ?? markedSelectedFiles[0];
  const effectiveConfirmedSourcePath = effectiveConfirmedFile?.path;
  const candidateCountLabel = `${selectionCandidates.length} \u5F20\u5019\u9009`;
  const confirmedName = effectiveConfirmedFile?.name;
  const uploadLabel = canConfirmSelection ? visualFiles.length ? "\u7EE7\u7EED\u6DFB\u52A0\u5019\u9009" : `\u6DFB\u52A0${slot.label}\u5019\u9009` : `\u6DFB\u52A0${slot.label}`;
  return /* @__PURE__ */ import_react.default.createElement("article", { className: `asset-slot ${disabled ? "is-disabled" : ""}` }, /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-slot-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, canConfirmSelection ? "\u5019\u9009\u6C60 \xB7 \u591A\u5F20\u53EF\u9009" : "\u8D44\u6599\u69FD"), /* @__PURE__ */ import_react.default.createElement("h3", null, slot.label)), /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-slot-heading-actions" }, hasSelectionConflict ? /* @__PURE__ */ import_react.default.createElement("span", { className: "asset-slot-confirmed is-conflict", title: "\u540C\u4E00\u8D44\u6599\u69FD\u4E2D\u4E0D\u5E94\u6709\u591A\u5F20\u5E26 -\u5DF2\u9009 \u7684\u56FE\u7247" }, "\u9700\u6574\u7406") : null, effectiveConfirmedFile ? /* @__PURE__ */ import_react.default.createElement("span", { className: "asset-slot-confirmed", title: `\u5F53\u524D\u9009\u62E9\uFF1A${effectiveConfirmedFile.name}` }, "\u5DF2\u9009") : null, /* @__PURE__ */ import_react.default.createElement("span", { className: `asset-slot-count ${canConfirmSelection ? "asset-slot-candidate-count" : ""}`, title: canConfirmSelection ? candidateCountLabel : `${visualFiles.length} \u4E2A\u8D44\u6599` }, canConfirmSelection ? candidateCountLabel : visualFiles.length))), /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-slot-body" }, canConfirmSelection ? /* @__PURE__ */ import_react.default.createElement("div", { className: `turnaround-selection-summary ${effectiveConfirmedFile ? "has-confirmed" : ""} ${hasSelectionConflict ? "has-conflict" : ""}` }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", null, hasSelectionConflict ? "\u68C0\u6D4B\u5230\u591A\u4E2A\u5DF2\u9009\u56FE" : effectiveConfirmedFile ? "\u5F53\u524D\u9009\u62E9" : "\u5C1A\u672A\u9009\u62E9\u53C2\u8003\u56FE"), /* @__PURE__ */ import_react.default.createElement("span", { title: hasSelectionConflict ? markedSelectedFiles.map((file) => file.name).join("\u3001") : confirmedName }, hasSelectionConflict ? `${markedSelectedFiles.length} \u5F20\u5019\u9009\u88AB\u540C\u65F6\u6807\u4E3A\u5DF2\u9009` : confirmedName || "\u4ECE\u4E0B\u65B9\u5019\u9009\u4E2D\u4EFB\u9009\u4E00\u5F20")), /* @__PURE__ */ import_react.default.createElement("small", null, hasSelectionConflict ? "\u70B9\u51FB\u4EFB\u610F\u4E00\u5F20\u201C\u7EDF\u4E00\u9009\u6B64\u56FE\u201D\u5373\u53EF\u81EA\u52A8\u6062\u590D\u5176\u4F59\u5019\u9009\u540D\u3002" : visualFiles.length ? "\u5176\u4F59\u5019\u9009\u4F1A\u4FDD\u7559\uFF0C\u53EF\u968F\u65F6\u91CD\u65B0\u9009\u62E9\u3002" : "\u53EF\u4E00\u6B21\u6216\u5206\u6279\u6DFB\u52A0\u591A\u5F20\u5019\u9009\u56FE\u3002")) : null, visualFiles.length ? /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-file-grid" }, visualFiles.map((file) => {
    const isConfirmed = effectiveConfirmedSourcePath === file.path;
    const isMarkedSelected = isSelectedVisual(file);
    return /* @__PURE__ */ import_react.default.createElement("div", { className: `asset-file-card ${isConfirmed ? "is-confirmed" : ""} ${hasSelectionConflict && isMarkedSelected ? "has-selection-conflict" : ""}`, key: file.path }, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        "aria-label": `\u9884\u89C8${file.name}`,
        className: "asset-file-preview asset-file-preview-button",
        onClick: () => onPreview(file),
        type: "button"
      },
      previewFile(file, file.name)
    ), /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-file-meta" }, /* @__PURE__ */ import_react.default.createElement("strong", { title: file.name }, file.name), /* @__PURE__ */ import_react.default.createElement("small", null, formatSize(file.size))), canConfirmSelection && isImage(file) ? /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        "aria-label": hasSelectionConflict ? `\u5C06 ${file.name} \u4F5C\u4E3A\u552F\u4E00${slot.label}\u53C2\u8003\uFF0C\u5E76\u6062\u590D\u540C\u69FD\u5176\u4ED6\u5DF2\u9009\u5019\u9009` : isConfirmed ? `${file.name} \u662F\u5F53\u524D\u9009\u62E9` : `\u5C06 ${file.name} \u8BBE\u4E3A\u5F53\u524D${slot.label}\u53C2\u8003`,
        className: `asset-file-confirm ${isConfirmed ? "is-confirmed" : ""}`,
        disabled: disabled || isConfirmed,
        onClick: () => onSetConfirmed?.(file),
        type: "button"
      },
      hasSelectionConflict ? "\u7EDF\u4E00\u9009\u6B64\u56FE" : isConfirmed ? "\u5F53\u524D\u9009\u62E9" : "\u8BBE\u4E3A\u53C2\u8003"
    ) : null, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        "aria-label": isConfirmed || isMarkedSelected ? `${file.name} \u5E26\u6709\u5DF2\u9009\u6807\u8BB0\uFF0C\u8BF7\u5148\u9009\u62E9\u53E6\u4E00\u5F20\u5019\u9009\u56FE\u6216\u7EDF\u4E00\u8D44\u6599\u69FD\u72B6\u6001` : `\u5C06 ${file.name} \u79FB\u5165\u56DE\u6536\u7AD9`,
        className: "asset-file-remove",
        disabled: disabled || isConfirmed || isMarkedSelected,
        onClick: () => onTrash(file),
        type: "button"
      },
      "\xD7"
    ));
  })) : /* @__PURE__ */ import_react.default.createElement("div", { className: "slot-empty" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "slot-empty-icon", "aria-hidden": "true" }, "\uFF0B"), /* @__PURE__ */ import_react.default.createElement("span", null, "\u5C1A\u65E0\u8D44\u6599"), /* @__PURE__ */ import_react.default.createElement("small", null, canConfirmSelection ? `${slot.label}\u6587\u4EF6\u5939\u4E2D\u8FD8\u6CA1\u6709\u5019\u9009\u56FE\u7247` : `${slot.label}\u6587\u4EF6\u5939\u4E2D\u8FD8\u6CA1\u6709\u56FE\u7247\u6216\u89C6\u9891`))), /* @__PURE__ */ import_react.default.createElement(
    "input",
    {
      accept: canConfirmSelection ? "image/*" : "image/*,video/*",
      "aria-label": canConfirmSelection ? `\u9009\u62E9${slot.label}\u5019\u9009\u6587\u4EF6` : `\u9009\u62E9${slot.label}\u6587\u4EF6`,
      className: "visually-hidden",
      disabled,
      multiple: true,
      onChange: (event) => {
        onUpload(event.target.files);
        event.currentTarget.value = "";
      },
      ref: inputRef,
      type: "file"
    }
  ), /* @__PURE__ */ import_react.default.createElement("button", { className: "slot-upload-button", disabled, onClick: () => inputRef.current?.click(), type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\u2191"), disabled ? "\u521B\u5EFA\u8D44\u4EA7\u540E\u53EF\u4E0A\u4F20" : uploadLabel));
}
function TextField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  disabled = false
}) {
  return /* @__PURE__ */ import_react.default.createElement("label", { className: `asset-field ${multiline ? "is-multiline" : ""}` }, /* @__PURE__ */ import_react.default.createElement("span", null, label), multiline ? /* @__PURE__ */ import_react.default.createElement("textarea", { disabled, onChange: (event) => onChange(event.target.value), placeholder, value }) : /* @__PURE__ */ import_react.default.createElement("input", { disabled, onChange: (event) => onChange(event.target.value), placeholder, value }));
}
function SelectField({
  ariaLabel,
  className = "",
  disabled = false,
  label,
  onChange,
  options,
  value
}) {
  const [open, setOpen] = (0, import_react.useState)(false);
  const [highlightedIndex, setHighlightedIndex] = (0, import_react.useState)(0);
  const rootRef = (0, import_react.useRef)(null);
  const triggerRef = (0, import_react.useRef)(null);
  const optionRefs = (0, import_react.useRef)([]);
  const menuId = (0, import_react.useId)();
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const nextIndex = Math.min(highlightedIndex, Math.max(options.length - 1, 0));
    optionRefs.current[nextIndex]?.focus();
  }, [highlightedIndex, open, options.length]);
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const handlePointerDown = (event) => {
      if (!rootRef.current || !event.composedPath().includes(rootRef.current)) setOpen(false);
    };
    const handleKeyDown = (event) => {
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
  const chooseOption = (nextValue) => {
    onChange(nextValue);
    const nextIndex = options.findIndex((option) => option.value === nextValue);
    if (nextIndex >= 0) setHighlightedIndex(nextIndex);
    closeMenu();
  };
  const moveOption = (offset) => {
    if (!options.length) return;
    const nextIndex = (highlightedIndex + offset + options.length) % options.length;
    setHighlightedIndex(nextIndex);
  };
  const openMenu = () => {
    setHighlightedIndex(selectedIndex);
    setOpen(true);
  };
  const handleOptionKeyDown = (event, index) => {
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
  const handleTriggerKeyDown = (event) => {
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
  return /* @__PURE__ */ import_react.default.createElement("div", { className: `select-field ${className} ${disabled ? "is-disabled" : ""}`.trim(), ref: rootRef }, label ? /* @__PURE__ */ import_react.default.createElement("span", { className: "select-field-label" }, label) : null, /* @__PURE__ */ import_react.default.createElement("div", { className: "select-control" }, /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      "aria-controls": open ? menuId : void 0,
      "aria-expanded": open,
      "aria-haspopup": "listbox",
      "aria-label": ariaLabel,
      className: "select-trigger",
      disabled: disabled || !options.length,
      onClick: () => {
        if (open) closeMenu();
        else openMenu();
      },
      onKeyDown: handleTriggerKeyDown,
      ref: triggerRef,
      type: "button"
    },
    /* @__PURE__ */ import_react.default.createElement("span", { className: "select-trigger-value" }, selectedOption?.label ?? "\u6682\u65E0\u9009\u9879"),
    /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: `select-trigger-chevron ${open ? "is-open" : ""}` })
  ), open && options.length ? /* @__PURE__ */ import_react.default.createElement("div", { className: "select-menu", id: menuId, role: "listbox", "aria-label": ariaLabel }, options.map((option, index) => /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      "aria-selected": option.value === value,
      className: `select-option ${option.value === value ? "is-selected" : ""} ${index === highlightedIndex ? "is-highlighted" : ""}`,
      id: `${menuId}-option-${index}`,
      key: option.value,
      onClick: () => chooseOption(option.value),
      onKeyDown: (event) => handleOptionKeyDown(event, index),
      ref: (element) => {
        optionRefs.current[index] = element;
      },
      role: "option",
      type: "button"
    },
    /* @__PURE__ */ import_react.default.createElement("span", null, option.label),
    option.value === value ? /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: "select-option-check" }, "\u2713") : null
  ))) : null));
}
function formatProjectUpdatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}\u6708${date.getDate()}\u65E5\u66F4\u65B0`;
}
function formatTimestamp(value) {
  if (!value) return "\u65F6\u95F4\u672A\u77E5";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "\u65F6\u95F4\u672A\u77E5";
  return `${date.getFullYear()}\u5E74${date.getMonth() + 1}\u6708${date.getDate()}\u65E5 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function ProjectPicker({
  currentProjectId,
  activeProjectName,
  disabled = false,
  onProjectAction
}) {
  const [open, setOpen] = (0, import_react.useState)(false);
  const [mode, setMode] = (0, import_react.useState)("list");
  const [projects, setProjects] = (0, import_react.useState)([]);
  const [activeProjectId, setActiveProjectId] = (0, import_react.useState)("");
  const [libraryLabel, setLibraryLabel] = (0, import_react.useState)("");
  const [search, setSearch] = (0, import_react.useState)("");
  const [newProjectName, setNewProjectName] = (0, import_react.useState)("");
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [submitting, setSubmitting] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const rootRef = (0, import_react.useRef)(null);
  const triggerRef = (0, import_react.useRef)(null);
  const searchRef = (0, import_react.useRef)(null);
  const createInputRef = (0, import_react.useRef)(null);
  const panelId = (0, import_react.useId)();
  const closePicker = (0, import_react.useCallback)((restoreFocus = false) => {
    setOpen(false);
    setMode("list");
    setSearch("");
    setNewProjectName("");
    setError("");
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);
  const loadProjects = (0, import_react.useCallback)(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${WORKBENCH_API_BASE}/projects`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "\u65E0\u6CD5\u8BFB\u53D6\u9879\u76EE\u5217\u8868");
      const nextProjects = Array.isArray(data.projects) ? data.projects.filter((project) => Boolean(
        project && typeof project.id === "string" && typeof project.name === "string"
      )) : [];
      setProjects(nextProjects);
      setActiveProjectId(currentProjectId || (typeof data.activeProjectId === "string" ? data.activeProjectId : ""));
      setLibraryLabel(typeof data.libraryLabel === "string" ? data.libraryLabel : "");
    } catch (loadError) {
      setProjects([]);
      setError(loadError instanceof Error ? loadError.message : "\u65E0\u6CD5\u8BFB\u53D6\u9879\u76EE\u5217\u8868");
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);
  (0, import_react.useEffect)(() => {
    if (!open || mode !== "list") return;
    void loadProjects();
  }, [loadProjects, mode, open]);
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const handlePointerDown = (event) => {
      if (!rootRef.current || !event.composedPath().includes(rootRef.current)) closePicker();
    };
    const handleKeyDown = (event) => {
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
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => {
      if (mode === "create") createInputRef.current?.focus();
      else searchRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [mode, open]);
  (0, import_react.useEffect)(() => {
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
  const runAction = async (action) => {
    setSubmitting(true);
    setError("");
    try {
      const completed = await onProjectAction(action);
      if (completed) closePicker(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "\u9879\u76EE\u64CD\u4F5C\u672A\u80FD\u5B8C\u6210");
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
  const handleCreateSubmit = (event) => {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name || submitting) return;
    void runAction({ action: "create", name });
  };
  return /* @__PURE__ */ import_react.default.createElement("div", { className: `topbar-center project-switcher ${open ? "is-open" : ""}`.trim(), ref: rootRef }, /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      "aria-controls": open ? panelId : void 0,
      "aria-expanded": open,
      "aria-haspopup": "dialog",
      "aria-label": `\u5207\u6362\u9879\u76EE\uFF0C\u5F53\u524D\u9879\u76EE\uFF1A${activeProjectName}`,
      className: "project-switcher-trigger",
      disabled,
      onClick: openPicker,
      ref: triggerRef,
      type: "button"
    },
    /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: "status-dot" }),
    /* @__PURE__ */ import_react.default.createElement("span", { className: "project-switcher-label" }, "\u5F53\u524D\u9879\u76EE"),
    /* @__PURE__ */ import_react.default.createElement("strong", null, activeProjectName),
    /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: "project-switcher-chevron" })
  ), open ? /* @__PURE__ */ import_react.default.createElement("section", { "aria-label": "\u9879\u76EE\u5207\u6362", className: `project-picker ${mode === "create" ? "is-create" : ""}`, id: panelId, role: "dialog" }, mode === "list" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("header", { className: "project-picker-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, libraryLabel || "\u9879\u76EE\u5E93"), /* @__PURE__ */ import_react.default.createElement("h2", null, "\u9879\u76EE")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u5173\u95ED\u9879\u76EE\u9009\u62E9\u5668", className: "project-picker-close", disabled: submitting, onClick: () => closePicker(true), type: "button" }, "\xD7")), /* @__PURE__ */ import_react.default.createElement("label", { className: "project-picker-search" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\u2315"), /* @__PURE__ */ import_react.default.createElement("input", { "aria-label": "\u641C\u7D22\u9879\u76EE", onChange: (event) => setSearch(event.target.value), placeholder: "\u641C\u7D22\u9879\u76EE", ref: searchRef, value: search }), search ? /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u6E05\u7A7A\u9879\u76EE\u641C\u7D22", onClick: () => setSearch(""), type: "button" }, "\xD7") : null), /* @__PURE__ */ import_react.default.createElement("div", { "aria-busy": loading || submitting, className: "project-picker-list", role: "list" }, loading ? /* @__PURE__ */ import_react.default.createElement("p", { className: "project-picker-status" }, "\u6B63\u5728\u8BFB\u53D6\u9879\u76EE\u2026") : error ? /* @__PURE__ */ import_react.default.createElement("div", { className: "project-picker-status is-error" }, /* @__PURE__ */ import_react.default.createElement("span", null, error), /* @__PURE__ */ import_react.default.createElement("button", { disabled: submitting, onClick: () => void loadProjects(), type: "button" }, "\u91CD\u8BD5")) : visibleProjects.length ? visibleProjects.map((project) => {
    const current = project.id === activeProjectId;
    const updatedAt = formatProjectUpdatedAt(project.updatedAt);
    return /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        "aria-current": current ? "page" : void 0,
        className: `project-picker-option ${current ? "is-current" : ""}`,
        disabled: submitting,
        key: project.id,
        onClick: () => {
          if (current) closePicker(true);
          else void runAction({ action: "select", projectId: project.id });
        },
        role: "listitem",
        type: "button"
      },
      /* @__PURE__ */ import_react.default.createElement("span", { className: "project-picker-option-copy" }, /* @__PURE__ */ import_react.default.createElement("strong", null, project.name), updatedAt ? /* @__PURE__ */ import_react.default.createElement("small", null, updatedAt) : null),
      current ? /* @__PURE__ */ import_react.default.createElement("span", { className: "project-picker-current" }, "\u5F53\u524D") : null
    );
  }) : /* @__PURE__ */ import_react.default.createElement("p", { className: "project-picker-status" }, search ? "\u6CA1\u6709\u5339\u914D\u7684\u9879\u76EE" : "\u9879\u76EE\u5E93\u4E2D\u8FD8\u6CA1\u6709\u53EF\u5207\u6362\u9879\u76EE")), /* @__PURE__ */ import_react.default.createElement("footer", { className: "project-picker-footer" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "project-picker-create", disabled: loading || submitting, onClick: openCreate, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\uFF0B"), "\u65B0\u5EFA\u9879\u76EE"))) : /* @__PURE__ */ import_react.default.createElement("form", { className: "project-create-form", onSubmit: handleCreateSubmit }, /* @__PURE__ */ import_react.default.createElement("header", { className: "project-picker-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, libraryLabel || "\u9879\u76EE\u5E93"), /* @__PURE__ */ import_react.default.createElement("h2", null, "\u65B0\u5EFA\u9879\u76EE")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u8FD4\u56DE\u9879\u76EE\u5217\u8868", className: "project-picker-close", disabled: submitting, onClick: showList, type: "button" }, "\u2190")), /* @__PURE__ */ import_react.default.createElement("label", { className: "project-create-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u9879\u76EE\u540D\u79F0"), /* @__PURE__ */ import_react.default.createElement("input", { autoComplete: "off", disabled: submitting, onChange: (event) => setNewProjectName(event.target.value), placeholder: "\u4F8B\u5982\uFF1A\u7B2C\u4E00\u5B63-\u8FB9\u5173\u7BC7", ref: createInputRef, value: newProjectName })), /* @__PURE__ */ import_react.default.createElement("p", { className: "project-create-hint" }, "\u4F1A\u5728\u5F53\u524D\u9879\u76EE\u5E93\u4E2D\u5EFA\u7ACB\u540C\u540D\u6587\u4EF6\u5939\uFF0C\u5E76\u51C6\u5907\u5206\u955C\u4E3B\u5DE5\u4F5C\u6D41\u4E0E\u4EBA\u7269\u3001\u5730\u70B9/\u73AF\u5883\u3001\u9053\u5177\u8D44\u4EA7\u5E93\u3002"), error ? /* @__PURE__ */ import_react.default.createElement("p", { className: "project-create-error", role: "alert" }, error) : null, /* @__PURE__ */ import_react.default.createElement("footer", { className: "project-create-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", disabled: submitting, onClick: showList, type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: submitting || !newProjectName.trim(), type: "submit" }, submitting ? "\u521B\u5EFA\u4E2D\u2026" : "\u521B\u5EFA\u9879\u76EE")))) : null);
}
function StructureBranch({
  depth,
  expandedPaths,
  nodes,
  onTogglePath
}) {
  return /* @__PURE__ */ import_react.default.createElement("ul", { className: depth === 0 ? "structure-tree" : "structure-tree-branch" }, nodes.map((node) => {
    const isFolder = node.kind === "folder";
    const hasChildren = Boolean(node.children?.length);
    const expanded = expandedPaths.has(node.path);
    const rowStyle = { paddingLeft: `${8 + depth * 15}px` };
    return /* @__PURE__ */ import_react.default.createElement("li", { key: node.path }, isFolder && hasChildren ? /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        "aria-expanded": expanded,
        className: "structure-tree-row structure-tree-folder",
        onClick: () => onTogglePath(node.path),
        style: rowStyle,
        title: node.path,
        type: "button"
      },
      /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: `structure-tree-disclosure ${expanded ? "is-expanded" : ""}` }),
      /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: "structure-tree-icon is-folder" }),
      /* @__PURE__ */ import_react.default.createElement("span", { className: "structure-tree-name" }, node.name)
    ) : /* @__PURE__ */ import_react.default.createElement("div", { className: "structure-tree-row", style: rowStyle, title: node.path }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: "structure-tree-disclosure is-empty" }), /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: `structure-tree-icon ${isFolder ? "is-folder" : "is-file"}` }), /* @__PURE__ */ import_react.default.createElement("span", { className: "structure-tree-name" }, node.name)), isFolder && hasChildren && expanded ? /* @__PURE__ */ import_react.default.createElement(
      StructureBranch,
      {
        depth: depth + 1,
        expandedPaths,
        nodes: node.children || [],
        onTogglePath
      }
    ) : null);
  }));
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
  structure
}) {
  const viewerRef = (0, import_react.useRef)(null);
  const panelId = (0, import_react.useId)();
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const closeWhenOutside = (event) => {
      if (!viewerRef.current || !event.composedPath().includes(viewerRef.current)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, setOpen]);
  return /* @__PURE__ */ import_react.default.createElement("div", { className: "project-structure-float", ref: viewerRef }, open ? /* @__PURE__ */ import_react.default.createElement("section", { "aria-label": "\u9879\u76EE\u76EE\u5F55\u548C\u6587\u4EF6\u7ED3\u6784", className: "project-structure-panel", id: panelId }, /* @__PURE__ */ import_react.default.createElement("header", { className: "project-structure-head" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u53EA\u8BFB\u9879\u76EE\u7ED3\u6784"), /* @__PURE__ */ import_react.default.createElement("h2", null, structure?.rootName || "\u9879\u76EE\u76EE\u5F55")), /* @__PURE__ */ import_react.default.createElement("div", { className: "project-structure-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u5237\u65B0\u9879\u76EE\u7ED3\u6784", className: "project-structure-refresh", disabled: loading, onClick: onRefresh, title: "\u5237\u65B0\u76EE\u5F55", type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\u21BB")), hideTrigger ? /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u5173\u95ED\u9879\u76EE\u7ED3\u6784", className: "project-structure-refresh", onClick: () => setOpen(false), title: "\u5173\u95ED\u76EE\u5F55", type: "button" }, "\xD7") : null)), /* @__PURE__ */ import_react.default.createElement("div", { "aria-busy": loading, "aria-live": "polite", className: "project-structure-body" }, loading ? /* @__PURE__ */ import_react.default.createElement("p", { className: "project-structure-status" }, "\u6B63\u5728\u8BFB\u53D6\u76EE\u5F55...") : error ? /* @__PURE__ */ import_react.default.createElement("p", { className: "project-structure-status is-error" }, error) : structure?.tree.length ? /* @__PURE__ */ import_react.default.createElement(
    StructureBranch,
    {
      depth: 0,
      expandedPaths,
      nodes: structure.tree,
      onTogglePath
    }
  ) : /* @__PURE__ */ import_react.default.createElement("p", { className: "project-structure-status" }, "\u9879\u76EE\u4E2D\u8FD8\u6CA1\u6709\u53EF\u5C55\u793A\u7684\u6587\u4EF6\u3002"))) : null, !hideTrigger ? /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      "aria-controls": open ? panelId : void 0,
      "aria-expanded": open,
      "aria-label": open ? "\u5173\u95ED\u9879\u76EE\u7ED3\u6784" : "\u67E5\u770B\u9879\u76EE\u76EE\u5F55\u548C\u6587\u4EF6\u7ED3\u6784",
      className: `project-structure-fab ${open ? "is-open" : ""}`,
      onClick: () => setOpen(!open),
      title: open ? "\u5173\u95ED\u76EE\u5F55" : "\u67E5\u770B\u76EE\u5F55",
      type: "button"
    },
    /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: "project-structure-fab-icon" })
  ) : null);
}
function ProfilePreview({ content }) {
  const lines = content.split(/\r?\n/);
  const cleanInline = (value) => value.replace(/\*\*/g, "").replace(/`/g, "");
  if (!content.trim()) {
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "profile-preview is-empty" }, "\u8FD8\u6CA1\u6709\u89D2\u8272\u8BBE\u5B9A\uFF0C\u70B9\u51FB\u201C\u7F16\u8F91\u201D\u5F00\u59CB\u8865\u5145\u3002");
  }
  let inCodeBlock = false;
  return /* @__PURE__ */ import_react.default.createElement("div", { "aria-label": "\u89D2\u8272\u8BBE\u5B9A\u9884\u89C8", className: "profile-preview" }, lines.map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return /* @__PURE__ */ import_react.default.createElement("div", { className: "profile-preview-space", key: `space-${index}` });
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      return null;
    }
    if (inCodeBlock) return /* @__PURE__ */ import_react.default.createElement("p", { className: "profile-preview-code", key: `code-${index}` }, cleanInline(trimmed));
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      return /* @__PURE__ */ import_react.default.createElement("h4", { key: `heading-${index}` }, cleanInline(heading[1]));
    }
    const listItem = trimmed.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      return /* @__PURE__ */ import_react.default.createElement("p", { className: "profile-preview-list-item", key: `list-${index}` }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\u2022"), /* @__PURE__ */ import_react.default.createElement("span", null, cleanInline(listItem[1])));
    }
    return /* @__PURE__ */ import_react.default.createElement("p", { key: `paragraph-${index}` }, cleanInline(trimmed));
  }));
}
function DraftSummary({ design }) {
  const items = [
    ["\u65F6\u7801", design.timecode],
    ["\u65F6\u957F", design.duration],
    ["\u666F\u522B / \u673A\u4F4D", design.framing]
  ];
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "draft-summary", "aria-label": "\u5206\u955C\u8349\u7A3F\u6458\u8981" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "draft-summary-lead" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "draft-summary-mark", "aria-hidden": "true" }, "\u5267"), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u8FD9\u662F\u53EF\u5BFC\u5165\u7684\u5267\u672C\u955C\u5934"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u786E\u8BA4\u5185\u5BB9\u540E\u5EFA\u7ACB\u8D44\u4EA7\uFF0C\u539F\u59CB\u5267\u672C\u4E0D\u4F1A\u88AB\u6539\u5199\u3002"))), /* @__PURE__ */ import_react.default.createElement("dl", { className: "draft-summary-grid" }, items.map(([label, value]) => /* @__PURE__ */ import_react.default.createElement("div", { className: "draft-summary-item", key: label }, /* @__PURE__ */ import_react.default.createElement("dt", null, label), /* @__PURE__ */ import_react.default.createElement("dd", null, value || "\u672A\u586B\u5199")))), /* @__PURE__ */ import_react.default.createElement("div", { className: "draft-summary-block" }, /* @__PURE__ */ import_react.default.createElement("h4", null, "\u753B\u9762\u63CF\u8FF0"), /* @__PURE__ */ import_react.default.createElement("p", null, design.content || "\u539F\u59CB\u811A\u672C\u6CA1\u6709\u586B\u5199\u753B\u9762\u63CF\u8FF0\u3002")), /* @__PURE__ */ import_react.default.createElement("div", { className: "draft-summary-block" }, /* @__PURE__ */ import_react.default.createElement("h4", null, "\u53F0\u8BCD"), /* @__PURE__ */ import_react.default.createElement("p", null, design.dialogue || "\u65E0\u53F0\u8BCD")), /* @__PURE__ */ import_react.default.createElement("div", { className: "draft-summary-block" }, /* @__PURE__ */ import_react.default.createElement("h4", null, "\u8FD0\u955C"), /* @__PURE__ */ import_react.default.createElement("p", null, design.camera || "\u672A\u586B\u5199")));
}
function isLegacyReferenceUploadFailure(job) {
  return job.status === "failed" && /upload role:\s*referenceImage/iu.test(job.error || "");
}
function formatComfyJobStatus(job) {
  if (job.status === "completed") {
    if (job.outputPaths?.length) return "\u5019\u9009\u5DF2\u5F52\u6863";
    if (job.message === "Comfy Bridge \u6A21\u62DF\u9A8C\u8BC1\u5B8C\u6210\u3002") return "\u6A21\u62DF\u9A8C\u8BC1\u5B8C\u6210\uFF08\u672A\u751F\u6210\u5A92\u4F53\uFF09";
    return "\u4EFB\u52A1\u5DF2\u5B8C\u6210";
  }
  if (isLegacyReferenceUploadFailure(job)) return "\u5386\u53F2\u4EFB\u52A1\u5931\u8D25\uFF08\u65E7\u7248\u53C2\u8003\u56FE\uFF09";
  return {
    queued: "\u5F85\u63D0\u4EA4",
    uploading: "\u4E0A\u4F20\u7D20\u6750\u4E2D",
    submitted: "\u5DF2\u63D0\u4EA4 ComfyUI",
    running: "\u751F\u6210\u4E2D",
    downloading: "\u4E0B\u8F7D\u5F52\u6863\u4E2D",
    archiving: "\u6B63\u5728\u5F52\u6863",
    failed: "\u751F\u6210\u5931\u8D25",
    cancelled: "\u5DF2\u53D6\u6D88"
  }[job.status] || job.status;
}
function formatComfyJobDetail(job) {
  if (isLegacyReferenceUploadFailure(job)) return " \xB7 \u70B9\u51FB\u91CD\u8BD5\u4F1A\u6309\u5F53\u524D\u7EAF\u6587\u751F\u56FE\u91CD\u65B0\u63D0\u4EA4";
  return job.error ? ` \xB7 ${job.error}` : "";
}
function GenerationModal({
  asset,
  lookPath,
  projectId,
  onClose,
  onJobsObserved,
  onQueued
}) {
  const [profiles, setProfiles] = (0, import_react.useState)([]);
  const [activeProfileId, setActiveProfileId] = (0, import_react.useState)("");
  const [configPath, setConfigPath] = (0, import_react.useState)("");
  const [presets, setPresets] = (0, import_react.useState)([]);
  const [presetId, setPresetId] = (0, import_react.useState)("");
  const [jobs, setJobs] = (0, import_react.useState)([]);
  const [preview, setPreview] = (0, import_react.useState)(null);
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [submitting, setSubmitting] = (0, import_react.useState)(false);
  const [actingJobId, setActingJobId] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  const [width, setWidth] = (0, import_react.useState)("1024");
  const [height, setHeight] = (0, import_react.useState)("1024");
  const [seed, setSeed] = (0, import_react.useState)("");
  const [denoise, setDenoise] = (0, import_react.useState)("0.65");
  const [frames, setFrames] = (0, import_react.useState)("121");
  const [fps, setFps] = (0, import_react.useState)("24");
  const [durationSeconds, setDurationSeconds] = (0, import_react.useState)("5");
  const assetPath = asset.rootPath;
  const availablePresets = presets.filter((preset) => preset.assetTypes.includes(asset.type));
  const activePreset = availablePresets.find((preset) => preset.id === presetId) ?? availablePresets[0];
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  (0, import_react.useEffect)(() => {
    document.body.dataset.aiDramaGeneration = "open";
    return () => {
      delete document.body.dataset.aiDramaGeneration;
    };
  }, []);
  const request = (0, import_react.useCallback)(async (endpoint, init) => {
    const url = new URL(`${WORKBENCH_API_BASE}/comfy${endpoint}`, window.location.origin);
    if (projectId) url.searchParams.set("projectId", projectId);
    const response = await fetch(`${url.pathname}${url.search}`, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers || {} }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "ComfyUI \u4EFB\u52A1\u64CD\u4F5C\u5931\u8D25");
    return data;
  }, [projectId]);
  const reload = (0, import_react.useCallback)(async () => {
    if (!assetPath) return;
    setLoading(true);
    setError(null);
    try {
      const [configResponse, presetResponse, jobResponse] = await Promise.all([
        request("/config"),
        request("/presets"),
        request(`/jobs?assetPath=${encodeURIComponent(assetPath)}`)
      ]);
      setProfiles(configResponse.profiles);
      setActiveProfileId(configResponse.activeProfileId);
      setConfigPath(configResponse.configPath || "");
      setPresets(presetResponse.presets);
      setJobs(jobResponse.jobs);
      onJobsObserved(assetPath, jobResponse.jobs);
      const matching = presetResponse.presets.filter((preset) => preset.assetTypes.includes(asset.type));
      const next = matching.find((preset) => preset.id === presetId) ?? matching[0];
      if (next) {
        setPresetId(next.id);
        setWidth(String(next.defaults?.width ?? 1024));
        setHeight(String(next.defaults?.height ?? 1024));
        setSeed(next.defaults?.seed === void 0 ? "" : String(next.defaults.seed));
        setDenoise(String(next.defaults?.denoise ?? 0.65));
        setFrames(String(next.defaults?.frames ?? 121));
        setFps(String(next.defaults?.fps ?? 24));
        setDurationSeconds(String(next.defaults?.durationSeconds ?? 5));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "\u65E0\u6CD5\u8BFB\u53D6 ComfyUI \u914D\u7F6E");
    } finally {
      setLoading(false);
    }
  }, [asset.type, assetPath, onJobsObserved, presetId, request]);
  (0, import_react.useEffect)(() => {
    void reload();
  }, [reload]);
  (0, import_react.useEffect)(() => {
    setPreview(null);
  }, [activeProfileId, activePreset?.id, denoise, durationSeconds, frames, fps, height, seed, width]);
  (0, import_react.useEffect)(() => {
    if (!assetPath) return void 0;
    const timer = window.setInterval(() => {
      void request(`/jobs?assetPath=${encodeURIComponent(assetPath)}`).then((data) => {
        setJobs(data.jobs);
        onJobsObserved(assetPath, data.jobs);
      }).catch(() => void 0);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [assetPath, onJobsObserved, request]);
  const payload = () => ({
    assetType: asset.type,
    assetPath,
    ...asset.type === "character" && lookPath ? { lookPath } : {},
    presetId: activePreset?.id,
    profileId: activeProfileId,
    ...projectId ? { projectId } : {},
    options: {
      width,
      height,
      seed,
      denoise,
      frames,
      fps,
      durationSeconds,
      useReferenceImages: Boolean(activePreset?.referenceImagesEnabled)
    }
  });
  const chooseProfile = async (profileId) => {
    setActiveProfileId(profileId);
    setPreview(null);
    try {
      await request("/config/active", { body: JSON.stringify({ profileId }), method: "POST" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "\u65E0\u6CD5\u5207\u6362\u670D\u52A1\u5668");
      await reload();
    }
  };
  const choosePreset = (nextId) => {
    const next = availablePresets.find((preset) => preset.id === nextId);
    setPresetId(nextId);
    setPreview(null);
    if (!next) return;
    setWidth(String(next.defaults?.width ?? 1024));
    setHeight(String(next.defaults?.height ?? 1024));
    setSeed(next.defaults?.seed === void 0 ? "" : String(next.defaults.seed));
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
      const data = await request("/jobs/preview", { body: JSON.stringify(payload()), method: "POST" });
      setPreview(data.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "\u65E0\u6CD5\u68C0\u67E5\u751F\u6210\u8F93\u5165");
    } finally {
      setSubmitting(false);
    }
  };
  const queueJob = async () => {
    if (!assetPath || !activePreset) return;
    setSubmitting(true);
    setError(null);
    try {
      const previewData = await request("/jobs/preview", { body: JSON.stringify(payload()), method: "POST" });
      setPreview(previewData.preview);
      if (previewData.preview.errors?.length) return;
      const data = await request("/jobs", { body: JSON.stringify(payload()), method: "POST" });
      setJobs((current) => [data.job, ...current]);
      setPreview(null);
      onQueued(assetPath, data.job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "\u65E0\u6CD5\u63D0\u4EA4\u751F\u6210\u4EFB\u52A1");
    } finally {
      setSubmitting(false);
    }
  };
  const actOnJob = async (job, action) => {
    setActingJobId(job.id);
    setError(null);
    try {
      const data = await request(`/jobs/${encodeURIComponent(job.id)}/${action}`, { body: "{}", method: "POST" });
      setJobs((current) => action === "retry" ? [data.job, ...current.filter((item) => item.id !== job.id)] : current.map((item) => item.id === data.job.id ? data.job : item));
      if (action === "retry") onQueued(assetPath, data.job);
      else onJobsObserved(assetPath, [data.job]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : action === "retry" ? "\u65E0\u6CD5\u91CD\u65B0\u6392\u961F\u4EFB\u52A1" : "\u65E0\u6CD5\u53D6\u6D88\u6392\u961F\u4EFB\u52A1");
    } finally {
      setActingJobId(null);
    }
  };
  if (!assetPath) {
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-backdrop" }, /* @__PURE__ */ import_react.default.createElement("section", { "aria-modal": "true", className: "modal-card generation-modal", role: "dialog" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "ComfyUI \u751F\u6210"), /* @__PURE__ */ import_react.default.createElement("h2", null, "\u5148\u5EFA\u7ACB\u955C\u5934\u8D44\u4EA7")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u5173\u95ED", className: "icon-button", onClick: onClose, type: "button" }, "\xD7")), /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-copy" }, "\u5267\u672C\u8349\u7A3F\u8FD8\u6CA1\u6709\u5BF9\u5E94\u7684\u771F\u5B9E\u955C\u5934\u76EE\u5F55\u3002\u5148\u5EFA\u7ACB\u955C\u5934\u8D44\u4EA7\uFF0C\u5DE5\u4F5C\u53F0\u624D\u80FD\u5B89\u5168\u5730\u5F52\u6863\u9996\u5E27\u3001\u5C3E\u5E27\u548C\u89C6\u9891\u5019\u9009\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: onClose, type: "button" }, "\u77E5\u9053\u4E86"))));
  }
  const profileReady = Boolean(activeProfile?.enabled && activeProfile?.configured);
  const canSubmit = Boolean(activePreset && profileReady);
  const isVideo2 = activePreset?.outputKind === "video";
  const supportsInput = (key) => Boolean(activePreset?.inputs?.some((input) => input.key === key));
  const hasEditableVideoSpec = ["width", "height", "durationSeconds", "frames", "fps"].some(supportsInput);
  return /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-backdrop", onMouseDown: (event) => {
    if (event.target === event.currentTarget) onClose();
  } }, /* @__PURE__ */ import_react.default.createElement("section", { "aria-labelledby": "generation-modal-title", "aria-modal": "true", className: "modal-card generation-modal", role: "dialog" }, /* @__PURE__ */ import_react.default.createElement("header", { className: "modal-heading generation-modal-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "ComfyUI \u751F\u6210"), /* @__PURE__ */ import_react.default.createElement("h2", { id: "generation-modal-title" }, displayWorkspaceAssetTitle(asset))), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u5173\u95ED", className: "icon-button", onClick: onClose, type: "button" }, "\xD7")), /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-modal-body" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-asset-strip" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-asset-strip-copy" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u5F53\u524D\u8D44\u4EA7"), /* @__PURE__ */ import_react.default.createElement("strong", null, displayWorkspaceAssetTitle(asset)), /* @__PURE__ */ import_react.default.createElement("small", null, isVideo2 ? "\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u8BBE\u5B9A\uFF0C\u5E76\u4F7F\u7528\u5DF2\u9009\u9996\u5E27\u548C\u5C3E\u5E27" : activePreset?.referenceImagesEnabled ? "\u56FE\u751F\u56FE\uFF1A\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u8BBE\u5B9A\uFF0C\u5E76\u4E0A\u4F20\u68C0\u67E5\u9875\u5217\u51FA\u7684\u5DF2\u9009\u8F93\u5165\u56FE" : "\u7EAF\u6587\u751F\u56FE\uFF1A\u53EA\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u8BBE\u5B9A\uFF0C\u4E0D\u4E0A\u4F20\u53C2\u8003\u56FE")), /* @__PURE__ */ import_react.default.createElement("span", { className: "generation-output-kind" }, isVideo2 ? "\u89C6\u9891\u5019\u9009" : "\u56FE\u7247\u5019\u9009")), loading ? /* @__PURE__ */ import_react.default.createElement("p", { className: "generation-loading" }, "\u6B63\u5728\u8BFB\u53D6\u670D\u52A1\u5668\u914D\u7F6E\u4E0E\u5DE5\u4F5C\u6D41\u9884\u8BBE\u2026") : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-layout" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-main-column" }, /* @__PURE__ */ import_react.default.createElement("section", { className: "generation-section" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-section-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u4EFB\u52A1\u8BBE\u7F6E"), /* @__PURE__ */ import_react.default.createElement("span", null, "\u9009\u62E9\u751F\u6210\u670D\u52A1\u5668\u548C\u53D7\u63A7\u5DE5\u4F5C\u6D41"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-form-grid" }, /* @__PURE__ */ import_react.default.createElement(SelectField, { ariaLabel: "\u9009\u62E9 ComfyUI \u670D\u52A1\u5668", label: "\u751F\u6210\u670D\u52A1\u5668", onChange: (value) => void chooseProfile(value), options: profiles.map((profile) => ({ label: `${profile.name}${profile.configured && profile.enabled ? "" : " \xB7 \u672A\u914D\u7F6E"}`, value: profile.id })), value: activeProfileId }), /* @__PURE__ */ import_react.default.createElement(SelectField, { ariaLabel: "\u9009\u62E9 ComfyUI \u5DE5\u4F5C\u6D41", label: "\u5DE5\u4F5C\u6D41", disabled: !availablePresets.length, onChange: choosePreset, options: availablePresets.map((preset) => ({ label: preset.label, value: preset.id })), value: activePreset?.id || "" }))), /* @__PURE__ */ import_react.default.createElement("section", { className: "generation-section generation-output-settings" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-section-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u8F93\u51FA\u89C4\u683C"), /* @__PURE__ */ import_react.default.createElement("span", null, isVideo2 ? "\u53EA\u663E\u793A\u5F53\u524D\u4E91\u7AEF\u5DE5\u4F5C\u6D41\u5141\u8BB8\u8986\u76D6\u7684\u53C2\u6570" : "\u8BBE\u7F6E\u5019\u9009\u56FE\u7684\u753B\u5E45"))), !isVideo2 || hasEditableVideoSpec ? /* @__PURE__ */ import_react.default.createElement("div", { className: `generation-parameter-grid ${isVideo2 ? "is-video" : ""}` }, supportsInput("width") ? /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u5BBD\u5EA6", onChange: setWidth, value: width }) : null, supportsInput("height") ? /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u9AD8\u5EA6", onChange: setHeight, value: height }) : null, supportsInput("denoise") ? /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u91CD\u7ED8\u5F3A\u5EA6\uFF080-1\uFF09", onChange: setDenoise, value: denoise }) : null, supportsInput("durationSeconds") ? /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u65F6\u957F\uFF08\u79D2\uFF09", onChange: setDurationSeconds, value: durationSeconds }) : null, supportsInput("frames") ? /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u5E27\u6570", onChange: setFrames, value: frames }) : null, supportsInput("fps") ? /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u5E27\u7387", onChange: setFps, value: fps }) : null) : null, /* @__PURE__ */ import_react.default.createElement("details", { className: "generation-advanced" }, /* @__PURE__ */ import_react.default.createElement("summary", null, /* @__PURE__ */ import_react.default.createElement("span", null, "\u9AD8\u7EA7\u53C2\u6570"), /* @__PURE__ */ import_react.default.createElement("small", null, "Seed \u7559\u7A7A\u5219\u968F\u673A")), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "Seed", onChange: setSeed, value: seed })), isVideo2 && activePreset?.id === "h3-first-last-video-v1" ? /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-mode-note" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u9996\u5C3E\u5E27\u6A21\u5F0F"), /* @__PURE__ */ import_react.default.createElement("span", null, "\u4E0A\u4F20\u5DF2\u9009\u9996\u5E27\u548C\u5C3E\u5E27\uFF1B\u5206\u8FA8\u7387\u4E0E 24 fps \u6CBF\u7528\u4F60\u7684\u539F\u59CB\u5DE5\u4F5C\u6D41\uFF0C\u65F6\u957F\u4F1A\u7531\u5DE5\u4F5C\u6D41\u81EA\u52A8\u5BF9\u9F50\u5230 H3 \u6240\u9700\u5E27\u6570\u3002")) : null, !isVideo2 && activePreset?.referenceImagesEnabled ? /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-mode-note" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u5F53\u524D\u6A21\u5F0F\uFF1A\u56FE\u751F\u56FE"), /* @__PURE__ */ import_react.default.createElement("span", null, activePreset.id === "shot-last-frame-img2img-v1" ? "\u56FA\u5B9A\u8BFB\u53D6\u5F53\u524D\u955C\u5934\u5DF2\u9009\u9996\u5E27\uFF0C\u751F\u6210\u5C3E\u5E27\u5019\u9009\u3002" : "\u4F18\u5148\u8BFB\u53D6\u955C\u5934\u5DF2\u9009\u53C2\u8003\u56FE\uFF0C\u5176\u6B21\u8BFB\u53D6\u573A\u6B21\u5DF2\u9009\u573A\u666F\u56FE\uFF0C\u518D\u5176\u6B21\u8BFB\u53D6\u5355\u4EBA\u7269\u5DF2\u9009\u89C6\u89C9\u56FE\u3002")) : null, !isVideo2 && !activePreset?.referenceImagesEnabled ? /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-mode-note" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u5F53\u524D\u6A21\u5F0F\uFF1A\u7EAF\u6587\u751F\u56FE"), /* @__PURE__ */ import_react.default.createElement("span", null, "\u5DF2\u9009\u4E09\u89C6\u56FE\u3001\u5B9A\u5986\u548C\u53C2\u8003\u56FE\u4E0D\u4F1A\u81EA\u52A8\u4E0A\u4F20\u3002\u9700\u8981\u56FE\u751F\u56FE\u65F6\uFF0C\u8BF7\u5148\u914D\u7F6E\u72EC\u7ACB\u7684\u56FE\u751F\u56FE\u5DE5\u4F5C\u6D41\u3002")) : null)), /* @__PURE__ */ import_react.default.createElement("aside", { className: "generation-side-column" }, /* @__PURE__ */ import_react.default.createElement("section", { className: `generation-status-card ${profileReady ? "is-ready" : ""}` }, /* @__PURE__ */ import_react.default.createElement("span", { className: "generation-card-kicker" }, "\u670D\u52A1\u5668\u72B6\u6001"), /* @__PURE__ */ import_react.default.createElement("strong", null, profileReady ? "\u53EF\u4EE5\u63D0\u4EA4" : "\u5C1A\u672A\u914D\u7F6E"), /* @__PURE__ */ import_react.default.createElement("p", null, profileReady ? `\u5C06\u901A\u8FC7 ${activeProfile?.name || "\u5F53\u524D\u670D\u52A1\u5668"} \u63D0\u4EA4\u4EFB\u52A1\u3002` : "\u586B\u5199 Bridge \u5730\u5740\u548C\u4EE4\u724C\u540E\uFF0C\u5373\u53EF\u5728\u8FD9\u91CC\u76F4\u63A5\u751F\u6210\u3002"), !profileReady && configPath ? /* @__PURE__ */ import_react.default.createElement("details", { className: "generation-config-path" }, /* @__PURE__ */ import_react.default.createElement("summary", null, "\u67E5\u770B\u672C\u673A\u914D\u7F6E\u6587\u4EF6"), /* @__PURE__ */ import_react.default.createElement("code", null, configPath)) : null), activePreset ? /* @__PURE__ */ import_react.default.createElement("section", { className: "generation-preset-card" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "generation-card-kicker" }, "\u53D7\u63A7\u5DE5\u4F5C\u6D41"), /* @__PURE__ */ import_react.default.createElement("strong", null, activePreset.label), /* @__PURE__ */ import_react.default.createElement("p", null, activePreset.description), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("span", null, "\u81EA\u52A8\u5F52\u6863"), /* @__PURE__ */ import_react.default.createElement("b", null, activePreset.outputSlotLabel))) : /* @__PURE__ */ import_react.default.createElement("section", { className: "generation-status-card" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "generation-card-kicker" }, "\u53D7\u63A7\u5DE5\u4F5C\u6D41"), /* @__PURE__ */ import_react.default.createElement("strong", null, "\u6CA1\u6709\u53EF\u7528\u5DE5\u4F5C\u6D41"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u5F53\u524D\u8D44\u4EA7\u6CA1\u6709\u5339\u914D\u7684\u751F\u6210\u9884\u8BBE\u3002")))), preview ? /* @__PURE__ */ import_react.default.createElement("section", { className: `generation-preview ${preview.errors?.length ? "has-error" : ""}` }, /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-result-heading" }, /* @__PURE__ */ import_react.default.createElement("strong", null, preview.summary || "\u8F93\u5165\u68C0\u67E5"), /* @__PURE__ */ import_react.default.createElement("span", null, preview.errors?.length ? "\u9700\u8981\u5904\u7406" : "\u53EF\u4EE5\u751F\u6210")), preview.attachments?.length ? /* @__PURE__ */ import_react.default.createElement("ul", null, preview.attachments.map((item) => /* @__PURE__ */ import_react.default.createElement("li", { key: `${item.role}-${item.name}` }, /* @__PURE__ */ import_react.default.createElement("span", null, item.role), /* @__PURE__ */ import_react.default.createElement("b", null, item.name)))) : null, preview.warnings?.map((warning) => /* @__PURE__ */ import_react.default.createElement("p", { key: warning }, warning)), preview.errors?.map((item) => /* @__PURE__ */ import_react.default.createElement("p", { className: "generation-preview-error", key: item }, item))) : null, error ? /* @__PURE__ */ import_react.default.createElement("p", { className: "generation-preview-error", role: "alert" }, error) : null, jobs.length ? /* @__PURE__ */ import_react.default.createElement("section", { className: "generation-job-list" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u5F53\u524D\u8D44\u4EA7\u4EFB\u52A1"), /* @__PURE__ */ import_react.default.createElement("strong", null, jobs.length, " \u4E2A")), jobs.slice(0, 4).map((job) => /* @__PURE__ */ import_react.default.createElement("article", { key: job.id }, /* @__PURE__ */ import_react.default.createElement("span", { className: `generation-job-dot is-${job.status}` }), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", null, job.presetLabel || "ComfyUI \u4EFB\u52A1"), /* @__PURE__ */ import_react.default.createElement("small", null, formatComfyJobStatus(job), formatComfyJobDetail(job))), job.outputPaths?.length ? /* @__PURE__ */ import_react.default.createElement("em", null, "\u5DF2\u5F52\u6863") : null, job.status === "queued" ? /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button generation-job-action", disabled: actingJobId === job.id, onClick: () => void actOnJob(job, "cancel"), type: "button" }, "\u53D6\u6D88\u6392\u961F") : null, ["failed", "cancelled"].includes(job.status) ? /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button generation-job-action", disabled: actingJobId === job.id, onClick: () => void actOnJob(job, "retry"), type: "button" }, actingJobId === job.id ? "\u5904\u7406\u4E2D\u2026" : "\u91CD\u8BD5") : null))) : null)), /* @__PURE__ */ import_react.default.createElement("footer", { className: "modal-actions generation-modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: onClose, type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", disabled: loading || submitting || !activePreset, onClick: () => void inspectInputs(), type: "button" }, "\u68C0\u67E5\u8F93\u5165"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: loading || submitting || !canSubmit, onClick: () => void queueJob(), type: "button" }, submitting ? "\u68C0\u67E5\u5E76\u63D0\u4EA4\u2026" : "\u786E\u8BA4\u751F\u6210"))));
}
function TrashModal({
  busy,
  entries,
  error,
  loading,
  onClose,
  onRefresh,
  onRestore
}) {
  return /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-backdrop", onMouseDown: (event) => {
    if (event.target === event.currentTarget) onClose();
  } }, /* @__PURE__ */ import_react.default.createElement("section", { "aria-labelledby": "trash-modal-title", "aria-modal": "true", className: "modal-card asset-modal trash-modal", role: "dialog" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u5B89\u5168\u56DE\u6536\u7AD9"), /* @__PURE__ */ import_react.default.createElement("h2", { id: "trash-modal-title" }, "\u5DF2\u79FB\u5165\u7684\u8D44\u4EA7")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u5173\u95ED\u56DE\u6536\u7AD9", className: "icon-button", onClick: onClose, type: "button" }, "\xD7")), /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-copy" }, "\u6062\u590D\u65F6\u53EA\u4F1A\u56DE\u5230\u5B83\u539F\u6765\u7684\u9879\u76EE\u8DEF\u5F84\uFF1B\u82E5\u539F\u4F4D\u7F6E\u5DF2\u6709\u540C\u540D\u6587\u4EF6\uFF0C\u7CFB\u7EDF\u4E0D\u4F1A\u8986\u76D6\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { "aria-busy": loading, className: "trash-entry-list" }, loading ? /* @__PURE__ */ import_react.default.createElement("p", { className: "trash-empty" }, "\u6B63\u5728\u8BFB\u53D6\u56DE\u6536\u7AD9\u2026") : error ? /* @__PURE__ */ import_react.default.createElement("div", { className: "trash-empty is-error" }, /* @__PURE__ */ import_react.default.createElement("p", null, error), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", disabled: busy, onClick: onRefresh, type: "button" }, "\u91CD\u8BD5")) : entries.length ? entries.map((entry) => /* @__PURE__ */ import_react.default.createElement("article", { className: `trash-entry ${entry.recoverable ? "" : "is-legacy"}`, key: entry.id }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: "trash-entry-mark" }, "\u21BA"), /* @__PURE__ */ import_react.default.createElement("div", { className: "trash-entry-copy" }, /* @__PURE__ */ import_react.default.createElement("strong", { title: entry.name }, entry.name), /* @__PURE__ */ import_react.default.createElement("small", { title: entry.originalPath }, entry.recoverable ? entry.originalPath : "\u65E7\u56DE\u6536\u9879\u7F3A\u5C11\u539F\u59CB\u4F4D\u7F6E\uFF0C\u6682\u4E0D\u80FD\u81EA\u52A8\u6062\u590D"), /* @__PURE__ */ import_react.default.createElement("em", null, formatTimestamp(entry.trashedAt), entry.size !== void 0 ? ` \xB7 ${formatSize(entry.size)}` : entry.isDirectory ? " \xB7 \u6587\u4EF6\u5939" : "")), entry.recoverable ? /* @__PURE__ */ import_react.default.createElement("button", { className: "studio-action-button", disabled: busy, onClick: () => onRestore(entry), type: "button" }, "\u6062\u590D") : /* @__PURE__ */ import_react.default.createElement("span", { className: "trash-entry-unavailable" }, "\u4E0D\u53EF\u6062\u590D"))) : /* @__PURE__ */ import_react.default.createElement("p", { className: "trash-empty" }, "\u56DE\u6536\u7AD9\u4E3A\u7A7A\u3002")), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", disabled: busy || loading, onClick: onRefresh, type: "button" }, "\u5237\u65B0"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: busy, onClick: onClose, type: "button" }, "\u5B8C\u6210"))));
}
function Workbench({ externalStructureTrigger = false } = {}) {
  const [snapshot, setSnapshot] = (0, import_react.useState)(null);
  const [projectId, setProjectId] = (0, import_react.useState)(null);
  const [activeTab, setActiveTab] = (0, import_react.useState)("shots");
  const [selectedKey, setSelectedKey] = (0, import_react.useState)(null);
  const [search, setSearch] = (0, import_react.useState)("");
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [notice, setNotice] = (0, import_react.useState)(null);
  const [modal, setModal] = (0, import_react.useState)(null);
  const [newName, setNewName] = (0, import_react.useState)("");
  const [newSimpleAssetName, setNewSimpleAssetName] = (0, import_react.useState)("");
  const [newLookName, setNewLookName] = (0, import_react.useState)("");
  const [selectedLookPath, setSelectedLookPath] = (0, import_react.useState)("identity");
  const [lookDraft, setLookDraft] = (0, import_react.useState)("");
  const [lookMode, setLookMode] = (0, import_react.useState)("preview");
  const [activeSceneId, setActiveSceneId] = (0, import_react.useState)("");
  const [newSceneId, setNewSceneId] = (0, import_react.useState)("");
  const [newShotId, setNewShotId] = (0, import_react.useState)("SH001");
  const [newShotTitle, setNewShotTitle] = (0, import_react.useState)("");
  const [renameValue, setRenameValue] = (0, import_react.useState)("");
  const [profileDraft, setProfileDraft] = (0, import_react.useState)("");
  const [profileMode, setProfileMode] = (0, import_react.useState)("preview");
  const [projectSettingsDraft, setProjectSettingsDraft] = (0, import_react.useState)("");
  const [projectSettingsMode, setProjectSettingsMode] = (0, import_react.useState)("preview");
  const [sceneDraft, setSceneDraft] = (0, import_react.useState)("");
  const [sceneMode, setSceneMode] = (0, import_react.useState)("preview");
  const [sceneCastDraft, setSceneCastDraft] = (0, import_react.useState)([]);
  const [sceneLocationBindingsDraft, setSceneLocationBindingsDraft] = (0, import_react.useState)([]);
  const [scenePropBindingsDraft, setScenePropBindingsDraft] = (0, import_react.useState)([]);
  const [designDraft, setDesignDraft] = (0, import_react.useState)(EMPTY_DESIGN);
  const [revisionConflictKey, setRevisionConflictKey] = (0, import_react.useState)(null);
  const [importSourcePath, setImportSourcePath] = (0, import_react.useState)(null);
  const [importShotIds, setImportShotIds] = (0, import_react.useState)([]);
  const [sourceContextOpen, setSourceContextOpen] = (0, import_react.useState)(false);
  const [sourceContext, setSourceContext] = (0, import_react.useState)({ path: null, content: "", error: null, loading: false });
  const [mediaPreview, setMediaPreview] = (0, import_react.useState)(null);
  const [structureOpen, setStructureOpen] = (0, import_react.useState)(false);
  const [projectStructure, setProjectStructure] = (0, import_react.useState)(null);
  const [projectStructureError, setProjectStructureError] = (0, import_react.useState)(null);
  const [projectStructureLoading, setProjectStructureLoading] = (0, import_react.useState)(false);
  const [expandedStructurePaths, setExpandedStructurePaths] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [trashEntries, setTrashEntries] = (0, import_react.useState)([]);
  const [trashError, setTrashError] = (0, import_react.useState)(null);
  const [trashLoading, setTrashLoading] = (0, import_react.useState)(false);
  const [generationWatchPaths, setGenerationWatchPaths] = (0, import_react.useState)([]);
  const [pendingGenerationRefreshes, setPendingGenerationRefreshes] = (0, import_react.useState)(0);
  const [generationRefreshInFlight, setGenerationRefreshInFlight] = (0, import_react.useState)(false);
  const noticeTimerRef = (0, import_react.useRef)(null);
  const projectEpochRef = (0, import_react.useRef)(0);
  const projectIdRef = (0, import_react.useRef)(null);
  const generationJobWatchesRef = (0, import_react.useRef)(/* @__PURE__ */ new Map());
  const projectUrl = (0, import_react.useCallback)((endpoint, targetProjectId) => {
    const url = new URL(`${WORKBENCH_API_BASE}${endpoint}`, window.location.origin);
    const resolvedProjectId = targetProjectId ?? projectIdRef.current;
    if (resolvedProjectId) url.searchParams.set("projectId", resolvedProjectId);
    return `${url.pathname}${url.search}`;
  }, []);
  (0, import_react.useEffect)(() => {
    projectIdRef.current = projectId;
  }, [projectId]);
  const isProjectRequestCurrent = (0, import_react.useCallback)((targetProjectId, epoch) => epoch === projectEpochRef.current && (!targetProjectId || !projectIdRef.current || projectIdRef.current === targetProjectId), []);
  const loadSnapshot = (0, import_react.useCallback)(async (keepSelection = true, targetProjectId = projectIdRef.current, epoch = projectEpochRef.current) => {
    setLoading(true);
    try {
      const response = await fetch(projectUrl("/project", targetProjectId), { cache: "no-store" });
      const data = normalizeSnapshot(await response.json());
      if (!response.ok) throw new Error(data.error || "\u65E0\u6CD5\u8BFB\u53D6\u8D44\u4EA7\u5E93");
      if (!isProjectRequestCurrent(targetProjectId, epoch) || targetProjectId && data.projectId && data.projectId !== targetProjectId) return false;
      if (!targetProjectId && data.projectId) {
        projectIdRef.current = data.projectId;
        setProjectId(data.projectId);
      }
      setSnapshot(data);
      setProjectStructure(null);
      setProjectStructureError(null);
      setExpandedStructurePaths(/* @__PURE__ */ new Set());
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
          projectSettings: { path: "\u9879\u76EE\u8BBE\u5B9A.md", content: "", revision: "" },
          characters: [],
          locations: [],
          props: [],
          scenes: [],
          shots: [],
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          error: error instanceof Error ? error.message : "\u8BFB\u53D6\u5931\u8D25"
        });
      }
      return false;
    } finally {
      if (isProjectRequestCurrent(targetProjectId, epoch)) setLoading(false);
    }
  }, [isProjectRequestCurrent, projectUrl]);
  (0, import_react.useEffect)(() => {
    void loadSnapshot(false);
  }, [loadSnapshot]);
  const loadProjectStructure = (0, import_react.useCallback)(async (resetExpansion = false) => {
    const requestProjectId = projectIdRef.current;
    const epoch = projectEpochRef.current;
    setProjectStructureLoading(true);
    setProjectStructureError(null);
    try {
      const response = await fetch(projectUrl("/structure", requestProjectId), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "\u65E0\u6CD5\u8BFB\u53D6\u9879\u76EE\u76EE\u5F55");
      if (!isProjectRequestCurrent(requestProjectId, epoch)) return;
      setProjectStructure(data);
      const topLevelFolders = data.tree.filter((node) => node.kind === "folder").map((node) => node.path);
      setExpandedStructurePaths((current) => resetExpansion || !current.size ? new Set(topLevelFolders) : current);
    } catch (error) {
      if (isProjectRequestCurrent(requestProjectId, epoch)) setProjectStructureError(error instanceof Error ? error.message : "\u65E0\u6CD5\u8BFB\u53D6\u9879\u76EE\u76EE\u5F55");
    } finally {
      if (isProjectRequestCurrent(requestProjectId, epoch)) setProjectStructureLoading(false);
    }
  }, [isProjectRequestCurrent, projectUrl]);
  const loadTrashEntries = (0, import_react.useCallback)(async () => {
    const requestProjectId = projectIdRef.current;
    const epoch = projectEpochRef.current;
    setTrashLoading(true);
    setTrashError(null);
    try {
      const response = await fetch(projectUrl("/trash", requestProjectId), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "\u65E0\u6CD5\u8BFB\u53D6\u56DE\u6536\u7AD9");
      if (!isProjectRequestCurrent(requestProjectId, epoch) || requestProjectId && data.projectId && data.projectId !== requestProjectId) return;
      setTrashEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (error) {
      if (isProjectRequestCurrent(requestProjectId, epoch)) {
        setTrashEntries([]);
        setTrashError(error instanceof Error ? error.message : "\u65E0\u6CD5\u8BFB\u53D6\u56DE\u6536\u7AD9");
      }
    } finally {
      if (isProjectRequestCurrent(requestProjectId, epoch)) setTrashLoading(false);
    }
  }, [isProjectRequestCurrent, projectUrl]);
  (0, import_react.useEffect)(() => {
    if (structureOpen && !projectStructure && !projectStructureLoading) {
      void loadProjectStructure();
    }
  }, [loadProjectStructure, projectStructure, projectStructureLoading, structureOpen]);
  (0, import_react.useEffect)(() => {
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
  const sceneReferenceCounts = (0, import_react.useMemo)(() => {
    const counts = /* @__PURE__ */ new Map();
    for (const asset of [...locationAssets, ...propAssets]) {
      const count = sceneAssets.filter((scene) => {
        const bindings = asset.type === "location" ? sceneLocationBindings(scene) : scenePropBindings(scene);
        return bindings.some((binding) => bindingReferencesAsset(binding, asset));
      }).length;
      counts.set(asset.rootPath, count);
    }
    return counts;
  }, [locationAssets, propAssets, sceneAssets]);
  const characterByPath = (0, import_react.useMemo)(
    () => new Map(characterAssets.map((character) => [character.rootPath, character])),
    [characterAssets]
  );
  const sceneGroups = (0, import_react.useMemo)(() => {
    const groups = /* @__PURE__ */ new Map();
    for (const scene of sceneAssets) {
      groups.set(scene.sceneId, { scene, shots: [] });
    }
    for (const shot of shotAssets) {
      const sceneId = shot.design.sceneId || "\u672A\u5F52\u7C7B";
      const group = groups.get(sceneId) || { shots: [] };
      group.shots.push(shot);
      groups.set(sceneId, group);
    }
    return Array.from(groups, ([sceneId, group]) => ({
      sceneId,
      ...group.scene ? { scene: group.scene } : {},
      shots: [...group.shots].sort((left, right) => left.design.shotId.localeCompare(right.design.shotId, "zh-CN", { numeric: true })),
      draftCount: group.shots.filter((shot) => shot.isDraft).length
    })).sort((left, right) => left.sceneId.localeCompare(right.sceneId, "zh-CN", { numeric: true }));
  }, [sceneAssets, shotAssets]);
  const activeScene = (0, import_react.useMemo)(
    () => sceneGroups.find((scene) => scene.sceneId === activeSceneId) ?? sceneGroups[0] ?? null,
    [activeSceneId, sceneGroups]
  );
  const activeShotAssets = activeScene?.shots ?? [];
  const draftGroups = (0, import_react.useMemo)(() => {
    const groups = /* @__PURE__ */ new Map();
    for (const shot of shotAssets) {
      if (!shot.isDraft || !shot.sourcePath) continue;
      const group = groups.get(shot.sourcePath) || [];
      group.push(shot);
      groups.set(shot.sourcePath, group);
    }
    return Array.from(groups, ([sourcePath, shots]) => ({
      sourcePath,
      shots: [...shots].sort((left, right) => left.design.shotId.localeCompare(right.design.shotId, "zh-CN", { numeric: true }))
    })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "zh-CN"));
  }, [shotAssets]);
  const activeDraftGroups = (0, import_react.useMemo)(
    () => draftGroups.map((group) => ({
      ...group,
      shots: group.shots.filter((shot) => shot.design.sceneId === activeScene?.sceneId)
    })).filter((group) => group.shots.length > 0),
    [activeScene?.sceneId, draftGroups]
  );
  const visibleAssets = (0, import_react.useMemo)(() => {
    const source = activeTab === "characters" ? characterAssets : activeTab === "locations" ? locationAssets : activeTab === "props" ? propAssets : activeShotAssets;
    return source.filter((asset) => assetMatchesSearch(asset, search));
  }, [activeShotAssets, activeTab, characterAssets, locationAssets, propAssets, search]);
  const selectedAsset = (0, import_react.useMemo)(() => {
    if (!snapshot) return null;
    const all = [...snapshot.characters, ...snapshot.locations, ...snapshot.props, ...snapshot.scenes, ...snapshot.shots];
    return all.find((asset) => assetKey(asset) === selectedKey) ?? null;
  }, [selectedKey, snapshot]);
  const selectedSceneAssetBindings = (0, import_react.useMemo)(() => ({
    locations: sceneLocationBindingsDraft,
    props: scenePropBindingsDraft
  }), [sceneLocationBindingsDraft, scenePropBindingsDraft]);
  const selectedShotIndex = selectedAsset?.type === "shot" ? activeShotAssets.findIndex((shot) => assetKey(shot) === selectedKey) : -1;
  const selectedSourcePath = selectedAsset?.type === "scene" || selectedAsset?.type === "shot" ? selectedAsset.sourcePath : void 0;
  const selectedSceneMedia = selectedAsset?.type === "scene" ? firstMedia(selectedAsset) : void 0;
  const selectedShotMedia = selectedAsset?.type === "shot" ? firstMedia(selectedAsset) : void 0;
  const selectedCharacterVisualSources = (0, import_react.useMemo)(
    () => selectedAsset?.type === "character" ? characterVisualSources(selectedAsset) : [],
    [selectedAsset]
  );
  const selectedCharacterVisualSource = selectedCharacterVisualSources.find((source) => source.key === selectedLookPath) ?? selectedCharacterVisualSources[0];
  const selectedCharacterLook = selectedAsset?.type === "character" ? getLookForPath(selectedAsset, selectedCharacterVisualSource?.rootPath) : void 0;
  const selectedCharacterVisualSet = selectedCharacterVisualSource ? selectedCharacterVisuals(selectedCharacterVisualSource) : [];
  const inheritedSceneCastForSelectedShot = (0, import_react.useMemo)(() => {
    if (selectedAsset?.type !== "shot" || !activeScene?.scene) return [];
    return activeScene.scene.castBindings.filter((binding) => bindingAppliesToShot(binding, selectedAsset.design.shotId));
  }, [activeScene?.scene, selectedAsset]);
  const effectiveCastForSelectedShot = (0, import_react.useMemo)(() => {
    const effective = /* @__PURE__ */ new Map();
    for (const binding of inheritedSceneCastForSelectedShot) {
      effective.set(binding.characterPath, {
        characterPath: binding.characterPath,
        ...binding.lookPath ? { lookPath: binding.lookPath } : {},
        state: binding.state,
        continuity: binding.continuity,
        sourceLabel: "\u573A\u6B21\u9ED8\u8BA4"
      });
    }
    for (const override of designDraft.characterOverrides ?? []) {
      const inherited = effective.get(override.characterPath);
      if (override.mode === "inherit") {
        if (!inherited) continue;
        effective.set(override.characterPath, {
          ...inherited,
          state: override.state || inherited.state,
          sourceLabel: override.state ? "\u573A\u6B21\u9ED8\u8BA4 \xB7 \u672C\u955C\u5934\u72B6\u6001" : inherited.sourceLabel
        });
        continue;
      }
      effective.set(override.characterPath, {
        characterPath: override.characterPath,
        ...override.mode === "look" && override.lookPath ? { lookPath: override.lookPath } : {},
        state: override.state || inherited?.state || "",
        continuity: inherited?.continuity || "",
        sourceLabel: override.mode === "look" ? "\u672C\u955C\u5934 \xB7 \u8986\u76D6\u9020\u578B" : "\u672C\u955C\u5934 \xB7 \u8EAB\u4EFD\u57FA\u51C6"
      });
    }
    return [...effective.values()];
  }, [designDraft.characterOverrides, inheritedSceneCastForSelectedShot]);
  const selectedImportGroup = (0, import_react.useMemo)(
    () => activeDraftGroups.find((group) => group.sourcePath === importSourcePath) ?? null,
    [activeDraftGroups, importSourcePath]
  );
  const hasUnsavedProfileDraft = selectedAsset?.type === "character" && profileDraft !== (selectedAsset.profileContent || "");
  const hasUnsavedLookDraft = Boolean(
    selectedAsset?.type === "character" && selectedCharacterLook && lookDraft !== (selectedCharacterLook.documentContent || "")
  );
  const hasUnsavedProjectSettingsDraft = Boolean(
    snapshot && projectSettingsDraft !== snapshot.projectSettings.content
  );
  const hasUnsavedSceneAssetBindings = Boolean(
    selectedAsset?.type === "scene" && (JSON.stringify(sceneLocationBindingsDraft) !== JSON.stringify(sceneLocationBindings(selectedAsset)) || JSON.stringify(scenePropBindingsDraft) !== JSON.stringify(scenePropBindings(selectedAsset)))
  );
  (0, import_react.useEffect)(() => {
    setActiveSceneId((current) => sceneGroups.some((scene) => scene.sceneId === current) ? current : sceneGroups[0]?.sceneId || "");
  }, [sceneGroups]);
  const isDirty = (0, import_react.useMemo)(() => {
    if (!selectedAsset) return hasUnsavedProjectSettingsDraft;
    if (selectedAsset.type === "character") {
      return hasUnsavedProfileDraft || hasUnsavedLookDraft || hasUnsavedProjectSettingsDraft;
    }
    if (selectedAsset.type === "scene") {
      return sceneDraft !== (selectedAsset.sceneContent || "") || JSON.stringify(sceneCastDraft) !== JSON.stringify(selectedAsset.castBindings) || hasUnsavedSceneAssetBindings || hasUnsavedProjectSettingsDraft;
    }
    if (selectedAsset.type === "location" || selectedAsset.type === "prop") {
      return sceneDraft !== (selectedAsset.profileContent || "") || hasUnsavedProjectSettingsDraft;
    }
    return JSON.stringify(designDraft) !== JSON.stringify(selectedAsset.design) || hasUnsavedProjectSettingsDraft;
  }, [designDraft, hasUnsavedLookDraft, hasUnsavedProfileDraft, hasUnsavedProjectSettingsDraft, hasUnsavedSceneAssetBindings, sceneCastDraft, selectedAsset]);
  (0, import_react.useEffect)(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
  (0, import_react.useEffect)(() => {
    if (!selectedAsset) {
      const first = activeTab === "shots" ? activeScene?.scene ?? visibleAssets[0] : visibleAssets[0];
      if (first) setSelectedKey(assetKey(first));
    }
  }, [activeScene?.scene, activeTab, selectedAsset, visibleAssets]);
  const selectedCharacterLookRoots = selectedAsset?.type === "character" ? selectedAsset.looks.map((look) => look.rootPath).join("\0") : "";
  (0, import_react.useEffect)(() => {
    if (selectedAsset?.type === "character") {
      setProfileDraft(selectedAsset.profileContent || "");
      setProfileMode("preview");
      setSelectedLookPath((current) => current === "identity" || selectedAsset.looks.some((look) => look.rootPath === current) ? current : "identity");
    }
    if (selectedAsset?.type === "location" || selectedAsset?.type === "prop") {
      setSceneDraft(selectedAsset.profileContent || "");
      setSceneMode("preview");
    }
    if (selectedAsset?.type === "shot") setDesignDraft({ ...selectedAsset.design });
  }, [
    selectedAsset?.type === "character" ? selectedAsset.profileRevision : "",
    selectedAsset?.type === "location" || selectedAsset?.type === "prop" ? selectedAsset.profileRevision : "",
    selectedAsset?.type === "shot" ? selectedAsset.designRevision : "",
    selectedCharacterLookRoots,
    selectedKey
  ]);
  (0, import_react.useEffect)(() => {
    if (selectedAsset?.type !== "scene") return;
    setSceneDraft(selectedAsset.sceneContent || "");
    setSceneMode("preview");
  }, [selectedAsset?.type === "scene" ? selectedAsset.sceneRevision : "", selectedKey]);
  (0, import_react.useEffect)(() => {
    if (selectedAsset?.type !== "scene") return;
    setSceneCastDraft(selectedAsset.castBindings);
  }, [selectedAsset?.type === "scene" ? selectedAsset.castRevision : "", selectedKey]);
  (0, import_react.useEffect)(() => {
    if (selectedAsset?.type !== "scene") return;
    setSceneLocationBindingsDraft(sceneLocationBindings(selectedAsset));
    setScenePropBindingsDraft(scenePropBindings(selectedAsset));
  }, [selectedAsset?.type === "scene" ? selectedAsset.assetBindingsRevision : "", selectedKey]);
  (0, import_react.useEffect)(() => {
    setLookDraft(selectedCharacterLook?.documentContent || "");
    setLookMode("preview");
  }, [selectedAsset?.type === "character" ? selectedAsset.rootPath : "", selectedCharacterLook?.documentRevision, selectedCharacterLook?.rootPath]);
  (0, import_react.useEffect)(() => {
    setProjectSettingsDraft(snapshot?.projectSettings.content || "");
    setProjectSettingsMode("preview");
  }, [snapshot?.projectSettings.revision]);
  (0, import_react.useEffect)(() => {
    setSourceContextOpen(false);
  }, [selectedSourcePath]);
  (0, import_react.useEffect)(() => {
    if (!modal && !mediaPreview) return;
    const lockTarget = document.querySelector(".adw-workbench-shadow-host") ?? document.body;
    const previousOverflow = lockTarget.style.overflow;
    lockTarget.style.overflow = "hidden";
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      if (mediaPreview) setMediaPreview(null);
      else setModal(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      lockTarget.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mediaPreview, modal]);
  const notify = (0, import_react.useCallback)((tone, text) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice({ tone, text });
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, 3600);
  }, []);
  (0, import_react.useEffect)(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);
  const handleGenerationJobsObserved = (0, import_react.useCallback)((assetPath, jobs) => {
    const result = reconcileComfyJobWatches(generationJobWatchesRef.current, assetPath, jobs);
    generationJobWatchesRef.current = result.watches;
    const nextPaths = watchedComfyAssetPaths(result.watches);
    setGenerationWatchPaths((current) => current.length === nextPaths.length && current.every((path, index) => path === nextPaths[index]) ? current : nextPaths);
    if (result.archivedCount > 0) {
      setPendingGenerationRefreshes((current) => current + result.archivedCount);
    }
  }, []);
  const handleGenerationQueued = (0, import_react.useCallback)((assetPath, job) => {
    handleGenerationJobsObserved(assetPath, [job]);
    notify("success", "ComfyUI \u4EFB\u52A1\u5DF2\u8FDB\u5165\u961F\u5217\uFF1B\u5B8C\u6210\u540E\u4F1A\u81EA\u52A8\u663E\u793A\u5728\u5019\u9009\u8D44\u6599\u69FD");
  }, [handleGenerationJobsObserved, notify]);
  (0, import_react.useEffect)(() => {
    if (!generationWatchPaths.length) return void 0;
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
            { cache: "no-store" }
          );
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "\u65E0\u6CD5\u8BFB\u53D6 ComfyUI \u4EFB\u52A1\u72B6\u6001");
          if (disposed || !isProjectRequestCurrent(requestProjectId, requestEpoch)) return;
          handleGenerationJobsObserved(assetPath, Array.isArray(data.jobs) ? data.jobs : []);
        }));
      } catch {
      } finally {
        polling = false;
      }
    };
    void pollGenerationJobs();
    const timer = window.setInterval(() => {
      void pollGenerationJobs();
    }, 3500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [generationWatchPaths, handleGenerationJobsObserved, isProjectRequestCurrent, projectUrl]);
  (0, import_react.useEffect)(() => {
    if (!pendingGenerationRefreshes || !isDirty || generationRefreshInFlight) return;
    notify("success", "\u751F\u6210\u5019\u9009\u5DF2\u5F52\u6863\uFF1B\u4FDD\u5B58\u5F53\u524D\u7F16\u8F91\u540E\u4F1A\u81EA\u52A8\u5237\u65B0\u8D44\u6599\u69FD");
  }, [generationRefreshInFlight, isDirty, notify, pendingGenerationRefreshes]);
  (0, import_react.useEffect)(() => {
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
        loaded ? "\u751F\u6210\u5019\u9009\u5DF2\u5F52\u6863\u5E76\u663E\u793A\u5728\u8D44\u6599\u69FD" : "\u751F\u6210\u5019\u9009\u5DF2\u5F52\u6863\uFF0C\u4F46\u81EA\u52A8\u5237\u65B0\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u5237\u65B0"
      );
    }).finally(() => {
      if (isProjectRequestCurrent(requestProjectId, requestEpoch)) setGenerationRefreshInFlight(false);
    });
  }, [generationRefreshInFlight, isDirty, isProjectRequestCurrent, loadSnapshot, notify, pendingGenerationRefreshes]);
  const postAction = (0, import_react.useCallback)(async (payload) => {
    const response = await fetch(projectUrl("/assets"), {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const data = await response.json();
    if (!response.ok) throw new AssetApiError(data.error || "\u64CD\u4F5C\u5931\u8D25", data.code);
    return data;
  }, [projectUrl]);
  const refreshAndSelect = (0, import_react.useCallback)(async (key) => {
    await loadSnapshot(false);
    if (key) setSelectedKey(key);
  }, [loadSnapshot]);
  const confirmLeaveDraft = (0, import_react.useCallback)((message = "\u5F53\u524D\u8D44\u4EA7\u6709\u672A\u4FDD\u5B58\u4FEE\u6539\uFF0C\u7EE7\u7EED\u64CD\u4F5C\u5C06\u4E22\u5931\u8FD9\u4E9B\u5185\u5BB9\u3002\u662F\u5426\u7EE7\u7EED\uFF1F") => {
    if (!isDirty) return true;
    return window.confirm(message);
  }, [isDirty]);
  const handleProjectAction = (0, import_react.useCallback)(async (action) => {
    const actionLabel = action.action === "create" ? "\u65B0\u5EFA\u9879\u76EE" : "\u5207\u6362\u9879\u76EE";
    if (!confirmLeaveDraft(`${actionLabel}\u4F1A\u79BB\u5F00\u5F53\u524D\u9879\u76EE\uFF0C\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F`)) return false;
    setBusy(true);
    try {
      const response = await fetch(`${WORKBENCH_API_BASE}/projects`, {
        body: JSON.stringify(action),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `${actionLabel}\u5931\u8D25`);
      const nextProjectId = typeof data.activeProjectId === "string" ? data.activeProjectId : action.action === "select" ? action.projectId : action.name;
      const nextEpoch = projectEpochRef.current + 1;
      projectEpochRef.current = nextEpoch;
      setModal(null);
      setMediaPreview(null);
      setSourceContextOpen(false);
      setImportSourcePath(null);
      setImportShotIds([]);
      setSearch("");
      setSelectedKey(null);
      setActiveSceneId("");
      setActiveTab("shots");
      setRevisionConflictKey(null);
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
      if (!loaded) throw new Error(`${actionLabel}\u5DF2\u5B8C\u6210\uFF0C\u4F46\u65E0\u6CD5\u8BFB\u53D6\u9879\u76EE\u8D44\u4EA7\u3002\u8BF7\u70B9\u51FB\u201C\u5237\u65B0\u201D\u91CD\u8BD5\u3002`);
      notify("success", action.action === "create" ? `\u5DF2\u5EFA\u7ACB\u5E76\u6253\u5F00\u9879\u76EE\u201C${action.name}\u201D` : "\u5DF2\u5207\u6362\u9879\u76EE");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${actionLabel}\u5931\u8D25`;
      notify("error", message);
      throw error;
    } finally {
      setBusy(false);
    }
  }, [confirmLeaveDraft, loadSnapshot, notify]);
  const confirmLeaveCharacterDraft = (0, import_react.useCallback)((action) => {
    if (!hasUnsavedProfileDraft && !hasUnsavedLookDraft) return true;
    const unsavedItems = [
      hasUnsavedProfileDraft ? "\u89D2\u8272\u8BBE\u5B9A" : "",
      hasUnsavedLookDraft ? `\u201C${selectedCharacterLook?.name || "\u5F53\u524D"}\u201D\u9020\u578B\u8BBE\u5B9A` : ""
    ].filter(Boolean).join("\u548C");
    return window.confirm(`\u5F53\u524D${unsavedItems}\u6709\u672A\u4FDD\u5B58\u4FEE\u6539\uFF0C${action}\u5C06\u4E22\u5931\u8FD9\u4E9B\u5185\u5BB9\u3002\u662F\u5426\u7EE7\u7EED\uFF1F`);
  }, [hasUnsavedLookDraft, hasUnsavedProfileDraft, selectedCharacterLook?.name]);
  const changeCharacterLook = (0, import_react.useCallback)((nextLookPath) => {
    if (nextLookPath === selectedCharacterVisualSource?.key) return;
    if (hasUnsavedLookDraft && !window.confirm(`\u5F53\u524D\u201C${selectedCharacterLook?.name || "\u5F53\u524D"}\u201D\u9020\u578B\u8BBE\u5B9A\u6709\u672A\u4FDD\u5B58\u4FEE\u6539\uFF0C\u5207\u6362\u9020\u578B\u5C06\u4E22\u5931\u8FD9\u4E9B\u5185\u5BB9\u3002\u662F\u5426\u7EE7\u7EED\uFF1F`)) return;
    setSelectedLookPath(nextLookPath);
  }, [hasUnsavedLookDraft, selectedCharacterLook?.name, selectedCharacterVisualSource?.key]);
  const openCreateCharacterLook = (0, import_react.useCallback)(() => {
    if (!confirmLeaveCharacterDraft("\u65B0\u5EFA\u9020\u578B")) return;
    setNewLookName("");
    setModal("look");
  }, [confirmLeaveCharacterDraft]);
  const refreshWorkspace = (0, import_react.useCallback)(() => {
    if (selectedAsset?.type === "character") {
      if (!confirmLeaveCharacterDraft("\u5237\u65B0\u5DE5\u4F5C\u53F0")) return;
    } else if (!confirmLeaveDraft("\u5237\u65B0\u540E\u4F1A\u91CD\u65B0\u8BFB\u53D6\u78C1\u76D8\u8D44\u6599\uFF0C\u5F53\u524D\u672A\u4FDD\u5B58\u4FEE\u6539\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    void loadSnapshot(true);
  }, [confirmLeaveCharacterDraft, confirmLeaveDraft, loadSnapshot, selectedAsset?.type]);
  const changeSearch = (0, import_react.useCallback)((value) => {
    const source = activeTab === "characters" ? characterAssets : activeTab === "locations" ? locationAssets : activeTab === "props" ? propAssets : activeShotAssets;
    const nextVisibleAssets = source.filter((asset) => assetMatchesSearch(asset, value));
    const keepsCurrentSelection = selectedKey ? nextVisibleAssets.some((asset) => assetKey(asset) === selectedKey) : false;
    if (!keepsCurrentSelection && selectedKey && !confirmLeaveDraft("\u5F53\u524D\u7B5B\u9009\u4F1A\u9690\u85CF\u6B63\u5728\u7F16\u8F91\u7684\u8D44\u4EA7\uFF0C\u672A\u4FDD\u5B58\u4FEE\u6539\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setSearch(value);
    if (!keepsCurrentSelection) setSelectedKey(nextVisibleAssets[0] ? assetKey(nextVisibleAssets[0]) : null);
  }, [activeShotAssets, activeTab, characterAssets, confirmLeaveDraft, locationAssets, propAssets, selectedKey]);
  const selectAsset = (0, import_react.useCallback)((key) => {
    if (key === selectedKey) return;
    if (selectedAsset?.type === "character") {
      if (!confirmLeaveCharacterDraft("\u5207\u6362\u4EBA\u7269")) return;
    } else if (!confirmLeaveDraft()) return;
    setSelectedKey(key);
  }, [confirmLeaveCharacterDraft, confirmLeaveDraft, selectedAsset?.type, selectedKey]);
  const moveSelectedShot = (0, import_react.useCallback)((offset) => {
    if (selectedShotIndex < 0) return;
    const nextShot = activeShotAssets[selectedShotIndex + offset];
    if (nextShot) selectAsset(assetKey(nextShot));
  }, [activeShotAssets, selectAsset, selectedShotIndex]);
  const changeTab = (0, import_react.useCallback)((tab) => {
    if (tab === activeTab || !confirmLeaveDraft()) return;
    const firstAsset = tab === "characters" ? characterAssets[0] : tab === "locations" ? locationAssets[0] : tab === "props" ? propAssets[0] : activeScene?.scene ?? activeShotAssets[0];
    setActiveTab(tab);
    setSearch("");
    setSelectedKey(firstAsset ? assetKey(firstAsset) : null);
  }, [activeScene?.scene, activeShotAssets, activeTab, characterAssets, confirmLeaveDraft, locationAssets, propAssets]);
  const changeScene = (0, import_react.useCallback)((sceneId) => {
    if (sceneId === activeScene?.sceneId) return false;
    if (!confirmLeaveDraft()) return false;
    const nextScene = sceneGroups.find((scene) => scene.sceneId === sceneId);
    setActiveSceneId(sceneId);
    setSearch("");
    const nextAsset = nextScene?.scene ?? nextScene?.shots[0];
    setSelectedKey(nextAsset ? assetKey(nextAsset) : null);
    return true;
  }, [activeScene?.sceneId, confirmLeaveDraft, sceneGroups]);
  const toggleStructurePath = (0, import_react.useCallback)((treePath) => {
    setExpandedStructurePaths((current) => {
      const next = new Set(current);
      if (next.has(treePath)) next.delete(treePath);
      else next.add(treePath);
      return next;
    });
  }, []);
  const refreshProjectStructure = (0, import_react.useCallback)(() => {
    void loadProjectStructure(true);
  }, [loadProjectStructure]);
  const openTrash = () => {
    setModal("trashList");
    void loadTrashEntries();
  };
  const handleRestoreTrashEntry = async (entry) => {
    if (!entry.recoverable || busy) return;
    if (!window.confirm(`\u786E\u8BA4\u5C06\u201C${entry.name}\u201D\u6062\u590D\u5230\u539F\u4F4D\u7F6E\u5417\uFF1F\u5982\u679C\u539F\u4F4D\u7F6E\u5DF2\u6709\u540C\u540D\u6587\u4EF6\uFF0C\u7CFB\u7EDF\u4E0D\u4F1A\u8986\u76D6\u3002`)) return;
    if (!confirmLeaveDraft("\u6062\u590D\u8D44\u4EA7\u540E\u4F1A\u91CD\u65B0\u8BFB\u53D6\u5DE5\u4F5C\u53F0\uFF0C\u5F53\u524D\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      const response = await fetch(projectUrl("/trash"), {
        body: JSON.stringify({ action: "restore", entryId: entry.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "\u6062\u590D\u8D44\u4EA7\u5931\u8D25");
      await Promise.all([loadTrashEntries(), loadSnapshot(true)]);
      notify("success", `\u5DF2\u6062\u590D\u201C${entry.name}\u201D`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u6062\u590D\u8D44\u4EA7\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const openStoryboardImport = () => {
    const firstGroup = activeDraftGroups[0];
    if (!firstGroup) {
      notify("error", "\u5F53\u524D\u573A\u6B21\u6CA1\u6709\u53EF\u5BFC\u5165\u7684\u5206\u955C\u8349\u7A3F");
      return;
    }
    setImportSourcePath(firstGroup.sourcePath);
    setImportShotIds(firstGroup.shots.map(storyboardImportSelector));
    setModal("import");
  };
  const chooseImportSource = (sourcePath) => {
    const group = activeDraftGroups.find((candidate) => candidate.sourcePath === sourcePath);
    setImportSourcePath(sourcePath);
    setImportShotIds(group?.shots.map(storyboardImportSelector) || []);
  };
  const toggleImportShot = (selector) => {
    setImportShotIds((current) => current.includes(selector) ? current.filter((id) => id !== selector) : [...current, selector]);
  };
  const toggleAllImportShots = () => {
    if (!selectedImportGroup) return;
    const ids = selectedImportGroup.shots.map(storyboardImportSelector);
    const allSelected = ids.every((id) => importShotIds.includes(id));
    setImportShotIds(allSelected ? [] : ids);
  };
  const handleImportStoryboard = async (sourcePath, shotIds, dirtyMessage) => {
    if (!sourcePath || !shotIds.length) {
      notify("error", "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u955C\u5934\u8349\u7A3F");
      return;
    }
    if (!confirmLeaveDraft(dirtyMessage)) return;
    setBusy(true);
    try {
      const result = await postAction({
        action: "importStoryboardDrafts",
        sourcePath,
        shotIds
      });
      setModal(null);
      const firstCreated = result.created[0];
      if (firstCreated) {
        await refreshAndSelect(`shot:${firstCreated.path}`);
      } else {
        await loadSnapshot(true);
      }
      const details = [
        result.created.length ? `\u5DF2\u5EFA\u7ACB ${result.created.length} \u4E2A\u955C\u5934` : "\u6CA1\u6709\u5EFA\u7ACB\u65B0\u955C\u5934",
        result.skipped.length ? `\u8DF3\u8FC7 ${result.skipped.length} \u4E2A\u91CD\u590D\u9879` : "",
        result.errors.length ? `${result.errors.length} \u4E2A\u672A\u5B8C\u6210` : ""
      ].filter(Boolean);
      const warning = result.warnings[0] ? `\uFF1B${result.warnings[0]}` : "";
      notify(result.created.length ? "success" : "error", `${details.join("\uFF0C")}${warning}`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u5BFC\u5165\u5267\u672C\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const handleCreateSelectedDraft = () => {
    if (!selectedAsset || selectedAsset.type !== "shot" || !selectedAsset.isDraft) return;
    if (!selectedAsset.sourcePath) {
      notify("error", "\u6B64\u8349\u7A3F\u6CA1\u6709\u53EF\u8FFD\u6EAF\u7684\u5267\u672C\u6765\u6E90\uFF0C\u6682\u65F6\u65E0\u6CD5\u5B89\u5168\u5BFC\u5165");
      return;
    }
    void handleImportStoryboard(
      selectedAsset.sourcePath,
      [storyboardImportSelector(selectedAsset)],
      "\u5F53\u524D\u8349\u7A3F\u6709\u672A\u4FDD\u5B58\u4FEE\u6539\u3002\u5EFA\u7ACB\u8D44\u4EA7\u4F1A\u6309\u539F\u59CB\u5267\u672C\u5BFC\u5165\u5E76\u4E22\u5F03\u8FD9\u4E9B\u4E34\u65F6\u4FEE\u6539\uFF0C\u662F\u5426\u7EE7\u7EED\uFF1F"
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "\u65E0\u6CD5\u8BFB\u53D6\u539F\u59CB\u5267\u672C");
      if (requestEpoch !== projectEpochRef.current || requestProjectId && projectIdRef.current !== requestProjectId) return;
      setSourceContext((current) => current.path === sourcePath ? { path: sourcePath, content: data.content || "", error: null, loading: false } : current);
    } catch (error) {
      if (requestEpoch !== projectEpochRef.current || requestProjectId && projectIdRef.current !== requestProjectId) return;
      setSourceContext((current) => current.path === sourcePath ? {
        path: sourcePath,
        content: "",
        error: error instanceof Error ? error.message : "\u65E0\u6CD5\u8BFB\u53D6\u539F\u59CB\u5267\u672C",
        loading: false
      } : current);
    }
  };
  const handleCreateCharacter = async () => {
    if (!newName.trim()) return;
    if (!confirmLeaveDraft("\u5EFA\u7ACB\u65B0\u4EBA\u7269\u540E\u4F1A\u5237\u65B0\u8D44\u4EA7\u5217\u8868\uFF0C\u5F53\u524D\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      const result = await postAction({
        action: "createCharacter",
        name: newName.trim()
      });
      setModal(null);
      setNewName("");
      setActiveTab("characters");
      setSearch("");
      await refreshAndSelect(result.path ? `character:${result.path}` : void 0);
      notify("success", "\u4EBA\u7269\u8D44\u4EA7\u5DF2\u5EFA\u7ACB");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u5EFA\u7ACB\u4EBA\u7269\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const handleCreateSimpleAsset = async (assetType) => {
    if (!newSimpleAssetName.trim()) return;
    if (!confirmLeaveDraft("\u5EFA\u7ACB\u65B0\u8D44\u4EA7\u540E\u4F1A\u5237\u65B0\u8D44\u4EA7\u5217\u8868\uFF0C\u5F53\u524D\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      const result = await postAction({ action: assetType === "location" ? "createLocation" : "createProp", name: newSimpleAssetName.trim() });
      setModal(null);
      setNewSimpleAssetName("");
      setActiveTab(assetType === "location" ? "locations" : "props");
      setSearch("");
      await refreshAndSelect(result.path ? `${assetType}:${result.path}` : void 0);
      notify("success", assetType === "location" ? "\u5730\u70B9/\u73AF\u5883\u8D44\u4EA7\u5DF2\u5EFA\u7ACB" : "\u9053\u5177\u8D44\u4EA7\u5DF2\u5EFA\u7ACB");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u5EFA\u7ACB\u8D44\u4EA7\u5931\u8D25");
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
        name: newLookName.trim()
      });
      setModal(null);
      setNewLookName("");
      await loadSnapshot(true);
      if (result.path) setSelectedLookPath(result.path);
      notify("success", "\u4EBA\u7269\u9020\u578B\u5DF2\u5EFA\u7ACB\uFF0C\u53EF\u5206\u522B\u51C6\u5907\u4E09\u89C6\u56FE\u3001\u5B9A\u5986\u548C\u53C2\u8003\u56FE");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u5EFA\u7ACB\u4EBA\u7269\u9020\u578B\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const handleCreateScene = async (sceneIdInput = newSceneId) => {
    if (!sceneIdInput.trim()) return;
    if (!confirmLeaveDraft("\u5EFA\u7ACB\u573A\u6B21\u8D44\u4EA7\u540E\u4F1A\u5237\u65B0\u5F53\u524D\u5217\u8868\uFF0C\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      const sceneId = sceneIdInput.trim();
      const result = await postAction({ action: "createScene", sceneId });
      setModal(null);
      setActiveTab("shots");
      setActiveSceneId(sceneId);
      setSearch("");
      await refreshAndSelect(result.path ? `scene:${result.path}` : void 0);
      notify("success", "\u573A\u6B21\u8D44\u4EA7\u5DF2\u5EFA\u7ACB\uFF0C\u53EF\u5148\u51C6\u5907\u573A\u666F\u56FE\u3001\u9996\u5C3E\u5E27\u548C\u6210\u7247\u8D44\u6599");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u5EFA\u7ACB\u573A\u6B21\u8D44\u4EA7\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const handleCreateShot = async () => {
    if (!newSceneId.trim() || !newShotId.trim() || !newShotTitle.trim()) return;
    if (!confirmLeaveDraft("\u5EFA\u7ACB\u65B0\u955C\u5934\u540E\u4F1A\u5237\u65B0\u8D44\u4EA7\u5217\u8868\uFF0C\u5F53\u524D\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      const sceneId = newSceneId.trim();
      const result = await postAction({ action: "createShot", sceneId, shotId: newShotId.trim(), title: newShotTitle.trim() });
      setModal(null);
      setNewShotTitle("");
      setActiveTab("shots");
      setActiveSceneId(sceneId);
      setSearch("");
      await refreshAndSelect(result.path ? `shot:${result.path}` : void 0);
      notify("success", "\u955C\u5934\u8D44\u4EA7\u5DF2\u5EFA\u7ACB");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u5EFA\u7ACB\u955C\u5934\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const handleSave = async () => {
    if (!selectedAsset || selectedAsset.type === "shot" && selectedAsset.isDraft) return;
    setBusy(true);
    try {
      if (selectedAsset.type === "character") {
        await postAction({
          action: "updateCharacterProfile",
          assetPath: selectedAsset.rootPath,
          content: profileDraft,
          expectedRevision: selectedAsset.profileRevision
        });
        notify("success", "\u89D2\u8272\u8BBE\u5B9A\u5DF2\u4FDD\u5B58");
      } else if (selectedAsset.type === "location" || selectedAsset.type === "prop") {
        await postAction({
          action: selectedAsset.type === "location" ? "updateLocationDocument" : "updatePropDocument",
          assetPath: selectedAsset.rootPath,
          content: sceneDraft,
          expectedRevision: selectedAsset.profileRevision
        });
        notify("success", selectedAsset.type === "location" ? "\u5730\u70B9/\u73AF\u5883\u8BBE\u5B9A\u5DF2\u4FDD\u5B58" : "\u9053\u5177\u8BBE\u5B9A\u5DF2\u4FDD\u5B58");
      } else if (selectedAsset.type === "scene") {
        if (!selectedAsset.scenePath) throw new Error("\u8BF7\u5148\u8865\u9F50\u573A\u6B21\u8D44\u4EA7\u540E\u518D\u7F16\u8F91\u573A\u6B21\u8BF4\u660E\u3002");
        await postAction({
          action: "updateSceneDocument",
          assetPath: selectedAsset.rootPath,
          content: sceneDraft,
          expectedRevision: selectedAsset.sceneRevision
        });
        notify("success", "\u573A\u6B21\u8BF4\u660E\u5DF2\u4FDD\u5B58");
      } else {
        if (!selectedAsset.designRevision) throw new Error("\u8BF7\u5148\u5237\u65B0\u955C\u5934\u540E\u518D\u4FDD\u5B58\u3002");
        await postAction({
          action: "updateShotDesign",
          assetPath: selectedAsset.rootPath,
          design: designDraft,
          expectedRevision: selectedAsset.designRevision
        });
        notify("success", "\u955C\u5934\u8BBE\u8BA1\u5DF2\u4FDD\u5B58");
      }
      await loadSnapshot(true);
      setRevisionConflictKey(null);
    } catch (error) {
      if (error instanceof AssetApiError && error.code === "REVISION_CONFLICT") {
        setRevisionConflictKey(assetKey(selectedAsset));
        notify("error", "\u6587\u4EF6\u5DF2\u5728\u5176\u4ED6\u4F4D\u7F6E\u66F4\u65B0\uFF1B\u5F53\u524D\u8349\u7A3F\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u6700\u65B0\u7248\u672C\u540E\u518D\u4FDD\u5B58\u3002");
      } else {
        notify("error", error instanceof Error ? error.message : "\u4FDD\u5B58\u5931\u8D25");
      }
    } finally {
      setBusy(false);
    }
  };
  const handleSaveLook = async () => {
    if (!selectedAsset || selectedAsset.type !== "character" || !selectedCharacterLook?.documentRevision) return;
    setBusy(true);
    try {
      await postAction({
        action: "updateCharacterLookDocument",
        characterPath: selectedAsset.rootPath,
        lookPath: selectedCharacterLook.rootPath,
        content: lookDraft,
        expectedRevision: selectedCharacterLook.documentRevision
      });
      await loadSnapshot(true);
      setRevisionConflictKey(null);
      notify("success", "\u9020\u578B\u8BBE\u5B9A\u5DF2\u4FDD\u5B58");
    } catch (error) {
      if (error instanceof AssetApiError && error.code === "REVISION_CONFLICT") {
        setRevisionConflictKey(assetKey(selectedAsset));
        notify("error", "\u9020\u578B\u8BBE\u5B9A\u5DF2\u5728\u5176\u4ED6\u4F4D\u7F6E\u66F4\u65B0\uFF1B\u5F53\u524D\u8349\u7A3F\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540E\u518D\u4FDD\u5B58\u3002");
      } else {
        notify("error", error instanceof Error ? error.message : "\u4FDD\u5B58\u9020\u578B\u8BBE\u5B9A\u5931\u8D25");
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
        expectedRevision: snapshot.projectSettings.revision
      });
      await loadSnapshot(true);
      notify("success", "\u9879\u76EE\u8BBE\u5B9A\u5DF2\u4FDD\u5B58");
    } catch (error) {
      if (error instanceof AssetApiError && error.code === "REVISION_CONFLICT") {
        notify("error", "\u9879\u76EE\u8BBE\u5B9A\u5DF2\u5728\u5176\u4ED6\u4F4D\u7F6E\u66F4\u65B0\uFF1B\u5F53\u524D\u8349\u7A3F\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u6700\u65B0\u7248\u672C\u540E\u518D\u4FDD\u5B58\u3002");
      } else {
        notify("error", error instanceof Error ? error.message : "\u4FDD\u5B58\u9879\u76EE\u8BBE\u5B9A\u5931\u8D25");
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
        expectedRevision: selectedAsset.castRevision
      });
      await loadSnapshot(true);
      setRevisionConflictKey(null);
      notify("success", "\u672C\u573A\u4EBA\u7269\u4E0E\u9020\u578B\u5DF2\u4FDD\u5B58");
    } catch (error) {
      if (error instanceof AssetApiError && error.code === "REVISION_CONFLICT") {
        setRevisionConflictKey(assetKey(selectedAsset));
        notify("error", "\u51FA\u573A\u4E0E\u9020\u578B\u8868\u5DF2\u5728\u5176\u4ED6\u4F4D\u7F6E\u66F4\u65B0\uFF1B\u5F53\u524D\u8349\u7A3F\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540E\u518D\u4FDD\u5B58\u3002");
      } else {
        notify("error", error instanceof Error ? error.message : "\u4FDD\u5B58\u672C\u573A\u4EBA\u7269\u4E0E\u9020\u578B\u5931\u8D25");
      }
    } finally {
      setBusy(false);
    }
  };
  const addSceneCastBinding = () => {
    const character = characterAssets[0];
    if (!character) {
      notify("error", "\u8BF7\u5148\u5EFA\u7ACB\u4EBA\u7269\u8D44\u4EA7\uFF0C\u518D\u4E3A\u573A\u6B21\u7ED1\u5B9A\u9020\u578B");
      return;
    }
    setSceneCastDraft((current) => [...current, {
      characterPath: character.rootPath,
      state: "",
      continuity: "",
      startShotId: "",
      endShotId: ""
    }]);
  };
  const updateSceneCastBinding = (index, patch) => {
    setSceneCastDraft((current) => current.map((binding, bindingIndex) => bindingIndex === index ? { ...binding, ...patch } : binding));
  };
  const removeSceneCastBinding = (index) => {
    setSceneCastDraft((current) => current.filter((_, bindingIndex) => bindingIndex !== index));
  };
  const addSceneLocationBinding = () => {
    if (!locationAssets.length) {
      notify("error", "\u8BF7\u5148\u5728\u8D44\u4EA7\u5E93\u5EFA\u7ACB\u5730\u70B9/\u73AF\u5883\uFF0C\u518D\u4E3A\u672C\u573A\u6DFB\u52A0\u5F15\u7528");
      return;
    }
    setSceneLocationBindingsDraft((current) => [...current, {
      locationPath: "",
      role: "",
      state: "",
      continuity: "",
      startShotId: "",
      endShotId: ""
    }]);
  };
  const addScenePropBinding = () => {
    if (!propAssets.length) {
      notify("error", "\u8BF7\u5148\u5728\u8D44\u4EA7\u5E93\u5EFA\u7ACB\u9053\u5177\uFF0C\u518D\u4E3A\u672C\u573A\u6DFB\u52A0\u5F15\u7528");
      return;
    }
    setScenePropBindingsDraft((current) => [...current, {
      propPath: "",
      role: "",
      state: "",
      continuity: "",
      startShotId: "",
      endShotId: ""
    }]);
  };
  const updateSceneLocationBinding = (index, patch) => {
    setSceneLocationBindingsDraft((current) => current.map((binding, bindingIndex) => bindingIndex === index ? { ...binding, ...patch } : binding));
  };
  const updateScenePropBinding = (index, patch) => {
    setScenePropBindingsDraft((current) => current.map((binding, bindingIndex) => bindingIndex === index ? { ...binding, ...patch } : binding));
  };
  const removeSceneLocationBinding = (index) => {
    setSceneLocationBindingsDraft((current) => current.filter((_, bindingIndex) => bindingIndex !== index));
  };
  const removeScenePropBinding = (index) => {
    setScenePropBindingsDraft((current) => current.filter((_, bindingIndex) => bindingIndex !== index));
  };
  const handleSaveSceneAssetBindings = async () => {
    if (!selectedAsset || selectedAsset.type !== "scene") return;
    if (sceneLocationBindingsDraft.some((binding) => !binding.locationPath) || scenePropBindingsDraft.some((binding) => !binding.propPath)) {
      notify("error", "\u8BF7\u4E3A\u6BCF\u6761\u5F15\u7528\u9009\u62E9\u5730\u70B9/\u73AF\u5883\u6216\u9053\u5177");
      return;
    }
    setBusy(true);
    try {
      await postAction({
        action: "updateSceneAssetBindings",
        assetPath: selectedAsset.rootPath,
        bindings: {
          locations: sceneLocationBindingsDraft,
          props: scenePropBindingsDraft
        },
        expectedRevision: selectedAsset.assetBindingsRevision
      });
      await loadSnapshot(true);
      setRevisionConflictKey(null);
      notify("success", "\u672C\u573A\u5730\u70B9/\u73AF\u5883\u4E0E\u9053\u5177\u5F15\u7528\u5DF2\u4FDD\u5B58");
    } catch (error) {
      if (error instanceof AssetApiError && error.code === "REVISION_CONFLICT") {
        setRevisionConflictKey(assetKey(selectedAsset));
        notify("error", "\u573A\u6B21\u8D44\u4EA7\u8868\u5DF2\u5728\u5176\u4ED6\u4F4D\u7F6E\u66F4\u65B0\uFF1B\u5F53\u524D\u8349\u7A3F\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540E\u518D\u4FDD\u5B58\u3002");
      } else {
        notify("error", error instanceof Error ? error.message : "\u4FDD\u5B58\u672C\u573A\u5F15\u7528\u8D44\u4EA7\u5931\u8D25");
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
      notify("error", "\u8BF7\u5148\u5EFA\u7ACB\u4EBA\u7269\u8D44\u4EA7\uFF0C\u518D\u4E3A\u955C\u5934\u8BBE\u7F6E\u4EBA\u7269\u9020\u578B");
      return;
    }
    const existing = designDraft.characterOverrides ?? [];
    if (existing.some((override) => override.characterPath === character.rootPath)) {
      notify("error", "\u8BE5\u4EBA\u7269\u5DF2\u7ECF\u6709\u955C\u5934\u7EA7\u9020\u578B\u8986\u76D6");
      return;
    }
    setDesignDraft((draft) => ({
      ...draft,
      characterOverrides: [...draft.characterOverrides ?? [], {
        characterPath: character.rootPath,
        mode: "inherit",
        state: ""
      }]
    }));
  };
  const updateShotCharacterOverride = (index, patch) => {
    setDesignDraft((draft) => ({
      ...draft,
      characterOverrides: (draft.characterOverrides ?? []).map((override, overrideIndex) => overrideIndex === index ? { ...override, ...patch } : override)
    }));
  };
  const removeShotCharacterOverride = (index) => {
    setDesignDraft((draft) => ({
      ...draft,
      characterOverrides: (draft.characterOverrides ?? []).filter((_, overrideIndex) => overrideIndex !== index)
    }));
  };
  const reloadCurrentRevision = async () => {
    if (!selectedAsset) return;
    if (!window.confirm("\u91CD\u65B0\u8BFB\u53D6\u4F1A\u653E\u5F03\u5F53\u524D\u672A\u4FDD\u5B58\u7684\u5185\u5BB9\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      await loadSnapshot(true);
      setRevisionConflictKey(null);
      notify("success", "\u5DF2\u8BFB\u53D6\u6587\u4EF6\u7684\u6700\u65B0\u7248\u672C");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u91CD\u65B0\u8BFB\u53D6\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const handleUpload = async (slot, files) => {
    if (!selectedAsset || !files?.length || selectedAsset.type === "shot" && selectedAsset.isDraft) return;
    if (!confirmLeaveDraft("\u4E0A\u4F20\u8D44\u6599\u540E\u4F1A\u91CD\u65B0\u8BFB\u53D6\u5F53\u524D\u8D44\u4EA7\uFF0C\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    const selectedFiles = Array.from(files);
    const totalBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
    if (selectedFiles.length > MAX_UPLOAD_FILES) {
      notify("error", `\u4E00\u6B21\u6700\u591A\u4E0A\u4F20 ${MAX_UPLOAD_FILES} \u4E2A\u6587\u4EF6`);
      return;
    }
    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES || selectedFiles.some((file) => file.size > MAX_UPLOAD_FILE_BYTES)) {
      notify("error", "\u5355\u4E2A\u6587\u4EF6\u4E0D\u80FD\u8D85\u8FC7 200 MB\uFF0C\u4E00\u6B21\u4E0A\u4F20\u603B\u91CF\u4E0D\u80FD\u8D85\u8FC7 500 MB");
      return;
    }
    const assetType = selectedAsset.type;
    const assetPath = selectedAsset.rootPath || "";
    const lookPath = assetType === "character" ? selectedCharacterLook?.rootPath : void 0;
    setBusy(true);
    try {
      const failures = [];
      let uploaded = 0;
      for (const file of selectedFiles) {
        const query = new URLSearchParams({ assetPath, assetType, fileName: file.name, slot: slot.key });
        if (lookPath) query.set("lookPath", lookPath);
        if (projectId) query.set("projectId", projectId);
        const response = await fetch(`${WORKBENCH_API_BASE}/assets/upload?${query.toString()}`, {
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
          method: "POST"
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          failures.push(`${file.name}\uFF1A${data.error || "\u4E0A\u4F20\u5931\u8D25"}`);
          continue;
        }
        uploaded += 1;
      }
      if (uploaded) await loadSnapshot(true);
      if (failures.length) {
        notify("error", `${uploaded} \u4E2A\u6587\u4EF6\u5DF2\u4E0A\u4F20\uFF0C${failures.length} \u4E2A\u5931\u8D25\u3002${failures[0]}`);
      } else {
        notify("success", `${slot.label}\u8D44\u6599\u5DF2\u52A0\u5165\u8D44\u4EA7`);
      }
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u4E0A\u4F20\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const handleSetCharacterVisualSelection = async (slot, file) => {
    if (!selectedAsset || selectedAsset.type !== "character" || !isImage(file)) return;
    const selectedFiles = selectedSlotVisualFiles(
      selectedCharacterVisualSource?.slots.find((candidate) => candidate.key === slot) ?? { key: slot, label: slot, files: [] }
    );
    if (selectedFiles.length === 1 && selectedFiles[0]?.path === file.path) return;
    if (!confirmLeaveDraft("\u8BBE\u4E3A\u5B9A\u7A3F\u540E\u4F1A\u5237\u65B0\u5F53\u524D\u4EBA\u7269\uFF0C\u672A\u4FDD\u5B58\u7684\u89D2\u8272\u8BBE\u5B9A\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      await postAction({
        action: "setCharacterVisualSelection",
        assetPath: selectedAsset.rootPath,
        slot,
        fileName: file.name,
        ...selectedCharacterLook ? { lookPath: selectedCharacterLook.rootPath } : {}
      });
      await loadSnapshot(true);
      const slotLabel = selectedCharacterVisualSource?.slots.find((candidate) => candidate.key === slot)?.label || "\u89C6\u89C9\u8D44\u6599";
      notify("success", `\u5DF2\u9009\u4E3A\u5F53\u524D${slotLabel}\uFF0C\u6587\u4EF6\u540D\u5DF2\u6807\u8BB0 -\u5DF2\u9009`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u65E0\u6CD5\u8BBE\u4E3A\u5F53\u524D\u5B9A\u7A3F");
    } finally {
      setBusy(false);
    }
  };
  const handleSetWorkspaceVisualSelection = async (slot, file) => {
    if (!selectedAsset || selectedAsset.type === "character" || selectedAsset.type === "shot" && selectedAsset.isDraft || !isImage(file)) return;
    const selectedFiles = selectedSlotVisualFiles(slot);
    if (selectedFiles.length === 1 && selectedFiles[0]?.path === file.path) return;
    if (!confirmLeaveDraft("\u8BBE\u4E3A\u5F53\u524D\u53C2\u8003\u56FE\u540E\u4F1A\u91CD\u65B0\u8BFB\u53D6\u8D44\u6599\u69FD\uFF0C\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      await postAction({
        action: "setWorkspaceVisualSelection",
        assetType: selectedAsset.type,
        assetPath: selectedAsset.rootPath,
        slot: slot.key,
        fileName: file.name
      });
      await loadSnapshot(true);
      notify("success", `\u5DF2\u9009\u4E3A\u5F53\u524D${slot.label}\u53C2\u8003\u56FE\uFF0C\u6587\u4EF6\u540D\u5DF2\u6807\u8BB0 -\u5DF2\u9009`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u65E0\u6CD5\u8BBE\u4E3A\u5F53\u524D\u53C2\u8003\u56FE");
    } finally {
      setBusy(false);
    }
  };
  const handleTrashFile = async (slot, file) => {
    if (!selectedAsset || selectedAsset.type === "shot" && selectedAsset.isDraft) return;
    if (!window.confirm(`\u786E\u8BA4\u79FB\u9664\u201C${file.name}\u201D\uFF1F\u6587\u4EF6\u4F1A\u8FDB\u5165\u8D44\u4EA7\u5E93\u56DE\u6536\u7AD9\u3002`)) return;
    if (!confirmLeaveDraft("\u79FB\u9664\u8D44\u6599\u540E\u4F1A\u91CD\u65B0\u8BFB\u53D6\u5F53\u524D\u8D44\u4EA7\uFF0C\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      await postAction({
        action: "trashAssetFile",
        assetType: selectedAsset.type,
        assetPath: selectedAsset.rootPath,
        slot: slot.key,
        fileName: file.name,
        ...selectedAsset.type === "character" && selectedCharacterLook ? { lookPath: selectedCharacterLook.rootPath } : {}
      });
      notify("success", "\u8D44\u6599\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9");
      await loadSnapshot(true);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u79FB\u9664\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const handleRename = async () => {
    if (!selectedAsset || !renameValue.trim()) return;
    if (!confirmLeaveDraft("\u91CD\u547D\u540D\u4F1A\u91CD\u65B0\u9009\u62E9\u8BE5\u8D44\u4EA7\uFF0C\u5F53\u524D\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u5C06\u4E22\u5931\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      const result = await postAction({ action: "renameAsset", assetType: selectedAsset.type, assetPath: selectedAsset.rootPath, name: renameValue.trim() });
      setModal(null);
      notify("success", "\u8D44\u4EA7\u540D\u79F0\u5DF2\u66F4\u65B0");
      await refreshAndSelect(result.path ? `${selectedAsset.type}:${result.path}` : void 0);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u91CD\u547D\u540D\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const handleTrashAsset = async () => {
    if (!selectedAsset) return;
    const assetLabel = selectedAsset.type === "character" ? selectedAsset.name : selectedAsset.type === "location" || selectedAsset.type === "prop" ? selectedAsset.name : selectedAsset.type === "scene" ? `${selectedAsset.sceneId} \u573A\u6B21\u53CA\u5176\u5168\u90E8\u955C\u5934` : selectedAsset.design.shotId;
    if (!window.confirm(`\u786E\u8BA4\u5C06\u201C${assetLabel}\u201D\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F`)) return;
    if (!confirmLeaveDraft("\u79FB\u5165\u56DE\u6536\u7AD9\u4F1A\u653E\u5F03\u5F53\u524D\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u3002\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setBusy(true);
    try {
      await postAction({ action: "trashAsset", assetType: selectedAsset.type, assetPath: selectedAsset.rootPath });
      setModal(null);
      setSelectedKey(null);
      notify("success", "\u8D44\u4EA7\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9");
      await loadSnapshot(false);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "\u79FB\u5165\u56DE\u6536\u7AD9\u5931\u8D25");
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
      notify("error", "\u573A\u6B21\u7F16\u53F7\u540C\u65F6\u662F\u955C\u5934\u8EAB\u4EFD\uFF0C\u5F53\u524D\u4E0D\u652F\u6301\u5728\u5DE5\u4F5C\u53F0\u5185\u91CD\u547D\u540D\u3002");
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
  const openGeneration = () => {
    if (!selectedAsset) return;
    if (selectedAsset.type === "shot" && selectedAsset.isDraft) {
      setModal("generation");
      return;
    }
    if (!confirmLeaveDraft("\u751F\u6210\u4EFB\u52A1\u53EA\u8BFB\u53D6\u5F53\u524D\u5DF2\u4FDD\u5B58\u7684 Markdown\uFF1B\u7EAF\u6587\u751F\u56FE\u4E0D\u4E0A\u4F20\u53C2\u8003\u56FE\uFF0C\u56FE\u751F\u56FE\u548C\u89C6\u9891\u5DE5\u4F5C\u6D41\u4F1A\u5728\u68C0\u67E5\u8F93\u5165\u540E\u4E0A\u4F20\u660E\u786E\u5217\u51FA\u7684\u5DF2\u9009\u56FE\u7247\u3002\u672A\u4FDD\u5B58\u7684\u7F16\u8F91\u4E0D\u4F1A\u5E26\u5165\u672C\u6B21\u4EFB\u52A1\uFF0C\u662F\u5426\u7EE7\u7EED\uFF1F")) return;
    setModal("generation");
  };
  return /* @__PURE__ */ import_react.default.createElement("main", { className: "workbench-shell" }, /* @__PURE__ */ import_react.default.createElement("header", { className: "topbar" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "brand-lockup" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "brand-sigil", "aria-hidden": "true" }, /* @__PURE__ */ import_react.default.createElement("i", null), /* @__PURE__ */ import_react.default.createElement("i", null), /* @__PURE__ */ import_react.default.createElement("i", null)), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "brand-name" }, "\u6F2B\u5267\u5DE5\u4F5C\u53F0"), /* @__PURE__ */ import_react.default.createElement("p", { className: "brand-subtitle" }, "\u4EBA\u7269 \xB7 \u5206\u955C \xB7 \u6210\u7247"))), /* @__PURE__ */ import_react.default.createElement(
    ProjectPicker,
    {
      currentProjectId: projectId,
      activeProjectName: snapshot?.error ? "\u9009\u62E9\u9879\u76EE" : snapshot?.rootName || "\u9009\u62E9\u9879\u76EE",
      disabled: busy,
      onProjectAction: handleProjectAction
    }
  ), /* @__PURE__ */ import_react.default.createElement("div", { className: "topbar-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "refresh-button", disabled: busy || !snapshot, onClick: () => setModal("projectSettings"), type: "button" }, /* @__PURE__ */ import_react.default.createElement("b", null, "\u9879\u76EE\u8BBE\u5B9A")), /* @__PURE__ */ import_react.default.createElement("button", { className: "refresh-button", disabled: busy, onClick: openTrash, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\u21BA"), /* @__PURE__ */ import_react.default.createElement("b", null, "\u56DE\u6536\u7AD9")), /* @__PURE__ */ import_react.default.createElement("button", { className: "refresh-button", disabled: loading || busy, onClick: refreshWorkspace, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\u21BB"), /* @__PURE__ */ import_react.default.createElement("b", null, loading ? "\u5237\u65B0\u4E2D" : "\u5237\u65B0")))), notice ? /* @__PURE__ */ import_react.default.createElement("div", { "aria-live": "polite", className: `notice notice-${notice.tone}`, role: notice.tone === "error" ? "alert" : "status" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, notice.tone === "success" ? "\u2713" : "!"), notice.text, /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u5173\u95ED\u63D0\u793A", onClick: () => setNotice(null), type: "button" }, "\xD7")) : null, /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-workspace-grid" }, /* @__PURE__ */ import_react.default.createElement("aside", { className: "workspace-navigation" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "workspace-navigation-heading" }, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u5DE5\u4F5C\u533A"), /* @__PURE__ */ import_react.default.createElement("h1", null, "\u5236\u4F5C\u53F0")), /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-tabs", role: "tablist", "aria-label": "\u5DE5\u4F5C\u533A\u5BFC\u822A" }, /* @__PURE__ */ import_react.default.createElement("p", { className: "navigation-section-label" }, "\u5206\u955C\u751F\u4EA7"), /* @__PURE__ */ import_react.default.createElement("button", { "aria-controls": "asset-list-panel", "aria-selected": activeTab === "shots", className: `is-primary-tab ${activeTab === "shots" ? "is-active" : ""}`, id: "shots-tab", onClick: () => changeTab("shots"), role: "tab", tabIndex: activeTab === "shots" ? 0 : -1, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u5206\u955C"), /* @__PURE__ */ import_react.default.createElement("b", null, sceneGroups.length)), /* @__PURE__ */ import_react.default.createElement("p", { className: "navigation-section-label" }, "\u9879\u76EE\u8D44\u4EA7"), /* @__PURE__ */ import_react.default.createElement("button", { "aria-controls": "asset-list-panel", "aria-selected": activeTab === "characters", className: activeTab === "characters" ? "is-active" : "", id: "characters-tab", onClick: () => changeTab("characters"), role: "tab", tabIndex: activeTab === "characters" ? 0 : -1, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u4EBA\u7269"), /* @__PURE__ */ import_react.default.createElement("b", null, characterAssets.length)), /* @__PURE__ */ import_react.default.createElement("button", { "aria-controls": "asset-list-panel", "aria-selected": activeTab === "locations", className: activeTab === "locations" ? "is-active" : "", id: "locations-tab", onClick: () => changeTab("locations"), role: "tab", tabIndex: activeTab === "locations" ? 0 : -1, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u5730\u70B9/\u73AF\u5883"), /* @__PURE__ */ import_react.default.createElement("b", null, locationAssets.length)), /* @__PURE__ */ import_react.default.createElement("button", { "aria-controls": "asset-list-panel", "aria-selected": activeTab === "props", className: activeTab === "props" ? "is-active" : "", id: "props-tab", onClick: () => changeTab("props"), role: "tab", tabIndex: activeTab === "props" ? 0 : -1, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u9053\u5177"), /* @__PURE__ */ import_react.default.createElement("b", null, propAssets.length)))), /* @__PURE__ */ import_react.default.createElement("aside", { className: "asset-browser" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-browser-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, activeTab === "shots" ? "\u5206\u955C\u751F\u4EA7" : "\u9879\u76EE\u8D44\u4EA7"), /* @__PURE__ */ import_react.default.createElement("h2", null, activeTab === "characters" ? "\u4EBA\u7269" : activeTab === "locations" ? "\u5730\u70B9/\u73AF\u5883" : activeTab === "props" ? "\u9053\u5177" : "\u573A\u6B21\u4E0E\u955C\u5934")), activeTab === "characters" || activeTab === "locations" || activeTab === "props" ? /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u65B0\u5EFA\u8D44\u4EA7", className: "add-asset-button", onClick: openCreate, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\uFF0B"), /* @__PURE__ */ import_react.default.createElement("b", null, "\u65B0\u5EFA")) : /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u65B0\u5EFA\u573A\u6B21", className: "add-asset-button", onClick: openCreateScene, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\uFF0B"), /* @__PURE__ */ import_react.default.createElement("b", null, "\u573A\u6B21"))), activeTab === "shots" ? /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-scope" }, /* @__PURE__ */ import_react.default.createElement(
    SelectField,
    {
      ariaLabel: "\u9009\u62E9\u573A\u6B21",
      className: "scene-picker",
      disabled: !sceneGroups.length,
      label: "\u573A\u6B21",
      onChange: (sceneId) => {
        changeScene(sceneId);
      },
      options: sceneGroups.map((scene) => ({ label: `${scene.sceneId} \xB7 ${scene.shots.length} \u955C\u5934`, value: scene.sceneId })),
      value: activeScene?.sceneId || ""
    }
  )) : null, /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-list-tools" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-search" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\u2315"), /* @__PURE__ */ import_react.default.createElement("input", { "aria-label": activeTab === "characters" ? "\u641C\u7D22\u4EBA\u7269" : activeTab === "locations" ? "\u641C\u7D22\u5730\u70B9/\u73AF\u5883" : activeTab === "props" ? "\u641C\u7D22\u9053\u5177" : "\u641C\u7D22\u5F53\u524D\u573A\u6B21\u955C\u5934", onChange: (event) => changeSearch(event.target.value), placeholder: "\u641C\u7D22", value: search }), search ? /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u6E05\u7A7A\u641C\u7D22", className: "asset-search-clear", onClick: () => changeSearch(""), type: "button" }, "\xD7") : null), activeTab === "shots" ? /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u65B0\u5EFA\u955C\u5934", className: "add-asset-button", onClick: openCreate, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\uFF0B"), /* @__PURE__ */ import_react.default.createElement("b", null, "\u955C\u5934")) : null), activeTab === "shots" ? /* @__PURE__ */ import_react.default.createElement("button", { className: "import-storyboard-button", disabled: busy || !activeDraftGroups.length, onClick: openStoryboardImport, type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true" }, "\u21E3"), "\u5BFC\u5165\u5267\u672C", activeDraftGroups.length ? /* @__PURE__ */ import_react.default.createElement("b", null, activeDraftGroups.reduce((total, group) => total + group.shots.length, 0)) : null) : null, activeTab === "shots" && activeScene?.scene ? /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-asset-summary" }, /* @__PURE__ */ import_react.default.createElement(SceneAssetCard, { active: assetKey(activeScene.scene) === selectedKey, onClick: () => selectAsset(assetKey(activeScene.scene)), scene: activeScene.scene })) : activeTab === "shots" && activeScene ? /* @__PURE__ */ import_react.default.createElement("button", { className: "scene-asset-create-note", disabled: busy, onClick: () => void handleCreateScene(activeScene.sceneId), type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u5F53\u524D\u573A\u6B21\u8FD8\u6CA1\u6709\u72EC\u7ACB\u8D44\u6599\u6587\u4EF6\u5939"), /* @__PURE__ */ import_react.default.createElement("b", null, "\u5EFA\u7ACB\u573A\u6B21\u8D44\u4EA7")) : null, /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-list-heading" }, /* @__PURE__ */ import_react.default.createElement("span", null, activeTab === "shots" ? "\u955C\u5934" : "\u5168\u90E8"), /* @__PURE__ */ import_react.default.createElement("small", null, activeTab === "characters" ? `${characterAssets.length}` : activeTab === "locations" ? `${locationAssets.length}` : activeTab === "props" ? `${propAssets.length}` : `${activeShotAssets.length}`)), /* @__PURE__ */ import_react.default.createElement("div", { "aria-labelledby": `${activeTab}-tab`, className: "asset-card-list", id: "asset-list-panel", role: "tabpanel" }, loading ? /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-list-empty" }, "\u52A0\u8F7D\u4E2D\u2026") : snapshot?.error ? /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-list-empty error-copy" }, snapshot.error) : visibleAssets.length ? visibleAssets.map((asset) => /* @__PURE__ */ import_react.default.createElement(AssetCard, { active: assetKey(asset) === selectedKey, asset, key: assetKey(asset), onClick: () => selectAsset(assetKey(asset)), sceneReferenceCount: asset.type === "location" || asset.type === "prop" ? sceneReferenceCounts.get(asset.rootPath) : void 0 })) : /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-list-empty" }, /* @__PURE__ */ import_react.default.createElement("strong", null, search ? "\u6CA1\u6709\u5339\u914D\u7ED3\u679C" : activeTab === "characters" ? "\u8FD8\u6CA1\u6709\u4EBA\u7269" : activeTab === "locations" ? "\u8FD8\u6CA1\u6709\u5730\u70B9/\u73AF\u5883" : activeTab === "props" ? "\u8FD8\u6CA1\u6709\u9053\u5177" : "\u8FD8\u6CA1\u6709\u955C\u5934")))), /* @__PURE__ */ import_react.default.createElement("section", { className: "asset-studio-column" }, /* @__PURE__ */ import_react.default.createElement("div", { className: `asset-studio-head asset-studio-toolbar ${selectedAsset?.type === "character" ? "is-character-studio" : ""} ${selectedAsset?.type === "scene" ? "is-scene-studio" : ""}` }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "asset-breadcrumb" }, selectedAsset?.type === "location" ? "\u9879\u76EE\u8D44\u4EA7 / \u5730\u70B9/\u73AF\u5883" : selectedAsset?.type === "prop" ? "\u9879\u76EE\u8D44\u4EA7 / \u9053\u5177" : activeTab === "characters" ? "\u9879\u76EE\u8D44\u4EA7 / \u4EBA\u7269" : activeScene ? `\u5206\u955C / ${activeScene.sceneId}` : "\u5206\u955C"), /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-title-row" }, /* @__PURE__ */ import_react.default.createElement("h2", null, selectedAsset ? displayWorkspaceAssetTitle(selectedAsset) : "\u9009\u62E9\u4E00\u4E2A\u8D44\u4EA7\u5F00\u59CB"), selectedAsset?.type === "character" ? /* @__PURE__ */ import_react.default.createElement(
    "span",
    {
      "aria-label": `\u4EBA\u7269\u5206\u7C7B\uFF1A${selectedAsset.roleCategory}`,
      className: "character-role-badge",
      title: "\u5206\u7C7B\u6765\u81EA\u89D2\u8272\u8BBE\u5B9A.md\uFF1B\u4FDD\u5B58\u6216\u5237\u65B0\u540E\u66F4\u65B0"
    },
    /* @__PURE__ */ import_react.default.createElement("span", { "aria-hidden": "true", className: "character-role-badge-lock" }, "\u2301"),
    selectedAsset.roleCategory
  ) : null), activeTab === "shots" && activeScene ? /* @__PURE__ */ import_react.default.createElement("p", { className: "studio-context" }, activeScene.shots.length, " \u4E2A\u955C\u5934") : null), selectedAsset ? /* @__PURE__ */ import_react.default.createElement("div", { className: "asset-studio-actions" }, isDirty || selectedAsset.type === "shot" && selectedAsset.isDraft ? /* @__PURE__ */ import_react.default.createElement("span", { className: `asset-state-pill ${isDirty ? "is-dirty" : ""}` }, isDirty ? "\u672A\u4FDD\u5B58" : "\u5F85\u5BFC\u5165") : null, selectedAsset.type === "shot" && selectedShotIndex >= 0 ? /* @__PURE__ */ import_react.default.createElement("div", { className: "shot-stepper", "aria-label": "\u955C\u5934\u5BFC\u822A" }, /* @__PURE__ */ import_react.default.createElement("span", null, String(selectedShotIndex + 1).padStart(2, "0"), " / ", String(activeShotAssets.length).padStart(2, "0")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u4E0A\u4E00\u4E2A\u955C\u5934", disabled: busy || selectedShotIndex === 0, onClick: () => moveSelectedShot(-1), type: "button" }, "\u2039"), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u4E0B\u4E00\u4E2A\u955C\u5934", disabled: busy || selectedShotIndex === activeShotAssets.length - 1, onClick: () => moveSelectedShot(1), type: "button" }, "\u203A")) : null, selectedAsset.type !== "location" && selectedAsset.type !== "prop" ? /* @__PURE__ */ import_react.default.createElement("button", { className: "studio-action-button generation-open-button", disabled: busy, onClick: openGeneration, type: "button" }, "\u751F\u6210") : null, selectedAsset.type !== "shot" || !selectedAsset.isDraft ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, selectedAsset.type !== "scene" ? /* @__PURE__ */ import_react.default.createElement("button", { className: "studio-action-button", disabled: busy, onClick: openRename, type: "button" }, "\u91CD\u547D\u540D") : null, /* @__PURE__ */ import_react.default.createElement("button", { className: "studio-action-button is-danger", disabled: busy, onClick: () => setModal("trash"), type: "button" }, "\u79FB\u5165\u56DE\u6536\u7AD9")) : null) : null), selectedAsset && revisionConflictKey === assetKey(selectedAsset) ? /* @__PURE__ */ import_react.default.createElement("section", { className: "revision-conflict-notice", role: "alert" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u6587\u4EF6\u5DF2\u5728\u5176\u4ED6\u4F4D\u7F6E\u66F4\u65B0"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u5F53\u524D\u8F93\u5165\u6CA1\u6709\u88AB\u8986\u76D6\u3002\u91CD\u65B0\u8BFB\u53D6\u540E\u4F1A\u653E\u5F03\u8FD9\u4EFD\u672C\u5730\u8349\u7A3F\uFF0C\u5E76\u52A0\u8F7D\u78C1\u76D8\u4E2D\u7684\u6700\u65B0\u5185\u5BB9\u3002")), /* @__PURE__ */ import_react.default.createElement("button", { disabled: busy, onClick: () => void reloadCurrentRevision(), type: "button" }, "\u91CD\u65B0\u8BFB\u53D6\u6700\u65B0\u5185\u5BB9")) : null, !selectedAsset ? /* @__PURE__ */ import_react.default.createElement("div", { className: "studio-empty" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "studio-empty-symbol" }, "\u25C7"), /* @__PURE__ */ import_react.default.createElement("h3", null, "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u521B\u4F5C\u5BF9\u8C61"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u8FD9\u91CC\u4F1A\u663E\u793A\u89D2\u8272\u8BBE\u5B9A\u3001\u4E09\u89C6\u56FE\u3001\u955C\u5934\u8BBE\u8BA1\u548C\u5BF9\u5E94\u8D44\u6599\u69FD\u3002")) : selectedAsset.type === "character" ? /* @__PURE__ */ import_react.default.createElement("div", { className: `character-editor ${selectedCharacterVisualSet.length ? "has-character-visuals" : ""}` }, /* @__PURE__ */ import_react.default.createElement("section", { className: "character-look-switcher", "aria-label": "\u4EBA\u7269\u9020\u578B\u9009\u62E9" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u4EBA\u7269\u9020\u578B"), /* @__PURE__ */ import_react.default.createElement("h3", null, selectedCharacterVisualSource?.isIdentity ? "\u8EAB\u4EFD\u57FA\u51C6" : selectedCharacterVisualSource?.label || "\u9009\u62E9\u9020\u578B"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u8EAB\u4EFD\u8D44\u6599\u4E0D\u968F\u670D\u88C5\u53D8\u5316\uFF1B\u6BCF\u5957\u9020\u578B\u72EC\u7ACB\u4FDD\u5B58\u5019\u9009\u4E09\u89C6\u56FE\u3001\u5B9A\u5986\u548C\u53C2\u8003\u56FE\u3002")), /* @__PURE__ */ import_react.default.createElement("div", { className: "character-look-switcher-actions" }, /* @__PURE__ */ import_react.default.createElement(
    SelectField,
    {
      ariaLabel: "\u9009\u62E9\u4EBA\u7269\u9020\u578B",
      className: "character-look-picker",
      disabled: busy || !selectedCharacterVisualSources.length,
      onChange: changeCharacterLook,
      options: selectedCharacterVisualSources.map((source) => ({ label: source.label, value: source.key })),
      value: selectedCharacterVisualSource?.key || "identity"
    }
  ), /* @__PURE__ */ import_react.default.createElement("button", { className: "studio-action-button", disabled: busy, onClick: openCreateCharacterLook, type: "button" }, "\u65B0\u5EFA\u9020\u578B"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "character-work-area" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "character-copy-column" }, selectedCharacterLook ? /* @__PURE__ */ import_react.default.createElement("section", { className: "editor-card look-document-editor" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u5F53\u524D\u9020\u578B"), /* @__PURE__ */ import_react.default.createElement("h3", null, selectedCharacterLook.id, " \xB7 ", selectedCharacterLook.name)), /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card-heading-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { "aria-pressed": lookMode === "edit", className: "editor-mode-button", onClick: () => setLookMode((mode) => mode === "preview" ? "edit" : "preview"), type: "button" }, lookMode === "preview" ? "\u7F16\u8F91" : "\u9884\u89C8"), /* @__PURE__ */ import_react.default.createElement("button", { className: "save-button", disabled: busy || lookDraft === (selectedCharacterLook.documentContent || ""), onClick: () => void handleSaveLook(), type: "button" }, busy ? "\u5904\u7406\u4E2D\u2026" : lookDraft === (selectedCharacterLook.documentContent || "") ? "\u5DF2\u4FDD\u5B58" : "\u4FDD\u5B58\u9020\u578B"))), lookMode === "preview" ? /* @__PURE__ */ import_react.default.createElement(ProfilePreview, { content: lookDraft }) : /* @__PURE__ */ import_react.default.createElement("textarea", { "aria-label": `${selectedCharacterLook.name}\u9020\u578B\u8BBE\u5B9A`, className: "profile-textarea", onChange: (event) => {
    setLookDraft(event.target.value);
    setLookMode("edit");
  }, placeholder: "\u8865\u5145\u670D\u88C5\u3001\u5986\u53D1\u3001\u56FA\u5B9A\u9053\u5177\u548C\u8DE8\u955C\u5934\u8FDE\u7EED\u6027\u2026", value: lookDraft }), /* @__PURE__ */ import_react.default.createElement("p", { className: "editor-hint" }, "\u8FD9\u4E00\u9875\u53EA\u63CF\u8FF0\u5F53\u524D\u670D\u88C5\u4E0E\u72B6\u6001\uFF1B\u4EBA\u7269\u5206\u7C7B\u3001\u8138\u90E8\u548C\u8EAB\u4EFD\u4ECD\u5728\u201C\u89D2\u8272\u8BBE\u5B9A\u201D\u4E2D\u7EF4\u62A4\u3002")) : null, /* @__PURE__ */ import_react.default.createElement("section", { className: "editor-card profile-editor" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u8EAB\u4EFD\u8D44\u6599"), /* @__PURE__ */ import_react.default.createElement("h3", null, "\u89D2\u8272\u8BBE\u5B9A")), /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card-heading-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { "aria-pressed": profileMode === "edit", className: "editor-mode-button", onClick: () => setProfileMode((mode) => mode === "preview" ? "edit" : "preview"), type: "button" }, profileMode === "preview" ? "\u7F16\u8F91" : "\u9884\u89C8"), /* @__PURE__ */ import_react.default.createElement("button", { className: "save-button", disabled: busy || profileDraft === (selectedAsset.profileContent || ""), onClick: () => void handleSave(), type: "button" }, busy ? "\u5904\u7406\u4E2D\u2026" : profileDraft === (selectedAsset.profileContent || "") ? "\u5DF2\u4FDD\u5B58" : "\u4FDD\u5B58\u8BBE\u5B9A"))), profileMode === "preview" ? /* @__PURE__ */ import_react.default.createElement(ProfilePreview, { content: profileDraft }) : /* @__PURE__ */ import_react.default.createElement("textarea", { "aria-label": `${selectedAsset.name}\u89D2\u8272\u8BBE\u5B9A`, className: "profile-textarea", onChange: (event) => {
    setProfileDraft(event.target.value);
    setProfileMode("edit");
  }, placeholder: "\u8865\u5145\u4EBA\u7269\u8EAB\u4EFD\u3001\u5916\u5F62\u3001\u670D\u88C5\u548C\u8868\u6F14\u8BBE\u5B9A\u2026", value: profileDraft }), /* @__PURE__ */ import_react.default.createElement("p", { className: "editor-hint" }, "\u89D2\u8272\u5206\u7C7B\u53EA\u4ECE\u672C\u6587\u4EF6\u89E3\u6790\uFF1B\u8981\u4FEE\u6539\u5206\u7C7B\uFF0C\u8BF7\u5728 Markdown \u4E2D\u7F16\u8F91\u201C\u89D2\u8272\u5206\u7C7B\u201D\u540E\u4FDD\u5B58\u5E76\u5237\u65B0\u3002"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "character-media-column" }, selectedCharacterVisualSet.length && selectedCharacterVisualSource ? /* @__PURE__ */ import_react.default.createElement(CharacterVisualBoard, { characterName: selectedAsset.name, onPreview: setMediaPreview, sourceLabel: selectedCharacterVisualSource.label, visuals: selectedCharacterVisualSet }) : null, /* @__PURE__ */ import_react.default.createElement("section", { className: "slot-section" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "section-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u89C6\u89C9\u8D44\u6599"), /* @__PURE__ */ import_react.default.createElement("h3", null, selectedCharacterVisualSource?.isIdentity ? "\u8EAB\u4EFD\u57FA\u51C6\u8D44\u6599\u69FD" : "\u5F53\u524D\u9020\u578B\u8D44\u6599\u69FD")), /* @__PURE__ */ import_react.default.createElement("span", null, "\u4EC5\u663E\u793A\u5F53\u524D\u8D44\u6599\u6587\u4EF6\u5939\u4E2D\u7684\u771F\u5B9E\u7D20\u6750 \xB7 \u6BCF\u4E2A\u8D44\u6599\u69FD\u53EF\u591A\u56FE\u9009\u62E9\u4E00\u5F20\u5B9A\u7A3F")), /* @__PURE__ */ import_react.default.createElement("div", { className: "slot-grid character-slot-grid" }, (selectedCharacterVisualSource?.slots || []).map((slot) => {
    const visualSlotKey = isCharacterVisualSlotKey(slot.key) ? slot.key : void 0;
    const confirmedFile = visualSlotKey ? selectedCharacterVisualSource?.confirmedVisuals?.[visualSlotKey] : void 0;
    const confirmedSourcePath = visualSlotKey ? selectedCharacterVisualSource?.confirmedVisualSourcePaths?.[visualSlotKey] : void 0;
    return /* @__PURE__ */ import_react.default.createElement(
      SlotPanel,
      {
        disabled: busy,
        confirmedFile,
        confirmedSourcePath,
        key: slot.key,
        onPreview: setMediaPreview,
        onSetConfirmed: visualSlotKey ? (file) => void handleSetCharacterVisualSelection(visualSlotKey, file) : void 0,
        onTrash: (file) => void handleTrashFile(slot, file),
        onUpload: (files) => void handleUpload(slot, files),
        slot
      }
    );
  })))))) : selectedAsset.type === "location" || selectedAsset.type === "prop" ? /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-editor" }, firstMedia(selectedAsset) ? /* @__PURE__ */ import_react.default.createElement(PrimaryMedia, { file: firstMedia(selectedAsset), label: selectedAsset.name, onPreview: () => setMediaPreview(firstMedia(selectedAsset)) }) : null, /* @__PURE__ */ import_react.default.createElement("section", { className: "editor-card scene-document-editor" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, selectedAsset.type === "location" ? "\u5730\u70B9/\u73AF\u5883\u8D44\u4EA7" : "\u9053\u5177\u8D44\u4EA7"), /* @__PURE__ */ import_react.default.createElement("h3", null, selectedAsset.type === "location" ? "\u5730\u70B9/\u73AF\u5883\u8BBE\u5B9A" : "\u9053\u5177\u8BBE\u5B9A")), /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card-heading-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { "aria-pressed": sceneMode === "edit", className: "editor-mode-button", onClick: () => setSceneMode((mode) => mode === "preview" ? "edit" : "preview"), type: "button" }, sceneMode === "preview" ? "\u7F16\u8F91" : "\u9884\u89C8"), /* @__PURE__ */ import_react.default.createElement("button", { className: "save-button", disabled: busy || sceneDraft === (selectedAsset.profileContent || ""), onClick: () => void handleSave(), type: "button" }, busy ? "\u5904\u7406\u4E2D\u2026" : sceneDraft === (selectedAsset.profileContent || "") ? "\u5DF2\u4FDD\u5B58" : "\u4FDD\u5B58\u8BBE\u5B9A"))), sceneMode === "preview" ? /* @__PURE__ */ import_react.default.createElement(ProfilePreview, { content: sceneDraft }) : /* @__PURE__ */ import_react.default.createElement("textarea", { "aria-label": `${selectedAsset.name}\u8BBE\u5B9A`, className: "profile-textarea", onChange: (event) => {
    setSceneDraft(event.target.value);
    setSceneMode("edit");
  }, placeholder: selectedAsset.type === "location" ? "\u8865\u5145\u7A7A\u95F4\u5173\u7CFB\u3001\u5149\u7EBF\u3001\u65F6\u4EE3\u548C\u8FDE\u7EED\u6027\u8981\u6C42\u2026" : "\u8865\u5145\u9053\u5177\u7528\u9014\u3001\u6750\u8D28\u3001\u5C3A\u5BF8\u3001\u78E8\u635F\u548C\u8FDE\u7EED\u6027\u8981\u6C42\u2026", value: sceneDraft })), /* @__PURE__ */ import_react.default.createElement("section", { className: "slot-section" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "section-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u5236\u4F5C\u8D44\u6599"), /* @__PURE__ */ import_react.default.createElement("h3", null, selectedAsset.type === "location" ? "\u5730\u70B9/\u73AF\u5883\u8D44\u6599\u69FD" : "\u9053\u5177\u8D44\u6599\u69FD")), /* @__PURE__ */ import_react.default.createElement("span", null, "\u4E0A\u4F20\u771F\u5B9E\u7D20\u6750\uFF0C\u5E76\u5728\u5019\u9009\u56FE\u4E2D\u9009\u62E9\u5F53\u524D\u53C2\u8003")), /* @__PURE__ */ import_react.default.createElement("p", { className: "asset-library-managed-note" }, "\u7531\u5206\u955C\u573A\u6B21\u7EDF\u4E00\u7BA1\u7406\u5F15\u7528\u5173\u7CFB \xB7 \u5F53\u524D\u8D44\u4EA7\u88AB ", sceneReferenceCounts.get(selectedAsset.rootPath) || 0, " \u4E2A\u573A\u6B21\u5F15\u7528"), /* @__PURE__ */ import_react.default.createElement("div", { className: "slot-grid scene-slot-grid" }, selectedAsset.slots.map((slot) => /* @__PURE__ */ import_react.default.createElement(SlotPanel, { confirmedFile: SELECTABLE_VISUAL_SLOTS.has(slot.key) ? selectedSlotVisual(slot) : void 0, confirmedSourcePath: SELECTABLE_VISUAL_SLOTS.has(slot.key) ? selectedSlotVisual(slot)?.path : void 0, disabled: busy, key: slot.key, onPreview: setMediaPreview, onSetConfirmed: SELECTABLE_VISUAL_SLOTS.has(slot.key) ? (file) => void handleSetWorkspaceVisualSelection(slot, file) : void 0, onTrash: (file) => void handleTrashFile(slot, file), onUpload: (files) => void handleUpload(slot, files), slot }))))) : selectedAsset.type === "scene" ? /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-editor" }, selectedSceneMedia ? /* @__PURE__ */ import_react.default.createElement(PrimaryMedia, { file: selectedSceneMedia, label: `${selectedAsset.sceneId} \u573A\u6B21`, onPreview: () => setMediaPreview(selectedSceneMedia) }) : null, /* @__PURE__ */ import_react.default.createElement("section", { className: "editor-card scene-document-editor" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u5927\u5206\u955C\u8D44\u6599"), /* @__PURE__ */ import_react.default.createElement("h3", null, "\u573A\u6B21\u8BF4\u660E")), selectedAsset.scenePath ? /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card-heading-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { "aria-pressed": sceneMode === "edit", className: "editor-mode-button", onClick: () => setSceneMode((mode) => mode === "preview" ? "edit" : "preview"), type: "button" }, sceneMode === "preview" ? "\u7F16\u8F91" : "\u9884\u89C8"), /* @__PURE__ */ import_react.default.createElement("button", { className: "save-button", disabled: busy || sceneDraft === (selectedAsset.sceneContent || ""), onClick: () => void handleSave(), type: "button" }, busy ? "\u5904\u7406\u4E2D\u2026" : sceneDraft === (selectedAsset.sceneContent || "") ? "\u5DF2\u4FDD\u5B58" : "\u4FDD\u5B58\u573A\u6B21\u8BF4\u660E")) : null), !selectedAsset.scenePath ? /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-setup-empty" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u8FD9\u4E2A\u573A\u6B21\u8FD8\u6CA1\u6709\u72EC\u7ACB\u8D44\u6599\u6587\u4EF6\u5939"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u8865\u9F50\u540E\u4F1A\u521B\u5EFA\u201C\u573A\u6B21.md\u201D\u4EE5\u53CA\u5730\u70B9/\u73AF\u5883\u56FE\u3001\u53C2\u8003\u56FE\u3001\u9996\u5E27\u3001\u5C3E\u5E27\u3001\u5019\u9009\u3001\u5B9A\u7A3F\u548C\u6210\u7247\u8D44\u6599\u69FD\uFF1B\u539F\u59CB\u5206\u955C\u811A\u672C\u4E0D\u4F1A\u88AB\u6539\u5199\u3002"), /* @__PURE__ */ import_react.default.createElement("button", { className: "save-button primary", disabled: busy, onClick: () => void handleCreateScene(selectedAsset.sceneId), type: "button" }, busy ? "\u5EFA\u7ACB\u4E2D\u2026" : "\u8865\u9F50\u573A\u6B21\u8D44\u4EA7")) : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, sceneMode === "preview" ? /* @__PURE__ */ import_react.default.createElement(ProfilePreview, { content: sceneDraft }) : /* @__PURE__ */ import_react.default.createElement("textarea", { "aria-label": `${selectedAsset.sceneId}\u573A\u6B21\u8BF4\u660E`, className: "profile-textarea", onChange: (event) => {
    setSceneDraft(event.target.value);
    setSceneMode("edit");
  }, placeholder: "\u8865\u5145\u672C\u573A\u7684\u7A7A\u95F4\u5173\u7CFB\u3001\u7EDF\u4E00\u89C6\u89C9\u3001\u8FDE\u7EED\u6027\u548C\u4EA4\u4ED8\u8981\u6C42\u2026", value: sceneDraft }), /* @__PURE__ */ import_react.default.createElement("p", { className: "editor-hint" }, "\u8FD9\u91CC\u8BB0\u5F55\u6574\u573A\u7EDF\u4E00\u8981\u6C42\uFF1B\u5177\u4F53\u955C\u5934\u7684\u52A8\u4F5C\u548C\u63D0\u793A\u8BCD\u4ECD\u5728\u5404\u81EA\u7684\u201C\u955C\u5934.md\u201D\u4E2D\u3002"), !selectedAsset.isComplete ? /* @__PURE__ */ import_react.default.createElement("button", { className: "scene-complete-button", disabled: busy, onClick: () => void handleCreateScene(selectedAsset.sceneId), type: "button" }, "\u8865\u9F50\u573A\u6B21\u8D44\u6599\uFF08\u542B\u51FA\u573A\u4E0E\u9020\u578B\u8868\uFF09") : null)), selectedAsset.castPath ? /* @__PURE__ */ import_react.default.createElement("section", { className: "scene-cast-editor" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "section-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u51FA\u573A\u4E0E\u9020\u578B"), /* @__PURE__ */ import_react.default.createElement("h3", null, "\u672C\u573A\u9ED8\u8BA4\u4EBA\u7269")), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "studio-action-button", disabled: busy || !characterAssets.length, onClick: addSceneCastBinding, type: "button" }, "\u6DFB\u52A0\u4EBA\u7269"), /* @__PURE__ */ import_react.default.createElement("button", { className: "save-button", disabled: busy || JSON.stringify(sceneCastDraft) === JSON.stringify(selectedAsset.castBindings), onClick: () => void handleSaveSceneCast(), type: "button" }, busy ? "\u5904\u7406\u4E2D\u2026" : JSON.stringify(sceneCastDraft) === JSON.stringify(selectedAsset.castBindings) ? "\u5DF2\u4FDD\u5B58" : "\u4FDD\u5B58\u7ED1\u5B9A"))), /* @__PURE__ */ import_react.default.createElement("p", { className: "scene-cast-intro" }, "\u5148\u7ED9\u6574\u4E2A\u573A\u6B21\u786E\u5B9A\u89D2\u8272\u548C\u670D\u88C5\uFF1B\u955C\u5934\u9ED8\u8BA4\u7EE7\u627F\uFF0C\u53EA\u6709\u4E34\u65F6\u6362\u88C5\u3001\u53D7\u4F24\u6216\u5C40\u90E8\u72B6\u6001\u624D\u5728\u955C\u5934\u5185\u8986\u76D6\u3002"), sceneCastDraft.length ? /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-list" }, sceneCastDraft.map((binding, index) => {
    const character = characterByPath.get(binding.characterPath);
    const lookOptions = [
      { label: "\u8EAB\u4EFD\u57FA\u51C6", value: "__identity__" },
      ...character?.looks.map((look) => ({ label: `${look.id} \xB7 ${look.name}`, value: look.rootPath })) || []
    ];
    return /* @__PURE__ */ import_react.default.createElement("article", { className: "scene-cast-row", key: `${binding.characterPath}-${index}` }, /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-head" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u89D2\u8272 ", String(index + 1).padStart(2, "0")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": `\u79FB\u9664\u7B2C ${index + 1} \u6761\u573A\u6B21\u4EBA\u7269\u7ED1\u5B9A`, className: "asset-file-remove", disabled: busy, onClick: () => removeSceneCastBinding(index), type: "button" }, "\xD7")), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-grid" }, /* @__PURE__ */ import_react.default.createElement(SelectField, { ariaLabel: `\u9009\u62E9\u7B2C ${index + 1} \u4F4D\u573A\u6B21\u4EBA\u7269`, label: "\u4EBA\u7269", disabled: busy || !characterAssets.length, onChange: (characterPath) => updateSceneCastBinding(index, { characterPath, lookPath: void 0 }), options: characterAssets.map((asset) => ({ label: `${asset.name} \xB7 ${asset.roleCategory}`, value: asset.rootPath })), value: binding.characterPath }), /* @__PURE__ */ import_react.default.createElement(SelectField, { ariaLabel: `\u9009\u62E9${character?.name || "\u4EBA\u7269"}\u7684\u9ED8\u8BA4\u9020\u578B`, label: "\u9ED8\u8BA4\u9020\u578B", disabled: busy || !character, onChange: (value) => updateSceneCastBinding(index, { lookPath: value === "__identity__" ? void 0 : value }), options: lookOptions, value: binding.lookPath || "__identity__" }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u8D77\u59CB\u955C\u53F7", onChange: (startShotId) => updateSceneCastBinding(index, { startShotId }), placeholder: "\u7559\u7A7A\u8868\u793A\u4ECE\u9996\u955C", value: binding.startShotId }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u7ED3\u675F\u955C\u53F7", onChange: (endShotId) => updateSceneCastBinding(index, { endShotId }), placeholder: "\u7559\u7A7A\u8868\u793A\u5230\u5C3E\u955C", value: binding.endShotId })), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-notes" }, /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u4EBA\u7269\u72B6\u6001", onChange: (state) => updateSceneCastBinding(index, { state }), placeholder: "\u5982\uFF1A\u8863\u888D\u5B8C\u6574\u3001\u95ED\u773C\u9759\u6B62", value: binding.state }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u8FDE\u7EED\u6027", onChange: (continuity) => updateSceneCastBinding(index, { continuity }), placeholder: "\u5982\uFF1A\u5DE6\u80A9\u94C1\u94FE\u59CB\u7EC8\u7ED5\u5411\u80CC\u90E8", value: binding.continuity })));
  })) : /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-empty" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u5C1A\u672A\u7ED1\u5B9A\u672C\u573A\u4EBA\u7269"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u5148\u6DFB\u52A0\u89D2\u8272\u548C\u9ED8\u8BA4\u9020\u578B\uFF0C\u540E\u7EED\u955C\u5934\u5C31\u80FD\u76F4\u63A5\u7EE7\u627F\u3002"))) : null, /* @__PURE__ */ import_react.default.createElement("section", { className: "scene-cast-editor scene-asset-bindings", "aria-label": "\u672C\u573A\u5F15\u7528\u8D44\u4EA7" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "section-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u5206\u955C\u751F\u4EA7\u5BB9\u5668"), /* @__PURE__ */ import_react.default.createElement("h3", null, "\u672C\u573A\u5F15\u7528\u8D44\u4EA7")), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "studio-action-button", disabled: busy || !locationAssets.length, onClick: addSceneLocationBinding, type: "button" }, "\u6DFB\u52A0\u5730\u70B9/\u73AF\u5883"), /* @__PURE__ */ import_react.default.createElement("button", { className: "studio-action-button", disabled: busy || !propAssets.length, onClick: addScenePropBinding, type: "button" }, "\u6DFB\u52A0\u9053\u5177"), /* @__PURE__ */ import_react.default.createElement("button", { className: "save-button", disabled: busy || !hasUnsavedSceneAssetBindings, onClick: () => void handleSaveSceneAssetBindings(), type: "button" }, busy ? "\u5904\u7406\u4E2D\u2026" : hasUnsavedSceneAssetBindings ? "\u4FDD\u5B58\u5F15\u7528" : "\u5DF2\u4FDD\u5B58"))), /* @__PURE__ */ import_react.default.createElement("p", { className: "scene-cast-intro" }, "\u5730\u70B9/\u73AF\u5883\u4E0E\u9053\u5177\u4FDD\u7559\u5728\u9879\u76EE\u8D44\u4EA7\u5E93\u4E2D\uFF1B\u672C\u573A\u53EA\u8BB0\u5F55\u5F15\u7528\u3001\u7528\u9014\u548C\u8FDE\u7EED\u6027\uFF0C\u955C\u5934\u5728\u8BBE\u5B9A\u7684\u8303\u56F4\u5185\u7EE7\u627F\u3002"), /* @__PURE__ */ import_react.default.createElement("p", { className: "scene-asset-binding-hint" }, "\u8D77\u6B62\u955C\u53F7\u7559\u7A7A\u8868\u793A\u8986\u76D6\u5168\u573A\uFF1B\u586B\u5199\u65F6\u5FC5\u987B\u4F7F\u7528\u5F53\u524D\u573A\u6B21\u5DF2\u6709\u7684\u955C\u53F7\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-asset-binding-categories" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-asset-binding-category" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-asset-binding-category-heading" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u5730\u70B9/\u73AF\u5883"), /* @__PURE__ */ import_react.default.createElement("small", null, "\u7A7A\u95F4\u3001\u73AF\u5883\u548C\u4E3B\u89C6\u89C9\u57FA\u5E95")), selectedSceneAssetBindings.locations.length ? /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-list" }, selectedSceneAssetBindings.locations.map((binding, index) => /* @__PURE__ */ import_react.default.createElement("article", { className: "scene-cast-row", key: `location-${index}` }, /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-head" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u5730\u70B9/\u73AF\u5883 ", String(index + 1).padStart(2, "0")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": `\u79FB\u9664\u7B2C ${index + 1} \u6761\u5730\u70B9/\u73AF\u5883\u7ED1\u5B9A`, className: "asset-file-remove", disabled: busy, onClick: () => removeSceneLocationBinding(index), type: "button" }, "\xD7")), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-grid" }, /* @__PURE__ */ import_react.default.createElement(SelectField, { ariaLabel: `\u9009\u62E9\u7B2C ${index + 1} \u6761\u5730\u70B9/\u73AF\u5883`, label: "\u5730\u70B9/\u73AF\u5883", disabled: busy || !locationAssets.length, onChange: (locationPath) => updateSceneLocationBinding(index, { locationPath }), options: [{ label: "\u9009\u62E9\u5730\u70B9/\u73AF\u5883", value: "" }, ...locationAssets.map((asset) => ({ label: asset.name, value: asset.rootPath }))], value: binding.locationPath }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u7528\u9014 / \u89D2\u8272", onChange: (role) => updateSceneLocationBinding(index, { role }), placeholder: "\u5982\uFF1A\u4E3B\u73AF\u5883\u3001\u8F6C\u573A\u5730\u70B9", value: binding.role }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u8D77\u59CB\u955C\u53F7", onChange: (startShotId) => updateSceneLocationBinding(index, { startShotId }), placeholder: "\u7559\u7A7A\u8868\u793A\u4ECE\u9996\u955C", value: binding.startShotId }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u7ED3\u675F\u955C\u53F7", onChange: (endShotId) => updateSceneLocationBinding(index, { endShotId }), placeholder: "\u7559\u7A7A\u8868\u793A\u5230\u5C3E\u955C", value: binding.endShotId })), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-notes" }, /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u72B6\u6001", onChange: (state) => updateSceneLocationBinding(index, { state }), placeholder: "\u5982\uFF1A\u96E8\u540E\u3001\u591C\u666F\u3001\u95E8\u6249\u5173\u95ED", value: binding.state }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u8FDE\u7EED\u6027", onChange: (continuity) => updateSceneLocationBinding(index, { continuity }), placeholder: "\u5982\uFF1A\u706B\u628A\u59CB\u7EC8\u5728\u753B\u9762\u5DE6\u4FA7", value: binding.continuity }))))) : /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-empty" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u5C1A\u672A\u7ED1\u5B9A\u5730\u70B9/\u73AF\u5883"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u4ECE\u9879\u76EE\u8D44\u4EA7\u5E93\u9009\u62E9\u672C\u573A\u9700\u8981\u7684\u7A7A\u95F4\u6216\u73AF\u5883\uFF0C\u539F\u59CB\u5730\u70B9\u8D44\u6599\u4E0D\u4F1A\u88AB\u590D\u5236\u3002"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-asset-binding-category" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-asset-binding-category-heading" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u9053\u5177"), /* @__PURE__ */ import_react.default.createElement("small", null, "\u5173\u952E\u7269\u4EF6\u3001\u7EBF\u7D22\u548C\u8FDE\u7EED\u6027\u9053\u5177")), selectedSceneAssetBindings.props.length ? /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-list" }, selectedSceneAssetBindings.props.map((binding, index) => /* @__PURE__ */ import_react.default.createElement("article", { className: "scene-cast-row", key: `prop-${index}` }, /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-head" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u9053\u5177 ", String(index + 1).padStart(2, "0")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": `\u79FB\u9664\u7B2C ${index + 1} \u6761\u9053\u5177\u7ED1\u5B9A`, className: "asset-file-remove", disabled: busy, onClick: () => removeScenePropBinding(index), type: "button" }, "\xD7")), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-grid" }, /* @__PURE__ */ import_react.default.createElement(SelectField, { ariaLabel: `\u9009\u62E9\u7B2C ${index + 1} \u6761\u9053\u5177`, label: "\u9053\u5177", disabled: busy || !propAssets.length, onChange: (propPath) => updateScenePropBinding(index, { propPath }), options: [{ label: "\u9009\u62E9\u9053\u5177", value: "" }, ...propAssets.map((asset) => ({ label: asset.name, value: asset.rootPath }))], value: binding.propPath }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u7528\u9014 / \u89D2\u8272", onChange: (role) => updateScenePropBinding(index, { role }), placeholder: "\u5982\uFF1A\u5173\u952E\u7EBF\u7D22\u3001\u89D2\u8272\u6301\u6709", value: binding.role }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u8D77\u59CB\u955C\u53F7", onChange: (startShotId) => updateScenePropBinding(index, { startShotId }), placeholder: "\u7559\u7A7A\u8868\u793A\u4ECE\u9996\u955C", value: binding.startShotId }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u7ED3\u675F\u955C\u53F7", onChange: (endShotId) => updateScenePropBinding(index, { endShotId }), placeholder: "\u7559\u7A7A\u8868\u793A\u5230\u5C3E\u955C", value: binding.endShotId })), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-notes" }, /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u72B6\u6001", onChange: (state) => updateScenePropBinding(index, { state }), placeholder: "\u5982\uFF1A\u51FA\u9798\u3001\u6CBE\u8840\u3001\u7834\u635F", value: binding.state }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u8FDE\u7EED\u6027", onChange: (continuity) => updateScenePropBinding(index, { continuity }), placeholder: "\u5982\uFF1A\u59CB\u7EC8\u7531\u53F3\u624B\u6301\u6709", value: binding.continuity }))))) : /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-empty" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u5C1A\u672A\u7ED1\u5B9A\u9053\u5177"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u53EA\u5728\u672C\u573A\u9700\u8981\u7684\u9053\u5177\u5EFA\u7ACB\u5F15\u7528\uFF0C\u907F\u514D\u4E3A\u6BCF\u4E2A\u5206\u955C\u91CD\u590D\u590D\u5236\u540C\u4E00\u4E3B\u6863\u3002"))))), selectedSourcePath ? /* @__PURE__ */ import_react.default.createElement("section", { className: "source-context-card" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "source-context-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u6765\u6E90\u4E0A\u4E0B\u6587"), /* @__PURE__ */ import_react.default.createElement("h3", null, displayFileName(selectedSourcePath)), /* @__PURE__ */ import_react.default.createElement("small", { title: selectedSourcePath }, "\u539F\u59CB\u5206\u955C\u811A\u672C")), /* @__PURE__ */ import_react.default.createElement("button", { className: "source-context-toggle", disabled: sourceContext.loading, onClick: () => void toggleSourceContext(), type: "button" }, sourceContextOpen ? "\u6536\u8D77\u539F\u6587" : sourceContext.error && sourceContext.path === selectedSourcePath ? "\u91CD\u65B0\u8BFB\u53D6" : "\u67E5\u770B\u539F\u6587")), sourceContextOpen ? /* @__PURE__ */ import_react.default.createElement("div", { className: "source-context-body" }, sourceContext.path !== selectedSourcePath || sourceContext.loading ? /* @__PURE__ */ import_react.default.createElement("p", null, "\u6B63\u5728\u8BFB\u53D6\u539F\u59CB\u5267\u672C\u2026") : sourceContext.error ? /* @__PURE__ */ import_react.default.createElement("p", { className: "source-context-error" }, sourceContext.error) : /* @__PURE__ */ import_react.default.createElement("pre", null, sourceContext.content || "\u539F\u59CB\u5267\u672C\u4E3A\u7A7A\u3002")) : null) : null, selectedAsset.scenePath ? /* @__PURE__ */ import_react.default.createElement("section", { className: "slot-section" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "section-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u6574\u573A\u5236\u4F5C\u8D44\u6599"), /* @__PURE__ */ import_react.default.createElement("h3", null, "\u573A\u6B21\u8D44\u6599\u69FD")), /* @__PURE__ */ import_react.default.createElement("span", null, "\u573A\u666F\u56FE\u3001\u7EDF\u4E00\u53C2\u8003\u3001\u9996\u5C3E\u627F\u63A5\u5E27\u4E0E\u6574\u573A\u6210\u7247\u5206\u522B\u7BA1\u7406")), /* @__PURE__ */ import_react.default.createElement("div", { className: "slot-grid scene-slot-grid" }, selectedAsset.slots.map((slot) => /* @__PURE__ */ import_react.default.createElement(SlotPanel, { confirmedFile: SELECTABLE_VISUAL_SLOTS.has(slot.key) ? selectedSlotVisual(slot) : void 0, confirmedSourcePath: SELECTABLE_VISUAL_SLOTS.has(slot.key) ? selectedSlotVisual(slot)?.path : void 0, disabled: busy, key: slot.key, onPreview: setMediaPreview, onSetConfirmed: SELECTABLE_VISUAL_SLOTS.has(slot.key) ? (file) => void handleSetWorkspaceVisualSelection(slot, file) : void 0, onTrash: (file) => void handleTrashFile(slot, file), onUpload: (files) => void handleUpload(slot, files), slot })))) : null) : /* @__PURE__ */ import_react.default.createElement("div", { className: "shot-editor" }, selectedShotMedia ? /* @__PURE__ */ import_react.default.createElement(PrimaryMedia, { file: selectedShotMedia, label: `${selectedAsset.design.shotId} ${displayShotTitle(selectedAsset)}`, onPreview: () => setMediaPreview(selectedShotMedia) }) : null, /* @__PURE__ */ import_react.default.createElement("section", { className: "editor-card shot-design-editor" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u955C\u5934\u8BBE\u8BA1\u5668"), /* @__PURE__ */ import_react.default.createElement("h3", null, selectedAsset.isDraft ? "\u5206\u955C\u8349\u7A3F \xB7 \u5C1A\u672A\u5EFA\u7ACB\u8D44\u4EA7" : "\u5236\u4F5C\u610F\u56FE")), selectedAsset.isDraft ? /* @__PURE__ */ import_react.default.createElement("button", { className: "save-button primary", disabled: busy || !selectedAsset.sourcePath, onClick: handleCreateSelectedDraft, type: "button" }, busy ? "\u5EFA\u7ACB\u4E2D\u2026" : "\u5EFA\u7ACB\u955C\u5934\u8D44\u4EA7") : /* @__PURE__ */ import_react.default.createElement("button", { className: "save-button", disabled: busy || !isDirty, onClick: () => void handleSave(), type: "button" }, busy ? "\u5904\u7406\u4E2D\u2026" : isDirty ? "\u4FDD\u5B58\u955C\u5934" : "\u5DF2\u4FDD\u5B58")), selectedAsset.isDraft ? /* @__PURE__ */ import_react.default.createElement(DraftSummary, { design: designDraft }) : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "design-grid" }, /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u65F6\u7801", onChange: (value) => setDesignDraft((draft) => ({ ...draft, timecode: value })), value: designDraft.timecode }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u65F6\u957F", onChange: (value) => setDesignDraft((draft) => ({ ...draft, duration: value })), value: designDraft.duration }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u666F\u522B / \u673A\u4F4D", onChange: (value) => setDesignDraft((draft) => ({ ...draft, framing: value })), value: designDraft.framing })), /* @__PURE__ */ import_react.default.createElement("div", { className: "design-long-fields" }, /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u753B\u9762\u63CF\u8FF0", multiline: true, onChange: (value) => setDesignDraft((draft) => ({ ...draft, content: value })), value: designDraft.content }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u53F0\u8BCD", multiline: true, onChange: (value) => setDesignDraft((draft) => ({ ...draft, dialogue: value })), value: designDraft.dialogue }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u8FD0\u955C", onChange: (value) => setDesignDraft((draft) => ({ ...draft, camera: value })), value: designDraft.camera }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u4EBA\u7269\u5907\u6CE8\uFF08\u517C\u5BB9\u65E7\u5267\u672C\uFF09", onChange: (value) => setDesignDraft((draft) => ({ ...draft, references: value })), placeholder: "\u8865\u5145\u4E0D\u80FD\u7ED3\u6784\u5316\u7684\u89D2\u8272\u63D0\u793A", value: designDraft.references })), /* @__PURE__ */ import_react.default.createElement("section", { className: "shot-character-plan" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "section-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u4EBA\u7269\u4E0E\u9020\u578B"), /* @__PURE__ */ import_react.default.createElement("h3", null, "\u672C\u955C\u5934\u5F15\u7528")), /* @__PURE__ */ import_react.default.createElement("button", { className: "studio-action-button", disabled: busy || !characterAssets.length, onClick: addShotCharacterOverride, type: "button" }, "\u6DFB\u52A0\u8986\u76D6")), /* @__PURE__ */ import_react.default.createElement("p", { className: "shot-character-plan-intro" }, "\u9ED8\u8BA4\u7EE7\u627F\u672C\u573A\u7684\u4EBA\u7269\u548C\u9020\u578B\uFF1B\u8FD9\u91CC\u4EC5\u8BB0\u5F55\u67D0\u4E2A\u955C\u5934\u7684\u6362\u88C5\u6216\u5C40\u90E8\u72B6\u6001\u4F8B\u5916\u3002"), inheritedSceneCastForSelectedShot.length ? /* @__PURE__ */ import_react.default.createElement("div", { className: "shot-inherited-cast", "aria-label": "\u7EE7\u627F\u7684\u573A\u6B21\u4EBA\u7269\u4E0E\u9020\u578B" }, inheritedSceneCastForSelectedShot.map((binding) => {
    const character = characterByPath.get(binding.characterPath);
    const look = getLookForPath(character, binding.lookPath);
    const preview = look?.confirmedVisuals.turnaround ?? look?.confirmedVisuals.costume ?? character?.confirmedVisuals.turnaround;
    return /* @__PURE__ */ import_react.default.createElement("article", { className: "shot-inherited-cast-card", key: `${binding.characterPath}-${binding.startShotId}-${binding.endShotId}` }, preview && isImage(preview) ? /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": `\u67E5\u770B${character?.name || "\u4EBA\u7269"}\u5F53\u524D\u9020\u578B`, className: "shot-inherited-cast-image", onClick: () => setMediaPreview(preview), type: "button" }, /* @__PURE__ */ import_react.default.createElement("img", { alt: `${character?.name || "\u4EBA\u7269"}\u9020\u578B\u53C2\u8003`, src: mediaUrl(preview) })) : /* @__PURE__ */ import_react.default.createElement("span", { className: "shot-inherited-cast-mark" }, "\u4EBA"), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", null, character?.name || displayFileName(binding.characterPath)), /* @__PURE__ */ import_react.default.createElement("small", null, displayLookLabel(character, binding.lookPath), " \xB7 ", formatBindingRange(binding)), binding.state ? /* @__PURE__ */ import_react.default.createElement("em", null, binding.state) : null));
  })) : /* @__PURE__ */ import_react.default.createElement("div", { className: "shot-inherited-empty" }, "\u672C\u573A\u5C1A\u672A\u8BBE\u7F6E\u9ED8\u8BA4\u4EBA\u7269\u4E0E\u9020\u578B\u3002\u53EF\u5148\u56DE\u5230\u573A\u6B21\u8D44\u6599\u5B8C\u6210\u7ED1\u5B9A\uFF0C\u6216\u5728\u8FD9\u91CC\u6DFB\u52A0\u4E00\u6B21\u6027\u8986\u76D6\u3002"), (designDraft.characterOverrides ?? []).length ? /* @__PURE__ */ import_react.default.createElement("div", { className: "shot-character-override-list" }, (designDraft.characterOverrides ?? []).map((override, index) => {
    const character = characterByPath.get(override.characterPath);
    const hasInheritedBinding = inheritedSceneCastForSelectedShot.some((binding) => binding.characterPath === override.characterPath);
    const appearanceOptions = [
      ...hasInheritedBinding ? [{ label: "\u7EE7\u627F\u573A\u6B21\u9ED8\u8BA4\u9020\u578B", value: "__inherit__" }] : [],
      { label: "\u4F7F\u7528\u8EAB\u4EFD\u57FA\u51C6", value: "__identity__" },
      ...character?.looks.map((look) => ({ label: `${look.id} \xB7 ${look.name}`, value: look.rootPath })) || []
    ];
    const appearanceValue = override.mode === "inherit" ? "__inherit__" : override.mode === "identity" ? "__identity__" : override.lookPath || "__identity__";
    return /* @__PURE__ */ import_react.default.createElement("article", { className: "shot-character-override", key: `${override.characterPath}-${index}` }, /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-head" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u955C\u5934\u8986\u76D6 ", String(index + 1).padStart(2, "0")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": `\u79FB\u9664\u7B2C ${index + 1} \u6761\u955C\u5934\u4EBA\u7269\u8986\u76D6`, className: "asset-file-remove", disabled: busy, onClick: () => removeShotCharacterOverride(index), type: "button" }, "\xD7")), /* @__PURE__ */ import_react.default.createElement("div", { className: "scene-cast-row-grid" }, /* @__PURE__ */ import_react.default.createElement(SelectField, { ariaLabel: `\u9009\u62E9\u7B2C ${index + 1} \u6761\u955C\u5934\u8986\u76D6\u4EBA\u7269`, label: "\u4EBA\u7269", disabled: busy || !characterAssets.length, onChange: (characterPath) => updateShotCharacterOverride(index, { characterPath, mode: inheritedSceneCastForSelectedShot.some((binding) => binding.characterPath === characterPath) ? "inherit" : "identity", lookPath: void 0 }), options: characterAssets.map((asset) => ({ label: `${asset.name} \xB7 ${asset.roleCategory}`, value: asset.rootPath })), value: override.characterPath }), /* @__PURE__ */ import_react.default.createElement(SelectField, { ariaLabel: `\u9009\u62E9${character?.name || "\u4EBA\u7269"}\u5728\u672C\u955C\u5934\u7684\u9020\u578B`, label: "\u672C\u955C\u5934\u9020\u578B", disabled: busy || !appearanceOptions.length, onChange: (value) => updateShotCharacterOverride(index, value === "__inherit__" ? { mode: "inherit", lookPath: void 0 } : value === "__identity__" ? { mode: "identity", lookPath: void 0 } : { mode: "look", lookPath: value }), options: appearanceOptions, value: appearanceValue }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u5C40\u90E8\u72B6\u6001", onChange: (state) => updateShotCharacterOverride(index, { state }), placeholder: "\u5982\uFF1A\u6CBE\u7070\u3001\u7709\u5FC3\u7EA2\u7EBF\u6E05\u6670", value: override.state })));
  })) : null, effectiveCastForSelectedShot.length ? /* @__PURE__ */ import_react.default.createElement("div", { className: "shot-effective-cast", "aria-label": "\u672C\u955C\u5934\u6700\u7EC8\u751F\u6548\u7684\u4EBA\u7269\u4E0E\u9020\u578B" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "shot-effective-cast-heading" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u6700\u7EC8\u751F\u6548\u7684\u4EBA\u7269\u4E0E\u9020\u578B"), /* @__PURE__ */ import_react.default.createElement("small", null, "\u5DF2\u5408\u5E76\u573A\u6B21\u9ED8\u8BA4\u4E0E\u5F53\u524D\u955C\u5934\u8986\u76D6\uFF1B\u751F\u6210\u53C2\u8003\u4EE5\u8FD9\u91CC\u4E3A\u51C6\u3002")), /* @__PURE__ */ import_react.default.createElement("div", { className: "shot-inherited-cast" }, effectiveCastForSelectedShot.map((entry) => {
    const character = characterByPath.get(entry.characterPath);
    const look = getLookForPath(character, entry.lookPath);
    const preview = look?.confirmedVisuals.turnaround ?? look?.confirmedVisuals.costume ?? character?.confirmedVisuals.turnaround ?? character?.confirmedVisuals.costume;
    return /* @__PURE__ */ import_react.default.createElement("article", { className: "shot-inherited-cast-card", key: `effective-${entry.characterPath}` }, preview && isImage(preview) ? /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": `\u67E5\u770B${character?.name || "\u4EBA\u7269"}\u6700\u7EC8\u751F\u6548\u9020\u578B`, className: "shot-inherited-cast-image", onClick: () => setMediaPreview(preview), type: "button" }, /* @__PURE__ */ import_react.default.createElement("img", { alt: `${character?.name || "\u4EBA\u7269"}\u6700\u7EC8\u751F\u6548\u9020\u578B`, src: mediaUrl(preview) })) : /* @__PURE__ */ import_react.default.createElement("span", { className: "shot-inherited-cast-mark" }, "\u4EBA"), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("strong", null, character?.name || displayFileName(entry.characterPath)), /* @__PURE__ */ import_react.default.createElement("small", null, displayLookLabel(character, entry.lookPath), " \xB7 ", entry.sourceLabel), entry.state ? /* @__PURE__ */ import_react.default.createElement("em", null, entry.state) : entry.continuity ? /* @__PURE__ */ import_react.default.createElement("em", null, entry.continuity) : null));
  }))) : null), /* @__PURE__ */ import_react.default.createElement("details", { className: "generation-settings" }, /* @__PURE__ */ import_react.default.createElement("summary", null, /* @__PURE__ */ import_react.default.createElement("span", null, "\u751F\u6210\u8BBE\u7F6E"), /* @__PURE__ */ import_react.default.createElement("small", null, "\u63D0\u793A\u8BCD\u3001\u8D1F\u9762\u63D0\u793A\u8BCD\u548C\u72B6\u6001")), /* @__PURE__ */ import_react.default.createElement("div", { className: "generation-settings-fields" }, /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u72B6\u6001", onChange: (value) => setDesignDraft((draft) => ({ ...draft, status: value })), value: designDraft.status }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u63D0\u793A\u8BCD", multiline: true, onChange: (value) => setDesignDraft((draft) => ({ ...draft, prompt: value })), value: designDraft.prompt }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u8D1F\u9762\u63D0\u793A\u8BCD", multiline: true, onChange: (value) => setDesignDraft((draft) => ({ ...draft, negativePrompt: value })), value: designDraft.negativePrompt }))), /* @__PURE__ */ import_react.default.createElement("p", { className: "editor-hint" }, "\u573A\u6B21\u548C\u955C\u53F7\u56FA\u5B9A\uFF1B\u5982\u9700\u6539\u6807\u9898\uFF0C\u8BF7\u4F7F\u7528\u53F3\u4E0A\u89D2\u201C\u91CD\u547D\u540D\u201D\u3002"))), selectedSourcePath ? /* @__PURE__ */ import_react.default.createElement("section", { className: "source-context-card" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "source-context-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u6765\u6E90\u4E0A\u4E0B\u6587"), /* @__PURE__ */ import_react.default.createElement("h3", null, displayFileName(selectedSourcePath)), /* @__PURE__ */ import_react.default.createElement("small", { title: selectedSourcePath }, "\u539F\u59CB\u5206\u955C\u811A\u672C")), /* @__PURE__ */ import_react.default.createElement("button", { className: "source-context-toggle", disabled: sourceContext.loading, onClick: () => void toggleSourceContext(), type: "button" }, sourceContextOpen ? "\u6536\u8D77\u539F\u6587" : sourceContext.error && sourceContext.path === selectedSourcePath ? "\u91CD\u65B0\u8BFB\u53D6" : "\u67E5\u770B\u539F\u6587")), sourceContextOpen ? /* @__PURE__ */ import_react.default.createElement("div", { className: "source-context-body" }, sourceContext.path !== selectedSourcePath || sourceContext.loading ? /* @__PURE__ */ import_react.default.createElement("p", null, "\u6B63\u5728\u8BFB\u53D6\u539F\u59CB\u5267\u672C\u2026") : sourceContext.error ? /* @__PURE__ */ import_react.default.createElement("p", { className: "source-context-error" }, sourceContext.error) : /* @__PURE__ */ import_react.default.createElement("pre", null, sourceContext.content || "\u539F\u59CB\u5267\u672C\u4E3A\u7A7A\u3002")) : null) : null, selectedAsset.isDraft ? /* @__PURE__ */ import_react.default.createElement("section", { className: "draft-asset-note" }, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u4E0B\u4E00\u6B65"), /* @__PURE__ */ import_react.default.createElement("p", null, "\u5EFA\u7ACB\u955C\u5934\u8D44\u4EA7\u540E\uFF0C\u53EF\u6DFB\u52A0\u53C2\u8003\u56FE\u3001\u9996\u5E27\u3001\u5C3E\u5E27\u548C\u5019\u9009\u8D44\u6599\u3002")) : /* @__PURE__ */ import_react.default.createElement("section", { className: "slot-section" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "section-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u5236\u4F5C\u8D44\u6599"), /* @__PURE__ */ import_react.default.createElement("h3", null, "\u955C\u5934\u8D44\u6599\u69FD")), /* @__PURE__ */ import_react.default.createElement("span", null, "\u9996\u5E27\u3001\u5C3E\u5E27\u548C\u5019\u9009\u5206\u522B\u7BA1\u7406")), /* @__PURE__ */ import_react.default.createElement("div", { className: "slot-grid shot-slots" }, selectedAsset.slots.map((slot) => /* @__PURE__ */ import_react.default.createElement(SlotPanel, { confirmedFile: SELECTABLE_VISUAL_SLOTS.has(slot.key) ? selectedSlotVisual(slot) : void 0, confirmedSourcePath: SELECTABLE_VISUAL_SLOTS.has(slot.key) ? selectedSlotVisual(slot)?.path : void 0, disabled: busy, key: slot.key, onPreview: setMediaPreview, onSetConfirmed: SELECTABLE_VISUAL_SLOTS.has(slot.key) ? (file) => void handleSetWorkspaceVisualSelection(slot, file) : void 0, onTrash: (file) => void handleTrashFile(slot, file), onUpload: (files) => void handleUpload(slot, files), slot }))))))), mediaPreview ? /* @__PURE__ */ import_react.default.createElement(MediaLightbox, { file: mediaPreview, onClose: () => setMediaPreview(null) }) : null, /* @__PURE__ */ import_react.default.createElement(
    ProjectStructureViewer,
    {
      error: projectStructureError,
      expandedPaths: expandedStructurePaths,
      hideTrigger: externalStructureTrigger,
      loading: projectStructureLoading,
      onRefresh: refreshProjectStructure,
      onTogglePath: toggleStructurePath,
      open: structureOpen,
      setOpen: setStructureOpen,
      structure: projectStructure
    }
  ), modal === "generation" && selectedAsset ? /* @__PURE__ */ import_react.default.createElement(
    GenerationModal,
    {
      asset: selectedAsset,
      lookPath: selectedAsset.type === "character" ? selectedCharacterLook?.rootPath : void 0,
      projectId: projectId ?? void 0,
      onClose: () => setModal(null),
      onJobsObserved: handleGenerationJobsObserved,
      onQueued: handleGenerationQueued
    }
  ) : modal === "trashList" ? /* @__PURE__ */ import_react.default.createElement(
    TrashModal,
    {
      busy,
      entries: trashEntries,
      error: trashError,
      loading: trashLoading,
      onClose: () => setModal(null),
      onRefresh: () => void loadTrashEntries(),
      onRestore: (entry) => void handleRestoreTrashEntry(entry)
    }
  ) : modal ? /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-backdrop", onMouseDown: (event) => {
    if (event.target === event.currentTarget) setModal(null);
  } }, /* @__PURE__ */ import_react.default.createElement("section", { "aria-labelledby": "asset-modal-title", "aria-modal": "true", className: "modal-card asset-modal", role: "dialog" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u8D44\u4EA7\u64CD\u4F5C"), /* @__PURE__ */ import_react.default.createElement("h2", { id: "asset-modal-title" }, modal === "projectSettings" ? "\u9879\u76EE\u8BBE\u5B9A" : modal === "character" ? "\u65B0\u5EFA\u4EBA\u7269\u8D44\u4EA7" : modal === "location" ? "\u65B0\u5EFA\u5730\u70B9/\u73AF\u5883\u8D44\u4EA7" : modal === "prop" ? "\u65B0\u5EFA\u9053\u5177\u8D44\u4EA7" : modal === "look" ? "\u65B0\u5EFA\u4EBA\u7269\u9020\u578B" : modal === "scene" ? "\u65B0\u5EFA\u573A\u6B21\u8D44\u4EA7" : modal === "shot" ? "\u65B0\u5EFA\u955C\u5934\u8D44\u4EA7" : modal === "import" ? "\u5BFC\u5165\u5267\u672C" : modal === "rename" ? "\u91CD\u547D\u540D\u8D44\u4EA7" : "\u79FB\u5165\u56DE\u6536\u7AD9")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-label": "\u5173\u95ED", className: "icon-button", onClick: () => setModal(null), type: "button" }, "\xD7")), modal === "projectSettings" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-copy" }, "\u7EF4\u62A4\u5F53\u524D\u9879\u76EE\u7684\u6545\u4E8B\u7B80\u4ECB\u3001\u5236\u4F5C\u89C4\u8303\u548C\u4EA4\u4ED8\u8981\u6C42\uFF0C\u5185\u5BB9\u4F1A\u4FDD\u5B58\u5230\u9879\u76EE\u6839\u76EE\u5F55\u7684\u201C\u9879\u76EE\u8BBE\u5B9A.md\u201D\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card project-settings-editor" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "editor-card-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u9879\u76EE\u7EA7\u6587\u6863"), /* @__PURE__ */ import_react.default.createElement("h3", null, "\u9879\u76EE\u8BBE\u5B9A.md")), /* @__PURE__ */ import_react.default.createElement("button", { "aria-pressed": projectSettingsMode === "edit", className: "editor-mode-button", onClick: () => setProjectSettingsMode((mode) => mode === "preview" ? "edit" : "preview"), type: "button" }, projectSettingsMode === "preview" ? "\u7F16\u8F91" : "\u9884\u89C8")), projectSettingsMode === "preview" ? /* @__PURE__ */ import_react.default.createElement(ProfilePreview, { content: projectSettingsDraft }) : /* @__PURE__ */ import_react.default.createElement("textarea", { "aria-label": "\u9879\u76EE\u8BBE\u5B9A", className: "profile-textarea", onChange: (event) => {
    setProjectSettingsDraft(event.target.value);
    setProjectSettingsMode("edit");
  }, placeholder: "\u8865\u5145\u6545\u4E8B\u7B80\u4ECB\u3001\u4E16\u754C\u89C2\u3001\u753B\u9762\u98CE\u683C\u3001\u753B\u5E45\u548C\u4EA4\u4ED8\u8981\u6C42\u2026", value: projectSettingsDraft })), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: () => setModal(null), type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: busy || !hasUnsavedProjectSettingsDraft, onClick: () => void handleSaveProjectSettings(), type: "button" }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u9879\u76EE\u8BBE\u5B9A"))) : modal === "character" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-copy" }, "\u5EFA\u7ACB\u540E\u4F1A\u81EA\u52A8\u51C6\u5907\u89D2\u8272\u8BBE\u5B9A\u3001\u4E09\u89C6\u56FE\u3001\u5B9A\u5986\u548C\u53C2\u8003\u56FE\u8D44\u6599\u69FD\u3002"), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u4EBA\u7269\u540D\u79F0", onChange: setNewName, placeholder: "\u4F8B\u5982\uFF1A\u987E\u9716", value: newName }), /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-field-hint" }, "\u4EBA\u7269\u5206\u7C7B\u4F1A\u4ECE\u65B0\u5EFA\u7684\u201C\u89D2\u8272\u8BBE\u5B9A.md\u201D\u4E2D\u8BFB\u53D6\uFF0C\u5EFA\u7ACB\u540E\u5728\u6587\u6863\u91CC\u586B\u5199\u201C\u89D2\u8272\u5206\u7C7B\u201D\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: () => setModal(null), type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: busy || !newName.trim(), onClick: () => void handleCreateCharacter(), type: "button" }, "\u5EFA\u7ACB\u4EBA\u7269"))) : modal === "location" || modal === "prop" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-copy" }, modal === "location" ? "\u5EFA\u7ACB\u540E\u4F1A\u81EA\u52A8\u51C6\u5907\u5730\u70B9/\u73AF\u5883\u8BBE\u5B9A\u3001\u5730\u70B9\u56FE\u3001\u53C2\u8003\u56FE\u3001\u5019\u9009\u548C\u5B9A\u7A3F\u8D44\u6599\u69FD\u3002" : "\u5EFA\u7ACB\u540E\u4F1A\u81EA\u52A8\u51C6\u5907\u9053\u5177\u8BBE\u5B9A\u3001\u53C2\u8003\u56FE\u3001\u5019\u9009\u548C\u5B9A\u7A3F\u8D44\u6599\u69FD\u3002"), /* @__PURE__ */ import_react.default.createElement(TextField, { label: modal === "location" ? "\u5730\u70B9/\u73AF\u5883\u540D\u79F0" : "\u9053\u5177\u540D\u79F0", onChange: setNewSimpleAssetName, placeholder: modal === "location" ? "\u4F8B\u5982\uFF1A\u5E9F\u5F03\u8F66\u7AD9\u6708\u53F0" : "\u4F8B\u5982\uFF1A\u9752\u94DC\u77ED\u5251", value: newSimpleAssetName }), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: () => setModal(null), type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: busy || !newSimpleAssetName.trim(), onClick: () => void handleCreateSimpleAsset(modal), type: "button" }, "\u5EFA\u7ACB\u8D44\u4EA7"))) : modal === "look" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-copy" }, "\u65B0\u9020\u578B\u4F1A\u5EFA\u7ACB\u72EC\u7ACB\u7684\u4E09\u89C6\u56FE\u3001\u5B9A\u5986\u3001\u53C2\u8003\u56FE\u548C\u201C\u9020\u578B\u8BBE\u5B9A.md\u201D\u3002\u5B83\u4E0D\u4F1A\u590D\u5236\u6216\u79FB\u52A8\u4EBA\u7269\u5DF2\u6709\u8D44\u6599\u3002"), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u9020\u578B\u540D\u79F0", onChange: setNewLookName, placeholder: "\u4F8B\u5982\uFF1A\u8FB9\u5173\u9ED1\u8863\u50E7", value: newLookName }), /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-field-hint" }, "\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u5206\u914D\u7A33\u5B9A\u7F16\u53F7\uFF0C\u4F8B\u5982 LOOK-001\uFF1B\u4EE5\u540E\u573A\u6B21\u548C\u955C\u5934\u4F1A\u5F15\u7528\u8FD9\u4E2A\u9020\u578B\uFF0C\u800C\u4E0D\u662F\u590D\u5236\u56FE\u7247\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: () => setModal(null), type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: busy || !newLookName.trim(), onClick: () => void handleCreateCharacterLook(), type: "button" }, "\u5EFA\u7ACB\u9020\u578B"))) : modal === "scene" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-copy" }, "\u4E00\u4E2A\u573A\u6B21\u5C31\u662F\u4E00\u4E2A\u5927\u5206\u955C\u6587\u4EF6\u5939\u3002\u5EFA\u7ACB\u540E\u53EF\u5148\u4E0A\u4F20\u573A\u666F\u56FE\u3001\u53C2\u8003\u56FE\u3001\u9996\u5C3E\u5E27\u3001\u5019\u9009\u3001\u5B9A\u7A3F\u548C\u6574\u573A\u6210\u7247\u3002"), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u573A\u6B21\u7F16\u53F7", onChange: setNewSceneId, placeholder: "\u4F8B\u5982\uFF1AEP001-SC001", value: newSceneId }), /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-field-hint" }, "\u573A\u6B21\u7F16\u53F7\u662F\u5176\u4E0B\u955C\u5934\u7684\u7A33\u5B9A\u8EAB\u4EFD\uFF1B\u5EFA\u7ACB\u540E\u4E0D\u80FD\u5728\u5DE5\u4F5C\u53F0\u5185\u76F4\u63A5\u6539\u540D\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: () => setModal(null), type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: busy || !newSceneId.trim(), onClick: () => void handleCreateScene(), type: "button" }, "\u5EFA\u7ACB\u573A\u6B21"))) : modal === "shot" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-copy" }, "\u955C\u5934\u4F1A\u5F52\u5165\u5BF9\u5E94\u573A\u6B21\u6587\u4EF6\u5939\uFF1B\u5982\u679C\u8BE5\u573A\u6B21\u8FD8\u4E0D\u5B58\u5728\uFF0C\u7CFB\u7EDF\u4F1A\u5148\u5B89\u5168\u5EFA\u7ACB\u5B83\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { className: "field-grid" }, /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u573A\u6B21", onChange: (sceneId) => {
    setNewSceneId(sceneId);
    setNewShotId(suggestNextShotId(sceneGroups.find((scene) => scene.sceneId === sceneId)?.shots || []));
  }, value: newSceneId }), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u955C\u53F7", onChange: setNewShotId, value: newShotId })), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u955C\u5934\u6807\u9898", onChange: setNewShotTitle, placeholder: "\u4F8B\u5982\uFF1A\u7126\u571F\u5C3D\u5934", value: newShotTitle }), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: () => setModal(null), type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: busy || !newSceneId.trim() || !newShotId.trim() || !newShotTitle.trim(), onClick: () => void handleCreateShot(), type: "button" }, "\u5EFA\u7ACB\u955C\u5934"))) : modal === "import" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-copy" }, "\u4ECE\u5F53\u524D\u573A\u6B21\u7684\u5206\u955C\u811A\u672C\u5EFA\u7ACB\u955C\u5934\u8D44\u4EA7\u3002\u5BFC\u5165\u4F1A\u4FDD\u7559\u539F\u59CB\u8BF4\u660E\uFF0C\u5E76\u81EA\u52A8\u8DF3\u8FC7\u5DF2\u6709\u955C\u53F7\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { className: "storyboard-import-layout" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "import-source-list", "aria-label": "\u5267\u672C\u6765\u6E90" }, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u9009\u62E9\u5267\u672C"), activeDraftGroups.map((group) => /* @__PURE__ */ import_react.default.createElement("button", { className: group.sourcePath === importSourcePath ? "is-active" : "", key: group.sourcePath, onClick: () => chooseImportSource(group.sourcePath), type: "button" }, /* @__PURE__ */ import_react.default.createElement("span", null, displayFileName(group.sourcePath)), /* @__PURE__ */ import_react.default.createElement("b", null, group.shots.length, " \u955C\u5934")))), /* @__PURE__ */ import_react.default.createElement("div", { className: "import-shot-list" }, selectedImportGroup ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "import-shot-list-heading" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("p", { className: "eyebrow" }, "\u5F85\u5EFA\u7ACB\u955C\u5934"), /* @__PURE__ */ import_react.default.createElement("h3", null, displayFileName(selectedImportGroup.sourcePath))), /* @__PURE__ */ import_react.default.createElement("label", { className: "import-select-all" }, /* @__PURE__ */ import_react.default.createElement("input", { checked: selectedImportGroup.shots.length > 0 && selectedImportGroup.shots.every((shot) => importShotIds.includes(storyboardImportSelector(shot))), onChange: toggleAllImportShots, type: "checkbox" }), "\u5168\u9009")), /* @__PURE__ */ import_react.default.createElement("div", { className: "import-shot-options" }, selectedImportGroup.shots.map((shot) => {
    const selector = storyboardImportSelector(shot);
    return /* @__PURE__ */ import_react.default.createElement("label", { className: "import-shot-option", key: selector }, /* @__PURE__ */ import_react.default.createElement("input", { checked: importShotIds.includes(selector), onChange: () => toggleImportShot(selector), type: "checkbox" }), /* @__PURE__ */ import_react.default.createElement("span", { className: "import-shot-id" }, shot.design.shotId), /* @__PURE__ */ import_react.default.createElement("span", { className: "import-shot-title" }, displayShotTitle(shot)), /* @__PURE__ */ import_react.default.createElement("small", null, shot.design.timecode || "\u672A\u8BBE\u65F6\u7801", " \xB7 ", shot.design.duration || "\u672A\u8BBE\u65F6\u957F"));
  }))) : /* @__PURE__ */ import_react.default.createElement("p", { className: "import-empty" }, "\u6CA1\u6709\u53EF\u5BFC\u5165\u7684\u5267\u672C\u8349\u7A3F\u3002"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: () => setModal(null), type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: busy || !importSourcePath || !importShotIds.length, onClick: () => {
    if (importSourcePath) void handleImportStoryboard(importSourcePath, importShotIds);
  }, type: "button" }, "\u5EFA\u7ACB ", importShotIds.length, " \u4E2A\u955C\u5934"))) : modal === "rename" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("p", { className: "modal-copy" }, "\u53EA\u6539\u53D8\u5F53\u524D\u8D44\u4EA7\u540D\u79F0\uFF0C\u4E0D\u4F1A\u6539\u53D8\u5B83\u6240\u5C5E\u7684\u521B\u4F5C\u5BF9\u8C61\u7C7B\u578B\u3002"), /* @__PURE__ */ import_react.default.createElement(TextField, { label: "\u65B0\u540D\u79F0", onChange: setRenameValue, value: renameValue }), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: () => setModal(null), type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button", disabled: busy || !renameValue.trim(), onClick: () => void handleRename(), type: "button" }, "\u786E\u8BA4\u91CD\u547D\u540D"))) : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "trash-warning" }, /* @__PURE__ */ import_react.default.createElement("span", null, "!"), /* @__PURE__ */ import_react.default.createElement("p", null, /* @__PURE__ */ import_react.default.createElement("b", null, "\u786E\u8BA4\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F"), /* @__PURE__ */ import_react.default.createElement("br", null), "\u6574\u4E2A\u8D44\u4EA7\u4F1A\u88AB\u79FB\u52A8\u5230\u672C\u5730\u56DE\u6536\u7AD9\uFF0C\u4E4B\u540E\u4ECD\u53EF\u6062\u590D\u3002")), /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-button", onClick: () => setModal(null), type: "button" }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement("button", { className: "submit-button destructive", disabled: busy, onClick: () => void handleTrashAsset(), type: "button" }, "\u79FB\u5165\u56DE\u6536\u7AD9"))))) : null);
}

// src/original-workbench.css
var original_workbench_default = ':root {\n  --paper: #ffffff;\n  --ash: #f8f8f6;\n  --ink: #20201d;\n  --ink-72: rgba(32, 32, 29, 0.72);\n  --ink-48: rgba(32, 32, 29, 0.48);\n  --ink-14: rgba(32, 32, 29, 0.14);\n  --ink-8: rgba(32, 32, 29, 0.08);\n  --ink-hover: var(--ink);\n  --ink-soft: var(--ash);\n  --canvas: var(--paper);\n  --surface: var(--paper);\n  --surface-subtle: var(--ash);\n  --surface-hover: var(--ash);\n  --surface-selected: var(--ash);\n  --text: var(--ink);\n  --text-secondary: var(--ink-72);\n  --text-muted: var(--ink-48);\n  --border: var(--ink-14);\n  --border-strong: var(--ink-48);\n  --danger: var(--ink-72);\n  --danger-soft: var(--ash);\n  --focus: rgba(32, 32, 29, 0.18);\n  --radius-sm: 5px;\n  --radius-md: 7px;\n  --radius-lg: 8px;\n  --sans: "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;\n  --mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;\n}\n\n* {\n  box-sizing: border-box;\n}\n\nhtml {\n  background: var(--canvas);\n  color-scheme: light;\n}\n\nbody {\n  background: var(--canvas);\n  color: var(--text);\n  font-family: var(--sans);\n  font-size: 14px;\n  line-height: 1.5;\n  margin: 0;\n  min-width: 320px;\n  -webkit-font-smoothing: antialiased;\n}\n\n/* Keep native control accents within the ink palette. */\n::selection {\n  background: var(--ink);\n  color: var(--paper);\n}\n\ninput[type="checkbox"],\ninput[type="radio"] {\n  accent-color: var(--ink);\n}\n\nbutton,\ninput,\nselect,\ntextarea {\n  font: inherit;\n}\n\nbutton {\n  border: 0;\n  cursor: pointer;\n}\n\nbutton:disabled,\ninput:disabled,\nselect:disabled,\ntextarea:disabled {\n  cursor: not-allowed;\n  opacity: 0.55;\n}\n\nbutton:focus-visible,\ninput:focus-visible,\nselect:focus-visible,\ntextarea:focus-visible,\nsummary:focus-visible {\n  outline: 2px solid var(--focus);\n  outline-offset: 1px;\n}\n\n.workbench-shell {\n  min-height: 100vh;\n}\n\n.topbar {\n  align-items: center;\n  background: var(--surface);\n  border-bottom: 1px solid var(--border);\n  display: grid;\n  gap: 18px;\n  grid-template-columns: minmax(220px, 1fr) auto minmax(220px, 1fr);\n  height: 60px;\n  padding: 0 18px;\n  position: sticky;\n  top: 0;\n  z-index: 50;\n}\n\n.brand-lockup,\n.topbar-center,\n.topbar-actions,\n.asset-studio-actions,\n.editor-card-heading,\n.editor-card-heading-actions,\n.asset-slot-heading,\n.section-heading,\n.modal-heading,\n.modal-actions,\n.source-context-heading,\n.import-shot-list-heading,\n.media-lightbox-head {\n  align-items: center;\n  display: flex;\n}\n\n.brand-lockup {\n  gap: 9px;\n  min-width: 0;\n}\n\n.brand-sigil {\n  align-items: flex-end;\n  background: var(--text);\n  border: 0;\n  border-radius: 6px;\n  display: flex;\n  flex: 0 0 30px;\n  gap: 2px;\n  height: 30px;\n  justify-content: center;\n  overflow: hidden;\n  padding-bottom: 5px;\n  position: relative;\n}\n\n.brand-sigil::before {\n  display: none;\n}\n\n.brand-sigil i {\n  background: var(--paper);\n  display: block;\n  height: 7px;\n  transform: skewY(-20deg);\n  width: 3px;\n}\n\n.brand-sigil i:nth-child(2) {\n  height: 12px;\n}\n\n.brand-sigil i:nth-child(3) {\n  height: 17px;\n}\n\n.brand-name,\n.brand-subtitle,\n.eyebrow,\n.asset-breadcrumb,\n.studio-context,\n.editor-hint,\n.modal-copy {\n  margin: 0;\n}\n\n.brand-name {\n  font-size: 15px;\n  font-weight: 650;\n  line-height: 1.15;\n}\n\n.brand-subtitle {\n  color: var(--text-muted);\n  font-size: 11px;\n  margin-top: 1px;\n}\n\n.topbar-center {\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  color: var(--text-muted);\n  font-size: 12px;\n  gap: 7px;\n  height: 30px;\n  justify-content: center;\n  min-width: 0;\n  padding: 0 10px;\n}\n\n.topbar-center strong {\n  color: var(--text);\n  font-weight: 600;\n  max-width: 260px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.status-dot {\n  background: var(--ink);\n  border-radius: 50%;\n  height: 7px;\n  width: 7px;\n}\n\n.topbar-actions {\n  justify-content: flex-end;\n}\n\n.refresh-button,\n.studio-action-button,\n.save-button,\n.source-context-toggle,\n.text-button,\n.submit-button,\n.icon-button,\n.slot-upload-button,\n.asset-primary-open,\n.media-lightbox-close {\n  align-items: center;\n  border-radius: var(--radius-sm);\n  display: inline-flex;\n  justify-content: center;\n  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;\n}\n\n.refresh-button {\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  color: var(--text-secondary);\n  font-size: 12px;\n  gap: 4px;\n  height: 30px;\n  padding: 0 9px;\n}\n\n.refresh-button:hover:not(:disabled) {\n  background: var(--surface-hover);\n  color: var(--text);\n}\n\n.refresh-button > span {\n  font-size: 14px;\n  line-height: 1;\n}\n\n.notice {\n  align-items: center;\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  box-shadow: 0 4px 12px var(--ink-8);\n  display: flex;\n  font-size: 12px;\n  gap: 8px;\n  max-width: min(420px, calc(100vw - 24px));\n  min-height: 40px;\n  padding: 8px 9px 8px 11px;\n  position: fixed;\n  right: 12px;\n  top: 62px;\n  z-index: 300;\n}\n\n.notice > span {\n  align-items: center;\n  background: var(--ink-soft);\n  border-radius: 50%;\n  color: var(--ink);\n  display: inline-flex;\n  flex: 0 0 20px;\n  font-size: 11px;\n  font-weight: 700;\n  height: 20px;\n  justify-content: center;\n}\n\n.notice > button {\n  background: transparent;\n  color: var(--text-muted);\n  font-size: 16px;\n  margin-left: auto;\n  padding: 2px 4px;\n}\n\n.notice > button:hover {\n  color: var(--text);\n}\n\n.asset-workspace-grid {\n  display: grid;\n  grid-template-columns: 248px minmax(0, 1fr);\n  min-height: calc(100vh - 60px);\n}\n\n.asset-library-rail {\n  background: var(--surface);\n  border-right: 1px solid var(--border);\n  display: flex;\n  flex-direction: column;\n  height: calc(100vh - 60px);\n  min-width: 0;\n  padding: 18px 12px 12px;\n  position: sticky;\n  top: 60px;\n}\n\n.asset-rail-heading {\n  padding: 0 7px 12px;\n}\n\n.eyebrow {\n  color: var(--text-muted);\n  font-size: 11px;\n  font-weight: 600;\n  letter-spacing: 0.03em;\n}\n\n.asset-rail-heading h1 {\n  font-size: 21px;\n  font-weight: 650;\n  letter-spacing: -0.03em;\n  line-height: 1.2;\n  margin: 3px 0 0;\n}\n\n.asset-tabs {\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  display: grid;\n  gap: 2px;\n  grid-template-columns: 1fr 1fr;\n  padding: 2px;\n}\n\n.asset-tabs button.is-primary-tab {\n  border-color: var(--ink);\n  font-weight: 700;\n  order: -1;\n}\n\n.asset-reference-count {\n  color: var(--text-muted);\n  font-size: 10px;\n}\n\n.asset-tabs button {\n  align-items: center;\n  background: transparent;\n  border-radius: 5px;\n  color: var(--text-secondary);\n  display: flex;\n  font-size: 13px;\n  height: 32px;\n  justify-content: space-between;\n  padding: 0 8px;\n}\n\n.asset-tabs button:hover {\n  color: var(--text);\n}\n\n.asset-tabs button.is-active {\n  background: var(--surface);\n  box-shadow: 0 1px 2px var(--ink-8);\n  color: var(--text);\n  font-weight: 650;\n}\n\n.asset-tabs button b {\n  color: var(--text-muted);\n  font-size: 10px;\n  font-weight: 600;\n}\n\n.asset-tabs button.is-active b {\n  color: var(--ink);\n}\n\n.scene-scope {\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  display: grid;\n  gap: 5px;\n  margin-top: 10px;\n  padding: 9px;\n}\n\n.scene-picker {\n  color: var(--text-muted);\n  display: grid;\n  font-size: 11px;\n  font-weight: 600;\n  gap: 4px;\n}\n\n.scene-picker select {\n  appearance: none;\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  border-radius: var(--radius-sm);\n  color: var(--text);\n  font-size: 12px;\n  height: 34px;\n  outline: 0;\n  padding: 0 26px 0 8px;\n  text-overflow: ellipsis;\n  width: 100%;\n}\n\n.scene-scope small {\n  color: var(--text-muted);\n  font-size: 10px;\n}\n\n.asset-list-tools {\n  align-items: center;\n  display: flex;\n  gap: 6px;\n  margin: 11px 0 8px;\n}\n\n.asset-search {\n  align-items: center;\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  border-radius: var(--radius-sm);\n  color: var(--text-muted);\n  display: flex;\n  flex: 1;\n  gap: 5px;\n  height: 34px;\n  min-width: 0;\n  padding: 0 8px;\n}\n\n.asset-search:focus-within {\n  border-color: var(--ink);\n  box-shadow: 0 0 0 2px var(--focus);\n}\n\n.asset-search > span {\n  font-size: 15px;\n  line-height: 1;\n}\n\n.asset-search input {\n  background: transparent;\n  border: 0;\n  color: var(--text);\n  font-size: 12px;\n  min-width: 0;\n  outline: 0;\n  padding: 0;\n  width: 100%;\n}\n\n.asset-search input::placeholder {\n  color: var(--text-muted);\n}\n\n.asset-search-clear {\n  align-items: center;\n  background: transparent;\n  border-radius: 4px;\n  color: var(--text-muted);\n  display: inline-flex;\n  flex: 0 0 20px;\n  font-size: 15px;\n  height: 20px;\n  justify-content: center;\n  padding: 0;\n}\n\n.asset-search-clear:hover {\n  background: var(--surface-hover);\n  color: var(--text);\n}\n\n.add-asset-button {\n  align-items: center;\n  background: var(--ink);\n  border-radius: var(--radius-sm);\n  color: var(--paper);\n  display: inline-flex;\n  flex: 0 0 auto;\n  font-size: 12px;\n  gap: 3px;\n  height: 34px;\n  justify-content: center;\n  min-width: 62px;\n  padding: 0 9px;\n}\n\n.add-asset-button:hover {\n  background: var(--ink-hover);\n}\n\n.add-asset-button span {\n  font-size: 15px;\n}\n\n.import-storyboard-button {\n  align-items: center;\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  border-radius: var(--radius-sm);\n  color: var(--text-secondary);\n  display: flex;\n  font-size: 11px;\n  gap: 5px;\n  height: 34px;\n  justify-content: flex-start;\n  margin-bottom: 7px;\n  padding: 0 9px;\n  width: 100%;\n}\n\n.import-storyboard-button:hover:not(:disabled) {\n  background: var(--surface-hover);\n  border-color: var(--ink);\n  color: var(--ink);\n}\n\n.import-storyboard-button > span {\n  color: var(--ink);\n  font-size: 14px;\n}\n\n.import-storyboard-button b {\n  color: var(--ink);\n  font-size: 10px;\n  margin-left: auto;\n}\n\n.asset-list-heading {\n  align-items: center;\n  color: var(--text-secondary);\n  display: flex;\n  font-size: 12px;\n  font-weight: 600;\n  justify-content: space-between;\n  margin: 10px 7px 5px;\n}\n\n.asset-list-heading small {\n  color: var(--text-muted);\n  font-size: 10px;\n  font-weight: 400;\n}\n\n.asset-card-list {\n  align-content: start;\n  display: grid;\n  flex: 1;\n  gap: 2px;\n  grid-auto-rows: max-content;\n  min-height: 0;\n  overflow: auto;\n  padding: 1px 0 10px;\n  scrollbar-color: var(--border-strong) transparent;\n  scrollbar-width: thin;\n}\n\n.asset-card {\n  align-items: center;\n  background: transparent;\n  border: 1px solid transparent;\n  border-radius: var(--radius-sm);\n  color: var(--text);\n  display: flex;\n  gap: 8px;\n  min-width: 0;\n  padding: 7px 8px;\n  position: relative;\n  text-align: left;\n  width: 100%;\n}\n\n.asset-card:hover {\n  background: var(--surface-hover);\n}\n\n.asset-card.is-active {\n  background: var(--surface-selected);\n  border-color: var(--ink-14);\n}\n\n.asset-card.is-active::before {\n  background: var(--ink);\n  border-radius: 0 2px 2px 0;\n  bottom: 5px;\n  content: "";\n  left: -1px;\n  position: absolute;\n  top: 5px;\n  width: 2px;\n}\n\n.character-list-item {\n  min-height: 52px;\n}\n\n.asset-card-cover {\n  align-items: center;\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  display: flex;\n  flex: 0 0 36px;\n  height: 36px;\n  justify-content: center;\n  overflow: hidden;\n}\n\n.character-avatar-letter {\n  color: var(--ink);\n  font-size: 15px;\n  font-weight: 650;\n}\n\n.asset-thumb {\n  display: block;\n  height: 100%;\n  object-fit: cover;\n  width: 100%;\n}\n\n.asset-placeholder-mark {\n  color: var(--text-muted);\n  font-size: 17px;\n}\n\n.asset-file-mark {\n  color: var(--text-secondary);\n  font-size: 8px;\n  font-weight: 650;\n}\n\n.asset-card-copy,\n.shot-list-copy {\n  display: grid;\n  gap: 1px;\n  min-width: 0;\n}\n\n.asset-card-copy strong,\n.asset-card-copy small,\n.shot-list-copy strong,\n.shot-list-copy small {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.asset-card-copy strong {\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.asset-card-copy small,\n.shot-list-copy small {\n  color: var(--text-muted);\n  font-size: 11px;\n}\n\n.asset-card-copy .character-role-label {\n  align-self: start;\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: 999px;\n  color: var(--text-secondary);\n  font-size: 10px;\n  line-height: 18px;\n  overflow: visible;\n  padding: 0 6px;\n  text-overflow: clip;\n  width: max-content;\n}\n\n.shot-list-item {\n  display: grid;\n  gap: 7px;\n  grid-template-columns: 45px minmax(0, 1fr) auto;\n  min-height: 43px;\n}\n\n.shot-list-id {\n  color: var(--ink);\n  font-family: var(--mono);\n  font-size: 10px;\n  font-weight: 650;\n}\n\n.shot-list-copy strong {\n  font-size: 12px;\n  font-weight: 550;\n}\n\n.shot-list-state {\n  color: var(--ink);\n  font-size: 11px;\n  white-space: nowrap;\n}\n\n.asset-list-empty {\n  color: var(--text-muted);\n  display: grid;\n  font-size: 11px;\n  gap: 3px;\n  line-height: 1.55;\n  padding: 18px 8px;\n}\n\n.asset-list-empty strong {\n  color: var(--text-secondary);\n  font-size: 13px;\n}\n\n.error-copy {\n  color: var(--danger);\n}\n\n/* Main workspace */\n.asset-studio-column {\n  min-width: 0;\n  padding: 26px clamp(24px, 3vw, 48px) 56px;\n}\n\n.asset-studio-head {\n  align-items: flex-start;\n  border-bottom: 1px solid var(--border);\n  display: flex;\n  gap: 24px;\n  justify-content: space-between;\n  margin: 0 auto 24px;\n  max-width: 1240px;\n  min-height: 76px;\n  padding: 0 0 20px;\n}\n\n.asset-studio-head > :first-child {\n  min-width: 0;\n}\n\n.asset-studio-toolbar {\n  position: relative;\n}\n\n.asset-breadcrumb {\n  color: var(--text-muted);\n  font-size: 11px;\n  font-weight: 600;\n  letter-spacing: 0.02em;\n  line-height: 1.3;\n}\n\n.asset-studio-head h2 {\n  font-size: clamp(22px, 2.2vw, 28px);\n  font-weight: 650;\n  letter-spacing: -0.035em;\n  line-height: 1.2;\n  margin: 5px 0 0;\n  max-width: min(680px, 50vw);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.asset-title-row {\n  align-items: center;\n  display: flex;\n  flex-wrap: wrap;\n  gap: 9px;\n  min-width: 0;\n}\n\n.asset-title-row h2 {\n  flex: 0 1 auto;\n}\n\n.character-role-picker {\n  display: inline-flex;\n  flex: 0 0 auto;\n}\n\n.character-role-picker select {\n  appearance: auto;\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: 999px;\n  color: var(--text-secondary);\n  cursor: pointer;\n  font-size: 11px;\n  font-weight: 600;\n  height: 27px;\n  outline: 0;\n  padding: 0 7px;\n}\n\n.character-role-picker select:hover:not(:disabled) {\n  border-color: var(--border-strong);\n  color: var(--text);\n}\n\n.character-role-picker select:focus-visible {\n  box-shadow: 0 0 0 2px var(--focus);\n}\n\n.studio-context {\n  color: var(--text-secondary);\n  font-size: 12px;\n  margin-top: 7px;\n}\n\n.asset-studio-actions {\n  flex-wrap: wrap;\n  gap: 7px;\n  justify-content: flex-end;\n  padding-top: 10px;\n}\n\n.asset-state-pill {\n  border: 1px solid var(--border-strong);\n  border-radius: 999px;\n  color: var(--text-secondary);\n  font-size: 11px;\n  line-height: 26px;\n  padding: 0 9px;\n  white-space: nowrap;\n}\n\n.asset-state-pill.is-dirty {\n  border-color: var(--border-strong);\n  color: var(--ink);\n}\n\n.studio-action-button {\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  color: var(--text-secondary);\n  font-size: 12px;\n  height: 30px;\n  padding: 0 10px;\n}\n\n.studio-action-button:hover:not(:disabled) {\n  background: var(--surface-hover);\n  border-color: var(--ink);\n  color: var(--text);\n}\n\n.studio-action-button.is-danger:hover:not(:disabled) {\n  border-color: var(--border-strong);\n  color: var(--text);\n}\n\n.shot-stepper {\n  align-items: center;\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  color: var(--text-muted);\n  display: inline-flex;\n  height: 30px;\n  overflow: hidden;\n}\n\n.shot-stepper > span {\n  border-right: 1px solid var(--border);\n  font-family: var(--mono);\n  font-size: 10px;\n  padding: 0 8px;\n}\n\n.shot-stepper button {\n  background: var(--surface);\n  color: var(--text-secondary);\n  font-size: 19px;\n  height: 29px;\n  line-height: 1;\n  padding: 0 8px;\n  width: 29px;\n}\n\n.shot-stepper button + button {\n  border-left: 1px solid var(--border);\n}\n\n.shot-stepper button:hover:not(:disabled) {\n  background: var(--surface-hover);\n  color: var(--text);\n}\n\n.studio-empty {\n  align-items: center;\n  color: var(--text-secondary);\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  margin: 12vh auto 0;\n  max-width: 420px;\n  min-height: 230px;\n  text-align: center;\n}\n\n.studio-empty-symbol {\n  align-items: center;\n  border: 1px solid var(--border-strong);\n  border-radius: 50%;\n  color: var(--ink);\n  display: inline-flex;\n  font-size: 21px;\n  height: 48px;\n  justify-content: center;\n  margin-bottom: 14px;\n  width: 48px;\n}\n\n.studio-empty h3 {\n  color: var(--text);\n  font-size: 16px;\n  font-weight: 600;\n  margin: 0;\n}\n\n.studio-empty p {\n  color: var(--text-muted);\n  font-size: 13px;\n  line-height: 1.7;\n  margin: 7px 0 0;\n}\n\n.character-editor,\n.shot-editor {\n  display: grid;\n  gap: 18px;\n  margin: 0 auto;\n  max-width: 1240px;\n}\n\n/* Cards and controls */\n.editor-card,\n.source-context-card,\n.draft-asset-note,\n.asset-primary-media,\n.asset-slot {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n}\n\n.editor-card,\n.asset-primary-media,\n.asset-slot {\n  box-shadow: 0 5px 18px rgba(32, 32, 29, 0.045);\n}\n\n.editor-card {\n  padding: 20px;\n}\n\n.editor-card-heading {\n  gap: 16px;\n  justify-content: space-between;\n  margin-bottom: 18px;\n}\n\n.editor-card-heading-actions {\n  gap: 7px;\n  justify-content: flex-end;\n}\n\n.editor-mode-button {\n  align-items: center;\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  border-radius: var(--radius-sm);\n  color: var(--text-secondary);\n  display: inline-flex;\n  font-size: 12px;\n  height: 32px;\n  justify-content: center;\n  padding: 0 11px;\n}\n\n.editor-mode-button:hover {\n  background: var(--surface-hover);\n  border-color: var(--ink);\n  color: var(--text);\n}\n\n.editor-card-heading h3,\n.section-heading h3,\n.source-context-heading h3,\n.asset-slot-heading h3 {\n  color: var(--text);\n  font-size: 16px;\n  font-weight: 650;\n  letter-spacing: -0.02em;\n  line-height: 1.25;\n  margin: 3px 0 0;\n}\n\n.save-button {\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  color: var(--text-secondary);\n  flex: 0 0 auto;\n  font-size: 12px;\n  height: 32px;\n  padding: 0 12px;\n}\n\n.save-button:hover:not(:disabled) {\n  background: var(--surface-hover);\n  border-color: var(--ink);\n  color: var(--text);\n}\n\n.save-button.primary,\n.submit-button {\n  background: var(--ink);\n  border-color: var(--ink);\n  color: var(--paper);\n}\n\n.save-button.primary:hover:not(:disabled),\n.submit-button:hover:not(:disabled) {\n  background: var(--ink-hover);\n  border-color: var(--ink-hover);\n}\n\n.profile-textarea,\n.asset-field input,\n.asset-field textarea,\n.asset-field select {\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  border-radius: var(--radius-sm);\n  color: var(--text);\n  outline: 0;\n  width: 100%;\n}\n\n.profile-textarea {\n  display: block;\n  font-size: 13px;\n  line-height: 1.75;\n  min-height: 188px;\n  padding: 12px 13px;\n  resize: vertical;\n}\n\n.profile-preview {\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  color: var(--text);\n  min-height: 188px;\n  max-height: 360px;\n  overflow: auto;\n  padding: 14px 16px;\n}\n\n.profile-preview h4 {\n  color: var(--text);\n  font-size: 15px;\n  font-weight: 650;\n  letter-spacing: -0.015em;\n  line-height: 1.35;\n  margin: 0 0 8px;\n}\n\n.profile-preview h4:not(:first-child) {\n  border-top: 1px solid var(--border);\n  margin-top: 16px;\n  padding-top: 14px;\n}\n\n.profile-preview p {\n  color: var(--text-secondary);\n  font-size: 13px;\n  line-height: 1.72;\n  margin: 0 0 7px;\n}\n\n.profile-preview-list-item {\n  display: grid;\n  gap: 8px;\n  grid-template-columns: 11px minmax(0, 1fr);\n  padding-left: 2px;\n}\n\n.profile-preview-list-item > span:first-child {\n  color: var(--ink);\n  font-size: 13px;\n}\n\n.profile-preview-code {\n  background: var(--surface-subtle);\n  border-left: 2px solid var(--border-strong);\n  font-family: var(--mono);\n  font-size: 12px !important;\n  padding: 3px 8px;\n}\n\n.profile-preview-space {\n  height: 5px;\n}\n\n.profile-preview.is-empty {\n  align-items: center;\n  color: var(--text-muted);\n  display: flex;\n  font-size: 13px;\n  justify-content: center;\n  text-align: center;\n}\n\n.profile-textarea:focus,\n.asset-field input:focus,\n.asset-field textarea:focus,\n.asset-field select:focus {\n  border-color: var(--ink);\n  box-shadow: 0 0 0 2px var(--focus);\n}\n\n.editor-hint {\n  color: var(--text-muted);\n  font-size: 11px;\n  line-height: 1.55;\n  margin-top: 9px;\n}\n\n.asset-field {\n  display: grid;\n  gap: 6px;\n  min-width: 0;\n}\n\n.asset-field > span {\n  color: var(--text-secondary);\n  font-size: 11px;\n  font-weight: 600;\n}\n\n.asset-field input,\n.asset-field textarea {\n  font-size: 13px;\n  line-height: 1.55;\n  min-height: 36px;\n  padding: 7px 9px;\n}\n\n.asset-field textarea {\n  min-height: 116px;\n  resize: vertical;\n}\n\n.design-grid,\n.field-grid {\n  display: grid;\n  gap: 12px;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n}\n\n.field-grid {\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n}\n\n.design-long-fields {\n  display: grid;\n  gap: 14px;\n  margin-top: 14px;\n}\n\n.generation-settings {\n  border-top: 1px solid var(--border);\n  margin-top: 18px;\n  padding-top: 15px;\n}\n\n.generation-settings summary {\n  align-items: center;\n  color: var(--text-secondary);\n  cursor: pointer;\n  display: flex;\n  font-size: 12px;\n  gap: 9px;\n  list-style: none;\n}\n\n.generation-settings summary::-webkit-details-marker {\n  display: none;\n}\n\n.generation-settings summary::before {\n  color: var(--ink);\n  content: "\u203A";\n  font-size: 18px;\n  line-height: 1;\n  transform: translateY(-1px);\n  transition: transform 120ms ease;\n}\n\n.generation-settings[open] summary::before {\n  transform: rotate(90deg) translateX(-1px);\n}\n\n.generation-settings summary span {\n  font-weight: 600;\n}\n\n.generation-settings summary small {\n  color: var(--text-muted);\n  font-size: 11px;\n}\n\n.generation-settings-fields {\n  display: grid;\n  gap: 14px;\n  grid-template-columns: minmax(150px, 0.35fr) minmax(0, 1fr);\n  margin-top: 15px;\n}\n\n.generation-settings-fields .asset-field:first-child {\n  grid-row: span 2;\n}\n\n.generation-settings-fields .asset-field:first-child input {\n  align-self: start;\n}\n\n/* Primary media */\n.asset-primary-media {\n  align-items: stretch;\n  display: grid;\n  gap: 18px;\n  grid-template-columns: minmax(170px, 230px) minmax(0, 1fr);\n  overflow: hidden;\n  padding: 12px;\n}\n\n.asset-primary-visual {\n  align-items: center;\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  display: flex;\n  justify-content: center;\n  min-height: 236px;\n  overflow: hidden;\n}\n\n.asset-primary-image-button {\n  background: transparent;\n  display: block;\n  height: 100%;\n  padding: 0;\n  width: 100%;\n}\n\n.asset-primary-image-button img {\n  display: block;\n  height: 100%;\n  max-height: 380px;\n  object-fit: contain;\n  width: 100%;\n}\n\n.asset-primary-video {\n  display: block;\n  max-height: 380px;\n  width: 100%;\n}\n\n.asset-primary-meta {\n  align-items: flex-end;\n  flex-wrap: wrap;\n  gap: 14px;\n  justify-content: space-between;\n  padding: 10px 12px 10px 0;\n}\n\n.asset-primary-meta > div {\n  display: grid;\n  gap: 4px;\n  min-width: 0;\n}\n\n.asset-primary-meta strong {\n  font-size: 14px;\n  font-weight: 600;\n  max-width: 480px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.asset-primary-meta small {\n  color: var(--text-muted);\n  font-size: 11px;\n}\n\n.asset-primary-open {\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  color: var(--text-secondary);\n  flex: 0 0 auto;\n  font-size: 12px;\n  height: 30px;\n  padding: 0 10px;\n}\n\n.asset-primary-open:hover {\n  background: var(--surface-hover);\n  border-color: var(--ink);\n  color: var(--text);\n}\n\n/* Confirmed character visuals stay together: the turnaround is primary, while\n   costume and reference selections remain visible as smaller supporting views. */\n.character-visual-board {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  display: grid;\n  gap: 10px;\n  grid-template-columns: minmax(0, 1.45fr) minmax(132px, 0.8fr);\n  min-width: 0;\n  overflow: hidden;\n  padding: 10px;\n}\n\n.character-visual-main,\n.character-visual-supporting {\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  min-width: 0;\n}\n\n.character-visual-main {\n  display: grid;\n  grid-template-rows: auto minmax(228px, 1fr) auto;\n  overflow: hidden;\n}\n\n.character-visual-board-heading {\n  align-items: center;\n  display: flex;\n  gap: 10px;\n  justify-content: space-between;\n  padding: 10px 11px 8px;\n}\n\n.character-visual-board-heading strong {\n  display: block;\n  font-size: 13px;\n  margin-top: 2px;\n}\n\n.character-visual-board-heading > span {\n  border: 1px solid var(--border);\n  border-radius: 999px;\n  color: var(--text-secondary);\n  font-size: 10px;\n  line-height: 20px;\n  padding: 0 7px;\n}\n\n.character-visual-main-button,\n.character-visual-supporting-button {\n  align-items: center;\n  background: transparent;\n  display: flex;\n  justify-content: center;\n  min-width: 0;\n  overflow: hidden;\n  padding: 0;\n}\n\n.character-visual-main-button {\n  min-height: 228px;\n}\n\n.character-visual-main-button img,\n.character-visual-supporting-button img {\n  display: block;\n  height: 100%;\n  object-fit: contain;\n  width: 100%;\n}\n\n.character-visual-main-button:hover img,\n.character-visual-main-button:focus-visible img,\n.character-visual-supporting-button:hover img,\n.character-visual-supporting-button:focus-visible img {\n  opacity: 0.82;\n}\n\n.character-visual-file-name {\n  color: var(--text-muted);\n  font-size: 10px;\n  margin: 0;\n  overflow: hidden;\n  padding: 7px 10px 9px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.character-visual-supporting {\n  display: grid;\n  grid-template-rows: auto minmax(0, 1fr);\n  overflow: hidden;\n  padding: 10px;\n}\n\n.character-visual-supporting > .eyebrow {\n  margin: 0 0 8px;\n}\n\n.character-visual-supporting-grid {\n  display: grid;\n  gap: 9px;\n  grid-auto-rows: minmax(0, 1fr);\n}\n\n.character-visual-supporting-card {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  display: grid;\n  grid-template-rows: minmax(74px, 1fr) auto;\n  min-height: 0;\n  overflow: hidden;\n}\n\n.character-visual-supporting-button {\n  min-height: 74px;\n}\n\n.character-visual-supporting-card > div {\n  border-top: 1px solid var(--border);\n  display: grid;\n  gap: 1px;\n  min-width: 0;\n  padding: 6px 7px;\n}\n\n.character-visual-supporting-card strong {\n  font-size: 11px;\n}\n\n.character-visual-supporting-card small {\n  color: var(--text-muted);\n  font-size: 10px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* Reference slots */\n.slot-section {\n  display: grid;\n  gap: 12px;\n}\n\n.section-heading {\n  gap: 16px;\n  justify-content: space-between;\n  padding: 0 2px;\n}\n\n.section-heading > span {\n  color: var(--text-muted);\n  font-size: 11px;\n  text-align: right;\n}\n\n.slot-grid {\n  display: grid;\n  gap: 12px;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n}\n\n.character-slot-grid {\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n}\n\n.character-slot-grid > .asset-slot:first-child {\n  grid-column: 1 / -1;\n  grid-template-rows: auto minmax(246px, 1fr) auto;\n}\n\n.character-slot-grid > .asset-slot:first-child .asset-slot-body {\n  min-height: 266px;\n}\n\n.character-slot-grid > .asset-slot:first-child .slot-empty {\n  min-height: 244px;\n}\n\n.asset-slot {\n  display: grid;\n  grid-template-rows: auto minmax(130px, 1fr) auto;\n  min-width: 0;\n  overflow: hidden;\n}\n\n.asset-slot-heading {\n  border-bottom: 1px solid var(--border);\n  gap: 8px;\n  justify-content: space-between;\n  padding: 13px 14px 11px;\n}\n\n.asset-slot-heading h3 {\n  font-size: 13px;\n  margin-top: 2px;\n}\n\n.asset-slot-count {\n  align-items: center;\n  border: 1px solid var(--border);\n  border-radius: 999px;\n  color: var(--text-muted);\n  display: inline-flex;\n  flex: 0 0 22px;\n  font-family: var(--mono);\n  font-size: 10px;\n  height: 22px;\n  justify-content: center;\n}\n\n.asset-slot-candidate-count {\n  flex-basis: auto;\n  min-width: 54px;\n  padding: 0 7px;\n  white-space: nowrap;\n}\n\n.asset-slot-heading-actions {\n  align-items: center;\n  display: flex;\n  gap: 6px;\n}\n\n.asset-slot-confirmed {\n  align-items: center;\n  background: var(--ink);\n  border-radius: 999px;\n  color: var(--paper);\n  display: inline-flex;\n  font-size: 10px;\n  font-weight: 600;\n  height: 22px;\n  padding: 0 7px;\n  white-space: nowrap;\n}\n\n.asset-slot-confirmed.is-conflict {\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  color: var(--text-secondary);\n}\n\n.asset-slot-body {\n  min-height: 166px;\n  padding: 10px;\n}\n\n.turnaround-selection-summary {\n  align-items: center;\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  display: flex;\n  gap: 14px;\n  justify-content: space-between;\n  margin-bottom: 10px;\n  min-width: 0;\n  padding: 8px 10px;\n}\n\n.turnaround-selection-summary.has-confirmed {\n  background: var(--paper);\n  border-color: var(--border-strong);\n}\n\n.turnaround-selection-summary.has-conflict {\n  background: var(--surface);\n  border-color: var(--border-strong);\n}\n\n.turnaround-selection-summary > div {\n  display: grid;\n  gap: 2px;\n  min-width: 0;\n}\n\n.turnaround-selection-summary strong {\n  color: var(--text-secondary);\n  font-size: 10px;\n  font-weight: 650;\n}\n\n.turnaround-selection-summary span {\n  color: var(--text);\n  font-size: 11px;\n  font-weight: 600;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.turnaround-selection-summary small {\n  color: var(--text-muted);\n  flex: 0 1 175px;\n  font-size: 10px;\n  line-height: 1.45;\n  text-align: right;\n}\n\n.slot-empty {\n  align-items: center;\n  border: 1px dashed var(--border-strong);\n  border-radius: var(--radius-md);\n  color: var(--text-secondary);\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  justify-content: center;\n  min-height: 145px;\n  padding: 16px 10px;\n  text-align: center;\n}\n\n.slot-empty-icon {\n  align-items: center;\n  border: 1px solid var(--border-strong);\n  border-radius: 50%;\n  color: var(--ink);\n  display: inline-flex;\n  font-size: 16px;\n  height: 28px;\n  justify-content: center;\n  margin-bottom: 8px;\n  width: 28px;\n}\n\n.slot-empty span {\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.slot-empty small {\n  color: var(--text-muted);\n  font-size: 10px;\n  line-height: 1.55;\n  margin-top: 4px;\n  max-width: 160px;\n}\n\n.asset-file-grid {\n  display: grid;\n  gap: 8px;\n  grid-template-columns: repeat(auto-fill, minmax(102px, 1fr));\n}\n\n.asset-file-card {\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  min-width: 0;\n  overflow: hidden;\n  position: relative;\n}\n\n.asset-file-card.is-confirmed {\n  border-color: var(--ink);\n}\n\n.asset-file-card.has-selection-conflict {\n  border-style: dashed;\n  border-color: var(--border-strong);\n}\n\n.asset-file-preview,\n.asset-file-preview-button {\n  align-items: center;\n  background: var(--surface-subtle);\n  display: flex;\n  height: 88px;\n  justify-content: center;\n  overflow: hidden;\n  width: 100%;\n}\n\n.asset-file-preview-button {\n  cursor: zoom-in;\n  padding: 0;\n}\n\n.asset-file-preview-button:hover {\n  background: var(--surface-hover);\n}\n\n.asset-file-preview .asset-thumb {\n  object-fit: cover;\n}\n\n.asset-file-meta {\n  display: grid;\n  gap: 1px;\n  min-width: 0;\n  padding: 7px 24px 7px 8px;\n}\n\n.asset-file-meta strong {\n  font-size: 10px;\n  font-weight: 600;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.asset-file-meta small {\n  color: var(--text-muted);\n  font-size: 9px;\n}\n\n.asset-file-confirm {\n  background: var(--surface);\n  border-top: 1px solid var(--border);\n  color: var(--text-secondary);\n  font-size: 10px;\n  font-weight: 600;\n  height: 29px;\n  padding: 0 7px;\n  width: 100%;\n}\n\n.asset-file-confirm:hover:not(:disabled) {\n  background: var(--surface-hover);\n  color: var(--text);\n}\n\n.asset-file-confirm.is-confirmed {\n  background: var(--ink);\n  border-top-color: var(--ink);\n  color: var(--paper);\n}\n\n.asset-file-remove {\n  background: transparent;\n  color: var(--text-muted);\n  font-size: 15px;\n  line-height: 1;\n  padding: 2px 5px;\n  position: absolute;\n  right: 2px;\n  top: 2px;\n}\n\n.asset-file-remove:hover:not(:disabled) {\n  background: var(--surface-hover);\n  color: var(--text);\n}\n\n.slot-upload-button {\n  background: var(--surface);\n  border-top: 1px solid var(--border);\n  color: var(--ink);\n  font-size: 11px;\n  gap: 5px;\n  height: 38px;\n  justify-content: center;\n  padding: 0 10px;\n  width: 100%;\n}\n\n.slot-upload-button:hover:not(:disabled) {\n  background: var(--surface-hover);\n}\n\n.slot-upload-button > span {\n  font-size: 15px;\n  line-height: 1;\n}\n\n.asset-slot.is-disabled {\n  opacity: 0.62;\n}\n\n.trash-modal {\n  width: min(680px, calc(100vw - 32px));\n}\n\n.trash-entry-list {\n  display: grid;\n  gap: 8px;\n  max-height: min(420px, calc(100vh - 290px));\n  min-height: 116px;\n  overflow: auto;\n  padding: 2px 0;\n}\n\n.trash-entry,\n.trash-empty {\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n}\n\n.trash-entry {\n  align-items: center;\n  display: grid;\n  gap: 10px;\n  grid-template-columns: 26px minmax(0, 1fr) auto;\n  padding: 10px 11px;\n}\n\n.trash-entry.is-legacy {\n  background: var(--surface-subtle);\n}\n\n.trash-entry-mark {\n  align-items: center;\n  border: 1px solid var(--border-strong);\n  border-radius: 50%;\n  color: var(--text-secondary);\n  display: inline-flex;\n  font-size: 14px;\n  height: 24px;\n  justify-content: center;\n  width: 24px;\n}\n\n.trash-entry-copy {\n  display: grid;\n  gap: 2px;\n  min-width: 0;\n}\n\n.trash-entry-copy strong,\n.trash-entry-copy small,\n.trash-entry-copy em {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.trash-entry-copy strong {\n  color: var(--text);\n  font-size: 12px;\n  font-weight: 650;\n}\n\n.trash-entry-copy small,\n.trash-entry-copy em {\n  color: var(--text-muted);\n  font-size: 10px;\n  font-style: normal;\n}\n\n.trash-entry-unavailable {\n  color: var(--text-muted);\n  font-size: 10px;\n  white-space: nowrap;\n}\n\n.trash-empty {\n  align-items: center;\n  color: var(--text-secondary);\n  display: flex;\n  font-size: 12px;\n  justify-content: center;\n  margin: 0;\n  min-height: 108px;\n  padding: 16px;\n  text-align: center;\n}\n\n.trash-empty.is-error {\n  display: grid;\n  gap: 9px;\n}\n\n.trash-empty.is-error p {\n  margin: 0;\n}\n\n/* Draft and source context */\n.draft-summary {\n  display: grid;\n  gap: 16px;\n}\n\n.draft-summary-lead {\n  align-items: flex-start;\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  display: flex;\n  gap: 10px;\n  padding: 12px;\n}\n\n.draft-summary-mark {\n  align-items: center;\n  background: var(--ink-soft);\n  border-radius: 5px;\n  color: var(--ink);\n  display: inline-flex;\n  flex: 0 0 28px;\n  font-size: 12px;\n  font-weight: 700;\n  height: 28px;\n  justify-content: center;\n}\n\n.draft-summary-lead strong {\n  font-size: 13px;\n  font-weight: 650;\n}\n\n.draft-summary-lead p {\n  color: var(--text-secondary);\n  font-size: 11px;\n  margin: 3px 0 0;\n}\n\n.draft-summary-grid {\n  border-bottom: 1px solid var(--border);\n  border-top: 1px solid var(--border);\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  margin: 0;\n  padding: 12px 0;\n}\n\n.draft-summary-item {\n  border-right: 1px solid var(--border);\n  display: grid;\n  gap: 3px;\n  padding: 0 12px;\n}\n\n.draft-summary-item:first-child {\n  padding-left: 0;\n}\n\n.draft-summary-item:last-child {\n  border-right: 0;\n}\n\n.draft-summary-item dt {\n  color: var(--text-muted);\n  font-size: 10px;\n}\n\n.draft-summary-item dd {\n  color: var(--text);\n  font-size: 12px;\n  margin: 0;\n}\n\n.draft-summary-block {\n  border-bottom: 1px solid var(--border);\n  padding-bottom: 14px;\n}\n\n.draft-summary-block h4 {\n  color: var(--text-secondary);\n  font-size: 11px;\n  font-weight: 650;\n  margin: 0 0 5px;\n}\n\n.draft-summary-block p {\n  color: var(--text);\n  font-size: 13px;\n  line-height: 1.72;\n  margin: 0;\n  white-space: pre-wrap;\n}\n\n.draft-summary-block:last-child {\n  border-bottom: 0;\n  padding-bottom: 0;\n}\n\n.source-context-card,\n.draft-asset-note {\n  padding: 15px 17px;\n}\n\n.source-context-heading {\n  gap: 12px;\n  justify-content: space-between;\n}\n\n.source-context-heading h3 {\n  font-size: 13px;\n  max-width: min(680px, 62vw);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.source-context-heading small {\n  color: var(--text-muted);\n  display: block;\n  font-size: 10px;\n  margin-top: 3px;\n  max-width: 680px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.source-context-toggle {\n  background: var(--surface);\n  border: 1px solid var(--border-strong);\n  color: var(--text-secondary);\n  flex: 0 0 auto;\n  font-size: 11px;\n  height: 30px;\n  padding: 0 10px;\n}\n\n.source-context-toggle:hover:not(:disabled) {\n  background: var(--surface-hover);\n  border-color: var(--ink);\n  color: var(--text);\n}\n\n.source-context-body {\n  border-top: 1px solid var(--border);\n  margin-top: 14px;\n  padding-top: 13px;\n}\n\n.source-context-body p,\n.source-context-error {\n  color: var(--text-secondary);\n  font-size: 12px;\n  margin: 0;\n}\n\n.source-context-body pre {\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  color: var(--text-secondary);\n  font-family: var(--mono);\n  font-size: 11px;\n  line-height: 1.65;\n  margin: 0;\n  max-height: 360px;\n  overflow: auto;\n  padding: 12px;\n  white-space: pre-wrap;\n}\n\n.draft-asset-note {\n  border-style: dashed;\n}\n\n.draft-asset-note p:last-child {\n  color: var(--text-secondary);\n  font-size: 12px;\n  margin: 4px 0 0;\n}\n\n/* Dialogs and media viewer */\n.modal-backdrop,\n.media-lightbox-backdrop {\n  align-items: center;\n  background: rgba(32, 32, 29, 0.42);\n  display: flex;\n  inset: 0;\n  justify-content: center;\n  padding: 20px;\n  position: fixed;\n  z-index: 200;\n}\n\n.modal-card {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  box-shadow: 0 12px 28px rgba(32, 32, 29, 0.12);\n  max-height: min(720px, calc(100vh - 40px));\n  overflow: auto;\n  width: min(520px, 100%);\n}\n\n.asset-modal {\n  padding: 22px;\n}\n\n.modal-heading {\n  gap: 14px;\n  justify-content: space-between;\n  margin-bottom: 11px;\n}\n\n.modal-heading h2 {\n  font-size: 20px;\n  font-weight: 650;\n  letter-spacing: -0.03em;\n  line-height: 1.25;\n  margin: 3px 0 0;\n}\n\n.icon-button,\n.media-lightbox-close {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  color: var(--text-muted);\n  font-size: 20px;\n  height: 30px;\n  line-height: 1;\n  padding: 0;\n  width: 30px;\n}\n\n.icon-button:hover,\n.media-lightbox-close:hover {\n  background: var(--surface-hover);\n  color: var(--text);\n}\n\n.modal-copy {\n  color: var(--text-secondary);\n  font-size: 12px;\n  line-height: 1.65;\n  margin-bottom: 17px;\n}\n\n.modal-card > .asset-field,\n.modal-card > .field-grid {\n  margin-top: 14px;\n}\n\n.modal-actions {\n  border-top: 1px solid var(--border);\n  gap: 8px;\n  justify-content: flex-end;\n  margin-top: 22px;\n  padding-top: 15px;\n}\n\n.text-button,\n.submit-button {\n  font-size: 12px;\n  height: 32px;\n  padding: 0 12px;\n}\n\n.text-button {\n  background: transparent;\n  color: var(--text-secondary);\n}\n\n.text-button:hover {\n  background: var(--surface-hover);\n  color: var(--text);\n}\n\n.submit-button {\n  border: 1px solid var(--ink);\n  border-radius: var(--radius-sm);\n}\n\n.submit-button.destructive {\n  background: var(--text);\n  border-color: var(--text);\n}\n\n.submit-button.destructive:hover:not(:disabled) {\n  background: var(--text-secondary);\n  border-color: var(--text-secondary);\n}\n\n.trash-warning {\n  align-items: flex-start;\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  display: flex;\n  gap: 10px;\n  padding: 12px;\n}\n\n.trash-warning > span {\n  align-items: center;\n  border: 1px solid var(--border-strong);\n  border-radius: 50%;\n  color: var(--text-secondary);\n  display: inline-flex;\n  flex: 0 0 22px;\n  font-size: 11px;\n  font-weight: 700;\n  height: 22px;\n  justify-content: center;\n}\n\n.trash-warning p {\n  color: var(--text-secondary);\n  font-size: 12px;\n  line-height: 1.6;\n  margin: 0;\n}\n\n.trash-warning b {\n  color: var(--text);\n}\n\n.storyboard-import-layout {\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  display: grid;\n  grid-template-columns: 170px minmax(0, 1fr);\n  min-height: 290px;\n  overflow: hidden;\n}\n\n.import-source-list {\n  background: var(--surface-subtle);\n  border-right: 1px solid var(--border);\n  padding: 12px 8px;\n}\n\n.import-source-list > .eyebrow {\n  padding: 0 5px 7px;\n}\n\n.import-source-list button {\n  background: transparent;\n  border-left: 2px solid transparent;\n  color: var(--text-secondary);\n  display: grid;\n  gap: 3px;\n  padding: 8px 7px;\n  text-align: left;\n  width: 100%;\n}\n\n.import-source-list button:hover {\n  background: var(--surface-hover);\n}\n\n.import-source-list button.is-active {\n  background: var(--surface);\n  border-left-color: var(--ink);\n  color: var(--text);\n}\n\n.import-source-list button span {\n  font-size: 11px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.import-source-list button b {\n  color: var(--text-muted);\n  font-size: 10px;\n  font-weight: 400;\n}\n\n.import-shot-list {\n  min-width: 0;\n  padding: 13px;\n}\n\n.import-shot-list-heading {\n  gap: 12px;\n  justify-content: space-between;\n  margin-bottom: 9px;\n}\n\n.import-shot-list-heading h3 {\n  font-size: 13px;\n  font-weight: 650;\n  margin: 3px 0 0;\n  max-width: 250px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.import-select-all {\n  align-items: center;\n  color: var(--text-secondary);\n  display: inline-flex;\n  flex: 0 0 auto;\n  font-size: 11px;\n  gap: 5px;\n}\n\n.import-select-all input,\n.import-shot-option input {\n  accent-color: var(--ink);\n}\n\n.import-shot-options {\n  border-top: 1px solid var(--border);\n  max-height: 270px;\n  overflow: auto;\n}\n\n.import-shot-option {\n  align-items: center;\n  border-bottom: 1px solid var(--border);\n  display: grid;\n  gap: 7px;\n  grid-template-columns: 15px 52px minmax(0, 1fr) auto;\n  min-height: 39px;\n  padding: 6px 3px;\n}\n\n.import-shot-option:hover {\n  background: var(--surface-hover);\n}\n\n.import-shot-id {\n  color: var(--ink);\n  font-family: var(--mono);\n  font-size: 10px;\n}\n\n.import-shot-title {\n  font-size: 11px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.import-shot-option small {\n  color: var(--text-muted);\n  font-size: 10px;\n  white-space: nowrap;\n}\n\n.import-empty {\n  color: var(--text-muted);\n  font-size: 12px;\n  margin: 36px 10px;\n  text-align: center;\n}\n\n.media-lightbox {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  box-shadow: 0 12px 32px rgba(32, 32, 29, 0.14);\n  max-height: calc(100vh - 40px);\n  max-width: min(1100px, 100%);\n  overflow: hidden;\n  width: 100%;\n}\n\n.media-lightbox-head {\n  border-bottom: 1px solid var(--border);\n  gap: 12px;\n  justify-content: space-between;\n  padding: 11px 13px;\n}\n\n.media-lightbox-head > div {\n  display: grid;\n  gap: 2px;\n  min-width: 0;\n}\n\n.media-lightbox-head strong {\n  font-size: 13px;\n  font-weight: 600;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.media-lightbox-head small {\n  color: var(--text-muted);\n  font-size: 10px;\n}\n\n.media-lightbox-stage {\n  align-items: center;\n  background: var(--surface-subtle);\n  display: flex;\n  justify-content: center;\n  min-height: min(520px, calc(100vh - 120px));\n  padding: 18px;\n}\n\n.media-lightbox-image,\n.media-lightbox-video {\n  display: block;\n  max-height: calc(100vh - 150px);\n  max-width: 100%;\n  object-fit: contain;\n}\n\n.media-lightbox-video {\n  width: min(960px, 100%);\n}\n\n.visually-hidden {\n  clip: rect(0 0 0 0);\n  clip-path: inset(50%);\n  height: 1px;\n  overflow: hidden;\n  position: absolute;\n  white-space: nowrap;\n  width: 1px;\n}\n\n/* Monochrome refinement: hierarchy comes from spacing and ink weight, not color. */\n.topbar {\n  grid-template-columns: minmax(220px, 1fr) auto minmax(220px, 1fr);\n  height: 56px;\n}\n\n.topbar-center {\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: 999px;\n  gap: 6px;\n  height: 28px;\n  padding: 0 10px;\n}\n\n.status-dot {\n  background: var(--ink);\n  height: 5px;\n  width: 5px;\n}\n\n.asset-workspace-grid {\n  grid-template-columns: 232px minmax(0, 1fr);\n  min-height: calc(100vh - 56px);\n}\n\n.asset-library-rail {\n  height: calc(100vh - 56px);\n  padding: 19px 12px 12px;\n  top: 56px;\n}\n\n.asset-rail-heading {\n  padding: 0 5px 13px;\n}\n\n.asset-rail-heading h1 {\n  font-size: 20px;\n}\n\n.asset-tabs {\n  background: transparent;\n  border: 0;\n  border-bottom: 1px solid var(--border);\n  border-radius: 0;\n  gap: 16px;\n  padding: 0;\n}\n\n.asset-tabs button {\n  border-radius: 0;\n  height: 37px;\n  justify-content: flex-start;\n  padding: 0 4px;\n  position: relative;\n}\n\n.asset-tabs button b {\n  margin-left: auto;\n}\n\n.asset-tabs button.is-active {\n  background: transparent;\n  box-shadow: none;\n  color: var(--text);\n}\n\n.asset-tabs button.is-active::after {\n  background: var(--ink);\n  bottom: -1px;\n  content: "";\n  height: 2px;\n  left: 0;\n  position: absolute;\n  right: 0;\n}\n\n.asset-tabs button.is-active b {\n  color: var(--text);\n}\n\n.scene-scope {\n  background: transparent;\n  border: 0;\n  border-bottom: 1px solid var(--border);\n  border-radius: 0;\n  margin-top: 0;\n  padding: 12px 4px 11px;\n}\n\n.scene-picker select {\n  background: var(--surface);\n  border-color: var(--border);\n}\n\n.asset-list-tools {\n  margin-top: 12px;\n}\n\n.asset-search {\n  border-color: var(--border-strong);\n}\n\n.asset-card {\n  border-radius: var(--radius-sm);\n}\n\n.asset-card.is-active {\n  border-color: var(--border);\n}\n\n.asset-card-cover {\n  background: var(--surface-subtle);\n}\n\n.character-avatar-letter,\n.shot-list-id,\n.shot-list-state,\n.import-shot-id {\n  color: var(--text-secondary);\n}\n\n.asset-studio-column {\n  padding: 29px clamp(22px, 4vw, 54px) 64px;\n}\n\n.asset-studio-head,\n.character-editor,\n.shot-editor {\n  max-width: 1080px;\n}\n\n.asset-studio-head {\n  margin-bottom: 21px;\n  min-height: 67px;\n  padding-bottom: 17px;\n}\n\n.asset-studio-head h2 {\n  font-size: clamp(23px, 2.1vw, 27px);\n}\n\n.studio-action-button.is-danger {\n  background: transparent;\n  border-color: transparent;\n  color: var(--text-muted);\n}\n\n.studio-action-button.is-danger:hover:not(:disabled) {\n  background: var(--surface-hover);\n  border-color: var(--border);\n  color: var(--text-secondary);\n}\n\n.editor-card,\n.asset-primary-media,\n.asset-slot {\n  box-shadow: none;\n}\n\n.editor-card {\n  border-radius: var(--radius-md);\n  padding: 21px 22px 18px;\n}\n\n.editor-card-heading {\n  align-items: flex-start;\n  border-bottom: 1px solid var(--border);\n  margin-bottom: 17px;\n  padding-bottom: 15px;\n}\n\n.profile-preview {\n  border: 0;\n  border-radius: 0;\n  max-height: 360px;\n  min-height: 0;\n  padding: 0 10px 0 0;\n  scrollbar-color: var(--border-strong) transparent;\n  scrollbar-width: thin;\n}\n\n.profile-preview h4 {\n  font-size: 16px;\n}\n\n.profile-preview p {\n  font-size: 14px;\n  max-width: 880px;\n}\n\n.profile-preview-list-item > span:first-child,\n.profile-preview-code {\n  color: var(--text-secondary);\n}\n\n.profile-preview-code {\n  border-left-color: var(--border-strong);\n}\n\n.editor-hint {\n  border-top: 1px solid var(--border);\n  margin-top: 15px;\n  padding-top: 10px;\n}\n\n.save-button:not(:disabled) {\n  background: var(--ink);\n  border-color: var(--ink);\n  color: var(--paper);\n}\n\n.save-button:not(:disabled):hover {\n  background: var(--ink-hover);\n  border-color: var(--ink-hover);\n  color: var(--paper);\n}\n\n.slot-grid {\n  gap: 10px;\n}\n\n.asset-slot {\n  border-radius: var(--radius-md);\n}\n\n.asset-slot-heading {\n  padding: 12px 13px 10px;\n}\n\n.asset-slot-body {\n  min-height: 154px;\n}\n\n.slot-empty {\n  background: var(--surface-subtle);\n  border-color: var(--border-strong);\n  min-height: 132px;\n}\n\n.slot-empty-icon {\n  color: var(--text-secondary);\n}\n\n.slot-upload-button {\n  background: var(--surface);\n  color: var(--text-secondary);\n}\n\n.slot-upload-button:hover:not(:disabled) {\n  background: var(--surface-hover);\n  color: var(--text);\n}\n\n.draft-summary-mark,\n.notice > span {\n  background: var(--surface-subtle);\n  color: var(--text-secondary);\n}\n\n/* Keep the layout usable on narrow screens. */\n@media (max-width: 900px) {\n  .topbar {\n    grid-template-columns: 1fr auto;\n  }\n\n  .topbar-center {\n    display: none;\n  }\n\n  .asset-workspace-grid {\n    grid-template-columns: 210px minmax(0, 1fr);\n  }\n\n  .asset-studio-column {\n    padding-left: 20px;\n    padding-right: 20px;\n  }\n\n  .slot-grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}\n\n@media (max-width: 680px) {\n  body {\n    font-size: 13px;\n  }\n\n  .topbar {\n    height: 50px;\n    padding: 0 12px;\n  }\n\n  .asset-workspace-grid {\n    display: block;\n  }\n\n  .asset-library-rail {\n    border-bottom: 1px solid var(--border);\n    border-right: 0;\n    height: auto;\n    padding: 13px 12px 10px;\n    position: relative;\n    top: auto;\n  }\n\n  .asset-rail-heading {\n    align-items: center;\n    display: flex;\n    gap: 8px;\n    padding: 0 2px 10px;\n  }\n\n  .asset-rail-heading .eyebrow {\n    display: none;\n  }\n\n  .asset-rail-heading h1 {\n    font-size: 18px;\n    margin: 0;\n  }\n\n  .asset-tabs {\n    margin-bottom: 9px;\n  }\n\n  .asset-list-tools {\n    margin-top: 9px;\n  }\n\n  .asset-card-list {\n    display: flex;\n    gap: 5px;\n    max-height: 106px;\n    overflow-x: auto;\n    overflow-y: hidden;\n    padding-bottom: 4px;\n  }\n\n  .asset-card {\n    flex: 0 0 178px;\n  }\n\n  .shot-list-item {\n    flex-basis: 210px;\n  }\n\n  .asset-list-heading {\n    margin-top: 8px;\n  }\n\n  .asset-studio-column {\n    padding: 20px 14px 36px;\n  }\n\n  .asset-studio-head {\n    align-items: flex-start;\n    flex-direction: column;\n    gap: 9px;\n    margin-bottom: 17px;\n    min-height: 0;\n    padding-bottom: 15px;\n  }\n\n  .asset-studio-head h2 {\n    font-size: 22px;\n    max-width: calc(100vw - 28px);\n  }\n\n  .asset-studio-actions {\n    justify-content: flex-start;\n    padding-top: 0;\n    width: 100%;\n  }\n\n  .asset-primary-media {\n    grid-template-columns: 1fr;\n  }\n\n  .asset-primary-visual {\n    min-height: 190px;\n  }\n\n  .asset-primary-meta {\n    align-items: center;\n    padding: 0 2px 2px;\n  }\n\n  .editor-card {\n    padding: 16px;\n  }\n\n  .editor-card-heading {\n    align-items: flex-start;\n  }\n\n  .design-grid,\n  .field-grid,\n  .generation-settings-fields {\n    grid-template-columns: 1fr;\n  }\n\n  .generation-settings-fields .asset-field:first-child {\n    grid-row: auto;\n  }\n\n  .slot-grid {\n    grid-template-columns: 1fr;\n  }\n\n  .section-heading {\n    align-items: flex-start;\n    flex-direction: column;\n    gap: 3px;\n  }\n\n  .section-heading > span {\n    text-align: left;\n  }\n\n  .draft-summary-grid {\n    gap: 10px;\n    grid-template-columns: 1fr;\n  }\n\n  .draft-summary-item,\n  .draft-summary-item:first-child {\n    border-bottom: 1px solid var(--border);\n    border-right: 0;\n    padding: 0 0 8px;\n  }\n\n  .draft-summary-item:last-child {\n    border-bottom: 0;\n    padding-bottom: 0;\n  }\n\n  .storyboard-import-layout {\n    grid-template-columns: 1fr;\n  }\n\n  .import-source-list {\n    border-bottom: 1px solid var(--border);\n    border-right: 0;\n    display: flex;\n    gap: 4px;\n    overflow-x: auto;\n    padding: 8px;\n  }\n\n  .import-source-list > .eyebrow {\n    align-self: center;\n    flex: 0 0 auto;\n    padding: 0 4px;\n  }\n\n  .import-source-list button {\n    border-bottom: 2px solid transparent;\n    border-left: 0;\n    flex: 0 0 140px;\n  }\n\n  .import-source-list button.is-active {\n    border-bottom-color: var(--ink);\n    border-left-color: transparent;\n  }\n\n  .import-shot-option {\n    grid-template-columns: 15px 48px minmax(0, 1fr);\n  }\n\n  .import-shot-option small {\n    display: none;\n  }\n\n  .modal-backdrop,\n  .media-lightbox-backdrop {\n    padding: 10px;\n  }\n\n  .asset-modal {\n    padding: 17px;\n  }\n\n  .media-lightbox-stage {\n    min-height: 240px;\n    padding: 10px;\n  }\n}\n\n/* Final scene workspace layout overrides. */\n.asset-workspace-grid {\n  grid-template-columns: minmax(224px, 264px) minmax(0, 1fr);\n}\n\n.asset-library-rail,\n.asset-studio-column {\n  min-width: 0;\n}\n\n.asset-library-rail {\n  overflow: hidden;\n}\n\n.asset-studio-column {\n  overflow-x: hidden;\n}\n\n.asset-studio-head {\n  align-items: flex-start;\n  gap: 18px;\n  width: 100%;\n}\n\n.asset-studio-head > :first-child {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n.asset-studio-head h2 {\n  max-width: 100%;\n  overflow-wrap: anywhere;\n  text-overflow: clip;\n  white-space: normal;\n}\n\n.asset-studio-actions {\n  flex: 0 0 auto;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  max-width: min(360px, 42%);\n}\n\n.scene-editor {\n  gap: 14px;\n  max-width: 900px;\n}\n\n.asset-library-managed-note {\n  color: var(--text-muted);\n  font-size: 11px;\n  margin: -7px 0 0;\n}\n\n.scene-cast-editor.scene-asset-bindings {\n  background: var(--surface-subtle);\n  border-color: var(--border-strong);\n}\n\n.scene-asset-binding-hint {\n  color: var(--text-muted);\n  font-size: 10px;\n  line-height: 1.5;\n  margin: -6px 0 0;\n}\n\n.scene-asset-binding-categories {\n  display: grid;\n  gap: 14px;\n}\n\n.scene-asset-binding-category {\n  display: grid;\n  gap: 9px;\n}\n\n.scene-asset-binding-category + .scene-asset-binding-category {\n  border-top: 1px solid var(--border);\n  padding-top: 14px;\n}\n\n.scene-asset-binding-category-heading {\n  align-items: baseline;\n  display: flex;\n  flex-wrap: wrap;\n  gap: 7px;\n}\n\n.scene-asset-binding-category-heading strong {\n  color: var(--text-secondary);\n  font-size: 12px;\n  font-weight: 650;\n}\n\n.scene-asset-binding-category-heading small {\n  color: var(--text-muted);\n  font-size: 10px;\n}\n\n.scene-editor .editor-card {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: 8px;\n  padding: 18px 20px;\n}\n\n.scene-editor .editor-card-heading {\n  margin-bottom: 14px;\n  padding-bottom: 12px;\n}\n\n.scene-editor .profile-preview {\n  max-height: 300px;\n}\n\n@media (max-width: 900px) {\n  .asset-workspace-grid {\n    grid-template-columns: 216px minmax(0, 1fr);\n  }\n\n  .asset-studio-actions {\n    max-width: 46%;\n  }\n}\n\n@media (max-width: 680px) {\n  .asset-workspace-grid {\n    display: block;\n  }\n\n  .asset-studio-head {\n    gap: 10px;\n  }\n\n  .asset-studio-actions {\n    max-width: none;\n  }\n\n  .scene-editor .editor-card {\n    padding: 16px;\n  }\n}\n\n/* Scene workspace layout: keep navigation compact and give the production\n * brief a stable reading column instead of letting the title/actions compete. */\n.asset-workspace-grid {\n  grid-template-columns: minmax(224px, 264px) minmax(0, 1fr);\n}\n\n.asset-library-rail {\n  overflow: hidden;\n}\n\n.asset-studio-column {\n  min-width: 0;\n  overflow-x: hidden;\n}\n\n.asset-studio-head {\n  align-items: flex-start;\n  gap: 18px;\n  width: 100%;\n}\n\n.asset-studio-head > :first-child {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n.asset-studio-head h2 {\n  max-width: 100%;\n  overflow-wrap: anywhere;\n  text-overflow: clip;\n  white-space: normal;\n}\n\n.asset-studio-actions {\n  flex: 0 0 auto;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  max-width: min(360px, 42%);\n}\n\n.scene-editor {\n  gap: 14px;\n  max-width: 900px;\n}\n\n.scene-editor .editor-card {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: 8px;\n  padding: 18px 20px;\n}\n\n.scene-editor .editor-card-heading {\n  margin-bottom: 14px;\n  padding-bottom: 12px;\n}\n\n.scene-editor .profile-preview {\n  max-height: 300px;\n}\n\n@media (max-width: 900px) {\n  .asset-workspace-grid {\n    grid-template-columns: 216px minmax(0, 1fr);\n  }\n\n  .asset-studio-actions {\n    max-width: 46%;\n  }\n}\n\n@media (max-width: 680px) {\n  .asset-workspace-grid {\n    display: block;\n  }\n\n  .asset-studio-head {\n    gap: 10px;\n  }\n\n  .asset-studio-actions {\n    max-width: none;\n  }\n\n  .scene-editor .editor-card {\n    padding: 16px;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  *,\n  *::before,\n  *::after {\n    scroll-behavior: auto !important;\n    transition-duration: 0.01ms !important;\n  }\n}\n\n/*\n * Final editorial pass: the interface uses paper, one soft canvas, and ink.\n * Spacing, weight, and hairlines carry hierarchy instead of colored surfaces.\n */\n.workbench-shell {\n  background: var(--paper);\n}\n\n.topbar {\n  grid-template-columns: minmax(220px, 1fr) auto minmax(220px, 1fr);\n  height: 54px;\n  padding: 0 20px;\n}\n\n.brand-lockup {\n  gap: 8px;\n}\n\n.brand-sigil {\n  border-radius: 5px;\n  flex-basis: 27px;\n  height: 27px;\n  padding-bottom: 4px;\n}\n\n.brand-sigil i {\n  height: 6px;\n  width: 3px;\n}\n\n.brand-sigil i:nth-child(2) {\n  height: 10px;\n}\n\n.brand-sigil i:nth-child(3) {\n  height: 14px;\n}\n\n.brand-name {\n  font-size: 14px;\n  letter-spacing: -0.02em;\n}\n\n.brand-subtitle {\n  font-size: 10px;\n}\n\n.topbar-center {\n  background: transparent;\n  border-color: transparent;\n  border-radius: 0;\n  font-size: 11px;\n  height: 26px;\n  padding: 0;\n}\n\n.topbar-center strong {\n  font-weight: 600;\n}\n\n.refresh-button {\n  border-color: var(--border);\n  height: 28px;\n  padding: 0 8px;\n}\n\n.asset-workspace-grid {\n  grid-template-columns: 240px minmax(0, 1fr);\n  min-height: calc(100vh - 54px);\n}\n\n.asset-library-rail {\n  background: var(--ash);\n  height: calc(100vh - 54px);\n  padding: 18px 14px 12px;\n  top: 54px;\n}\n\n.asset-rail-heading {\n  padding: 0 4px 11px;\n}\n\n.asset-rail-heading h1 {\n  font-size: 18px;\n  font-weight: 650;\n  letter-spacing: -0.035em;\n  margin-top: 2px;\n}\n\n.asset-tabs {\n  gap: 18px;\n}\n\n.asset-tabs button {\n  font-size: 12px;\n  height: 35px;\n  padding: 0 4px;\n}\n\n.asset-tabs button.is-active::after {\n  left: 4px;\n  right: 4px;\n}\n\n.asset-tabs button.is-active:focus-visible {\n  outline: 0;\n}\n\n.scene-scope {\n  padding-bottom: 10px;\n  padding-top: 10px;\n}\n\n.asset-list-tools {\n  gap: 5px;\n  margin-bottom: 9px;\n  margin-top: 12px;\n}\n\n.asset-search,\n.add-asset-button {\n  height: 32px;\n}\n\n.asset-search {\n  border-color: var(--border);\n}\n\n.add-asset-button {\n  border-radius: 5px;\n  min-width: 60px;\n}\n\n.add-asset-button.is-secondary {\n  background: var(--paper);\n  border: 1px solid var(--border);\n  color: var(--text-secondary);\n}\n\n.add-asset-button.is-secondary:hover {\n  background: var(--ash);\n  color: var(--text);\n}\n\n.asset-list-heading {\n  margin-bottom: 6px;\n  margin-top: 7px;\n}\n\n.asset-card-list {\n  gap: 3px;\n}\n\n.asset-card {\n  border-radius: 5px;\n  gap: 9px;\n  padding: 7px 8px;\n}\n\n.asset-card:hover {\n  background: var(--paper);\n}\n\n.asset-card.is-active {\n  background: var(--paper);\n}\n\n.asset-card.is-active {\n  border-color: transparent;\n}\n\n.asset-card.is-active::before {\n  bottom: 7px;\n  left: 0;\n  top: 7px;\n}\n\n.asset-card-cover {\n  border-color: transparent;\n}\n\n.asset-studio-column {\n  background: var(--paper);\n  padding: 24px clamp(26px, 5vw, 72px) 72px;\n}\n\n.asset-studio-head,\n.character-editor,\n.shot-editor {\n  max-width: 840px;\n}\n\n.asset-studio-head {\n  margin-bottom: 16px;\n  min-height: 0;\n  padding-bottom: 14px;\n}\n\n.asset-studio-head h2 {\n  font-size: clamp(24px, 2.2vw, 29px);\n  font-weight: 680;\n  letter-spacing: -0.045em;\n  margin-top: 6px;\n}\n\n.asset-studio-actions {\n  gap: 5px;\n  padding-top: 4px;\n}\n\n.studio-action-button,\n.editor-mode-button,\n.save-button,\n.asset-primary-open,\n.source-context-toggle {\n  border-color: var(--border);\n}\n\n.studio-action-button,\n.editor-mode-button,\n.save-button,\n.asset-primary-open,\n.source-context-toggle,\n.shot-stepper {\n  border-radius: 5px;\n}\n\n.studio-action-button {\n  height: 29px;\n  padding: 0 9px;\n}\n\n.character-editor,\n.shot-editor {\n  gap: 16px;\n}\n\n.editor-card,\n.source-context-card,\n.draft-asset-note,\n.asset-primary-media,\n.asset-slot {\n  border-color: var(--border);\n  box-shadow: none;\n}\n\n.editor-card {\n  background: transparent;\n  border: 0;\n  border-radius: 0;\n  padding: 0;\n}\n\n.editor-card-heading {\n  margin-bottom: 18px;\n  padding-bottom: 14px;\n}\n\n.editor-card-heading h3,\n.section-heading h3,\n.source-context-heading h3,\n.asset-slot-heading h3 {\n  font-size: 15px;\n}\n\n.profile-preview {\n  max-height: 380px;\n  padding-right: 14px;\n}\n\n.profile-preview h4 {\n  font-size: 15px;\n  margin-bottom: 9px;\n}\n\n.profile-preview h4:not(:first-child) {\n  margin-top: 18px;\n  padding-top: 16px;\n}\n\n.profile-preview p {\n  line-height: 1.82;\n  margin-bottom: 8px;\n}\n\n.editor-hint {\n  border-top: 0;\n  margin-top: 11px;\n  padding-top: 0;\n}\n\n.eyebrow,\n.asset-field > span {\n  font-size: 12px;\n}\n\n.asset-card-copy small,\n.shot-list-copy small,\n.asset-list-heading small,\n.section-heading > span {\n  font-size: 11px;\n}\n\n.section-heading {\n  padding: 2px 2px 0;\n}\n\n.slot-grid {\n  gap: 12px;\n}\n\n.asset-slot {\n  border-radius: 8px;\n}\n\n.asset-slot-heading {\n  padding: 13px 14px 11px;\n}\n\n.asset-slot-body {\n  background: var(--paper);\n  min-height: 150px;\n}\n\n.slot-empty {\n  background: var(--ash);\n  border-color: var(--border);\n  min-height: 126px;\n}\n\n.slot-empty-icon {\n  border-color: var(--border-strong);\n}\n\n.slot-upload-button {\n  background: var(--paper);\n  color: var(--text-secondary);\n}\n\n.slot-upload-button:hover:not(:disabled) {\n  background: var(--ash);\n}\n\n.asset-field input,\n.asset-field textarea,\n.profile-textarea,\n.scene-picker select {\n  border-color: var(--border);\n}\n\n.asset-field input,\n.asset-field textarea,\n.profile-textarea {\n  background: var(--paper);\n}\n\n.modal-card,\n.media-lightbox {\n  box-shadow: 0 18px 50px var(--ink-14);\n}\n\n@media (max-width: 900px) {\n  .asset-workspace-grid {\n    grid-template-columns: 216px minmax(0, 1fr);\n  }\n\n  .asset-studio-column {\n    padding-left: 24px;\n    padding-right: 24px;\n  }\n}\n\n@media (max-width: 680px) {\n  .topbar {\n    grid-template-columns: 1fr auto;\n    height: 51px;\n    padding: 0 13px;\n  }\n\n  .topbar-center {\n    display: none;\n  }\n\n  .asset-workspace-grid {\n    min-height: calc(100vh - 51px);\n  }\n\n  .asset-library-rail {\n    height: auto;\n    padding: 14px 12px 11px;\n    position: relative;\n    top: auto;\n  }\n\n  .asset-rail-heading {\n    padding-bottom: 9px;\n  }\n\n  .asset-rail-heading h1 {\n    font-size: 17px;\n  }\n\n  .asset-tabs {\n    gap: 16px;\n  }\n\n  .asset-tabs button {\n    height: 34px;\n  }\n\n  .refresh-button {\n    white-space: nowrap;\n  }\n\n  .asset-list-tools {\n    margin-top: 10px;\n  }\n\n  .scene-scope {\n    padding-bottom: 8px;\n    padding-top: 8px;\n  }\n\n  .scene-picker > span,\n  .scene-scope small,\n  .asset-list-heading {\n    display: none;\n  }\n\n  .scene-picker {\n    display: block;\n  }\n\n  .import-storyboard-button {\n    height: 31px;\n    margin-bottom: 6px;\n  }\n\n  .asset-card-list {\n    gap: 6px;\n    max-height: 56px;\n  }\n\n  .asset-card {\n    flex-basis: 174px;\n  }\n\n  .asset-studio-column {\n    padding: 25px 14px 42px;\n  }\n\n  .asset-studio-head {\n    margin-bottom: 18px;\n    padding-bottom: 16px;\n  }\n\n  .asset-studio-head h2 {\n    font-size: 24px;\n  }\n\n  .editor-card {\n    border-radius: 0;\n    padding: 0;\n  }\n\n  .profile-preview {\n    max-height: none;\n    padding-right: 0;\n  }\n\n  .section-heading {\n    padding-left: 1px;\n    padding-right: 1px;\n  }\n\n  .character-slot-grid {\n    grid-template-columns: 1fr;\n  }\n\n  .character-slot-grid > .asset-slot:first-child {\n    grid-column: auto;\n  }\n}\n\n/* Keep the two top panels balanced, then give visual material a full-width row. */\n@media (min-width: 1180px) {\n  .asset-studio-head.is-character-studio,\n  .character-editor {\n    max-width: 1360px;\n    width: 100%;\n  }\n\n  .asset-studio-column {\n    padding-top: 20px;\n  }\n\n  .asset-studio-head.is-character-studio {\n    margin-bottom: 14px;\n  }\n\n  .character-editor {\n    align-items: start;\n    column-gap: 28px;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n    row-gap: 24px;\n  }\n\n  .character-editor > .profile-editor {\n    align-self: stretch;\n    grid-column: 1;\n    grid-row: 1;\n  }\n\n  .character-editor > .slot-section {\n    align-self: start;\n    grid-column: 2;\n    grid-row: 1;\n  }\n\n  .character-editor.has-character-visuals > .character-visual-board {\n    align-self: stretch;\n    grid-column: 1;\n    grid-row: 1;\n  }\n\n  .character-editor.has-character-visuals > .profile-editor {\n    grid-column: 2;\n    grid-row: 1;\n  }\n\n  .character-editor.has-character-visuals > .slot-section {\n    grid-column: 1 / -1;\n    grid-row: 2;\n  }\n\n  .character-editor.has-primary-media > .asset-primary-media {\n    grid-column: 2;\n    grid-row: 1;\n    grid-template-columns: 1fr;\n    padding: 10px;\n  }\n\n  .character-editor.has-primary-media > .slot-section {\n    grid-column: 1 / -1;\n    grid-row: 2;\n  }\n\n  /* A long role brief should not push the visual-material row far below the fold. */\n  .character-editor .profile-preview {\n    max-height: 420px;\n  }\n\n  .character-editor .asset-primary-visual {\n    min-height: 250px;\n  }\n\n  .character-editor .asset-primary-meta {\n    padding: 2px 3px 3px;\n  }\n\n  .character-editor .character-slot-grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n\n  .character-editor .character-slot-grid > .asset-slot:first-child {\n    grid-column: 1 / -1;\n    grid-template-rows: auto minmax(246px, 1fr) auto;\n  }\n\n  .character-editor .asset-slot {\n    grid-template-rows: auto minmax(116px, 1fr) auto;\n  }\n\n  .character-editor .asset-slot-body {\n    min-height: 126px;\n  }\n\n  .character-editor .character-slot-grid > .asset-slot:first-child .asset-slot-body {\n    min-height: 266px;\n  }\n\n  .character-editor .slot-empty {\n    min-height: 106px;\n  }\n\n  .character-editor .character-slot-grid > .asset-slot:first-child .slot-empty {\n    min-height: 244px;\n  }\n\n  .character-editor .slot-section {\n    gap: 10px;\n  }\n}\n\n@media (max-width: 680px) {\n  .character-visual-board {\n    grid-template-columns: 1fr;\n  }\n\n  .character-visual-main {\n    grid-template-rows: auto minmax(204px, 1fr) auto;\n  }\n\n  .character-visual-main-button {\n    min-height: 204px;\n  }\n\n  .character-visual-supporting-grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n\n  .character-visual-supporting-card {\n    grid-template-rows: 104px auto;\n  }\n}\n\n/* One restrained select treatment keeps scene and role controls in the same visual language. */\n.select-field {\n  display: grid;\n  gap: 6px;\n  min-width: 0;\n}\n\n.select-field-label {\n  color: var(--text-secondary);\n  font-size: 11px;\n  font-weight: 600;\n  line-height: 1.2;\n}\n\n.select-control {\n  min-width: 0;\n  position: relative;\n}\n\n.select-control::after {\n  border-bottom: 1.5px solid var(--text-secondary);\n  border-right: 1.5px solid var(--text-secondary);\n  content: "";\n  height: 6px;\n  pointer-events: none;\n  position: absolute;\n  right: 13px;\n  top: 50%;\n  transform: translateY(-65%) rotate(45deg);\n  transition: border-color 120ms ease, transform 120ms ease;\n  width: 6px;\n}\n\n.select-control:hover::after,\n.select-control:focus-within::after {\n  border-color: var(--text);\n}\n\n.select-control select {\n  -webkit-appearance: none;\n  appearance: none;\n  background: var(--paper);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  color: var(--text);\n  cursor: pointer;\n  display: block;\n  font-size: 13px;\n  height: 36px;\n  line-height: 1.35;\n  min-width: 0;\n  outline: 0;\n  padding: 0 36px 0 11px;\n  text-overflow: ellipsis;\n  transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease;\n  width: 100%;\n}\n\n.select-control select:hover:not(:disabled) {\n  background: var(--ash);\n  border-color: var(--border-strong);\n}\n\n.select-control select:focus-visible {\n  border-color: var(--ink);\n  box-shadow: 0 0 0 3px var(--focus);\n}\n\n.select-control select:disabled {\n  cursor: not-allowed;\n}\n\n.select-field.is-disabled .select-control::after {\n  opacity: 0.55;\n}\n\n.select-control select option {\n  background: var(--paper);\n  color: var(--text);\n}\n\n/* The title control is intentionally compact, while retaining the same arrow and focus treatment. */\n.character-role-picker {\n  display: inline-flex;\n  gap: 0;\n  vertical-align: middle;\n}\n\n.character-role-picker .select-control {\n  width: 126px;\n}\n\n.character-role-picker .select-control select {\n  font-size: 12px;\n  height: 30px;\n  padding-left: 10px;\n  padding-right: 30px;\n}\n\n.character-role-picker .select-control::after {\n  right: 11px;\n}\n\n/* Do not let the generic asset-field label rule style the wrapper around the select. */\n.asset-field > .select-control {\n  color: inherit;\n  font-size: inherit;\n  font-weight: inherit;\n  line-height: inherit;\n}\n\n.asset-field > .select-control select {\n  min-height: 36px;\n  padding-bottom: 0;\n  padding-top: 0;\n}\n\n@media (max-width: 680px) {\n  .character-role-picker .select-control {\n    width: 116px;\n  }\n}\n\n/* Custom menu surface: the native OS popup is replaced with a quiet, keyboard-friendly menu. */\n.select-field {\n  position: relative;\n}\n\n.select-control {\n  position: relative;\n}\n\n.select-control::after {\n  display: none;\n}\n\n.select-trigger {\n  align-items: center;\n  appearance: none;\n  background: var(--paper);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  color: var(--text);\n  cursor: pointer;\n  display: flex;\n  gap: 10px;\n  height: 36px;\n  justify-content: space-between;\n  min-width: 0;\n  outline: 0;\n  padding: 0 11px;\n  text-align: left;\n  transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease;\n  width: 100%;\n}\n\n.select-trigger:hover:not(:disabled) {\n  background: var(--ash);\n  border-color: var(--border-strong);\n}\n\n.select-trigger:focus-visible {\n  border-color: var(--ink);\n  box-shadow: 0 0 0 3px var(--focus);\n}\n\n.select-trigger-value {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.select-trigger-chevron {\n  border-bottom: 1.5px solid var(--text-secondary);\n  border-right: 1.5px solid var(--text-secondary);\n  flex: 0 0 7px;\n  height: 7px;\n  transform: translateY(-2px) rotate(45deg);\n  transition: border-color 120ms ease, transform 120ms ease;\n  width: 7px;\n}\n\n.select-trigger:hover:not(:disabled) .select-trigger-chevron,\n.select-trigger:focus-visible .select-trigger-chevron {\n  border-color: var(--text);\n}\n\n.select-trigger-chevron.is-open {\n  transform: translateY(2px) rotate(225deg);\n}\n\n.select-menu {\n  animation: select-menu-in 110ms ease-out;\n  background: var(--paper);\n  border: 1px solid var(--border-strong);\n  border-radius: var(--radius-md);\n  box-shadow: 0 12px 26px var(--ink-14);\n  display: grid;\n  gap: 2px;\n  left: 0;\n  max-height: 280px;\n  min-width: 100%;\n  overflow-y: auto;\n  padding: 4px;\n  position: absolute;\n  right: 0;\n  scrollbar-color: var(--border-strong) transparent;\n  scrollbar-width: thin;\n  top: calc(100% + 5px);\n  z-index: 140;\n}\n\n.select-option {\n  align-items: center;\n  background: transparent;\n  border-radius: calc(var(--radius-md) - 2px);\n  color: var(--text-secondary);\n  display: flex;\n  font-size: 12px;\n  gap: 10px;\n  justify-content: space-between;\n  min-height: 32px;\n  padding: 0 9px;\n  text-align: left;\n  width: 100%;\n}\n\n.select-option:hover,\n.select-option:focus-visible {\n  background: var(--ash);\n  color: var(--text);\n  outline: 0;\n}\n\n.select-option.is-selected {\n  background: var(--ink-soft);\n  color: var(--text);\n  font-weight: 600;\n}\n\n.select-option.is-highlighted:not(.is-selected) {\n  background: var(--ash);\n  color: var(--text);\n}\n\n.select-option.is-selected.is-highlighted {\n  background: var(--ink-soft);\n}\n\n.select-option-check {\n  color: var(--ink);\n  font-size: 12px;\n  font-weight: 700;\n}\n\n.character-role-badge {\n  align-items: center;\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: 999px;\n  color: var(--text-secondary);\n  display: inline-flex;\n  font-size: 11px;\n  font-weight: 600;\n  gap: 5px;\n  height: 28px;\n  padding: 0 9px;\n  white-space: nowrap;\n}\n\n.character-role-badge-lock {\n  color: var(--text-muted);\n  font-size: 12px;\n  line-height: 1;\n  transform: rotate(-25deg);\n}\n\n.modal-field-hint {\n  color: var(--text-muted);\n  font-size: 11px;\n  line-height: 1.6;\n  margin: 8px 0 0;\n}\n\n/* The directory viewer stays out of the workspace layout until it is needed. */\n.project-structure-float {\n  bottom: 14px;\n  left: 14px;\n  position: fixed;\n  z-index: 180;\n}\n\n.project-structure-fab {\n  align-items: center;\n  background: var(--paper);\n  border: 1px solid var(--border-strong);\n  border-radius: 50%;\n  box-shadow: 0 3px 10px var(--ink-8);\n  color: var(--text-secondary);\n  display: inline-flex;\n  height: 36px;\n  justify-content: center;\n  opacity: 0.72;\n  padding: 0;\n  transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease;\n  width: 36px;\n}\n\n.project-structure-fab:hover,\n.project-structure-fab:focus-visible,\n.project-structure-fab.is-open {\n  background: var(--surface-subtle);\n  border-color: var(--ink);\n  box-shadow: 0 5px 14px var(--ink-14);\n  opacity: 1;\n}\n\n.project-structure-fab-icon {\n  border: 1.4px solid currentColor;\n  border-radius: 2px;\n  display: block;\n  height: 11px;\n  position: relative;\n  width: 15px;\n}\n\n.project-structure-fab-icon::before {\n  border: 1.4px solid currentColor;\n  border-bottom: 0;\n  border-radius: 2px 2px 0 0;\n  content: "";\n  height: 3px;\n  left: 1px;\n  position: absolute;\n  top: -4px;\n  width: 6px;\n}\n\n.project-structure-fab-icon::after {\n  border-top: 1px solid currentColor;\n  content: "";\n  left: 3px;\n  opacity: 0.66;\n  position: absolute;\n  right: 3px;\n  top: 5px;\n}\n\n.project-structure-panel {\n  background: var(--paper);\n  border: 1px solid var(--border-strong);\n  border-radius: var(--radius-md);\n  bottom: 45px;\n  box-shadow: 0 14px 34px var(--ink-14);\n  display: grid;\n  grid-template-rows: auto minmax(0, 1fr);\n  left: 0;\n  max-height: min(560px, calc(100vh - 88px));\n  overflow: hidden;\n  position: absolute;\n  width: min(360px, calc(100vw - 28px));\n}\n\n.project-structure-head {\n  align-items: center;\n  border-bottom: 1px solid var(--border);\n  display: flex;\n  gap: 12px;\n  justify-content: space-between;\n  padding: 11px 11px 10px 13px;\n}\n\n.project-structure-head h2 {\n  font-size: 13px;\n  font-weight: 650;\n  letter-spacing: -0.015em;\n  margin: 2px 0 0;\n  max-width: 260px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.project-structure-refresh {\n  align-items: center;\n  background: transparent;\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  color: var(--text-secondary);\n  display: inline-flex;\n  flex: 0 0 28px;\n  font-size: 14px;\n  height: 28px;\n  justify-content: center;\n  padding: 0;\n}\n\n.project-structure-refresh:hover:not(:disabled) {\n  background: var(--surface-subtle);\n  border-color: var(--border-strong);\n  color: var(--text);\n}\n\n.project-structure-body {\n  max-height: min(480px, calc(100vh - 150px));\n  overflow: auto;\n  padding: 6px 5px 8px;\n  scrollbar-color: var(--border-strong) transparent;\n  scrollbar-width: thin;\n}\n\n.project-structure-status {\n  color: var(--text-muted);\n  font-size: 11px;\n  line-height: 1.6;\n  margin: 16px 10px;\n  text-align: center;\n}\n\n.project-structure-status.is-error {\n  color: var(--text-secondary);\n}\n\n.structure-tree,\n.structure-tree-branch {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n}\n\n.structure-tree-row {\n  align-items: center;\n  background: transparent;\n  color: var(--text-secondary);\n  display: flex;\n  font-size: 11px;\n  gap: 6px;\n  min-height: 27px;\n  padding-bottom: 0;\n  padding-right: 8px;\n  padding-top: 0;\n  text-align: left;\n  width: 100%;\n}\n\n.structure-tree-folder {\n  cursor: pointer;\n}\n\n.structure-tree-folder:hover,\n.structure-tree-folder:focus-visible {\n  background: var(--surface-subtle);\n  color: var(--text);\n  outline: 0;\n}\n\n.structure-tree-disclosure {\n  flex: 0 0 10px;\n  height: 12px;\n  position: relative;\n}\n\n.structure-tree-disclosure:not(.is-empty)::before {\n  border-bottom: 1.3px solid currentColor;\n  border-right: 1.3px solid currentColor;\n  content: "";\n  height: 5px;\n  left: 1px;\n  position: absolute;\n  top: 3px;\n  transform: rotate(-45deg);\n  transition: transform 110ms ease;\n  width: 5px;\n}\n\n.structure-tree-disclosure.is-expanded::before {\n  top: 2px;\n  transform: rotate(45deg);\n}\n\n.structure-tree-icon {\n  flex: 0 0 auto;\n  position: relative;\n}\n\n.structure-tree-icon.is-folder {\n  border: 1px solid currentColor;\n  border-radius: 2px;\n  height: 9px;\n  margin-top: 2px;\n  opacity: 0.75;\n  width: 12px;\n}\n\n.structure-tree-icon.is-folder::before {\n  border: 1px solid currentColor;\n  border-bottom: 0;\n  border-radius: 2px 2px 0 0;\n  content: "";\n  height: 3px;\n  left: 1px;\n  position: absolute;\n  top: -4px;\n  width: 5px;\n}\n\n.structure-tree-icon.is-file {\n  border: 1px solid currentColor;\n  border-radius: 1px;\n  height: 12px;\n  opacity: 0.55;\n  width: 9px;\n}\n\n.structure-tree-icon.is-file::after {\n  border-top: 1px solid currentColor;\n  content: "";\n  left: 2px;\n  position: absolute;\n  right: 2px;\n  top: 4px;\n}\n\n.structure-tree-name {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.revision-conflict-notice {\n  align-items: center;\n  background: var(--surface-subtle);\n  border: 1px solid var(--border-strong);\n  border-radius: var(--radius-md);\n  display: flex;\n  gap: 14px;\n  justify-content: space-between;\n  margin-bottom: 12px;\n  padding: 11px 12px;\n}\n\n.revision-conflict-notice div {\n  min-width: 0;\n}\n\n.revision-conflict-notice strong {\n  color: var(--text);\n  font-size: 12px;\n  font-weight: 650;\n}\n\n.revision-conflict-notice p {\n  color: var(--text-secondary);\n  font-size: 11px;\n  line-height: 1.55;\n  margin: 3px 0 0;\n}\n\n.revision-conflict-notice button {\n  background: var(--paper);\n  border: 1px solid var(--border-strong);\n  border-radius: var(--radius-sm);\n  color: var(--text);\n  flex: 0 0 auto;\n  font-size: 11px;\n  padding: 6px 8px;\n}\n\n.revision-conflict-notice button:hover:not(:disabled) {\n  background: var(--ink);\n  color: var(--paper);\n}\n\n@media (max-width: 560px) {\n  .revision-conflict-notice {\n    align-items: flex-start;\n    flex-direction: column;\n    gap: 8px;\n  }\n\n  .turnaround-selection-summary {\n    align-items: flex-start;\n    flex-direction: column;\n    gap: 4px;\n  }\n\n  .turnaround-selection-summary small {\n    flex-basis: auto;\n    text-align: left;\n  }\n\n  .project-structure-float {\n    bottom: 12px;\n    left: 12px;\n  }\n\n  .project-structure-panel {\n    bottom: 44px;\n    width: calc(100vw - 24px);\n  }\n}\n\n@keyframes select-menu-in {\n  from {\n    opacity: 0;\n    transform: translateY(-3px);\n  }\n  to {\n    opacity: 1;\n    transform: translateY(0);\n  }\n}\n\n/* A scene is a real production folder above its shots, so it gets a quiet\n   entry point in the rail rather than being hidden inside the shot list. */\n.scene-create-actions {\n  display: flex;\n  flex: 0 0 auto;\n  gap: 5px;\n}\n\n.scene-create-actions .add-asset-button {\n  min-width: 0;\n  padding-left: 7px;\n  padding-right: 7px;\n}\n\n.scene-asset-summary {\n  margin: 1px 0 10px;\n}\n\n.scene-asset-card {\n  align-items: center;\n  background: var(--paper);\n  border: 1px solid var(--border);\n  border-radius: 7px;\n  color: var(--text-secondary);\n  display: flex;\n  gap: 9px;\n  min-height: 58px;\n  padding: 8px;\n  text-align: left;\n  transition: background-color 120ms ease, border-color 120ms ease;\n  width: 100%;\n}\n\n.scene-asset-card:hover,\n.scene-asset-card:focus-visible,\n.scene-asset-card.is-active {\n  background: var(--surface-subtle);\n  border-color: var(--border-strong);\n  color: var(--text);\n  outline: 0;\n}\n\n.scene-asset-card-mark {\n  align-items: center;\n  background: var(--ash);\n  border: 1px solid var(--border);\n  border-radius: 5px;\n  color: var(--text-secondary);\n  display: inline-flex;\n  flex: 0 0 30px;\n  font-size: 11px;\n  font-weight: 650;\n  height: 30px;\n  justify-content: center;\n}\n\n.scene-asset-card-copy {\n  display: grid;\n  gap: 1px;\n  min-width: 0;\n}\n\n.scene-asset-card-copy small,\n.scene-asset-card-copy em {\n  color: var(--text-muted);\n  font-size: 10px;\n  font-style: normal;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.scene-asset-card-copy strong {\n  color: var(--text);\n  font-size: 12px;\n  font-weight: 650;\n}\n\n.scene-asset-create-note {\n  background: transparent;\n  border: 1px dashed var(--border-strong);\n  border-radius: 7px;\n  color: var(--text-secondary);\n  display: grid;\n  gap: 4px;\n  margin: 1px 0 10px;\n  padding: 9px 10px;\n  text-align: left;\n  width: 100%;\n}\n\n.scene-asset-create-note:hover:not(:disabled),\n.scene-asset-create-note:focus-visible {\n  background: var(--paper);\n  border-color: var(--ink);\n  color: var(--text);\n  outline: 0;\n}\n\n.scene-asset-create-note span {\n  font-size: 11px;\n}\n\n.scene-asset-create-note b {\n  font-size: 11px;\n  font-weight: 650;\n}\n\n.scene-editor {\n  display: grid;\n  gap: 16px;\n  margin: 0 auto;\n  max-width: 840px;\n}\n\n.scene-setup-empty {\n  display: grid;\n  gap: 8px;\n  max-width: 640px;\n}\n\n.scene-setup-empty strong {\n  font-size: 14px;\n  font-weight: 650;\n}\n\n.scene-setup-empty p {\n  color: var(--text-secondary);\n  font-size: 12px;\n  line-height: 1.7;\n  margin: 0;\n}\n\n.scene-setup-empty .save-button {\n  justify-self: start;\n  margin-top: 3px;\n}\n\n.scene-complete-button {\n  background: transparent;\n  border: 1px solid var(--border);\n  border-radius: 5px;\n  color: var(--text-secondary);\n  font-size: 11px;\n  justify-self: start;\n  margin-top: 12px;\n  padding: 6px 8px;\n}\n\n.scene-complete-button:hover:not(:disabled),\n.scene-complete-button:focus-visible {\n  background: var(--ash);\n  border-color: var(--border-strong);\n  color: var(--text);\n  outline: 0;\n}\n\n.scene-slot-grid > .asset-slot:first-child {\n  grid-column: span 2;\n}\n\n@media (min-width: 1180px) {\n  .asset-studio-head.is-scene-studio,\n  .scene-editor {\n    max-width: 1040px;\n    width: 100%;\n  }\n\n  .scene-editor .asset-primary-media {\n    max-width: 700px;\n  }\n}\n\n@media (max-width: 680px) {\n  .scene-create-actions .add-asset-button b {\n    display: inline;\n  }\n\n  .scene-asset-summary {\n    margin-bottom: 7px;\n  }\n\n  .scene-asset-card {\n    min-height: 48px;\n  }\n\n  .scene-asset-create-note {\n    margin-bottom: 7px;\n  }\n\n  .scene-slot-grid > .asset-slot:first-child {\n    grid-column: auto;\n  }\n}\n\n/* Final visual polish: selection is clear without turning metadata into the focal point. */\n.studio-action-button.is-danger {\n  background: var(--paper);\n  border-color: var(--border);\n  color: var(--text-muted);\n}\n\n.studio-action-button.is-danger:hover:not(:disabled),\n.studio-action-button.is-danger:focus-visible {\n  background: var(--ash);\n  border-color: var(--border-strong);\n  color: var(--text-secondary);\n  outline: 0;\n}\n\n.character-visual-board {\n  background: transparent;\n  gap: 8px;\n  padding: 8px;\n}\n\n.character-visual-main,\n.character-visual-supporting {\n  background: var(--paper);\n}\n\n.character-visual-board-heading {\n  padding: 9px 10px 7px;\n}\n\n.character-visual-main-button,\n.character-visual-supporting-button {\n  background: var(--ash);\n}\n\n.character-visual-file-name {\n  background: var(--paper);\n  padding: 6px 10px 8px;\n}\n\n.character-visual-supporting {\n  padding: 8px;\n}\n\n.character-visual-supporting > .eyebrow {\n  margin-bottom: 6px;\n}\n\n.character-visual-supporting-grid {\n  gap: 8px;\n}\n\n.character-visual-supporting-card > div {\n  background: var(--paper);\n  padding: 5px 7px 6px;\n}\n\n/* Reusable character looks: quiet controls that keep the identity separate from costume variants. */\n.character-look-switcher,\n.scene-cast-editor,\n.shot-character-plan {\n  background: var(--paper);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n}\n\n.character-look-switcher {\n  align-items: center;\n  display: flex;\n  gap: 20px;\n  justify-content: space-between;\n  padding: 14px 16px;\n}\n\n.character-look-switcher h3,\n.scene-cast-editor h3,\n.shot-character-plan h3 {\n  color: var(--text);\n  font-size: 15px;\n  letter-spacing: -0.02em;\n  margin: 2px 0 0;\n}\n\n.character-look-switcher p:not(.eyebrow),\n.scene-cast-intro,\n.shot-character-plan-intro {\n  color: var(--text-muted);\n  font-size: 11px;\n  line-height: 1.65;\n  margin: 5px 0 0;\n}\n\n.character-look-switcher-actions,\n.scene-cast-actions {\n  align-items: center;\n  display: flex;\n  flex: 0 0 auto;\n  gap: 8px;\n}\n\n.character-look-picker {\n  min-width: 220px;\n}\n\n.character-look-picker .select-trigger {\n  min-height: 34px;\n}\n\n.look-document-editor {\n  min-width: 0;\n}\n\n.scene-cast-editor,\n.shot-character-plan {\n  display: grid;\n  gap: 12px;\n  padding: 16px;\n}\n\n.scene-cast-editor > .section-heading,\n.shot-character-plan > .section-heading {\n  padding: 0;\n}\n\n.scene-cast-list,\n.shot-character-override-list {\n  display: grid;\n  gap: 10px;\n}\n\n.scene-cast-row,\n.shot-character-override {\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  display: grid;\n  gap: 10px;\n  padding: 11px;\n}\n\n.scene-cast-row-head {\n  align-items: center;\n  display: flex;\n  justify-content: space-between;\n}\n\n.scene-cast-row-head strong {\n  color: var(--text-secondary);\n  font-size: 11px;\n  font-weight: 650;\n}\n\n.scene-cast-row-grid {\n  display: grid;\n  gap: 10px;\n  grid-template-columns: minmax(130px, 1fr) minmax(170px, 1.25fr) minmax(110px, 0.7fr) minmax(110px, 0.7fr);\n}\n\n.scene-cast-row-notes {\n  border-top: 1px solid var(--border);\n  display: grid;\n  gap: 10px;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  padding-top: 10px;\n}\n\n.scene-cast-empty,\n.shot-inherited-empty {\n  background: var(--surface-subtle);\n  border: 1px dashed var(--border);\n  border-radius: var(--radius-sm);\n  color: var(--text-muted);\n  font-size: 12px;\n  padding: 14px;\n}\n\n.scene-cast-empty strong {\n  color: var(--text-secondary);\n  display: block;\n  font-size: 12px;\n  margin-bottom: 3px;\n}\n\n.scene-cast-empty p {\n  margin: 0;\n}\n\n.shot-inherited-cast {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.shot-effective-cast {\n  border-top: 1px solid var(--border);\n  display: grid;\n  gap: 8px;\n  padding-top: 12px;\n}\n\n.shot-effective-cast-heading {\n  align-items: baseline;\n  display: flex;\n  flex-wrap: wrap;\n  gap: 7px;\n}\n\n.shot-effective-cast-heading strong {\n  color: var(--text-secondary);\n  font-size: 11px;\n  font-weight: 650;\n}\n\n.shot-effective-cast-heading small {\n  color: var(--text-muted);\n  font-size: 10px;\n}\n\n.shot-inherited-cast-card {\n  align-items: center;\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  display: flex;\n  gap: 8px;\n  max-width: 100%;\n  min-width: 210px;\n  padding: 7px;\n}\n\n.shot-inherited-cast-image,\n.shot-inherited-cast-mark {\n  align-items: center;\n  background: var(--ash);\n  border: 0;\n  border-radius: 4px;\n  color: var(--text-muted);\n  display: flex;\n  flex: 0 0 34px;\n  height: 42px;\n  justify-content: center;\n  overflow: hidden;\n  padding: 0;\n  width: 34px;\n}\n\n.shot-inherited-cast-image {\n  cursor: zoom-in;\n}\n\n.shot-inherited-cast-image img {\n  height: 100%;\n  object-fit: cover;\n  width: 100%;\n}\n\n.shot-inherited-cast-card > div {\n  display: grid;\n  gap: 1px;\n  min-width: 0;\n}\n\n.shot-inherited-cast-card strong {\n  color: var(--text);\n  font-size: 12px;\n}\n\n.shot-inherited-cast-card small,\n.shot-inherited-cast-card em {\n  color: var(--text-muted);\n  font-size: 10px;\n  font-style: normal;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.shot-inherited-cast-card em {\n  color: var(--text-secondary);\n}\n\n@media (min-width: 1180px) {\n  .character-editor > .character-look-switcher {\n    grid-column: 1 / -1;\n    grid-row: auto;\n  }\n\n  .character-editor:not(.has-character-visuals) > .profile-editor {\n    grid-column: 1;\n    grid-row: auto;\n  }\n\n  .character-editor:not(.has-character-visuals) > .slot-section {\n    grid-column: 2;\n    grid-row: auto;\n  }\n\n  .character-editor.has-character-visuals > .character-look-switcher,\n  .character-editor.has-character-visuals > .slot-section {\n    grid-column: 1 / -1;\n    grid-row: auto;\n  }\n\n  .character-editor.has-character-visuals > .character-visual-board {\n    grid-column: 1;\n    grid-row: auto;\n  }\n\n  .character-editor.has-character-visuals > .look-document-editor {\n    grid-column: 2;\n    grid-row: auto;\n  }\n\n  .character-editor.has-character-visuals > .profile-editor {\n    grid-column: 1 / -1;\n    grid-row: auto;\n  }\n}\n\n@media (max-width: 900px) {\n  .scene-cast-row-grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}\n\n@media (max-width: 680px) {\n  .character-look-switcher,\n  .character-look-switcher-actions,\n  .scene-cast-actions {\n    align-items: stretch;\n    flex-direction: column;\n  }\n\n  .character-look-switcher {\n    align-items: stretch;\n  }\n\n  .character-look-picker {\n    min-width: 0;\n    width: 100%;\n  }\n\n  .scene-cast-editor,\n  .shot-character-plan {\n    padding: 12px;\n  }\n\n  .scene-cast-row-grid,\n  .scene-cast-row-notes {\n    grid-template-columns: 1fr;\n  }\n\n  .shot-inherited-cast-card {\n    min-width: 0;\n    width: 100%;\n  }\n}\n\n/* Keep character writing and visual decisions in distinct, stable columns. */\n.character-work-area,\n.character-copy-column,\n.character-media-column {\n  display: grid;\n  min-width: 0;\n}\n\n.character-work-area {\n  gap: 22px;\n}\n\n.character-copy-column,\n.character-media-column {\n  align-content: start;\n  gap: 24px;\n}\n\n/* Character and LOOK briefs must grow with the page instead of hiding text in a nested scroller. */\n.character-copy-column .profile-preview {\n  max-height: none;\n  overflow: visible;\n}\n\n@media (min-width: 1080px) {\n  .asset-studio-head.is-character-studio,\n  .character-editor {\n    max-width: 1120px;\n  }\n\n  .character-work-area {\n    align-items: start;\n    column-gap: 34px;\n    grid-template-columns: minmax(0, 1fr) minmax(360px, 0.96fr);\n  }\n\n  .character-editor > .character-work-area {\n    grid-column: 1 / -1;\n  }\n\n  .character-media-column .character-visual-board {\n    margin-top: 1px;\n  }\n\n  .character-media-column .character-slot-grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n\n  .character-media-column .character-slot-grid > .asset-slot:first-child {\n    grid-column: 1 / -1;\n  }\n}\n\n/* Project switching is a compact command, not another navigation rail. */\n.project-switcher {\n  position: relative;\n  z-index: 80;\n}\n\n.project-switcher-trigger {\n  align-items: center;\n  background: var(--paper);\n  border: 1px solid var(--border);\n  border-radius: 999px;\n  color: var(--text-muted);\n  display: inline-flex;\n  font-size: 11px;\n  gap: 6px;\n  height: 28px;\n  max-width: min(360px, 34vw);\n  min-width: 0;\n  padding: 0 10px;\n  transition: background-color 120ms ease, border-color 120ms ease;\n}\n\n.project-switcher-trigger:hover:not(:disabled),\n.project-switcher.is-open .project-switcher-trigger {\n  background: var(--surface-subtle);\n  border-color: var(--border-strong);\n  color: var(--text-secondary);\n}\n\n.project-switcher-trigger strong {\n  color: var(--text);\n  font-weight: 600;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.project-switcher .status-dot {\n  flex: 0 0 auto;\n}\n\n.project-switcher-chevron {\n  border-bottom: 1px solid currentColor;\n  border-right: 1px solid currentColor;\n  height: 5px;\n  margin: -3px 1px 0 2px;\n  transform: rotate(45deg);\n  transition: transform 120ms ease;\n  width: 5px;\n}\n\n.project-switcher.is-open .project-switcher-chevron {\n  margin-top: 3px;\n  transform: rotate(225deg);\n}\n\n.project-picker {\n  background: var(--paper);\n  border: 1px solid var(--border);\n  border-radius: 10px;\n  box-shadow: 0 18px 46px rgba(32, 32, 29, 0.14);\n  left: 50%;\n  max-height: min(520px, calc(100vh - 86px));\n  overflow: auto;\n  padding: 14px;\n  position: absolute;\n  top: calc(100% + 10px);\n  transform: translateX(-50%);\n  width: min(370px, calc(100vw - 28px));\n}\n\n.project-picker-heading,\n.project-picker-footer,\n.project-create-actions,\n.project-picker-option,\n.project-picker-search,\n.project-create-field {\n  align-items: center;\n  display: flex;\n}\n\n.project-picker-heading {\n  justify-content: space-between;\n  margin-bottom: 12px;\n}\n\n.project-picker-heading .eyebrow {\n  color: var(--text-muted);\n  font-size: 10px;\n  letter-spacing: 0.07em;\n  text-transform: uppercase;\n}\n\n.project-picker-heading h2 {\n  color: var(--text);\n  font-size: 16px;\n  letter-spacing: -0.02em;\n  line-height: 1.2;\n  margin: 3px 0 0;\n}\n\n.project-picker-close {\n  background: transparent;\n  border: 1px solid var(--border);\n  border-radius: 5px;\n  color: var(--text-secondary);\n  font-size: 18px;\n  height: 26px;\n  line-height: 1;\n  width: 26px;\n}\n\n.project-picker-close:hover:not(:disabled) {\n  background: var(--surface-subtle);\n  border-color: var(--border-strong);\n  color: var(--text);\n}\n\n.project-picker-search {\n  background: var(--surface-subtle);\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  color: var(--text-muted);\n  gap: 7px;\n  height: 34px;\n  padding: 0 9px;\n}\n\n.project-picker-search > span {\n  font-size: 16px;\n  line-height: 1;\n}\n\n.project-picker-search input,\n.project-create-field input {\n  background: transparent;\n  border: 0;\n  color: var(--text);\n  font-size: 12px;\n  min-width: 0;\n  outline: 0;\n  width: 100%;\n}\n\n.project-picker-search button {\n  background: transparent;\n  color: var(--text-muted);\n  font-size: 15px;\n  line-height: 1;\n  padding: 0;\n}\n\n.project-picker-list {\n  display: grid;\n  gap: 3px;\n  margin: 10px 0 12px;\n  max-height: 286px;\n  min-height: 54px;\n  overflow: auto;\n}\n\n.project-picker-option {\n  background: transparent;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  gap: 10px;\n  justify-content: space-between;\n  min-height: 46px;\n  padding: 7px 9px;\n  text-align: left;\n}\n\n.project-picker-option:hover:not(:disabled),\n.project-picker-option.is-current {\n  background: var(--surface-subtle);\n  border-color: var(--border);\n}\n\n.project-picker-option-copy {\n  display: grid;\n  gap: 1px;\n  min-width: 0;\n}\n\n.project-picker-option-copy strong {\n  color: var(--text);\n  font-size: 12px;\n  font-weight: 600;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.project-picker-option-copy small,\n.project-picker-current,\n.project-picker-status,\n.project-create-hint {\n  color: var(--text-muted);\n  font-size: 11px;\n}\n\n.project-picker-current {\n  border: 1px solid var(--border-strong);\n  border-radius: 999px;\n  color: var(--text-secondary);\n  flex: 0 0 auto;\n  padding: 2px 6px;\n}\n\n.project-picker-status {\n  align-items: center;\n  display: flex;\n  justify-content: center;\n  line-height: 1.5;\n  margin: 0;\n  min-height: 54px;\n  text-align: center;\n}\n\n.project-picker-status.is-error {\n  flex-direction: column;\n  gap: 6px;\n}\n\n.project-picker-status.is-error button {\n  background: transparent;\n  color: var(--text);\n  font-size: 11px;\n  font-weight: 600;\n  padding: 0;\n  text-decoration: underline;\n  text-underline-offset: 3px;\n}\n\n.project-picker-footer {\n  border-top: 1px solid var(--border);\n  justify-content: flex-end;\n  padding-top: 10px;\n}\n\n.project-picker-create {\n  background: var(--text);\n  border: 1px solid var(--text);\n  border-radius: 5px;\n  color: var(--paper);\n  font-size: 11px;\n  font-weight: 600;\n  min-height: 29px;\n  padding: 0 9px;\n}\n\n.project-picker-create:hover:not(:disabled) {\n  background: #000;\n}\n\n.project-picker-create span {\n  font-size: 15px;\n  font-weight: 400;\n  margin-right: 3px;\n  vertical-align: -1px;\n}\n\n.project-create-form {\n  display: grid;\n  gap: 12px;\n}\n\n.project-create-form .project-picker-heading {\n  margin-bottom: 0;\n}\n\n.project-create-field {\n  align-items: stretch;\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  flex-direction: column;\n  gap: 4px;\n  padding: 9px 10px;\n}\n\n.project-create-field:focus-within {\n  border-color: var(--border-strong);\n}\n\n.project-create-field > span {\n  color: var(--text-muted);\n  font-size: 10px;\n}\n\n.project-create-hint,\n.project-create-error {\n  line-height: 1.55;\n  margin: -4px 0 0;\n}\n\n.project-create-error {\n  color: var(--text-secondary);\n  font-size: 11px;\n  font-weight: 600;\n}\n\n.project-create-actions {\n  gap: 8px;\n  justify-content: flex-end;\n}\n\n.project-create-actions .text-button,\n.project-create-actions .submit-button {\n  font-size: 11px;\n  height: 30px;\n  padding: 0 10px;\n}\n\n@media (max-width: 900px) {\n  .topbar {\n    grid-template-columns: minmax(0, 1fr) auto auto;\n  }\n\n  .topbar-center.project-switcher {\n    display: flex;\n    justify-self: end;\n  }\n}\n\n@media (max-width: 680px) {\n  .topbar {\n    gap: 8px;\n    grid-template-columns: minmax(0, 1fr) auto auto;\n  }\n\n  .topbar-center.project-switcher {\n    display: flex;\n  }\n\n  .project-switcher-label,\n  .project-switcher .status-dot {\n    display: none;\n  }\n\n  .project-switcher-trigger {\n    max-width: 128px;\n    padding: 0 8px;\n  }\n\n  .project-picker {\n    left: auto;\n    max-height: calc(100dvh - 72px);\n    position: fixed;\n    right: 12px;\n    top: 60px;\n    transform: none;\n    width: min(370px, calc(100vw - 24px));\n  }\n}\n';

// src/client.jsx
var STYLE_ID = "dsh-ai-drama-workbench-shell-style";
var SHELL_STYLES = `
.adw-standard-launch { position: fixed; z-index: 1; top: 14px; right: 18px; height: 29px; border: 1px solid rgba(32,32,29,.14); border-radius: 5px; background: #fff; color: #20201d; padding: 0 9px; cursor: pointer; font: 600 12px "PingFang SC", "Hiragino Sans GB", sans-serif; box-shadow: 0 3px 12px rgba(32,32,29,.05); }
.adw-standard-launch:hover { background: #f8f8f6; }
.adw-standard-launch:focus-visible, .adw-tools-fab:focus-visible, .adw-tools-menu button:focus-visible { outline: 2px solid rgba(32,32,29,.3); outline-offset: 2px; }
.adw-workbench-overlay { position: fixed; z-index: 20; inset: 0; display: flex; width: 100vw; height: 100dvh; min-width: 0; min-height: 0; overflow: hidden; background: #fff; pointer-events: auto; }
.adw-workbench-shadow-host { display: block; flex: 1; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: auto; scrollbar-width: none; background: #fff; }
.adw-workbench-shadow-host::-webkit-scrollbar { display: none; }
.adw-workbench-load-error { display: grid; place-items: center; flex: 1; min-width: 0; padding: 28px; color: #20201d; font: 13px/1.6 "PingFang SC", "Hiragino Sans GB", sans-serif; text-align: center; }
.adw-workbench-load-error strong, .adw-workbench-load-error span { display: block; }.adw-workbench-load-error span { max-width: 540px; margin-top: 6px; color: rgba(32,32,29,.68); }
.adw-top-tools { position: fixed; z-index: 65; top: 12px; left: calc(50% + 132px); display: flex; gap: 5px; align-items: center; }
.adw-top-tool-button { display: inline-flex; align-items: center; gap: 5px; height: 29px; border: 1px solid rgba(32,32,29,.16); border-radius: 5px; background: rgba(255,255,255,.96); color: rgba(32,32,29,.72); padding: 0 8px; cursor: pointer; font: 600 11px "PingFang SC", "Hiragino Sans GB", sans-serif; white-space: nowrap; }.adw-top-tool-button:hover { border-color: rgba(32,32,29,.42); color: #20201d; }.adw-top-tool-button > span { font-size: 12px; }.adw-top-tool-button small { color: rgba(32,32,29,.5); font-size: 10px; }.adw-ssh-tool.is-connected::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: #2f7d4b; }.adw-ssh-tool.is-error::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: #b94b4b; }
.adw-ssh-backdrop { position: fixed; z-index: 85; inset: 0; display: grid; place-items: center; background: rgba(32,32,29,.22); padding: 20px; }.adw-ssh-panel { width: min(620px,100%); border: 1px solid rgba(32,32,29,.18); border-radius: 8px; background: #fff; box-shadow: 0 18px 54px rgba(32,32,29,.22); padding: 20px; color: #20201d; font-family: "PingFang SC", "Hiragino Sans GB", sans-serif; }.adw-ssh-heading { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(32,32,29,.12); padding-bottom: 14px; }.adw-ssh-heading small { color: rgba(32,32,29,.5); font-size: 11px; }.adw-ssh-heading h2 { margin: 3px 0 0; font-size: 20px; }.adw-ssh-heading button { width: 26px; height: 26px; border: 1px solid rgba(32,32,29,.16); border-radius: 5px; background: #fff; font-size: 18px; cursor: pointer; }.adw-ssh-status { display: flex; gap: 9px; align-items: center; margin: 16px 0; padding: 10px; border: 1px solid rgba(32,32,29,.12); border-radius: 6px; background: #f8f8f6; }.adw-ssh-status i { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: rgba(32,32,29,.38); }.adw-ssh-status.is-connected i { background: #2f7d4b; }.adw-ssh-status.is-error i { background: #b94b4b; }.adw-ssh-status div { display: grid; gap: 1px; }.adw-ssh-status strong { font-size: 12px; }.adw-ssh-status span { color: rgba(32,32,29,.58); font-size: 11px; }.adw-ssh-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }.adw-ssh-field { display: grid; gap: 4px; }.adw-ssh-field.is-wide { grid-column: 1 / -1; }.adw-ssh-field span { color: rgba(32,32,29,.58); font-size: 11px; }.adw-ssh-field input { min-width: 0; height: 34px; border: 1px solid rgba(32,32,29,.18); border-radius: 5px; background: #fff; padding: 0 9px; color: #20201d; font: 12px "SFMono-Regular", Consolas, monospace; }.adw-ssh-error { margin: 12px 0 0; color: #a33; font-size: 11px; }.adw-ssh-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 18px; }.adw-ssh-actions button { height: 31px; border: 1px solid rgba(32,32,29,.18); border-radius: 5px; background: #fff; color: rgba(32,32,29,.72); padding: 0 10px; cursor: pointer; font: 600 11px "PingFang SC", "Hiragino Sans GB", sans-serif; }.adw-ssh-actions .is-primary { background: #20201d; border-color: #20201d; color: #fff; }.adw-ssh-actions .is-danger { color: #a33; }.adw-ssh-actions button:disabled { cursor: not-allowed; opacity: .55; }
.adw-exit-fab { align-items: center; display: inline-flex; gap: 6px; position: fixed; z-index: 65; right: 14px; bottom: 14px; min-height: 36px; border: 1px solid rgba(32,32,29,.22); border-radius: 7px; background: rgba(255,255,255,.96); box-shadow: 0 7px 18px rgba(32,32,29,.09); color: #20201d; padding: 0 11px; cursor: pointer; font: 650 12px "PingFang SC", "Hiragino Sans GB", sans-serif; }
.adw-exit-fab:hover { border-color: #20201d; background: #fff; }.adw-exit-fab-mark { font-size: 15px; line-height: 1; transform: translateY(-.5px); }
body[data-ai-drama-generation="open"] .adw-top-tools, body[data-ai-drama-generation="open"] .adw-exit-fab { opacity: 0; pointer-events: none; visibility: hidden; }
.adw-chat-hint { position: absolute; z-index: 70; bottom: 110px; left: 14px; width: min(330px,calc(100vw - 28px)); border: 1px solid rgba(32,32,29,.14); border-radius: 8px; background: #fff; box-shadow: 0 10px 26px rgba(32,32,29,.14); color: rgba(32,32,29,.72); padding: 10px; font: 12px/1.5 "PingFang SC", "Hiragino Sans GB", sans-serif; }
.adw-chat-hint button { display: block; border: 0; background: transparent; color: #20201d; margin-top: 6px; padding: 0; cursor: pointer; font: 650 11px "PingFang SC", "Hiragino Sans GB", sans-serif; text-decoration: underline; text-underline-offset: 3px; }
body[data-ai-drama-workbench="open"] [data-slot="conversation"] > * { position: fixed !important; z-index: 30; top: 50%; left: 50%; width: min(920px,calc(100vw - 48px)); height: min(680px,calc(100vh - 64px)) !important; min-width: 0; max-height: calc(100vh - 64px); overflow: hidden; border: 1px solid rgba(32,32,29,.14); border-radius: 12px; background: var(--dsw-alias-bg-base,#fff); box-shadow: 0 18px 54px rgba(32,32,29,.22); opacity: 0; visibility: hidden; pointer-events: none; transform: translate(-50%,-50%); transition: opacity 160ms ease, visibility 160ms ease; }
body[data-ai-drama-workbench="open"][data-ai-drama-chat="open"] [data-slot="conversation"] > * { opacity: 1; visibility: visible; pointer-events: auto; }
.adw-chat-close { align-items: center; border: 1px solid rgba(32,32,29,.18); border-radius: 999px; background: #20201d; box-shadow: 0 8px 20px rgba(32,32,29,.18); color: #fff; cursor: pointer; display: inline-flex; font: 650 11px "PingFang SC", "Hiragino Sans GB", sans-serif; gap: 6px; height: 30px; padding: 0 10px; position: fixed; right: max(18px,calc(50% - min(460px,calc(50vw - 24px)) + 10px)); top: max(14px,calc(50% - min(340px,calc(50vh - 32px)) + 10px)); z-index: 75; }.adw-chat-close:hover { background: #000; }.adw-chat-close-mark { font-size: 16px; font-weight: 400; line-height: 1; transform: translateY(-.5px); }
@media (max-width: 920px) { .adw-top-tools { left: auto; right: 142px; }.adw-top-tool-button small { display: none; } } @media (max-width: 720px) { .adw-standard-launch { top: 10px; right: 10px; }.adw-top-tools { top: 10px; right: 12px; }.adw-top-tool-button { padding: 0 6px; }.adw-top-tool-button span { display: none; }.adw-exit-fab { right: 12px; bottom: 12px; }.adw-chat-hint { bottom: 108px; left: 12px; width: calc(100vw - 24px); }.adw-chat-close { right: 20px; top: max(14px,calc(50% - min(300px,calc(50vh - 22px)) + 10px)); }.adw-ssh-grid { grid-template-columns: 1fr; }.adw-ssh-field.is-wide { grid-column: auto; }.adw-ssh-actions { flex-wrap: wrap; } body[data-ai-drama-workbench="open"] [data-slot="conversation"] > * { top: 50%; left: 50%; width: calc(100vw - 24px); height: min(600px,calc(100vh - 44px)) !important; max-height: calc(100vh - 44px); transform: translate(-50%,-50%); } }
`;
var SHADOW_HOST_STYLES = `
:host { display: block; min-height: 100%; background: #fff; color-scheme: light; }
.adw-original-workbench-mount { min-height: 100%; }
.project-structure-actions { display: flex; gap: 4px; }
.generation-open-button { border-color: var(--border-strong); }
.generation-modal { background: var(--paper); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; max-height: min(780px, calc(100vh - 32px)); overflow: hidden; padding: 0; width: min(920px, calc(100vw - 48px)); }
.generation-modal-heading { background: var(--paper); border-bottom: 1px solid var(--border); margin: 0; padding: 21px 24px 17px; }
.generation-modal-heading .eyebrow { margin: 0; }.generation-modal-heading h2 { margin-top: 4px; }
.generation-modal-body { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 18px 24px 22px; scrollbar-color: var(--border-strong) transparent; scrollbar-width: thin; }
.generation-asset-strip { align-items: center; background: var(--ash); border: 1px solid var(--border); border-radius: var(--radius-md); display: flex; gap: 18px; justify-content: space-between; min-height: 76px; padding: 13px 14px; }
.generation-asset-strip-copy { display: grid; gap: 2px; min-width: 0; }.generation-asset-strip-copy > span, .generation-card-kicker { color: var(--text-muted); font-size: 10px; font-weight: 650; letter-spacing: .06em; line-height: 1.2; text-transform: uppercase; }.generation-asset-strip-copy strong { color: var(--text); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.generation-asset-strip-copy small { color: var(--text-secondary); font-size: 11px; line-height: 1.45; }
.generation-output-kind { align-items: center; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--text-secondary); display: inline-flex; flex: 0 0 auto; font-size: 11px; font-weight: 600; min-height: 25px; padding: 0 9px; white-space: nowrap; }
.generation-loading { background: var(--ash); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-secondary); font-size: 12px; line-height: 1.55; margin: 14px 0 0; padding: 13px 14px; }
.generation-layout { align-items: start; display: grid; gap: 18px; grid-template-columns: minmax(0, 1.48fr) minmax(228px, .82fr); margin-top: 18px; }
.generation-main-column, .generation-side-column { align-content: start; display: grid; gap: 12px; min-width: 0; }
.generation-section, .generation-status-card, .generation-preset-card, .generation-preview, .generation-job-list { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--paper); }
.generation-section { padding: 15px; }.generation-section-heading { align-items: flex-start; display: flex; gap: 12px; justify-content: space-between; }.generation-section-heading > div { display: grid; gap: 3px; }.generation-section-heading strong { color: var(--text); font-size: 13px; line-height: 1.3; }.generation-section-heading span { color: var(--text-muted); font-size: 11px; line-height: 1.45; }
.generation-form-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 14px; }.generation-parameter-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 14px; }.generation-parameter-grid.is-video { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.generation-advanced { border-top: 1px solid var(--border); margin-top: 15px; padding-top: 12px; }.generation-advanced summary { align-items: center; color: var(--text-secondary); cursor: pointer; display: flex; font-size: 11px; font-weight: 600; justify-content: space-between; list-style: none; }.generation-advanced summary::-webkit-details-marker { display: none; }.generation-advanced summary::after { border-bottom: 1.5px solid var(--text-secondary); border-right: 1.5px solid var(--text-secondary); content: ""; height: 6px; margin-left: 8px; transform: translateY(-2px) rotate(45deg); transition: transform 120ms ease; width: 6px; }.generation-advanced[open] summary::after { transform: translateY(2px) rotate(225deg); }.generation-advanced summary small { color: var(--text-muted); font-size: 11px; font-weight: 400; margin-left: auto; }.generation-advanced .asset-field { margin-top: 12px; }
.generation-mode-note { align-items: flex-start; background: var(--ash); border: 1px solid var(--border); border-radius: var(--radius-sm); display: grid; gap: 3px; margin-top: 14px; padding: 10px 11px; }.generation-mode-note strong { color: var(--text-secondary); font-size: 11px; font-weight: 650; }.generation-mode-note span { color: var(--text-muted); font-size: 11px; line-height: 1.55; }
.generation-status-card, .generation-preset-card { display: grid; gap: 6px; padding: 15px; }.generation-status-card { background: var(--ash); }.generation-status-card.is-ready { background: var(--paper); border-color: var(--border-strong); }.generation-status-card strong, .generation-preset-card strong { color: var(--text); font-size: 15px; line-height: 1.3; }.generation-status-card p, .generation-preset-card p { color: var(--text-secondary); font-size: 11px; line-height: 1.6; margin: 1px 0 0; }.generation-preset-card > div { border-top: 1px solid var(--border); display: flex; font-size: 11px; gap: 8px; justify-content: space-between; margin-top: 7px; padding-top: 10px; }.generation-preset-card > div span { color: var(--text-muted); }.generation-preset-card > div b { color: var(--text); font-weight: 600; text-align: right; }
.generation-config-path { border-top: 1px solid var(--border); color: var(--text-secondary); font-size: 11px; margin-top: 7px; padding-top: 9px; }.generation-config-path summary { cursor: pointer; font-weight: 600; list-style: none; }.generation-config-path summary::-webkit-details-marker { display: none; }.generation-config-path summary::before { content: "+"; display: inline-block; font-size: 14px; font-weight: 400; margin-right: 5px; }.generation-config-path[open] summary::before { content: "\u2212"; }.generation-config-path code { background: var(--paper); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-secondary); display: block; font-family: var(--mono); font-size: 10px; line-height: 1.55; margin-top: 9px; overflow-wrap: anywhere; padding: 7px; }
.generation-preview { margin-top: 14px; padding: 14px 15px; }.generation-preview.has-error { border-color: var(--border-strong); }.generation-result-heading { align-items: center; display: flex; gap: 12px; justify-content: space-between; }.generation-result-heading strong { color: var(--text); font-size: 13px; }.generation-result-heading span { color: var(--text-secondary); font-size: 11px; white-space: nowrap; }.generation-preview ul { display: grid; gap: 5px; list-style: none; margin: 11px 0 0; padding: 0; }.generation-preview li { align-items: baseline; border-top: 1px solid var(--border); display: grid; gap: 10px; grid-template-columns: minmax(72px, .34fr) minmax(0, 1fr); padding-top: 6px; }.generation-preview li span { color: var(--text-muted); font-size: 11px; }.generation-preview li b { color: var(--text-secondary); font-size: 11px; font-weight: 500; overflow-wrap: anywhere; }.generation-preview p { color: var(--text-secondary); font-size: 11px; line-height: 1.55; margin: 9px 0 0; }.generation-preview-error { background: var(--ash); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text); font-size: 12px; font-weight: 600; line-height: 1.55; margin: 14px 0 0; padding: 10px 11px; }
.generation-job-list { display: grid; gap: 8px; margin-top: 14px; padding: 14px 15px; }.generation-job-list > div { align-items: baseline; display: flex; justify-content: space-between; }.generation-job-list > div p { margin: 0; }.generation-job-list > div strong { color: var(--text-secondary); font-size: 12px; }.generation-job-list > article { align-items: center; border-top: 1px solid var(--border); display: grid; gap: 9px; grid-template-columns: 8px minmax(0, 1fr) auto; padding-top: 9px; }.generation-job-list article strong, .generation-job-list article small { display: block; }.generation-job-list article strong { color: var(--text); font-size: 12px; }.generation-job-list article small { color: var(--text-muted); display: -webkit-box; font-size: 11px; line-height: 1.45; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }.generation-job-list article em { color: var(--text-secondary); font-size: 11px; font-style: normal; }.generation-job-action { min-height: 28px; padding: 0 9px; white-space: nowrap; }.generation-job-dot { background: var(--ink-48); border-radius: 999px; height: 7px; width: 7px; }.generation-job-dot.is-completed { background: var(--ink); }.generation-job-dot.is-failed { background: var(--ink-72); }
.generation-modal-actions { background: var(--paper); border-top: 1px solid var(--border); margin: 0; padding: 14px 24px 16px; }
@media (max-width: 800px) { .generation-modal { max-height: calc(100dvh - 16px); width: min(680px, calc(100vw - 16px)); }.generation-modal-heading { padding: 17px 17px 14px; }.generation-modal-body { padding: 14px 17px 18px; }.generation-layout { grid-template-columns: 1fr; }.generation-side-column { grid-template-columns: repeat(2, minmax(0, 1fr)); }.generation-modal-actions { padding: 12px 17px 14px; } }
@media (max-width: 520px) { .generation-asset-strip { align-items: flex-start; min-height: 0; }.generation-asset-strip-copy small { display: none; }.generation-form-grid { grid-template-columns: 1fr; }.generation-side-column { grid-template-columns: 1fr; }.generation-modal-actions { gap: 6px; }.generation-modal-actions .text-button, .generation-modal-actions .submit-button { flex: 1 1 auto; padding: 0 9px; }.generation-modal-actions .text-button:first-child { flex: 0 0 auto; }.generation-job-list > article { grid-template-columns: 8px minmax(0, 1fr); }.generation-job-list article em, .generation-job-list article .generation-job-action { grid-column: 2; justify-self: start; } }
@media (max-width: 360px) { .generation-parameter-grid, .generation-parameter-grid.is-video { grid-template-columns: 1fr; }.generation-modal-heading h2 { font-size: 18px; }.generation-output-kind { display: none; } }
.adw-workbench-render-error { display: grid; min-height: 100vh; place-items: center; color: var(--text-secondary); padding: 28px; text-align: center; }
.adw-workbench-render-error strong, .adw-workbench-render-error span { display: block; }.adw-workbench-render-error span { margin-top: 6px; max-width: 520px; }
`;
function shadowSafeStyles(source) {
  return `${source.replace(/^:root(?=\s*\{)/mu, ":host").replace(/^html(?=\s*\{)/mu, ":host").replace(/(^|\n)([\t ]*)body(?=\s*\{)/gu, "$1$2:host")}
${SHADOW_HOST_STYLES}`;
}
var WORKBENCH_STYLES = shadowSafeStyles(original_workbench_default);
function installStyles() {
  if (document.getElementById(STYLE_ID)) return () => {
  };
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.dataset.plugin = "dsh-ai-drama-workbench";
  style.textContent = SHELL_STYLES;
  document.head.appendChild(style);
  return () => style.remove();
}
function setWorkbenchMode(open, chatOpen = false) {
  document.body.dataset.aiDramaWorkbench = open ? "open" : "";
  document.body.dataset.aiDramaChat = open && chatOpen ? "open" : "";
}
var FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(",");
function isVisibleFocusable(element) {
  if (!(element instanceof HTMLElement) || element.matches('[disabled], [aria-hidden="true"]')) return false;
  if (element.closest('[inert], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}
function collectFocusableElements(roots) {
  const elements = [];
  const seen = /* @__PURE__ */ new Set();
  const addFocusable = (element) => {
    if (seen.has(element) || !isVisibleFocusable(element)) return;
    seen.add(element);
    elements.push(element);
  };
  const visitRoot = (root) => {
    if (!root) return;
    if (root instanceof HTMLElement && root.matches(FOCUSABLE_SELECTOR)) addFocusable(root);
    root.querySelectorAll?.(FOCUSABLE_SELECTOR).forEach(addFocusable);
    root.querySelectorAll?.("*").forEach((element) => {
      if (element.shadowRoot) visitRoot(element.shadowRoot);
    });
  };
  roots.forEach(visitRoot);
  return elements;
}
function isolateHarnessBackground(foregroundRoots) {
  const foreground = foregroundRoots.filter(Boolean);
  const isolated = [];
  const collectBackgroundSiblings = (parent) => {
    Array.from(parent.children).forEach((element) => {
      if (["SCRIPT", "STYLE", "LINK", "META"].includes(element.tagName)) return;
      if (foreground.some((root) => root === element || root.contains(element))) return;
      if (foreground.some((root) => element.contains(root))) {
        collectBackgroundSiblings(element);
        return;
      }
      isolated.push(element);
    });
  };
  collectBackgroundSiblings(document.body);
  const previous = isolated.map((element) => ({
    ariaHidden: element.getAttribute("aria-hidden"),
    hadAriaHidden: element.hasAttribute("aria-hidden"),
    hadInert: element.hasAttribute("inert"),
    inert: element.inert,
    element
  }));
  previous.forEach(({ element }) => {
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
  });
  return () => {
    previous.reverse().forEach(({ ariaHidden, hadAriaHidden, hadInert, inert, element }) => {
      element.inert = inert;
      if (hadInert) element.setAttribute("inert", "");
      else element.removeAttribute("inert");
      if (hadAriaHidden) element.setAttribute("aria-hidden", ariaHidden ?? "true");
      else element.removeAttribute("aria-hidden");
    });
  };
}
var WorkbenchErrorBoundary = class extends import_react2.default.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("[ai-drama-workbench] \u539F\u5DE5\u4F5C\u53F0\u6E32\u67D3\u5931\u8D25\u3002", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return /* @__PURE__ */ import_react2.default.createElement("section", { className: "adw-workbench-render-error" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("strong", null, "\u5DE5\u4F5C\u53F0\u672A\u80FD\u52A0\u8F7D"), /* @__PURE__ */ import_react2.default.createElement("span", null, this.state.error instanceof Error ? this.state.error.message : String(this.state.error))));
  }
};
function ShadowWorkbench() {
  const hostRef = (0, import_react2.useRef)(null);
  const [mountNode, setMountNode] = (0, import_react2.useState)(null);
  const [mountError, setMountError] = (0, import_react2.useState)(null);
  (0, import_react2.useLayoutEffect)(() => {
    const host = hostRef.current;
    if (!host) return void 0;
    let mount;
    try {
      const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      mount = document.createElement("div");
      mount.className = "adw-original-workbench-mount";
      shadow.replaceChildren(mount);
      setMountNode(mount);
    } catch (error) {
      console.error("[ai-drama-workbench] \u65E0\u6CD5\u521D\u59CB\u5316\u5DE5\u4F5C\u53F0\u9694\u79BB\u5BB9\u5668\u3002", error);
      setMountError(error);
    }
    return () => {
      setMountNode(null);
      mount?.remove();
    };
  }, []);
  if (mountError) {
    return /* @__PURE__ */ import_react2.default.createElement("section", { className: "adw-workbench-load-error" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("strong", null, "\u5DE5\u4F5C\u53F0\u5BB9\u5668\u672A\u80FD\u521D\u59CB\u5316"), /* @__PURE__ */ import_react2.default.createElement("span", null, mountError instanceof Error ? mountError.message : String(mountError))));
  }
  return /* @__PURE__ */ import_react2.default.createElement("div", { className: "adw-workbench-shadow-host", ref: hostRef }, mountNode ? (0, import_react_dom.createPortal)(/* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("style", null, WORKBENCH_STYLES), /* @__PURE__ */ import_react2.default.createElement(WorkbenchErrorBoundary, null, /* @__PURE__ */ import_react2.default.createElement(Workbench, { externalStructureTrigger: true }))), mountNode) : null);
}
function SshSettings({ connection, error, busy, onClose, onRefresh, onSave, onStart, onStop }) {
  const emptyConnection = { name: "\u4E91\u670D\u52A1\u5668", host: "", port: 22, user: "", localPort: 8188, remoteHost: "127.0.0.1", remotePort: 8188 };
  const [draft, setDraft] = (0, import_react2.useState)(connection || emptyConnection);
  const [password, setPassword] = (0, import_react2.useState)("");
  (0, import_react2.useEffect)(() => {
    if (connection) setDraft(connection);
  }, [connection]);
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: ["port", "localPort", "remotePort"].includes(key) ? Number(value) : value }));
  const connected = connection?.status?.state === "connected";
  const start = () => {
    try {
      onStart({ ...draft, password });
    } finally {
      setPassword("");
    }
  };
  const save = () => {
    const config = { ...draft };
    delete config.password;
    setPassword("");
    onSave(config);
  };
  return /* @__PURE__ */ import_react2.default.createElement("div", { className: "adw-ssh-backdrop", onMouseDown: (event) => {
    if (event.target === event.currentTarget) onClose();
  } }, /* @__PURE__ */ import_react2.default.createElement("section", { "aria-labelledby": "adw-ssh-title", "aria-modal": "true", className: "adw-ssh-panel", role: "dialog" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "adw-ssh-heading" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("small", null, "\u672C\u673A SSH \u96A7\u9053"), /* @__PURE__ */ import_react2.default.createElement("h2", { id: "adw-ssh-title" }, "\u4E91\u670D\u52A1\u5668\u8FDE\u63A5")), /* @__PURE__ */ import_react2.default.createElement("button", { "aria-label": "\u5173\u95ED\u4E91\u670D\u52A1\u5668\u8BBE\u7F6E", onClick: onClose, type: "button" }, "\xD7")), /* @__PURE__ */ import_react2.default.createElement("div", { className: `adw-ssh-status is-${connection?.status?.state || "unconfigured"}` }, /* @__PURE__ */ import_react2.default.createElement("i", null), " ", /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("strong", null, connection?.status?.label || (error ? "\u65E0\u6CD5\u8BFB\u53D6\u72B6\u6001" : "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026")), /* @__PURE__ */ import_react2.default.createElement("span", null, connection?.status?.detail || (connected ? `127.0.0.1:${connection.localPort} \u5DF2\u5EFA\u7ACB\u8F6C\u53D1` : error || "\u4FDD\u5B58\u914D\u7F6E\u540E\u53EF\u4EE5\u76F4\u63A5\u542F\u52A8 SSH \u96A7\u9053")))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "adw-ssh-grid" }, /* @__PURE__ */ import_react2.default.createElement("label", { className: "adw-ssh-field is-wide" }, /* @__PURE__ */ import_react2.default.createElement("span", null, "SSH \u5BC6\u7801\uFF08\u4EC5\u672C\u6B21\u8FDE\u63A5\u4F7F\u7528\uFF09"), /* @__PURE__ */ import_react2.default.createElement("input", { autoComplete: "off", onChange: (event) => setPassword(event.target.value), placeholder: "\u8BF7\u8F93\u5165\u670D\u52A1\u5668\u5BC6\u7801", type: "password", value: password })), [["name", "\u8FDE\u63A5\u540D\u79F0", "\u4E91\u670D\u52A1\u5668"], ["host", "\u670D\u52A1\u5668\u5730\u5740", "example.com"], ["user", "SSH \u7528\u6237\u540D", "ubuntu"], ["port", "SSH \u7AEF\u53E3", "22"], ["localPort", "\u672C\u5730\u8F6C\u53D1\u7AEF\u53E3", "8188"], ["remoteHost", "\u4E91\u7AEF\u670D\u52A1\u5730\u5740", "127.0.0.1"], ["remotePort", "\u4E91\u7AEF\u670D\u52A1\u7AEF\u53E3", "8188"]].map(([key, label, placeholder]) => /* @__PURE__ */ import_react2.default.createElement("label", { className: "adw-ssh-field", key }, /* @__PURE__ */ import_react2.default.createElement("span", null, label), /* @__PURE__ */ import_react2.default.createElement("input", { onChange: (event) => update(key, event.target.value), placeholder, type: ["port", "localPort", "remotePort"].includes(key) ? "number" : "text", value: draft[key] ?? "" })))), /* @__PURE__ */ import_react2.default.createElement("p", { className: "adw-ssh-secret-note" }, "\u6B64\u8FDE\u63A5\u4EC5\u4F7F\u7528 SSH \u5BC6\u7801\u8BA4\u8BC1\uFF0C\u5DF2\u7981\u7528\u516C\u94A5\u3001SSH agent \u548C\u590D\u7528\u8FDE\u63A5\u3002\u5BC6\u7801\u4E0D\u4F1A\u5199\u5165\u914D\u7F6E\u6587\u4EF6\u6216\u8FD4\u56DE\u7ED9\u9875\u9762\u3002"), error ? /* @__PURE__ */ import_react2.default.createElement("p", { className: "adw-ssh-error", role: "alert" }, error) : null, /* @__PURE__ */ import_react2.default.createElement("div", { className: "adw-ssh-actions" }, /* @__PURE__ */ import_react2.default.createElement("button", { disabled: busy, onClick: onRefresh, type: "button" }, "\u5237\u65B0\u72B6\u6001"), /* @__PURE__ */ import_react2.default.createElement("button", { disabled: busy, onClick: save, type: "button" }, "\u4FDD\u5B58\u8BBE\u7F6E"), connected ? /* @__PURE__ */ import_react2.default.createElement("button", { className: "is-danger", disabled: busy, onClick: onStop, type: "button" }, "\u65AD\u5F00\u8FDE\u63A5") : connection?.status?.state === "error" || connection?.status?.state === "connecting" ? /* @__PURE__ */ import_react2.default.createElement("button", { className: "is-danger", disabled: busy, onClick: onStop, type: "button" }, "\u91CD\u7F6E\u8FDE\u63A5") : /* @__PURE__ */ import_react2.default.createElement("button", { className: "is-primary", disabled: busy || !draft.host || !draft.user || !password, onClick: start, type: "button" }, "\u542F\u52A8\u8FDE\u63A5"))));
}
function DramaWorkbenchShell() {
  const [active, setActive] = (0, import_react2.useState)(false);
  const [chatOpen, setChatOpen] = (0, import_react2.useState)(false);
  const [chatNotice, setChatNotice] = (0, import_react2.useState)("");
  const [ssh, setSsh] = (0, import_react2.useState)(null);
  const [sshOpen, setSshOpen] = (0, import_react2.useState)(false);
  const [sshBusy, setSshBusy] = (0, import_react2.useState)(false);
  const [sshError, setSshError] = (0, import_react2.useState)("");
  const launchRef = (0, import_react2.useRef)(null);
  const overlayRef = (0, import_react2.useRef)(null);
  const controlsRef = (0, import_react2.useRef)(null);
  const returnFocusRef = (0, import_react2.useRef)(null);
  const shouldRestoreFocusRef = (0, import_react2.useRef)(false);
  const chatReturnFocusRef = (0, import_react2.useRef)(null);
  const rememberFocusBeforeOpening = (0, import_react2.useCallback)(() => {
    const focused = document.activeElement;
    returnFocusRef.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    shouldRestoreFocusRef.current = true;
  }, []);
  const openWorkbench = (0, import_react2.useCallback)(() => {
    rememberFocusBeforeOpening();
    setChatNotice("");
    setChatOpen(false);
    setActive(true);
  }, [rememberFocusBeforeOpening]);
  (0, import_react2.useEffect)(() => {
    window.addEventListener("ai-drama:open-workbench", openWorkbench);
    return () => window.removeEventListener("ai-drama:open-workbench", openWorkbench);
  }, [openWorkbench]);
  const loadSsh = (0, import_react2.useCallback)(async () => {
    try {
      const response = await fetch("/ai-drama/api/ssh", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "\u65E0\u6CD5\u8BFB\u53D6 SSH \u72B6\u6001");
      setSsh(data);
      setSshError("");
    } catch (error) {
      setSshError(error instanceof Error ? error.message : "\u65E0\u6CD5\u8BFB\u53D6 SSH \u72B6\u6001");
    }
  }, []);
  (0, import_react2.useEffect)(() => {
    if (!active) return void 0;
    void loadSsh();
    const timer = window.setInterval(() => void loadSsh(), 1e4);
    return () => window.clearInterval(timer);
  }, [active, loadSsh]);
  const sshAction = (0, import_react2.useCallback)(async (endpoint, body = {}) => {
    setSshBusy(true);
    try {
      const response = await fetch(`/ai-drama/api/ssh/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "SSH \u64CD\u4F5C\u5931\u8D25");
      setSsh(data);
      setSshError("");
    } catch (error) {
      setSshError(error instanceof Error ? error.message : "SSH \u64CD\u4F5C\u5931\u8D25");
      await loadSsh();
    } finally {
      setSshBusy(false);
    }
  }, [loadSsh]);
  (0, import_react2.useEffect)(() => {
    setWorkbenchMode(active, chatOpen);
    return () => setWorkbenchMode(false);
  }, [active, chatOpen]);
  (0, import_react2.useLayoutEffect)(() => {
    if (!active) return void 0;
    overlayRef.current?.focus({ preventScroll: true });
    const frame = window.requestAnimationFrame(() => {
      const firstControl = collectFocusableElements([overlayRef.current, controlsRef.current])[0];
      if (firstControl) firstControl.focus({ preventScroll: true });
      else overlayRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);
  (0, import_react2.useEffect)(() => {
    if (!active) return void 0;
    const conversation = chatOpen ? document.querySelector('[data-slot="conversation"] > *') : null;
    return isolateHarnessBackground([overlayRef.current, controlsRef.current, conversation]);
  }, [active, chatOpen]);
  (0, import_react2.useEffect)(() => {
    if (active || !shouldRestoreFocusRef.current) return void 0;
    const timer = window.setTimeout(() => {
      const originalTarget = returnFocusRef.current;
      const target = originalTarget?.isConnected && isVisibleFocusable(originalTarget) ? originalTarget : launchRef.current;
      target?.focus({ preventScroll: true });
      shouldRestoreFocusRef.current = false;
      returnFocusRef.current = null;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active]);
  (0, import_react2.useEffect)(() => {
    if (!active) return void 0;
    const conversation = document.querySelector('[data-slot="conversation"] > *');
    if (!conversation) return void 0;
    const previousId = conversation.getAttribute("id");
    conversation.id = "adw-ai-conversation";
    return () => {
      if (previousId) conversation.id = previousId;
      else conversation.removeAttribute("id");
    };
  }, [active]);
  (0, import_react2.useEffect)(() => {
    if (!active || !chatOpen) return void 0;
    const timer = window.setTimeout(() => {
      const chatInput = document.querySelector('[data-slot="conversation"] textarea, [data-slot="conversation"] [contenteditable="true"]');
      const focusTarget = chatInput ?? document.querySelector(".adw-chat-close");
      focusTarget?.focus();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [active, chatOpen]);
  const closeChat = (0, import_react2.useCallback)(() => {
    setChatOpen(false);
    const previousTarget = chatReturnFocusRef.current;
    window.setTimeout(() => {
      const target = previousTarget?.isConnected && isVisibleFocusable(previousTarget) ? previousTarget : controlsRef.current?.querySelector(".adw-top-tool-button");
      target?.focus({ preventScroll: true });
      chatReturnFocusRef.current = null;
    }, 0);
  }, []);
  (0, import_react2.useEffect)(() => {
    if (!active || !chatOpen) return void 0;
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeChat();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [active, chatOpen, closeChat]);
  (0, import_react2.useEffect)(() => {
    if (!active) return void 0;
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const conversation = chatOpen ? document.querySelector('[data-slot="conversation"] > *') : null;
      const roots = chatOpen ? [conversation, controlsRef.current] : [overlayRef.current, controlsRef.current];
      const focusable = collectFocusableElements(roots);
      if (!focusable.length) {
        event.preventDefault();
        overlayRef.current?.focus({ preventScroll: true });
        return;
      }
      let focused = document.activeElement;
      while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
      const currentIndex = focusable.indexOf(focused);
      const boundaryIndex = event.shiftKey ? 0 : focusable.length - 1;
      if (currentIndex !== boundaryIndex && currentIndex !== -1) return;
      event.preventDefault();
      focusable[event.shiftKey ? focusable.length - 1 : 0].focus({ preventScroll: true });
    };
    window.addEventListener("keydown", trapFocus);
    return () => window.removeEventListener("keydown", trapFocus);
  }, [active, chatOpen]);
  const toggleChat = () => {
    if (!document.querySelector('[data-slot="conversation"] > *')) {
      setChatOpen(false);
      setChatNotice("\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u7684 Harness \u5BF9\u8BDD\u3002\u5148\u56DE\u5230\u666E\u901A\u6A21\u5F0F\u65B0\u5EFA\u6216\u9009\u62E9\u4E00\u4E2A\u5BF9\u8BDD\uFF0C\u518D\u70B9\u201C\u95EE AI\u201D\u3002");
      return;
    }
    if (chatOpen) {
      closeChat();
      return;
    }
    const focused = document.activeElement;
    chatReturnFocusRef.current = focused instanceof HTMLElement ? focused : null;
    setChatNotice("");
    setChatOpen(true);
  };
  const exitWorkbench = () => {
    if (!returnFocusRef.current) {
      const focused = document.activeElement;
      returnFocusRef.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    }
    shouldRestoreFocusRef.current = true;
    setChatOpen(false);
    setChatNotice("");
    setActive(false);
  };
  if (!active) {
    return /* @__PURE__ */ import_react2.default.createElement("button", { className: "adw-standard-launch", onClick: openWorkbench, ref: launchRef, type: "button" }, "\u8FDB\u5165 AI \u6F2B\u5267\u5DE5\u4F5C\u53F0");
  }
  return /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("section", { "aria-label": "AI \u6F2B\u5267\u5DE5\u4F5C\u53F0", "aria-modal": "true", className: "adw-workbench-overlay", ref: overlayRef, role: "dialog", tabIndex: -1 }, /* @__PURE__ */ import_react2.default.createElement(ShadowWorkbench, null)), (0, import_react_dom.createPortal)(/* @__PURE__ */ import_react2.default.createElement("div", { className: "adw-workbench-controls", ref: controlsRef }, /* @__PURE__ */ import_react2.default.createElement("nav", { "aria-label": "\u5DE5\u4F5C\u53F0\u5FEB\u6377\u5165\u53E3", className: "adw-top-tools" }, /* @__PURE__ */ import_react2.default.createElement("button", { className: "adw-top-tool-button", onClick: () => window.dispatchEvent(new CustomEvent("ai-drama:open-project-structure")), type: "button" }, /* @__PURE__ */ import_react2.default.createElement("span", { "aria-hidden": "true" }, "\u25A4"), "\u76EE\u5F55\u9884\u89C8"), /* @__PURE__ */ import_react2.default.createElement("button", { className: "adw-top-tool-button", onClick: toggleChat, type: "button" }, /* @__PURE__ */ import_react2.default.createElement("span", { "aria-hidden": "true" }, "AI"), "\u95EE AI"), /* @__PURE__ */ import_react2.default.createElement("button", { className: `adw-top-tool-button adw-ssh-tool is-${ssh?.status?.state || "unknown"}`, onClick: () => {
    setSshOpen(true);
    void loadSsh();
  }, type: "button" }, /* @__PURE__ */ import_react2.default.createElement("span", { "aria-hidden": "true" }, "\u2301"), "\u4E91\u670D\u52A1\u5668", ssh?.status?.label ? /* @__PURE__ */ import_react2.default.createElement("small", null, ssh.status.label) : null)), chatNotice ? /* @__PURE__ */ import_react2.default.createElement("div", { className: "adw-chat-hint", role: "status" }, chatNotice) : null, sshOpen ? /* @__PURE__ */ import_react2.default.createElement(SshSettings, { connection: ssh, error: sshError, busy: sshBusy, onClose: () => setSshOpen(false), onRefresh: () => void loadSsh(), onSave: (value) => void sshAction("config", value), onStart: (value) => void sshAction("start", value), onStop: () => void sshAction("stop") }) : null, chatOpen ? /* @__PURE__ */ import_react2.default.createElement("button", { "aria-label": "\u5173\u95ED AI \u5BF9\u8BDD", className: "adw-chat-close", onClick: closeChat, type: "button" }, /* @__PURE__ */ import_react2.default.createElement("span", { "aria-hidden": "true", className: "adw-chat-close-mark" }, "\xD7"), "\u5173\u95ED\u5BF9\u8BDD") : null, /* @__PURE__ */ import_react2.default.createElement("button", { "aria-label": "\u9000\u51FA AI \u6F2B\u5267\u5DE5\u4F5C\u53F0", className: "adw-exit-fab", onClick: exitWorkbench, type: "button" }, /* @__PURE__ */ import_react2.default.createElement("span", { "aria-hidden": "true", className: "adw-exit-fab-mark" }, "\u2190"), "\u9000\u51FA\u5DE5\u4F5C\u53F0")), document.body));
}
var inject = ["slots"];
function apply(ctx) {
  const disposeStyles = installStyles();
  ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "ai-drama-workbench",
    order: 100
  }, DramaWorkbenchShell)), "ai-drama-workbench: overlay");
  ctx.effect(() => () => disposeStyles(), "ai-drama-workbench: styles");
}

    return module.exports;
  }
});
