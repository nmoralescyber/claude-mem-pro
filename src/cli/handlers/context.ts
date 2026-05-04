
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import {
  executeWithWorkerFallback,
  isWorkerFallback,
  getWorkerPort,
} from '../../shared/worker-utils.js';
import { getProjectContext } from '../../utils/project-name.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { logger } from '../../utils/logger.js';
import { loadFromFileOnce } from '../../shared/hook-settings.js';
import { readStaleMarker } from '../../shared/oauth-token.js';
import { MemoryManager } from '../../memory/memory-manager.js';
import { ConflictDetector } from '../../conflict-detector/detector.js';

export const contextHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const cwd = input.cwd ?? process.cwd();

    // claude-mem-pro: build file-based hierarchical context (CORE.md + RECENT.md + topics).
    // activeFiles is not available in hook input; pass empty array for now (Phase 3 wires it).
    // Wrapped in try/catch — never blocks the main DB-sourced context injection.
    let proMemoryContext = '';
    try {
      const manager = new MemoryManager(cwd);
      proMemoryContext = manager.buildSessionContext([]);
    } catch (memErr) {
      logger.warn('HOOK', `claude-mem-pro: buildSessionContext failed (non-fatal): ${memErr instanceof Error ? memErr.message : memErr}`);
    }

    // claude-mem-pro: run conflict detector — warns about memory vs spec divergence, never blocks.
    let conflictWarning = '';
    try {
      const detector = new ConflictDetector(cwd);
      const conflicts = detector.detect();
      if (conflicts.length > 0) {
        conflictWarning = ConflictDetector.formatConflicts(conflicts);
        logger.warn('HOOK', `claude-mem-pro: ${conflicts.length} conflict(s) detected at session start`);
      }
    } catch (detectErr) {
      logger.warn('HOOK', `claude-mem-pro: ConflictDetector failed (non-fatal): ${detectErr instanceof Error ? detectErr.message : detectErr}`);
    }

    const context = getProjectContext(cwd);
    const port = getWorkerPort();

    const settings = loadFromFileOnce();
    const showTerminalOutput = settings.CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT === 'true';

    const projectsParam = context.allProjects.join(',');
    const apiPath = `/api/context/inject?projects=${encodeURIComponent(projectsParam)}`;
    const colorApiPath = input.platform === 'claude-code' ? `${apiPath}&colors=true` : apiPath;

    const emptyResult: HookResult = {
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
      exitCode: HOOK_EXIT_CODES.SUCCESS,
    };

    const contextResult = await executeWithWorkerFallback<string>(apiPath, 'GET');
    if (isWorkerFallback(contextResult)) {
      return emptyResult;
    }

    let additionalContext: string;
    if (typeof contextResult === 'string') {
      additionalContext = contextResult.trim();
    } else if (contextResult === undefined) {
      additionalContext = '';
    } else {
      logger.warn('HOOK', 'Context response was not a string', { type: typeof contextResult });
      return emptyResult;
    }

    // claude-mem-pro: prepend file-based memory tier ahead of the DB-sourced context.
    if (proMemoryContext) {
      additionalContext = additionalContext
        ? `${proMemoryContext}\n\n---\n\n${additionalContext}`
        : proMemoryContext;
    }

    // claude-mem-pro: prepend conflict warnings (non-blocking — warn only).
    if (conflictWarning) {
      additionalContext = additionalContext
        ? `${conflictWarning}\n\n---\n\n${additionalContext}`
        : conflictWarning;
    }

    // Issue #2215: surface stale OAuth token marker as a session-start hint.
    // Marker is written by EnvManager.buildIsolatedEnvWithFreshOAuth() when
    // a previous worker spawn detected an expired keychain entry.
    const staleReason = readStaleMarker();
    if (staleReason) {
      const hint = `[claude-mem] Claude Desktop OAuth token is stale: ${staleReason}\nPlease re-login via Claude Desktop to refresh the token.`;
      additionalContext = additionalContext
        ? `${hint}\n\n${additionalContext}`
        : hint;
    }

    let coloredTimeline = '';
    if (showTerminalOutput) {
      const colorResult = await executeWithWorkerFallback<string>(colorApiPath, 'GET');
      if (!isWorkerFallback(colorResult) && typeof colorResult === 'string') {
        coloredTimeline = colorResult.trim();
      }
    }

    const platform = input.platform;

    const displayContent = coloredTimeline || (platform === 'gemini-cli' || platform === 'gemini' ? additionalContext : '');

    const systemMessage = showTerminalOutput && displayContent
      ? `${displayContent}\n\nView Observations Live @ http://localhost:${port}`
      : undefined;

    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext
      },
      systemMessage
    };
  }
};
