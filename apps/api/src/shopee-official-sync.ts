import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  OfficialShopeeAffiliateOfferProvider,
  SHOPEE_AFFILIATE_OFFICIAL_API_URL,
  SHOPEE_AFFILIATE_REAL_READ_LIMIT,
  SHOPEE_AFFILIATE_RESPONSE_LIMIT_BYTES,
  type OfficialShopeeAffiliateFetch,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { PrismaShopeeOfferRepository } from './prisma-repositories';
import {
  createShopeeOfficialPreflightRuntime,
  executeShopeeOfficialPreflight,
  loadShopeeOfficialConfig,
} from './shopee-official-preflight';
import {
  countShopeeOfferRejections,
  ShopeeOfferSyncService,
  type ShopeeOfferSyncReport,
} from './shopee-offer-sync-service';
import {
  assertSanitizedArtifact,
  describeJsonShape,
  sanitizeDocumentationText,
  sanitizeGraphqlPayload,
  sanitizeOfficialUrl,
} from './shopee-official-contract-sanitizer';

export type ShopeeOfficialReadAttempt =
  | 'first'
  | 'second'
  | 'final'
  | 'mapping';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const STATE_DIRECTORY = join(
  REPOSITORY_ROOT,
  '.runtime',
  'shopee-official-contract',
);
const READ_ATTEMPT_CONFIG = {
  first: {
    flag: '--confirm-one-real-read',
    statePath: join(STATE_DIRECTORY, 'real-read-state.json'),
  },
  second: {
    flag: '--confirm-second-real-read-after-fix',
    statePath: join(STATE_DIRECTORY, 'second-real-read-state.json'),
    diagnosticPath: join(
      STATE_DIRECTORY,
      'second-real-read-diagnostic.sanitized.json',
    ),
    justification: 'SANITIZED_GRAPHQL_ERROR_CAPTURE_ADDED_AFTER_FIRST_HTTP_200',
  },
  final: {
    flag: '--confirm-final-real-read-after-auth-fix',
    statePath: join(STATE_DIRECTORY, 'final-real-read-state.json'),
    diagnosticPath: join(
      STATE_DIRECTORY,
      'final-real-read-diagnostic.sanitized.json',
    ),
    justification:
      'EXPLORER_AUTHENTICATION_CONFIRMED_AFTER_CREDENTIAL_RECONFIGURATION',
  },
  mapping: {
    flag: '--confirm-mapping-fix-real-read',
    statePath: join(STATE_DIRECTORY, 'mapping-fix-real-read-state.json'),
    diagnosticPath: join(
      STATE_DIRECTORY,
      'mapping-fix-real-read-diagnostic.sanitized.json',
    ),
    justification: 'FAR_FUTURE_TIMESTAMP_MAPPING_FIX_VERIFIED_OFFLINE',
  },
} as const satisfies Record<
  ShopeeOfficialReadAttempt,
  {
    flag: string;
    statePath: string;
    diagnosticPath?: string;
    justification?: string;
  }
>;
const CONTRACT_EVIDENCE_PATH = join(
  STATE_DIRECTORY,
  'real-response-contract.sanitized.json',
);

type ProtectedCounts = {
  commercialPipelineRuns: number;
  commercialAutomationExecutions: number;
  whatsappDispatches: number;
  commercialDispatchOutboxes: number;
};

export type SanitizedShopeeOfficialSyncReport = Pick<
  ShopeeOfferSyncReport,
  | 'fetched'
  | 'valid'
  | 'created'
  | 'updated'
  | 'rejected'
  | 'expired'
  | 'hasNextPage'
  | 'affiliateLinkPresentCount'
  | 'rejectionSummary'
> & {
  realRequests: 1;
  maximumProducts: 5;
};

export type ShopeeOfficialSyncRuntime = {
  preflight(): Promise<void>;
  firstReadState(): unknown;
  secondReadState(): unknown;
  finalReadState(): unknown;
  finalReadDiagnostic(): unknown;
  officialProductCount(): Promise<number>;
  protectedCounts(): Promise<ProtectedCounts>;
  sync(): Promise<ShopeeOfferSyncReport>;
  close(): Promise<void>;
};

const blocked = (code: string, message: string) => new AppError(message, code);

export const parseShopeeOfficialSyncArgs = (
  args: readonly string[],
): ShopeeOfficialReadAttempt => {
  const separators = args.filter((argument) => argument === '--').length;
  const normalized = args.filter((argument) => argument !== '--');
  if (separators > 1 || normalized.length !== 1) {
    throw blocked(
      'SHOPEE_OFFICIAL_CONFIRMATION_REQUIRED',
      `Uma flag de confirmacao exata e obrigatoria`,
    );
  }
  const attempt = (
    Object.entries(READ_ATTEMPT_CONFIG) as Array<
      [ShopeeOfficialReadAttempt, (typeof READ_ATTEMPT_CONFIG)[ShopeeOfficialReadAttempt]]
    >
  ).find(([, config]) => config.flag === normalized[0])?.[0];
  if (attempt) return attempt;
  throw blocked(
    'SHOPEE_OFFICIAL_CONFIRMATION_REQUIRED',
    `Uma flag de confirmacao exata e obrigatoria`,
  );
};

const writeAtomicState = (path: string, value: Record<string, unknown>) => {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporary, path);
};

const readAttemptState = (attempt: 'first' | 'second' | 'final') => {
  try {
    return JSON.parse(
      readFileSync(READ_ATTEMPT_CONFIG[attempt].statePath, 'utf8'),
    ) as unknown;
  } catch {
    throw blocked(
      attempt === 'first'
        ? 'SHOPEE_OFFICIAL_SECOND_READ_NOT_ELIGIBLE'
        : attempt === 'second'
          ? 'SHOPEE_OFFICIAL_FINAL_READ_NOT_ELIGIBLE'
          : 'SHOPEE_OFFICIAL_MAPPING_READ_NOT_ELIGIBLE',
      `Marcador sanitizado da tentativa ${attempt} indisponivel`,
    );
  }
};

const readFinalDiagnostic = () => {
  try {
    return JSON.parse(
      readFileSync(READ_ATTEMPT_CONFIG.final.diagnosticPath, 'utf8'),
    ) as unknown;
  } catch {
    throw blocked(
      'SHOPEE_OFFICIAL_MAPPING_READ_NOT_ELIGIBLE',
      'Evidencia sanitizada da tentativa final indisponivel',
    );
  }
};

const assertStateDirectoryIgnored = () => {
  const result = spawnSync(
    'git',
    [
      'check-ignore',
      '--quiet',
      '.runtime/shopee-official-contract/real-read-state.json',
    ],
    { cwd: REPOSITORY_ROOT, stdio: 'ignore', windowsHide: true },
  );
  if (result.status !== 0) {
    throw blocked(
      'SHOPEE_OFFICIAL_RUNTIME_NOT_IGNORED',
      'Diretorio de evidencia local nao esta ignorado pelo Git',
    );
  }
};

const sanitizedRequestVariables = (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const variables = (payload as Record<string, unknown>).variables;
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [
      key,
      (key === 'page' || key === 'limit') &&
      typeof value === 'number' &&
      Number.isSafeInteger(value)
        ? value
        : describeJsonShape(value, key),
    ]),
  );
};

const readLimitedDiagnosticBody = async (
  response: Response,
  signal: AbortSignal,
) => {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > SHOPEE_AFFILIATE_RESPONSE_LIMIT_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw blocked(
      'SHOPEE_OFFICIAL_DIAGNOSTIC_RESPONSE_TOO_LARGE',
      'Resposta excedeu o limite seguro de diagnostico',
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectOnAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const handleAbort = () =>
    rejectOnAbort?.(new DOMException('aborted', 'AbortError'));
  signal.addEventListener('abort', handleAbort, { once: true });
  try {
    if (signal.aborted) handleAbort();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > SHOPEE_AFFILIATE_RESPONSE_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw blocked(
          'SHOPEE_OFFICIAL_DIAGNOSTIC_RESPONSE_TOO_LARGE',
          'Resposta excedeu o limite seguro de diagnostico',
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', handleAbort);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
};

export const createSingleOfficialReadFetch = ({
  fetchImplementation = fetch,
  statePath = READ_ATTEMPT_CONFIG.first.statePath,
  diagnosticPath,
  sensitiveValues = [],
  justification,
  now = () => new Date(),
}: {
  fetchImplementation?: OfficialShopeeAffiliateFetch;
  statePath?: string;
  diagnosticPath?: string;
  sensitiveValues?: readonly string[];
  justification?: string;
  now?: () => Date;
} = {}): OfficialShopeeAffiliateFetch => {
  let calls = 0;
  return (async (input, init) => {
    calls += 1;
    if (calls !== 1) {
      throw blocked(
        'SHOPEE_OFFICIAL_MULTIPLE_READS_BLOCKED',
        'Mais de uma consulta oficial foi bloqueada',
      );
    }
    assertStateDirectoryIgnored();
    mkdirSync(dirname(statePath), { recursive: true });
    let descriptor: number;
    try {
      descriptor = openSync(statePath, 'wx', 0o600);
    } catch {
      throw blocked(
        'SHOPEE_OFFICIAL_REAL_READ_ALREADY_CLAIMED',
        'A consulta real desta task ja foi iniciada',
      );
    }
    try {
      writeFileSync(
        descriptor,
        `${JSON.stringify({
          status: 'REQUEST_STARTED',
          startedAt: now().toISOString(),
          maximumProducts: SHOPEE_AFFILIATE_REAL_READ_LIMIT,
        })}\n`,
        'utf8',
      );
    } finally {
      closeSync(descriptor);
    }
    try {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';
      if (
        sanitizeOfficialUrl(url) !== SHOPEE_AFFILIATE_OFFICIAL_API_URL ||
        method !== 'POST' ||
        typeof init?.body !== 'string'
      ) {
        throw blocked(
          'SHOPEE_OFFICIAL_REQUEST_CONTRACT_INVALID',
          'Contrato HTTP oficial invalido',
        );
      }
      const body = init.body;
      const requestPayload = JSON.parse(body) as unknown;
      const headerNames: string[] = [];
      new Headers(init.headers).forEach((_value, name) =>
        headerNames.push(name),
      );
      const requestEvidence = {
        endpoint: sanitizeOfficialUrl(url),
        method,
        ...sanitizeGraphqlPayload(requestPayload),
        variables: sanitizedRequestVariables(requestPayload),
        bodySha256: createHash('sha256').update(body).digest('hex'),
        headerNames: headerNames.sort(),
      };
      if (diagnosticPath) {
        const requestArtifact = {
          capturedAt: now().toISOString(),
          ...(justification ? { justification } : {}),
          request: requestEvidence,
          response: null,
        };
        assertSanitizedArtifact(requestArtifact);
        writeAtomicState(diagnosticPath, requestArtifact);
      }
      const response = await fetchImplementation(input, init);
      let responseEvidence: Record<string, unknown> | undefined;
      try {
        const responseText = await readLimitedDiagnosticBody(
          response.clone(),
          init?.signal ?? new AbortController().signal,
        );
        const parsed = JSON.parse(responseText) as unknown;
        responseEvidence = createSanitizedResponseEvidence(
          response.status,
          parsed,
          sensitiveValues,
        );
        if (diagnosticPath) {
          const responseArtifact = {
            capturedAt: now().toISOString(),
            ...(justification ? { justification } : {}),
            request: requestEvidence,
            response: responseEvidence,
          };
          assertSanitizedArtifact(responseArtifact);
          writeAtomicState(diagnosticPath, responseArtifact);
        }
      } catch {
        throw blocked(
          'SHOPEE_OFFICIAL_DIAGNOSTIC_SANITIZATION_FAILED',
          'Resposta nao pode ser sanitizada com seguranca',
        );
      }
      writeAtomicState(statePath, {
        status: 'RESPONSE_RECEIVED',
        receivedAt: now().toISOString(),
        httpStatus: response.status,
        maximumProducts: SHOPEE_AFFILIATE_REAL_READ_LIMIT,
        ...(justification ? { justification } : {}),
        graphqlErrorCodes: responseEvidence.graphqlErrorCodes ?? [],
        ...(responseEvidence.graphqlErrorCount
          ? { applicationErrorCode: 'SHOPEE_API_GRAPHQL_ERROR' }
          : {}),
      });
      return response;
    } catch (error) {
      writeAtomicState(statePath, {
        status: 'REQUEST_OUTCOME_UNKNOWN',
        failedAt: now().toISOString(),
        maximumProducts: SHOPEE_AFFILIATE_REAL_READ_LIMIT,
      });
      throw error;
    }
  }) as OfficialShopeeAffiliateFetch;
};

const redactExactValues = (value: string, sensitiveValues: readonly string[]) =>
  sensitiveValues.reduce(
    (result, sensitive) =>
      sensitive ? result.split(sensitive).join('[REMOVIDO]') : result,
    value,
  );

const publicGraphqlCode = (value: unknown) => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d{1,10}$/.test(value)) return value;
  return null;
};

const sanitizeGraphqlPath = (value: unknown) =>
  Array.isArray(value)
    ? value
        .slice(0, 20)
        .map((part) =>
          typeof part === 'number'
            ? part
            : typeof part === 'string'
              ? sanitizeDocumentationText(part).slice(0, 100)
              : '[REMOVIDO]',
        )
    : null;

export const classifyShopeeGraphqlError = (
  code: string | number | null,
  message: string,
) => {
  const normalizedCode = code === null ? '' : String(code);
  const normalizedMessage = message.toLowerCase();
  if (normalizedCode === '10030') return 'RATE_LIMIT';
  if (normalizedCode === '10010') {
    return /variable/.test(normalizedMessage) ? 'VARIABLES' : 'QUERY';
  }
  if (normalizedCode === '10020') {
    if (/timestamp|expired|clock/.test(normalizedMessage)) return 'TIMESTAMP';
    if (/signature|sign/.test(normalizedMessage)) return 'SIGNATURE';
    return 'AUTHENTICATION';
  }
  if (
    normalizedCode === '11000' ||
    /permission|forbidden|activate/.test(normalizedMessage)
  ) {
    return 'PERMISSION';
  }
  return 'UNCLASSIFIED';
};

const sanitizedGraphqlMessage = (message: string) => {
  const normalized = message.toLowerCase();
  if (/invalid credential/.test(normalized)) return 'Invalid Credential';
  if (/invalid signature/.test(normalized)) return 'Invalid Signature';
  if (/timestamp|expired|clock/.test(normalized)) return 'Invalid Timestamp';
  if (/rate limit|too many request/.test(normalized)) return 'Rate Limit';
  if (/permission|forbidden|activate/.test(normalized)) return 'Permission';
  if (/variable/.test(normalized)) return 'Invalid Variables';
  if (/query/.test(normalized)) return 'Invalid Query';
  return 'GraphQL error message redacted';
};

export const createSanitizedResponseEvidence = (
  httpStatus: number,
  value: unknown,
  sensitiveValues: readonly string[] = [],
) => {
  const envelope =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rawErrors = Array.isArray(envelope.errors) ? envelope.errors : [];
  const errors = rawErrors.slice(0, 20).map((error) => {
    const record =
      error && typeof error === 'object' && !Array.isArray(error)
        ? (error as Record<string, unknown>)
        : {};
    const extensions =
      record.extensions &&
      typeof record.extensions === 'object' &&
      !Array.isArray(record.extensions)
        ? (record.extensions as Record<string, unknown>)
        : {};
    const sanitizedMessage =
      typeof record.message === 'string'
        ? sanitizeDocumentationText(
            redactExactValues(record.message, sensitiveValues),
          ).slice(0, 300)
        : 'Erro GraphQL sem mensagem publica';
    const code = publicGraphqlCode(extensions.code);
    return {
      code,
      path: sanitizeGraphqlPath(record.path),
      message: sanitizedGraphqlMessage(sanitizedMessage),
      classification: classifyShopeeGraphqlError(code, sanitizedMessage),
    };
  });
  const data =
    envelope.data &&
    typeof envelope.data === 'object' &&
    !Array.isArray(envelope.data)
      ? (envelope.data as Record<string, unknown>)
      : undefined;
  const offer =
    data?.productOfferV2 &&
    typeof data.productOfferV2 === 'object' &&
    !Array.isArray(data.productOfferV2)
      ? (data.productOfferV2 as Record<string, unknown>)
      : undefined;
  const nodes = Array.isArray(offer?.nodes)
    ? offer.nodes.slice(0, SHOPEE_AFFILIATE_REAL_READ_LIMIT)
    : [];
  const pageInfo =
    offer?.pageInfo &&
    typeof offer.pageInfo === 'object' &&
    !Array.isArray(offer.pageInfo)
      ? (offer.pageInfo as Record<string, unknown>)
      : {};
  const evidence = {
    httpStatus,
    graphqlErrorCount: errors.length,
    graphqlErrorCodes: errors.flatMap(({ code }) =>
      code === null ? [] : [code],
    ),
    errors,
    dataPresent: Object.prototype.hasOwnProperty.call(envelope, 'data'),
    dataShape: describeJsonShape(envelope.data ?? null),
    nodeCount: nodes.length,
    pageInfoTypes: Object.fromEntries(
      ['page', 'limit', 'hasNextPage', 'scrollId'].map((key) => [
        key,
        typeof pageInfo[key],
      ]),
    ),
    offerLinkPresentCount: nodes.filter(
      (node) =>
        node &&
        typeof node === 'object' &&
        !Array.isArray(node) &&
        typeof (node as Record<string, unknown>).offerLink === 'string' &&
        ((node as Record<string, unknown>).offerLink as string).length > 0,
    ).length,
  };
  assertSanitizedArtifact(evidence);
  return evidence;
};

export const assertSecondReadEligibility = ({
  firstState,
  officialProductCount,
}: {
  firstState: unknown;
  officialProductCount: number;
}) => {
  const state =
    firstState && typeof firstState === 'object' && !Array.isArray(firstState)
      ? (firstState as Record<string, unknown>)
      : {};
  if (
    state.status !== 'RESPONSE_RECEIVED' ||
    state.httpStatus !== 200 ||
    state.applicationErrorCode !== 'SHOPEE_API_GRAPHQL_ERROR'
  ) {
    throw blocked(
      'SHOPEE_OFFICIAL_SECOND_READ_NOT_ELIGIBLE',
      'Primeira tentativa nao comprova HTTP 200 com erro GraphQL',
    );
  }
  if (officialProductCount !== 0) {
    throw blocked(
      'SHOPEE_OFFICIAL_SECOND_READ_PRODUCTS_EXIST',
      'A primeira tentativa persistiu produtos oficiais',
    );
  }
};

export const assertFinalReadEligibility = ({
  secondState,
  officialProductCount,
}: {
  secondState: unknown;
  officialProductCount: number;
}) => {
  const state =
    secondState && typeof secondState === 'object' && !Array.isArray(secondState)
      ? (secondState as Record<string, unknown>)
      : {};
  if (
    state.status !== 'RESPONSE_RECEIVED' ||
    state.httpStatus !== 200 ||
    !Array.isArray(state.graphqlErrorCodes) ||
    !state.graphqlErrorCodes.some((code) => String(code) === '10020')
  ) {
    throw blocked(
      'SHOPEE_OFFICIAL_FINAL_READ_NOT_ELIGIBLE',
      'Segunda tentativa nao comprova HTTP 200 com erro GraphQL 10020',
    );
  }
  if (officialProductCount !== 0) {
    throw blocked(
      'SHOPEE_OFFICIAL_FINAL_READ_PRODUCTS_EXIST',
      'Uma tentativa anterior ja persistiu produtos oficiais',
    );
  }
};

export const assertMappingFixReadEligibility = ({
  finalState,
  finalDiagnostic,
  officialProductCount,
}: {
  finalState: unknown;
  finalDiagnostic: unknown;
  officialProductCount: number;
}) => {
  const state =
    finalState && typeof finalState === 'object' && !Array.isArray(finalState)
      ? (finalState as Record<string, unknown>)
      : {};
  const diagnostic =
    finalDiagnostic &&
    typeof finalDiagnostic === 'object' &&
    !Array.isArray(finalDiagnostic)
      ? (finalDiagnostic as Record<string, unknown>)
      : {};
  const response =
    diagnostic.response &&
    typeof diagnostic.response === 'object' &&
    !Array.isArray(diagnostic.response)
      ? (diagnostic.response as Record<string, unknown>)
      : {};
  if (
    state.status !== 'COMPLETED' ||
    state.fetched !== 5 ||
    state.valid !== 0 ||
    state.created !== 0 ||
    state.updated !== 0 ||
    state.rejected !== 5 ||
    state.realRequests !== 1 ||
    response.httpStatus !== 200 ||
    response.graphqlErrorCount !== 0 ||
    response.nodeCount !== 5 ||
    response.offerLinkPresentCount !== 5
  ) {
    throw blocked(
      'SHOPEE_OFFICIAL_MAPPING_READ_NOT_ELIGIBLE',
      'Tentativa final anterior nao comprova cinco rejeicoes apos resposta valida',
    );
  }
  if (officialProductCount !== 0) {
    throw blocked(
      'SHOPEE_OFFICIAL_MAPPING_READ_PRODUCTS_EXIST',
      'A tentativa final anterior persistiu produtos oficiais',
    );
  }
};

const protectedCountsEqual = (
  before: ProtectedCounts,
  after: ProtectedCounts,
) =>
  (Object.keys(before) as (keyof ProtectedCounts)[]).every(
    (key) => before[key] === after[key],
  );

export const executeShopeeOfficialSync = async ({
  env,
  runtime,
  attempt,
}: {
  env: NodeJS.ProcessEnv;
  runtime: ShopeeOfficialSyncRuntime;
  attempt: ShopeeOfficialReadAttempt;
}): Promise<SanitizedShopeeOfficialSyncReport> => {
  if (env.CI) {
    throw blocked(
      'SHOPEE_OFFICIAL_CI_BLOCKED',
      'Consulta oficial bloqueada em CI',
    );
  }
  await runtime.preflight();
  if (attempt === 'second') {
    assertSecondReadEligibility({
      firstState: runtime.firstReadState(),
      officialProductCount: await runtime.officialProductCount(),
    });
  }
  if (attempt === 'final') {
    assertFinalReadEligibility({
      secondState: runtime.secondReadState(),
      officialProductCount: await runtime.officialProductCount(),
    });
  }
  if (attempt === 'mapping') {
    assertMappingFixReadEligibility({
      finalState: runtime.finalReadState(),
      finalDiagnostic: runtime.finalReadDiagnostic(),
      officialProductCount: await runtime.officialProductCount(),
    });
  }
  const before = await runtime.protectedCounts();
  let report: ShopeeOfferSyncReport;
  try {
    report = await runtime.sync();
  } catch (error) {
    const afterFailure = await runtime.protectedCounts();
    if (!protectedCountsEqual(before, afterFailure)) {
      throw blocked(
        'SHOPEE_OFFICIAL_FORBIDDEN_SIDE_EFFECT',
        'A consulta com falha alterou estado comercial proibido',
      );
    }
    throw error;
  }
  const after = await runtime.protectedCounts();
  if (!protectedCountsEqual(before, after)) {
    throw blocked(
      'SHOPEE_OFFICIAL_FORBIDDEN_SIDE_EFFECT',
      'A consulta alterou estado comercial proibido',
    );
  }
  if (
    report.fetched > SHOPEE_AFFILIATE_REAL_READ_LIMIT ||
    report.valid > SHOPEE_AFFILIATE_REAL_READ_LIMIT ||
    report.created + report.updated > SHOPEE_AFFILIATE_REAL_READ_LIMIT
  ) {
    throw blocked(
      'SHOPEE_OFFICIAL_LIMIT_EXCEEDED',
      'A consulta excedeu o limite controlado',
    );
  }
  if (countShopeeOfferRejections(report.rejectionSummary) !== report.rejected) {
    throw blocked(
      'SHOPEE_OFFICIAL_REJECTION_SUMMARY_INVALID',
      'Resumo sanitizado de rejeicoes inconsistente',
    );
  }
  return {
    fetched: report.fetched,
    valid: report.valid,
    created: report.created,
    updated: report.updated,
    rejected: report.rejected,
    expired: report.expired,
    hasNextPage: report.hasNextPage,
    affiliateLinkPresentCount: report.affiliateLinkPresentCount,
    rejectionSummary: report.rejectionSummary,
    realRequests: 1,
    maximumProducts: SHOPEE_AFFILIATE_REAL_READ_LIMIT,
  };
};

export const createShopeeOfficialSyncRuntime = (
  config: AppEnv,
  attempt: ShopeeOfficialReadAttempt = 'first',
): ShopeeOfficialSyncRuntime => {
  const prisma = createPrismaClient();
  const preflightRuntime = createShopeeOfficialPreflightRuntime(config);
  const attemptConfig = READ_ATTEMPT_CONFIG[attempt];
  const provider = new OfficialShopeeAffiliateOfferProvider({
    apiEnabled: config.SHOPEE_AFFILIATE_API_ENABLED,
    apiUrl: config.SHOPEE_AFFILIATE_API_URL,
    appId: config.SHOPEE_AFFILIATE_APP_ID,
    secret: config.SHOPEE_AFFILIATE_SECRET,
    fetch: createSingleOfficialReadFetch({
      statePath: attemptConfig.statePath,
      ...('diagnosticPath' in attemptConfig
        ? {
            diagnosticPath: attemptConfig.diagnosticPath,
            sensitiveValues: [
              config.SHOPEE_AFFILIATE_APP_ID as string,
              config.SHOPEE_AFFILIATE_SECRET as string,
            ],
            justification: attemptConfig.justification,
          }
        : {}),
    }),
    onObservedContract: (contract) =>
      writeAtomicState(CONTRACT_EVIDENCE_PATH, {
        observedAt: new Date().toISOString(),
        ...contract,
      }),
  });
  const sync = new ShopeeOfferSyncService({
    provider,
    offers: new PrismaShopeeOfferRepository(prisma),
    maxOffersPerSync: SHOPEE_AFFILIATE_REAL_READ_LIMIT,
    logger: {
      info: () => undefined,
      error: () => undefined,
    },
  });
  return {
    async preflight() {
      await executeShopeeOfficialPreflight({
        config,
        runtime: preflightRuntime,
      });
    },
    firstReadState() {
      return readAttemptState('first');
    },
    secondReadState() {
      return readAttemptState('second');
    },
    finalReadState() {
      return readAttemptState('final');
    },
    finalReadDiagnostic() {
      return readFinalDiagnostic();
    },
    async officialProductCount() {
      return prisma.productLead.count({ where: { source: 'OFFICIAL' } });
    },
    async protectedCounts() {
      const [
        commercialPipelineRuns,
        commercialAutomationExecutions,
        whatsappDispatches,
        commercialDispatchOutboxes,
      ] = await prisma.$transaction([
        prisma.commercialPipelineRun.count(),
        prisma.commercialAutomationExecution.count(),
        prisma.whatsAppDispatch.count(),
        prisma.commercialDispatchOutbox.count(),
      ]);
      return {
        commercialPipelineRuns,
        commercialAutomationExecutions,
        whatsappDispatches,
        commercialDispatchOutboxes,
      };
    },
    async sync() {
      return sync.run({ limit: SHOPEE_AFFILIATE_REAL_READ_LIMIT, page: 1 });
    },
    async close() {
      await Promise.allSettled([
        preflightRuntime.close(),
        prisma.$disconnect(),
      ]);
    },
  };
};

const runShopeeOfficialSyncAttempt = async ({
  args = process.argv.slice(2),
  env = process.env,
  runtimeFactory = createShopeeOfficialSyncRuntime,
}: {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  runtimeFactory?: (
    config: AppEnv,
    attempt: ShopeeOfficialReadAttempt,
  ) => ShopeeOfficialSyncRuntime;
} = {}) => {
  if (env.CI) {
    throw blocked(
      'SHOPEE_OFFICIAL_CI_BLOCKED',
      'Consulta oficial bloqueada em CI',
    );
  }
  const attempt = parseShopeeOfficialSyncArgs(args);
  const config = loadShopeeOfficialConfig(env);
  process.env.DATABASE_URL ??= config.DATABASE_URL;
  const runtime = runtimeFactory(config, attempt);
  try {
    return {
      attempt,
      result: await executeShopeeOfficialSync({ env, runtime, attempt }),
    };
  } finally {
    await runtime.close();
  }
};

export const runShopeeOfficialSync = async (
  options: Parameters<typeof runShopeeOfficialSyncAttempt>[0] = {},
) => (await runShopeeOfficialSyncAttempt(options)).result;

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  runShopeeOfficialSyncAttempt()
    .then(({ attempt, result }) => {
      writeAtomicState(
        READ_ATTEMPT_CONFIG[attempt].statePath,
        {
          status: 'COMPLETED',
          completedAt: new Date().toISOString(),
          ...result,
        },
      );
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          completed: false,
          code:
            error instanceof AppError
              ? error.code
              : 'SHOPEE_OFFICIAL_SYNC_FAILED',
        }),
      );
      process.exitCode = 1;
    });
}
