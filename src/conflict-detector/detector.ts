/**
 * claude-mem-pro: Conflict Detector
 * Runs at SessionStart — compares memory content against spec files.
 * Surfaces contradictions BEFORE work begins, not mid-session.
 *
 * Uses simple keyword extraction + comparison (no LLM needed for this).
 * Falls back to LLM comparison for semantic conflicts (optional, uses Haiku).
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfigLoader } from '../config/project-config.js';

export interface Conflict {
  source_a:   string;
  source_b:   string;
  excerpt_a:  string;
  excerpt_b:  string;
  severity:   'HIGH' | 'MEDIUM' | 'LOW';
}

const CONFLICT_KEYWORDS = [
  'max_inject_tokens',
  'signal cutoff',
  'stop placement',
  'position size',
  'max position',
  'ATR buffer',
  'regime filter',
  'capture_mode',
  'orb_high',
  'orb_low',
  'drawdown',
  'daily loss limit',
  'capital allocation',
  'session_summary_model',
];

export class ConflictDetector {
  private repoRoot: string;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = repoRoot;
  }

  detect(): Conflict[] {
    const config = ProjectConfigLoader.load();
    const conflicts: Conflict[] = [];

    if (config.spec_files.length === 0) {
      return [];
    }

    const memDir = path.join(this.repoRoot, '.claude-mem');
    const coreFile = path.join(memDir, 'CORE.md');
    const recentFile = path.join(memDir, 'RECENT.md');

    const memoryFiles: { name: string; content: string }[] = [];
    if (fs.existsSync(coreFile)) {
      memoryFiles.push({ name: 'CORE.md', content: fs.readFileSync(coreFile, 'utf-8') });
    }
    if (fs.existsSync(recentFile)) {
      memoryFiles.push({ name: 'RECENT.md', content: fs.readFileSync(recentFile, 'utf-8') });
    }

    const specFiles: { name: string; content: string }[] = [];
    for (const specPath of config.spec_files) {
      const fullPath = path.join(this.repoRoot, specPath);
      if (fs.existsSync(fullPath)) {
        specFiles.push({ name: specPath, content: fs.readFileSync(fullPath, 'utf-8') });
      }
    }

    for (const memFile of memoryFiles) {
      for (const specFile of specFiles) {
        const found = this.compareFiles(memFile, specFile);
        conflicts.push(...found);
      }
    }

    return conflicts;
  }

  private compareFiles(
    fileA: { name: string; content: string },
    fileB: { name: string; content: string }
  ): Conflict[] {
    const conflicts: Conflict[] = [];

    for (const keyword of CONFLICT_KEYWORDS) {
      const excerptA = this.extractContext(fileA.content, keyword);
      const excerptB = this.extractContext(fileB.content, keyword);

      if (!excerptA || !excerptB) continue;

      const valA = this.extractValue(excerptA);
      const valB = this.extractValue(excerptB);

      if (valA && valB && valA !== valB) {
        conflicts.push({
          source_a:  fileA.name,
          source_b:  fileB.name,
          excerpt_a: excerptA.trim(),
          excerpt_b: excerptB.trim(),
          severity:  this.classifySeverity(keyword),
        });
      }
    }

    return conflicts;
  }

  private extractContext(content: string, keyword: string, contextChars = 120): string | null {
    const lower = content.toLowerCase();
    const idx = lower.indexOf(keyword.toLowerCase());
    if (idx === -1) return null;

    const start = Math.max(0, idx - 20);
    const end = Math.min(content.length, idx + contextChars);
    return content.slice(start, end);
  }

  private extractValue(text: string): string | null {
    const match = text.match(/[:=]\s*["']?([0-9.]+|[A-Za-z0-9_-]+)["']?/);
    return match ? match[1].toLowerCase() : null;
  }

  private classifySeverity(keyword: string): 'HIGH' | 'MEDIUM' | 'LOW' {
    const high = ['stop placement', 'daily loss limit', 'drawdown', 'max position', 'capital allocation'];
    const medium = ['signal cutoff', 'regime filter', 'ATR buffer', 'position size'];
    if (high.some(k => keyword.includes(k))) return 'HIGH';
    if (medium.some(k => keyword.includes(k))) return 'MEDIUM';
    return 'LOW';
  }

  static formatConflicts(conflicts: Conflict[]): string {
    if (conflicts.length === 0) {
      return '✅ claude-mem-pro: No conflicts detected between memory and spec files.';
    }

    const lines = [
      `⚠️  claude-mem-pro: ${conflicts.length} conflict(s) detected between memory and spec files.`,
      `    Resolve these before making changes that depend on these values:\n`,
    ];

    for (const c of conflicts) {
      const icon = c.severity === 'HIGH' ? '🔴' : c.severity === 'MEDIUM' ? '🟡' : '🟢';
      lines.push(`${icon} ${c.severity} — conflicting values found:`);
      lines.push(`   ${c.source_a}: "${c.excerpt_a}"`);
      lines.push(`   ${c.source_b}: "${c.excerpt_b}"`);
      lines.push('');
    }

    lines.push('   To resolve: update CORE.md with /remember, or accept spec file as authoritative.');
    return lines.join('\n');
  }
}
