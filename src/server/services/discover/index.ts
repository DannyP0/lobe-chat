import {
  CURRENT_VERSION,
  DEFAULT_DISCOVER_ASSISTANT_ITEM,
  DEFAULT_DISCOVER_PLUGIN_ITEM,
  DEFAULT_DISCOVER_PROVIDER_ITEM,
  isDesktop,
} from '@lobechat/const';
import {
  AssistantListResponse,
  AssistantMarketSource,
  AssistantQueryParams,
  AssistantSorts,
  CacheRevalidate,
  CacheTag,
  DiscoverAssistantDetail,
  DiscoverAssistantItem,
  DiscoverMcpDetail,
  DiscoverModelDetail,
  DiscoverModelItem,
  DiscoverPluginDetail,
  DiscoverPluginItem,
  DiscoverProviderDetail,
  DiscoverProviderItem,
  IdentifiersResponse,
  McpListResponse,
  McpQueryParams,
  ModelListResponse,
  ModelQueryParams,
  ModelSorts,
  PluginListResponse,
  PluginQueryParams,
  PluginSorts,
  ProviderListResponse,
  ProviderQueryParams,
  ProviderSorts,
} from '@lobechat/types';
import {
  getAudioInputUnitRate,
  getTextInputUnitRate,
  getTextOutputUnitRate,
} from '@lobechat/utils';
import { CategoryItem, CategoryListQuery, MarketSDK } from '@lobehub/market-sdk';
import { CallReportRequest, InstallReportRequest } from '@lobehub/market-types';
import dayjs from 'dayjs';
import debug from 'debug';
import matter from 'gray-matter';
import { cloneDeep, countBy, isString, merge, uniq, uniqBy } from 'lodash-es';
import urlJoin from 'url-join';

import { normalizeLocale } from '@/locales/resources';
import { AssistantStore } from '@/server/modules/AssistantStore';
import { PluginStore } from '@/server/modules/PluginStore';

const log = debug('lobe-server:discover');

export class DiscoverService {
  assistantStore = new AssistantStore();
  pluginStore = new PluginStore();
  market: MarketSDK;

  constructor({ accessToken }: { accessToken?: string } = {}) {
    this.market = new MarketSDK({
      accessToken,
      baseURL: process.env.NEXT_PUBLIC_MARKET_BASE_URL,
    });
    log(
      'DiscoverService initialized with market baseURL: %s',
      process.env.NEXT_PUBLIC_MARKET_BASE_URL,
    );
  }

  async registerClient({ userAgent }: { userAgent?: string }) {
    const getDeviceId = async (): Promise<string> => {
      // 1. Vercel 环境下使用 VERCEL_PROJECT_ID
      if (process.env.VERCEL_PROJECT_ID) {
        return process.env.VERCEL_PROJECT_ID;
      }

      // 2. 桌面端使用 machine-id
      if (isDesktop) {
        try {
          // 动态导入
          const { machineId } = await import('node-machine-id');
          return await machineId();
        } catch (error) {
          console.error('Failed to get machine-id:', error);
        }
      }

      return 'unknown-device';
    };

    const deviceId = await getDeviceId();

    const { client_id, client_secret } = await this.market.registerClient({
      clientName: `LobeHub ${isDesktop ? 'Desktop' : 'Web'}`,
      clientType: isDesktop ? 'desktop' : 'web',
      deviceId,
      platform: isDesktop ? process.platform : userAgent,
      version: CURRENT_VERSION,
    });

    return { clientId: client_id, clientSecret: client_secret };
  }

  async fetchM2MToken(params: { clientId: string; clientSecret: string }) {
    // 使用传入的客户端凭证创建新的 MarketSDK 实例
    const tokenMarket = new MarketSDK({
      baseURL: process.env.NEXT_PUBLIC_MARKET_BASE_URL,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
    });

    const tokenInfo = await tokenMarket.fetchM2MToken();

    return {
      accessToken: tokenInfo.accessToken,
      expiresIn: tokenInfo.expiresIn,
    };
  }

  // ============================== Helper Methods ==============================

  /**
   * 计算 ModelAbilities 的完整度分数
   * 分数越高表示 abilities 越全
   */
  private calculateAbilitiesScore = (abilities?: any): number => {
    if (!abilities) return 0;

    let score = 0;
    const abilityWeights = {
      files: 1,
      functionCall: 1,
      imageOutput: 1,
      reasoning: 1,
      search: 1,
      vision: 1,
    };

    Object.entries(abilityWeights).forEach(([ability, weight]) => {
      if (abilities[ability]) {
        score += weight;
      }
    });

    log('calculateAbilitiesScore: abilities=%O, score=%d', abilities, score);
    return score;
  };

  /**
   * 在模型数组中选择 abilities 最全的模型
   * 组合最全的 abilities 和最大的 contextWindowTokens
   */
  private selectModelWithBestAbilities = (models: DiscoverModelItem[]): DiscoverModelItem => {
    log('selectModelWithBestAbilities: input models count=%d', models.length);
    if (models.length === 1) return models[0];

    // 找到最全的 abilities
    let bestAbilities: Record<string, boolean> = {};
    let maxAbilitiesScore = 0;
    models.forEach((model) => {
      const score = this.calculateAbilitiesScore(model.abilities);
      if (score > maxAbilitiesScore) {
        maxAbilitiesScore = score;
        bestAbilities = { ...(model.abilities as Record<string, boolean>) };
      } else if (score === maxAbilitiesScore && model.abilities) {
        // 合并相同分数的 abilities，确保获得最全的组合
        const abilities = model.abilities as Record<string, boolean>;
        Object.keys(abilities).forEach((key) => {
          if (abilities[key]) {
            bestAbilities[key] = true;
          }
        });
      }
    });

    // 找到最大的 contextWindowTokens
    const maxContextWindowTokens = Math.max(
      ...models.map((model) => model.contextWindowTokens || 0),
    );

    // 找到最新的 releasedAt
    const latestReleasedAt = models
      .map((model) => model.releasedAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0];

    // 找到最短的 identifier
    const shortestIdentifier = models
      .map((model) => model.identifier)
      .reduce((shortest, current) => (current.length < shortest.length ? current : shortest));

    // 选择一个基础模型（通常选择第一个）
    const baseModel = models[0];

    // 组装最终模型，使用最佳的各项属性
    const result: DiscoverModelItem = {
      ...baseModel,
      abilities: bestAbilities as any,
      contextWindowTokens: maxContextWindowTokens || baseModel.contextWindowTokens,
      identifier: shortestIdentifier,
      releasedAt: latestReleasedAt || baseModel.releasedAt,
    };

    log('selectModelWithBestAbilities: selected model=%O', {
      abilities: result.abilities,
      contextWindowTokens: result.contextWindowTokens,
      identifier: result.identifier,
      releasedAt: result.releasedAt,
    });
    return result;
  };

  private normalizeAuthorField = (author: unknown): string => {
    if (!author) return '';

    if (typeof author === 'string') return author;

    if (typeof author === 'object') {
      const { avatar, url, name } = author as {
        avatar?: unknown;
        name?: unknown;
        url?: unknown;
      };

      if (typeof avatar === 'string' && avatar.length > 0) return avatar;
      if (typeof url === 'string' && url.length > 0) return url;
      if (typeof name === 'string' && name.length > 0) return name;
    }

    return '';
  };

  private isLegacySource = (source?: AssistantMarketSource) => source === 'legacy';

  private legacyGetAssistantListRaw = async (locale?: string): Promise<DiscoverAssistantItem[]> => {
    log('legacyGetAssistantListRaw: locale=%s', locale);
    const normalizedLocale = normalizeLocale(locale);
    const list = await this.assistantStore.getAgentIndex(normalizedLocale);
    if (!list || !Array.isArray(list)) {
      log('legacyGetAssistantListRaw: no valid list found, returning empty array');
      return [];
    }
    const result = list.map(({ meta, ...item }) => ({ ...item, ...meta }));
    log('legacyGetAssistantListRaw: returning %d items', result.length);
    return result;
  };

  private legacyGetAssistantCategories = async (
    params: CategoryListQuery = {},
  ): Promise<CategoryItem[]> => {
    log('legacyGetAssistantCategories: params=%O', params);
    const { q, locale } = params;
    let list = await this.legacyGetAssistantListRaw(locale);
    if (q) {
      const originalCount = list.length;
      list = list.filter((item) => {
        return [item.author, item.title, item.description, item?.tags]
          .flat()
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log(
        'legacyGetAssistantCategories: filtered by query "%s", %d -> %d items',
        q,
        originalCount,
        list.length,
      );
    }
    const categoryCounts = countBy(list, (item) => item.category);
    const result = Object.entries(categoryCounts)
      .filter(([category]) => Boolean(category))
      .map(([category, count]) => ({
        category,
        count,
      }));
    log('legacyGetAssistantCategories: returning %d categories', result.length);
    return result;
  };

  private legacyGetAssistantDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }): Promise<DiscoverAssistantDetail | undefined> => {
    log('legacyGetAssistantDetail: params=%O', params);
    const { locale, identifier } = params;
    const normalizedLocale = normalizeLocale(locale);
    let data = await this.assistantStore.getAgent(identifier, normalizedLocale);
    if (!data) {
      log('legacyGetAssistantDetail: assistant not found for identifier=%s', identifier);
      return;
    }
    const { meta, ...item } = data;
    const assistant = merge(cloneDeep(DEFAULT_DISCOVER_ASSISTANT_ITEM), { ...item, ...meta });
    const list = await this.getAssistantList({
      category: assistant.category,
      locale,
      page: 1,
      pageSize: 7,
      source: 'legacy',
    });
    const result = {
      ...assistant,
      related: list.items.filter((item) => item.identifier !== assistant.identifier).slice(0, 6),
    };
    log(
      'legacyGetAssistantDetail: returning assistant with %d related items',
      result.related.length,
    );
    return result;
  };

  private legacyGetAssistantIdentifiers = async (): Promise<IdentifiersResponse> => {
    log('legacyGetAssistantIdentifiers: fetching identifiers');
    const list = await this.legacyGetAssistantListRaw();
    const result = list.map((item) => {
      return {
        identifier: item.identifier,
        lastModified: item.createdAt,
      };
    });
    log('legacyGetAssistantIdentifiers: returning %d identifiers', result.length);
    return result;
  };

  private legacyGetAssistantList = async (
    params: AssistantQueryParams = {},
  ): Promise<AssistantListResponse> => {
    log('legacyGetAssistantList: params=%O', params);
    const {
      locale,
      category,
      order = 'desc',
      page = 1,
      pageSize = 20,
      q,
      sort = AssistantSorts.CreatedAt,
      ownerId,
    } = params;
    const currentPage = Number(page) || 1;
    const currentPageSize = Number(pageSize) || 20;

    if (ownerId) {
      log('legacyGetAssistantList: ownerId filter not supported in legacy source');
      return {
        currentPage,
        items: [],
        pageSize: currentPageSize,
        totalCount: 0,
        totalPages: 0,
      };
    }

    let list = await this.legacyGetAssistantListRaw(locale);
    const originalCount = list.length;

    if (category) {
      list = list.filter((item) => item.category === category);
      log(
        'legacyGetAssistantList: filtered by category "%s", %d -> %d items',
        category,
        originalCount,
        list.length,
      );
    }

    if (q) {
      const beforeFilter = list.length;
      list = list.filter((item) => {
        return [item.author, item.title, item.description, item?.tags]
          .flat()
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log(
        'legacyGetAssistantList: filtered by query "%s", %d -> %d items',
        q,
        beforeFilter,
        list.length,
      );
    }

    if (sort) {
      log('legacyGetAssistantList: sorting by %s %s', sort, order);
      switch (sort) {
        case AssistantSorts.CreatedAt: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix();
            } else {
              return dayjs(b.createdAt).unix() - dayjs(a.createdAt).unix();
            }
          });
          break;
        }
        case AssistantSorts.KnowledgeCount: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return (a.knowledgeCount || 0) - (b.knowledgeCount || 0);
            } else {
              return (b.knowledgeCount || 0) - (a.knowledgeCount || 0);
            }
          });
          break;
        }
        case AssistantSorts.PluginCount: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return (a.pluginCount || 0) - (b.pluginCount || 0);
            } else {
              return (b.pluginCount || 0) - (a.pluginCount || 0);
            }
          });
          break;
        }
        case AssistantSorts.TokenUsage: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return (a.tokenUsage || 0) - (b.tokenUsage || 0);
            } else {
              return (b.tokenUsage || 0) - (a.tokenUsage || 0);
            }
          });
          break;
        }
        case AssistantSorts.Identifier: {
          list = list.sort((a, b) => {
            if (order !== 'desc') {
              return a.identifier.localeCompare(b.identifier);
            } else {
              return b.identifier.localeCompare(a.identifier);
            }
          });
          break;
        }
        case AssistantSorts.Title: {
          list = list.sort((a, b) => {
            if (order === 'desc') {
              return (a.title || a.identifier).localeCompare(b.title || b.identifier);
            } else {
              return (b.title || b.identifier).localeCompare(a.title || a.identifier);
            }
          });
          break;
        }
        default: {
          break;
        }
      }
    }

    const start = (currentPage - 1) * currentPageSize;
    const end = currentPage * currentPageSize;
    const result = {
      currentPage,
      items: list.slice(start, end),
      pageSize: currentPageSize,
      totalCount: list.length,
      totalPages: Math.ceil(list.length / currentPageSize),
    };
    log(
      'legacyGetAssistantList: returning page %d/%d with %d items',
      currentPage,
      result.totalPages,
      result.items.length,
    );
    return result;
  };

  // ============================== Assistant Market ==============================

  getAssistantCategories = async (
    params: CategoryListQuery & { source?: AssistantMarketSource } = {},
  ): Promise<CategoryItem[]> => {
    log('getAssistantCategories: params=%O', params);
    const { source, ...rest } = params;
    if (this.isLegacySource(source)) {
      return this.legacyGetAssistantCategories(rest);
    }

    const { q, locale } = rest;
    const normalizedLocale = normalizeLocale(locale);

    try {
      const categories = await this.market.agents.getCategories({
        locale: normalizedLocale,
        q,
      });
      log('getAssistantCategories: returning %d categories from market SDK', categories.length);
      return categories;
    } catch (error) {
      log('getAssistantCategories: error fetching from market SDK: %O', error);
      return [];
    }
  };

  getAssistantDetail = async (params: {
    identifier: string;
    locale?: string;
    source?: AssistantMarketSource;
    version?: string;
  }): Promise<DiscoverAssistantDetail | undefined> => {
    log('getAssistantDetail: params=%O', params);
    const { source, ...rest } = params;
    if (this.isLegacySource(source)) {
      return this.legacyGetAssistantDetail(rest);
    }

    const { locale, identifier, version } = rest;
    const normalizedLocale = normalizeLocale(locale);

    try {
      const data = await this.market.agents.getAgentDetail(identifier, {
        locale: normalizedLocale,
        version,
      });

      if (!data) {
        log('getAssistantDetail: assistant not found for identifier=%s', identifier);
        return;
      }

      const normalizedAuthor = this.normalizeAuthorField(data.author);
      const assistant = {
        author: normalizedAuthor || (data.ownerId !== null ? `User${data.ownerId}` : 'Unknown'),
        avatar: data.avatar || normalizedAuthor || '',
        category: (data as any).category || 'general',
        config: data.config || {},
        createdAt: (data as any).createdAt,
        currentVersion: data.version,
        description: (data as any).description || data.summary,
        examples: Array.isArray((data as any).examples)
          ? (data as any).examples.map((example: any) => ({
              content: typeof example === 'string' ? example : example.content || '',
              role: example.role || 'user',
            }))
          : [],
        homepage:
          (data as any).homepage ||
          `https://lobehub.com/discover/assistant/${(data as any).identifier}`,
        identifier: (data as any).identifier,
        knowledgeCount:
          (data.config as any)?.knowledgeBases?.length || (data as any).knowledgeCount || 0,
        pluginCount: (data.config as any)?.plugins?.length || (data as any).pluginCount || 0,
        readme: data.documentationUrl || '',
        schemaVersion: 1,
        status: data.status,
        summary: data.summary || '',
        systemRole: (data.config as any)?.systemRole || '',
        tags: data.tags || [],
        title: (data as any).name || (data as any).identifier,
        tokenUsage: data.tokenUsage || 0,
        versions:
          data.versions?.map((item) => ({
            createdAt: (item as any).createdAt || item.updatedAt,
            isLatest: item.isLatest,
            isValidated: item.isValidated,
            status: item.status as any,
            version: item.version,
          })) || [],
      };

      // Get related assistants
      const list = await this.getAssistantList({
        category: assistant.category,
        locale,
        page: 1,
        pageSize: 7,
        source,
      });

      const result = {
        ...assistant,
        related: list.items.filter((item) => item.identifier !== assistant.identifier).slice(0, 6),
      };

      log('getAssistantDetail: returning assistant with %d related items', result.related.length);
      return result;
    } catch (error) {
      log('getAssistantDetail: error fetching from market SDK: %O', error);
      return;
    }
  };

  getAssistantIdentifiers = async (
    params: { source?: AssistantMarketSource } = {},
  ): Promise<IdentifiersResponse> => {
    log('getAssistantIdentifiers: fetching identifiers with params=%O', params);
    if (this.isLegacySource(params.source)) {
      return this.legacyGetAssistantIdentifiers();
    }

    try {
      const identifiers = await this.market.agents.getPublishedIdentifiers();
      const result = identifiers.map((item) => ({
        identifier: item.id,
        lastModified: item.lastModified,
      }));
      log('getAssistantIdentifiers: returning %d identifiers from market SDK', result.length);
      return result;
    } catch (error) {
      log('getAssistantIdentifiers: error fetching from market SDK: %O', error);
      return [];
    }
  };

  getAssistantList = async (params: AssistantQueryParams = {}): Promise<AssistantListResponse> => {
    log('getAssistantList: params=%O', params);
    const { source, ...rest } = params;
    if (this.isLegacySource(source)) {
      return this.legacyGetAssistantList(rest);
    }

    const {
      locale,
      category,
      order = 'desc',
      page = 1,
      pageSize = 20,
      q,
      sort = AssistantSorts.CreatedAt,
      ownerId,
    } = rest;

    try {
      const normalizedLocale = normalizeLocale(locale);

      let apiSort: 'createdAt' | 'updatedAt' | 'name' = 'createdAt';
      switch (sort) {
        case AssistantSorts.Identifier:
        case AssistantSorts.Title: {
          apiSort = 'name';
          break;
        }
        case AssistantSorts.CreatedAt:
        case AssistantSorts.MyOwn: {
          apiSort = 'createdAt';
          break;
        }
        default: {
          apiSort = 'createdAt';
        }
      }

      const data = await this.market.agents.getAgentList({
        category,
        locale: normalizedLocale,
        order,
        ownerId,
        page,
        pageSize,
        q,
        sort: apiSort,
        status: 'published',
        visibility: 'public',
      });

      const transformedItems: DiscoverAssistantItem[] = (data.items || []).map((item: any) => {
        const normalizedAuthor = this.normalizeAuthorField(item.author);
        return {
          author: normalizedAuthor || (item.ownerId !== null ? `User${item.ownerId}` : 'Unknown'),
          avatar: item.avatar || normalizedAuthor || '',
          category: item.category || 'general',
          config: item.config || {},
          createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
          description: item.description || item.summary || '',
          homepage: item.homepage || `https://lobehub.com/discover/assistant/${item.identifier}`,
          identifier: item.identifier,
          knowledgeCount: item.knowledgeCount ?? item.config?.knowledgeBases?.length ?? 0,
          pluginCount: item.pluginCount ?? item.config?.plugins?.length ?? 0,
          schemaVersion: item.schemaVersion ?? 1,
          tags: item.tags || [],
          title: item.name || item.identifier,
          tokenUsage: item.tokenUsage || 0,
        };
      });

      const result: AssistantListResponse = {
        currentPage: data.currentPage || page,
        items: transformedItems,
        pageSize: data.pageSize || pageSize,
        totalCount: data.totalCount || 0,
        totalPages: data.totalPages || 0,
      };

      log(
        'getAssistantList: returning page %d/%d with %d items from market SDK',
        result.currentPage,
        result.totalPages,
        result.items.length,
      );
      return result;
    } catch (error) {
      log('getAssistantList: error fetching from market SDK: %O', error);
      return {
        currentPage: page,
        items: [],
        pageSize,
        totalCount: 0,
        totalPages: 0,
      };
    }
  };

  // ============================== MCP Market ==============================

  getMcpCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    log('getMcpCategories: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.market.plugins.getCategories(
      {
        ...params,
        locale: normalizedLocale,
      },
      {
        next: {
          revalidate: 3600,
        },
      },
    );
    log('getMcpCategories: returning %d categories', result.length);
    return result;
  };

  getMcpDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }): Promise<DiscoverMcpDetail> => {
    log('getMcpDetail: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const mcp = await this.market.plugins.getPluginDetail(
      { ...params, locale: normalizedLocale },
      {
        next: {
          revalidate: 3600,
        },
      },
    );
    const list = await this.getMcpList({
      category: mcp.category,
      locale,
      page: 1,
      pageSize: 7,
    });
    const result = {
      ...mcp,
      related: list.items.filter((item) => item.identifier !== mcp.identifier).slice(0, 6),
    };
    log('getMcpDetail: returning mcp with %d related items', result.related.length);
    return result;
  };

  getMcpList = async (params: McpQueryParams = {}): Promise<McpListResponse> => {
    log('getMcpList: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.market.plugins.getPluginList(
      {
        ...params,
        locale: normalizedLocale,
      },
      {
        next: {
          revalidate: CacheRevalidate.List,
          tags: [CacheTag.Discover, CacheTag.MCP],
        },
      },
    );
    log('getMcpList: returning %d items on page %d', result.items.length, result.currentPage);
    return result;
  };

  getMcpManifest = async (params: { identifier: string; locale?: string; version?: string }) => {
    log('getMcpManifest: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.market.plugins.getPluginManifest(
      {
        ...params,
        locale: normalizedLocale,
      },
      {
        next: {
          revalidate: CacheRevalidate.List,
          tags: [CacheTag.Discover, CacheTag.MCP],
        },
      },
    );
    log('getMcpManifest: returning manifest for %s', params.identifier);
    return result;
  };

  // ============================== MCP Analytics ==============================

  /**
   * report MCP plugin result marketplace
   */
  reportPluginInstallation = async (params: InstallReportRequest) => {
    await this.market.plugins.reportInstallation(params);
  };

  /**
   * report plugin call result to marketplace
   */
  reportCall = async (params: CallReportRequest) => {
    await this.market.plugins.reportCall(params);
  };

  // ============================== Plugin Market ==============================

  private _getPluginList = async (locale?: string): Promise<DiscoverPluginItem[]> => {
    log('_getPluginList: locale=%s', locale);
    const normalizedLocale = normalizeLocale(locale);
    const list = await this.pluginStore.getPluginList(normalizedLocale);
    if (!list || !Array.isArray(list)) {
      log('_getPluginList: no valid list found, returning empty array');
      return [];
    }
    const result = list.map(({ meta, ...item }) => ({ ...item, ...meta }));
    log('_getPluginList: returning %d items', result.length);
    return result;
  };

  getLegacyPluginList = async ({ locale }: { locale?: string } = {}): Promise<any> => {
    log('getLegacyPluginList: locale=%s', locale);
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.pluginStore.getPluginList(normalizedLocale);
    log('getLegacyPluginList: returning plugin list');
    return result;
  };

  getPluginCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    log('getPluginCategories: params=%O', params);
    const { q, locale } = params;
    let list = await this._getPluginList(locale);
    if (q) {
      const originalCount = list.length;
      list = list.filter((item) => {
        return [item.author, item.title, item.description, item?.tags]
          .flat()
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log(
        'getPluginCategories: filtered by query "%s", %d -> %d items',
        q,
        originalCount,
        list.length,
      );
    }
    const categoryCounts = countBy(list, (item) => item.category);
    const result = Object.entries(categoryCounts)
      .filter(([category]) => Boolean(category)) // 过滤掉空值
      .map(([category, count]) => ({
        category,
        count,
      }));
    log('getPluginCategories: returning %d categories', result.length);
    return result;
  };

  getPluginDetail = async (params: {
    identifier: string;
    locale?: string;
    withManifest?: boolean;
  }): Promise<DiscoverPluginDetail | undefined> => {
    log('getPluginDetail: params=%O', params);
    const { locale, identifier, withManifest } = params;
    const all = await this._getPluginList(locale);
    let raw = all.find((item) => item.identifier === identifier);
    if (!raw) {
      log('getPluginDetail: plugin not found for identifier=%s', identifier);
      return;
    }

    raw = merge(cloneDeep(DEFAULT_DISCOVER_PLUGIN_ITEM), raw);
    const list = await this.getPluginList({
      category: raw.category,
      locale,
      page: 1,
      pageSize: 7,
    });

    let plugin = {
      ...raw,
      related: list.items.filter((item) => item.identifier !== raw.identifier).slice(0, 6),
    };

    if (!withManifest || !plugin?.manifest || !isString(plugin?.manifest)) {
      log('getPluginDetail: returning plugin without manifest processing');
      return plugin;
    }

    // 在 Edge Runtime 环境中使用了 Node.js 的 path 模块，但 Edge Runtime 不支持所有 Node.js API
    // 这个函数使用了 @lobehub/chat-plugin-sdk/openapi，该包最终依赖了 @apidevtools/swagger-parser，而这个包在 Edge Runtime 环境中使用了不被支持的 Node.js path 模块。
    // try {
    //   const manifest = await getToolManifest(plugin.manifest);
    //
    //   return {
    //     ...plugin,
    //     manifest,
    //   };
    // } catch {
    //   return plugin;
    // }

    return plugin;
  };

  getPluginIdentifiers = async (): Promise<IdentifiersResponse> => {
    log('getPluginIdentifiers: fetching identifiers');
    const list = await this._getPluginList();
    const result = list.map((item) => {
      return {
        identifier: item.identifier,
        lastModified: item.createdAt,
      };
    });
    log('getPluginIdentifiers: returning %d identifiers', result.length);
    return result;
  };

  getPluginList = async (params: PluginQueryParams = {}): Promise<PluginListResponse> => {
    log('getPluginList: params=%O', params);
    const {
      locale,
      category,
      order = 'desc',
      page = 1,
      pageSize = 20,
      q,
      sort = PluginSorts.CreatedAt,
    } = params;

    let list = await this._getPluginList(locale);
    const originalCount = list.length;

    if (category) {
      list = list.filter((item) => item.category === category);
      log(
        'getPluginList: filtered by category "%s", %d -> %d items',
        category,
        originalCount,
        list.length,
      );
    }

    if (q) {
      const beforeFilter = list.length;
      list = list.filter((item) => {
        return [item.author, item.title, item.description, item?.tags]
          .flat()
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log('getPluginList: filtered by query "%s", %d -> %d items', q, beforeFilter, list.length);
    }

    if (sort) {
      log('getPluginList: sorting by %s %s', sort, order);
      switch (sort) {
        case PluginSorts.CreatedAt: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix();
            } else {
              return dayjs(b.createdAt).unix() - dayjs(a.createdAt).unix();
            }
          });
          break;
        }
        case PluginSorts.Identifier: {
          list = list.sort((a, b) => {
            if (order === 'desc') {
              return a.identifier.localeCompare(b.identifier);
            } else {
              return b.identifier.localeCompare(a.identifier);
            }
          });
          break;
        }
        case PluginSorts.Title: {
          list = list.sort((a, b) => {
            if (order === 'desc') {
              return a.title.localeCompare(b.title);
            } else {
              return b.title.localeCompare(a.title);
            }
          });
          break;
        }
      }
    }

    const result = {
      currentPage: page,
      items: list.slice((page - 1) * pageSize, page * pageSize),
      pageSize,
      totalCount: list.length,
      totalPages: Math.ceil(list.length / pageSize),
    };
    log(
      'getPluginList: returning page %d/%d with %d items',
      page,
      result.totalPages,
      result.items.length,
    );
    return result;
  };

  // ============================== Providers ==============================

  private _getProviderList = async (): Promise<DiscoverProviderItem[]> => {
    log('_getProviderList: fetching provider list');
    const [{ LOBE_DEFAULT_MODEL_LIST }, { DEFAULT_MODEL_PROVIDER_LIST }] = await Promise.all([
      import('model-bank'),
      import('@/config/modelProviders'),
    ]);
    const result = DEFAULT_MODEL_PROVIDER_LIST.map((item) => {
      const models = uniq(
        LOBE_DEFAULT_MODEL_LIST.filter((m) => m.providerId === item.id).map((m) => m.id),
      );
      const provider = {
        ...item,
        identifier: item.id,
        modelCount: models.length,
        models,
      };
      return merge(cloneDeep(DEFAULT_DISCOVER_PROVIDER_ITEM), provider);
    });
    log('_getProviderList: returning %d providers', result.length);
    return result;
  };

  getProviderDetail = async (params: {
    identifier: string;
    locale?: string;
    withReadme?: boolean;
  }): Promise<DiscoverProviderDetail | undefined> => {
    log('getProviderDetail: params=%O', params);
    const { identifier, locale, withReadme } = params;
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
    const all = await this._getProviderList();
    let provider = all.find((item) => item.identifier === identifier);
    if (!provider) {
      log('getProviderDetail: provider not found for identifier=%s', identifier);
      return;
    }

    const list = await this.getProviderList({
      page: 1,
      pageSize: 7,
    });

    let readme;

    if (withReadme) {
      log('getProviderDetail: fetching readme for provider=%s', identifier);
      try {
        const normalizedLocale = normalizeLocale(locale);
        const readmeUrl = urlJoin(
          'https://raw.githubusercontent.com/lobehub/lobe-chat/refs/heads/main/docs/usage/providers',
          normalizedLocale === 'zh-CN' ? `${identifier}.zh-CN.mdx` : `${identifier}.mdx`,
        );
        log('getProviderDetail: readme URL=%s', readmeUrl);
        const res = await fetch(readmeUrl, {
          next: {
            tags: [CacheTag.Discover, CacheTag.Providers],
          },
        });

        const data = await res.text();
        const { content } = matter(data);
        readme = content.trimEnd();
        log('getProviderDetail: readme loaded successfully, length=%d', readme.length);
      } catch (error) {
        log(
          'getProviderDetail: failed to load readme for provider=%s, error: %O',
          identifier,
          error,
        );
      }
    }

    const result = {
      ...provider,
      models: uniqBy(
        LOBE_DEFAULT_MODEL_LIST.filter((m) => m.providerId === provider.id),
        (item) => item.id,
      ),
      readme,
      related: list.items.filter((item) => item.identifier !== provider.identifier).slice(0, 6),
    };
    log(
      'getProviderDetail: returning provider with %d models and %d related items',
      result.models.length,
      result.related.length,
    );
    return result;
  };

  getProviderIdentifiers = async (): Promise<IdentifiersResponse> => {
    log('getProviderIdentifiers: fetching identifiers');
    const list = await this._getProviderList();
    const result = list.map((item) => {
      return {
        identifier: item.identifier,
        lastModified: dayjs().toISOString(),
      };
    });
    log('getProviderIdentifiers: returning %d identifiers', result.length);
    return result;
  };

  getProviderList = async (params: ProviderQueryParams = {}): Promise<ProviderListResponse> => {
    log('getProviderList: params=%O', params);
    const { page = 1, pageSize = 20, q, sort = ProviderSorts.Default, order = 'desc' } = params;
    let list = await this._getProviderList();
    const originalCount = list.length;

    if (q) {
      list = list.filter((item) => {
        return [item.identifier, item.description, item.name]
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log('getProviderList: filtered by query "%s", %d -> %d items', q, originalCount, list.length);
    }

    if (sort) {
      log('getProviderList: sorting by %s %s', sort, order);
      switch (sort) {
        case ProviderSorts.Identifier: {
          list = list.sort((a, b) => {
            if (order === 'desc') {
              return a.identifier.localeCompare(b.identifier);
            } else {
              return b.identifier.localeCompare(a.identifier);
            }
          });
          break;
        }
        case ProviderSorts.ModelCount: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return a.modelCount - b.modelCount;
            } else {
              return b.modelCount - a.modelCount;
            }
          });
          break;
        }
      }
    }

    const result = {
      currentPage: page,
      items: list.slice((page - 1) * pageSize, page * pageSize),
      pageSize,
      totalCount: list.length,
      totalPages: Math.ceil(list.length / pageSize),
    };
    log(
      'getProviderList: returning page %d/%d with %d items',
      page,
      result.totalPages,
      result.items.length,
    );
    return result;
  };

  // ============================== Models ==============================

  private _getRawModelList = async (): Promise<DiscoverModelItem[]> => {
    log('_getRawModelList: fetching raw model list');
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
    const result = LOBE_DEFAULT_MODEL_LIST.map((item) => {
      const identifier = (item.id.split('/').at(-1) || item.id).toLowerCase();
      const providers = uniq(
        LOBE_DEFAULT_MODEL_LIST.filter(
          (m) =>
            m.id.toLowerCase() === identifier ||
            m.id.includes(`/${identifier}`) ||
            m.displayName?.toLowerCase() === item.displayName?.toLowerCase(),
        ).map((m) => m.providerId),
      );
      const model = {
        ...item,
        category: item.providerId,
        identifier,
        providerCount: providers.length,
        providers,
      };
      // 使用简单的合并而不是 DEFAULT_DISCOVER_MODEL_ITEM，避免类型冲突
      return {
        ...model,
        abilities: model.abilities || {},
      } as DiscoverModelItem;
    });
    log('_getRawModelList: returning %d raw models', result.length);
    return result;
  };

  private _getModelList = async (category?: string): Promise<DiscoverModelItem[]> => {
    log('_getModelList: category=%s', category);
    let list = await this._getRawModelList();
    const originalCount = list.length;

    if (category) {
      list = list.filter((item) => item.providerId === category);
      log(
        '_getModelList: filtered by category "%s", %d -> %d items',
        category,
        originalCount,
        list.length,
      );
    }

    // 优化去重逻辑：选择 abilities 最全的模型
    // 1. 按 identifier 分组
    const identifierGroups = new Map<string, DiscoverModelItem[]>();
    list.forEach((item) => {
      const key = item.identifier;
      if (!identifierGroups.has(key)) {
        identifierGroups.set(key, []);
      }
      identifierGroups.get(key)!.push(item);
    });

    log(
      '_getModelList: grouped %d items into %d identifier groups',
      list.length,
      identifierGroups.size,
    );

    // 2. 从每个 identifier 组中选择 abilities 最全的
    let deduplicatedByIdentifier = Array.from(identifierGroups.values()).map((models) =>
      this.selectModelWithBestAbilities(models),
    );

    // 3. 按 displayName 分组
    const displayNameGroups = new Map<string, DiscoverModelItem[]>();
    deduplicatedByIdentifier.forEach((item) => {
      const key = item.displayName?.toLowerCase() || '';
      if (!displayNameGroups.has(key)) {
        displayNameGroups.set(key, []);
      }
      displayNameGroups.get(key)!.push(item);
    });

    log(
      '_getModelList: grouped %d items into %d displayName groups',
      deduplicatedByIdentifier.length,
      displayNameGroups.size,
    );

    // 4. 从每个 displayName 组中选择 abilities 最全的
    const finalList: DiscoverModelItem[] = Array.from(displayNameGroups.values()).map((models) =>
      this.selectModelWithBestAbilities(models),
    );

    log('_getModelList: returning %d deduplicated models', finalList.length);
    return finalList;
  };

  getModelCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    log('getModelCategories: params=%O', params);
    const { q } = params;
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
    let list = LOBE_DEFAULT_MODEL_LIST;
    if (q) {
      const originalCount = list.length;
      list = list.filter((item) => {
        return [item.id, item.displayName, item.description]
          .flat()
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log(
        'getModelCategories: filtered by query "%s", %d -> %d items',
        q,
        originalCount,
        list.length,
      );
    }
    const categoryCounts = countBy(list, (item) => item.providerId);
    const result = Object.entries(categoryCounts)
      .filter(([category]) => Boolean(category)) // 过滤掉空值
      .map(([category, count]) => ({
        category,
        count,
      }));
    log('getModelCategories: returning %d categories', result.length);
    return result;
  };

  getModelDetail = async (params: {
    identifier: string;
  }): Promise<DiscoverModelDetail | undefined> => {
    log('getModelDetail: params=%O', params);
    const [{ LOBE_DEFAULT_MODEL_LIST }, { DEFAULT_MODEL_PROVIDER_LIST }] = await Promise.all([
      import('model-bank'),
      import('@/config/modelProviders'),
    ]);
    const { identifier } = params;
    const all = await this._getModelList();
    let model = all.find((item) => item.identifier.toLowerCase() === identifier.toLowerCase());

    if (!model) {
      log('getModelDetail: model not found in deduplicated list, searching raw list');
      const raw = await this._getRawModelList();
      model = raw.find((item) => item.identifier.toLowerCase() === identifier.toLowerCase());
    }

    if (!model) {
      log('getModelDetail: model not found for identifier=%s', identifier);
      return;
    }

    const providers = DEFAULT_MODEL_PROVIDER_LIST.filter((item) =>
      model.providers?.includes(item.id),
    );
    log('getModelDetail: found %d providers for model %s', providers.length, model.identifier);

    const list = await this.getModelList({
      page: 1,
      pageSize: 7,
      q: model.identifier.split('-')[0],
    });

    const result = {
      ...model,
      providers: providers.map((item) => ({
        ...item,
        model: LOBE_DEFAULT_MODEL_LIST.find((m) => {
          if (m.providerId !== item.id) return false;
          return (
            m.id.toLowerCase() === model.identifier.toLowerCase() ||
            m.id.toLowerCase().includes(`/${model.identifier.toLowerCase()}`) ||
            m.displayName?.toLowerCase() === model.displayName?.toLowerCase()
          );
        }),
      })),
      related: list.items
        .filter(
          (item) => item.identifier !== model.identifier && item.displayName !== model?.displayName,
        )
        .slice(0, 6),
    };
    log(
      'getModelDetail: returning model with %d providers and %d related items',
      result.providers.length,
      result.related.length,
    );
    return result;
  };

  getModelIdentifiers = async (): Promise<IdentifiersResponse> => {
    log('getModelIdentifiers: fetching identifiers');
    const list = await this._getModelList();
    const result = list.map((item) => {
      return {
        identifier: item.identifier,
        lastModified: item.releasedAt || dayjs().toISOString(),
      };
    });
    log('getModelIdentifiers: returning %d identifiers', result.length);
    return result;
  };

  getModelList = async (params: ModelQueryParams = {}): Promise<ModelListResponse> => {
    log('getModelList: params=%O', params);
    const {
      category,
      order = 'desc',
      page = 1,
      pageSize = 20,
      q,
      sort = ModelSorts.ReleasedAt,
    } = params;
    let list = await this._getModelList(category);

    // if (category) {
    //   list = list.filter((item) => item.category === category);
    // }

    if (q) {
      const beforeFilter = list.length;
      list = list.filter((item) => {
        return [item.identifier, item.displayName, item.description]
          .flat()
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log('getModelList: filtered by query "%s", %d -> %d items', q, beforeFilter, list.length);
    }

    if (sort) {
      log('getModelList: sorting by %s %s', sort, order);
      switch (sort) {
        case ModelSorts.ReleasedAt: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return dayjs(a.releasedAt).unix() - dayjs(b.releasedAt).unix();
            } else {
              return dayjs(b.releasedAt).unix() - dayjs(a.releasedAt).unix();
            }
          });
          break;
        }
        case ModelSorts.Identifier: {
          list = list.sort((a, b) => {
            if (order === 'desc') {
              return a.identifier.localeCompare(b.identifier);
            } else {
              return b.identifier.localeCompare(a.identifier);
            }
          });
          break;
        }
        case ModelSorts.InputPrice: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return (
                (getTextInputUnitRate(a.pricing) || getAudioInputUnitRate(a.pricing) || 0) -
                (getTextInputUnitRate(b.pricing) || getAudioInputUnitRate(b.pricing) || 0)
              );
            } else {
              return (
                (getTextInputUnitRate(b.pricing) || getAudioInputUnitRate(b.pricing) || 0) -
                (getTextInputUnitRate(a.pricing) || getAudioInputUnitRate(a.pricing) || 0)
              );
            }
          });
          break;
        }
        case ModelSorts.OutputPrice: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return (
                (getTextOutputUnitRate(a.pricing) || 0) - (getTextOutputUnitRate(b.pricing) || 0)
              );
            } else {
              return (
                (getTextOutputUnitRate(b.pricing) || 0) - (getTextOutputUnitRate(a.pricing) || 0)
              );
            }
          });
          break;
        }
        case ModelSorts.ContextWindowTokens: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return (a.contextWindowTokens || 0) - (b.contextWindowTokens || 0);
            } else {
              return (b.contextWindowTokens || 0) - (a.contextWindowTokens || 0);
            }
          });
          break;
        }
        case ModelSorts.ProviderCount: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return a.providerCount - b.providerCount;
            } else {
              return b.providerCount - a.providerCount;
            }
          });
          break;
        }
      }
    }

    const result = {
      currentPage: page,
      items: list.slice((page - 1) * pageSize, page * pageSize),
      pageSize,
      totalCount: list.length,
      totalPages: Math.ceil(list.length / pageSize),
    };
    log(
      'getModelList: returning page %d/%d with %d items',
      page,
      result.totalPages,
      result.items.length,
    );
    return result;
  };
}
