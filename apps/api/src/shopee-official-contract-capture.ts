import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  BrowserContext,
  Page,
  Request,
  Response,
  Route,
} from 'playwright-core';
import { chromium } from 'playwright-core';
import {
  SHOPEE_OFFICIAL_CAPTURE_HOSTS,
  SENSITIVE_NAME_SOURCE,
  assertSanitizedArtifact,
  describeJsonShape,
  extractGraphqlErrors,
  sanitizeDocumentationText,
  sanitizeGraphqlPayload,
  sanitizeOfficialUrl,
} from './shopee-official-contract-sanitizer';

const DOCUMENTATION_URL = 'https://affiliate.shopee.com.br/open_api/document';
const EXPLORER_URL = 'https://open-api.affiliate.shopee.com.br/explorer/v2';
const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const OUTPUT_DIRECTORY = '.runtime/shopee-official-contract';
const MAX_RESPONSE_BYTES = 1_000_000;

type CapturedGraphqlRequest = {
  url: string;
  method: string;
  contentType: string | null;
  headerNames: string[];
  payload: ReturnType<typeof sanitizeGraphqlPayload>;
  blockedBeforeNetwork: true;
};

type CapturedResponse = {
  url: string;
  status: number;
  contentType: string | null;
  schema: unknown;
  graphqlErrors: ReturnType<typeof extractGraphqlErrors>;
};

type CaptureArtifacts = {
  documentation: string;
  graphqlRequests: CapturedGraphqlRequest[];
  responses: CapturedResponse[];
  transport: {
    officialHosts: string[];
    observedUrls: string[];
    methods: string[];
    contentTypes: string[];
    headerNames: string[];
    graphqlPostsBlockedBeforeNetwork: number;
  };
  summary: {
    completedAt: string;
    documentationSections: number;
    graphqlRequestsCaptured: number;
    responsesCaptured: number;
    realGraphqlRequestsPerformed: 0;
    sensitiveCredentialCollision: false;
    outputDirectory: typeof OUTPUT_DIRECTORY;
  };
};

const isOfficialCaptureUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      SHOPEE_OFFICIAL_CAPTURE_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
};

const isGraphqlPost = (request: Request) => {
  try {
    const url = new URL(request.url());
    return (
      SHOPEE_OFFICIAL_CAPTURE_HOSTS.has(url.hostname) &&
      request.method() === 'POST' &&
      /graphql/i.test(url.pathname)
    );
  } catch {
    return false;
  }
};

const writeAtomicJson = (path: string, value: unknown) => {
  assertSanitizedArtifact(value);
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporary, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows preserva a ACL local; nenhum fallback amplia permissões.
  }
};

const writeAtomicText = (path: string, value: string) => {
  assertSanitizedArtifact(value);
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.tmp`,
  );
  writeFileSync(temporary, `${value.trim()}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporary, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows preserva a ACL local; nenhum fallback amplia permissões.
  }
};

export const assertCaptureDirectoryIgnored = (root: string) => {
  const probe = `${OUTPUT_DIRECTORY}/documentation.txt`;
  const result = spawnSync('git', ['check-ignore', '--quiet', probe], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error('SHOPEE_CAPTURE_DIRECTORY_NOT_IGNORED');
  }
};

const readRenderedText = async (page: Page) => {
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  return sanitizeDocumentationText(text);
};

const credentialCollisionExists = async (
  page: Page,
  serializedArtifacts: string,
) =>
  page.evaluate(
    ({ captured, sensitiveNameSource }) => {
      const sensitive = new RegExp(sensitiveNameSource, 'i');
      return Array.from(document.querySelectorAll('input')).some((element) => {
        const metadata = [
          element.getAttribute('name'),
          element.getAttribute('id'),
          element.getAttribute('placeholder'),
          element.getAttribute('aria-label'),
          element.getAttribute('autocomplete'),
        ]
          .filter(Boolean)
          .join(' ');
        if (!sensitive.test(metadata)) return false;
        const value = (element as HTMLInputElement).value;
        return value.length > 0 && captured.includes(value);
      });
    },
    {
      captured: serializedArtifacts,
      sensitiveNameSource: SENSITIVE_NAME_SOURCE,
    },
  );

const captureGraphqlRequest = async (
  request: Request,
): Promise<CapturedGraphqlRequest | null> => {
  const raw = request.postData();
  if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const headers = request.headers();
  return {
    url: sanitizeOfficialUrl(request.url()),
    method: request.method(),
    contentType: headers['content-type'] ?? null,
    headerNames: Object.keys(headers)
      .map((name) => name.toLocaleLowerCase())
      .sort(),
    payload: sanitizeGraphqlPayload(parsed),
    blockedBeforeNetwork: true,
  };
};

const captureResponse = async (
  response: Response,
): Promise<CapturedResponse | null> => {
  if (!isOfficialCaptureUrl(response.url())) return null;
  const headers = response.headers();
  const contentType = headers['content-type'] ?? null;
  if (!contentType?.toLocaleLowerCase().includes('application/json')) {
    return null;
  }
  const declaredLength = Number(headers['content-length'] ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) return null;
  const body = await response.body();
  if (body.byteLength > MAX_RESPONSE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
  return {
    url: sanitizeOfficialUrl(response.url()),
    status: response.status(),
    contentType,
    schema: describeJsonShape(parsed),
    graphqlErrors: extractGraphqlErrors(parsed),
  };
};

const createArtifacts = (input: {
  documentation: Set<string>;
  requests: CapturedGraphqlRequest[];
  responses: CapturedResponse[];
}): CaptureArtifacts => {
  const documentation = [...input.documentation]
    .filter(Boolean)
    .join(
      '\n\n============================================================\n\n',
    );
  const headerNames = new Set<string>();
  const methods = new Set<string>();
  const contentTypes = new Set<string>();
  const observedUrls = new Set<string>();
  for (const request of input.requests) {
    request.headerNames.forEach((name) => headerNames.add(name));
    methods.add(request.method);
    observedUrls.add(request.url);
    if (request.contentType) contentTypes.add(request.contentType);
  }
  for (const response of input.responses) {
    observedUrls.add(response.url);
    if (response.contentType) contentTypes.add(response.contentType);
  }
  return {
    documentation,
    graphqlRequests: input.requests,
    responses: input.responses,
    transport: {
      officialHosts: [...SHOPEE_OFFICIAL_CAPTURE_HOSTS].sort(),
      observedUrls: [...observedUrls].sort(),
      methods: [...methods].sort(),
      contentTypes: [...contentTypes].sort(),
      headerNames: [...headerNames].sort(),
      graphqlPostsBlockedBeforeNetwork: input.requests.length,
    },
    summary: {
      completedAt: new Date().toISOString(),
      documentationSections: input.documentation.size,
      graphqlRequestsCaptured: input.requests.length,
      responsesCaptured: input.responses.length,
      realGraphqlRequestsPerformed: 0,
      sensitiveCredentialCollision: false,
      outputDirectory: OUTPUT_DIRECTORY,
    },
  };
};

const persistArtifacts = (root: string, artifacts: CaptureArtifacts) => {
  const output = resolve(root, OUTPUT_DIRECTORY);
  mkdirSync(output, { recursive: true, mode: 0o700 });
  writeAtomicText(join(output, 'documentation.txt'), artifacts.documentation);
  writeAtomicJson(join(output, 'graphql-request.sanitized.json'), {
    requests: artifacts.graphqlRequests,
  });
  writeAtomicJson(join(output, 'graphql-response-schema.sanitized.json'), {
    responses: artifacts.responses,
  });
  writeAtomicJson(
    join(output, 'transport-contract.sanitized.json'),
    artifacts.transport,
  );
  writeAtomicJson(join(output, 'capture-summary.json'), artifacts.summary);
};

const safelyRemoveTemporaryProfile = (profile: string) => {
  const resolvedProfile = resolve(profile);
  const resolvedTemp = `${resolve(tmpdir())}\\`;
  if (
    !resolvedProfile
      .toLocaleLowerCase()
      .startsWith(resolvedTemp.toLocaleLowerCase())
  ) {
    throw new Error('SHOPEE_CAPTURE_TEMP_PROFILE_UNSAFE');
  }
  rmSync(resolvedProfile, { recursive: true, force: true });
};

const installNetworkGuards = (
  context: BrowserContext,
  requests: CapturedGraphqlRequest[],
  track: (operation: Promise<void>) => void,
) =>
  context.route('**/*', async (route: Route) => {
    const request = route.request();
    if (isGraphqlPost(request)) {
      const capture = captureGraphqlRequest(request)
        .then((entry) => {
          if (entry) requests.push(entry);
        })
        .catch(() => undefined);
      track(capture);
      await route.abort('blockedbyclient');
      return;
    }
    if (!isOfficialCaptureUrl(request.url())) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

export const runShopeeOfficialContractCapture = async (
  root = REPOSITORY_ROOT,
) => {
  if (process.env.CI) throw new Error('SHOPEE_CAPTURE_BLOCKED_IN_CI');
  if (process.argv.slice(2).length > 0) {
    throw new Error('SHOPEE_CAPTURE_ARGUMENTS_NOT_ALLOWED');
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('SHOPEE_CAPTURE_INTERACTIVE_TERMINAL_REQUIRED');
  }
  assertCaptureDirectoryIgnored(root);

  const profile = mkdtempSync(join(tmpdir(), 'shopee-official-capture-'));
  const requests: CapturedGraphqlRequest[] = [];
  const responses: CapturedResponse[] = [];
  const documentation = new Map<Page, string>();
  const pending = new Set<Promise<void>>();
  let context: BrowserContext | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let documentationPoll: Promise<void> | undefined;
  let responseHandler: ((response: Response) => void) | undefined;
  const track = (operation: Promise<void>) => {
    const tracked = operation.finally(() => pending.delete(tracked));
    pending.add(tracked);
  };
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: false,
      acceptDownloads: false,
    });
    await installNetworkGuards(context, requests, track);
    const documentationPage = await context.newPage();
    const explorerPage = await context.newPage();
    await documentationPage.goto(DOCUMENTATION_URL, {
      waitUntil: 'domcontentloaded',
    });
    await explorerPage.goto(EXPLORER_URL, { waitUntil: 'domcontentloaded' });

    process.stdout.write(
      'Navegador temporario aberto somente para evidencia oficial.\n' +
        'Digite as credenciais apenas nos campos oficiais. Nao clique em uma chamada real.\n' +
        'Abra autenticacao/assinatura no documento e productOfferV2 no Explorer.\n',
    );
    await terminal.question(
      'Quando as paginas estiverem prontas, pressione ENTER para iniciar a captura sanitizada: ',
    );

    responseHandler = (response: Response) => {
      const capture = captureResponse(response)
        .then((entry) => {
          if (entry) responses.push(entry);
        })
        .catch(() => undefined);
      track(capture);
    };
    context.on('response', responseHandler);

    const collectDocumentation = async () => {
      for (const page of [documentationPage, explorerPage]) {
        const text = await readRenderedText(page).catch(() => '');
        if (text) documentation.set(page, text);
      }
    };
    await collectDocumentation();
    poll = setInterval(() => {
      if (documentationPoll) return;
      documentationPoll = collectDocumentation()
        .catch(() => undefined)
        .finally(() => {
          documentationPoll = undefined;
        });
      track(documentationPoll);
    }, 1_000);

    process.stdout.write(
      'Captura ativa. Navegue pelas secoes solicitadas. No Explorer, gerar/Enviar e bloqueado antes da rede, mas permite capturar a requisicao sanitizada.\n',
    );
    await terminal.question(
      'Quando terminar a navegacao, volte a este terminal e pressione ENTER: ',
    );
    clearInterval(poll);
    poll = undefined;
    await collectDocumentation();
    await Promise.allSettled([...pending]);
    context.off('response', responseHandler);
    responseHandler = undefined;

    const artifacts = createArtifacts({
      documentation: new Set(documentation.values()),
      requests,
      responses,
    });
    assertSanitizedArtifact(artifacts);
    const serialized = JSON.stringify(artifacts);
    const collisions = await Promise.all([
      credentialCollisionExists(documentationPage, serialized),
      credentialCollisionExists(explorerPage, serialized),
    ]);
    if (collisions.some(Boolean)) {
      throw new Error('SHOPEE_CAPTURE_CREDENTIAL_COLLISION');
    }
    persistArtifacts(root, artifacts);
    process.stdout.write(
      `Captura concluida: secoes=${artifacts.summary.documentationSections}, requisicoes_graphql_bloqueadas=${artifacts.summary.graphqlRequestsCaptured}, chamadas_reais=0.\n`,
    );
  } finally {
    if (poll) clearInterval(poll);
    if (responseHandler) context?.off('response', responseHandler);
    terminal.close();
    await context?.close().catch(() => undefined);
    safelyRemoveTemporaryProfile(profile);
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  runShopeeOfficialContractCapture().catch((error: unknown) => {
    const code =
      error instanceof Error ? error.message : 'SHOPEE_CAPTURE_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
