import { pathToFileURL } from 'node:url';

import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import {
  createWhatsAppProvider,
  maskEvolutionDestination,
  normalizeEvolutionDestination,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';

export const EVOLUTION_REAL_SEND_FLAG = '--confirm-one-real-message';
export const EVOLUTION_TEST_MESSAGE =
  'Teste controlado do sistema Afiliado Shopee. Nenhuma ação é necessária.';

type EvolutionTestLogger = {
  info(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
};

type EvolutionTestProviderFactory = (config: AppEnv) => WhatsAppProvider;

type EvolutionTestOptions = {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  logger?: EvolutionTestLogger;
  providerFactory?: EvolutionTestProviderFactory;
};

export type EvolutionTestDryRunOutput = {
  mode: 'dry-run';
  provider: 'evolution';
  safeMode: true;
  destination: string;
  maxMessagesPerBoot: 1;
  schedulerEnabled: false;
  messageWillBeSent: false;
};

export type EvolutionTestSuccessOutput = {
  status: 'sent';
  externalMessageId: string;
  sentAt: string;
  destination: string;
};

export type EvolutionTestFailureOutput = {
  code: string;
  message: string;
  destination?: string;
};

export type EvolutionTestRunResult =
  | { exitCode: 0; output: EvolutionTestDryRunOutput }
  | { exitCode: 0; output: EvolutionTestSuccessOutput }
  | { exitCode: 1; output: EvolutionTestFailureOutput };

const consoleLogger: EvolutionTestLogger = {
  info: (data) => console.log(JSON.stringify(data)),
  error: (data) => console.error(JSON.stringify(data)),
};

class EvolutionTestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const isCiActive = (value: string | undefined) =>
  value !== undefined &&
  value.trim() !== '' &&
  value.trim().toLowerCase() !== 'false';

const validateExecutionMode = (args: readonly string[]) => {
  if (args.length === 0) return 'dry-run' as const;
  if (args.length === 1 && args[0] === EVOLUTION_REAL_SEND_FLAG) {
    return 'confirmed' as const;
  }
  throw new EvolutionTestError(
    'Flag invalida para o teste isolado da Evolution API',
    'EVOLUTION_TEST_FLAG_INVALID',
  );
};

const validateTestConfig = (config: AppEnv) => {
  if (config.WHATSAPP_PROVIDER !== 'evolution') {
    throw new EvolutionTestError(
      'O teste isolado exige WHATSAPP_PROVIDER=evolution',
      'EVOLUTION_TEST_PROVIDER_REQUIRED',
    );
  }
  if (!config.EVOLUTION_SAFE_MODE) {
    throw new EvolutionTestError(
      'O teste isolado exige EVOLUTION_SAFE_MODE=true',
      'EVOLUTION_TEST_SAFE_MODE_REQUIRED',
    );
  }
  if (config.SCHEDULER_ENABLED) {
    throw new EvolutionTestError(
      'O teste isolado exige SCHEDULER_ENABLED=false',
      'EVOLUTION_TEST_SCHEDULER_MUST_BE_DISABLED',
    );
  }
  if (config.EVOLUTION_ALLOWED_DESTINATIONS.length !== 1) {
    throw new EvolutionTestError(
      'O teste isolado exige exatamente um destino permitido',
      'EVOLUTION_TEST_SINGLE_DESTINATION_REQUIRED',
    );
  }
  if (config.EVOLUTION_MAX_MESSAGES_PER_BOOT !== 1) {
    throw new EvolutionTestError(
      'O teste isolado exige EVOLUTION_MAX_MESSAGES_PER_BOOT=1',
      'EVOLUTION_TEST_LIMIT_MUST_BE_ONE',
    );
  }

  const destination = config.EVOLUTION_ALLOWED_DESTINATIONS[0];
  const normalizedDestination = normalizeEvolutionDestination(destination);
  return {
    destination,
    maskedDestination: maskEvolutionDestination(normalizedDestination),
  };
};

const safeFailure = (
  error: unknown,
  destination?: string,
  sendStarted = false,
): EvolutionTestFailureOutput => {
  if (error instanceof EvolutionTestError) {
    return {
      code: error.code,
      message: error.message,
      ...(destination ? { destination } : {}),
    };
  }

  if (error instanceof Error && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string' && code.startsWith('EVOLUTION_')) {
      return {
        code,
        message: 'Falha segura no envio isolado da Evolution API',
        ...(destination ? { destination } : {}),
      };
    }
  }

  return {
    code: sendStarted
      ? 'EVOLUTION_TEST_SEND_FAILED'
      : 'EVOLUTION_TEST_CONFIG_INVALID',
    message: sendStarted
      ? 'Falha segura no envio isolado da Evolution API'
      : 'Configuracao invalida para o teste isolado da Evolution API',
    ...(destination ? { destination } : {}),
  };
};

export const runEvolutionSingleMessageTest = async (
  options: EvolutionTestOptions = {},
): Promise<EvolutionTestRunResult> => {
  const args = options.args ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const logger = options.logger ?? consoleLogger;
  const providerFactory =
    options.providerFactory ??
    ((config: AppEnv) => createWhatsAppProvider(config));
  let maskedDestination: string | undefined;
  let sendStarted = false;

  try {
    if (isCiActive(env.CI)) {
      throw new EvolutionTestError(
        'O teste isolado da Evolution API nao pode executar em CI',
        'EVOLUTION_TEST_CI_BLOCKED',
      );
    }

    const mode = validateExecutionMode(args);
    const config = loadConfig(env);
    const destinationConfig = validateTestConfig(config);
    maskedDestination = destinationConfig.maskedDestination;
    const provider = providerFactory(config);

    if (mode === 'dry-run') {
      const output: EvolutionTestDryRunOutput = {
        mode: 'dry-run',
        provider: 'evolution',
        safeMode: true,
        destination: maskedDestination,
        maxMessagesPerBoot: 1,
        schedulerEnabled: false,
        messageWillBeSent: false,
      };
      logger.info({ event: 'evolution.test.dry-run', ...output });
      return { exitCode: 0, output };
    }

    logger.info({
      event: 'evolution.test.confirmed',
      destination: maskedDestination,
      messageWillBeSent: true,
    });
    sendStarted = true;
    const result = await provider.sendMessage({
      destination: destinationConfig.destination,
      message: EVOLUTION_TEST_MESSAGE,
    });
    const output: EvolutionTestSuccessOutput = {
      status: result.status,
      externalMessageId: result.externalMessageId,
      sentAt: result.sentAt.toISOString(),
      destination: maskedDestination,
    };
    logger.info({ event: 'evolution.test.succeeded', ...output });
    return { exitCode: 0, output };
  } catch (error) {
    const output = safeFailure(error, maskedDestination, sendStarted);
    logger.error({
      event: sendStarted ? 'evolution.test.failed' : 'evolution.test.blocked',
      ...output,
    });
    return { exitCode: 1, output };
  }
};

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const result = await runEvolutionSingleMessageTest();
  process.exitCode = result.exitCode;
}
