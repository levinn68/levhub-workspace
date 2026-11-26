# Frontend rebuild: release checklist

## PR #4 — rebuild using existing backend

- [x] Workspace shell, login, model catalog, history, settings, and connection health screens.
- [x] Mobile transcript and composer styling over the existing Chat markup.
- [ ] Rebuild Chat internals: message list, composer, model picker, and attachment controls. Preserve streaming, stopping, drafts after failure, and tool approval.
- [ ] Rebuild MCP and Skills pages. PR #3 contains separate changes; review and port deliberately rather than assuming they are in PR #4. Keep remote MCP connection checks and explicit activation; verify skill preview, import, and activation.
- [ ] Test a real mobile viewport with keyboard open, long Markdown/code, multiple attachments, and a long model name. Check desktop keyboard navigation too.
- [ ] Smoke-test login/logout, chat streaming and stop, attachment upload, history search and exports, MCP connection test, skill import, and settings against the preview backend.
- [ ] Verify Vercel checks on the final commit, then review before merge. A green deployment is not an end-to-end test.

## Separate feature work — PR #2

- [ ] Wire the cross-provider catalog and Panel Discussion to the actual Chat routes and UI. Persist panel artifacts in conversation history.
- [ ] Render the answer activity timeline from actual workflow events and verify cancellation end to end.
- [ ] Collect reported usage and surface it in the dashboard; don't represent missing usage as zero or workspace usage as 9Router-wide totals.
- [ ] Finish provider settings, personalization, and chat-initiated MCP setup. Don't advertise native providers or OAuth before their integrations are supported.
