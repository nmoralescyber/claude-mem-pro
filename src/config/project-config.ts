/**
 * claude-mem-pro: Per-project configuration loader
 * Reads .claude-mem.json from the current working directory (repo root)
 * Falls back to sensible defaults if no config file exists
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

export interface TopicTrigger {
  [filePattern: string]: string;
}

export interface ProjectConfig {
  project: string;
  capture_mode: 'auto' | 'manual';
  max_inject_tokens: number;
  session_summary_model: string;
  spec_files: string[];
  topic_triggers: TopicTrigger;
  never_capture: string[];
  core_max_tokens: number;
  recent_sessions_kept: number;
}

const DEFAULTS: ProjectConfig = {
  project: 'unnamed-project',
  capture_mode: 'auto',
  max_inject_tokens: 6000,
  session_summary_model: 'claude-haiku-4-5',
  spec_files: [],
  topic_triggers: {},
  never_capture: [
    '**/.env',
    '**/.env.*',
    '**/secrets*',
    '**/*api_key*',
    '**/*api-key*',
    '**/credentials*',
    '**/*.pem',
    '**/*.key',
  ],
  core_max_tokens: 2000,
  recent_sessions_kept: 3,
};

// Inline gitignore-style glob matcher. The build spec assumed minimatch was a
// direct dep; it is not, so we ship a small matcher with just the operators we
// need (`**` = any path, `*` = any chars except `/`).
function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if ('.+^$(){}|[]\\'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (globToRegExp(pattern).test(normalized)) return true;
  // Allow `**/foo` patterns to also match a bare `foo` (no leading dirs).
  if (pattern.startsWith('**/')) {
    const rest = pattern.slice(3);
    if (globToRegExp(rest).test(normalized)) return true;
  }
  return false;
}

export class ProjectConfigLoader {
  private static instance: ProjectConfig | null = null;
  private static configPath: string | null = null;

  static load(cwd: string = process.cwd()): ProjectConfig {
    if (this.instance && this.configPath) {
      return this.instance;
    }

    const configFile = path.join(cwd, '.claude-mem.json');

    if (!fs.existsSync(configFile)) {
      logger.debug('CONFIG', 'No .claude-mem.json found — using defaults');
      this.instance = { ...DEFAULTS };
      return this.instance;
    }

    try {
      const raw = fs.readFileSync(configFile, 'utf-8');
      const userConfig = JSON.parse(raw) as Partial<ProjectConfig>;

      this.instance = {
        ...DEFAULTS,
        ...userConfig,
        never_capture: [
          ...DEFAULTS.never_capture,
          ...(userConfig.never_capture ?? []),
        ],
        spec_files: userConfig.spec_files ?? DEFAULTS.spec_files,
        topic_triggers: {
          ...DEFAULTS.topic_triggers,
          ...(userConfig.topic_triggers ?? {}),
        },
      };

      this.configPath = configFile;
      logger.debug('CONFIG', `Loaded config for project: "${this.instance.project}" capture=${this.instance.capture_mode} tokens=${this.instance.max_inject_tokens} model=${this.instance.session_summary_model}`);

      return this.instance;
    } catch (err) {
      logger.warn('CONFIG', `Failed to parse .claude-mem.json — using defaults: ${err instanceof Error ? err.message : err}`);
      this.instance = { ...DEFAULTS };
      return this.instance;
    }
  }

  static reset(): void {
    this.instance = null;
    this.configPath = null;
  }

  static hasProjectConfig(cwd: string = process.cwd()): boolean {
    return fs.existsSync(path.join(cwd, '.claude-mem.json'));
  }

  static getSummaryModel(): string {
    return this.load().session_summary_model;
  }

  static isBlocked(filePath: string): boolean {
    const config = this.load();
    return config.never_capture.some(pattern => matchesGlob(filePath, pattern));
  }

  static getTopicFiles(activeFilePath: string): string[] {
    const config = this.load();
    const triggered: string[] = [];
    for (const [pattern, topicFile] of Object.entries(config.topic_triggers)) {
      if (activeFilePath.includes(pattern) || activeFilePath.startsWith(pattern)) {
        triggered.push(topicFile);
      }
    }
    return triggered;
  }

  static isManualMode(): boolean {
    return this.load().capture_mode === 'manual';
  }
}
