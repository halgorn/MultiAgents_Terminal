export class WebhookValidationError extends Error {
  readonly code = 'WEBHOOK_VALIDATION_FAILED';
  constructor(message: string, public readonly url: string) {
    super(message);
    this.name = 'WebhookValidationError';
  }
}

const PRIVATE_IPV4_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\.0\.0\.0$/,
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./,
];

const PRIVATE_IPV6_PATTERNS = [
  /^::1$/,
  /^::$/,
  /^fe[89ab][0-9a-f]:/i,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
];

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

export interface WebhookGuardOptions {
  allowPrivate?: boolean;
  allowHttp?: boolean;
  allowedHosts?: readonly string[];
}

export function validateWebhookUrl(url: string, opts: WebhookGuardOptions = {}): URL {
  if (!url || typeof url !== 'string') {
    throw new WebhookValidationError('Webhook URL must be a non-empty string', String(url));
  }
  if (url.length > 2048) {
    throw new WebhookValidationError('Webhook URL exceeds maximum length', url);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookValidationError('Webhook URL is not a valid URL', url);
  }

  const allowHttp = opts.allowHttp === true;
  if (!allowHttp && parsed.protocol === 'http:') {
    if (!isPrivateHostname(parsed.hostname) && !isPrivateIp(parsed.hostname)) {
      throw new WebhookValidationError(
        'Webhook URL must use HTTPS (set --allow-insecure-webhook to override)',
        url,
      );
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebhookValidationError(
      `Webhook URL must use http or https protocol (got ${parsed.protocol})`,
      url,
    );
  }

  if (parsed.username || parsed.password) {
    throw new WebhookValidationError('Webhook URL must not contain credentials', url);
  }

  if (opts.allowedHosts && opts.allowedHosts.length > 0) {
    if (!opts.allowedHosts.includes(parsed.hostname)) {
      throw new WebhookValidationError(
        `Webhook host ${parsed.hostname} not in allowlist`,
        url,
      );
    }
  }

  if (!opts.allowPrivate) {
    if (isPrivateHostname(parsed.hostname)) {
      throw new WebhookValidationError(
        `Webhook URL targets private hostname: ${parsed.hostname}`,
        url,
      );
    }
    if (isPrivateIp(parsed.hostname)) {
      throw new WebhookValidationError(
        `Webhook URL targets private IP: ${parsed.hostname}`,
        url,
      );
    }
  }

  return parsed;
}

export function isPrivateIp(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOSTNAMES.has(h)) return true;
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(h)) return true;
  }
  for (const pattern of PRIVATE_IPV6_PATTERNS) {
    if (pattern.test(h)) return true;
  }
  return false;
}

export function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_HOSTNAMES.has(hostname.toLowerCase());
}

export function sanitizeWebhookPayload<T extends Record<string, unknown>>(payload: T): T {
  if (payload == null || typeof payload !== 'object') return payload;
  const STRIPPED_KEYS = new Set([
    'reportHtml',
    'report_html',
    'html',
    'rawContent',
    'raw_content',
    'fileContents',
    'file_contents',
    'diff',
    'fullDiff',
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (STRIPPED_KEYS.has(key)) {
      result[key] = '[stripped — payload size > 100KB]';
      continue;
    }
    if (typeof value === 'string' && value.length > 100_000) {
      result[key] = '[stripped — field too large]';
      continue;
    }
    result[key] = value;
  }
  return result as T;
}