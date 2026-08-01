import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';

import {
  buildCommercialAiCopyInput,
  buildCommercialAiCopyInstructions,
  COMMERCIAL_AI_COPY_SCHEMA,
  type CommercialAiCopyFacts,
} from './commercial-ai-copy-prompt';

export type CommercialAiCopyOutput = {
  headline: string;
  body: string;
  cta: string;
  hashtags: string[];
};

export type CommercialAiCopyProviderResult = {
  output: CommercialAiCopyOutput;
  provider: 'openai';
  model: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

export interface CommercialAiCopyProvider {
  generate(
    input: CommercialAiCopyFacts,
  ): Promise<CommercialAiCopyProviderResult>;
}

export type CommercialAiCopyProviderFailureKind =
  'NOT_STARTED' | 'FAILED_CONFIRMED' | 'AMBIGUOUS';

export class CommercialAiCopyProviderError extends Error {
  constructor(
    readonly kind: CommercialAiCopyProviderFailureKind,
    readonly publicCode: string,
  ) {
    super(publicCode);
    this.name = 'CommercialAiCopyProviderError';
  }
}

type ResponseLike = {
  status?: string;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string }> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | null;
};

export type OpenAiResponsesClient = {
  responses: {
    create(input: ResponseCreateParamsNonStreaming): Promise<ResponseLike>;
  };
};

export type OpenAiCommercialAiCopyProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  client?: OpenAiResponsesClient;
};

const hasRefusal = (response: ResponseLike) =>
  response.output?.some(
    (item) =>
      item.type === 'message' &&
      item.content?.some((content) => content.type === 'refusal'),
  ) ?? false;

export class OpenAiCommercialAiCopyProvider implements CommercialAiCopyProvider {
  private readonly client: OpenAiResponsesClient;

  constructor(private readonly options: OpenAiCommercialAiCopyProviderOptions) {
    this.client =
      options.client ??
      (new OpenAI({
        apiKey: options.apiKey,
        maxRetries: 0,
        timeout: options.timeoutMs,
      }) as OpenAiResponsesClient);
  }

  async generate(
    input: CommercialAiCopyFacts,
  ): Promise<CommercialAiCopyProviderResult> {
    let requestStarted = false;
    try {
      const request: ResponseCreateParamsNonStreaming = {
        model: this.options.model,
        instructions: buildCommercialAiCopyInstructions(),
        input: buildCommercialAiCopyInput(input),
        max_output_tokens: this.options.maxOutputTokens,
        store: false,
        stream: false,
        background: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'commercial_promotion_copy',
            strict: true,
            schema: COMMERCIAL_AI_COPY_SCHEMA,
          },
        },
      };
      requestStarted = true;
      const response = await this.client.responses.create(request);
      if (response.status !== 'completed' || hasRefusal(response)) {
        throw new CommercialAiCopyProviderError(
          'FAILED_CONFIRMED',
          response.status === 'incomplete'
            ? 'COMMERCIAL_AI_COPY_PROVIDER_INCOMPLETE'
            : 'COMMERCIAL_AI_COPY_PROVIDER_REFUSED',
        );
      }
      let output: CommercialAiCopyOutput;
      try {
        output = JSON.parse(
          response.output_text ?? '',
        ) as CommercialAiCopyOutput;
      } catch {
        throw new CommercialAiCopyProviderError(
          'FAILED_CONFIRMED',
          'COMMERCIAL_AI_COPY_PROVIDER_OUTPUT_INVALID',
        );
      }
      return {
        output,
        provider: 'openai',
        model: this.options.model,
        usage: {
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
          totalTokens: response.usage?.total_tokens ?? null,
        },
      };
    } catch (error) {
      if (error instanceof CommercialAiCopyProviderError) throw error;
      if (
        error instanceof APIUserAbortError ||
        error instanceof APIConnectionTimeoutError ||
        error instanceof APIConnectionError
      ) {
        throw new CommercialAiCopyProviderError(
          requestStarted ? 'AMBIGUOUS' : 'NOT_STARTED',
          requestStarted
            ? 'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS'
            : 'COMMERCIAL_AI_COPY_PROVIDER_NOT_STARTED',
        );
      }
      if (error instanceof APIError) {
        throw new CommercialAiCopyProviderError(
          'FAILED_CONFIRMED',
          'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
        );
      }
      throw new CommercialAiCopyProviderError(
        requestStarted ? 'AMBIGUOUS' : 'NOT_STARTED',
        requestStarted
          ? 'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS'
          : 'COMMERCIAL_AI_COPY_PROVIDER_NOT_STARTED',
      );
    }
  }
}
