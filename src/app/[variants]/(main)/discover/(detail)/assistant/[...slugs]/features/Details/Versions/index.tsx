import { Block, Icon, Tag } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { CheckIcon, MinusIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import qs from 'query-string';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import InlineTable from '@/components/InlineTable';
import PublishedTime from '@/components/PublishedTime';
import { AssistantNavKey } from '@/types/discover';

import Title from '../../../../../../features/Title';
import { useDetailContext } from '../../DetailProvider';

const Versions = memo(() => {
  const { t } = useTranslation('discover');
  const theme = useTheme();
  const pathname = usePathname();
  const { versions = [], currentVersion } = useDetailContext();

  const statusTagMap = useMemo(
    () => ({
      archived: {
        color: 'default' as const,
        label: t('assistants.details.version.status.archived'),
      },
      deprecated: {
        color: 'warning' as const,
        label: t('assistants.details.version.status.deprecated'),
      },
    }),
    [t],
  );

  const disableClickStatuses = useMemo(
    () => new Set<keyof typeof statusTagMap>(['archived', 'deprecated']),
    [],
  );

  if (!versions.length) {
    return (
      <Flexbox gap={16}>
        <Title>{t('assistants.details.version.title')}</Title>
        <Block padding={24} variant={'outlined'}>
          {t('assistants.details.version.empty')}
        </Block>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={16}>
      <Title>{t('assistants.details.version.title')}</Title>
      <Block variant={'outlined'}>
        <InlineTable
          columns={[
            {
              dataIndex: 'version',
              render: (_: any, record: any) =>
                (() => {
                  const statusKey =
                    record.status &&
                    Object.prototype.hasOwnProperty.call(statusTagMap, record.status)
                      ? (record.status as keyof typeof statusTagMap)
                      : undefined;
                  const statusMeta = statusKey ? statusTagMap[statusKey] : undefined;
                  const content = (
                    <Flexbox align={'center'} gap={8} horizontal>
                      <code style={{ fontSize: 14 }}>{record.version}</code>
                      {(record.isLatest || record.version === currentVersion) && (
                        <Tag color={'info'}>{t('assistants.details.version.table.isLatest')}</Tag>
                      )}
                      {statusMeta && <Tag color={statusMeta.color}>{statusMeta.label}</Tag>}
                    </Flexbox>
                  );

                  if (statusKey && disableClickStatuses.has(statusKey)) return content;

                  return (
                    <Link
                      href={qs.stringifyUrl({
                        query: {
                          activeTab: AssistantNavKey.Version,
                          version: record.version,
                        },
                        url: pathname,
                      })}
                      style={{ color: 'inherit' }}
                    >
                      {content}
                    </Link>
                  );
                })(),
              title: t('assistants.details.version.table.version'),
            },
            {
              align: 'center',
              dataIndex: 'isValidated',
              render: (_: any, record: any) => (
                <Icon
                  color={record.isValidated ? theme.colorSuccess : theme.colorTextDescription}
                  icon={record.isValidated ? CheckIcon : MinusIcon}
                />
              ),
              title: t('assistants.details.version.table.isValidated'),
            },
            {
              align: 'end',
              dataIndex: 'createdAt',
              render: (_: any, record: any) => (
                <PublishedTime date={record.createdAt} showPrefix={false} />
              ),
              title: t('assistants.details.version.table.publishAt'),
            },
          ]}
          dataSource={versions}
          rowKey={'version'}
          size={'middle'}
        />
      </Block>
    </Flexbox>
  );
});

Versions.displayName = 'AssistantVersions';

export default Versions;
