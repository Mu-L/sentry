from django.core.exceptions import ValidationError
from django.db import IntegrityError, router, transaction
from django.db.models import F
from django.db.models.signals import post_save, pre_save
from django.utils import timezone

from sentry import analytics
from sentry.db.postgres.transactions import in_test_hide_transaction_boundary
from sentry.integrations.analytics import IntegrationResolveCommitEvent, IntegrationResolvePREvent
from sentry.models.activity import Activity
from sentry.models.commit import Commit
from sentry.models.group import Group, GroupStatus
from sentry.models.groupassignee import GroupAssignee
from sentry.models.grouphistory import (
    GroupHistoryStatus,
    record_group_history,
    record_group_history_from_activity_type,
)
from sentry.models.groupinbox import GroupInboxRemoveAction, remove_group_from_inbox
from sentry.models.grouplink import GroupLink
from sentry.models.groupsubscription import GroupSubscription
from sentry.models.project import Project
from sentry.models.pullrequest import PullRequest
from sentry.models.release import Release
from sentry.models.releases.release_project import ReleaseProject
from sentry.models.repository import Repository
from sentry.notifications.types import GroupSubscriptionReason
from sentry.signals import buffer_incr_complete, issue_resolved
from sentry.tasks.clear_expired_resolutions import clear_expired_resolutions
from sentry.types.activity import ActivityType
from sentry.types.group import GroupSubStatus
from sentry.users.services.user import RpcUser
from sentry.users.services.user_option import get_option_from_list, user_option_service


def validate_release_empty_version(instance: Release, **kwargs):
    if not Release.is_valid_version(instance.version):
        raise ValidationError(
            f"release_id({instance.id}) failed to save because of invalid version"
        )


def resolve_group_resolutions(instance, created, **kwargs):
    if not created:
        return

    transaction.on_commit(
        lambda: clear_expired_resolutions.delay(release_id=instance.id),
        router.db_for_write(Release),
    )


def remove_resolved_link(link):
    # TODO(dcramer): ideally this would simply "undo" the link change,
    # but we don't know for a fact that the resolution was most recently from
    # the GroupLink
    with transaction.atomic(router.db_for_write(GroupLink)):
        link.delete()
        affected = Group.objects.filter(status=GroupStatus.RESOLVED, id=link.group_id).update(
            status=GroupStatus.UNRESOLVED,
            substatus=GroupSubStatus.ONGOING,
        )
        if affected:
            Activity.objects.create(
                project_id=link.project_id,
                group_id=link.group_id,
                type=ActivityType.SET_UNRESOLVED.value,
                ident=link.group_id,
            )
            record_group_history_from_activity_type(
                Group.objects.get(id=link.group_id), ActivityType.SET_UNRESOLVED.value
            )


def resolved_in_commit(instance: Commit, created, **kwargs):
    current_datetime = timezone.now()

    groups = instance.find_referenced_groups()

    # Delete GroupLinks where message may have changed
    group_ids = {g.id for g in groups}
    group_links = GroupLink.objects.filter(
        linked_type=GroupLink.LinkedType.commit,
        relationship=GroupLink.Relationship.resolves,
        linked_id=instance.id,
    )
    for link in group_links:
        if link.group_id not in group_ids:
            remove_resolved_link(link)

    if len(groups) == 0:
        return

    try:
        repo = Repository.objects.get(id=instance.repository_id)
    except Repository.DoesNotExist:
        repo = None

    if instance.author:
        with in_test_hide_transaction_boundary():
            user_list = list(instance.author.find_users())
    else:
        user_list = []

    acting_user: RpcUser | None = None

    self_assign_issue = "0"
    if user_list:
        acting_user = user_list[0]
        with in_test_hide_transaction_boundary():
            self_assign_issue = get_option_from_list(
                user_option_service.get_many(
                    filter={"user_ids": [acting_user.id], "keys": ["self_assign_issue"]}
                ),
                key="self_assign_issue",
                default="0",
            )

    for group in groups:
        try:
            # XXX(dcramer): This code is somewhat duplicated from the
            # project_group_index mutation api
            with transaction.atomic(router.db_for_write(GroupLink)):
                GroupLink.objects.create(
                    group_id=group.id,
                    project_id=group.project_id,
                    linked_type=GroupLink.LinkedType.commit,
                    relationship=GroupLink.Relationship.resolves,
                    linked_id=instance.id,
                )

                if acting_user:
                    if self_assign_issue == "1" and not group.assignee_set.exists():
                        GroupAssignee.objects.assign(
                            group=group, assigned_to=acting_user, acting_user=acting_user
                        )

                    # while we only create activity and assignment for one user we want to
                    # subscribe every user
                    for user in user_list:
                        GroupSubscription.objects.subscribe(
                            subscriber=user,
                            group=group,
                            reason=GroupSubscriptionReason.status_change,
                        )

                activity_kwargs = {
                    "project_id": group.project_id,
                    "group": group,
                    "type": ActivityType.SET_RESOLVED_IN_COMMIT.value,
                    "ident": instance.id,
                    "data": {"commit": instance.id},
                }
                if acting_user is not None:
                    activity_kwargs["user_id"] = acting_user.id

                Activity.objects.create(**activity_kwargs)

                Group.objects.filter(id=group.id).update(
                    status=GroupStatus.RESOLVED,
                    resolved_at=current_datetime,
                    substatus=None,
                )
                group.status = GroupStatus.RESOLVED
                group.substatus = None

                remove_group_from_inbox(group, action=GroupInboxRemoveAction.RESOLVED)
                record_group_history_from_activity_type(
                    group,
                    ActivityType.SET_RESOLVED_IN_COMMIT.value,
                    actor=acting_user if acting_user else None,
                )

        except IntegrityError:
            pass
        else:
            if repo is not None:
                if repo.integration_id is not None:
                    analytics.record(
                        IntegrationResolveCommitEvent(
                            provider=repo.provider,
                            id=repo.integration_id,
                            organization_id=repo.organization_id,
                        )
                    )

                issue_resolved.send_robust(
                    organization_id=repo.organization_id,
                    user=user_list[0] if user_list else None,
                    group=group,
                    project=group.project,
                    resolution_type="with_commit",
                    sender="resolved_with_commit",
                )


def resolved_in_pull_request(instance: PullRequest, created, **kwargs):
    groups = instance.find_referenced_groups()

    # Delete GroupLinks where message may have changed
    group_ids = {g.id for g in groups}
    group_links = GroupLink.objects.filter(
        linked_type=GroupLink.LinkedType.pull_request,
        relationship=GroupLink.Relationship.resolves,
        linked_id=instance.id,
    )
    for link in group_links:
        if link.group_id not in group_ids:
            remove_resolved_link(link)

    if len(groups) == 0:
        return

    try:
        repo = Repository.objects.get(id=instance.repository_id)
    except Repository.DoesNotExist:
        repo = None
    if instance.author:
        user_list = list(instance.author.find_users())
    else:
        user_list = []

    for group in groups:
        try:
            with transaction.atomic(router.db_for_write(GroupLink)):
                GroupLink.objects.create(
                    group_id=group.id,
                    project_id=group.project_id,
                    linked_type=GroupLink.LinkedType.pull_request,
                    relationship=GroupLink.Relationship.resolves,
                    linked_id=instance.id,
                )
                acting_user: RpcUser | None = None
                if user_list:
                    acting_user = user_list[0]
                    GroupAssignee.objects.assign(
                        group=group, assigned_to=acting_user, acting_user=acting_user
                    )

                Activity.objects.create(
                    project_id=group.project_id,
                    group=group,
                    type=ActivityType.SET_RESOLVED_IN_PULL_REQUEST.value,
                    ident=instance.id,
                    user_id=acting_user.id if acting_user else None,
                    data={"pull_request": instance.id},
                )
                record_group_history(
                    group, GroupHistoryStatus.SET_RESOLVED_IN_PULL_REQUEST, actor=acting_user
                )
        except IntegrityError:
            pass
        else:
            if repo is not None and repo.integration_id is not None:
                analytics.record(
                    IntegrationResolvePREvent(
                        provider=repo.provider,
                        id=repo.integration_id,
                        organization_id=repo.organization_id,
                    )
                )


pre_save.connect(
    validate_release_empty_version,
    sender=Release,
    dispatch_uid="validate_release_empty_version",
    weak=False,
)

post_save.connect(
    resolve_group_resolutions, sender=Release, dispatch_uid="resolve_group_resolutions", weak=False
)

post_save.connect(resolved_in_commit, sender=Commit, dispatch_uid="resolved_in_commit", weak=False)

post_save.connect(
    resolved_in_pull_request,
    sender=PullRequest,
    dispatch_uid="resolved_in_pull_request",
    weak=False,
)


@buffer_incr_complete.connect(
    sender=ReleaseProject, dispatch_uid="project_has_releases_receiver", weak=False
)
def project_has_releases_receiver(filters, **_):
    try:
        project = ReleaseProject.objects.select_related("project").get(**filters).project
    except ReleaseProject.DoesNotExist:
        return

    if not project.flags.has_releases:
        project.flags.has_releases = True
        project.update(flags=F("flags").bitor(Project.flags.has_releases))
