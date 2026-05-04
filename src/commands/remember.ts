/**
 * claude-mem-pro: /remember slash command
 * Usage:
 *   /remember "We use ATR-based stops because fixed % doesn't work at $250 capital"
 *   /remember --section "Key Constraints" "Max 15% per ORB trade — tested in backtest"
 *   /remember --topic orb_strategy "Signal cutoff is 12:30 PM ET — avoids lunch chop"
 *
 * All entries go to CORE.md (permanent) or topics/*.md (on-demand)
 * Never to RECENT.md (that's auto-generated only)
 */

import { MemoryManager } from '../memory/memory-manager.js';

interface RememberOptions {
  section?: string;
  topic?: string;
}

export async function handleRememberCommand(
  args: string,
  options: RememberOptions = {}
): Promise<string> {
  const manager = new MemoryManager();

  if (!args || args.trim().length === 0) {
    return '❌ Usage: /remember "your note here"\n' +
           '         /remember --section "Key Constraints" "your constraint"\n' +
           '         /remember --topic orb_strategy "note about ORB strategy"';
  }

  const content = args.trim().replace(/^["']|["']$/g, '');

  if (options.topic) {
    manager.writeToTopic(options.topic, content);
    return `✅ Saved to topics/${options.topic}.md\n` +
           `   Will inject when ${options.topic} files are active`;
  }

  const section = options.section ?? 'Decision Log';
  manager.writeToCore(content, section);
  return `✅ Saved to CORE.md → ${section}\n` +
         `   This note is permanent and will always be injected`;
}
