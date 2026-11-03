# Build brief: 24 Freelancing website (read this fully before working)

You are one of several agents building the production website for **24 Freelancing**, a microtask marketplace, in parallel. The client wants the site to look **the same as the Figma design**, with **GSAP animations**. Build properly and completely, with no stubs left behind. The client will adjust components later.

## Paths
- Repo: `/Users/nurmohammadkawser/Desktop/My Clients/Samin Infotech/24 freelancer/24freelancing/`
- Docs (the spec): `/Users/nurmohammadkawser/Desktop/My Clients/Samin Infotech/24 freelancer/24F-Dev-Docs/`. Start with `00a-Canonical-Reference.md`. Its names for routes, enums, tables, endpoints and IDs are authoritative; do not rename them. Read the docs your task names, in parts if they are large.
- Figma inventories (verbatim copy, node IDs): `24F-Dev-Docs/appendix/figma-inventory/*.md`.

## Toolchain (important)
- **Always run** `export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"` first in every shell command. Node 22 is required; the system Node 21 breaks the Tailwind v4 build.
- pnpm 10 workspace: `apps/web` (Next.js 15 App Router, React 19, Tailwind v4), `apps/api` (NestJS 11), `packages/db` (Prisma 6, `import { prisma } from '@24f/db'`), `packages/ui` (design system, source TS, transpiled by Next), `packages/shared` (enums, zod schemas, error codes, formatters), `packages/config`.
- DB: local PostgreSQL 16, `postgresql://nurmohammadkawser@localhost:5432/fl_dev`. It is already migrated (59 tables from Doc 05) and seeded with the Figma sample data (users 482910 Nusrat Jahan, 120774 Shelfwise Ltd., job WJ-58213, …). **Do not change the schema** except via a new migration under `packages/db/prisma/migrations/NNNN_name/`, plus the matching `schema.prisma` edit, and only when unavoidable. Say so in your final reply.
- Redis is running on 127.0.0.1:6379.
- Ports: web 3000, admin 3001, api 4000 (prefix `/api/v1`). If you start a dev server to test, use your own free port (e.g. 3100+, 4100+) and **kill it before you finish**.
- Adding dependencies: `pnpm add <pkg> --filter <your package>`. If the lockfile is busy (another agent is installing), wait a few seconds and retry. Never delete `node_modules` or the lockfile.

## Styling rules
- Tokens are already defined: `packages/ui/src/styles/tokens.css` (CSS vars `--fl-*`, type classes `.t-h1`, `.t-overline`, …) and `theme.css` (Tailwind v4 `@theme`). Use the Tailwind utilities they generate: `bg-brand`, `text-fg-secondary`, `border-line`, `text-h2`, `text-label-md`, `font-display`, `rounded-card`, `shadow-sm`, breakpoints `tablet:`, `laptop:`, `desktop:`, `wide:`, and so on. **No raw hex colours** in components.
- Match Figma exactly: sizes, spacing, radii, copy (verbatim from the inventories and Doc 02), icon choices (Lucide equivalents per Doc 02 §4), and states. When in doubt, look at the frame. Figma MCP tools are available: create a session with `mcp__claude_ai_Figma__create_session` (fileKey `nIcLpn9QogHW6lxsMe5yLM`). Then use `get_screenshot` to compare and `get_design_context` for exact values. Before your first `get_design_context`, invoke the Skill `figma:figma-design-to-code`. **Never modify the Figma file.**
- Responsive per Doc 02 §12: mobile < 768 (390 reference), tablet 768–1279, desktop ≥ 1280 (1440 reference). No horizontal scroll at 390. Touch targets ≥ 44 px.
- Accessibility: semantic HTML, labels, focus ring (`--fl-shadow-focus`), keyboard paths.

## GSAP rules
- Use `gsap` + `@gsap/react` (`useGSAP`), plus `ScrollTrigger` where scroll-driven. Register plugins once in `packages/ui/src/motion/`; shared helpers live there.
- Respect `prefers-reduced-motion` through `gsap.matchMedia()`: with reduced motion, show the final state with no movement.
- Animate only `transform` and `opacity`. No layout thrash, and no animation that delays content (keep entrance tweens ≤ 0.8 s with stagger ≤ 0.08 s). Content must be visible if JS fails: hide-before-animate only via a class that JS adds.
- Marketing pages get rich motion: hero timeline, scroll reveals, counters, job-board stagger, step timelines. App dashboards get subtle motion: count-ups, list staggers, drawer and dialog transitions.

## Data
- Pages must load real data from the API (`/api/v1`, Doc 06 contracts) through `packages/shared` types and the client in `apps/web/src/lib/api`. There is no mock data in pages, except where the API doesn't exist yet; then use a clearly named temporary fixture file that the coordinator will remove.
- Money and date formatting: use the `packages/shared` formatters (Canonical §5).

## Coordination
- Touch only the directories your task owns. If you need a change in someone else's area, describe it in your final reply instead.
- Before finishing: `pnpm --filter <pkg> typecheck` and build (or a dev-server smoke test) must pass for your area.
- Final reply (max 15 lines): what you built (files and areas), how you verified it, anything left incomplete, and any cross-area requests.
