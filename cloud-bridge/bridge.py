#!/usr/bin/env python3
"""Small, stdlib-only HTTP bridge between a local workbench and ComfyUI.

The bridge deliberately accepts only preset workflow IDs.  A caller can fill
declared inputs and upload declared assets, but it cannot submit an arbitrary
ComfyUI node graph or make the server fetch arbitrary URLs.
"""

from __future__ import annotations

import copy
import hashlib
import hmac
import ipaddress
import json
import logging
import mimetypes
import os
import re
import secrets
import shutil
import socket
import stat
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


ROOT_DIR = Path(__file__).resolve().parent
LOGGER = logging.getLogger("comfy-bridge")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$")
MAX_JSON_BYTES = 1_048_576
MAX_COMFY_JSON_BYTES = 2 * 1_048_576
MAX_OUTPUT_FILES = 32
MAX_ERROR_MESSAGE_CHARS = 1_000
PRIVATE_DIRECTORY_MODE = 0o700
PRIVATE_FILE_MODE = 0o600
IMAGE_OUTPUT_EXTENSIONS = {".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"}
VIDEO_OUTPUT_EXTENSIONS = {".mkv", ".mov", ".mp4", ".webm"}
MAX_MODEL_PRESET_IDS = 32
MAX_MODEL_REQUIREMENTS = 16


class ApiError(Exception):
    """An intentional client-facing error."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class ComfyApiError(RuntimeError):
    """A failed request to the local ComfyUI instance."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def json_clone(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def ensure_private_directory(path: Path) -> None:
    """Create a bridge-owned directory without relying on the process umask."""

    path.mkdir(parents=True, exist_ok=True, mode=PRIVATE_DIRECTORY_MODE)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise ValueError(f"Bridge data path must be a real directory: {path}")
    os.chmod(path, PRIVATE_DIRECTORY_MODE)


def open_private_new_file(path: Path):
    """Open a new bridge data file with a strict permission mode."""

    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, PRIVATE_FILE_MODE)
    return os.fdopen(descriptor, "wb")


def bounded_error(value: Any) -> str:
    text = str(value).strip() or "Bridge operation failed."
    return text[:MAX_ERROR_MESSAGE_CHARS]


def atomic_write_json(path: Path, value: Any) -> None:
    ensure_private_directory(path.parent)
    temporary_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open_private_new_file(temporary_path) as binary_handle:
            with open(binary_handle.fileno(), "w", encoding="utf-8", closefd=False) as handle:
                json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        os.chmod(path, PRIVATE_FILE_MODE)
    finally:
        temporary_path.unlink(missing_ok=True)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def parse_positive_int(name: str, raw_value: str, minimum: int, maximum: int) -> int:
    try:
        value = int(raw_value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def validate_comfyui_url(raw_url: str) -> str:
    """Allow only loopback ComfyUI URLs, including a loopback-only localhost."""

    parsed = urlsplit(raw_url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("COMFYUI_URL must use http or https")
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("COMFYUI_URL must be a plain loopback base URL")

    host = parsed.hostname.lower()
    if host not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("COMFYUI_URL must point to localhost, 127.0.0.1, or ::1")

    try:
        addresses = socket.getaddrinfo(host, parsed.port or 80, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise ValueError("COMFYUI_URL hostname cannot be resolved") from error
    for _, _, _, _, address in addresses:
        address_host = address[0].split("%", 1)[0]
        if not ipaddress.ip_address(address_host).is_loopback:
            raise ValueError("COMFYUI_URL hostname must resolve only to loopback addresses")

    path = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def clean_file_name(raw_name: str) -> str:
    if not isinstance(raw_name, str):
        raise ApiError(400, "INVALID_FILE_NAME", "File name must be a string.")
    name = raw_name.strip()
    if not name or len(name) > 180 or "\x00" in name or any(ord(char) < 32 for char in name):
        raise ApiError(400, "INVALID_FILE_NAME", "File name is empty or too long.")
    if "/" in name or "\\" in name or name in {".", ".."}:
        raise ApiError(400, "INVALID_FILE_NAME", "File name must not include a path.")
    return name


def clean_subfolder(raw_value: Any, label: str = "Subfolder") -> str:
    """Validate a ComfyUI relative subfolder before it reaches a file endpoint."""

    if raw_value is None or raw_value == "":
        return ""
    if not isinstance(raw_value, str):
        raise ComfyApiError(f"{label} must be a string")
    value = raw_value.strip()
    if not value or "\\" in value or "\x00" in value or any(ord(char) < 32 for char in value):
        raise ComfyApiError(f"{label} is invalid")
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ComfyApiError(f"{label} is invalid")
    return value


def clean_id(raw_value: Any, label: str) -> str:
    if not isinstance(raw_value, str) or not ID_RE.fullmatch(raw_value):
        raise ApiError(400, "INVALID_ID", f"{label} is invalid.")
    return raw_value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1_048_576)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def guess_content_type(file_name: str, fallback: str = "application/octet-stream") -> str:
    guessed, _ = mimetypes.guess_type(file_name)
    return guessed or fallback


def prefixed_file_name(prefix: str, original_name: str) -> str:
    """Add an internal prefix while retaining a valid public file name."""

    suffix = Path(original_name).suffix
    available = 180 - len(prefix)
    if available < 1:
        raise ValueError("Internal file-name prefix is unexpectedly long")
    if len(original_name) <= available:
        return f"{prefix}{original_name}"
    if len(suffix) >= available:
        return f"{prefix}{original_name[:available]}"
    stem_limit = max(1, available - len(suffix))
    return f"{prefix}{Path(original_name).stem[:stem_limit]}{suffix}"


def output_file_name(index: int, original_name: str) -> str:
    """Prefix outputs for stable ordering without exceeding the public name limit."""

    return prefixed_file_name(f"{index:02d}-", original_name)


def public_upload(upload: dict[str, Any]) -> dict[str, Any]:
    return {
        "uploadId": upload["uploadId"],
        "fileName": upload["fileName"],
        "size": upload["size"],
        "sha256": upload["sha256"],
    }


def public_output(output: dict[str, Any], job_id: str) -> dict[str, Any]:
    encoded_name = quote(output["fileName"], safe="")
    return {
        "fileName": output["fileName"],
        "contentType": output["contentType"],
        "size": output["size"],
        "sha256": output["sha256"],
        "url": f"/jobs/{quote(job_id, safe='')}/outputs/{encoded_name}",
    }


@dataclass(frozen=True)
class Settings:
    comfyui_url: str
    token: str
    bind: str
    port: int
    mode: str
    data_dir: Path
    workflows_dir: Path
    max_upload_bytes: int
    max_output_bytes: int
    request_timeout_seconds: int
    execution_timeout_seconds: int
    poll_seconds: float
    workers: int
    api_workflows_dir: Path | None = None

    @classmethod
    def from_environment(cls) -> "Settings":
        raw_token = os.environ.get("COMFY_BRIDGE_TOKEN", "").strip()
        if (
            len(raw_token) < 24
            or raw_token.lower() in {"change-me", "replace-me", "replace_with_a_long_random_token"}
            or "replace" in raw_token.lower()
        ):
            raise ValueError(
                "COMFY_BRIDGE_TOKEN must be a unique secret with at least 24 characters."
            )

        mode = os.environ.get("COMFY_BRIDGE_MODE", "mock").strip().lower()
        if mode not in {"mock", "live"}:
            raise ValueError("COMFY_BRIDGE_MODE must be mock or live")

        data_dir = Path(os.environ.get("COMFY_BRIDGE_DATA_DIR", ROOT_DIR / "data")).expanduser()
        workflows_dir = Path(
            os.environ.get("COMFY_BRIDGE_WORKFLOWS_DIR", ROOT_DIR / "workflows")
        ).expanduser()
        api_workflows_dir = Path(
            os.environ.get("COMFY_BRIDGE_API_WORKFLOWS_DIR", ROOT_DIR / "api-workflows")
        ).expanduser()
        return cls(
            comfyui_url=validate_comfyui_url(
                os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188")
            ),
            token=raw_token,
            bind=os.environ.get("COMFY_BRIDGE_BIND", "127.0.0.1").strip() or "127.0.0.1",
            port=parse_positive_int(
                "COMFY_BRIDGE_PORT", os.environ.get("COMFY_BRIDGE_PORT", "8787"), 1, 65535
            ),
            mode=mode,
            data_dir=data_dir,
            workflows_dir=workflows_dir,
            max_upload_bytes=parse_positive_int(
                "COMFY_BRIDGE_MAX_UPLOAD_BYTES",
                os.environ.get("COMFY_BRIDGE_MAX_UPLOAD_BYTES", str(64 * 1024 * 1024)),
                1,
                2 * 1024 * 1024 * 1024,
            ),
            max_output_bytes=parse_positive_int(
                "COMFY_BRIDGE_MAX_OUTPUT_BYTES",
                os.environ.get("COMFY_BRIDGE_MAX_OUTPUT_BYTES", str(8 * 1024 * 1024 * 1024)),
                1,
                32 * 1024 * 1024 * 1024,
            ),
            request_timeout_seconds=parse_positive_int(
                "COMFY_BRIDGE_REQUEST_TIMEOUT_SECONDS",
                os.environ.get("COMFY_BRIDGE_REQUEST_TIMEOUT_SECONDS", "30"),
                1,
                600,
            ),
            execution_timeout_seconds=parse_positive_int(
                "COMFY_BRIDGE_EXECUTION_TIMEOUT_SECONDS",
                os.environ.get("COMFY_BRIDGE_EXECUTION_TIMEOUT_SECONDS", "7200"),
                10,
                86_400,
            ),
            poll_seconds=float(os.environ.get("COMFY_BRIDGE_POLL_SECONDS", "2")),
            workers=parse_positive_int(
                "COMFY_BRIDGE_WORKERS", os.environ.get("COMFY_BRIDGE_WORKERS", "1"), 1, 8
            ),
            api_workflows_dir=api_workflows_dir,
        )


def clean_api_workflow_file_name(raw_name: Any) -> str:
    """Accept one user-maintained raw API export file, never a path."""

    if not isinstance(raw_name, str):
        raise ValueError("comfyPromptFile must be a file name")
    name = raw_name.strip()
    if "/" in name or "\\" in name or "\x00" in name or name in {".", ".."}:
        raise ValueError("comfyPromptFile must not include a path")
    if not name or not name.endswith(".json") or name.startswith("."):
        raise ValueError("comfyPromptFile must name a .json file")
    return name


def load_api_workflow_prompt(api_workflows_dir: Path, raw_name: Any) -> dict[str, Any]:
    """Load an exact ComfyUI API export without changing its graph."""

    name = clean_api_workflow_file_name(raw_name)
    try:
        directory_info = api_workflows_dir.lstat()
    except OSError as error:
        raise ValueError(f"API workflow directory does not exist: {api_workflows_dir}") from error
    if not stat.S_ISDIR(directory_info.st_mode) or stat.S_ISLNK(directory_info.st_mode):
        raise ValueError(f"API workflow directory must be a real directory: {api_workflows_dir}")

    path = api_workflows_dir / name
    try:
        info = path.lstat()
    except OSError as error:
        raise ValueError(f"ComfyUI API workflow export does not exist: {name}") from error
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise ValueError(f"ComfyUI API workflow export must be a real file: {name}")
    if info.st_size > MAX_COMFY_JSON_BYTES:
        raise ValueError(f"ComfyUI API workflow export is too large: {name}")

    try:
        prompt = read_json(path)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Cannot load ComfyUI API workflow export {name}: {error}") from error
    if not isinstance(prompt, dict):
        raise ValueError(f"ComfyUI API workflow export must be a JSON object: {name}")
    return prompt


def hydrate_workflow_prompt(
    workflow: dict[str, Any], workflow_path: Path, api_workflows_dir: Path
) -> dict[str, Any]:
    """Attach a raw API export to its small, Bridge-owned contract file."""

    has_inline_prompt = "comfyPrompt" in workflow
    has_external_prompt = "comfyPromptFile" in workflow
    if has_inline_prompt and has_external_prompt:
        raise ValueError(
            f"Workflow {workflow_path.name} must use either comfyPrompt or comfyPromptFile, not both"
        )
    if not has_external_prompt:
        return workflow

    hydrated = dict(workflow)
    hydrated["comfyPrompt"] = load_api_workflow_prompt(
        api_workflows_dir, workflow["comfyPromptFile"]
    )
    return hydrated


def load_workflows(
    workflows_dir: Path, api_workflows_dir: Path | None = None
) -> dict[str, dict[str, Any]]:
    if not workflows_dir.is_dir():
        raise ValueError(f"Workflow directory does not exist: {workflows_dir}")
    raw_api_dir = api_workflows_dir or workflows_dir.parent / "api-workflows"

    workflows: dict[str, dict[str, Any]] = {}
    for workflow_path in sorted(workflows_dir.glob("*.json")):
        try:
            workflow = read_json(workflow_path)
            if not isinstance(workflow, dict):
                raise ValueError(f"Workflow {workflow_path.name} must be a JSON object")
            workflow = hydrate_workflow_prompt(workflow, workflow_path, raw_api_dir)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError(f"Cannot load workflow {workflow_path.name}: {error}") from error
        validate_workflow(workflow, workflow_path.name)
        workflow_id = workflow["id"]
        if workflow_id in workflows:
            raise ValueError(f"Duplicate workflow id: {workflow_id}")
        workflows[workflow_id] = workflow

    if not workflows:
        raise ValueError(f"No workflow JSON files found in {workflows_dir}")
    return workflows


def mapping_targets(mapping: dict[str, Any]) -> list[tuple[str, str]]:
    """Return the primary mapping destination plus any fan-out destinations.

    ``nodeId``/``field`` is retained for backwards compatibility.  A mapping
    may additionally declare ``targets`` when one caller-controlled value must
    be written to more than one ComfyUI input.  Some hand-authored contracts
    repeat the primary destination in ``targets``; de-duplicate that harmless
    repetition while still rejecting other duplicates during validation.
    """

    destinations = [(str(mapping.get("nodeId", "")), mapping.get("field"))]
    raw_targets = mapping.get("targets")
    if raw_targets is None:
        return [(node_id, field) for node_id, field in destinations]
    if not isinstance(raw_targets, list):
        return [(node_id, field) for node_id, field in destinations]
    for target in raw_targets:
        if not isinstance(target, dict):
            # Keep the malformed item in the result so validation can report a
            # useful contract error instead of silently ignoring it.
            destinations.append(("", None))
            continue
        destination = (str(target.get("nodeId", "")), target.get("field"))
        destinations.append(destination)
    return [(node_id, field) for node_id, field in destinations]


def validate_workflow(workflow: Any, source_name: str) -> None:
    if not isinstance(workflow, dict):
        raise ValueError(f"Workflow {source_name} must be a JSON object")
    workflow_id = workflow.get("id")
    if not isinstance(workflow_id, str) or not ID_RE.fullmatch(workflow_id):
        raise ValueError(f"Workflow {source_name} has an invalid id")
    for key in ("name", "kind", "description"):
        if not isinstance(workflow.get(key), str) or not workflow[key].strip():
            raise ValueError(f"Workflow {workflow_id} requires a non-empty {key}")
    if workflow["kind"] not in {"image", "video"}:
        raise ValueError(f"Workflow {workflow_id} kind must be image or video")
    if not isinstance(workflow.get("comfyPrompt"), dict):
        raise ValueError(f"Workflow {workflow_id} requires a comfyPrompt object")

    output_node_ids = workflow.get("outputNodeIds")
    if not isinstance(output_node_ids, list) or not output_node_ids:
        raise ValueError(f"Workflow {workflow_id} requires a non-empty outputNodeIds list")
    if len(output_node_ids) > 32:
        raise ValueError(f"Workflow {workflow_id} has too many output nodes")
    normalized_output_nodes: set[str] = set()
    for raw_node_id in output_node_ids:
        node_id = str(raw_node_id)
        if not node_id or node_id not in workflow["comfyPrompt"]:
            raise ValueError(f"Workflow {workflow_id} outputNodeIds must target an existing node")
        node = workflow["comfyPrompt"][node_id]
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            raise ValueError(f"Workflow {workflow_id} outputNodeIds must target a valid ComfyUI node")
        normalized_output_nodes.add(node_id)
    if len(normalized_output_nodes) != len(output_node_ids):
        raise ValueError(f"Workflow {workflow_id} outputNodeIds cannot contain duplicates")

    input_mappings = workflow.get("inputMappings", {})
    upload_mappings = workflow.get("uploadMappings", {})
    if not isinstance(input_mappings, dict) or not isinstance(upload_mappings, dict):
        raise ValueError(f"Workflow {workflow_id} mappings must be objects")
    # Keep a global destination index so two independent mappings cannot race
    # to overwrite the same ComfyUI input.  An optional upload with
    # ``fallbackRole`` is the one intentional exception: it is an override of
    # that fallback role when both images are supplied.
    destination_index: dict[tuple[str, str], tuple[str, str, dict[str, Any]]] = {}
    for mapping_kind, mappings in (("input", input_mappings), ("upload", upload_mappings)):
        for name, mapping in mappings.items():
            if not isinstance(name, str) or not ID_RE.fullmatch(name) or not isinstance(mapping, dict):
                raise ValueError(f"Workflow {workflow_id} has an invalid {mapping_kind} mapping")
            node_id = str(mapping.get("nodeId", ""))
            field = mapping.get("field")
            if node_id not in workflow["comfyPrompt"] or not isinstance(field, str) or not field:
                raise ValueError(
                    f"Workflow {workflow_id} mapping {name} must target an existing node and field"
                )
            node = workflow["comfyPrompt"][node_id]
            if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
                raise ValueError(f"Workflow {workflow_id} node {node_id} is malformed")
            if field not in node["inputs"]:
                raise ValueError(
                    f"Workflow {workflow_id} mapping {name} targets a missing input field"
                )
            raw_targets = mapping.get("targets")
            if raw_targets is not None and (
                not isinstance(raw_targets, list) or not raw_targets
            ):
                raise ValueError(
                    f"Workflow {workflow_id} {mapping_kind} mapping {name} targets must be a non-empty list"
                )
            destinations: list[tuple[str, str]] = []
            for target_index, (target_node_id, target_field) in enumerate(mapping_targets(mapping)):
                if not isinstance(target_field, str) or not target_field:
                    raise ValueError(
                        f"Workflow {workflow_id} mapping {name} target {target_index} must include a field"
                    )
                if target_node_id not in workflow["comfyPrompt"]:
                    raise ValueError(
                        f"Workflow {workflow_id} mapping {name} target {target_index} must target an existing node"
                    )
                target_node = workflow["comfyPrompt"][target_node_id]
                if not isinstance(target_node, dict) or not isinstance(target_node.get("inputs"), dict):
                    raise ValueError(f"Workflow {workflow_id} node {target_node_id} is malformed")
                if target_field not in target_node["inputs"]:
                    raise ValueError(
                        f"Workflow {workflow_id} mapping {name} target {target_index} targets a missing input field"
                    )
                destination = (target_node_id, target_field)
                if destination in destinations:
                    # Repeating the primary target in ``targets`` is accepted
                    # for ergonomic full-list declarations.  Other repeats are
                    # ambiguous and should be fixed in the contract.
                    continue
                destinations.append(destination)
                previous = destination_index.get(destination)
                if previous is not None:
                    previous_kind, previous_name, previous_mapping = previous
                    fallback_override = (
                        mapping_kind == "upload"
                        and previous_kind == "upload"
                        and (
                            mapping.get("fallbackRole") == previous_name
                            or previous_mapping.get("fallbackRole") == name
                        )
                    )
                    if not fallback_override:
                        raise ValueError(
                            f"Workflow {workflow_id} mappings {previous_name} and {name} target the same input"
                        )
                else:
                    destination_index[destination] = (mapping_kind, name, mapping)
            if mapping_kind == "input" and mapping.get("type", "string") not in {
                "string",
                "integer",
                "number",
                "boolean",
                "enum",
            }:
                raise ValueError(f"Workflow {workflow_id} input {name} has an unsupported type")
            if mapping_kind == "input" and mapping.get("type") == "enum":
                choices = mapping.get("choices")
                if not isinstance(choices, list) or not choices:
                    raise ValueError(f"Workflow {workflow_id} enum input {name} requires choices")
            if mapping_kind == "upload":
                accepted = mapping.get("acceptedExtensions", [])
                if not isinstance(accepted, list) or not all(
                    isinstance(item, str) and item.startswith(".") for item in accepted
                ):
                    raise ValueError(
                        f"Workflow {workflow_id} upload {name} has invalid acceptedExtensions"
                    )
                fallback_role = mapping.get("fallbackRole")
                if fallback_role is not None and (
                    not isinstance(fallback_role, str)
                    or not ID_RE.fullmatch(fallback_role)
                    or fallback_role == name
                    or fallback_role not in upload_mappings
                ):
                    raise ValueError(
                        f"Workflow {workflow_id} upload {name} has an invalid fallbackRole"
                    )

    # Fallback chains are intentionally tiny and acyclic.  Rejecting a cycle
    # at startup prevents an optional upload from silently leaving a placeholder
    # filename in the submitted ComfyUI prompt.
    for role, mapping in upload_mappings.items():
        visited: set[str] = set()
        current = role
        while True:
            if current in visited:
                raise ValueError(f"Workflow {workflow_id} upload fallbackRole cannot contain a cycle")
            visited.add(current)
            fallback = upload_mappings.get(current, {}).get("fallbackRole")
            if not fallback:
                break
            current = str(fallback)

    model = workflow.get("model")
    if model is None:
        return
    if not isinstance(model, dict):
        raise ValueError(f"Workflow {workflow_id} model must be an object")
    model_id = model.get("id")
    label = model.get("label")
    if not isinstance(model_id, str) or not ID_RE.fullmatch(model_id):
        raise ValueError(f"Workflow {workflow_id} model requires a valid id")
    if not isinstance(label, str) or not label.strip() or len(label) > 120:
        raise ValueError(f"Workflow {workflow_id} model requires a valid label")
    preset_ids = model.get("presetIds")
    if not isinstance(preset_ids, list) or not preset_ids or len(preset_ids) > MAX_MODEL_PRESET_IDS:
        raise ValueError(f"Workflow {workflow_id} model requires presetIds")
    if len(set(preset_ids)) != len(preset_ids) or not all(
        isinstance(item, str) and ID_RE.fullmatch(item) for item in preset_ids
    ):
        raise ValueError(f"Workflow {workflow_id} model presetIds are invalid")
    requirements = model.get("requirements", [])
    if not isinstance(requirements, list) or len(requirements) > MAX_MODEL_REQUIREMENTS:
        raise ValueError(f"Workflow {workflow_id} model requirements are invalid")
    for requirement in requirements:
        if not isinstance(requirement, dict):
            raise ValueError(f"Workflow {workflow_id} model requirements are invalid")
        node_id = str(requirement.get("nodeId", ""))
        field = requirement.get("field")
        if node_id not in workflow["comfyPrompt"] or not isinstance(field, str) or not field:
            raise ValueError(f"Workflow {workflow_id} model requirement targets are invalid")
        node = workflow["comfyPrompt"][node_id]
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            raise ValueError(f"Workflow {workflow_id} model requirement node is invalid")
        if field not in node["inputs"] or not isinstance(node["inputs"][field], str):
            raise ValueError(f"Workflow {workflow_id} model requirement must target a static model name")


def public_workflow(workflow: dict[str, Any]) -> dict[str, Any]:
    """Expose only the caller contract, never the full Comfy node graph."""

    return {
        "id": workflow["id"],
        "name": workflow["name"],
        "kind": workflow["kind"],
        "description": workflow["description"],
        "enabled": bool(workflow.get("enabled", True)),
        "inputMappings": workflow.get("inputMappings", {}),
        "uploadMappings": workflow.get("uploadMappings", {}),
    }


def public_model(workflow: dict[str, Any], available: bool, reason: str | None = None) -> dict[str, Any]:
    """Expose an executable model variant without leaking raw graph details."""

    model = workflow["model"]
    return {
        "id": model["id"],
        "label": model["label"],
        "workflowId": workflow["id"],
        "presetIds": model["presetIds"],
        "available": available,
        **({"reason": reason} if reason else {}),
    }


class JobStore:
    """A tiny JSON-backed store so completed jobs survive a process restart."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.jobs_dir = data_dir / "jobs"
        self.uploads_dir = data_dir / "uploads"
        self.outputs_dir = data_dir / "outputs"
        self._lock = threading.RLock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._client_job_ids: dict[str, str] = {}
        self._uploads: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        for directory in (self.data_dir, self.jobs_dir, self.uploads_dir, self.outputs_dir):
            ensure_private_directory(directory)

        for path in self.uploads_dir.glob("*.json"):
            try:
                upload = read_json(path)
                if isinstance(upload, dict) and isinstance(upload.get("uploadId"), str):
                    stored = self.uploads_dir / upload.get("storedFile", "")
                    if stored.is_file():
                        self._uploads[upload["uploadId"]] = upload
            except (OSError, json.JSONDecodeError):
                LOGGER.warning("Ignoring malformed upload record: %s", path.name)

        for path in self.jobs_dir.glob("*.json"):
            try:
                job = read_json(path)
                if isinstance(job, dict) and isinstance(job.get("id"), str):
                    if job.get("status") in {"queued", "uploading", "running", "downloading"}:
                        job["status"] = "interrupted"
                        job["progress"] = {
                            "phase": "interrupted",
                            "value": 0,
                            "message": "Bridge restarted before this job completed.",
                        }
                        job["updatedAt"] = utc_now()
                        atomic_write_json(path, job)
                    self._jobs[job["id"]] = job
                    client_job_id = job.get("clientJobId")
                    if isinstance(client_job_id, str) and client_job_id:
                        # Existing bridge data may predate the idempotency index. Keep the
                        # oldest persisted record as the canonical response if it has duplicates.
                        existing_id = self._client_job_ids.get(client_job_id)
                        if existing_id is None:
                            self._client_job_ids[client_job_id] = job["id"]
                        else:
                            existing = self._jobs[existing_id]
                            if (str(job.get("createdAt", "")), job["id"]) < (
                                str(existing.get("createdAt", "")),
                                existing_id,
                            ):
                                self._client_job_ids[client_job_id] = job["id"]
                            LOGGER.warning(
                                "Duplicate persisted clientJobId %s; retaining one canonical job.",
                                client_job_id,
                            )
            except (OSError, json.JSONDecodeError):
                LOGGER.warning("Ignoring malformed job record: %s", path.name)

    def _job_path(self, job_id: str) -> Path:
        return self.jobs_dir / f"{job_id}.json"

    def _upload_path(self, upload_id: str) -> Path:
        return self.uploads_dir / f"{upload_id}.json"

    def create_upload(self, file_name: str, content_type: str, body: Iterable[bytes]) -> dict[str, Any]:
        upload_id = new_id("upload")
        stored_file = f"{upload_id}--{file_name}"
        final_path = self.uploads_dir / stored_file
        temporary_path = self.uploads_dir / f".{stored_file}.{uuid.uuid4().hex}.part"
        digest = hashlib.sha256()
        size = 0
        try:
            with open_private_new_file(temporary_path) as handle:
                for chunk in body:
                    handle.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, final_path)
            os.chmod(final_path, PRIVATE_FILE_MODE)
        except BaseException:
            temporary_path.unlink(missing_ok=True)
            raise

        upload = {
            "uploadId": upload_id,
            "fileName": file_name,
            "size": size,
            "sha256": digest.hexdigest(),
            "contentType": content_type,
            "storedFile": stored_file,
            "createdAt": utc_now(),
        }
        with self._lock:
            self._uploads[upload_id] = upload
            atomic_write_json(self._upload_path(upload_id), upload)
        return json_clone(upload)

    def get_upload(self, upload_id: str) -> dict[str, Any] | None:
        with self._lock:
            upload = self._uploads.get(upload_id)
            return json_clone(upload) if upload else None

    def upload_file(self, upload: dict[str, Any]) -> Path:
        return self.uploads_dir / upload["storedFile"]

    def find_client_job(self, client_job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job_id = self._client_job_ids.get(client_job_id)
            job = self._jobs.get(job_id) if job_id else None
            if job is not None:
                return json_clone(job)
        return None

    def create_job(self, job: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if job["id"] in self._jobs:
                raise ValueError(f"Bridge job id already exists: {job['id']}")
            atomic_write_json(self._job_path(job["id"]), job)
            self._jobs[job["id"]] = json_clone(job)
            client_job_id = job.get("clientJobId")
            if isinstance(client_job_id, str) and client_job_id:
                self._client_job_ids[client_job_id] = job["id"]
        return json_clone(job)

    def create_or_get_client_job(self, job: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Atomically reserve a caller id before a worker can be scheduled.

        ThreadingHTTPServer serves concurrent POSTs. Looking up a clientJobId and
        creating its record under separate locks used to let duplicate prompts race
        through. The first accepted request now wins; later requests receive that
        record without scheduling another ComfyUI execution.
        """

        client_job_id = job.get("clientJobId")
        if not isinstance(client_job_id, str) or not client_job_id:
            return self.create_job(job), False
        with self._lock:
            existing_id = self._client_job_ids.get(client_job_id)
            if existing_id:
                existing = self._jobs.get(existing_id)
                if existing is not None:
                    return json_clone(existing), True
                # A stale in-memory index must never make a retry disappear.
                self._client_job_ids.pop(client_job_id, None)
            if job["id"] in self._jobs:
                raise ValueError(f"Bridge job id already exists: {job['id']}")
            atomic_write_json(self._job_path(job["id"]), job)
            self._jobs[job["id"]] = json_clone(job)
            self._client_job_ids[client_job_id] = job["id"]
            return json_clone(job), False

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return json_clone(job) if job else None

    def update_job(self, job_id: str, **changes: Any) -> dict[str, Any]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            job.update(json_clone(changes))
            job["updatedAt"] = utc_now()
            atomic_write_json(self._job_path(job_id), job)
            return json_clone(job)

    def output_path(self, job_id: str, stored_file: str, *, create_directory: bool = False) -> Path:
        safe_job_id = clean_id(job_id, "job id")
        safe_file_name = clean_file_name(stored_file)
        directory = self.outputs_dir / safe_job_id
        if create_directory:
            ensure_private_directory(directory)
        return directory / safe_file_name


class NoRedirect(HTTPRedirectHandler):
    """A redirect from a loopback server must not turn into an SSRF path."""

    def redirect_request(self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


class ComfyClient:
    def __init__(self, settings: Settings) -> None:
        self.base_url = settings.comfyui_url.rstrip("/")
        self.timeout = settings.request_timeout_seconds
        self.max_output_bytes = settings.max_output_bytes
        # Ignore proxy environment variables: ComfyUI is allowed only on loopback.
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def _request(
        self,
        method: str,
        endpoint: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[bytes, dict[str, str]]:
        request_headers = {"Accept": "application/json"}
        request_headers.update(headers or {})
        request = Request(
            f"{self.base_url}{endpoint}", data=body, headers=request_headers, method=method
        )
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw_length = response.headers.get("Content-Length")
                if raw_length is not None:
                    try:
                        if int(raw_length) > MAX_COMFY_JSON_BYTES:
                            raise ComfyApiError("ComfyUI JSON response exceeds the bridge limit")
                    except ValueError as error:
                        raise ComfyApiError("ComfyUI returned an invalid Content-Length") from error
                body_bytes = response.read(MAX_COMFY_JSON_BYTES + 1)
                if len(body_bytes) > MAX_COMFY_JSON_BYTES:
                    raise ComfyApiError("ComfyUI JSON response exceeds the bridge limit")
                return body_bytes, dict(response.headers.items())
        except HTTPError as error:
            detail = error.read(1024).decode("utf-8", "replace").strip()
            message = f"ComfyUI returned HTTP {error.code}"
            if detail:
                message = f"{message}: {detail[:500]}"
            raise ComfyApiError(message) from error
        except URLError as error:
            raise ComfyApiError(f"Cannot reach local ComfyUI: {error.reason}") from error

    def request_json(
        self,
        method: str,
        endpoint: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = None
        headers: dict[str, str] = {}
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        raw_body, _ = self._request(method, endpoint, body, headers)
        try:
            decoded = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ComfyApiError("ComfyUI returned malformed JSON") from error
        if not isinstance(decoded, dict):
            raise ComfyApiError("ComfyUI returned an unexpected JSON value")
        return decoded

    def health(self) -> bool:
        try:
            self.request_json("GET", "/system_stats")
            return True
        except ComfyApiError:
            return False

    def input_choices(self, node_class: str, field: str) -> set[str]:
        """Read one loader's current choices without exposing ComfyUI to clients."""

        definition = self.request_json("GET", f"/object_info/{quote(node_class, safe='')}")
        node = definition.get(node_class)
        if not isinstance(node, dict):
            raise ComfyApiError(f"ComfyUI did not describe node {node_class}")
        inputs = node.get("input")
        required = inputs.get("required") if isinstance(inputs, dict) else None
        descriptor = required.get(field) if isinstance(required, dict) else None
        choices = descriptor[0] if isinstance(descriptor, list) and descriptor else None
        if not isinstance(choices, list):
            raise ComfyApiError(f"ComfyUI did not describe choices for {node_class}.{field}")
        return {item for item in choices if isinstance(item, str)}

    def upload_image(self, file_path: Path, remote_name: str, subfolder: str) -> str:
        boundary = f"----ComfyBridge{secrets.token_hex(16)}"
        content_type = guess_content_type(file_path.name)
        with file_path.open("rb") as handle:
            file_bytes = handle.read()

        def field(name: str, value: str) -> bytes:
            return (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                f"{value}\r\n"
            ).encode("utf-8")

        body = bytearray()
        body.extend(field("subfolder", subfolder))
        body.extend(field("overwrite", "true"))
        body.extend(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="image"; filename="{remote_name}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode("utf-8")
        )
        body.extend(file_bytes)
        body.extend(f"\r\n--{boundary}--\r\n".encode("utf-8"))
        raw_body, _ = self._request(
            "POST",
            "/upload/image",
            bytes(body),
            {"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        try:
            response = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ComfyApiError("ComfyUI returned malformed upload JSON") from error
        if not isinstance(response, dict) or not isinstance(response.get("name"), str):
            raise ComfyApiError("ComfyUI upload response did not include a file name")
        name = clean_file_name(response["name"])
        returned_subfolder = clean_subfolder(
            response.get("subfolder", ""), "ComfyUI upload response subfolder"
        )
        if returned_subfolder:
            return f"{returned_subfolder}/{name}"
        return name

    def submit_prompt(self, prompt: dict[str, Any], client_id: str) -> str:
        response = self.request_json("POST", "/prompt", {"prompt": prompt, "client_id": client_id})
        prompt_id = response.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id:
            node_errors = response.get("node_errors")
            if node_errors:
                raise ComfyApiError(f"ComfyUI rejected the workflow: {str(node_errors)[:500]}")
            raise ComfyApiError("ComfyUI did not return prompt_id")
        return prompt_id

    def history(self, prompt_id: str) -> dict[str, Any] | None:
        history = self.request_json("GET", f"/history/{quote(prompt_id, safe='')}")
        entry = history.get(prompt_id)
        return entry if isinstance(entry, dict) else None

    def download_output(self, remote: dict[str, str], destination: Path) -> tuple[int, str]:
        filename = clean_file_name(remote["filename"])
        subfolder = clean_subfolder(remote.get("subfolder", ""), "ComfyUI output subfolder")
        file_type = remote.get("type", "output")
        if file_type != "output":
            raise ComfyApiError("Bridge refuses non-output files returned by ComfyUI")

        query = f"filename={quote(filename, safe='')}&subfolder={quote(subfolder, safe='/')}&type=output"
        request = Request(f"{self.base_url}/view?{query}", headers={"Accept": "*/*"}, method="GET")
        temporary_path = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.part")
        ensure_private_directory(destination.parent)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                content_length = response.headers.get("Content-Length")
                if content_length:
                    try:
                        if int(content_length) > self.max_output_bytes:
                            raise ComfyApiError("ComfyUI output exceeds COMFY_BRIDGE_MAX_OUTPUT_BYTES")
                    except ValueError as error:
                        raise ComfyApiError("ComfyUI returned an invalid output Content-Length") from error
                size = 0
                with open_private_new_file(temporary_path) as handle:
                    while True:
                        chunk = response.read(1_048_576)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > self.max_output_bytes:
                            raise ComfyApiError("ComfyUI output exceeds COMFY_BRIDGE_MAX_OUTPUT_BYTES")
                        handle.write(chunk)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary_path, destination)
                os.chmod(destination, PRIVATE_FILE_MODE)
                content_type = response.headers.get_content_type() or guess_content_type(filename)
                return size, content_type
        except HTTPError as error:
            raise ComfyApiError(f"Could not download ComfyUI output (HTTP {error.code})") from error
        except URLError as error:
            raise ComfyApiError(f"Could not download ComfyUI output: {error.reason}") from error
        finally:
            temporary_path.unlink(missing_ok=True)


def validate_input_value(name: str, mapping: dict[str, Any], value: Any) -> Any:
    value_type = mapping.get("type", "string")
    if value_type == "string":
        if not isinstance(value, str):
            raise ApiError(400, "INVALID_INPUT", f"Input {name} must be a string.")
        maximum = mapping.get("maxLength", 8_000)
        if len(value) > maximum:
            raise ApiError(400, "INVALID_INPUT", f"Input {name} is too long.")
        return value
    if value_type == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ApiError(400, "INVALID_INPUT", f"Input {name} must be an integer.")
    elif value_type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ApiError(400, "INVALID_INPUT", f"Input {name} must be a number.")
    elif value_type == "boolean":
        if not isinstance(value, bool):
            raise ApiError(400, "INVALID_INPUT", f"Input {name} must be a boolean.")
    elif value_type == "enum":
        choices = mapping.get("choices", [])
        if value not in choices:
            raise ApiError(400, "INVALID_INPUT", f"Input {name} is not an allowed value.")
    else:  # validate_workflow prevents this for file-backed workflows.
        raise ApiError(500, "INVALID_WORKFLOW", f"Workflow input {name} has an unsupported type.")

    minimum = mapping.get("min")
    maximum = mapping.get("max")
    if minimum is not None and value < minimum:
        raise ApiError(400, "INVALID_INPUT", f"Input {name} is below its minimum.")
    if maximum is not None and value > maximum:
        raise ApiError(400, "INVALID_INPUT", f"Input {name} is above its maximum.")
    return value


def comfy_history_error(history_entry: dict[str, Any]) -> str | None:
    """Extract the actionable node error from a ComfyUI history response."""

    status = history_entry.get("status", {})
    if not isinstance(status, dict) or status.get("status_str") not in {"error", "failed"}:
        return None

    messages = status.get("messages", [])
    if isinstance(messages, list):
        for item in reversed(messages):
            if (
                not isinstance(item, list)
                or len(item) != 2
                or item[0] != "execution_error"
                or not isinstance(item[1], dict)
            ):
                continue
            detail = item[1]
            node_id = str(detail.get("node_id", "")).strip()
            node_type = str(detail.get("node_type", "")).strip()
            exception_type = str(detail.get("exception_type", "")).strip()
            exception_message = str(detail.get("exception_message", "")).strip()

            node = ""
            if node_id and node_type:
                node = f" node {node_id} ({node_type})"
            elif node_id:
                node = f" node {node_id}"
            elif node_type:
                node = f" node {node_type}"

            exception = ": ".join(part for part in (exception_type, exception_message) if part)
            suffix = f": {exception}" if exception else ""
            return bounded_error(f"ComfyUI{node} execution failed{suffix}")

    return "ComfyUI marked this workflow as failed"


def collect_comfy_outputs(
    history_entry: dict[str, Any], output_node_ids: list[Any], output_kind: str
) -> list[dict[str, str]]:
    """Return only declared final-output nodes with the workflow's media kind."""

    failure = comfy_history_error(history_entry)
    if failure:
        raise ComfyApiError(failure)

    outputs = history_entry.get("outputs")
    if not isinstance(outputs, dict):
        return []
    allowed_extensions = (
        IMAGE_OUTPUT_EXTENSIONS if output_kind == "image" else VIDEO_OUTPUT_EXTENSIONS
    )
    # ComfyUI's video preview implementations are not consistent across
    # versions.  SaveVideo commonly exposes files under ``images`` even when
    # the filename is an mp4/mkv, while older nodes use ``gifs`` or ``videos``.
    # Keep the extension allow-list below as the media-kind guard.
    collection_names = (
        ("images", "gifs")
        if output_kind == "image"
        else ("images", "gifs", "videos")
    )
    found: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    # Follow the administrator-declared node order so output prefixes are stable.
    for raw_node_id in output_node_ids:
        node_output = outputs.get(str(raw_node_id))
        if not isinstance(node_output, dict):
            continue
        for collection_name in collection_names:
            collection = node_output.get(collection_name, [])
            if not isinstance(collection, list):
                continue
            for item in collection:
                if not isinstance(item, dict) or not isinstance(item.get("filename"), str):
                    continue
                if str(item.get("type", "output")) != "output":
                    continue
                if Path(item["filename"]).suffix.lower() not in allowed_extensions:
                    continue
                try:
                    filename = clean_file_name(item["filename"])
                except ApiError as error:
                    raise ComfyApiError("ComfyUI returned an unsafe output file name") from error
                subfolder = clean_subfolder(item.get("subfolder", ""), "ComfyUI output subfolder")
                identity = (filename, subfolder, "output")
                if identity in seen:
                    continue
                seen.add(identity)
                found.append(
                    {
                        "filename": filename,
                        "subfolder": subfolder,
                        "type": "output",
                    }
                )
                if len(found) > MAX_OUTPUT_FILES:
                    raise ComfyApiError(
                        f"ComfyUI returned more than {MAX_OUTPUT_FILES} declared output files"
                    )
    return found


class BridgeApp:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        if settings.poll_seconds <= 0 or settings.poll_seconds > 60:
            raise ValueError("COMFY_BRIDGE_POLL_SECONDS must be greater than 0 and at most 60")
        self.workflows = load_workflows(settings.workflows_dir, settings.api_workflows_dir)
        self.store = JobStore(settings.data_dir)
        self.comfy = ComfyClient(settings)
        self.executor = ThreadPoolExecutor(max_workers=settings.workers, thread_name_prefix="comfy-job")

    def close(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=True)

    def health(self) -> dict[str, Any]:
        reachable: bool | None = None
        if self.settings.mode == "live":
            reachable = self.comfy.health()
        return {
            "ok": True,
            "service": "comfy-bridge",
            "mode": self.settings.mode,
            "comfyui": {"configured": True, "loopbackOnly": True, "reachable": reachable},
            "workflowCount": len(self.workflows),
        }

    def list_workflows(self) -> dict[str, Any]:
        return {"workflows": [public_workflow(item) for item in self.workflows.values()]}

    def list_models(self) -> dict[str, Any]:
        """Return only declared model variants whose required files still exist."""

        models: list[dict[str, Any]] = []
        choices_cache: dict[tuple[str, str], set[str]] = {}
        for workflow in self.workflows.values():
            if not workflow.get("enabled", True) or not isinstance(workflow.get("model"), dict):
                continue
            available = True
            reason: str | None = None
            if self.settings.mode == "live":
                try:
                    for requirement in workflow["model"].get("requirements", []):
                        node_id = str(requirement["nodeId"])
                        field = requirement["field"]
                        node = workflow["comfyPrompt"][node_id]
                        node_class = node["class_type"]
                        key = (node_class, field)
                        choices = choices_cache.get(key)
                        if choices is None:
                            choices = self.comfy.input_choices(node_class, field)
                            choices_cache[key] = choices
                        if node["inputs"][field] not in choices:
                            available = False
                            reason = "所需模型组件未安装"
                            break
                except ComfyApiError:
                    available = False
                    reason = "无法读取服务器模型"
            models.append(public_model(workflow, available, reason))
        return {"models": models}

    def receive_upload(
        self, raw_file_name: str, content_type: str, content_length: int, stream: Any
    ) -> dict[str, Any]:
        file_name = clean_file_name(raw_file_name)
        if content_length < 1:
            raise ApiError(400, "EMPTY_UPLOAD", "Upload body must not be empty.")
        if content_length > self.settings.max_upload_bytes:
            raise ApiError(413, "UPLOAD_TOO_LARGE", "Upload exceeds COMFY_BRIDGE_MAX_UPLOAD_BYTES.")

        remaining = content_length

        def chunks() -> Iterable[bytes]:
            nonlocal remaining
            while remaining:
                chunk = stream.read(min(1_048_576, remaining))
                if not chunk:
                    raise ApiError(400, "INCOMPLETE_UPLOAD", "Upload body ended before Content-Length.")
                remaining -= len(chunk)
                yield chunk

        upload = self.store.create_upload(file_name, content_type, chunks())
        return public_upload(upload)

    def _validate_inputs(
        self, workflow: dict[str, Any], raw_inputs: Any
    ) -> dict[str, Any]:
        if not isinstance(raw_inputs, dict):
            raise ApiError(400, "INVALID_INPUTS", "inputs must be an object.")
        mappings = workflow.get("inputMappings", {})
        unknown = sorted(set(raw_inputs) - set(mappings))
        if unknown:
            raise ApiError(400, "UNKNOWN_INPUT", f"Workflow does not accept input: {unknown[0]}.")
        normalized: dict[str, Any] = {}
        for name, mapping in mappings.items():
            if name not in raw_inputs:
                if mapping.get("required", False):
                    raise ApiError(400, "MISSING_INPUT", f"Workflow requires input: {name}.")
                continue
            normalized[name] = validate_input_value(name, mapping, raw_inputs[name])
        return normalized

    def _validate_uploads(
        self, workflow: dict[str, Any], raw_uploads: Any
    ) -> list[dict[str, Any]]:
        if raw_uploads is None:
            raw_uploads = []
        if not isinstance(raw_uploads, list):
            raise ApiError(400, "INVALID_UPLOADS", "uploads must be an array.")
        mappings = workflow.get("uploadMappings", {})
        normalized: list[dict[str, Any]] = []
        used_roles: set[str] = set()
        for item in raw_uploads:
            if not isinstance(item, dict):
                raise ApiError(400, "INVALID_UPLOADS", "Each upload must be an object.")
            upload_id = clean_id(item.get("uploadId"), "uploadId")
            role = clean_id(item.get("role"), "role")
            if role in used_roles:
                raise ApiError(400, "DUPLICATE_UPLOAD_ROLE", f"Upload role is duplicated: {role}.")
            mapping = mappings.get(role)
            if mapping is None:
                raise ApiError(400, "UNKNOWN_UPLOAD_ROLE", f"Workflow does not accept upload role: {role}.")
            upload = self.store.get_upload(upload_id)
            if upload is None or not self.store.upload_file(upload).is_file():
                raise ApiError(404, "UPLOAD_NOT_FOUND", f"Upload was not found: {upload_id}.")
            accepted_extensions = {extension.lower() for extension in mapping.get("acceptedExtensions", [])}
            if accepted_extensions and Path(upload["fileName"]).suffix.lower() not in accepted_extensions:
                raise ApiError(
                    400,
                    "UNSUPPORTED_UPLOAD_TYPE",
                    f"Upload role {role} does not accept {Path(upload['fileName']).suffix or 'this file type'}.",
                )
            used_roles.add(role)
            normalized.append(
                {
                    "role": role,
                    "uploadId": upload_id,
                    "fileName": upload["fileName"],
                    "size": upload["size"],
                    "sha256": upload["sha256"],
                    "storedFile": upload["storedFile"],
                }
            )
        for role, mapping in mappings.items():
            if mapping.get("required", False) and role not in used_roles:
                raise ApiError(400, "MISSING_UPLOAD", f"Workflow requires upload role: {role}.")
        return normalized

    def submit_job(self, body: Any) -> tuple[dict[str, Any], bool]:
        if not isinstance(body, dict):
            raise ApiError(400, "INVALID_JOB", "Job body must be a JSON object.")
        unknown_keys = sorted(set(body) - {"workflowId", "inputs", "uploads", "clientJobId", "dryRun"})
        if unknown_keys:
            raise ApiError(400, "UNKNOWN_JOB_FIELD", f"Job field is not allowed: {unknown_keys[0]}.")
        workflow_id = clean_id(body.get("workflowId"), "workflowId")
        workflow = self.workflows.get(workflow_id)
        if workflow is None:
            raise ApiError(404, "WORKFLOW_NOT_FOUND", f"Workflow was not found: {workflow_id}.")

        client_job_id = body.get("clientJobId")
        if client_job_id is not None:
            if not isinstance(client_job_id, str) or not client_job_id.strip() or len(client_job_id) > 256:
                raise ApiError(400, "INVALID_CLIENT_JOB_ID", "clientJobId is invalid.")
            client_job_id = client_job_id.strip()

        dry_run = body.get("dryRun", False)
        if not isinstance(dry_run, bool):
            raise ApiError(400, "INVALID_DRY_RUN", "dryRun must be a boolean.")
        if not workflow.get("enabled", True) and self.settings.mode != "mock" and not dry_run:
            raise ApiError(
                422,
                "WORKFLOW_DISABLED",
                "This preset is an example. Replace its comfyPrompt and set enabled to true first.",
            )

        inputs = self._validate_inputs(workflow, body.get("inputs", {}))
        uploads = self._validate_uploads(workflow, body.get("uploads", []))
        job_id = new_id("job")
        now = utc_now()
        job = {
            "id": job_id,
            "clientJobId": client_job_id,
            "workflowId": workflow_id,
            "workflowName": workflow["name"],
            "kind": workflow["kind"],
            "status": "queued",
            "progress": {"phase": "queued", "value": 0, "message": "Job accepted by bridge."},
            "createdAt": now,
            "updatedAt": now,
            "inputs": inputs,
            "uploads": uploads,
            "outputs": [],
            "dryRun": dry_run or self.settings.mode == "mock",
            "comfyPromptId": None,
            "error": None,
        }
        stored_job, idempotent = self.store.create_or_get_client_job(job)
        if not idempotent:
            self.executor.submit(self._run_job, job_id, workflow)
        return self.public_job(stored_job), idempotent

    def public_job(self, job: dict[str, Any]) -> dict[str, Any]:
        public = {
            "id": job["id"],
            "clientJobId": job.get("clientJobId"),
            "workflowId": job["workflowId"],
            "workflowName": job["workflowName"],
            "kind": job["kind"],
            "status": job["status"],
            "progress": job["progress"],
            "createdAt": job["createdAt"],
            "updatedAt": job["updatedAt"],
            "dryRun": job.get("dryRun", False),
            "outputs": [public_output(output, job["id"]) for output in job.get("outputs", [])],
            "error": job.get("error"),
        }
        if job.get("comfyPromptId"):
            public["comfyPromptId"] = job["comfyPromptId"]
        return public

    def get_job(self, job_id: str) -> dict[str, Any]:
        job = self.store.get_job(job_id)
        if job is None:
            raise ApiError(404, "JOB_NOT_FOUND", "Job was not found.")
        return self.public_job(job)

    def get_output(self, job_id: str, file_name: str) -> tuple[Path, dict[str, Any]]:
        job = self.store.get_job(job_id)
        if job is None:
            raise ApiError(404, "JOB_NOT_FOUND", "Job was not found.")
        requested_name = clean_file_name(file_name)
        for output in job.get("outputs", []):
            if output["fileName"] == requested_name:
                path = self.store.output_path(job_id, output["storedFile"])
                try:
                    info = path.lstat()
                except FileNotFoundError:
                    continue
                if stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode):
                    return path, output
        raise ApiError(404, "OUTPUT_NOT_FOUND", "Output was not found.")

    def _apply_input_mappings(
        self, workflow: dict[str, Any], inputs: dict[str, Any]
    ) -> dict[str, Any]:
        prompt = copy.deepcopy(workflow["comfyPrompt"])
        for name, value in inputs.items():
            mapping = workflow["inputMappings"][name]
            prompt[str(mapping["nodeId"])]["inputs"][mapping["field"]] = value
        # Apply optional fan-out destinations after the legacy primary field.
        for name, value in inputs.items():
            for node_id, field in mapping_targets(workflow["inputMappings"][name])[1:]:
                prompt[str(node_id)]["inputs"][field] = value
        return prompt

    def _run_mock_job(self, job: dict[str, Any]) -> None:
        self.store.update_job(
            job["id"],
            status="running",
            progress={"phase": "mock", "value": 0.5, "message": "Generating dry-run manifest."},
        )
        output_name = "dry-run.json"
        stored_file = output_name
        output_path = self.store.output_path(job["id"], stored_file, create_directory=True)
        manifest = {
            "mock": True,
            "jobId": job["id"],
            "workflowId": job["workflowId"],
            "inputs": job["inputs"],
            "uploads": [
                {
                    "role": item["role"],
                    "uploadId": item["uploadId"],
                    "fileName": item["fileName"],
                    "sha256": item["sha256"],
                }
                for item in job["uploads"]
            ],
            "message": "Mock mode never contacts ComfyUI and does not create media.",
        }
        atomic_write_json(output_path, manifest)
        output = {
            "fileName": output_name,
            "storedFile": stored_file,
            "contentType": "application/json",
            "size": output_path.stat().st_size,
            "sha256": sha256_file(output_path),
        }
        self.store.update_job(
            job["id"],
            status="completed",
            progress={"phase": "completed", "value": 1, "message": "Mock job completed."},
            outputs=[output],
            error=None,
        )

    def _run_live_job(self, job: dict[str, Any], workflow: dict[str, Any]) -> None:
        self.store.update_job(
            job["id"],
            status="uploading",
            progress={"phase": "uploading", "value": 0.05, "message": "Uploading input assets to ComfyUI."},
        )
        prompt = self._apply_input_mappings(workflow, job["inputs"])
        uploads = job["uploads"]
        remote_files: dict[str, str] = {}
        for index, upload in enumerate(uploads, start=1):
            mapping = workflow["uploadMappings"][upload["role"]]
            local_path = self.store.upload_file(upload)
            remote_name = prefixed_file_name(f"{job['id']}-{index}-", upload["fileName"])
            comfy_name = self.comfy.upload_image(local_path, remote_name, f"bridge/{job['id']}")
            remote_files[upload["role"]] = comfy_name
            prompt[str(mapping["nodeId"])]["inputs"][mapping["field"]] = comfy_name
            self.store.update_job(
                job["id"],
                progress={
                    "phase": "uploading",
                    "value": 0.05 + 0.2 * index / max(len(uploads), 1),
                    "message": f"Uploaded {index} of {len(uploads)} input assets.",
                },
            )

        def resolved_remote_file(role: str, seen: set[str] | None = None) -> str | None:
            value = remote_files.get(role)
            if value:
                return value
            mapping = workflow["uploadMappings"].get(role, {})
            fallback_role = mapping.get("fallbackRole")
            if not fallback_role:
                return None
            visited = set(seen or ())
            if role in visited:
                return None
            visited.add(role)
            return resolved_remote_file(str(fallback_role), visited)

        # Inject uploads in declaration order after all files have been sent.
        # This keeps a dual-reference request deterministic even if the client
        # lists the optional second role before the base role.
        for role, mapping in workflow["uploadMappings"].items():
            comfy_name = resolved_remote_file(role)
            if not comfy_name:
                continue
            for node_id, field in mapping_targets(mapping):
                prompt[str(node_id)]["inputs"][field] = comfy_name

        prompt_id = self.comfy.submit_prompt(prompt, job["id"])
        self.store.update_job(
            job["id"],
            status="running",
            comfyPromptId=prompt_id,
            progress={"phase": "running", "value": 0.3, "message": "ComfyUI is executing the workflow."},
        )

        deadline = time.monotonic() + self.settings.execution_timeout_seconds
        history_entry: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            history_entry = self.comfy.history(prompt_id)
            outputs = (
                collect_comfy_outputs(history_entry, workflow["outputNodeIds"], workflow["kind"])
                if history_entry
                else []
            )
            if outputs:
                break
            self.store.update_job(
                job["id"],
                progress={"phase": "running", "value": 0.55, "message": "ComfyUI is still executing."},
            )
            time.sleep(self.settings.poll_seconds)
        if not history_entry:
            raise ComfyApiError("ComfyUI did not report a completed workflow before timeout")
        remote_outputs = collect_comfy_outputs(
            history_entry, workflow["outputNodeIds"], workflow["kind"]
        )
        if not remote_outputs:
            raise ComfyApiError("ComfyUI finished without returning an output file")

        self.store.update_job(
            job["id"],
            status="downloading",
            progress={"phase": "downloading", "value": 0.75, "message": "Downloading ComfyUI output files."},
        )
        local_outputs: list[dict[str, Any]] = []
        for index, remote in enumerate(remote_outputs, start=1):
            original_name = clean_file_name(remote["filename"])
            stored_file = output_file_name(index, original_name)
            destination = self.store.output_path(job["id"], stored_file, create_directory=True)
            size, content_type = self.comfy.download_output(remote, destination)
            local_outputs.append(
                {
                    "fileName": stored_file,
                    "storedFile": stored_file,
                    "contentType": content_type or guess_content_type(original_name),
                    "size": size,
                    "sha256": sha256_file(destination),
                    "sourceFileName": original_name,
                }
            )
            self.store.update_job(
                job["id"],
                progress={
                    "phase": "downloading",
                    "value": 0.75 + 0.2 * index / len(remote_outputs),
                    "message": f"Downloaded {index} of {len(remote_outputs)} output files.",
                },
            )
        self.store.update_job(
            job["id"],
            status="completed",
            progress={"phase": "completed", "value": 1, "message": "Job completed."},
            outputs=local_outputs,
            error=None,
        )

    def _run_job(self, job_id: str, workflow: dict[str, Any]) -> None:
        job = self.store.get_job(job_id)
        if job is None:
            return
        try:
            if job["dryRun"]:
                self._run_mock_job(job)
            else:
                self._run_live_job(job, workflow)
        except (ApiError, ComfyApiError, OSError, ValueError) as error:
            LOGGER.exception("Job %s failed", job_id)
            self.store.update_job(
                job_id,
                status="failed",
                progress={"phase": "failed", "value": 1, "message": "Job failed."},
                error={"code": "EXECUTION_FAILED", "message": bounded_error(error)},
            )
        except BaseException:
            LOGGER.exception("Job %s failed unexpectedly", job_id)
            self.store.update_job(
                job_id,
                status="failed",
                progress={"phase": "failed", "value": 1, "message": "Job failed unexpectedly."},
                error={"code": "INTERNAL_ERROR", "message": "Unexpected bridge execution error."},
            )


class BridgeRequestHandler(BaseHTTPRequestHandler):
    server_version = "ComfyBridge/0.1"
    protocol_version = "HTTP/1.1"

    @property
    def app(self) -> BridgeApp:
        return self.server.app  # type: ignore[attr-defined]

    def log_message(self, format_string: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.client_address[0], format_string % args)

    def _authorize(self) -> None:
        raw_header = self.headers.get("Authorization", "")
        scheme, _, supplied_token = raw_header.partition(" ")
        if scheme.lower() != "bearer" or not supplied_token:
            raise ApiError(401, "UNAUTHORIZED", "Bearer token is required.")
        if not hmac.compare_digest(supplied_token, self.app.settings.token):
            raise ApiError(401, "UNAUTHORIZED", "Bearer token is invalid.")

    def _read_json_body(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ApiError(411, "LENGTH_REQUIRED", "Content-Length is required.")
        try:
            length = int(raw_length)
        except ValueError as error:
            raise ApiError(400, "INVALID_CONTENT_LENGTH", "Content-Length is invalid.") from error
        if length < 1 or length > MAX_JSON_BYTES:
            raise ApiError(413, "JSON_TOO_LARGE", "JSON body is missing or too large.")
        raw_body = self.rfile.read(length)
        if len(raw_body) != length:
            raise ApiError(400, "INCOMPLETE_BODY", "Request body ended before Content-Length.")
        try:
            value = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ApiError(400, "INVALID_JSON", "Request body must be valid JSON.") from error
        if not isinstance(value, dict):
            raise ApiError(400, "INVALID_JSON", "Request body must be a JSON object.")
        return value

    def _send_json(self, status: int, value: dict[str, Any]) -> None:
        raw_body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw_body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw_body)

    def _send_error_json(self, error: ApiError) -> None:
        self.close_connection = True
        self._send_json(error.status, {"error": error.message, "code": error.code})

    def _send_output(self, file_path: Path, output: dict[str, Any]) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", output["contentType"])
        self.send_header("Content-Length", str(output["size"]))
        self.send_header("Cache-Control", "no-store")
        encoded_name = quote(output["fileName"], safe="")
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{encoded_name}")
        self.end_headers()
        with file_path.open("rb") as handle:
            shutil.copyfileobj(handle, self.wfile, length=1_048_576)

    def _dispatch_get(self, path: str) -> None:
        if path == "/health":
            self._send_json(200, self.app.health())
            return
        if path == "/workflows":
            self._send_json(200, self.app.list_workflows())
            return
        if path == "/models":
            self._send_json(200, self.app.list_models())
            return
        job_match = re.fullmatch(r"/jobs/([^/]+)", path)
        if job_match:
            job_id = clean_id(job_match.group(1), "job id")
            self._send_json(200, self.app.get_job(job_id))
            return
        output_match = re.fullmatch(r"/jobs/([^/]+)/outputs/([^/]+)", path)
        if output_match:
            job_id = clean_id(output_match.group(1), "job id")
            output_name = clean_file_name(unquote(output_match.group(2)))
            file_path, output = self.app.get_output(job_id, output_name)
            self._send_output(file_path, output)
            return
        raise ApiError(404, "NOT_FOUND", "Endpoint was not found.")

    def _dispatch_post(self, path: str, query: dict[str, list[str]]) -> None:
        if path == "/uploads":
            name_values = query.get("name", [])
            if len(name_values) != 1:
                raise ApiError(400, "MISSING_FILE_NAME", "POST /uploads requires exactly one ?name=.")
            raw_length = self.headers.get("Content-Length")
            if raw_length is None:
                raise ApiError(411, "LENGTH_REQUIRED", "Content-Length is required.")
            try:
                length = int(raw_length)
            except ValueError as error:
                raise ApiError(400, "INVALID_CONTENT_LENGTH", "Content-Length is invalid.") from error
            response = self.app.receive_upload(
                name_values[0], self.headers.get_content_type(), length, self.rfile
            )
            self._send_json(201, response)
            return
        if path == "/jobs":
            job, idempotent = self.app.submit_job(self._read_json_body())
            self._send_json(200 if idempotent else 202, job)
            return
        raise ApiError(404, "NOT_FOUND", "Endpoint was not found.")

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        try:
            self._authorize()
            parsed = urlsplit(self.path)
            self._dispatch_get(parsed.path)
        except ApiError as error:
            self._send_error_json(error)
        except (BrokenPipeError, ConnectionResetError):
            return
        except BaseException:
            LOGGER.exception("Unhandled GET request failure")
            self._send_error_json(ApiError(500, "INTERNAL_ERROR", "Internal bridge error."))

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        try:
            self._authorize()
            parsed = urlsplit(self.path)
            self._dispatch_post(parsed.path, parse_qs(parsed.query, keep_blank_values=True))
        except ApiError as error:
            self._send_error_json(error)
        except (BrokenPipeError, ConnectionResetError):
            return
        except BaseException:
            LOGGER.exception("Unhandled POST request failure")
            self._send_error_json(ApiError(500, "INTERNAL_ERROR", "Internal bridge error."))

    def do_PUT(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        self._send_error_json(ApiError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint."))

    def do_DELETE(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        self._send_error_json(ApiError(405, "METHOD_NOT_ALLOWED", "Method is not allowed."))


def run_server(settings: Settings) -> None:
    app = BridgeApp(settings)
    server = ThreadingHTTPServer((settings.bind, settings.port), BridgeRequestHandler)
    server.app = app  # type: ignore[attr-defined]
    LOGGER.info(
        "Comfy Bridge listening on http://%s:%s in %s mode; ComfyUI remains %s",
        settings.bind,
        settings.port,
        settings.mode,
        settings.comfyui_url,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Stopping Comfy Bridge")
    finally:
        server.server_close()
        app.close()


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("COMFY_BRIDGE_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        settings = Settings.from_environment()
        run_server(settings)
        return 0
    except ValueError as error:
        LOGGER.error("Configuration error: %s", error)
        return 2


if __name__ == "__main__":
    sys.exit(main())
