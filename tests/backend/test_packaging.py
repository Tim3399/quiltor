"""The macOS bundle's identity and Info.plist.

These exist because the alternative feedback loop is terrible: a .spec only runs
during a real build, on a Mac, with PyInstaller installed -- and a wrong
Info.plist is rejected by App Store Connect's uploader before a human ever looks
at the app. Everything checkable without any of that is checked here.
"""

import os
import plistlib
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "packaging"))

import bundle  # noqa: E402


class VersionTests(unittest.TestCase):
    def test_the_marketing_version_comes_from_the_VERSION_file(self):
        self.assertEqual(
            bundle.version(), (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        )

    def test_the_marketing_version_looks_like_a_version(self):
        self.assertRegex(bundle.version(), r"^\d+\.\d+\.\d+$")

    def test_a_local_build_gets_a_valid_placeholder_build_number(self):
        """Nothing local is uploaded, so there is no counter to read -- but the
        key still has to be present and valid."""
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(bundle.build_number(), "0")

    def test_ci_supplies_the_build_number(self):
        with patch.dict(os.environ, {"QUILTOR_BUILD_NUMBER": "412"}, clear=True):
            self.assertEqual(bundle.build_number(), "412")

    def test_a_malformed_build_number_fails_the_build_rather_than_the_upload(self):
        """Apple wants one to three dot-separated integers. Finding out from a
        rejected upload costs a round trip; finding out here costs nothing."""
        for invalid in ("v1", "1.2.3.4", "2026-08-15", "1.2-rc1", ""):
            with self.subTest(value=invalid):
                with patch.dict(os.environ, {"QUILTOR_BUILD_NUMBER": invalid}, clear=True):
                    if invalid == "":
                        self.assertEqual(bundle.build_number(), "0")  # unset is the local case
                        continue
                    with self.assertRaises(SystemExit):
                        bundle.build_number()


class InfoPlistTests(unittest.TestCase):
    def setUp(self):
        with patch.dict(os.environ, {"QUILTOR_BUILD_NUMBER": "7"}, clear=True):
            self.plist = bundle.info_plist()

    def test_every_key_the_store_uploader_requires_is_present(self):
        """The old spec passed no info_plist at all: the built Info.plist had
        nine keys, CFBundleShortVersionString "0.0.0", and no CFBundleVersion --
        which App Store Connect rejects outright."""
        for key in (
            "CFBundleShortVersionString",
            "CFBundleVersion",
            "LSApplicationCategoryType",
            "ITSAppUsesNonExemptEncryption",
        ):
            with self.subTest(key=key):
                self.assertIn(key, self.plist)

    def test_the_version_is_the_real_one_not_pyinstallers_default(self):
        self.assertEqual(self.plist["CFBundleShortVersionString"], bundle.version())
        self.assertNotEqual(self.plist["CFBundleShortVersionString"], "0.0.0")

    def test_the_build_number_is_a_string(self):
        """CFBundleVersion is a string in the plist; an int there is a rejection."""
        self.assertIsInstance(self.plist["CFBundleVersion"], str)
        self.assertEqual(self.plist["CFBundleVersion"], "7")

    def test_export_compliance_is_declared_so_uploads_do_not_stall(self):
        """Undeclared, every single upload waits on a manual questionnaire.
        False is accurate: the only cryptography is HTTPS from the standard
        library and the OS."""
        self.assertIs(self.plist["ITSAppUsesNonExemptEncryption"], False)

    def test_the_category_is_a_real_apple_category(self):
        self.assertTrue(self.plist["LSApplicationCategoryType"].startswith("public.app-category."))

    def test_both_shipped_languages_are_declared(self):
        """src/language/de and src/language/en are both complete and the
        check:i18n gate keeps them paired, so the bundle should say so."""
        self.assertEqual(sorted(self.plist["CFBundleLocalizations"]), ["de", "en"])
        self.assertIn(self.plist["CFBundleDevelopmentRegion"], self.plist["CFBundleLocalizations"])

    def test_the_minimum_system_version_is_a_version(self):
        self.assertRegex(bundle.MINIMUM_SYSTEM_VERSION, r"^\d+(\.\d+)*$")

    def test_the_copyright_names_a_holder(self):
        self.assertIn("Tim Ratermann", self.plist["NSHumanReadableCopyright"])

    def test_the_whole_plist_actually_serialises(self):
        """plistlib refuses types Apple's format has no representation for --
        a None or a Path slipped in here would only surface during a build."""
        restored = plistlib.loads(plistlib.dumps(self.plist))
        self.assertEqual(restored["CFBundleShortVersionString"], bundle.version())


class BuildVariantTests(unittest.TestCase):
    """What each distribution actually packages.

    Derived from the same policy objects the running app consults, so these also
    pin that the two cannot drift -- packaging Playwright out of a build whose
    renderer still expects it would be the interesting failure.
    """

    def test_the_build_edition_defaults_to_direct(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(bundle.build_edition(), "direct")

    def test_an_unknown_build_edition_fails_loudly(self):
        with patch.dict(os.environ, {"QUILTOR_EDITION": "appstore"}, clear=True):
            with self.assertRaises(SystemExit):
                bundle.build_edition()

    def test_no_desktop_build_ships_playwright(self):
        """Every platform prints with its own engine now, so Playwright's driver
        -- a `node` binary that was most of the macOS bundle, 166 MB down to
        37 MB without it -- would be along purely for a path nothing selects."""
        for os_name in ("macos", "windows", "linux"):
            with patch("backend.system.os_name", return_value=os_name):
                for name in ("direct", "mas", "msstore"):
                    with self.subTest(os=os_name, edition=name):
                        self.assertIn("playwright", bundle.excluded_modules(name))

    def test_the_pdf_renderer_and_the_packaging_agree(self):
        """The point of asking backend/pdf rather than re-deriving: a build must
        never drop the library its own renderer imports, nor carry one it does
        not."""
        from backend import pdf

        for os_name in ("macos", "windows", "linux"):
            for name in ("direct", "mas", "msstore"):
                with self.subTest(os=os_name, edition=name):
                    with patch("backend.system.os_name", return_value=os_name):
                        excluded = "playwright" in bundle.excluded_modules(name)
                        selected = pdf.desktop_renderer_name(
                            os_name=os_name, sandboxed=bundle.policy(name).sandboxed
                        )
                    self.assertNotEqual(excluded, selected == pdf.SYSTEM_BROWSER)

    def test_mlx_scripts_ship_only_where_mlx_could_be_installed(self):
        """Installing MLX means building a venv and pip-installing into it, so a
        build that may not download executable code can never use those scripts."""

        def ships_mlx(name):
            return any("llm-runtime" in source for source, _ in bundle.data_files(name))

        self.assertTrue(ships_mlx("direct"))
        self.assertFalse(ships_mlx("mas"))
        self.assertFalse(ships_mlx("msstore"))

    def test_every_edition_ships_the_client_and_the_version(self):
        for name in ("direct", "mas", "msstore"):
            with self.subTest(edition=name):
                destinations = [dest for _, dest in bundle.data_files(name)]
                self.assertIn("dist", destinations)
                self.assertIn(".", destinations)

    def test_a_direct_build_bundles_no_runtime(self):
        """It installs its own on first launch -- the normal path, and the only
        one that keeps the app under the 4 GB Store cap comfortably."""
        self.assertEqual(bundle.bundled_binaries("direct"), [])

    def test_a_store_build_without_a_runtime_fails_the_build(self):
        """Better here than as a guideline 2.5.2 rejection, or as an app whose
        assistant silently never works."""
        with patch.object(bundle, "REPO_ROOT", Path("/nonexistent")):
            with patch.dict(os.environ, {"QUILTOR_EDITION": "mas"}, clear=True):
                with self.assertRaises(SystemExit) as caught:
                    bundle.bundled_binaries("mas")
        self.assertIn("runtime", str(caught.exception))


class SpecConsistencyTests(unittest.TestCase):
    """The .spec cannot be imported (PyInstaller injects SPECPATH, EXE, BUNDLE
    and friends at exec time), so read it as text and check it wires this module
    up rather than hard-coding what this module owns."""

    def setUp(self):
        self.spec = (REPO_ROOT / "packaging" / "quiltor.spec").read_text(encoding="utf-8")

    def test_the_spec_uses_the_shared_bundle_module(self):
        self.assertIn("import bundle", self.spec)
        self.assertIn("info_plist=bundle.info_plist()", self.spec)
        self.assertIn("bundle_identifier=bundle.BUNDLE_IDENTIFIER", self.spec)

    def test_the_bundle_identifier_is_not_duplicated_in_the_spec(self):
        """Two sources of truth for the identifier is how a signed build ends up
        not matching its provisioning profile."""
        self.assertNotIn(f'"{bundle.BUNDLE_IDENTIFIER}"', self.spec)

    def test_the_spec_takes_its_build_variant_from_the_shared_module(self):
        self.assertIn("bundle.build_edition()", self.spec)
        self.assertIn("bundle.data_files(", self.spec)
        self.assertIn("bundle.excluded_modules(", self.spec)
        self.assertIn("bundle.bundled_binaries(", self.spec)

    def test_the_spec_no_longer_hard_codes_what_it_packages(self):
        """One spec for three distributions; the differences are data. Three
        near-identical spec files would mean maintaining hiddenimports thrice."""
        self.assertNotIn('"scripts/llm-runtime"', self.spec)

    def test_the_target_architecture_is_an_explicit_decision(self):
        """Unset, PyInstaller silently builds for whatever the build machine is
        -- which is how an arm64-only bundle happens by accident."""
        self.assertIn("target_arch=", self.spec)

    def test_the_identifier_is_reverse_dns(self):
        self.assertRegex(bundle.BUNDLE_IDENTIFIER, r"^[a-z0-9]+(\.[a-z0-9-]+)+$")


if __name__ == "__main__":
    unittest.main()
