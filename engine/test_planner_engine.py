from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ENGINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE_DIR))
import planner_engine as planner  # noqa: E402


class PlannerProjectScopeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.library = self.root / "library"
        self.project = self.library / "episode-one"
        self.other_project = self.library / "episode-two"
        self.outside = self.root / "outside-project"
        for directory in (self.library, self.project, self.other_project, self.outside):
            directory.mkdir(parents=True, exist_ok=True)
        self.nested = self.project / "nested"
        self.nested.mkdir()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def clean_environment(self) -> dict[str, str]:
        return {
            key: value for key, value in os.environ.items()
            if key not in {planner.PLANNER_LIBRARY_ROOT_ENV, planner.PLANNER_ACTIVE_PROJECT_ROOT_ENV}
        }

    def assert_planner_error(self, expected: str, callback) -> None:
        with self.assertRaises(planner.PlannerError) as context:
            callback()
        self.assertIn(expected, str(context.exception))

    def test_legacy_mode_keeps_specific_project_compatibility(self) -> None:
        resolved = planner.ensure_project_root(self.outside, use_environment_scope=False)
        self.assertEqual(resolved, self.outside.resolve())

    def test_scope_accepts_only_a_direct_library_project(self) -> None:
        scope = planner.resolve_project_scope(self.library, self.project)
        self.assertIsNotNone(scope)
        assert scope is not None
        self.assertEqual(scope.library_root, self.library.resolve())
        self.assertEqual(scope.active_project_root, self.project.resolve())
        self.assertEqual(planner.validate_project_root_in_scope(self.project, scope), self.project.resolve())
        self.assertEqual(
            planner.ensure_project_root(
                self.project,
                allowed_library_root=self.library,
                active_project_root=self.project,
                use_environment_scope=False,
            ),
            self.project.resolve(),
        )

    def test_library_scope_rejects_library_nested_and_outside_paths(self) -> None:
        scope = planner.resolve_project_scope(self.library)
        self.assertIsNotNone(scope)
        assert scope is not None
        self.assert_planner_error(
            "具体项目",
            lambda: planner.validate_project_root_in_scope(self.library, scope),
        )
        self.assert_planner_error(
            "普通一级项目目录",
            lambda: planner.validate_project_root_in_scope(self.nested, scope),
        )
        self.assert_planner_error(
            "不在受信任的资产库内",
            lambda: planner.validate_project_root_in_scope(self.outside, scope),
        )

    def test_active_scope_rejects_a_sibling_project(self) -> None:
        scope = planner.resolve_project_scope(self.library, self.project)
        assert scope is not None
        self.assert_planner_error(
            "当前已选项目",
            lambda: planner.validate_project_root_in_scope(self.other_project, scope),
        )

    def test_active_project_without_library_fails_closed(self) -> None:
        self.assert_planner_error(
            "必须同时设置受信任资产库目录",
            lambda: planner.resolve_project_scope(active_project_root=self.project),
        )

    def test_environment_scope_pins_default_validation_to_active_project(self) -> None:
        environment = self.clean_environment()
        environment.update({
            planner.PLANNER_LIBRARY_ROOT_ENV: str(self.library),
            planner.PLANNER_ACTIVE_PROJECT_ROOT_ENV: str(self.project),
        })
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(planner.ensure_project_root(self.project), self.project.resolve())
            self.assert_planner_error(
                "当前已选项目",
                lambda: planner.ensure_project_root(self.other_project),
            )

    def test_partial_environment_scope_fails_closed(self) -> None:
        environment = self.clean_environment()
        environment[planner.PLANNER_ACTIVE_PROJECT_ROOT_ENV] = str(self.project)
        with patch.dict(os.environ, environment, clear=True):
            self.assert_planner_error(
                "必须同时设置受信任资产库目录",
                lambda: planner.ensure_project_root(self.project),
            )

    def test_broad_and_symlink_roots_are_rejected(self) -> None:
        self.assert_planner_error(
            "系统根目录或整个用户目录",
            lambda: planner.ensure_project_root(Path("/"), use_environment_scope=False),
        )
        link = self.root / "project-link"
        link.symlink_to(self.project, target_is_directory=True)
        self.assert_planner_error(
            "不能是软链接",
            lambda: planner.ensure_project_root(link, use_environment_scope=False),
        )

    def test_get_proposal_is_also_limited_to_active_project(self) -> None:
        environment = self.clean_environment()
        environment.update({
            planner.PLANNER_LIBRARY_ROOT_ENV: str(self.library),
            planner.PLANNER_ACTIVE_PROJECT_ROOT_ENV: str(self.project),
        })
        proposal = {
            "proposal_id": "proposal_123456789012",
            "project_path": str(self.other_project),
            "status": "staged",
        }
        with patch.dict(os.environ, environment, clear=True), patch.object(planner, "read_proposal", return_value=proposal):
            self.assert_planner_error(
                "当前已选项目",
                lambda: planner.get_proposal({"proposal_id": proposal["proposal_id"]}),
            )


class PlannerSceneAssetBindingTest(unittest.TestCase):
    def snapshot(self) -> dict:
        return {
            "characters": [],
            "locations": [{"name": "庭院", "path": "场景/庭院"}],
            "props": [{"name": "短剑", "path": "道具/短剑"}],
            "scenes": [],
        }

    def base_plan(self, scene: dict) -> dict:
        return {
            "title": "提案",
            "summary": "概要",
            "new_characters": [],
            "look_additions": [],
            "reuse_characters": [],
            "new_locations": [],
            "reuse_locations": [],
            "new_props": [],
            "reuse_props": [],
            "new_scenes": [scene],
            "reuse_scenes": [],
            "notes": [],
        }

    def scene(self, **kwargs) -> dict:
        value = {
            "scene_id": "SC001",
            "title": "庭院夜谈",
            "summary": "两人交谈",
            "character_refs": [],
            "location_refs": ["庭院"],
            "prop_refs": ["短剑"],
            "cast": [],
            "shots": [{"id": "SH001", "title": "近景", "content": "人物交谈"}],
        }
        value.update(kwargs)
        return value

    def test_refs_only_materialize_default_bindings_and_document(self) -> None:
        plan = planner.normalize_plan(self.base_plan(self.scene()), self.snapshot())
        scene = plan["new_scenes"][0]
        self.assertEqual(scene["location_asset_bindings"][0]["locationPath"], "场景/庭院")
        self.assertEqual(scene["prop_asset_bindings"][0]["propPath"], "道具/短剑")
        document = planner.scene_asset_document(scene)
        self.assertIn(planner.SCENE_ASSET_PROJECTION_MARKER_START, document)
        self.assertIn(planner.SCENE_ASSET_MARKER_START, document)
        self.assertIn('"locations": [', document)
        self.assertIn('"props": [', document)
        self.assertIn("| 地点 | 角色 | 生效镜头 | 状态 | 连续性 |", document)
        self.assertIn("| 道具 | 角色 | 生效镜头 | 状态 | 连续性 |", document)

    def test_explicit_binding_preserves_role_state_and_range(self) -> None:
        scene = self.scene(
            location_bindings=[{"locationPath": "场景/庭院", "role": "主环境", "state": "雨后", "continuity": "灯光不变", "startShotId": "SH001", "endShotId": "SH001"}],
            prop_bindings=[{"prop": "短剑", "role": "线索", "state": "出鞘", "continuity": "右手持有", "start_shot_id": "SH001", "end_shot_id": "SH001"}],
        )
        normalized = planner.normalize_plan(self.base_plan(scene), self.snapshot())["new_scenes"][0]
        self.assertEqual(normalized["location_asset_bindings"][0]["role"], "主环境")
        self.assertEqual(normalized["prop_asset_bindings"][0]["continuity"], "右手持有")

    def test_binding_range_must_reference_scene_shot(self) -> None:
        scene = self.scene(location_bindings=[{"location": "庭院", "start_shot_id": "SH002"}])
        with self.assertRaises(planner.PlannerError):
            planner.normalize_plan(self.base_plan(scene), self.snapshot())

if __name__ == "__main__":
    unittest.main()
