/**
 * claude-mem-pro: Hierarchical memory manager
 * Manages CORE.md, RECENT.md, sessions/, and topics/ directories
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfigLoader } from '../config/project-config.js';
import { logger } from '../utils/logger.js';

export class MemoryManager {
  private memDir: string;
  private repoRoot: string;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = repoRoot;
    this.memDir = path.join(repoRoot, '.claude-mem');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.memDir,
      path.join(this.memDir, 'sessions'),
      path.join(this.memDir, 'topics'),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Initialize CORE.md if it doesn't exist
    const corePath = path.join(this.memDir, 'CORE.md');
    if (!fs.existsSync(corePath)) {
      const config = ProjectConfigLoader.load(this.repoRoot);
      fs.writeFileSync(corePath,
        `# ${config.project} — Core Memory\n\n` +
        `> This file is permanent. Written only by /remember commands.\n` +
        `> Never auto-generated. Never expires.\n\n` +
        `## Architecture Decisions\n\n` +
        `## Key Constraints\n\n` +
        `## Decision Log\n\n`
      );
    }

    // Migrate flat MEMORY.md → .claude-mem/RECENT.md on first run.
    // Preserves content for users upgrading from stock claude-mem.
    const flatMemoryPath = path.join(this.repoRoot, 'MEMORY.md');
    const recentPath = path.join(this.memDir, 'RECENT.md');
    if (fs.existsSync(flatMemoryPath) && !fs.existsSync(recentPath)) {
      const existing = fs.readFileSync(flatMemoryPath, 'utf-8');
      const config = ProjectConfigLoader.load(this.repoRoot);
      const header =
        `# Recent Sessions (last ${config.recent_sessions_kept})\n` +
        `> Auto-generated. Do not edit manually. Use /remember for permanent notes.\n\n`;
      const migratedEntry = `## Session migrated\n\n${existing.trim()}`;
      fs.writeFileSync(recentPath, header + migratedEntry);
      logger.debug('MEM', 'Migrated MEMORY.md → .claude-mem/RECENT.md');
    }
  }

  /**
   * Build the context injection string for session start.
   * Respects max_inject_tokens limit from config.
   * Order: CORE.md → RECENT.md → relevant topic files
   */
  buildSessionContext(activeFiles: string[] = []): string {
    const config = ProjectConfigLoader.load(this.repoRoot);
    const sections: string[] = [];
    let tokenEstimate = 0;
    const TOKEN_LIMIT = config.max_inject_tokens;

    // Helper: rough token estimate (1 token ≈ 4 chars)
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);

    // 1. Always inject CORE.md
    const corePath = path.join(this.memDir, 'CORE.md');
    if (fs.existsSync(corePath)) {
      const core = fs.readFileSync(corePath, 'utf-8');
      const coreTokens = estimateTokens(core);
      if (tokenEstimate + coreTokens <= TOKEN_LIMIT) {
        sections.push(core);
        tokenEstimate += coreTokens;
      }
    }

    // 2. Inject RECENT.md if budget allows
    const recentPath = path.join(this.memDir, 'RECENT.md');
    if (fs.existsSync(recentPath)) {
      const recent = fs.readFileSync(recentPath, 'utf-8');
      const recentTokens = estimateTokens(recent);
      if (tokenEstimate + recentTokens <= TOKEN_LIMIT) {
        sections.push(recent);
        tokenEstimate += recentTokens;
      }
    }

    // 3. Inject relevant topic files based on active files
    for (const activeFile of activeFiles) {
      const topicFiles = ProjectConfigLoader.getTopicFiles(activeFile);
      for (const topicFile of topicFiles) {
        const topicPath = path.join(this.memDir, topicFile);
        if (fs.existsSync(topicPath)) {
          const topic = fs.readFileSync(topicPath, 'utf-8');
          const topicTokens = estimateTokens(topic);
          if (tokenEstimate + topicTokens <= TOKEN_LIMIT) {
            sections.push(topic);
            tokenEstimate += topicTokens;
          } else {
            logger.debug('MEM', `Token limit reached — skipping ${topicFile}`);
            break;
          }
        }
      }
    }

    logger.debug('MEM', `Injecting ~${tokenEstimate} tokens of context`);
    return sections.join('\n\n---\n\n');
  }

  /**
   * Archive a completed session to sessions/ directory.
   * Update RECENT.md to include this session (drop oldest if > recent_sessions_kept).
   */
  archiveSession(sessionSummary: string): void {
    const config = ProjectConfigLoader.load(this.repoRoot);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Write full session to archive
    const sessionFile = path.join(this.memDir, 'sessions', `${timestamp}.md`);
    fs.writeFileSync(sessionFile, `# Session: ${timestamp}\n\n${sessionSummary}`);

    // Update RECENT.md
    this.updateRecentMd(sessionSummary, timestamp, config.recent_sessions_kept);
  }

  private updateRecentMd(newSummary: string, timestamp: string, maxSessions: number): void {
    const recentPath = path.join(this.memDir, 'RECENT.md');

    let existingContent = '';
    if (fs.existsSync(recentPath)) {
      existingContent = fs.readFileSync(recentPath, 'utf-8');
    }

    const SESSION_SEPARATOR = '\n\n<!-- SESSION_BOUNDARY -->\n\n';
    const existingSessions = existingContent
      .split(SESSION_SEPARATOR)
      .filter(s => s.trim().length > 0);

    const newEntry = `## Session ${timestamp}\n\n${newSummary}`;
    const updatedSessions = [newEntry, ...existingSessions].slice(0, maxSessions);

    const header =
      `# Recent Sessions (last ${maxSessions})\n` +
      `> Auto-generated. Do not edit manually. Use /remember for permanent notes.\n\n`;

    fs.writeFileSync(recentPath, header + updatedSessions.join(SESSION_SEPARATOR));
  }

  /**
   * Write a decision or note to CORE.md decision log.
   * Called by /remember command.
   */
  writeToCore(content: string, section: string = 'Decision Log'): void {
    const corePath = path.join(this.memDir, 'CORE.md');
    const existing = fs.readFileSync(corePath, 'utf-8');
    const timestamp = new Date().toISOString().split('T')[0];
    const entry = `\n### ${timestamp}\n${content}\n`;

    const sectionHeader = `## ${section}`;
    if (existing.includes(sectionHeader)) {
      const updated = existing.replace(sectionHeader, sectionHeader + entry);
      fs.writeFileSync(corePath, updated);
    } else {
      fs.appendFileSync(corePath, `\n## ${section}${entry}`);
    }

    logger.debug('MEM', `Written to CORE.md → ${section}`);
  }

  /**
   * Write or update a topic file.
   * Called by /remember --topic <name>
   */
  writeToTopic(topicName: string, content: string): void {
    const topicPath = path.join(this.memDir, 'topics', `${topicName}.md`);
    const timestamp = new Date().toISOString().split('T')[0];

    if (fs.existsSync(topicPath)) {
      fs.appendFileSync(topicPath, `\n\n### Update ${timestamp}\n${content}`);
    } else {
      fs.writeFileSync(topicPath, `# Topic: ${topicName}\n\n### ${timestamp}\n${content}`);
    }

    logger.debug('MEM', `Written to topics/${topicName}.md`);
  }
}
