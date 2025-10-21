import { Atom, Eye, Globe, Image, Paperclip, ToyBrick } from 'lucide-react-native';
import { memo } from 'react';
import { View } from 'react-native';

import { useThemeMode } from '@/components';
import Tag from '@/components/Tag';

import { useStyles } from './styles';
import type { ModelInfoTagsProps } from './type';

// 简单的token数字格式化函数
const formatTokenNumber = (num: number): string => {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
};

/**
 * 模型信息标签组件
 * 显示模型的各种能力标签，对齐Web端实现
 */
const ModelInfoTags = memo<ModelInfoTagsProps>((model) => {
  const { styles } = useStyles();
  const { isDarkMode } = useThemeMode();

  return (
    <View style={styles.container}>
      {/* Files 支持 */}
      {model.files && <Tag color={'success'} icon={Paperclip} size={'small'} />}

      {/* Image Output 支持 */}
      {model.imageOutput && <Tag color={'success'} icon={Image} size={'small'} />}

      {/* Vision 支持 */}
      {model.vision && <Tag color={'success'} icon={Eye} size={'small'} />}

      {/* Function Call 支持 */}
      {model.functionCall && (
        <Tag color={isDarkMode ? 'blue' : 'geekblue'} icon={ToyBrick} size={'small'} />
      )}

      {/* Reasoning 支持 */}
      {model.reasoning && <Tag color={'purple'} icon={Atom} size={'small'} />}

      {/* Search 支持 */}
      {model.search && <Tag color={'cyan'} icon={Globe} size={'small'} />}

      {/* Context Window Tokens */}
      {typeof model.contextWindowTokens === 'number' && (
        <Tag size={'small'} textProps={{ code: true }}>
          {model.contextWindowTokens === 0 ? '∞' : formatTokenNumber(model.contextWindowTokens)}
        </Tag>
      )}
    </View>
  );
});

ModelInfoTags.displayName = 'ModelInfoTags';

export default ModelInfoTags;
