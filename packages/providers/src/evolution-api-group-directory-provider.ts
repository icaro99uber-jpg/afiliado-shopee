import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type {
  HttpClient,
  ProviderLogger,
} from './evolution-api-whatsapp-provider';
import {
  normalizeWhatsAppGroupId,
  type WhatsAppGroupDirectoryProvider,
  type WhatsAppGroupSummary,
} from './whatsapp-group-directory';

export type EvolutionApiGroupDirectoryProviderOptions = {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  httpClient?: HttpClient;
  logger?: ProviderLogger;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

const requireValue = (value: string, message: string, code: string) => {
  if (value.trim().length === 0) throw new AppError(message, code);
  return value.trim();
};

const normalizeBaseUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      'URL da Evolution API invalida',
      'EVOLUTION_INVALID_URL',
    );
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AppError(
      'URL da Evolution API invalida',
      'EVOLUTION_INVALID_URL',
    );
  }
  return value.replace(/\/+$/, '');
};

const mapHttpError = (status: number) => {
  if (status === 400) {
    return new AppError(
      'Consulta de grupos rejeitada pela Evolution API',
      'EVOLUTION_GROUPS_BAD_REQUEST',
    );
  }
  if (status === 401 || status === 403) {
    return new AppError(
      'Evolution API recusou a consulta de grupos',
      'EVOLUTION_GROUPS_UNAUTHORIZED',
    );
  }
  if (status === 404) {
    return new AppError(
      'Instancia de grupos nao encontrada na Evolution API',
      'EVOLUTION_GROUPS_NOT_FOUND',
    );
  }
  if (status >= 500) {
    return new AppError(
      'Diretorio de grupos da Evolution API indisponivel',
      'EVOLUTION_GROUPS_SERVER_ERROR',
    );
  }
  return new AppError(
    'Falha ao consultar grupos na Evolution API',
    'EVOLUTION_GROUPS_HTTP_ERROR',
  );
};

const malformedResponse = () =>
  new AppError(
    'Evolution API retornou um diretorio de grupos invalido',
    'EVOLUTION_GROUPS_RESPONSE_INVALID',
  );

const mapGroup = (value: unknown): WhatsAppGroupSummary => {
  if (!value || typeof value !== 'object') throw malformedResponse();
  const group = value as { id?: unknown; subject?: unknown; size?: unknown };
  if (
    typeof group.id !== 'string' ||
    typeof group.subject !== 'string' ||
    group.subject.trim().length === 0
  ) {
    throw malformedResponse();
  }

  let externalGroupId: string;
  try {
    externalGroupId = normalizeWhatsAppGroupId(group.id);
  } catch {
    throw malformedResponse();
  }

  if (
    group.size !== undefined &&
    (!Number.isInteger(group.size) || (group.size as number) < 0)
  ) {
    throw malformedResponse();
  }

  return {
    externalGroupId,
    name: group.subject.trim(),
    ...(typeof group.size === 'number' ? { memberCount: group.size } : {}),
  };
};

/**
 * Evolution API 2.3.6 read-only contract:
 * GET /group/fetchAllGroups/:instanceName?getParticipants=false
 * Source: https://github.com/EvolutionAPI/evolution-api/blob/2.3.6/src/api/routes/group.router.ts
 */
export class EvolutionApiGroupDirectoryProvider implements WhatsAppGroupDirectoryProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instanceName: string;
  private readonly httpClient: HttpClient;
  private readonly logger?: ProviderLogger;
  private readonly timeoutMs: number;

  constructor(options: EvolutionApiGroupDirectoryProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = requireValue(
      options.apiKey,
      'API key da Evolution API e obrigatoria',
      'EVOLUTION_API_KEY_REQUIRED',
    );
    this.instanceName = requireValue(
      options.instanceName,
      'Nome da instancia da Evolution API e obrigatorio',
      'EVOLUTION_INSTANCE_NAME_REQUIRED',
    );
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new AppError(
        'Timeout da Evolution API deve ser positivo',
        'EVOLUTION_INVALID_TIMEOUT',
      );
    }
    this.httpClient = options.httpClient ?? fetch;
    this.logger = options.logger;
  }

  async listGroups(): Promise<WhatsAppGroupSummary[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = `${this.baseUrl}/group/fetchAllGroups/${encodeURIComponent(this.instanceName)}?getParticipants=false`;
    let responseStatus: number | undefined;

    try {
      const response = await this.httpClient(url, {
        method: 'GET',
        headers: { apikey: this.apiKey },
        signal: controller.signal,
      });
      responseStatus = response.status;
      if (!response.ok) throw mapHttpError(response.status);

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw malformedResponse();
      }
      if (!Array.isArray(body)) throw malformedResponse();
      const groups = body.map(mapGroup);
      this.logger?.info(
        {
          event: 'evolution.groups.listed',
          instanceName: this.instanceName,
          groupCount: groups.length,
        },
        'Evolution API groups listed',
      );
      return groups;
    } catch (error) {
      const mappedError = controller.signal.aborted
        ? new AppError(
            'Timeout ao consultar grupos na Evolution API',
            'EVOLUTION_GROUPS_TIMEOUT',
          )
        : error instanceof AppError
          ? error
          : new AppError(
              'Falha de rede ao consultar grupos na Evolution API',
              'EVOLUTION_GROUPS_NETWORK_ERROR',
            );
      this.logger?.error(
        {
          event: 'evolution.groups.failed',
          instanceName: this.instanceName,
          code: mappedError.code,
          ...(responseStatus === undefined ? {} : { status: responseStatus }),
        },
        'Evolution API groups failed',
      );
      throw mappedError;
    } finally {
      clearTimeout(timeout);
    }
  }
}
