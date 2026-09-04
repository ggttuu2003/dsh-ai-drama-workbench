from __future__ import annotations

import json
import stat
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


BRIDGE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BRIDGE_DIR))
import bridge  # noqa: E402


class BridgeHttpTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.settings = bridge.Settings(
            comfyui_url="http://127.0.0.1:8188",
            token="test-token-that-is-long-enough-for-bridge",
            bind="127.0.0.1",
            port=0,
            mode="mock",
            data_dir=Path(self.temporary_directory.name) / "data",
            workflows_dir=BRIDGE_DIR / "workflows",
            max_upload_bytes=1024 * 1024,
            max_output_bytes=1024 * 1024,
            request_timeout_seconds=2,
            execution_timeout_seconds=5,
            poll_seconds=0.05,
            workers=1,
        )
        self.app = bridge.BridgeApp(self.settings)
        self.server = bridge.ThreadingHTTPServer(("127.0.0.1", 0), bridge.BridgeRequestHandler)
        self.server.app = self.app
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address[:2]
        self.base_url = f"http://{host}:{port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.app.close()
        self.thread.join(timeout=2)
        self.temporary_directory.cleanup()

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
        authorized: bool = True,
    ) -> tuple[int, bytes]:
        request_headers = dict(headers or {})
        if authorized:
            request_headers["Authorization"] = f"Bearer {self.settings.token}"
        request = Request(f"{self.base_url}{path}", data=body, headers=request_headers, method=method)
        try:
            with urlopen(request, timeout=2) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    def request_json(
        self,
        method: str,
        path: str,
        value: dict[str, object] | None = None,
    ) -> tuple[int, dict[str, object]]:
        body = json.dumps(value).encode("utf-8") if value is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        status, raw_body = self.request(method, path, body, headers)
        return status, json.loads(raw_body.decode("utf-8"))

    def wait_for_completion(self, job_id: str) -> dict[str, object]:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            status, job = self.request_json("GET", f"/jobs/{job_id}")
            self.assertEqual(status, 200)
            if job["status"] in {"completed", "failed"}:
                return job
            time.sleep(0.05)
        self.fail("Mock job did not finish")

    def test_token_upload_mock_job_and_output_download(self) -> None:
        status, error = self.request("GET", "/health", authorized=False)
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(error), {"error": "Bearer token is required.", "code": "UNAUTHORIZED"})

        status, health = self.request_json("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["mode"], "mock")

        status, workflows = self.request_json("GET", "/workflows")
        self.assertEqual(status, 200)
        listed_workflows = {workflow["id"]: workflow for workflow in workflows["workflows"]}
        self.assertIn("image-generate", listed_workflows)
        self.assertIn("image-to-image", listed_workflows)
        self.assertIn("video-first-last", listed_workflows)
        # The user's current graph is prompt-only; it has no LoadImage inputs.
        self.assertEqual(set(listed_workflows["image-generate"]["uploadMappings"]), set())
        self.assertIn("referenceImage", listed_workflows["image-to-image"]["uploadMappings"])
        self.assertIn("firstFrame", listed_workflows["video-first-last"]["uploadMappings"])
        self.assertIn("lastFrame", listed_workflows["video-first-last"]["uploadMappings"])

        status, models = self.request_json("GET", "/models")
        self.assertEqual(status, 200)
        listed_models = {model["id"]: model for model in models["models"]}
        self.assertEqual(
            set(listed_models),
            {"z-image-turbo", "qwen-image-2512", "flux2-klein-4b"},
        )
        self.assertTrue(listed_models["z-image-turbo"]["available"])
        self.assertEqual(listed_models["z-image-turbo"]["workflowId"], "image-generate")
        self.assertIn("shot-first-frame-v1", listed_models["z-image-turbo"]["presetIds"])
        self.assertTrue(listed_models["flux2-klein-4b"]["available"])
        self.assertEqual(listed_models["flux2-klein-4b"]["workflowId"], "image-to-image")
        self.assertTrue(listed_models["qwen-image-2512"]["available"])
        self.assertEqual(listed_models["qwen-image-2512"]["workflowId"], "image-generate-qwen")
        self.assertIn("shot-first-frame-v1", listed_models["qwen-image-2512"]["presetIds"])

        status, raw_upload = self.request(
            "POST",
            "/uploads?name=selected-frame.png",
            b"not-a-real-png-but-a-raw-upload-contract-test",
            {"Content-Type": "image/png"},
        )
        self.assertEqual(status, 201)
        upload = json.loads(raw_upload.decode("utf-8"))
        self.assertEqual(set(upload), {"uploadId", "fileName", "size", "sha256"})
        self.assertEqual(upload["fileName"], "selected-frame.png")

        status, submitted = self.request_json(
            "POST",
            "/jobs",
            {
                "workflowId": "image-generate",
                "clientJobId": "local-job-001",
                "inputs": {
                    "prompt": "A cinematic scene",
                    "negativePrompt": "blurry",
                    "width": 1024,
                    "height": 1024,
                    "seed": 42,
                },
                "uploads": [],
            },
        )
        self.assertEqual(status, 202)
        completed = self.wait_for_completion(submitted["id"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(len(completed["outputs"]), 1)
        output_url = completed["outputs"][0]["url"]
        status, output_raw = self.request("GET", output_url)
        self.assertEqual(status, 200)
        output_manifest = json.loads(output_raw.decode("utf-8"))
        self.assertTrue(output_manifest["mock"])
        self.assertEqual(output_manifest["inputs"]["prompt"], "A cinematic scene")

        status, duplicate = self.request_json(
            "POST",
            "/jobs",
            {
                "workflowId": "image-generate",
                "clientJobId": "local-job-001",
                "inputs": {"prompt": "This must not create a new job"},
                "uploads": [],
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(duplicate["id"], submitted["id"])

    def test_non_loopback_comfy_url_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            bridge.validate_comfyui_url("http://198.51.100.1:8188")

    def test_live_model_catalog_hides_variants_with_missing_components(self) -> None:
        settings = bridge.Settings(
            comfyui_url=self.settings.comfyui_url,
            token=self.settings.token,
            bind=self.settings.bind,
            port=0,
            mode="live",
            data_dir=Path(self.temporary_directory.name) / "live-data",
            workflows_dir=self.settings.workflows_dir,
            max_upload_bytes=self.settings.max_upload_bytes,
            max_output_bytes=self.settings.max_output_bytes,
            request_timeout_seconds=self.settings.request_timeout_seconds,
            execution_timeout_seconds=self.settings.execution_timeout_seconds,
            poll_seconds=self.settings.poll_seconds,
            workers=1,
        )
        app = bridge.BridgeApp(settings)
        try:
            # A declared graph must not become selectable merely because its
            # contract exists; every required remote model choice must resolve.
            app.comfy.input_choices = lambda _node_class, _field: set()  # type: ignore[method-assign]
            models = {model["id"]: model for model in app.list_models()["models"]}
            self.assertTrue(models)
            self.assertTrue(all(not model["available"] for model in models.values()))
            self.assertEqual(models["qwen-image-2512"]["reason"], "所需模型组件未安装")
        finally:
            app.close()

    def test_output_collection_only_returns_declared_nodes_and_media_kind(self) -> None:
        history = {
            "status": {"status_str": "success"},
            "outputs": {
                "9": {"videos": [{"filename": "legacy-final.mp4", "type": "output"}]},
                "92": {"images": [{"filename": "final.mp4", "type": "output"}]},
                "11": {"images": [{"filename": "second.png", "type": "output"}]},
                "7": {
                    "images": [
                        {"filename": "final.png", "type": "output"},
                        {"filename": "final.png", "type": "output"},
                        {"filename": "wrong-kind.mp4", "type": "output"},
                    ]
                },
                "8": {"images": [{"filename": "preview.png", "type": "output"}]},
                "10": {"images": [{"filename": "temporary.png", "type": "temp"}]},
            },
        }
        image_outputs = bridge.collect_comfy_outputs(history, ["11", "7", "9"], "image")
        self.assertEqual([item["filename"] for item in image_outputs], ["second.png", "final.png"])
        video_outputs = bridge.collect_comfy_outputs(history, ["11", "9", "92"], "video")
        self.assertEqual(
            [item["filename"] for item in video_outputs],
            ["legacy-final.mp4", "final.mp4"],
        )

        # A declared SaveVideo node may report its mp4 through ``images``;
        # unrelated image nodes and non-output previews must stay excluded.
        save_video_outputs = bridge.collect_comfy_outputs(history, ["92"], "video")
        self.assertEqual([item["filename"] for item in save_video_outputs], ["final.mp4"])

    def test_output_collection_reports_the_comfyui_node_error(self) -> None:
        history = {
            "status": {
                "status_str": "error",
                "messages": [
                    ["execution_start", {"prompt_id": "prompt-001"}],
                    [
                        "execution_error",
                        {
                            "node_id": "140:119",
                            "node_type": "VAELoader",
                            "exception_type": "FileNotFoundError",
                            "exception_message": "MiniMax H3 video VAE was not found.",
                        },
                    ],
                ],
            },
            "outputs": {},
        }

        with self.assertRaisesRegex(
            bridge.ComfyApiError,
            r"140:119.*VAELoader.*FileNotFoundError.*video VAE was not found",
        ):
            bridge.collect_comfy_outputs(history, ["92"], "video")

    def test_workflow_contract_and_output_validation(self) -> None:
        workflows = bridge.load_workflows(BRIDGE_DIR / "workflows")
        image = workflows["image-generate"]
        image_to_image = workflows["image-to-image"]
        video = workflows["video-first-last"]
        self.assertEqual(set(image["uploadMappings"]), set())
        self.assertEqual(image["comfyPromptFile"], "image-generate.api.json")
        self.assertEqual(image["outputNodeIds"], ["17"])
        self.assertEqual(image["model"]["id"], "z-image-turbo")
        self.assertEqual(
            image["model"]["requirements"],
            [
                {"nodeId": "8", "field": "unet_name"},
                {"nodeId": "5", "field": "clip_name"},
                {"nodeId": "12", "field": "vae_name"},
                {"nodeId": "7", "field": "lora_name"},
                {"nodeId": "16", "field": "model_name"},
            ],
        )
        self.assertEqual(
            set(image_to_image["uploadMappings"]), {"referenceImage", "referenceImage2"}
        )
        self.assertEqual(image_to_image["comfyPromptFile"], "image-to-image.api.json")
        self.assertEqual(image_to_image["outputNodeIds"], ["94"])
        self.assertEqual(image_to_image["model"]["id"], "flux2-klein-4b")
        self.assertEqual(image_to_image["uploadMappings"]["referenceImage"]["nodeId"], "76")
        self.assertEqual(image_to_image["uploadMappings"]["referenceImage2"]["nodeId"], "81")
        self.assertFalse(image_to_image["uploadMappings"]["referenceImage2"]["required"])
        self.assertEqual(
            image_to_image["uploadMappings"]["referenceImage2"]["fallbackRole"],
            "referenceImage",
        )
        self.assertEqual(
            set(image_to_image["inputMappings"]), {"prompt", "width", "height", "seed"}
        )
        self.assertEqual(image_to_image["inputMappings"]["prompt"]["nodeId"], "92:109")
        self.assertEqual(image_to_image["inputMappings"]["seed"]["nodeId"], "92:106")
        self.assertEqual(image_to_image["inputMappings"]["seed"]["field"], "noise_seed")
        self.assertEqual(
            image_to_image["inputMappings"]["width"]["targets"],
            [
                {"nodeId": "92:102", "field": "width"},
                {"nodeId": "92:113", "field": "width"},
            ],
        )
        self.assertEqual(
            image_to_image["inputMappings"]["height"]["targets"],
            [
                {"nodeId": "92:102", "field": "height"},
                {"nodeId": "92:113", "field": "height"},
            ],
        )
        node_types = [node["class_type"] for node in image_to_image["comfyPrompt"].values()]
        self.assertNotIn("LatentBlend", node_types)
        self.assertEqual(node_types.count("ReferenceLatent"), 4)
        self.assertEqual(
            image_to_image["comfyPrompt"]["92:103"]["inputs"]["positive"],
            ["92:84:120", 0],
        )
        injected_image = self.app._apply_input_mappings(
            image_to_image,
            {"prompt": "new cinematic shot", "width": 1280, "height": 720, "seed": 42},
        )
        self.assertEqual(injected_image["92:109"]["inputs"]["text"], "new cinematic shot")
        self.assertEqual(injected_image["92:102"]["inputs"]["width"], 1280)
        self.assertEqual(injected_image["92:113"]["inputs"]["width"], 1280)
        self.assertEqual(injected_image["92:102"]["inputs"]["height"], 720)
        self.assertEqual(injected_image["92:113"]["inputs"]["height"], 720)
        self.assertEqual(injected_image["92:106"]["inputs"]["noise_seed"], 42)
        self.assertEqual(set(video["uploadMappings"]), {"firstFrame", "lastFrame"})
        self.assertEqual(video["comfyPromptFile"], "video-first-last.api.json")
        self.assertEqual(video["outputNodeIds"], ["92"])
        self.assertEqual(set(video["inputMappings"]), {"prompt", "seed", "durationSeconds"})
        self.assertEqual(video["inputMappings"]["prompt"]["nodeId"], "140:131")
        self.assertEqual(video["inputMappings"]["seed"]["field"], "noise_seed")
        self.assertEqual(video["inputMappings"]["durationSeconds"]["nodeId"], "140:133")
        self.assertEqual(video["uploadMappings"]["firstFrame"]["nodeId"], "141")
        self.assertEqual(video["uploadMappings"]["lastFrame"]["nodeId"], "142")
        self.assertEqual(video["comfyPrompt"]["140:131"]["inputs"]["first_frame"], ["141", 0])
        self.assertEqual(video["comfyPrompt"]["140:131"]["inputs"]["last_frame"], ["142", 0])

        injected = self.app._apply_input_mappings(
            video,
            {
                "prompt": "人物从静止走向镜头",
                "seed": 757358688076805,
                "durationSeconds": 5,
            },
        )
        self.assertEqual(injected["140:131"]["inputs"]["prompt"], "人物从静止走向镜头")
        self.assertEqual(injected["140:129"]["inputs"]["noise_seed"], 757358688076805)
        self.assertEqual(injected["140:133"]["inputs"]["value"], 5)
        # Preserve the user's graph-owned resolution, frame alignment, and fps links.
        self.assertEqual(injected["140:131"]["inputs"]["width"], ["115", 0])
        self.assertEqual(injected["140:131"]["inputs"]["height"], ["115", 1])
        self.assertEqual(injected["140:131"]["inputs"]["length"], ["140:132", 1])
        self.assertEqual(injected["140:130"]["inputs"]["fps"], 24)
        # Input mapping must not replace the IMAGE links that connect the two
        # LoadImage nodes to MiniMaxH3ImageToVideo.
        self.assertEqual(injected["140:131"]["inputs"]["first_frame"], ["141", 0])
        self.assertEqual(injected["140:131"]["inputs"]["last_frame"], ["142", 0])

        for workflow in (image, image_to_image, video):
            self.assertTrue(workflow["outputNodeIds"])
            self.assertTrue(
                all(node_id in workflow["comfyPrompt"] for node_id in workflow["outputNodeIds"])
            )

        invalid = bridge.json_clone(image)
        invalid["outputNodeIds"] = []
        with self.assertRaises(ValueError):
            bridge.validate_workflow(invalid, "invalid.json")

        invalid = bridge.json_clone(image)
        invalid["outputNodeIds"] = ["17", "17"]
        with self.assertRaises(ValueError):
            bridge.validate_workflow(invalid, "invalid.json")

        invalid_target = bridge.json_clone(image_to_image)
        invalid_target["inputMappings"]["width"]["targets"][1]["nodeId"] = "missing"
        with self.assertRaisesRegex(ValueError, "existing node"):
            bridge.validate_workflow(invalid_target, "invalid.json")

        invalid_fallback = bridge.json_clone(image_to_image)
        invalid_fallback["uploadMappings"]["referenceImage2"]["fallbackRole"] = "missing"
        with self.assertRaisesRegex(ValueError, "fallbackRole"):
            bridge.validate_workflow(invalid_fallback, "invalid.json")

    def test_image_to_image_injects_second_reference_and_reuses_primary_when_omitted(self) -> None:
        """The optional second upload must drive node 81, with a safe fallback."""

        workflow = self.app.workflows["image-to-image"]
        first = self.app.store.create_upload("scene.png", "image/png", [b"scene"])
        second = self.app.store.create_upload("character.png", "image/png", [b"character"])

        class RecordingComfy:
            def __init__(self) -> None:
                self.uploaded: list[tuple[str, str, str]] = []
                self.prompt: dict[str, object] | None = None

            def upload_image(self, file_path: Path, remote_name: str, subfolder: str) -> str:
                self.uploaded.append((file_path.name, remote_name, subfolder))
                return f"{subfolder}/{remote_name}"

            def submit_prompt(self, prompt: dict[str, object], client_id: str) -> str:
                self.prompt = prompt
                return "prompt-image-to-image"

            def history(self, prompt_id: str) -> dict[str, object]:
                return {
                    "outputs": {
                        "94": {
                            "images": [{"filename": "generated.png", "type": "output"}],
                        }
                    }
                }

            def download_output(self, remote: dict[str, str], destination: Path) -> tuple[int, str]:
                destination.write_bytes(b"generated")
                return len(b"generated"), "image/png"

        def make_job(uploads: list[dict[str, object]], suffix: str) -> dict[str, object]:
            now = bridge.utc_now()
            return {
                "id": f"job-image-to-image-{suffix}",
                "workflowId": "image-to-image",
                "workflowName": workflow["name"],
                "kind": "image",
                "status": "queued",
                "progress": {"phase": "queued", "value": 0, "message": "queued"},
                "createdAt": now,
                "updatedAt": now,
                "inputs": {"prompt": "combine scene and character"},
                "uploads": uploads,
                "outputs": [],
                "dryRun": False,
                "comfyPromptId": None,
                "error": None,
            }

        def normalized_upload(upload: dict[str, object], role: str) -> dict[str, object]:
            return {
                "role": role,
                "uploadId": upload["uploadId"],
                "fileName": upload["fileName"],
                "size": upload["size"],
                "sha256": upload["sha256"],
                "storedFile": upload["storedFile"],
            }

        # A one-image request populates both independent reference branches.
        one_client = RecordingComfy()
        self.app.comfy = one_client  # type: ignore[assignment]
        one_job = make_job([normalized_upload(first, "referenceImage")], "one")
        self.app.store.create_job(one_job)
        self.app._run_live_job(one_job, workflow)
        self.assertIsNotNone(one_client.prompt)
        one_prompt = one_client.prompt or {}
        self.assertEqual(
            one_prompt["76"]["inputs"]["image"], one_prompt["81"]["inputs"]["image"]
        )
        self.assertEqual(one_prompt["92:112:117"]["class_type"], "ReferenceLatent")
        self.assertEqual(one_prompt["92:84:120"]["class_type"], "ReferenceLatent")

        # Supplying both roles must preserve their order and avoid replacing
        # the second image with the fallback during the fan-out pass.
        two_client = RecordingComfy()
        self.app.comfy = two_client  # type: ignore[assignment]
        two_job = make_job(
            [
                normalized_upload(first, "referenceImage"),
                normalized_upload(second, "referenceImage2"),
            ],
            "two",
        )
        self.app.store.create_job(two_job)
        self.app._run_live_job(two_job, workflow)
        self.assertIsNotNone(two_client.prompt)
        two_prompt = two_client.prompt or {}
        first_remote = two_prompt["76"]["inputs"]["image"]
        second_remote = two_prompt["81"]["inputs"]["image"]
        self.assertNotEqual(first_remote, second_remote)
        self.assertEqual(len(two_client.uploaded), 2)
        self.assertTrue(first_remote.endswith(two_client.uploaded[0][1]))
        self.assertTrue(second_remote.endswith(two_client.uploaded[1][1]))

    def test_workflow_contract_loads_a_verbatim_external_api_export(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workflows_dir = root / "workflows"
            api_workflows_dir = root / "api-workflows"
            workflows_dir.mkdir()
            api_workflows_dir.mkdir()

            raw_prompt = {
                "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "原始提示词"}},
                "17": {
                    "class_type": "SaveImage",
                    "inputs": {"filename_prefix": "test", "images": ["4", 0]},
                },
            }
            raw_path = api_workflows_dir / "character.api.json"
            raw_path.write_text(json.dumps(raw_prompt, ensure_ascii=False), encoding="utf-8")
            mapping = {
                "id": "external-api-test",
                "name": "External API test",
                "kind": "image",
                "description": "Loads a raw ComfyUI API export without rewriting it.",
                "enabled": True,
                "comfyPromptFile": "character.api.json",
                "inputMappings": {
                    "prompt": {
                        "nodeId": "4",
                        "field": "text",
                        "type": "string",
                        "required": True,
                    }
                },
                "uploadMappings": {},
                "outputNodeIds": ["17"],
            }
            (workflows_dir / "external-api-test.json").write_text(
                json.dumps(mapping, ensure_ascii=False), encoding="utf-8"
            )

            loaded = bridge.load_workflows(workflows_dir, api_workflows_dir)

            self.assertEqual(loaded["external-api-test"]["comfyPrompt"], raw_prompt)
            self.assertEqual(
                json.loads(raw_path.read_text(encoding="utf-8")), raw_prompt
            )

            invalid = dict(mapping)
            invalid["comfyPromptFile"] = "../outside.api.json"
            (workflows_dir / "invalid.json").write_text(
                json.dumps(invalid, ensure_ascii=False), encoding="utf-8"
            )
            with self.assertRaisesRegex(ValueError, "must not include a path"):
                bridge.load_workflows(workflows_dir, api_workflows_dir)

    def test_same_client_job_id_is_atomic_under_concurrent_submission(self) -> None:
        """Concurrent duplicate submissions must schedule exactly one remote execution."""

        worker_count = 24
        start = threading.Barrier(worker_count)
        request_body = {
            "workflowId": "image-generate",
            "clientJobId": "local-job-atomic-001",
            "inputs": {"prompt": "A deterministic concurrency test"},
            "uploads": [],
        }

        def submit() -> tuple[dict[str, object], bool]:
            start.wait(timeout=3)
            return self.app.submit_job(request_body)

        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            results = list(executor.map(lambda _unused: submit(), range(worker_count)))

        jobs = [job for job, _idempotent in results]
        idempotent_results = [idempotent for _job, idempotent in results]
        self.assertEqual({job["id"] for job in jobs}, {jobs[0]["id"]})
        self.assertEqual(idempotent_results.count(False), 1)
        self.assertEqual(len(self.app.store._jobs), 1)
        completed = self.wait_for_completion(str(jobs[0]["id"]))
        self.assertEqual(completed["status"], "completed")

    def test_bridge_data_files_are_private_regardless_of_umask(self) -> None:
        status, raw_upload = self.request(
            "POST",
            "/uploads?name=selected-frame.png",
            b"private-test-upload",
            {"Content-Type": "image/png"},
        )
        self.assertEqual(status, 201)
        upload = json.loads(raw_upload.decode("utf-8"))
        status, submitted = self.request_json(
            "POST",
            "/jobs",
            {
                "workflowId": "image-generate",
                "clientJobId": "local-job-permissions-001",
                "inputs": {"prompt": "A private bridge data test"},
                "uploads": [],
            },
        )
        self.assertEqual(status, 202)
        self.wait_for_completion(str(submitted["id"]))

        data_dir = self.settings.data_dir
        paths = [
            data_dir,
            data_dir / "jobs",
            data_dir / "uploads",
            data_dir / "outputs",
            data_dir / "jobs" / f"{submitted['id']}.json",
            data_dir / "uploads" / f"{upload['uploadId']}.json",
            self.app.store.upload_file(self.app.store.get_upload(str(upload["uploadId"])) or {}),
            data_dir / "outputs" / str(submitted["id"]),
            data_dir / "outputs" / str(submitted["id"]) / "dry-run.json",
        ]
        for item in paths:
            self.assertEqual(stat.S_IMODE(item.stat().st_mode), 0o700 if item.is_dir() else 0o600)

    def test_output_collection_rejects_unsafe_declared_output(self) -> None:
        unsafe_file_history = {
            "outputs": {
                "7": {"images": [{"filename": "../escape.png", "type": "output"}]},
            }
        }
        with self.assertRaises(bridge.ComfyApiError):
            bridge.collect_comfy_outputs(unsafe_file_history, ["7"], "image")

        unsafe_subfolder_history = {
            "outputs": {
                "7": {
                    "images": [
                        {"filename": "final.png", "subfolder": "..\\escape", "type": "output"}
                    ]
                },
            }
        }
        with self.assertRaises(bridge.ComfyApiError):
            bridge.collect_comfy_outputs(unsafe_subfolder_history, ["7"], "image")


if __name__ == "__main__":
    unittest.main()
