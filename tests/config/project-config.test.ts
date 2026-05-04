import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectConfigLoader } from '../../src/config/project-config.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-mem-pro-test-'));
}

describe('ProjectConfigLoader', () => {
  let tmpDir: string;

  beforeEach(() => {
    ProjectConfigLoader.reset();
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    ProjectConfigLoader.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads default config when no .claude-mem.json exists', () => {
    const config = ProjectConfigLoader.load(tmpDir);

    expect(config.project).toBe('unnamed-project');
    expect(config.capture_mode).toBe('auto');
    expect(config.max_inject_tokens).toBe(6000);
    expect(config.session_summary_model).toBe('claude-haiku-4-5');
    expect(config.spec_files).toEqual([]);
    expect(config.never_capture).toContain('**/.env');
  });

  it('merges user config correctly over defaults', () => {
    const userConfig = {
      project: 'pr-capital-engine',
      capture_mode: 'manual' as const,
      max_inject_tokens: 4000,
      session_summary_model: 'claude-haiku-4-5-20251001',
      never_capture: ['**/trading-bot-key*'],
      spec_files: ['TRADING_AGENT_SPEC.md'],
      topic_triggers: { 'strategies/orb_strategy.py': 'topics/orb.md' },
    };
    fs.writeFileSync(path.join(tmpDir, '.claude-mem.json'), JSON.stringify(userConfig));

    const config = ProjectConfigLoader.load(tmpDir);

    expect(config.project).toBe('pr-capital-engine');
    expect(config.capture_mode).toBe('manual');
    expect(config.max_inject_tokens).toBe(4000);
    expect(config.session_summary_model).toBe('claude-haiku-4-5-20251001');
    expect(config.spec_files).toEqual(['TRADING_AGENT_SPEC.md']);
    expect(config.topic_triggers['strategies/orb_strategy.py']).toBe('topics/orb.md');

    // never_capture should union defaults and user-supplied entries.
    expect(config.never_capture).toContain('**/.env');
    expect(config.never_capture).toContain('**/trading-bot-key*');

    // Defaults preserved for fields not overridden by user config.
    expect(config.core_max_tokens).toBe(2000);
    expect(config.recent_sessions_kept).toBe(3);
  });

  it('isBlocked() returns true for .env files', () => {
    ProjectConfigLoader.load(tmpDir);

    expect(ProjectConfigLoader.isBlocked('.env')).toBe(true);
    expect(ProjectConfigLoader.isBlocked('app/.env')).toBe(true);
    expect(ProjectConfigLoader.isBlocked('a/b/c/.env')).toBe(true);
    expect(ProjectConfigLoader.isBlocked('app/.env.production')).toBe(true);
    expect(ProjectConfigLoader.isBlocked('config/credentials.json')).toBe(true);
    expect(ProjectConfigLoader.isBlocked('src/index.ts')).toBe(false);
    expect(ProjectConfigLoader.isBlocked('README.md')).toBe(false);
  });

  it('isManualMode() returns true when capture_mode is "manual"', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.claude-mem.json'),
      JSON.stringify({ project: 'manual-mode-test', capture_mode: 'manual' }),
    );
    ProjectConfigLoader.load(tmpDir);

    expect(ProjectConfigLoader.isManualMode()).toBe(true);
  });

  it('isManualMode() returns false when capture_mode is "auto" (default)', () => {
    ProjectConfigLoader.load(tmpDir);
    expect(ProjectConfigLoader.isManualMode()).toBe(false);
  });
});
