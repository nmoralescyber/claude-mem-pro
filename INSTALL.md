## Installing claude-mem-pro into Claude Code

### From your claude-mem-pro fork directory:
```bash
npm run build
claude plugin install .
```

### In your trading-bot repo root:
```bash
# Copy the .claude-mem.json from CLAUDE_MEM_PRO_BUILD.md into repo root
# First /remember session:
/remember "PR Capital Engine: $250 start capital, ATR-based stops, Alpaca broker, AWS t3.micro us-east-1"
/remember --section "Key Constraints" "ORB signal cutoff 12:30 PM ET — avoids lunch hour chop"
/remember --section "Key Constraints" "Max drawdown 15% — auto-shutdown trigger"
/remember --section "Key Constraints" "No crypto, no HFT, no options in v1"
```
