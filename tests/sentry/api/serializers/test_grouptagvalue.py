from datetime import datetime

from sentry.api.serializers import serialize
from sentry.tagstore.types import GroupTagValue
from sentry.testutils.cases import TestCase


class GroupTagValueSerializerTest(TestCase):
    def test_with_user(self) -> None:
        user = self.create_user()
        grouptagvalue = GroupTagValue(
            group_id=0,
            key="sentry:user",
            value="username:ted",
            times_seen=1,
            first_seen=datetime(2018, 1, 1),
            last_seen=datetime(2018, 1, 1),
        )

        result = serialize(grouptagvalue, user)
        assert result["key"] == "user"
        assert result["value"] == "username:ted"
        assert result["name"] == "ted"
