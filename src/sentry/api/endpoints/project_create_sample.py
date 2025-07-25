from django.core.exceptions import SuspiciousFileOperation
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response

from sentry.api.api_owners import ApiOwner
from sentry.api.api_publish_status import ApiPublishStatus
from sentry.api.base import region_silo_endpoint
from sentry.api.bases.project import ProjectEndpoint, ProjectEventPermission
from sentry.api.serializers import serialize
from sentry.models.groupinbox import GroupInboxReason, add_group_to_inbox
from sentry.utils.samples import create_sample_event

# we have a more modern python example for python
PLATFORM_MAPPING = {
    "python": "python-modern",
}


@region_silo_endpoint
class ProjectCreateSampleEndpoint(ProjectEndpoint):
    publish_status = {
        "POST": ApiPublishStatus.PRIVATE,
    }
    owner = ApiOwner.TELEMETRY_EXPERIENCE
    # Members should be able to create sample events.
    # This is the same scope that allows members to view all issues for a project.
    permission_classes = (ProjectEventPermission,)

    def post(self, request: Request, project) -> Response:
        try:
            event = create_sample_event(
                project,
                platform=PLATFORM_MAPPING.get(project.platform, project.platform),
                default="javascript",
                tagged=True,
            )
            add_group_to_inbox(event.group, GroupInboxReason.NEW)

            data = serialize(event, request.user)

            return Response(data)
        except (SuspiciousFileOperation, IsADirectoryError):
            return Response(status=status.HTTP_400_BAD_REQUEST)
