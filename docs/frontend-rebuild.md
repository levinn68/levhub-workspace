# Frontend rebuild: release checklist

## PR #4 — rebuild using existing backend

- [x] Workspace shell, login, model catalog, history, settings, and connection health screens.
- [x] Chat internals rebuilt: transcript, Markdown rendering, composer, attachments, model selector, stop, draft recovery, and tool approval.
- [x] MCP rebuilt: remote-endpoint discovery, manual setup, save/test/activate flow, and connection management.
- [x] Skills rebuilt: browsable catalog with previews, install, activation, deletion, and SKILL.md/ZIP import.
- [ ] Test a real mobile viewport with the keyboard open, long Markdown/code, multiple attachments, and a long model name. Check desktop keyboard navigation too.
- [ ] Smoke-test login/logout, chat streaming and stop, attachment upload, history search and exports, MCP connection test, skill import, and settings against the preview backend.
- [ ] Verify Vercel checks on the final commit, then review before merge. A green deployment is not an end-to-end test.
- [ ] Known limitations to review before merge: MCP servers that require OAuth cannot be connected through the token form; STDIO-only servers need a runtime. The Skills catalog is LEVHUB's built-in list, not an external registry.

## Separate feature work — PR #2

- [ ] Wire the cross-provider catalog and Panel Discussion to the actual Chat routes and UI. Persist panel artifacts in conversation history.
- [ ] Collect reported usage and surface it in the dashboard; don't represent missing usage as zero or workspace usage as 9Router-wide totals.
- [ ] Finish provider settings, personalization, and chat-initiated MCP setup. Don't advertise native providers or OAuth before their integrations are supported.
