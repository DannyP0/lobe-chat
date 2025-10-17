'use client';

import { Icon, Tabs, Tag } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { BookOpenIcon, HistoryIcon, LayersIcon, ListIcon, SquareUserIcon } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import urlJoin from 'url-join';

import { SOCIAL_URL } from '@/const/branding';
import { AGENTS_INDEX_GITHUB, AGENTS_OFFICIAL_URL } from '@/const/url';
import { useQuery } from '@/hooks/useQuery';
import { AssistantNavKey } from '@/types/discover';

import { useDetailContext } from '../DetailProvider';

const useStyles = createStyles(({ css, token }) => {
  return {
    link: css`
      color: ${token.colorTextDescription};

      &:hover {
        color: ${token.colorInfo};
      }
    `,
    nav: css`
      border-block-end: 1px solid ${token.colorBorder};
    `,
  };
});
interface NavProps {
  activeTab?: AssistantNavKey;
  mobile?: boolean;
  setActiveTab?: (tab: AssistantNavKey) => void;
}

const Nav = memo<NavProps>(({ mobile, setActiveTab, activeTab = AssistantNavKey.Overview }) => {
  const { t } = useTranslation('discover');
  const { pluginCount, knowledgeCount, identifier } = useDetailContext();
  const { styles } = useStyles();
  const { source } = useQuery() as { source?: string };
  const isLegacy = source === 'legacy';
  const marketplaceLink = identifier
    ? isLegacy
      ? urlJoin(AGENTS_INDEX_GITHUB, 'tree/main/locales', identifier)
      : urlJoin(AGENTS_OFFICIAL_URL, identifier)
    : undefined;

  const capabilitiesCount = Number(pluginCount) + Number(knowledgeCount);

  const nav = (
    <Tabs
      activeKey={activeTab}
      compact={mobile}
      items={[
        {
          icon: <Icon icon={BookOpenIcon} size={16} />,
          key: AssistantNavKey.Overview,
          label: t('assistants.details.overview.title'),
        },
        {
          icon: <Icon icon={SquareUserIcon} size={16} />,
          key: AssistantNavKey.SystemRole,
          label: t('assistants.details.systemRole.title'),
        },
        {
          icon: <Icon icon={LayersIcon} size={16} />,
          key: AssistantNavKey.Capabilities,
          label:
            capabilitiesCount > 1 ? (
              <Flexbox
                align={'center'}
                gap={6}
                horizontal
                style={{
                  display: 'inline-flex',
                }}
              >
                {t('assistants.details.capabilities.title')}
                <Tag>{capabilitiesCount}</Tag>
              </Flexbox>
            ) : (
              t('assistants.details.capabilities.title')
            ),
        },
        {
          icon: <Icon icon={HistoryIcon} size={16} />,
          key: AssistantNavKey.Version,
          label: t('assistants.details.version.title'),
        },
        {
          icon: <Icon icon={ListIcon} size={16} />,
          key: AssistantNavKey.Related,
          label: t('assistants.details.related.title'),
        },
      ]}
      onChange={(key) => setActiveTab?.(key as AssistantNavKey)}
    />
  );

  return mobile ? (
    nav
  ) : (
    <Flexbox align={'center'} className={styles.nav} horizontal justify={'space-between'}>
      {nav}
      <Flexbox gap={12} horizontal>
        <Link className={styles.link} href={SOCIAL_URL.discord} target={'_blank'}>
          {t('mcp.details.nav.needHelp')}
        </Link>
        {identifier && marketplaceLink && (
          <Link className={styles.link} href={marketplaceLink} target={'_blank'}>
            {t('mcp.details.nav.viewSourceCode')}
          </Link>
        )}
        <Link
          className={styles.link}
          href={'https://github.com/lobehub/lobe-chat-agents/issues/new/choose'}
          target={'_blank'}
        >
          {t('mcp.details.nav.reportIssue')}
        </Link>
      </Flexbox>
    </Flexbox>
  );
});

export default Nav;
