from sentry.testutils.cases import TestCase
from sentry.testutils.silo import control_silo_test
from sentry.users.models.userpermission import UserPermission


@control_silo_test
class UserPermissionTest(TestCase):
    def test_for_user(self) -> None:
        user = self.create_user(email="a@example.com")
        user2 = self.create_user(email="b@example.com")
        UserPermission.objects.create(user=user, permission="test")
        UserPermission.objects.create(user=user, permission="test2")
        UserPermission.objects.create(user=user2, permission="test3")
        assert sorted(UserPermission.for_user(user.id)) == ["test", "test2"]
