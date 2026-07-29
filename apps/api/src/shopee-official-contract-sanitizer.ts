export const SENSITIVE_NAME_SOURCE =
  '(secret|signature|authorization|token|credential|appid|app_id|access|cookie|set-cookie)';

const SENSITIVE_NAME = new RegExp(SENSITIVE_NAME_SOURCE, 'i');

const REDACTED = '[REMOVIDO]' as const;

const MAX_TEXT_LENGTH = 500_000;

export const SHOPEE_OFFICIAL_CAPTURE_HOSTS = new Set([
  'affiliate.shopee.com.br',
  'open-api.affiliate.shopee.com.br',
]);

export const isSensitiveName = (value: string) => SENSITIVE_NAME.test(value);

export const sanitizeOfficialUrl = (value: string) => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    !SHOPEE_OFFICIAL_CAPTURE_HOSTS.has(url.hostname)
  ) {
    throw new Error('SHOPEE_CAPTURE_NON_OFFICIAL_HOST');
  }
  return `${url.protocol}//${url.host}${url.pathname}`;
};

const redactNamedValues = (value: string) =>
  value
    .replace(
      /\b(secret|signature|authorization|token|credential|appid|app_id|access(?:_token)?|cookie|set-cookie)\b\s*([:=])\s*([^\s,;"'}]+)/gi,
      (_match, name: string, separator: string) =>
        `${name}${separator}${REDACTED}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/\b[0-9a-f]{48,}\b/gi, REDACTED);

export const sanitizeDocumentationText = (value: string) => {
  const sanitized = redactNamedValues(value)
    .replace(/https?:\/\/[^\s)\]}>"']+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        return SHOPEE_OFFICIAL_CAPTURE_HOSTS.has(url.hostname)
          ? `${url.protocol}//${url.host}${url.pathname}`
          : '[URL_REMOVIDA]';
      } catch {
        return '[URL_REMOVIDA]';
      }
    })
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return sanitized.slice(0, MAX_TEXT_LENGTH);
};

export const sanitizeCapturedValue = (value: unknown, key = ''): unknown => {
  if (key && isSensitiveName(key)) return REDACTED;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeCapturedValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeCapturedValue(entryValue, entryKey),
      ]),
    );
  }
  if (typeof value === 'string') return redactNamedValues(value);
  return value;
};

export const describeJsonShape = (value: unknown, key = ''): unknown => {
  if (key && isSensitiveName(key)) return REDACTED;
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [describeJsonShape(value[0])];
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        describeJsonShape(entryValue, entryKey),
      ]),
    );
  }
  return typeof value;
};

export const sanitizeGraphqlPayload = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SHOPEE_CAPTURE_GRAPHQL_BODY_INVALID');
  }
  const body = value as Record<string, unknown>;
  const query = typeof body.query === 'string' ? body.query.trim() : undefined;
  if (!query || !/\bproductOfferV2\b/.test(query)) {
    throw new Error('SHOPEE_CAPTURE_PRODUCT_OFFER_QUERY_REQUIRED');
  }
  if (query.length > 100_000) {
    throw new Error('SHOPEE_CAPTURE_GRAPHQL_QUERY_TOO_LARGE');
  }
  return {
    operationName:
      typeof body.operationName === 'string'
        ? sanitizeDocumentationText(body.operationName)
        : null,
    query: redactNamedValues(query),
    variables: describeJsonShape(body.variables ?? {}),
  };
};

const sanitizedGraphqlCode = (extensions: unknown) => {
  if (
    !extensions ||
    typeof extensions !== 'object' ||
    Array.isArray(extensions)
  ) {
    return null;
  }
  const code = (extensions as { code?: unknown }).code;
  if (typeof code === 'number' && Number.isSafeInteger(code)) return code;
  if (typeof code === 'string' && /^\d{1,10}$/.test(code)) return code;
  return code === undefined ? null : REDACTED;
};

export const extractGraphqlErrors = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const errors = (value as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 20).map((error) => {
    if (!error || typeof error !== 'object' || Array.isArray(error)) {
      return { message: 'Erro GraphQL sem estrutura' };
    }
    const record = error as Record<string, unknown>;
    return {
      messageType: typeof record.message,
      path: describeJsonShape(record.path ?? null),
      code: sanitizedGraphqlCode(record.extensions),
      extensionsSchema: describeJsonShape(record.extensions ?? {}),
    };
  });
};

export const assertSanitizedArtifact = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const unsafePatterns = [
    /\bBearer\s+(?!\[REMOVIDO\])/i,
    /\b(secret|signature|authorization|token|credential|appid|app_id|access(?:_token)?|cookie|set-cookie)\b\s*[:=]\s*(?!\[REMOVIDO\])[^\s,;"'}]+/i,
  ];
  if (unsafePatterns.some((pattern) => pattern.test(serialized))) {
    throw new Error('SHOPEE_CAPTURE_SANITIZATION_UNCERTAIN');
  }
};
