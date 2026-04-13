# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# Claude Project Instructions & Behavioral Rules

## 🛠 MCP & Skills Protocol (CRITICAL)

Before providing any architectural advice, code snippet, or optimization strategy, you MUST:

1. **Scan System-Reminder:** Review all available MCP servers and tools in the `system-reminder`.
2. **Global Skills Check:** Access the `global skills folder` to identify pre-defined automation patterns.
3. **Tool-First Approach:** If a task can be automated via an MCP (e.g., Canva for UI, Supabase for DB, Playwright for Testing), prioritize proposing an MCP-based solution over manual coding.

## 🚀 V3 Performance Optimization Focus

This project prioritizes the **V3 Performance Stack**. Every response must be filtered through these constraints:

- **Bundle Management:** Actively use `chrome-devtools-mcp` to identify bloated imports. We must reduce `index.js` from 901KB using dynamic imports and tree-shaking.
- **LCP & Web Vitals:** Every UI change must be audited for Largest Contentful Paint (LCP) impact.
- **Database Efficiency:** Use `mcp__supabase` for Postgres full-text search and Realtime subscriptions to eliminate Socket.IO overhead.
- **Automated QA:** Use `mcp__playwright` for any scraper-related updates to prevent HTML structure regressions.

## 📋 Pre-Flight Checklist for Claude

For every user request, mentally (or explicitly) run this check:

- [ ] Is there an MCP tool for this? (Gmail for alerts, Canva for exports, Context7 for docs).
- [ ] Does this suggestion align with the V3 Performance goals?
- [ ] I have to choose the best suited skills and implement the best most professional answer possible.
- [ ] Can I use Playwright to verify this change?

---

_Note: This document is a durable instruction. Do not ignore these constraints unless explicitly told otherwise for a specific edge case._
