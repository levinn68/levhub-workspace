# Collaboration engine (first slice)

`runCollaboration` executes one fixed Draft → Review → Final run. It accepts a model ID per role, recent conversation context, and a user task. Previous outputs are passed as reference data. The engine does not execute tools or retry requests. It returns artifacts and captures usage only when the caller provides it; missing usage is `null`.

This is not wired into the existing `/api/chat/collaborate` route. The existing UI and endpoint remain unchanged. Integration next steps:

- Validate role model IDs against the Router catalog and account for vision capability when forwarding images.
- Load previous turns (excluding the current request), pass an abort signal tied to response closure, and persist stage results and final answer.
- Parse upstream `usage` in the Router adapter, then expose per-stage usage in the workspace dashboard. Do not label workspace usage as gateway-wide usage.
- Wire role selectors, stage progress, and cancel into the UI; test without using production credentials.
