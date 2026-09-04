#!/usr/bin/env python3
"""Local MCP server for proposal-first AI drama project planning.

The server deliberately contains no model calls. Codex reads the user's novel
excerpt, drafts the structured plan, and this server supplies the safe local
read/write boundary: inspect -> stage proposal -> explicit confirmation ->
transactional directory creation.
"""

from __future__ import annotations

import datetime as datetime
import hashlib
import json
import os
import re
import secrets
import shutil
import stat
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Mapping


SERVER_NAME = "ai-drama-planner"
SERVER_VERSION = "0.1.2"
PROTOCOL_VERSION = "2024-11-05"
PROPOSAL_PREFIX = "proposal_"
PROPOSAL_ID_RE = re.compile(r"^proposal_[A-Za-z0-9_-]{12,80}$")
SHOT_ID_RE = re.compile(r"^(?:SH)?\s*0*(\d{1,4})$", re.IGNORECASE)

MAX_PROJECT_ENTRIES = 8_000
MAX_SCAN_DEPTH = 8
MAX_TEXT_BYTES = 256 * 1024
MAX_EXCERPT_CHARS = 120_000
MAX_PROJECT_INDEX_BYTES = 1024 * 1024
MAX_LONG_TEXT_CHARS = 12_000
MAX_SHORT_TEXT_CHARS = 600
MAX_CHARACTERS = 24
MAX_LOOKS_PER_CHARACTER = 12
MAX_LOCATIONS = 36
MAX_PROPS = 36
MAX_SCENES = 24
MAX_SHOTS_PER_SCENE = 80
MAX_SCENE_CAST_BINDINGS = 120
MAX_SHOT_CHARACTER_OVERRIDES = 80
PROPOSAL_TTL_HOURS = 72

# The Harness host supplies these only when it starts the short-lived planner
# bridge. They are deliberately environment-only: an AI tool request must not
# be able to widen its own filesystem scope by passing a library path.
PLANNER_LIBRARY_ROOT_ENV = "AI_DRAMA_PLANNER_LIBRARY_ROOT"
PLANNER_ACTIVE_PROJECT_ROOT_ENV = "AI_DRAMA_PLANNER_ACTIVE_PROJECT_ROOT"

CHARACTER_SLOTS = ("三视图",)
SCENE_SLOTS = ("候选", "定稿")
SHOT_SLOTS = ("参考图", "首帧", "尾帧", "候选", "定稿", "成片")
LOCATION_SLOTS = ("场景图", "参考图", "候选", "定稿")
PROP_SLOTS = ("参考图", "候选", "定稿")
TOP_LEVEL_ROOTS = ("主要人物", "场景", "道具", "分镜")
ROLE_CATEGORIES = ("待分类", "主角", "女主", "重要配角", "配角", "反派", "群像", "其他")
CHARACTER_LOOK_DIRECTORY = "造型"
CHARACTER_LOOK_DOCUMENT = "造型设定.md"
SCENE_CAST_DOCUMENT = "出场与造型表.md"
SCENE_ASSET_DOCUMENT = "场次资产表.md"
SCENE_CAST_MARKER_START = "<!-- workbench:scene-cast:start -->"
SCENE_CAST_MARKER_END = "<!-- workbench:scene-cast:end -->"
SCENE_ASSET_MARKER_START = "<!-- workbench:scene-assets:start -->"
SCENE_ASSET_MARKER_END = "<!-- workbench:scene-assets:end -->"
SCENE_ASSET_PROJECTION_MARKER_START = "<!-- workbench:scene-assets:projection:start -->"
SCENE_ASSET_PROJECTION_MARKER_END = "<!-- workbench:scene-assets:projection:end -->"
SHOT_CHARACTER_OVERRIDES_MARKER_START = "<!-- workbench:shot-character-overrides:start -->"
SHOT_CHARACTER_OVERRIDES_MARKER_END = "<!-- workbench:shot-character-overrides:end -->"
LOOK_ID_RE = re.compile(r"^LOOK-(\d{1,6})$", re.IGNORECASE)
LOOK_DIRECTORY_RE = re.compile(r"^((?:[A-Za-z0-9]+-)?LOOK-\d{1,6})(?:[-_\s]+(.+))?$", re.IGNORECASE)


class PlannerError(Exception):
    """A request error safe to return to the MCP client."""


@dataclass(frozen=True)
class PlannerProjectScope:
    """The trusted filesystem boundary for one planner invocation.

    ``library_root`` is a project library containing one directory per project.
    When ``active_project_root`` is set, every action is pinned to that exact
    project.  The host owns this object; it must never be constructed from an
    untrusted AI/tool argument.
    """

    library_root: Path
    active_project_root: Path | None = None


def utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def iso_time(value: datetime.datetime | None = None) -> str:
    return (value or utc_now()).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def require_mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PlannerError(f"{label} 必须是对象。")
    return value


def require_list(value: Any, label: str, maximum: int) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise PlannerError(f"{label} 必须是数组。")
    if len(value) > maximum:
        raise PlannerError(f"{label} 最多允许 {maximum} 项，请分批拆解。")
    return value


def read_text_value(
    value: Any,
    label: str,
    *,
    maximum: int = MAX_SHORT_TEXT_CHARS,
    required: bool = True,
    multiline: bool = True,
    fallback: str = "",
) -> str:
    if value is None:
        if required:
            raise PlannerError(f"{label} 不能为空。")
        return fallback
    if not isinstance(value, str):
        raise PlannerError(f"{label} 必须是文本。")
    text = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not multiline and "\n" in text:
        raise PlannerError(f"{label} 不能包含换行。")
    if required and not text:
        raise PlannerError(f"{label} 不能为空。")
    if len(text) > maximum:
        raise PlannerError(f"{label} 最多 {maximum} 个字符。")
    if "\x00" in text:
        raise PlannerError(f"{label} 不能包含空字节。")
    return text


def safe_segment(value: Any, label: str, *, maximum: int = 96) -> str:
    text = read_text_value(value, label, maximum=maximum, multiline=False)
    if text in {".", ".."} or text.startswith("."):
        raise PlannerError(f"{label} 不能是隐藏目录或相对路径。")
    if "/" in text or "\\" in text:
        raise PlannerError(f"{label} 不能包含路径分隔符。")
    if any(ord(character) < 32 for character in text):
        raise PlannerError(f"{label} 不能包含控制字符。")
    return text


def normalize_shot_id(value: Any) -> str:
    text = read_text_value(value, "镜头 id", maximum=24, multiline=False)
    match = SHOT_ID_RE.fullmatch(text)
    if not match:
        raise PlannerError("镜头 id 请使用 SH001、SH002 这类稳定编号。")
    number = int(match.group(1))
    if number <= 0:
        raise PlannerError("镜头 id 必须大于 0。")
    return f"SH{number:03d}"


def string_list(value: Any, label: str, *, maximum: int = 30, item_maximum: int = 180) -> list[str]:
    values = require_list(value, label, maximum)
    result: list[str] = []
    for index, item in enumerate(values, start=1):
        result.append(read_text_value(item, f"{label} 第 {index} 项", maximum=item_maximum))
    return result


def path_text(value: Any, label: str, *, required: bool = True) -> str:
    """Accept strings from requests and ``Path`` values from trusted hosts/tests."""
    if isinstance(value, os.PathLike):
        value = os.fspath(value)
    return read_text_value(value, label, maximum=4_096, multiline=False, required=required)


def optional_path_text(value: Any, label: str) -> str | None:
    """Read an optional absolute-path setting without treating an unset env as text."""
    if value is None:
        return None
    text = path_text(value, label, required=False)
    return text or None


def home_directory() -> Path:
    """Resolve the home directory once for broad-root rejection."""
    try:
        return Path.home().resolve(strict=True)
    except OSError as error:
        raise PlannerError(f"无法解析当前用户目录：{error}") from error


def ensure_concrete_directory(value: Any, label: str, *, reject_broad: bool) -> Path:
    """Resolve an existing, non-symlink directory with user-safe errors."""
    raw = path_text(value, label)
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        raise PlannerError(f"{label}必须是绝对路径。")
    try:
        info = candidate.lstat()
    except OSError as error:
        raise PlannerError(f"无法访问{label}：{error}") from error
    if stat.S_ISLNK(info.st_mode):
        raise PlannerError(f"{label}不能是软链接。")
    if not stat.S_ISDIR(info.st_mode):
        raise PlannerError(f"{label}必须是目录。")
    try:
        root = candidate.resolve(strict=True)
    except OSError as error:
        raise PlannerError(f"无法访问{label}：{error}") from error
    if reject_broad and root in {Path("/"), home_directory()}:
        raise PlannerError(f"{label}不能是系统根目录或整个用户目录。")
    return root


def require_direct_library_project(project_root: Path, library_root: Path, label: str) -> Path:
    """Require a real visible first-level project directory below the library."""
    if project_root == library_root:
        raise PlannerError(f"{label}不能直接使用资产库目录；请指定其中的具体项目。")
    try:
        relative = project_root.relative_to(library_root)
    except ValueError as error:
        raise PlannerError(f"{label}不在受信任的资产库内。") from error
    if len(relative.parts) != 1 or relative.name.startswith("."):
        raise PlannerError(f"{label}必须是资产库中的普通一级项目目录。")
    candidate = library_root / relative.name
    kind = lstat_kind(candidate)
    if kind != "directory":
        raise PlannerError(f"{label}必须是资产库中的普通一级项目目录，不能使用软链接。")
    try:
        canonical = candidate.resolve(strict=True)
    except OSError as error:
        raise PlannerError(f"无法访问{label}：{error}") from error
    if canonical != project_root:
        raise PlannerError(f"{label}不能通过软链接或别名访问。")
    return project_root


def resolve_project_scope(
    allowed_library_root: Any | None = None,
    active_project_root: Any | None = None,
) -> PlannerProjectScope | None:
    """Build a trusted planner scope from host-owned configuration values.

    Passing only ``allowed_library_root`` lets a host enumerate/inspect one of
    its direct project children.  Passing both values pins every call to the
    current project.  An active project without a library is ambiguous and is
    rejected instead of silently deriving a permissive parent directory.
    """
    library_text = optional_path_text(allowed_library_root, "受信任资产库目录")
    active_text = optional_path_text(active_project_root, "当前项目目录")
    if library_text is None and active_text is None:
        return None
    if library_text is None:
        raise PlannerError("设置当前项目目录时必须同时设置受信任资产库目录。")

    library = ensure_concrete_directory(library_text, "受信任资产库目录", reject_broad=True)
    active: Path | None = None
    if active_text is not None:
        active = ensure_concrete_directory(active_text, "当前项目目录", reject_broad=True)
        require_direct_library_project(active, library, "当前项目目录")
    return PlannerProjectScope(library_root=library, active_project_root=active)


def planner_scope_from_environment(environ: Mapping[str, str] | None = None) -> PlannerProjectScope | None:
    """Read an invocation-local scope supplied by the Harness host.

    A planner process with neither setting preserves legacy behavior.  A host
    that sets either setting gets strict validation; a partial/malformed scope
    fails closed rather than falling back to arbitrary project paths.
    """
    source = os.environ if environ is None else environ
    library_value = source.get(PLANNER_LIBRARY_ROOT_ENV)
    active_value = source.get(PLANNER_ACTIVE_PROJECT_ROOT_ENV)
    if library_value is None and active_value is None:
        return None
    return resolve_project_scope(library_value, active_value)


def validate_project_root_in_scope(value: Any, scope: PlannerProjectScope) -> Path:
    """Validate a project directory against a host-created planner scope."""
    root = ensure_concrete_directory(value, "项目路径", reject_broad=True)
    require_direct_library_project(root, scope.library_root, "项目路径")
    if scope.active_project_root is not None and root != scope.active_project_root:
        raise PlannerError("项目路径不是当前已选项目，已拒绝跨项目访问。")
    return root


def ensure_project_root(
    value: Any,
    *,
    scope: PlannerProjectScope | None = None,
    allowed_library_root: Any | None = None,
    active_project_root: Any | None = None,
    use_environment_scope: bool = True,
) -> Path:
    """Resolve a project with optional host-owned library/current-project limits.

    The no-scope form remains for the legacy standalone MCP server.  The
    DeepSeek Harness bridge should set the two planner environment variables,
    or callers may pass a ``PlannerProjectScope`` directly.  Explicit scope
    sources are mutually exclusive so a call cannot accidentally widen itself.
    """
    explicit_scope_values = allowed_library_root is not None or active_project_root is not None
    if scope is not None and explicit_scope_values:
        raise PlannerError("项目范围只能使用一种受信任配置方式。")
    if scope is None and explicit_scope_values:
        scope = resolve_project_scope(allowed_library_root, active_project_root)
    if scope is None and use_environment_scope:
        scope = planner_scope_from_environment()
    if scope is not None:
        return validate_project_root_in_scope(value, scope)
    return ensure_concrete_directory(value, "项目路径", reject_broad=True)


def relative_path(root: Path, target: Path) -> str:
    try:
        return target.relative_to(root).as_posix()
    except ValueError as error:
        raise PlannerError("目标路径不在当前项目目录内。") from error


def lstat_kind(target: Path) -> str | None:
    try:
        info = target.lstat()
    except FileNotFoundError:
        return None
    if stat.S_ISLNK(info.st_mode):
        return "symlink"
    if stat.S_ISDIR(info.st_mode):
        return "directory"
    if stat.S_ISREG(info.st_mode):
        return "file"
    return "other"


def normal_directory(target: Path, label: str) -> bool:
    kind = lstat_kind(target)
    if kind is None:
        return False
    if kind != "directory":
        raise PlannerError(f"{label} 不是安全的普通目录。")
    return True


def normal_file(target: Path) -> bool:
    return lstat_kind(target) == "file"


def visible_children(directory: Path, warnings: list[str]) -> list[tuple[str, Path, os.stat_result]]:
    """List regular visible children without descending through symlinks."""
    if not normal_directory(directory, f"目录 {directory.name}"):
        return []
    result: list[tuple[str, Path, os.stat_result]] = []
    try:
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.name.startswith("."):
                    continue
                child = directory / entry.name
                try:
                    info = entry.stat(follow_symlinks=False)
                except OSError:
                    warnings.append(f"无法读取 {entry.name}，已跳过。")
                    continue
                if stat.S_ISLNK(info.st_mode):
                    warnings.append(f"已跳过软链接：{entry.name}")
                    continue
                if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                    warnings.append(f"已跳过特殊文件：{entry.name}")
                    continue
                result.append((entry.name, child, info))
    except OSError as error:
        warnings.append(f"无法读取目录 {directory.name}：{error}")
    return sorted(result, key=lambda item: item[0].casefold())


def read_small_text(target: Path, warnings: list[str]) -> str:
    if not normal_file(target):
        return ""
    try:
        size = target.stat().st_size
    except OSError:
        return ""
    if size > MAX_TEXT_BYTES:
        warnings.append(f"{target.name} 超过 {MAX_TEXT_BYTES // 1024} KB，未读取正文。")
        return ""
    try:
        return target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        warnings.append(f"无法按 UTF-8 读取 {target.name}，已跳过正文。")
        return ""


def parse_h1(markdown: str, fallback: str) -> str:
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip() or fallback
    return fallback


def parse_role_category(markdown: str) -> str:
    for line in markdown.splitlines():
        stripped = line.strip()
        # Accept both `**角色分类：** 主角` and `**角色分类**：主角` so the
        # planner observes the same hand-authored files as the workbench.
        match = re.match(
            r"^(?:[-*]\s*)?(?:\*\*)?(?:角色分类|人物分类|角色类型|人物类型)(?:\s*[：:]\*\*|\*\*\s*[：:]|\s*[：:])\s*(.+?)\s*$",
            stripped,
        )
        if not match:
            continue
        category = match.group(1).strip()
        return category if category in ROLE_CATEGORIES else "待分类"
    return "待分类"


def parse_look_directory_name(directory_name: str) -> dict[str, str]:
    match = LOOK_DIRECTORY_RE.fullmatch(directory_name)
    if not match:
        # Match the workbench's forgiving reader for manually created legacy LOOK folders.
        return {"id": directory_name, "name": directory_name}
    return {
        "id": match.group(1).upper(),
        "name": (match.group(2) or match.group(1)).strip(),
    }


def read_project_asset_index(root: Path, warnings: list[str]) -> dict[str, Any] | None:
    """Read optional JSON relations while keeping Markdown as asset source of truth."""
    target = root / ".workbench" / "index.json"
    if not normal_file(target):
        return None
    try:
        if target.stat().st_size > MAX_PROJECT_INDEX_BYTES:
            warnings.append(".workbench/index.json 超过 1 MB，未读取。")
            return None
        value = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        warnings.append(".workbench/index.json 不是有效 UTF-8 JSON，已跳过。")
        return None
    if not isinstance(value, dict) or value.get("schemaVersion") != 1 or value.get("projectName") != root.name:
        warnings.append(".workbench/index.json 的版本或项目名无效，已跳过。")
        return None
    chapters = value.get("chapters")
    if not isinstance(chapters, list) or len(chapters) > 1000:
        warnings.append(".workbench/index.json 的 chapters 结构无效，已跳过。")
        return None
    for chapter in chapters:
        if not isinstance(chapter, dict) or not isinstance(chapter.get("id"), str) or not isinstance(chapter.get("title"), str):
            warnings.append(".workbench/index.json 包含无效章节，已跳过。")
            return None
        for key in ("characterPaths", "locationPaths", "propPaths", "scenePaths"):
            paths = chapter.get(key)
            if not isinstance(paths, list) or any(
                not isinstance(item, str) or not item or item.startswith("/") or "\\" in item
                or any(part in {"", ".", ".."} for part in item.split("/"))
                for item in paths
            ):
                warnings.append(f".workbench/index.json 章节字段 {key} 无效，已跳过。")
                return None
    return value


def scan_character_looks(root: Path, character_directory: Path, warnings: list[str]) -> list[dict[str, Any]]:
    look_root = character_directory / CHARACTER_LOOK_DIRECTORY
    if lstat_kind(look_root) is None:
        return []
    if not normal_directory(look_root, f"{character_directory.name} 的造型目录"):
        return []
    looks: list[dict[str, Any]] = []
    for _name, directory, info in visible_children(look_root, warnings):
        if not stat.S_ISDIR(info.st_mode):
            continue
        parsed = parse_look_directory_name(directory.name)
        looks.append({
            "id": parsed["id"],
            "name": parsed["name"],
            "path": relative_path(root, directory),
            "has_document": normal_file(directory / CHARACTER_LOOK_DOCUMENT),
        })
    return sorted(looks, key=lambda item: (item["id"].casefold(), item["name"].casefold()))


def tree_fingerprint(root: Path, warnings: list[str]) -> str:
    records: list[str] = []
    count = 0

    def walk(directory: Path, depth: int) -> None:
        nonlocal count
        if depth > MAX_SCAN_DEPTH:
            warnings.append(f"目录层级超过 {MAX_SCAN_DEPTH}，其余内容未纳入指纹。")
            return
        for name, child, info in visible_children(directory, warnings):
            count += 1
            if count > MAX_PROJECT_ENTRIES:
                raise PlannerError(f"项目可见条目超过 {MAX_PROJECT_ENTRIES}，请缩小项目目录后再扫描。")
            kind = "D" if stat.S_ISDIR(info.st_mode) else "F"
            records.append(f"{relative_path(root, child)}|{kind}|{info.st_size}|{info.st_mtime_ns}")
            if kind == "D":
                walk(child, depth + 1)

    walk(root, 0)
    digest = hashlib.sha256("\n".join(sorted(records)).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def known_root_directories(root: Path, root_name: str, warnings: list[str]) -> list[Path]:
    candidate = root / root_name
    if lstat_kind(candidate) is None:
        return []
    if not normal_directory(candidate, root_name):
        return []
    return [child for _, child, info in visible_children(candidate, warnings) if stat.S_ISDIR(info.st_mode)]


def scan_project(root: Path) -> dict[str, Any]:
    """Build a compact visible-only project model. This function never writes."""
    warnings: list[str] = []
    fingerprint = tree_fingerprint(root, warnings)
    project_index = read_project_asset_index(root, warnings)

    characters: list[dict[str, Any]] = []
    for directory in known_root_directories(root, "主要人物", warnings):
        profile = directory / "角色设定.md"
        markdown = read_small_text(profile, warnings)
        characters.append({
            "name": directory.name,
            "path": relative_path(root, directory),
            "role_category": parse_role_category(markdown),
            "has_profile": normal_file(profile),
            "looks": scan_character_looks(root, directory, warnings),
        })

    scenes: list[dict[str, Any]] = []
    for directory in known_root_directories(root, "分镜", warnings):
        scene_markdown = read_small_text(directory / "场次.md", warnings)
        shots: list[dict[str, str]] = []
        for name, child, info in visible_children(directory, warnings):
            if not stat.S_ISDIR(info.st_mode):
                continue
            shot_design_path = child / "design.json"
            if not normal_file(shot_design_path):
                continue
            try:
                shot_design = json.loads(read_small_text(shot_design_path, warnings))
            except json.JSONDecodeError:
                warnings.append(f"{relative_path(root, shot_design_path)} 不是有效 JSON，已忽略。")
                continue
            if not isinstance(shot_design, dict):
                warnings.append(f"{relative_path(root, shot_design_path)} 必须是 JSON 对象，已忽略。")
                continue
            shot_id = shot_design.get("shotId")
            title = shot_design.get("title")
            if not isinstance(shot_id, str) or not shot_id or not isinstance(title, str) or not title:
                warnings.append(f"{relative_path(root, shot_design_path)} 缺少 shotId 或 title，已忽略。")
                continue
            shots.append({"id": shot_id, "title": title, "path": relative_path(root, child)})
        scenes.append({
            "scene_id": directory.name,
            "path": relative_path(root, directory),
            "has_scene_document": normal_file(directory / "场次.md"),
            "has_cast_sheet": normal_file(directory / SCENE_CAST_DOCUMENT),
            "title": parse_h1(scene_markdown, directory.name),
            "shot_count": len(shots),
            "shots": sorted(shots, key=lambda item: item["id"]),
        })

    locations: list[dict[str, Any]] = []
    for directory in known_root_directories(root, "场景", warnings):
        locations.append({
            "name": directory.name,
            "path": relative_path(root, directory),
            "has_profile": normal_file(directory / "场景设定.md"),
        })

    props: list[dict[str, Any]] = []
    for directory in known_root_directories(root, "道具", warnings):
        props.append({
            "name": directory.name,
            "path": relative_path(root, directory),
            "has_profile": normal_file(directory / "道具设定.md"),
        })

    return {
        "project_path": str(root),
        "project_name": root.name,
        "project_fingerprint": fingerprint,
        "characters": sorted(characters, key=lambda item: item["name"].casefold()),
        "scenes": sorted(scenes, key=lambda item: item["scene_id"].casefold()),
        "locations": sorted(locations, key=lambda item: item["name"].casefold()),
        "props": sorted(props, key=lambda item: item["name"].casefold()),
        "project_index": project_index,
        "warnings": list(dict.fromkeys(warnings)),
        "scanned_at": iso_time(),
    }


def existing_names(snapshot: dict[str, Any], key: str, field: str) -> set[str]:
    return {str(item[field]).casefold() for item in snapshot[key]}


def normalize_reuse_items(value: Any, label: str, existing: set[str]) -> list[dict[str, str]]:
    rows = require_list(value, label, MAX_LOCATIONS)
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, raw in enumerate(rows, start=1):
        item = require_mapping(raw, f"{label} 第 {index} 项")
        name = safe_segment(item.get("name"), f"{label} 第 {index} 项名称")
        if name.casefold() not in existing:
            raise PlannerError(f"{label} 中的“{name}”不在当前项目中；请改为 new_* 或先扫描正确项目。")
        if name.casefold() in seen:
            raise PlannerError(f"{label} 中重复引用了“{name}”。")
        seen.add(name.casefold())
        result.append({
            "name": name,
            "reason": read_text_value(item.get("reason"), f"{label} 第 {index} 项复用理由", maximum=MAX_SHORT_TEXT_CHARS),
        })
    return result


def first_present_value(item: Mapping[str, Any], *keys: str) -> Any:
    """Return the first supplied alias while preserving explicit empty values."""
    for key in keys:
        if key in item and item[key] is not None:
            return item[key]
    return None


def normalize_look(raw: Any, index: int, label: str, look_id: str) -> dict[str, Any]:
    item = require_mapping(raw, f"{label} 第 {index} 项")
    costume = read_text_value(item.get("costume"), "LOOK 服装", maximum=MAX_LONG_TEXT_CHARS, required=False)
    hair_makeup = read_text_value(
        item.get("hair_makeup"), "LOOK 妆发", maximum=MAX_LONG_TEXT_CHARS, required=False,
    )
    fixed_props = read_text_value(
        item.get("fixed_props"), "LOOK 固定道具", maximum=MAX_LONG_TEXT_CHARS, required=False,
    )
    continuity = read_text_value(
        item.get("continuity"), "LOOK 连续性", maximum=MAX_LONG_TEXT_CHARS, required=False,
    )
    prompt_value = first_present_value(
        item,
        "prompt",
        "visual_prompt",
        "visualPrompt",
        "costume_prompt",
        "costumePrompt",
    )
    prompt = read_text_value(prompt_value, "造型图提示词", maximum=MAX_LONG_TEXT_CHARS, required=False)
    if not prompt:
        visual_parts = [part for part in (costume, hair_makeup, fixed_props) if part]
        if visual_parts:
            prompt = (
                "人物造型三视图，单人全身，正面、左侧面、背面三视角并列，"
                f"{'；'.join(visual_parts)}，保持人物脸部与体态一致，干净浅色背景，无文字。"
            )
    negative_prompt = read_text_value(
        first_present_value(
            item,
            "negative_prompt",
            "negativePrompt",
            "costume_negative_prompt",
            "costumeNegativePrompt",
        ),
        "造型图负面提示词",
        maximum=MAX_LONG_TEXT_CHARS,
        required=False,
    )
    return {
        "id": look_id,
        "name": safe_segment(item.get("name"), "LOOK 名称"),
        "applicable_story": read_text_value(
            item.get("applicable_story"), "LOOK 适用剧情", maximum=MAX_SHORT_TEXT_CHARS, required=False,
        ),
        "costume": costume,
        "hair_makeup": hair_makeup,
        "fixed_props": fixed_props,
        "continuity": continuity,
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "notes": read_text_value(item.get("notes"), "LOOK 备注", maximum=MAX_LONG_TEXT_CHARS, required=False),
    }


def assert_unique_look_names(looks: list[dict[str, Any]], label: str, occupied: set[str] | None = None) -> None:
    seen = set(occupied or set())
    for look in looks:
        normalized_name = str(look["name"]).casefold()
        if normalized_name in seen:
            raise PlannerError(f"{label}名称重复或已存在：{look['name']}。")
        seen.add(normalized_name)


def normalize_new_character(raw: Any, index: int) -> dict[str, Any]:
    item = require_mapping(raw, f"new_characters 第 {index} 项")
    category = read_text_value(item.get("role_category"), "角色分类", maximum=30, multiline=False, required=False, fallback="待分类")
    if category not in ROLE_CATEGORIES:
        raise PlannerError(f"角色分类只能是：{'、'.join(ROLE_CATEGORIES)}。")
    looks = [normalize_look(look, look_index, "初始 LOOK", f"LOOK-{look_index:03d}") for look_index, look in enumerate(
        require_list(item.get("looks"), "初始 LOOK", MAX_LOOKS_PER_CHARACTER), start=1
    )]
    assert_unique_look_names(looks, "同一人物的初始 LOOK ")
    # `traits` and `costume` remain accepted so older proposal callers stay
    # compatible. The new names make the identity-vs-LOOK boundary explicit.
    identity_features_input = item.get("identity_features", item.get("traits"))
    baseline_input = item.get("baseline_presentation", item.get("costume"))
    identity = read_text_value(item.get("identity"), "人物身份", maximum=MAX_LONG_TEXT_CHARS)
    identity_baseline = read_text_value(
        item.get("identity_baseline"), "身份基准说明", maximum=MAX_LONG_TEXT_CHARS, required=False,
    ) or identity
    traits = string_list(identity_features_input, "身份锁定特征", maximum=24)
    baseline_presentation = string_list(baseline_input, "基础呈现", maximum=24)
    turnaround_prompt = read_text_value(
        first_present_value(
            item,
            "turnaround_prompt",
            "turnaroundPrompt",
            "three_view_prompt",
            "threeViewPrompt",
            "visual_prompt",
            "visualPrompt",
            "prompt",
        ),
        "人物三视图提示词",
        maximum=MAX_LONG_TEXT_CHARS,
        required=False,
    )
    if not turnaround_prompt:
        # Keep old plans runnable while ensuring the fallback is a visual
        # instruction rather than the complete Markdown profile.
        visual_parts = [identity_baseline, *traits, *baseline_presentation]
        visual_parts = [part for part in visual_parts if part]
        turnaround_prompt = (
            "人物三视图设定图，单人全身，正面、左侧面、背面三视角并列，"
            f"{'；'.join(visual_parts)}，保持脸部、体态、发型与服饰一致，"
            "中性站姿，均匀棚拍光，干净浅色背景，无文字。"
        )
    negative_prompt = read_text_value(
        first_present_value(
            item,
            "negative_prompt",
            "negativePrompt",
            "turnaround_negative_prompt",
            "turnaroundNegativePrompt",
        ),
        "人物三视图负面提示词",
        maximum=MAX_LONG_TEXT_CHARS,
        required=False,
    )
    return {
        "name": safe_segment(item.get("name"), "人物名称"),
        "role_category": category,
        "identity": identity,
        "identity_baseline": identity_baseline,
        "traits": traits,
        "baseline_presentation": baseline_presentation,
        "turnaround_prompt": turnaround_prompt,
        "negative_prompt": negative_prompt,
        "notes": read_text_value(item.get("notes"), "人物备注", maximum=MAX_LONG_TEXT_CHARS, required=False),
        "looks": looks,
    }


def existing_look_sequence(looks: list[dict[str, Any]]) -> int:
    """Return the largest canonical LOOK number already used by one character."""
    largest = 0
    for look in looks:
        match = LOOK_ID_RE.fullmatch(str(look.get("id", "")))
        if match:
            largest = max(largest, int(match.group(1)))
    return largest


def normalize_look_additions(value: Any, snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """Allocate stable LOOK ids for existing characters without mutating them yet."""
    rows = require_list(value, "look_additions", MAX_CHARACTERS)
    existing_by_name = {str(item["name"]).casefold(): item for item in snapshot["characters"]}
    additions: list[dict[str, Any]] = []
    seen_characters: set[str] = set()
    for index, raw in enumerate(rows, start=1):
        item = require_mapping(raw, f"look_additions 第 {index} 项")
        requested_name = safe_segment(item.get("character"), "新增 LOOK 的人物名称")
        normalized_name = requested_name.casefold()
        character = existing_by_name.get(normalized_name)
        if not character:
            raise PlannerError(f"look_additions 只能为当前项目已有的人物新增 LOOK：{requested_name}。")
        if normalized_name in seen_characters:
            raise PlannerError(f"同一人物只能有一条 look_additions：{requested_name}。")
        seen_characters.add(normalized_name)

        raw_looks = require_list(item.get("looks"), f"{requested_name} 的新增 LOOK", MAX_LOOKS_PER_CHARACTER)
        if not raw_looks:
            raise PlannerError(f"{requested_name} 的 look_additions 至少需要一套 LOOK。")
        largest = existing_look_sequence(list(character.get("looks", [])))
        if largest + len(raw_looks) > 999_999:
            raise PlannerError(f"{requested_name} 的 LOOK 编号已达到上限，不能再自动分配。")
        looks = [
            normalize_look(raw_look, look_index, f"{requested_name} 的新增 LOOK", f"LOOK-{largest + look_index:03d}")
            for look_index, raw_look in enumerate(raw_looks, start=1)
        ]
        existing_look_names = {str(look.get("name", "")).casefold() for look in character.get("looks", [])}
        assert_unique_look_names(looks, f"人物“{requested_name}”的新增 LOOK ", existing_look_names)
        additions.append({
            "character": str(character["name"]),
            "character_path": str(character["path"]),
            "looks": looks,
        })
    return additions


def normalize_new_location(raw: Any, index: int) -> dict[str, Any]:
    item = require_mapping(raw, f"new_locations 第 {index} 项")
    return {
        "name": safe_segment(item.get("name"), "场景名称"),
        "description": read_text_value(item.get("description"), "场景说明", maximum=MAX_LONG_TEXT_CHARS),
        "key_visuals": string_list(item.get("key_visuals"), "场景关键视觉", maximum=30),
        # Keep prompts separate from the human-readable setting so the
        # workbench does not have to submit the whole Markdown document.
        "prompt": read_text_value(item.get("prompt"), "场景图提示词", maximum=MAX_LONG_TEXT_CHARS, required=False),
        "negative_prompt": read_text_value(
            item.get("negative_prompt"), "场景图负面提示词", maximum=MAX_LONG_TEXT_CHARS, required=False,
        ),
    }


def normalize_new_prop(raw: Any, index: int) -> dict[str, Any]:
    item = require_mapping(raw, f"new_props 第 {index} 项")
    return {
        "name": safe_segment(item.get("name"), "道具名称"),
        "description": read_text_value(item.get("description"), "道具说明", maximum=MAX_LONG_TEXT_CHARS),
        "continuity": string_list(item.get("continuity"), "道具连续性", maximum=30),
        "prompt": read_text_value(item.get("prompt"), "道具图提示词", maximum=MAX_LONG_TEXT_CHARS, required=False),
        "negative_prompt": read_text_value(
            item.get("negative_prompt"), "道具图负面提示词", maximum=MAX_LONG_TEXT_CHARS, required=False,
        ),
    }


def normalize_optional_shot_id(value: Any, label: str) -> str:
    if value is None:
        return ""
    text = read_text_value(value, label, maximum=24, multiline=False, required=False)
    return normalize_shot_id(text) if text else ""


def normalize_scene_cast_binding(raw: Any, index: int) -> dict[str, str]:
    item = require_mapping(raw, f"场次出场与造型第 {index} 项")
    start_shot_id = normalize_optional_shot_id(item.get("start_shot_id"), "出场起始镜头")
    end_shot_id = normalize_optional_shot_id(item.get("end_shot_id"), "出场结束镜头")
    if start_shot_id and end_shot_id and int(start_shot_id[2:]) > int(end_shot_id[2:]):
        raise PlannerError("场次人物造型的结束镜头不能早于起始镜头。")
    return {
        "character": safe_segment(item.get("character"), "出场人物名称"),
        "look": read_text_value(item.get("look"), "默认 LOOK", maximum=160, multiline=False, required=False),
        "state": read_text_value(item.get("state"), "人物状态", maximum=MAX_SHORT_TEXT_CHARS, multiline=False, required=False),
        "continuity": read_text_value(item.get("continuity"), "人物连续性", maximum=MAX_SHORT_TEXT_CHARS, multiline=False, required=False),
        "start_shot_id": start_shot_id,
        "end_shot_id": end_shot_id,
    }


def normalize_scene_asset_binding(raw: Any, index: int, kind: str) -> dict[str, str]:
    """Normalize a scene-level location/prop binding before path resolution."""
    item = require_mapping(raw, f"场次{kind}绑定第 {index} 项")
    name_key = "location" if kind == "场景" else "prop"
    path_key = "locationPath" if kind == "场景" else "propPath"
    name = item.get(name_key, item.get("name"))
    if name is None and item.get(path_key) is not None:
        requested_path = read_text_value(item.get(path_key), f"场次{kind}绑定路径", maximum=240, multiline=False)
        path_parts = Path(requested_path).parts
        expected_root = "场景" if kind == "场景" else "道具"
        if len(path_parts) != 2 or path_parts[0] != expected_root:
            raise PlannerError(f"场次{kind}绑定路径必须是项目相对的 {expected_root}/名称。")
        name = path_parts[1]
    return {
        name_key: safe_segment(name, f"场次{kind}绑定名称"),
        "role": read_text_value(item.get("role"), f"场次{kind}绑定角色", maximum=MAX_SHORT_TEXT_CHARS, multiline=False, required=False, fallback=kind),
        "state": read_text_value(item.get("state"), f"场次{kind}状态", maximum=MAX_SHORT_TEXT_CHARS, multiline=False, required=False),
        "continuity": read_text_value(item.get("continuity"), f"场次{kind}连续性", maximum=MAX_SHORT_TEXT_CHARS, multiline=False, required=False),
        "start_shot_id": normalize_optional_shot_id(item.get("start_shot_id", item.get("startShotId")), f"{kind}绑定起始镜头"),
        "end_shot_id": normalize_optional_shot_id(item.get("end_shot_id", item.get("endShotId")), f"{kind}绑定结束镜头"),
    }


def normalize_shot_character_override(raw: Any, index: int) -> dict[str, str]:
    item = require_mapping(raw, f"镜头人物造型覆盖第 {index} 项")
    mode = read_text_value(item.get("mode"), "镜头造型处理方式", maximum=32, multiline=False)
    if mode not in {"inherit", "identity", "look"}:
        raise PlannerError("镜头造型处理方式只能是 inherit、identity 或 look。")
    look = read_text_value(item.get("look"), "镜头覆盖 LOOK", maximum=160, multiline=False, required=False)
    if mode == "look" and not look:
        raise PlannerError("镜头使用 look 覆盖时必须指定该人物的一套 LOOK。")
    if mode != "look" and look:
        raise PlannerError("只有 look 覆盖可以指定 LOOK。")
    return {
        "character": safe_segment(item.get("character"), "镜头覆盖人物名称"),
        "mode": mode,
        "look": look,
        "state": read_text_value(item.get("state"), "镜头局部状态", maximum=MAX_SHORT_TEXT_CHARS, multiline=False, required=False),
    }


def normalize_shot(raw: Any, index: int) -> dict[str, Any]:
    item = require_mapping(raw, f"镜头第 {index} 项")
    return {
        "id": normalize_shot_id(item.get("id")),
        "title": safe_segment(item.get("title"), "镜头标题"),
        "timecode": read_text_value(item.get("timecode"), "镜头时间码", maximum=120, required=False),
        "duration": read_text_value(item.get("duration"), "镜头时长", maximum=120, required=False),
        "framing": read_text_value(item.get("framing"), "镜头景别／机位", maximum=MAX_SHORT_TEXT_CHARS, required=False),
        "content": read_text_value(item.get("content"), "镜头画面描述", maximum=MAX_LONG_TEXT_CHARS),
        "dialogue": read_text_value(item.get("dialogue"), "镜头台词", maximum=MAX_LONG_TEXT_CHARS, required=False, fallback="无"),
        "camera": read_text_value(item.get("camera"), "镜头运镜", maximum=MAX_SHORT_TEXT_CHARS, required=False),
        "prompt": read_text_value(item.get("prompt"), "镜头提示词", maximum=MAX_LONG_TEXT_CHARS, required=False),
        "negative_prompt": read_text_value(item.get("negative_prompt"), "镜头负面提示词", maximum=MAX_LONG_TEXT_CHARS, required=False),
        "first_frame_prompt": read_text_value(
            item.get("first_frame_prompt"), "首帧提示词", maximum=MAX_LONG_TEXT_CHARS, required=False,
        ),
        "first_frame_negative_prompt": read_text_value(
            item.get("first_frame_negative_prompt"), "首帧负面提示词", maximum=MAX_LONG_TEXT_CHARS, required=False,
        ),
        "last_frame_prompt": read_text_value(
            item.get("last_frame_prompt"), "尾帧提示词", maximum=MAX_LONG_TEXT_CHARS, required=False,
        ),
        "last_frame_negative_prompt": read_text_value(
            item.get("last_frame_negative_prompt"), "尾帧负面提示词", maximum=MAX_LONG_TEXT_CHARS, required=False,
        ),
        "references": read_text_value(item.get("references"), "镜头参考资产", maximum=MAX_SHORT_TEXT_CHARS, required=False),
        "video_prompt": read_text_value(
            item.get("video_prompt"), "视频生成提示词", maximum=MAX_LONG_TEXT_CHARS, required=False,
        ),
        "character_overrides": [normalize_shot_character_override(override, override_index) for override_index, override in enumerate(
            require_list(item.get("character_overrides"), "镜头人物造型覆盖", MAX_SHOT_CHARACTER_OVERRIDES), start=1
        )],
        "status": read_text_value(item.get("status"), "镜头状态", maximum=120, required=False, fallback="待准备"),
    }


def normalize_new_scene(raw: Any, index: int) -> dict[str, Any]:
    item = require_mapping(raw, f"new_scenes 第 {index} 项")
    shots = [normalize_shot(shot, shot_index) for shot_index, shot in enumerate(
        require_list(item.get("shots"), "场次镜头", MAX_SHOTS_PER_SCENE), start=1
    )]
    seen_shots: set[str] = set()
    for shot in shots:
        if shot["id"] in seen_shots:
            raise PlannerError(f"场次内镜号重复：{shot['id']}。")
        seen_shots.add(shot["id"])
    cast = [normalize_scene_cast_binding(binding, binding_index) for binding_index, binding in enumerate(
        require_list(item.get("cast"), "场次出场与造型", MAX_SCENE_CAST_BINDINGS), start=1
    )]
    location_bindings = [normalize_scene_asset_binding(binding, binding_index, "场景") for binding_index, binding in enumerate(
        require_list(item.get("location_bindings"), "场次场景绑定", MAX_LOCATIONS), start=1
    )]
    prop_bindings = [normalize_scene_asset_binding(binding, binding_index, "道具") for binding_index, binding in enumerate(
        require_list(item.get("prop_bindings"), "场次道具绑定", MAX_PROPS), start=1
    )]
    for bindings, label in ((location_bindings, "场景"), (prop_bindings, "道具")):
        for binding in bindings:
            if binding["start_shot_id"] and binding["end_shot_id"] and int(binding["start_shot_id"][2:]) > int(binding["end_shot_id"][2:]):
                raise PlannerError(f"场次{label}绑定的结束镜头不能早于起始镜头。")
            for field in ("start_shot_id", "end_shot_id"):
                if binding[field] and binding[field] not in seen_shots:
                    raise PlannerError(f"场次{label}绑定引用了不存在的镜头：{binding[field]}。")
    location_refs = string_list(item.get("location_refs"), "场次场景引用", maximum=40)
    prop_refs = string_list(item.get("prop_refs"), "场次道具引用", maximum=40)
    if not location_refs:
        location_refs = [binding["location"] for binding in location_bindings]
    if not prop_refs:
        prop_refs = [binding["prop"] for binding in prop_bindings]
    return {
        "scene_id": safe_segment(item.get("scene_id"), "场次 ID"),
        "title": safe_segment(item.get("title"), "场次标题"),
        "time_place": read_text_value(item.get("time_place"), "场次地点／时间", maximum=MAX_SHORT_TEXT_CHARS, required=False),
        "summary": read_text_value(item.get("summary"), "场次概要", maximum=MAX_LONG_TEXT_CHARS),
        "mood": read_text_value(item.get("mood"), "场次氛围", maximum=MAX_LONG_TEXT_CHARS, required=False),
        "continuity": read_text_value(item.get("continuity"), "场次连续性", maximum=MAX_LONG_TEXT_CHARS, required=False),
        "prompt": read_text_value(item.get("prompt"), "场次提示词", maximum=MAX_LONG_TEXT_CHARS, required=False),
        "negative_prompt": read_text_value(
            item.get("negative_prompt"), "场次负面提示词", maximum=MAX_LONG_TEXT_CHARS, required=False,
        ),
        "character_refs": string_list(item.get("character_refs"), "场次人物引用", maximum=40),
        "location_refs": location_refs,
        "prop_refs": prop_refs,
        "location_bindings": location_bindings,
        "prop_bindings": prop_bindings,
        "cast": cast,
        "shots": shots,
    }


def assert_new_names(items: list[dict[str, Any]], existing: set[str], kind_label: str, name_field: str = "name") -> None:
    seen: set[str] = set()
    for item in items:
        name = str(item[name_field])
        normalized = name.casefold()
        if normalized in existing:
            raise PlannerError(f"{kind_label}“{name}”已存在；请将其放进 reuse_*，不要覆盖已有资产。")
        if normalized in seen:
            raise PlannerError(f"本次提案中重复创建{kind_label}“{name}”。")
        seen.add(normalized)


def build_character_catalog(
    snapshot: dict[str, Any],
    new_characters: list[dict[str, Any]],
    look_additions: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Resolve human-friendly character/LOOK names into workbench-relative paths."""
    catalog: dict[str, dict[str, Any]] = {}
    for existing in snapshot["characters"]:
        normalized = str(existing["name"]).casefold()
        catalog[normalized] = {
            "name": existing["name"],
            "path": existing["path"],
            "looks": list(existing.get("looks", [])),
        }
    for character in new_characters:
        root_path = f"主要人物/{character['name']}"
        looks: list[dict[str, str]] = []
        for look in character["looks"]:
            directory_name = f"{look['id']}-{look['name']}"
            looks.append({
                "id": look["id"],
                "name": look["name"],
                "path": f"{root_path}/{CHARACTER_LOOK_DIRECTORY}/{directory_name}",
            })
        catalog[character["name"].casefold()] = {
            "name": character["name"],
            "path": root_path,
            "looks": looks,
        }
    for addition in look_additions:
        character = catalog.get(str(addition["character"]).casefold())
        if not character:
            # `normalize_look_additions` only accepts snapshot characters; keep
            # this guard so a malformed staged proposal cannot target another path.
            raise PlannerError(f"新增 LOOK 人物不存在：{addition['character']}。")
        for look in addition["looks"]:
            directory_name = f"{look['id']}-{look['name']}"
            character["looks"].append({
                "id": look["id"],
                "name": look["name"],
                "path": f"{character['path']}/{CHARACTER_LOOK_DIRECTORY}/{directory_name}",
            })
    return catalog


def resolve_character_reference(catalog: dict[str, dict[str, Any]], name: str, label: str) -> dict[str, Any]:
    character = catalog.get(name.casefold())
    if not character:
        raise PlannerError(f"{label}“{name}”不在本次新建或当前项目人物中。")
    return character


def resolve_look_reference(character: dict[str, Any], requested: str, label: str) -> str | None:
    normalized = requested.strip().casefold()
    if not normalized or normalized in {"身份基准", "identity", "baseline", "none", "无"}:
        return None
    matches = [
        look for look in character.get("looks", [])
        if normalized in {
            str(look.get("id", "")).casefold(),
            str(look.get("name", "")).casefold(),
            Path(str(look.get("path", ""))).name.casefold(),
        }
    ]
    if not matches:
        raise PlannerError(f"{label}“{requested}”不属于人物“{character['name']}”。")
    if len(matches) > 1:
        raise PlannerError(f"{label}“{requested}”在人物“{character['name']}”下不唯一，请使用 LOOK 编号。")
    return str(matches[0]["path"])


def build_asset_catalog(snapshot: dict[str, Any], new_items: list[dict[str, Any]], root_name: str) -> dict[str, dict[str, str]]:
    catalog: dict[str, dict[str, str]] = {}
    for existing in snapshot["locations" if root_name == "场景" else "props"]:
        catalog[str(existing["name"]).casefold()] = {"name": str(existing["name"]), "path": str(existing["path"])}
    for item in new_items:
        catalog[str(item["name"]).casefold()] = {"name": str(item["name"]), "path": f"{root_name}/{item['name']}"}
    return catalog


def resolve_scene_asset_bindings(scene: dict[str, Any], catalog: dict[str, dict[str, str]], key: str, kind: str) -> list[dict[str, str]]:
    bindings: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for item in scene[key]:
        name_key = "location" if kind == "场景" else "prop"
        asset = catalog.get(item[name_key].casefold())
        if not asset:
            raise PlannerError(f"场次{kind}绑定“{item[name_key]}”不在本次新建或当前项目{kind}中。")
        binding = {
            f"{name_key}Path": asset["path"],
            "role": item["role"],
            "state": item["state"],
            "continuity": item["continuity"],
            "startShotId": item["start_shot_id"],
            "endShotId": item["end_shot_id"],
        }
        identity = (asset["path"].casefold(), binding["startShotId"], binding["endShotId"])
        if identity in seen:
            raise PlannerError(f"场次{kind}绑定重复：{asset['name']}。")
        seen.add(identity)
        for previous in bindings:
            if previous[f"{name_key}Path"] == binding[f"{name_key}Path"] and ranges_overlap(previous, binding):
                raise PlannerError(f"同一{kind}在重叠镜头范围内只能有一条场次绑定。")
        bindings.append(binding)
    return bindings


def ranges_overlap(left: dict[str, str], right: dict[str, str]) -> bool:
    left_start = int(left["startShotId"][2:]) if left["startShotId"] else float("-inf")
    left_end = int(left["endShotId"][2:]) if left["endShotId"] else float("inf")
    right_start = int(right["startShotId"][2:]) if right["startShotId"] else float("-inf")
    right_end = int(right["endShotId"][2:]) if right["endShotId"] else float("inf")
    return left_start <= right_end and right_start <= left_end


def binding_applies_to_shot(binding: dict[str, str], shot_id: str) -> bool:
    shot_number = int(shot_id[2:])
    start = int(binding["startShotId"][2:]) if binding["startShotId"] else float("-inf")
    end = int(binding["endShotId"][2:]) if binding["endShotId"] else float("inf")
    return start <= shot_number <= end


def resolve_scene_cast_bindings(scene: dict[str, Any], catalog: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    bindings: list[dict[str, str]] = []
    for item in scene["cast"]:
        character = resolve_character_reference(catalog, item["character"], "场次出场人物")
        look_path = resolve_look_reference(character, item["look"], "场次默认 LOOK")
        binding = {
            "characterPath": str(character["path"]),
            "state": item["state"],
            "continuity": item["continuity"],
            "startShotId": item["start_shot_id"],
            "endShotId": item["end_shot_id"],
        }
        if look_path:
            binding["lookPath"] = look_path
        for previous in bindings:
            if previous["characterPath"] == binding["characterPath"] and ranges_overlap(previous, binding):
                raise PlannerError("同一人物在重叠镜头范围内只能有一套场次默认造型。")
        bindings.append(binding)
    return bindings


def resolve_shot_character_overrides(
    shot: dict[str, Any],
    catalog: dict[str, dict[str, Any]],
    scene_cast_bindings: list[dict[str, str]],
) -> list[dict[str, str]]:
    overrides: list[dict[str, str]] = []
    seen_characters: set[str] = set()
    for item in shot["character_overrides"]:
        character = resolve_character_reference(catalog, item["character"], "镜头覆盖人物")
        character_path = str(character["path"])
        if character_path in seen_characters:
            raise PlannerError("同一镜头中的同一人物只能设置一条造型覆盖。")
        seen_characters.add(character_path)
        if item["mode"] == "inherit" and not any(
            binding["characterPath"] == character_path and binding_applies_to_shot(binding, shot["id"])
            for binding in scene_cast_bindings
        ):
            raise PlannerError(
                f"镜头 {shot['id']} 中人物“{character['name']}”不能继承场次：它未在该镜头范围内的场次出场表中生效。"
            )
        override = {
            "characterPath": character_path,
            "mode": item["mode"],
            "state": item["state"],
        }
        if item["mode"] == "look":
            look_path = resolve_look_reference(character, item["look"], "镜头覆盖 LOOK")
            if not look_path:
                raise PlannerError("镜头使用 look 覆盖时必须选择非身份基准的 LOOK。")
            override["lookPath"] = look_path
        overrides.append(override)
    return overrides


def normalize_plan(value: Any, snapshot: dict[str, Any]) -> dict[str, Any]:
    plan = require_mapping(value, "plan")
    new_characters = [normalize_new_character(item, index) for index, item in enumerate(
        require_list(plan.get("new_characters"), "new_characters", MAX_CHARACTERS), start=1
    )]
    new_locations = [normalize_new_location(item, index) for index, item in enumerate(
        require_list(plan.get("new_locations"), "new_locations", MAX_LOCATIONS), start=1
    )]
    new_props = [normalize_new_prop(item, index) for index, item in enumerate(
        require_list(plan.get("new_props"), "new_props", MAX_PROPS), start=1
    )]
    new_scenes = [normalize_new_scene(item, index) for index, item in enumerate(
        require_list(plan.get("new_scenes"), "new_scenes", MAX_SCENES), start=1
    )]

    character_names = existing_names(snapshot, "characters", "name")
    location_names = existing_names(snapshot, "locations", "name")
    prop_names = existing_names(snapshot, "props", "name")
    scene_names = existing_names(snapshot, "scenes", "scene_id")
    assert_new_names(new_characters, character_names, "人物")
    assert_new_names(new_locations, location_names, "场景")
    assert_new_names(new_props, prop_names, "道具")
    assert_new_names(new_scenes, scene_names, "场次", "scene_id")
    look_additions = normalize_look_additions(plan.get("look_additions"), snapshot)

    reuse_characters = normalize_reuse_items(plan.get("reuse_characters"), "reuse_characters", character_names)
    reuse_locations = normalize_reuse_items(plan.get("reuse_locations"), "reuse_locations", location_names)
    reuse_props = normalize_reuse_items(plan.get("reuse_props"), "reuse_props", prop_names)
    reuse_scenes = normalize_reuse_items(plan.get("reuse_scenes"), "reuse_scenes", scene_names)

    if not (new_characters or new_locations or new_props or new_scenes or look_additions):
        raise PlannerError("本提案没有任何要创建的新资产或新增 LOOK，不需要创建 proposal。")

    warnings: list[str] = []
    known_characters = character_names | {item["name"].casefold() for item in new_characters}
    known_locations = location_names | {item["name"].casefold() for item in new_locations}
    known_props = prop_names | {item["name"].casefold() for item in new_props}
    for scene in new_scenes:
        for field, known, label in (
            ("character_refs", known_characters, "人物"),
            ("location_refs", known_locations, "场景"),
            ("prop_refs", known_props, "道具"),
        ):
            missing = [name for name in scene[field] if name.casefold() not in known]
            if missing:
                warnings.append(f"{scene['scene_id']} 引用了尚未建档的{label}：{'、'.join(missing)}。")

    # The user-facing proposal uses names; persisted Markdown uses exact paths
    # so the workbench can distinguish the identity baseline from a reusable LOOK.
    character_catalog = build_character_catalog(snapshot, new_characters, look_additions)
    location_catalog = build_asset_catalog(snapshot, new_locations, "场景")
    prop_catalog = build_asset_catalog(snapshot, new_props, "道具")
    for scene in new_scenes:
        # Legacy plans only supplied refs; preserve them and materialize a
        # whole-scene default binding for the new machine-readable table.
        if not scene["location_bindings"]:
            scene["location_bindings"] = [
                {"location": name, "role": "场景", "state": "", "continuity": "", "start_shot_id": "", "end_shot_id": ""}
                for name in scene["location_refs"]
            ]
        if not scene["prop_bindings"]:
            scene["prop_bindings"] = [
                {"prop": name, "role": "道具", "state": "", "continuity": "", "start_shot_id": "", "end_shot_id": ""}
                for name in scene["prop_refs"]
            ]
        # Explicit bindings may refine only part of the legacy refs list;
        # retain every textual reference by adding a default whole-scene row.
        location_bound_names = {item["location"].casefold() for item in scene["location_bindings"]}
        for name in scene["location_refs"]:
            if name.casefold() not in location_bound_names:
                scene["location_bindings"].append({"location": name, "role": "场景", "state": "", "continuity": "", "start_shot_id": "", "end_shot_id": ""})
        prop_bound_names = {item["prop"].casefold() for item in scene["prop_bindings"]}
        for name in scene["prop_refs"]:
            if name.casefold() not in prop_bound_names:
                scene["prop_bindings"].append({"prop": name, "role": "道具", "state": "", "continuity": "", "start_shot_id": "", "end_shot_id": ""})
        scene["location_asset_bindings"] = resolve_scene_asset_bindings(scene, location_catalog, "location_bindings", "场景")
        scene["prop_asset_bindings"] = resolve_scene_asset_bindings(scene, prop_catalog, "prop_bindings", "道具")
        scene["cast_bindings"] = resolve_scene_cast_bindings(scene, character_catalog)
        for shot in scene["shots"]:
            shot["resolved_character_overrides"] = resolve_shot_character_overrides(
                shot, character_catalog, scene["cast_bindings"]
            )

    return {
        "title": read_text_value(plan.get("title"), "提案标题", maximum=MAX_SHORT_TEXT_CHARS),
        "summary": read_text_value(plan.get("summary"), "提案概要", maximum=MAX_LONG_TEXT_CHARS),
        "new_characters": new_characters,
        "look_additions": look_additions,
        "reuse_characters": reuse_characters,
        "new_locations": new_locations,
        "reuse_locations": reuse_locations,
        "new_props": new_props,
        "reuse_props": reuse_props,
        "new_scenes": new_scenes,
        "reuse_scenes": reuse_scenes,
        "notes": string_list(plan.get("notes"), "提案备注", maximum=40, item_maximum=MAX_LONG_TEXT_CHARS),
        "warnings": list(dict.fromkeys(warnings)),
    }


def proposal_paths(plan: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    for character in plan["new_characters"]:
        base = f"主要人物/{character['name']}"
        paths.extend([f"{base}/角色设定.md", f"{base}/角色设定.json", *(f"{base}/{slot}/" for slot in CHARACTER_SLOTS)])
        for look in character["looks"]:
            look_base = f"{base}/{CHARACTER_LOOK_DIRECTORY}/{look['id']}-{look['name']}"
            paths.extend([f"{look_base}/{CHARACTER_LOOK_DOCUMENT}", f"{look_base}/造型设定.json", *(f"{look_base}/{slot}/" for slot in CHARACTER_SLOTS)])
    for addition in plan["look_additions"]:
        base = f"{addition['character_path']}/{CHARACTER_LOOK_DIRECTORY}"
        for look in addition["looks"]:
            look_base = f"{base}/{look['id']}-{look['name']}"
            paths.extend([f"{look_base}/{CHARACTER_LOOK_DOCUMENT}", f"{look_base}/造型设定.json", *(f"{look_base}/{slot}/" for slot in CHARACTER_SLOTS)])
    for location in plan["new_locations"]:
        base = f"场景/{location['name']}"
        paths.extend([f"{base}/场景设定.md", f"{base}/场景设定.json", *(f"{base}/{slot}/" for slot in LOCATION_SLOTS)])
    for prop in plan["new_props"]:
        base = f"道具/{prop['name']}"
        paths.extend([f"{base}/道具设定.md", f"{base}/道具设定.json", *(f"{base}/{slot}/" for slot in PROP_SLOTS)])
    for scene in plan["new_scenes"]:
        base = f"分镜/{scene['scene_id']}"
        paths.extend([f"{base}/场次.md", f"{base}/场次.json", f"{base}/{SCENE_CAST_DOCUMENT}", f"{base}/{SCENE_ASSET_DOCUMENT}", *(f"{base}/{slot}/" for slot in SCENE_SLOTS)])
        for shot in scene["shots"]:
            shot_base = f"{base}/{shot['id']}-{shot['title']}"
            paths.extend([
                f"{shot_base}/design.json",
                f"{shot_base}/镜头.md",
                *(f"{shot_base}/{slot}/" for slot in SHOT_SLOTS),
            ])
    return paths


def proposal_summary(plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "new_characters": [item["name"] for item in plan["new_characters"]],
        "new_character_looks": [
            {"character": character["name"], "looks": [f"{look['id']} · {look['name']}" for look in character["looks"]]}
            for character in plan["new_characters"] if character["looks"]
        ],
        "look_additions": [
            {"character": addition["character"], "looks": [f"{look['id']} · {look['name']}" for look in addition["looks"]]}
            for addition in plan["look_additions"]
        ],
        "reuse_characters": [item["name"] for item in plan["reuse_characters"]],
        "new_locations": [item["name"] for item in plan["new_locations"]],
        "reuse_locations": [item["name"] for item in plan["reuse_locations"]],
        "new_props": [item["name"] for item in plan["new_props"]],
        "reuse_props": [item["name"] for item in plan["reuse_props"]],
        "new_scenes": [
            {
                "scene_id": scene["scene_id"],
                "title": scene["title"],
                "shot_count": len(scene["shots"]),
                "cast_binding_count": len(scene["cast_bindings"]),
                "location_binding_count": len(scene["location_asset_bindings"]),
                "prop_binding_count": len(scene["prop_asset_bindings"]),
                "location_bindings": scene["location_asset_bindings"],
                "prop_bindings": scene["prop_asset_bindings"],
            }
            for scene in plan["new_scenes"]
        ],
        "reuse_scenes": [item["name"] for item in plan["reuse_scenes"]],
    }


def state_root() -> Path:
    configured = os.environ.get("AI_DRAMA_PLANNER_STATE_DIR", "").strip()
    if configured:
        candidate = Path(configured).expanduser()
        if not candidate.is_absolute():
            raise PlannerError("AI_DRAMA_PLANNER_STATE_DIR 必须是绝对路径。")
        return candidate
    xdg_state = os.environ.get("XDG_STATE_HOME", "").strip()
    if xdg_state:
        return Path(xdg_state).expanduser() / "ai-drama-planner"
    return Path.home() / ".local" / "state" / "ai-drama-planner"


def proposal_directory() -> Path:
    directory = state_root() / "proposals"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def transaction_directory() -> Path:
    directory = state_root() / "transactions"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def atomic_write_json(target: Path, value: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    except BaseException:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def load_json(target: Path, label: str) -> dict[str, Any]:
    try:
        raw = target.read_text(encoding="utf-8")
        value = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PlannerError(f"无法读取{label}，请重新创建。") from error
    return require_mapping(value, label)


def proposal_file(proposal_id: Any) -> Path:
    identifier = read_text_value(proposal_id, "proposal_id", maximum=100, multiline=False)
    if not PROPOSAL_ID_RE.fullmatch(identifier):
        raise PlannerError("proposal_id 格式不正确。")
    return proposal_directory() / f"{identifier}.json"


def read_proposal(proposal_id: Any) -> dict[str, Any]:
    target = proposal_file(proposal_id)
    if not normal_file(target):
        raise PlannerError("找不到该 proposalId；它可能已过期或已被丢弃。")
    proposal = load_json(target, "提案")
    if proposal.get("proposal_id") != str(proposal_id):
        raise PlannerError("提案文件校验失败。")
    return proposal


def proposal_is_expired(proposal: dict[str, Any]) -> bool:
    raw = proposal.get("expires_at")
    if not isinstance(raw, str):
        return True
    try:
        expires = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return True
    return utc_now() >= expires


def cleanup_expired_proposals() -> None:
    directory = proposal_directory()
    for target in directory.glob(f"{PROPOSAL_PREFIX}*.json"):
        try:
            proposal = load_json(target, "提案")
        except PlannerError:
            continue
        if proposal_is_expired(proposal) or proposal.get("status") in {"applied", "discarded"}:
            try:
                target.unlink()
            except OSError:
                pass


def stage_proposal(arguments: dict[str, Any]) -> dict[str, Any]:
    root = ensure_project_root(arguments.get("project_path"))
    snapshot = scan_project(root)
    supplied_fingerprint = read_text_value(
        arguments.get("project_fingerprint"), "project_fingerprint", maximum=200, multiline=False
    )
    if supplied_fingerprint != snapshot["project_fingerprint"]:
        raise PlannerError("项目结构已变化或指纹不匹配，请重新调用 inspect_ai_drama_project 后再提案。")
    excerpt = read_text_value(arguments.get("novel_excerpt"), "小说片段", maximum=MAX_EXCERPT_CHARS)
    plan = normalize_plan(arguments.get("plan"), snapshot)
    now = utc_now()
    proposal_id = f"{PROPOSAL_PREFIX}{now.strftime('%Y%m%d%H%M%S')}_{secrets.token_urlsafe(9).replace('-', 'A').replace('_', 'B')}"
    confirmation = f"确认写入 {proposal_id}"
    proposal = {
        "schema_version": 1,
        "proposal_id": proposal_id,
        "status": "staged",
        "created_at": iso_time(now),
        "expires_at": iso_time(now + datetime.timedelta(hours=PROPOSAL_TTL_HOURS)),
        "project_path": str(root),
        "project_fingerprint": snapshot["project_fingerprint"],
        "excerpt_sha256": hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),
        "excerpt_preview": excerpt[:300],
        "plan": plan,
        "summary": proposal_summary(plan),
        "planned_paths": proposal_paths(plan),
        "confirmation_phrase": confirmation,
    }
    cleanup_expired_proposals()
    atomic_write_json(proposal_file(proposal_id), proposal)
    return {
        "ok": True,
        "proposal_id": proposal_id,
        "status": "staged",
        "project_path": str(root),
        "summary": proposal["summary"],
        "planned_path_count": len(proposal["planned_paths"]),
        "planned_paths": proposal["planned_paths"],
        "warnings": plan["warnings"],
        "confirmation_phrase": confirmation,
        "expires_at": proposal["expires_at"],
        "message": "提案已暂存，尚未修改项目。请等待用户明确确认后再调用写入工具。",
    }


def create_assets(arguments: dict[str, Any]) -> dict[str, Any]:
    """Validate and immediately commit a user-requested asset plan.

    The staged proposal remains the validation and transactional source of
    truth. This operation is exposed separately from preview mode, so its
    caller is the authorization boundary for an explicit create request.
    """
    staged = stage_proposal(arguments)
    proposal_id = staged["proposal_id"]
    try:
        applied = apply_proposal({
            "proposal_id": proposal_id,
            "confirmation": staged["confirmation_phrase"],
        })
    except BaseException:
        # Direct-create callers have no proposal UI to revisit after a failure.
        try:
            proposal_file(proposal_id).unlink(missing_ok=True)
        except OSError:
            pass
        raise
    # Preview mode keeps proposals for review; direct-create mode should not
    # leave a user-invisible draft behind after its transaction has finished.
    try:
        proposal_file(proposal_id).unlink(missing_ok=True)
    except OSError:
        pass
    return {
        **applied,
        "summary": staged["summary"],
        "planned_path_count": staged["planned_path_count"],
        "warnings": staged["warnings"],
        "message": "已校验并创建真实资产目录、设计 JSON 和 Markdown；没有生成图片或视频。",
    }


def markdown_list(items: list[str], empty: str = "未补充") -> str:
    return "\n".join(f"- {item}" for item in items) if items else f"- {empty}"


def write_markdown(target: Path, content: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    # pathlib.Path.write_text lacks the newline argument on older Python builds.
    with target.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content.rstrip() + "\n")


def write_document_pair(
    markdown_target: Path,
    json_target: Path,
    kind: str,
    content: str,
    prompt: str = "",
    negative_prompt: str = "",
) -> None:
    """Write Markdown plus a JSON sidecar whose content mirrors it exactly."""
    safe_content = content.rstrip() + "\n"
    write_markdown(markdown_target, safe_content)
    atomic_write_json(json_target, {
        "version": 1,
        "type": kind,
        "prompt": prompt,
        "negativePrompt": negative_prompt,
        "content": safe_content,
    })


def create_slots(directory: Path, slots: tuple[str, ...]) -> None:
    for slot in slots:
        (directory / slot).mkdir(parents=True, exist_ok=False)


def character_document(character: dict[str, Any], proposal_id: str) -> str:
    notes = character["notes"] or "待在后续视觉开发中补充。"
    return f"""# {character['name']}角色设定

## 身份基准

- **角色分类：** {character['role_category']}
- **身份：** {character['identity']}
- **身份基准说明：** {character['identity_baseline']}
- **提案来源：** {proposal_id}

人物根目录是身份基准：用于固定脸、体态、年龄观感、身份标记等不随剧情换装而变化的内容。具体服装、妆发、伤痕和状态应写入 `造型/LOOK-xxx-名称/`。

## 身份锁定特征

{markdown_list(character['traits'])}

## 基础呈现（不等同于 LOOK）

{markdown_list(character['baseline_presentation'])}

## 三视图提示词

{character.get('turnaround_prompt', '')}

## 三视图负面提示词

{character.get('negative_prompt', '')}

## 视觉资料

人物身份基准只保留 `三视图/` 资料槽；具体造型也只在各自的 `三视图/` 资料槽中保存视觉素材。

## 制作备注

{notes}
"""


def look_document(character: dict[str, Any], look: dict[str, Any], proposal_id: str) -> str:
    return f"""# {look['id']} {look['name']}

## 造型定位

- **人物：** {character['name']}
- **造型编号：** {look['id']}
- **造型名称：** {look['name']}
- **适用剧情：** {look['applicable_story'] or '待补充'}
- **提案来源：** {proposal_id}

## 服装与连续性

- **服装：** {look['costume'] or '待补充'}
- **妆发：** {look['hair_makeup'] or '待补充'}
- **固定道具：** {look['fixed_props'] or '待补充'}
- **连续性：** {look['continuity'] or '待补充'}

## 三视图提示词

{look.get('prompt', '')}

## 三视图负面提示词

{look.get('negative_prompt', '')}

## 制作备注

{look['notes'] or '三视图资料槽保持为空，等待真实素材。'}
"""


def location_document(location: dict[str, Any], proposal_id: str) -> str:
    return f"""# {location['name']}场景设定

## 场景说明

{location['description']}

## 关键视觉

{markdown_list(location['key_visuals'])}

## 场景图提示词

{location['prompt']}

## 负面提示词

{location['negative_prompt']}

## 制作备注

- **提案来源：** {proposal_id}
- **状态：** 待准备
- **说明：** 场景图、参考图、候选和定稿资料槽保持为空，等待真实素材。
"""


def prop_document(prop: dict[str, Any], proposal_id: str) -> str:
    return f"""# {prop['name']}道具设定

## 道具说明

{prop['description']}

## 连续性要求

{markdown_list(prop['continuity'])}

## 道具图提示词

{prop['prompt']}

## 负面提示词

{prop['negative_prompt']}

## 制作备注

- **提案来源：** {proposal_id}
- **状态：** 待准备
- **说明：** 参考图、候选和定稿资料槽保持为空，等待真实素材。
"""


def scene_document(scene: dict[str, Any], proposal_id: str) -> str:
    return f"""# {scene['scene_id']} {scene['title']}

## 场次说明

- **地点／时间：** {scene['time_place'] or '待补充'}
- **制作状态：** 待准备
- **提案来源：** {proposal_id}

## 场次概要

{scene['summary']}

## 情绪与视觉

{scene['mood'] or '待结合真实场景图和角色定稿补充。'}

## 连续性

{scene['continuity'] or '待补充。'}

## 提示词

{scene.get('prompt', '')}

## 负面提示词

{scene.get('negative_prompt', '')}

## 引用资产

- **人物：** {'、'.join(scene['character_refs']) or '未指定'}
- **场景：** {'、'.join(scene['location_refs']) or '未指定'}
- **道具：** {'、'.join(scene['prop_refs']) or '未指定'}

## 资料槽说明

场次只保留候选和定稿；首帧、尾帧及成片属于分镜生产，不放在场次目录。
"""


def escape_markdown_table_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\r", " ").replace("\n", " ").strip()


def scene_cast_document(scene: dict[str, Any]) -> str:
    bindings = scene["cast_bindings"]
    rows = []
    for binding in bindings:
        character_name = Path(binding["characterPath"]).name
        look_label = Path(binding["lookPath"]).name if binding.get("lookPath") else "身份基准"
        range_label = (
            f"{binding['startShotId'] or '首镜'} - {binding['endShotId'] or '尾镜'}"
            if binding["startShotId"] or binding["endShotId"] else "全场"
        )
        rows.append([character_name, look_label, range_label, binding["state"] or "无", binding["continuity"] or "无"])
    if not rows:
        rows = [["尚未配置", "—", "—", "—", "—"]]
    table_rows = [f"| {' | '.join(escape_markdown_table_cell(cell) for cell in row)} |" for row in rows]
    serialized = json.dumps({"version": 1, "bindings": bindings}, ensure_ascii=False, indent=2)
    return "\n".join([
        f"# {scene['scene_id']} 出场与造型表",
        "",
        SCENE_CAST_MARKER_START,
        serialized,
        SCENE_CAST_MARKER_END,
        "",
        "本表定义本场默认的人物与造型；镜头只记录临时状态或换装覆盖。",
        "",
        "| 人物 | 默认造型 | 生效镜头 | 状态 | 连续性 |",
        "| --- | --- | --- | --- | --- |",
        *table_rows,
    ])


def scene_asset_document(scene: dict[str, Any]) -> str:
    """Persist exact project-relative location/prop bindings for the scene."""
    locations = scene["location_asset_bindings"]
    props = scene["prop_asset_bindings"]
    # Keep both the JSON shape and the generated table projection identical
    # to workspace-core so a later workbench save replaces, rather than
    # appends to, this planner-produced document.
    serialized = json.dumps({"version": 1, "locations": locations, "props": props}, ensure_ascii=False, indent=2)
    def table_rows(items: list[dict[str, str]], label: str, path_key: str) -> list[str]:
        rows = [
            f"| {label} | 角色 | 生效镜头 | 状态 | 连续性 |",
            "| --- | --- | --- | --- | --- |",
        ]
        if not items:
            return [*rows, "| 尚未配置 | — | — | — | — |"]
        for binding in items:
            range_label = (
                f"{binding['startShotId'] or '首镜'} - {binding['endShotId'] or '尾镜'}"
                if binding["startShotId"] or binding["endShotId"] else "全场"
            )
            rows.append(
                "| " + " | ".join(escape_markdown_table_cell(cell) for cell in [
                    Path(binding[path_key]).name,
                    binding["role"],
                    range_label,
                    binding["state"],
                    binding["continuity"],
                ]) + " |"
            )
        return rows
    return "\n".join([
        SCENE_ASSET_PROJECTION_MARKER_START,
        f"# {scene['scene_id']} 场次资产表",
        "",
        SCENE_ASSET_MARKER_START,
        serialized,
        SCENE_ASSET_MARKER_END,
        "",
        "本表定义本场使用的地点与道具；镜头只记录临时状态覆盖。",
        "",
        *table_rows(locations, "地点", "locationPath"),
        "",
        *table_rows(props, "道具", "propPath"),
        SCENE_ASSET_PROJECTION_MARKER_END,
    ])


def shot_character_overrides_section(overrides: list[dict[str, str]]) -> str:
    rows = []
    for override in overrides:
        character_name = Path(override["characterPath"]).name
        mode_label = {"inherit": "继承场次", "identity": "使用身份基准", "look": "覆盖造型"}[override["mode"]]
        look_label = Path(override["lookPath"]).name if override.get("lookPath") else "—"
        rows.append([character_name, mode_label, look_label, override["state"] or "无"])
    if not rows:
        rows = [["无", "继承场次", "—", "无"]]
    table_rows = [f"| {' | '.join(escape_markdown_table_cell(cell) for cell in row)} |" for row in rows]
    serialized = json.dumps({"version": 1, "overrides": overrides}, ensure_ascii=False, indent=2)
    return "\n".join([
        "## 人物造型覆盖",
        "",
        SHOT_CHARACTER_OVERRIDES_MARKER_START,
        serialized,
        SHOT_CHARACTER_OVERRIDES_MARKER_END,
        "",
        "| 人物 | 处理方式 | 造型 | 局部状态 |",
        "| --- | --- | --- | --- |",
        *table_rows,
    ])


def shot_document(scene: dict[str, Any], shot: dict[str, Any], proposal_id: str) -> str:
    return f"""# {shot['id']} {shot['title']}

- **场次：** {scene['scene_id']}
- **镜号：** {shot['id']}
- **时间码：** {shot['timecode']}
- **时长：** {shot['duration']}
- **景别／机位：** {shot['framing']}
- **运镜：** {shot['camera']}
- **状态：** {shot['status']}
- **参考人物：** {shot['references']}
- **提案来源：** {proposal_id}

## 画面描述

{shot['content']}

## 台词

{shot['dialogue']}

## 提示词

{shot['prompt']}

## 负面提示词

{shot['negative_prompt']}

## 首帧提示词

{shot['first_frame_prompt']}

## 首帧负面提示词

{shot['first_frame_negative_prompt']}

## 尾帧提示词

{shot['last_frame_prompt']}

## 尾帧负面提示词

{shot['last_frame_negative_prompt']}

## 视频生成提示词

{shot['video_prompt']}

{shot_character_overrides_section(shot['resolved_character_overrides'])}
"""


def shot_design(scene: dict[str, Any], shot: dict[str, Any]) -> dict[str, Any]:
    return {
        "sceneId": scene["scene_id"],
        "shotId": shot["id"],
        "title": shot["title"],
        "timecode": shot["timecode"],
        "duration": shot["duration"],
        "framing": shot["framing"],
        "content": shot["content"],
        "dialogue": shot["dialogue"],
        "camera": shot["camera"],
        "prompt": shot["prompt"],
        "negativePrompt": shot["negative_prompt"],
        "firstFramePrompt": shot["first_frame_prompt"],
        "firstFrameNegativePrompt": shot["first_frame_negative_prompt"],
        "lastFramePrompt": shot["last_frame_prompt"],
        "lastFrameNegativePrompt": shot["last_frame_negative_prompt"],
        "references": shot["references"],
        "videoPrompt": shot["video_prompt"],
        "characterOverrides": shot["resolved_character_overrides"],
        "status": shot["status"],
    }


def build_stage_tree(stage: Path, proposal: dict[str, Any]) -> list[dict[str, str]]:
    plan = require_mapping(proposal.get("plan"), "提案计划")
    proposal_id = read_text_value(proposal.get("proposal_id"), "proposal_id", maximum=100, multiline=False)
    targets: list[dict[str, str]] = []
    for character in plan["new_characters"]:
        directory = stage / "主要人物" / character["name"]
        directory.mkdir(parents=True, exist_ok=False)
        character_content = character_document(character, proposal_id)
        write_document_pair(
            directory / "角色设定.md",
            directory / "角色设定.json",
            "character",
            character_content,
            character["turnaround_prompt"],
            character["negative_prompt"],
        )
        create_slots(directory, CHARACTER_SLOTS)
        if character["looks"]:
            look_root = directory / CHARACTER_LOOK_DIRECTORY
            look_root.mkdir(exist_ok=False)
            for look in character["looks"]:
                look_directory = look_root / f"{look['id']}-{look['name']}"
                look_directory.mkdir(exist_ok=False)
                look_content = look_document(character, look, proposal_id)
                write_document_pair(
                    look_directory / CHARACTER_LOOK_DOCUMENT,
                    look_directory / "造型设定.json",
                    "look",
                    look_content,
                    look["prompt"],
                    look["negative_prompt"],
                )
                create_slots(look_directory, CHARACTER_SLOTS)
        targets.append({
            "stage_rel": directory.relative_to(stage).as_posix(),
            "target_rel": directory.relative_to(stage).as_posix(),
        })
    for addition in plan["look_additions"]:
        character_name = safe_segment(addition.get("character"), "新增 LOOK 人物名称")
        expected_character_path = f"主要人物/{character_name}"
        if addition.get("character_path") != expected_character_path:
            raise PlannerError("新增 LOOK 的人物路径与人物名称不一致。")
        character_directory = stage / "主要人物" / addition["character"]
        look_root = character_directory / CHARACTER_LOOK_DIRECTORY
        look_root.mkdir(parents=True, exist_ok=False)
        character_stub = {"name": addition["character"]}
        for look in addition["looks"]:
            look_directory = look_root / f"{look['id']}-{look['name']}"
            look_directory.mkdir(exist_ok=False)
            look_content = look_document(character_stub, look, proposal_id)
            write_document_pair(
                look_directory / CHARACTER_LOOK_DOCUMENT,
                look_directory / "造型设定.json",
                "look",
                look_content,
                look["prompt"],
                look["negative_prompt"],
            )
            create_slots(look_directory, CHARACTER_SLOTS)
            target_rel = f"{addition['character_path']}/{CHARACTER_LOOK_DIRECTORY}/{look_directory.name}"
            targets.append({
                "stage_rel": look_directory.relative_to(stage).as_posix(),
                "target_rel": target_rel,
            })
    for location in plan["new_locations"]:
        directory = stage / "场景" / location["name"]
        directory.mkdir(parents=True, exist_ok=False)
        location_content = location_document(location, proposal_id)
        write_document_pair(
            directory / "场景设定.md",
            directory / "场景设定.json",
            "location",
            location_content,
            location["prompt"],
            location["negative_prompt"],
        )
        create_slots(directory, LOCATION_SLOTS)
        targets.append({
            "stage_rel": directory.relative_to(stage).as_posix(),
            "target_rel": directory.relative_to(stage).as_posix(),
        })
    for prop in plan["new_props"]:
        directory = stage / "道具" / prop["name"]
        directory.mkdir(parents=True, exist_ok=False)
        prop_content = prop_document(prop, proposal_id)
        write_document_pair(
            directory / "道具设定.md",
            directory / "道具设定.json",
            "prop",
            prop_content,
            prop["prompt"],
            prop["negative_prompt"],
        )
        create_slots(directory, PROP_SLOTS)
        targets.append({
            "stage_rel": directory.relative_to(stage).as_posix(),
            "target_rel": directory.relative_to(stage).as_posix(),
        })
    for scene in plan["new_scenes"]:
        directory = stage / "分镜" / scene["scene_id"]
        directory.mkdir(parents=True, exist_ok=False)
        scene_content = scene_document(scene, proposal_id)
        write_document_pair(
            directory / "场次.md",
            directory / "场次.json",
            "scene",
            scene_content,
            scene["prompt"],
            scene["negative_prompt"],
        )
        write_markdown(directory / SCENE_CAST_DOCUMENT, scene_cast_document(scene))
        write_markdown(directory / SCENE_ASSET_DOCUMENT, scene_asset_document(scene))
        create_slots(directory, SCENE_SLOTS)
        for shot in scene["shots"]:
            shot_directory = directory / f"{shot['id']}-{shot['title']}"
            shot_directory.mkdir(parents=True, exist_ok=False)
            atomic_write_json(shot_directory / "design.json", shot_design(scene, shot))
            write_markdown(shot_directory / "镜头.md", shot_document(scene, shot, proposal_id))
            create_slots(shot_directory, SHOT_SLOTS)
        targets.append({
            "stage_rel": directory.relative_to(stage).as_posix(),
            "target_rel": directory.relative_to(stage).as_posix(),
        })
    if not targets:
        raise PlannerError("暂存内容为空，拒绝写入。")
    target_paths = [record["target_rel"].casefold() for record in targets]
    if len(target_paths) != len(set(target_paths)):
        raise PlannerError("暂存内容包含重复目标目录。")
    return targets


def safe_project_child(root: Path, relative: str) -> Path:
    parts = Path(relative).parts
    if not parts or parts[0] not in TOP_LEVEL_ROOTS:
        raise PlannerError("提案包含不允许的顶层目录。")
    for part in parts:
        safe_segment(part, "提案目录名")
    candidate = root.joinpath(*parts)
    relative_path(root, candidate)
    return candidate


def ensure_target_parents(root: Path, targets: list[dict[str, str]]) -> list[str]:
    """Create only missing real parents and journal them for rollback.

    A new LOOK is a leaf below an existing character, unlike a new character
    which is itself a top-level target.  Treat every parent uniformly so a
    failed nested write can remove only directories created by this transaction.
    """
    created: list[str] = []
    seen: set[str] = set()
    for record in targets:
        target = safe_project_child(root, record["target_rel"])
        parts = target.relative_to(root).parts
        for depth in range(1, len(parts)):
            relative = Path(*parts[:depth])
            relative_text = relative.as_posix()
            if relative_text in seen:
                continue
            parent = root / relative
            kind = lstat_kind(parent)
            if kind is None:
                try:
                    parent.mkdir(mode=0o755)
                except FileExistsError:
                    kind = lstat_kind(parent)
                    if kind != "directory":
                        raise PlannerError(f"目标父目录 {relative_text} 不是安全普通目录。")
                else:
                    created.append(relative_text)
            elif kind != "directory":
                raise PlannerError(f"目标父目录 {relative_text} 不是安全普通目录。")
            seen.add(relative_text)
    return created


def assert_targets_absent(root: Path, targets: list[dict[str, str]]) -> None:
    for record in targets:
        target = safe_project_child(root, record["target_rel"])
        kind = lstat_kind(target)
        if kind is not None:
            raise PlannerError(f"目标已存在，拒绝覆盖：{relative_path(root, target)}")


def transaction_file(transaction_id: str) -> Path:
    safe = safe_segment(transaction_id, "事务 ID", maximum=128)
    return transaction_directory() / f"{safe}.json"


def write_transaction(journal: dict[str, Any]) -> None:
    atomic_write_json(transaction_file(str(journal["transaction_id"])), journal)


def cleanup_empty_parents(root: Path, parents: list[str]) -> None:
    for relative in reversed(parents):
        candidate = safe_project_child(root, relative)
        try:
            if lstat_kind(candidate) == "directory" and not any(candidate.iterdir()):
                candidate.rmdir()
        except OSError:
            pass


def rollback_journal(journal: dict[str, Any]) -> None:
    root = ensure_project_root(journal.get("project_path"))
    stage = Path(read_text_value(journal.get("stage_dir"), "暂存目录", maximum=4_096, multiline=False))
    if not stage.is_absolute():
        raise PlannerError("事务暂存目录不安全。")
    targets = require_list(journal.get("targets"), "事务目标", 200)
    moved = require_list(journal.get("moved"), "事务进度", 200)
    pending = journal.get("pending")
    rollback_records = list(reversed(moved))
    if isinstance(pending, dict):
        rollback_records.insert(0, pending)

    unresolved: list[str] = []
    for raw in rollback_records:
        record = require_mapping(raw, "事务目标")
        stage_target = stage / read_text_value(record.get("stage_rel"), "暂存路径", maximum=512, multiline=False)
        target = safe_project_child(root, read_text_value(record.get("target_rel"), "目标路径", maximum=512, multiline=False))
        target_kind = lstat_kind(target)
        stage_kind = lstat_kind(stage_target)
        if target_kind is None:
            continue
        if stage_kind is not None:
            unresolved.append(relative_path(root, target))
            continue
        try:
            stage_target.parent.mkdir(parents=True, exist_ok=True)
            os.rename(target, stage_target)
        except OSError:
            unresolved.append(relative_path(root, target))
    if unresolved:
        raise PlannerError(f"事务回滚未完成：{'、'.join(unresolved)}。请勿手动覆盖这些目录。")
    if stage.exists():
        shutil.rmtree(stage)
    cleanup_empty_parents(root, [str(item) for item in journal.get("created_roots", [])])
    try:
        transaction_file(str(journal["transaction_id"])).unlink(missing_ok=True)
    except OSError:
        pass


def recover_pending_transactions(root: Path) -> None:
    """Recover only while executing a user-confirmed write request."""
    directory = transaction_directory()
    for target in directory.glob("*.json"):
        try:
            journal = load_json(target, "事务记录")
        except PlannerError:
            continue
        if journal.get("project_path") != str(root):
            continue
        state = journal.get("state")
        if state == "committed":
            stage = Path(str(journal.get("stage_dir", "")))
            if stage.exists():
                shutil.rmtree(stage)
            target.unlink(missing_ok=True)
            continue
        rollback_journal(journal)


@contextmanager
def project_lock(root: Path) -> Iterator[None]:
    """Use an advisory lock only during an already confirmed local write."""
    lock_path = root / ".ai-drama-planner.lock"
    if lstat_kind(lock_path) == "symlink":
        raise PlannerError("项目锁文件不能是软链接。")
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(lock_path, flags, 0o600)
    try:
        try:
            import fcntl  # Available on macOS and Linux, which are the supported local targets.
            fcntl.flock(descriptor, fcntl.LOCK_EX)
        except ImportError:
            pass
        yield
    finally:
        try:
            try:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            except ImportError:
                pass
            os.close(descriptor)
        finally:
            try:
                if lstat_kind(lock_path) == "file":
                    lock_path.unlink()
            except OSError:
                pass


def commit_proposal(root: Path, proposal: dict[str, Any]) -> list[str]:
    transaction_id = f"txn_{proposal['proposal_id']}_{secrets.token_hex(4)}"
    stage = Path(tempfile.mkdtemp(prefix=".ai-drama-planner-stage-", dir=root))
    journal: dict[str, Any] | None = None
    try:
        targets = build_stage_tree(stage, proposal)
        assert_targets_absent(root, targets)
        journal = {
            "transaction_id": transaction_id,
            "project_path": str(root),
            "stage_dir": str(stage),
            "targets": targets,
            "moved": [],
            "pending": None,
            "created_roots": [],
            "state": "prepared",
            "created_at": iso_time(),
        }
        write_transaction(journal)
        journal["created_roots"] = ensure_target_parents(root, targets)
        write_transaction(journal)
        for record in targets:
            assert_targets_absent(root, [record])
            journal["pending"] = record
            journal["state"] = "moving"
            write_transaction(journal)
            stage_target = stage / record["stage_rel"]
            target = safe_project_child(root, record["target_rel"])
            os.rename(stage_target, target)
            journal["moved"].append(record)
            journal["pending"] = None
            write_transaction(journal)
        journal["state"] = "committed"
        write_transaction(journal)
        if stage.exists():
            shutil.rmtree(stage)
        transaction_file(transaction_id).unlink(missing_ok=True)
        return [record["target_rel"] for record in targets]
    except BaseException as error:
        if journal is not None:
            try:
                rollback_journal(journal)
            except PlannerError as rollback_error:
                raise PlannerError(f"写入失败，且自动回滚未完成：{rollback_error}") from error
        else:
            try:
                if stage.exists():
                    shutil.rmtree(stage)
            except OSError:
                pass
        if isinstance(error, PlannerError):
            raise
        raise PlannerError(f"写入失败，已尝试回滚：{error}") from error


def apply_proposal(arguments: dict[str, Any]) -> dict[str, Any]:
    proposal_id = read_text_value(arguments.get("proposal_id"), "proposal_id", maximum=100, multiline=False)
    proposal = read_proposal(proposal_id)
    if proposal.get("status") != "staged":
        raise PlannerError("该提案不是待确认状态，不能再次写入。")
    if proposal_is_expired(proposal):
        raise PlannerError("该提案已过期，请重新扫描并创建新提案。")
    expected_confirmation = f"确认写入 {proposal_id}"
    confirmation = read_text_value(arguments.get("confirmation"), "确认语句", maximum=160, multiline=False)
    if confirmation != expected_confirmation:
        raise PlannerError(f"确认语句必须精确为：{expected_confirmation}")
    root = ensure_project_root(proposal.get("project_path"))
    with project_lock(root):
        recover_pending_transactions(root)
        current = scan_project(root)
        if current["project_fingerprint"] != proposal.get("project_fingerprint"):
            raise PlannerError("项目在提案后已变化，为避免覆盖或冲突，请重新扫描并生成新提案。")
        created = commit_proposal(root, proposal)
    proposal["status"] = "applied"
    proposal["applied_at"] = iso_time()
    proposal["created_roots"] = created
    warning = ""
    try:
        atomic_write_json(proposal_file(proposal_id), proposal)
    except OSError:
        warning = "项目已成功写入，但私有提案状态未能更新；请不要重复执行该 proposalId。"
    return {
        "ok": True,
        "proposal_id": proposal_id,
        "status": "applied",
        "project_path": str(root),
        "created_roots": created,
        "created_root_count": len(created),
        "warning": warning,
        "message": "已创建真实目录与 Markdown；资料槽保持为空，没有生成任何媒体文件。",
    }


def get_proposal(arguments: dict[str, Any]) -> dict[str, Any]:
    proposal = read_proposal(arguments.get("proposal_id"))
    # A proposal is private state, but its stored project path must still be
    # checked against the current host scope before it is exposed or reused.
    root = ensure_project_root(proposal.get("project_path"))
    return {
        "ok": True,
        "proposal_id": proposal["proposal_id"],
        "status": proposal.get("status"),
        "created_at": proposal.get("created_at"),
        "expires_at": proposal.get("expires_at"),
        "project_path": str(root),
        "summary": proposal.get("summary"),
        "planned_paths": proposal.get("planned_paths"),
        "warnings": proposal.get("plan", {}).get("warnings", []),
        "confirmation_phrase": proposal.get("confirmation_phrase"),
    }


def discard_proposal(arguments: dict[str, Any]) -> dict[str, Any]:
    proposal_id = read_text_value(arguments.get("proposal_id"), "proposal_id", maximum=100, multiline=False)
    proposal = read_proposal(proposal_id)
    if proposal.get("status") != "staged":
        raise PlannerError("只能丢弃尚未写入的提案。")
    ensure_project_root(proposal.get("project_path"))
    proposal_file(proposal_id).unlink(missing_ok=True)
    return {
        "ok": True,
        "proposal_id": proposal_id,
        "status": "discarded",
        "message": "已丢弃私有提案，项目目录没有发生变化。",
    }


def input_schema() -> list[dict[str, Any]]:
    return [
        {
            "name": "inspect_ai_drama_project",
            "description": "只读扫描 AI 漫剧项目的人物、场次、分镜、场景和道具，返回项目指纹。不会创建或修改文件。",
            "inputSchema": {
                "type": "object",
                "properties": {"project_path": {"type": "string", "description": "用户明确指定的项目绝对路径。"}},
                "required": ["project_path"],
                "additionalProperties": False,
            },
        },
        {
            "name": "stage_ai_drama_proposal",
            "description": "验证并暂存小说拆解提案，返回 proposalId 和精确确认语句。不会修改项目目录。先调用 inspect_ai_drama_project。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_path": {"type": "string"},
                    "project_fingerprint": {"type": "string", "description": "inspect 返回的 project_fingerprint。"},
                    "novel_excerpt": {"type": "string", "description": "用户提供的小说或剧本片段，仅用于记录提案来源摘要。"},
                    "plan": {"type": "object", "description": "使用 ai-drama-planner 技能中的 new_* / reuse_* / look_additions 计划结构。"},
                },
                "required": ["project_path", "project_fingerprint", "novel_excerpt", "plan"],
                "additionalProperties": False,
            },
        },
        {
            "name": "create_ai_drama_assets",
            "description": "用户明确要求创建小说资产时使用。先校验计划，再在同一次调用中以可回滚事务写入人物、场景、道具、场次和分镜；不会生成图片或视频。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_path": {"type": "string"},
                    "project_fingerprint": {"type": "string", "description": "inspect 返回的 project_fingerprint。"},
                    "novel_excerpt": {"type": "string", "description": "用户提供的小说或剧本片段，仅用于记录资产来源摘要。"},
                    "plan": {"type": "object", "description": "使用 ai-drama-planner 技能中的 new_* / reuse_* / look_additions 计划结构。"},
                },
                "required": ["project_path", "project_fingerprint", "novel_excerpt", "plan"],
                "additionalProperties": False,
            },
        },
        {
            "name": "get_ai_drama_proposal",
            "description": "读取已暂存提案的摘要、目录清单和确认语句；不会修改项目。",
            "inputSchema": {
                "type": "object",
                "properties": {"proposal_id": {"type": "string"}},
                "required": ["proposal_id"],
                "additionalProperties": False,
            },
        },
        {
            "name": "apply_ai_drama_proposal",
            "description": "仅在用户明确回复“确认写入 <proposalId>”后调用。会再次校验项目指纹和冲突，并以可回滚事务创建空资料槽和 Markdown。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "proposal_id": {"type": "string"},
                    "confirmation": {"type": "string", "description": "必须原样传入用户的“确认写入 <proposalId>”语句。"},
                },
                "required": ["proposal_id", "confirmation"],
                "additionalProperties": False,
            },
        },
        {
            "name": "discard_ai_drama_proposal",
            "description": "丢弃尚未执行的私有提案；不会修改项目目录。",
            "inputSchema": {
                "type": "object",
                "properties": {"proposal_id": {"type": "string"}},
                "required": ["proposal_id"],
                "additionalProperties": False,
            },
        },
    ]


def tool_result(payload: dict[str, Any], *, is_error: bool = False) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
        "structuredContent": payload,
        **({"isError": True} if is_error else {}),
    }


def call_tool(name: str, arguments: Any) -> dict[str, Any]:
    try:
        params = require_mapping(arguments or {}, "工具参数")
        if name == "inspect_ai_drama_project":
            root = ensure_project_root(params.get("project_path"))
            return tool_result({"ok": True, **scan_project(root)})
        if name == "stage_ai_drama_proposal":
            return tool_result(stage_proposal(params))
        if name == "create_ai_drama_assets":
            return tool_result(create_assets(params))
        if name == "get_ai_drama_proposal":
            return tool_result(get_proposal(params))
        if name == "apply_ai_drama_proposal":
            return tool_result(apply_proposal(params))
        if name == "discard_ai_drama_proposal":
            return tool_result(discard_proposal(params))
        raise PlannerError(f"未知工具：{name}")
    except PlannerError as error:
        return tool_result({"ok": False, "error": str(error)}, is_error=True)
    except Exception as error:  # Keep implementation details out of the user-visible result.
        print(f"Unexpected planner error: {error}", file=sys.stderr, flush=True)
        return tool_result({"ok": False, "error": "本地规划器发生未预期错误，请查看 MCP 服务日志。"}, is_error=True)


def read_message() -> dict[str, Any] | None:
    """Accept JSON-lines and Content-Length framing for local MCP clients."""
    first = sys.stdin.buffer.readline()
    if not first:
        return None
    stripped = first.strip()
    if not stripped:
        return read_message()
    if stripped.lower().startswith(b"content-length:"):
        try:
            content_length = int(stripped.split(b":", 1)[1].strip())
        except ValueError as error:
            raise PlannerError("无效的 Content-Length。") from error
        while True:
            header = sys.stdin.buffer.readline()
            if not header:
                raise PlannerError("MCP 消息头未完成。")
            if header in {b"\n", b"\r\n"}:
                break
        body = sys.stdin.buffer.read(content_length)
        if len(body) != content_length:
            raise PlannerError("MCP 消息体未完成。")
        raw = body.decode("utf-8")
    else:
        raw = stripped.decode("utf-8")
    value = json.loads(raw)
    return require_mapping(value, "MCP 消息")


def write_message(value: dict[str, Any]) -> None:
    # JSON-lines is the MCP stdio transport framing used by Codex's local plugin host.
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def handle_request(request: dict[str, Any]) -> dict[str, Any] | None:
    method = request.get("method")
    request_id = request.get("id")
    params = request.get("params") or {}
    if method == "notifications/initialized":
        return None
    if method == "initialize":
        requested = params.get("protocolVersion") if isinstance(params, dict) else None
        version = requested if isinstance(requested, str) and requested else PROTOCOL_VERSION
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
        }
    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": input_schema()}}
    if method == "tools/call":
        if not isinstance(params, dict):
            result = tool_result({"ok": False, "error": "tools/call 参数无效。"}, is_error=True)
        else:
            result = call_tool(str(params.get("name", "")), params.get("arguments"))
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    if request_id is None:
        return None
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


def main() -> int:
    while True:
        try:
            request = read_message()
        except PlannerError as error:
            print(f"Invalid MCP request: {error}", file=sys.stderr, flush=True)
            continue
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            print(f"Invalid MCP JSON: {error}", file=sys.stderr, flush=True)
            continue
        if request is None:
            return 0
        response = handle_request(request)
        if response is not None:
            write_message(response)


if __name__ == "__main__":
    raise SystemExit(main())
