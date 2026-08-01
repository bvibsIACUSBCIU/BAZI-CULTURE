# Project: Full Recreation of tianfu-ai Multi-Agent Metaphysics Workspace

## Architecture
- Frontend: Split Workspace Web Application (HTML/JS/CSS, Node/Express/Vercel API)
  - Left Sidebar: Multi-Profile & Session Management, Profile switcher (`+👤`), Search, Bookmarks, History flow, Newcomer check-in progress & Points balance panel (`⚡ 1580 Free`).
  - Middle Pane: AI Reasoning Workspace (`✦ 思考` collapsible panel, dynamic multi-agent step tree with `✓` completion / `⊙` nested status, action chips, report preview card, Export PDF / One-click Copy triggers).
  - Right Pane: Tabs for `🔮 紫微斗数` | `☰ 八字奇门` | `🧭 人生命途 beta` | `📑 分析报告`. Four Pillars table + Qimen Nine Palaces chart (`九宫奇门遁甲全景盘`), synchronized bottom step bar (`◄ 步骤 N/M ►`).
- Backend Engine:
  - Deterministic Bazi, Ziwei, Qimen engines (`lib/`).
  - Multi-agent orchestration pipeline (Dynamic report generation only).
  - IP anti-abuse + Web3/wallet quota system (3 accounts / IP limit, bonus points on reg, consumption on analysis).

## Code Layout
- `index.html`, `systems.html`, `qimen.html`, `ziwei.html`
- `systems-workspace.css`, `system-page.css`
- `lib/` - Metaphysics calculation engines & AI pipelines
- `api/` - Backend endpoints & server functions
- `scripts/test-simulation.mjs` - End-to-end simulation test suite

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | R1 Multi-Profile & Session Management | Left sidebar profile switcher (`+👤`), search, bookmarks, history flow, newcomer check-in & points balance panel (`⚡ 1580 Free`) | None | IN_PROGRESS |
| 2 | R2 Split Workspace & Synchronized Panes | Middle AI workspace (`✦ 思考`, step tree, chips, preview, PDF/copy) + Right panel (4 tabs, Four Pillars, Qimen Nine Palaces, synced step bar `◄ 步骤 N/M ►`) | M1 | PLANNED |
| 3 | R3 Backend Engine & Multi-Agent Integration | Deterministic Bazi/Ziwei/Qimen engines, multi-agent pipeline, IP anti-abuse + Web3/wallet quota, 100% test pass verification | M1, M2 | PLANNED |

## Interface Contracts
### Profile & Quota API (`/api/profile`, `/api/quota`)
- Quota: Returns `{ points: number, checkinTaskProgress: number }`
- Profile: Switch active profile ("韩立"), update right panel natal charts and history flow automatically.

### Multi-Agent Pipeline API (`/api/analyze`)
- Emits real-time reasoning steps (`step_id`, `agent_name`, `status`, `content`, `step_index`, `total_steps`).
- Synchronizes right panel step bar (`◄ 步骤 N/M ►`) and active chart highlights.
