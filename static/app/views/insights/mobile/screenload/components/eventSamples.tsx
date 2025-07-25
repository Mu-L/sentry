import {useMemo} from 'react';

import {t} from 'sentry/locale';
import type {NewQuery} from 'sentry/types/organization';
import EventView from 'sentry/utils/discover/eventView';
import type {Sort} from 'sentry/utils/discover/fields';
import {DiscoverDatasets} from 'sentry/utils/discover/types';
import {decodeList, decodeScalar, decodeSorts} from 'sentry/utils/queryString';
import {MutableSearch} from 'sentry/utils/tokenizeSearch';
import {useLocation} from 'sentry/utils/useLocation';
import usePageFilters from 'sentry/utils/usePageFilters';
import {
  PRIMARY_RELEASE_ALIAS,
  SECONDARY_RELEASE_ALIAS,
} from 'sentry/views/insights/common/components/releaseSelector';
import {useSpans} from 'sentry/views/insights/common/queries/useDiscover';
import {useReleaseSelection} from 'sentry/views/insights/common/queries/useReleases';
import useCrossPlatformProject from 'sentry/views/insights/mobile/common/queries/useCrossPlatformProject';
import {EventSamplesTable} from 'sentry/views/insights/mobile/screenload/components/tables/eventSamplesTable';
import {SpanFields} from 'sentry/views/insights/types';
// test
const DEFAULT_SORT = {
  kind: 'desc',
  field: 'measurements.time_to_initial_display',
} as Sort;

type Props = {
  cursorName: string;
  release: string;
  sortKey: string;
  transaction: string;
  showDeviceClassSelector?: boolean;
};

export function ScreenLoadEventSamples({
  cursorName,
  transaction,
  release,
  sortKey,
  showDeviceClassSelector,
}: Props) {
  const location = useLocation();
  const {selection} = usePageFilters();
  const {primaryRelease} = useReleaseSelection();
  const cursor = decodeScalar(location.query?.[cursorName]);
  const {selectedPlatform: platform, isProjectCrossPlatform} = useCrossPlatformProject();

  const deviceClass = decodeScalar(location.query[SpanFields.DEVICE_CLASS]);
  const subregions = decodeList(location.query[SpanFields.USER_GEO_SUBREGION]);

  const searchQuery = useMemo(() => {
    const mutableQuery = new MutableSearch([
      'span.op:[ui.load,navigation]',
      `is_transaction:true`,
      `transaction:${transaction}`,
      `release:${release}`,
    ]);

    if (subregions.length > 0) {
      mutableQuery.addDisjunctionFilterValues(SpanFields.USER_GEO_SUBREGION, subregions);
    }

    if (isProjectCrossPlatform) {
      mutableQuery.addFilterValue('os.name', platform);
    }

    if (deviceClass) {
      if (deviceClass === 'Unknown') {
        mutableQuery.addFilterValue('!has', 'device.class');
      } else {
        mutableQuery.addFilterValue('device.class', deviceClass);
      }
    }

    return mutableQuery;
  }, [deviceClass, isProjectCrossPlatform, platform, release, transaction, subregions]);

  const sort = decodeSorts(location.query[sortKey])[0] ?? DEFAULT_SORT;

  const columnNameMap = {
    id: t(
      'Event ID (%s)',
      release === primaryRelease ? PRIMARY_RELEASE_ALIAS : SECONDARY_RELEASE_ALIAS
    ),
    'profile.id': t('Profile'),
    'measurements.time_to_initial_display': t('TTID'),
    'measurements.time_to_full_display': t('TTFD'),
  };

  const newQuery: NewQuery = {
    name: '',
    fields: [
      'id',
      'trace',
      'timestamp',
      'project',
      'profile.id',
      'measurements.time_to_initial_display',
      'measurements.time_to_full_display',
    ],
    query: searchQuery.formatString(),
    dataset: DiscoverDatasets.DISCOVER,
    version: 2,
    projects: selection.projects,
  };

  const eventView = EventView.fromNewQueryWithLocation(newQuery, location);
  eventView.sorts = [sort];

  const {data, meta, isPending, pageLinks} = useSpans(
    {
      search: searchQuery.formatString(),
      cursor,
      limit: 4,
      enabled: true,
      sorts: [sort],
      fields: [
        'id',
        'trace',
        'timestamp',
        'project',
        'profile.id',
        'measurements.time_to_initial_display',
        'measurements.time_to_full_display',
      ],
    },
    'api.starfish.mobile-event-samples'
  );

  return (
    <EventSamplesTable
      eventIdKey="id"
      profileIdKey="profile.id"
      isLoading={isPending}
      cursorName={cursorName}
      pageLinks={pageLinks}
      eventView={eventView}
      sortKey={sortKey}
      data={{data, meta}}
      showDeviceClassSelector={showDeviceClassSelector}
      columnNameMap={columnNameMap}
      sort={sort}
    />
  );
}
