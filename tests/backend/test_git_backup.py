import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.git_backup import GitBackup, GitContext


class GitBackupTest(unittest.TestCase):
    """Exercises GitBackup against real `git` subprocesses in isolated temp dirs.

    GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM point at a nonexistent file so `identitaet`
    checks are deterministic regardless of the host machine's own git config.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.backups = GitBackup(self.root / "repositories")
        missing = self.root / "no-such-gitconfig"
        self.backups.env["GIT_CONFIG_GLOBAL"] = str(missing)
        self.backups.env["GIT_CONFIG_SYSTEM"] = str(missing)

    def tearDown(self):
        self.temp.cleanup()

    def _world(self, world_id: str) -> GitContext:
        database = self.root / f"{world_id}.sqlite3"
        manuscripts = self.root / "manuscripts" / world_id
        profiles = self.root / "profiles" / world_id
        manuscripts.mkdir(parents=True)
        profiles.mkdir(parents=True)
        sqlite3.connect(database).close()
        return self.backups.context(world_id, "", database, manuscripts, profiles)

    def _set_identity(self, ctx: GitContext) -> None:
        self.backups._ensure(ctx)  # creates ctx.root/.git before config can be written
        self.backups.run(ctx, "config", "user.name", "Tester")
        self.backups.run(ctx, "config", "user.email", "tester@example.com")

    def test_status_on_fresh_repo_is_ok_but_has_no_identity(self):
        ctx = self._world("world-a")
        status = self.backups.status(ctx)
        self.assertTrue(status["ok"])
        self.assertEqual(status["branch"], "main")
        self.assertFalse(status["identitaet"])

    def test_commit_fails_without_git_identity(self):
        ctx = self._world("world-a")
        (ctx.manuscripts / "01 - Kapitel.md").write_text("# Kapitel\n\nText.\n", encoding="utf-8")
        result = self.backups.commit(ctx, "Erster Stand", push=False)
        self.assertFalse(result["ok"])
        self.assertIn("Configure your Git", result["grund"])

    def test_commit_with_identity_creates_a_commit(self):
        ctx = self._world("world-a")
        self._set_identity(ctx)
        (ctx.manuscripts / "01 - Kapitel.md").write_text("# Kapitel\n\nErster Text.\n", encoding="utf-8")
        result = self.backups.commit(ctx, "Erster Stand", push=False)
        self.assertTrue(result["ok"])
        self.assertIn("Backup commit created.", result["log"])
        # A second commit attempt succeeds either way — sqlite's own backup() output
        # isn't byte-stable across calls, so "no textual changes" isn't guaranteed here.
        again = self.backups.commit(ctx, "Nochmal", push=False)
        self.assertTrue(again["ok"])

    def test_diff_and_chapter_version_reflect_committed_history(self):
        ctx = self._world("world-a")
        self._set_identity(ctx)
        (ctx.manuscripts / "01 - Kapitel.md").write_text("# Kapitel\n\nAlter Text.\n", encoding="utf-8")
        first = self.backups.commit(ctx, "Alter Stand", push=False)
        self.assertTrue(first["ok"])
        commit_hash = self.backups.history(ctx)[0]["hash"]

        (ctx.manuscripts / "01 - Kapitel.md").write_text("# Kapitel\n\nNeuer Text.\n", encoding="utf-8")
        working_diff = self.backups.diff(ctx, "WORK")
        self.assertTrue(working_diff["ok"])
        self.assertIn("Neuer", working_diff["diff"])

        old_version = self.backups.chapter_version(ctx, commit_hash, 1, "Kapitel")
        self.assertFalse(old_version["neu"])
        self.assertIn("Alter Text.", old_version["text"])

    def test_world_without_a_remote_still_gets_local_history_but_no_origin(self):
        # Every world gets a local backup repo even when no gitUrl was ever set --
        # only an actual remote push needs one configured.
        ctx = self._world("world-a")  # _world() always passes repository_url=""
        self._set_identity(ctx)
        (ctx.manuscripts / "01 - Kapitel.md").write_text("# Kapitel\n\nText.\n", encoding="utf-8")

        status = self.backups.status(ctx)
        self.assertTrue(status["ok"])
        self.assertEqual(status["remote"], "")

        commit_only = self.backups.commit(ctx, "Lokaler Stand", push=False)
        self.assertTrue(commit_only["ok"])
        self.assertIn("Backup commit created.", commit_only["log"])
        self.assertEqual(len(self.backups.history(ctx)), 1)

        remote_list = self.backups.run(ctx, "remote")
        self.assertEqual(remote_list.stdout.strip(), "")

        pushed = self.backups.commit(ctx, "Zweiter Stand", push=True)
        self.assertFalse(pushed["ok"])

    def test_two_worlds_never_cross_talk(self):
        ctx_a = self._world("world-a")
        ctx_b = self._world("world-b")
        self._set_identity(ctx_a)
        self._set_identity(ctx_b)
        (ctx_a.manuscripts / "01 - Kapitel.md").write_text("# Kapitel\n\nWelt A.\n", encoding="utf-8")
        (ctx_b.manuscripts / "01 - Kapitel.md").write_text("# Kapitel\n\nWelt B.\n", encoding="utf-8")

        self.backups.commit(ctx_a, "A", push=False)
        self.backups.commit(ctx_b, "B", push=False)

        version_a = self.backups.chapter_version(ctx_a, "HEAD", 1, "Kapitel")
        version_b = self.backups.chapter_version(ctx_b, "HEAD", 1, "Kapitel")
        self.assertIn("Welt A.", version_a["text"])
        self.assertIn("Welt B.", version_b["text"])
        self.assertNotEqual(ctx_a.root, ctx_b.root)
        self.assertTrue(self.backups.status(ctx_a)["ok"])
        self.assertTrue(self.backups.status(ctx_b)["ok"])


if __name__ == "__main__":
    unittest.main()
