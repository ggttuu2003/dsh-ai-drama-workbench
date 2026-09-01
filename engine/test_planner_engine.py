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


if __name__ == "__main__":
    unittest.main()
