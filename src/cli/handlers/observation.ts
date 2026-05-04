
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { executeWithWorkerFallback, isWorkerFallback } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { shouldTrackProject } from '../../shared/should-track-project.js';
import { normalizePlatformSource } from '../../shared/platform-source.js';
import { ProjectConfigLoader } from '../../config/project-config.js';
import { sanitizeObservation } from '../../config/security-filter.js';

export const observationHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const { sessionId, cwd, toolName, toolInput, toolResponse } = input;
    const platformSource = normalizePlatformSource(input.platform);

    if (!toolName) {
      return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
    }

    const toolStr = logger.formatTool(toolName, toolInput);

    logger.dataIn('HOOK', `PostToolUse: ${toolStr}`, {});

    if (!cwd) {
      throw new Error(`Missing cwd in PostToolUse hook input for session ${sessionId}, tool ${toolName}`);
    }

    if (!shouldTrackProject(cwd)) {
      logger.debug('HOOK', 'Project excluded from tracking, skipping observation', { cwd, toolName });
      return { continue: true, suppressOutput: true };
    }

    // claude-mem-pro: honor per-project capture_mode and apply security filter.
    ProjectConfigLoader.reset();
    ProjectConfigLoader.load(cwd);
    if (ProjectConfigLoader.isManualMode()) {
      logger.debug('HOOK', 'capture_mode=manual — skipping auto observation', { cwd, toolName });
      return { continue: true, suppressOutput: true };
    }

    const filePathFromInput =
      toolInput && typeof toolInput === 'object' && 'file_path' in (toolInput as Record<string, unknown>)
        ? String((toolInput as Record<string, unknown>).file_path)
        : undefined;
    const responseAsString =
      typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse ?? '');
    const sanitized = sanitizeObservation({
      content: responseAsString,
      tool: toolName,
      file: filePathFromInput,
    });
    if (!sanitized) {
      logger.debug('HOOK', 'Observation blocked by security filter', { cwd, toolName, file: filePathFromInput });
      return { continue: true, suppressOutput: true };
    }
    let sanitizedToolResponse: unknown;
    if (typeof toolResponse === 'string') {
      sanitizedToolResponse = sanitized.content;
    } else {
      try {
        sanitizedToolResponse = JSON.parse(sanitized.content);
      } catch {
        // Redaction corrupted JSON structure — use safe empty object rather than
        // falling back to the original unredacted payload.
        sanitizedToolResponse = {};
      }
    }

    const result = await executeWithWorkerFallback<{ status?: string }>(
      '/api/sessions/observations',
      'POST',
      {
        contentSessionId: sessionId,
        platformSource,
        tool_name: toolName,
        tool_input: toolInput,
        tool_response: sanitizedToolResponse,
        cwd,
        agentId: input.agentId,
        agentType: input.agentType,
      },
    );

    if (isWorkerFallback(result)) {
      return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
    }

    logger.debug('HOOK', 'Observation sent successfully', { toolName });
    return { continue: true, suppressOutput: true };
  },
};
