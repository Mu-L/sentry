import type {ComponentProps} from 'react';
import {type Theme, useTheme} from '@emotion/react';
import styled from '@emotion/styled';
import type {Location} from 'history';

import GridEditable, {
  COL_WIDTH_UNDEFINED,
  type GridColumnHeader,
} from 'sentry/components/tables/gridEditable';
import {t} from 'sentry/locale';
import type {Organization} from 'sentry/types/organization';
import type {EventsMetaType} from 'sentry/utils/discover/eventView';
import {getFieldRenderer} from 'sentry/utils/discover/fieldRenderers';
import {useLocation} from 'sentry/utils/useLocation';
import useOrganization from 'sentry/utils/useOrganization';
import {renderHeadCell} from 'sentry/views/insights/common/components/tableCells/renderHeadCell';
import {SpanIdCell} from 'sentry/views/insights/common/components/tableCells/spanIdCell';
import type {SpanResponse} from 'sentry/views/insights/types';
import {ModuleName, SpanFields} from 'sentry/views/insights/types';
import {TraceViewSources} from 'sentry/views/performance/newTraceDetails/traceHeader/breadcrumbs';

type DataRowKeys =
  | SpanFields.PROJECT
  | SpanFields.TRANSACTION_SPAN_ID
  | SpanFields.TRACE
  | SpanFields.TIMESTAMP
  | SpanFields.SPAN_ID
  | SpanFields.SPAN_DESCRIPTION
  | SpanFields.SPAN_STATUS_CODE;

type ColumnKeys =
  | SpanFields.SPAN_ID
  | SpanFields.SPAN_DESCRIPTION
  | SpanFields.SPAN_STATUS_CODE;

type DataRow = Pick<SpanResponse, DataRowKeys>;

type Column = GridColumnHeader<ColumnKeys>;

const COLUMN_ORDER: Column[] = [
  {
    key: SpanFields.SPAN_ID,
    name: t('Span ID'),
    width: 150,
  },
  {
    key: SpanFields.SPAN_STATUS_CODE,
    name: t('Status'),
    width: 50,
  },
  {
    key: SpanFields.SPAN_DESCRIPTION,
    name: t('URL'),
    width: COL_WIDTH_UNDEFINED,
  },
];

interface Props {
  data: DataRow[];
  isLoading: boolean;
  error?: Error | null;
  highlightedSpanId?: string;
  meta?: EventsMetaType;
  onSampleMouseOut?: ComponentProps<typeof GridEditable>['onRowMouseOut'];
  onSampleMouseOver?: ComponentProps<typeof GridEditable>['onRowMouseOver'];
  referrer?: string;
}

export function SpanSamplesTable({
  data,
  isLoading,
  error,
  meta,
  onSampleMouseOver,
  onSampleMouseOut,
  highlightedSpanId,
}: Props) {
  const theme = useTheme();
  const location = useLocation();
  const organization = useOrganization();

  return (
    <GridEditable
      aria-label={t('Span Samples')}
      isLoading={isLoading}
      error={error}
      data={data}
      columnOrder={COLUMN_ORDER}
      columnSortBy={[]}
      grid={{
        renderHeadCell: col =>
          renderHeadCell({
            column: col,
            location,
          }),
        renderBodyCell: (column, row) =>
          renderBodyCell(column, row, meta, location, organization, theme),
      }}
      highlightedRowKey={data.findIndex(row => row.span_id === highlightedSpanId)}
      onRowMouseOver={onSampleMouseOver}
      onRowMouseOut={onSampleMouseOut}
    />
  );
}

function renderBodyCell(
  column: Column,
  row: DataRow,
  meta: EventsMetaType | undefined,
  location: Location,
  organization: Organization,
  theme: Theme
) {
  if (column.key === SpanFields.SPAN_ID) {
    return (
      <SpanIdCell
        moduleName={ModuleName.HTTP}
        traceId={row.trace}
        timestamp={row.timestamp}
        transactionId={row[SpanFields.TRANSACTION_SPAN_ID]}
        spanId={row[SpanFields.SPAN_ID]}
        source={TraceViewSources.REQUESTS_MODULE}
        location={location}
      />
    );
  }

  if (column.key === SpanFields.SPAN_DESCRIPTION) {
    return <SpanDescriptionCell>{row[column.key]}</SpanDescriptionCell>;
  }

  if (!meta?.fields) {
    return row[column.key];
  }

  const renderer = getFieldRenderer(column.key, meta.fields, false);

  return renderer(row, {
    location,
    organization,
    unit: meta.units?.[column.key],
    theme,
  });
}

const SpanDescriptionCell = styled('span')`
  word-break: break-word;
`;
