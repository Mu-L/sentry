from sentry.models.projectteam import ProjectTeam
from sentry.models.team import Team
from sentry.testutils.cases import TestCase


class TeamManagerTest(TestCase):
    def test_simple(self) -> None:
        user = self.create_user("foo@example.com")
        org = self.create_organization()
        team = self.create_team(organization=org, name="Test")
        self.create_member(organization=org, user=user, teams=[team])
        ProjectTeam.objects.create(team=team, project=self.project)

        teams = Team.objects.get_for_user(organization=org, user=user)
        ProjectTeam.objects.get_for_teams_with_org_cache(teams)
