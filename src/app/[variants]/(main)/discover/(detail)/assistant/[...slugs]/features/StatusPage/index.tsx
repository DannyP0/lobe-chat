'use client';

import {
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { Button, Result } from 'antd';
import { useRouter } from 'next/navigation';
import { memo } from 'react';

interface StatusPageProps {
  status: 'unpublished' | 'archived' | 'deprecated';
}

const StatusPage = memo<StatusPageProps>(({ status }) => {
  const router = useRouter();

  const handleBackToMarket = () => {
    router.push('/discover/assistant');
  };

  // 审核中状态
  if (status === 'unpublished') {
    return (
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          minHeight: '60vh',
          padding: '20px',
        }}
      >
        <Result
          extra={
            <Button onClick={handleBackToMarket} type="primary">
              返回助手市场
            </Button>
          }
          icon={<ClockCircleOutlined style={{ color: '#faad14' }} />}
          subTitle={
            <div style={{ color: '#666', lineHeight: 1.6 }}>
              当前访问的助手正在进行版本审核中，如果有疑问复制链接发送问题到{' '}
              <a href="mailto:support@lobehub.com" style={{ color: '#1890ff' }}>
                support@lobehub.com
              </a>{' '}
              进行咨询。
            </div>
          }
          title="助手正在审核中"
        />
      </div>
    );
  }

  // 归档/拒绝状态
  const isArchived = status === 'archived';
  const statusText = isArchived ? '归档' : '拒绝';
  const statusIcon = isArchived ? (
    <FolderOpenOutlined style={{ color: '#8c8c8c' }} />
  ) : (
    <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
  );

  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        flex: 1,
        justifyContent: 'center',
        minHeight: '60vh',
        padding: '20px',
      }}
    >
      <Result
        extra={
          <Button onClick={handleBackToMarket} type="primary">
            返回助手市场
          </Button>
        }
        icon={statusIcon}
        subTitle={
          <div style={{ color: '#666', lineHeight: 1.6 }}>
            <p>当前访问的助手已经因为以下可能的原因被{statusText}了：</p>
            <ul style={{ margin: '16px 0', paddingLeft: '20px', textAlign: 'left' }}>
              <li>开发助手的 owner 主动下架/{statusText === '归档' ? '归档' : '拒绝'}该助手</li>
              <li>助手有安全/政治等问题，被官方下架</li>
            </ul>
            <p>
              有各种问题请复制链接发送到{' '}
              <a href="mailto:support@lobehub.com" style={{ color: '#1890ff' }}>
                support@lobehub.com
              </a>{' '}
              进行咨询。
            </p>
          </div>
        }
        title={`助手已被${statusText}`}
      />
    </div>
  );
});

export default StatusPage;
