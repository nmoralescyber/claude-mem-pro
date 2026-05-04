/**
 * claude-mem-pro: Security filter
 * Second defense layer — blocks sensitive content at the observation level
 * Works alongside existing src/utils/tag-stripping.ts
 */

import { ProjectConfigLoader } from './project-config.js';

const ALWAYS_REDACT: RegExp[] = [
  // AWS access key ID
  /AKIA[A-Z0-9]{16}/g,
  // AWS secret access key (env-var name prefix makes this low false-positive risk)
  /(?:aws[_-]?secret[_-]?access[_-]?key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?([A-Za-z0-9\/+=]{40})/gi,
  // Generic secret/api key patterns
  /(?:secret[_-]?(?:access[_-]?)?key|api[_-]?secret)\s*[:=]\s*['"]?([A-Za-z0-9\/+]{20,})/gi,
  // JWT tokens
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  // PEM private key blocks
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9._~+\-]+=*/gi,
  // Anthropic API keys (most critical for this plugin)
  /sk-ant-api\d{2}-[A-Za-z0-9_-]{40,}/g,
  // OpenAI API keys
  /sk-(?:proj-)?[A-Za-z0-9]{48}/g,
  // GitHub personal access tokens (classic and fine-grained)
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
];

const REDACTION_PLACEHOLDER = '[REDACTED-SENSITIVE-DATA]';

export function filterSensitiveContent(content: string, sourcePath?: string): string | null {
  if (sourcePath && ProjectConfigLoader.isBlocked(sourcePath)) {
    return null;
  }

  let filtered = content;
  for (const pattern of ALWAYS_REDACT) {
    filtered = filtered.replace(pattern, REDACTION_PLACEHOLDER);
  }
  return filtered;
}

export function sanitizeObservation(observation: {
  content: string;
  tool?: string;
  file?: string;
}): { content: string; tool?: string; file?: string } | null {
  const filtered = filterSensitiveContent(observation.content, observation.file);
  if (filtered === null) {
    return null;
  }
  return { ...observation, content: filtered };
}
