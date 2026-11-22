# LEVHUB Workspace

Private single-owner AI workspace. AI chat and model catalog use **Router API only**.

## Architecture
- Web: Next.js
- API: Node.js / TypeScript
- Database and private Skill storage: Supabase
- AI provider: Router API (one base URL + one API key)
- Tool integrations: external MCP servers and imported SKILL.md / ZIP packages

## Required environment
See `.env.example`. Configure `ROUTER_BASE_URL` and `ROUTER_API_KEY` for AI. Supabase backend credentials are separate database infrastructure credentials.

Never commit `.env`, service-role keys, Router API keys, password hashes, or encryption secrets.

## Database
Migration: `supabase/migrations/001_initial_schema.sql`.
All tables use the `levhub_*` prefix and RLS is enabled. This allows LEVHUB to share the existing Supabase project without changing OVERDRIVE tables or grants.

## Local development
```bash
npm install
npm run dev:api
npm run dev:web
```

Before deployment, configure the API and web environment variables in the respective hosting services.
