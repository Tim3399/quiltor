"""The operation profile (D-59): who may install software on this server."""

import unittest

from quiltor.bootstrap.web import operation_profile_for
from quiltor.infrastructure.platform.runtime_target import ProcessRole


class OperationProfileTest(unittest.TestCase):
    def test_multi_user_is_hosted(self):
        self.assertEqual(
            operation_profile_for(multi_user=True, process_role=ProcessRole.SERVER), "hosted"
        )

    def test_multi_user_wins_over_desktop(self):
        self.assertEqual(
            operation_profile_for(multi_user=True, process_role=ProcessRole.DESKTOP), "hosted"
        )

    def test_desktop_role_is_desktop(self):
        self.assertEqual(
            operation_profile_for(multi_user=False, process_role=ProcessRole.DESKTOP), "desktop"
        )

    def test_single_user_server_is_local(self):
        self.assertEqual(
            operation_profile_for(multi_user=False, process_role=ProcessRole.SERVER), "local"
        )

    def test_no_role_is_local(self):
        self.assertEqual(operation_profile_for(multi_user=False, process_role=None), "local")


if __name__ == "__main__":
    unittest.main()
