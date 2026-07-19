import { config } from './config';

export interface AsrProviderCapability {
  configured: boolean;
  available: boolean;
  reason?: string;
}

export type AsrCapabilities = Record<
  'xfyun' | 'paraformer' | 'volc',
  AsrProviderCapability
>;

function capability(configured: boolean, reason: string): AsrProviderCapability {
  return configured ? { configured: true, available: true } : { configured: false, available: false, reason };
}

/** Non-secret cold-start capability summary; live entitlement is verified on capture. */
export function getAsrCapabilities(): AsrCapabilities {
  const xfyunConfigured = Boolean(
    config.xfyunAppId.trim() && config.xfyunApiKey.trim() && config.xfyunApiSecret.trim()
  );
  const paraformerConfigured = Boolean(config.dashscopeApiKey.trim());
  const volcCredentials = Boolean(config.volcAppId.trim() && config.volcAccessToken.trim());
  const volcResourceIs2 =
    !config.volcResourceId.trim() || /^volc\.seedasr\./i.test(config.volcResourceId.trim());
  const volcConfigured = volcCredentials && volcResourceIs2;

  return {
    xfyun: capability(xfyunConfigured, '服务端未完整配置 XFYUN_*'),
    paraformer: capability(paraformerConfigured, '服务端未配置 DASHSCOPE_API_KEY'),
    volc: capability(
      volcConfigured,
      !volcCredentials
        ? '服务端未配置 VOLC_APP_ID / VOLC_ACCESS_TOKEN'
        : '仅支持豆包 ASR 2.0 资源'
    )
  };
}
