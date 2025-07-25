import type {Location} from 'history';
import {OrganizationFixture} from 'sentry-fixture/organization';
import {PageFilterStateFixture} from 'sentry-fixture/pageFilters';
import {ProjectFixture} from 'sentry-fixture/project';

import {render, screen, waitFor, within} from 'sentry-test/reactTestingLibrary';

import ProjectsStore from 'sentry/stores/projectsStore';
import {useLocation} from 'sentry/utils/useLocation';
import usePageFilters from 'sentry/utils/usePageFilters';
import useCrossPlatformProject from 'sentry/views/insights/mobile/common/queries/useCrossPlatformProject';
import {MODULE_FEATURE} from 'sentry/views/insights/mobile/screens/settings';
import ScreensLandingPage from 'sentry/views/insights/mobile/screens/views/screensLandingPage';

jest.mock('sentry/utils/usePageFilters');
jest.mock('sentry/utils/useLocation');
jest.mock('sentry/views/insights/mobile/common/queries/useCrossPlatformProject');

describe('Screens Landing Page', function () {
  const organization = OrganizationFixture({
    features: [MODULE_FEATURE],
  });

  const project = ProjectFixture({
    hasInsightsScreenLoad: true,
    firstTransactionEvent: true,
    platform: 'react-native',
  });

  ProjectsStore.loadInitialData([project]);

  jest.mocked(useLocation).mockReturnValue({
    action: 'PUSH',
    hash: '',
    key: '',
    pathname: '/organizations/org-slug/insights/mobile-vitals',
    query: {
      project: project.id,
    },
    search: '',
    state: undefined,
  } as Location);

  jest.mocked(usePageFilters).mockReturnValue(
    PageFilterStateFixture({
      selection: {
        datetime: {
          period: '10d',
          start: null,
          end: null,
          utc: false,
        },
        environments: [],
        projects: [parseInt(project.id, 10)],
      },
    })
  );

  jest.mocked(useCrossPlatformProject).mockReturnValue({
    project,
    selectedPlatform: 'Android',
    isProjectCrossPlatform: true,
  });

  describe('Top Section', function () {
    beforeEach(() => {
      organization.features = [MODULE_FEATURE];
      MockApiClient.addMockResponse({
        url: `/organizations/${organization.slug}/events-stats/`,
      });

      MockApiClient.addMockResponse({
        url: `/organizations/${organization.slug}/events/`,
      });
    });

    afterEach(() => {
      MockApiClient.clearMockResponses();
      jest.clearAllMocks();
    });

    it('shows the platform selector for hybrid sdks', async function () {
      render(<ScreensLandingPage />, {organization, deprecatedRouterMocks: true});
      expect(await screen.findByLabelText('Android')).toBeInTheDocument();
    });

    it('renders all vital cards', async function () {
      jest.mocked(useLocation).mockReturnValue({
        action: 'PUSH',
        hash: '',
        key: '',
        pathname: '/organizations/org-slug/insights/mobile-vitals',
        query: {
          project: project.id,
        },
        search: '',
        state: undefined,
      } as Location);

      const metricsMock = MockApiClient.addMockResponse({
        url: `/organizations/${organization.slug}/events/`,
        body: {
          data: [
            {
              'avg(measurements.app_start_cold)': 1,
              'avg(measurements.app_start_warm)': 2,
              'avg(measurements.time_to_initial_display)': 3,
              'avg(measurements.time_to_full_display)': 4,
            },
          ],
          meta: {
            fields: {
              'avg(measurements.app_start_warm)': 'duration',
              'avg(measurements.time_to_full_display)': 'duration',
              'avg(measurements.time_to_initial_display)': 'duration',
              'avg(measurements.app_start_cold)': 'duration',
            },
            units: {
              'avg(measurements.app_start_warm)': 'millisecond',
              'avg(measurements.time_to_full_display)': 'millisecond',
              'avg(measurements.time_to_initial_display)': 'millisecond',
              'avg(measurements.app_start_cold)': 'millisecond',
            },
            isMetricsData: true,
            isMetricsExtractedData: false,
            tips: {},
            datasetReason: 'unchanged',
            dataset: 'spans',
          },
        },
        match: [
          MockApiClient.matchQuery({referrer: 'api.starfish.mobile-screens-metrics'}),
        ],
      });

      const spanMetricsMock = MockApiClient.addMockResponse({
        url: `/organizations/${organization.slug}/events/`,
        body: {
          data: [
            {
              'division(mobile.slow_frames,mobile.total_frames)': 0.05,
              'division(mobile.frozen_frames,mobile.total_frames)': 0.06,
              'avg(mobile.frames_delay)': 7,
            },
          ],
          meta: {
            fields: {
              'division(mobile.slow_frames,mobile.total_frames)': 'number',
              'division(mobile.frozen_frames,mobile.total_frames)': 'number',
              'avg(mobile.frames_delay)': 'number',
            },
            units: {
              'division(mobile.slow_frames,mobile.total_frames)': null,
              'division(mobile.frozen_frames,mobile.total_frames)': null,
              'avg(mobile.frames_delay)': null,
            },
            isMetricsData: false,
            isMetricsExtractedData: false,
            tips: {},
            datasetReason: 'unchanged',
            dataset: 'spans',
          },
        },
        match: [
          MockApiClient.matchQuery({
            referrer: 'api.starfish.mobile-screens-span-metrics',
          }),
        ],
      });

      render(<ScreensLandingPage />, {organization, deprecatedRouterMocks: true});

      await waitFor(() => {
        expect(metricsMock).toHaveBeenCalled();
      });
      expect(spanMetricsMock).toHaveBeenCalled();

      const cards = [
        {header: 'Avg. Cold App Start', value: '1'},
        {header: 'Avg. Warm App Start', value: '2'},
        {header: 'Avg. TTID', value: '3'},
        {header: 'Avg. TTFD', value: '4'},
        {header: 'Slow Frame Rate', value: '5%'},
        {header: 'Frozen Frame Rate', value: '6%'},
        {header: 'Avg. Frame Delay', value: '7'},
      ];

      const topSection = screen.getByTestId('mobile-vitals-top-metrics');

      for (const card of cards) {
        expect(within(topSection).getByText(card.header)).toBeInTheDocument();
      }
    });
  });
  describe('Permissions', function () {
    beforeEach(() => {
      MockApiClient.addMockResponse({
        url: `/organizations/${organization.slug}/events-stats/`,
      });

      MockApiClient.addMockResponse({
        url: `/organizations/${organization.slug}/events/`,
      });
    });

    afterEach(() => {
      MockApiClient.clearMockResponses();
    });

    it('shows no content if permission is missing', async function () {
      organization.features = [];
      render(<ScreensLandingPage />, {organization, deprecatedRouterMocks: true});
      expect(
        await screen.findByText("You don't have access to this feature")
      ).toBeInTheDocument();
    });

    it('shows content if permission is there', async function () {
      organization.features = [MODULE_FEATURE, 'insights-entry-points'];
      render(<ScreensLandingPage />, {organization, deprecatedRouterMocks: true});
      expect(await screen.findAllByText('Mobile Vitals')).toHaveLength(2);
    });
  });
});
