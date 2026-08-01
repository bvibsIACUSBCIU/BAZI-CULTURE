# Handoff Report — Frontend R1 (Multi-Profile & Session Management) Investigation

**Agent**: teamwork_preview_explorer (Instance 1)  
**Milestone**: Milestone 1 (R1: Multi-Profile & Session Management)  
**Working Directory**: `/Users/mark/VSCode/bazi-culture-mvp/.agents/teamwork_preview_explorer_m1_1`  
**Target Scope**: Frontend files (`index.html`, `systems.html`, `system-page.css`, `systems-workspace.css`, JS scripts)  

---

## 1. Observation

Direct observations and quotes from the codebase:

### Obs-1: Left Sidebar Layout in `index.html` (Lines 2365–2387)
```html
<aside class="sidebar">
  <a class="brand" href="#bazi" aria-label="两仪首页">
    ...
    <div><strong>两仪</strong><small>BAZI AGENT</small></div>
  </a>

  <nav class="nav" aria-label="主导航">
    <a class="active" data-system-switch="bazi" href="#bazi"><span class="nav-icon">◎</span>八字研读</a>
    <a data-system-switch="ziwei" href="#ziwei"><span class="nav-icon">✦</span>紫微斗数</a>
    <a data-system-switch="qimen" href="#qimen"><span class="nav-icon">▦</span>奇门遁甲</a>
  </nav>

  <div class="side-foot">
    AI 测试版<br />
    确定性排盘 · 受约束解释
  </div>
</aside>
```
*Observation*: The current `<aside class="sidebar">` contains ONLY the brand logo, 3 system navigation links, and a footer notice. It completely lacks:
- New session creation button (`+👤` / `+ 新建对话`)
- Profile switcher and profile search bar (e.g. searching/switching "韩立")
- Bookmarks list (`⭐ 收藏对话`)
- Historical conversation flow (`💬 历史对话流`)
- Newcomer check-in task progress bar and points balance panel (`⚡ 1580 Free`).

### Obs-2: Sidebar CSS in `system-page.css` (Lines 51–62)
```css
.layout { min-height: 100vh; display: grid; grid-template-columns: 180px minmax(0, 1fr); }
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 30px 18px 24px;
  border-right: 1px solid rgba(211, 168, 94, .15);
  background: rgba(7, 12, 18, .86);
  backdrop-filter: blur(18px);
}
```
*Observation*: The current CSS grid layout allocates a narrow fixed width of `180px` for `.sidebar`. This width cannot comfortably accommodate the rich R1 left sidebar components (search bar, profile list, bookmark links, history flow items, and points panel).

### Obs-3: Legacy Web3 Top Bar Badge in `index.html` (Lines 2391–2399)
```html
<div class="web3-auth-bar" id="web3-auth-bar">
  <div class="web3-user-info" id="web3-user-info">
    <span class="web3-badge" id="web3-status-badge">未登录 (点击右侧连接钱包)</span>
    <span class="web3-badge web3-credits-badge" id="web3-credits-badge">AI 积分: 0 (可用 0 次)</span>
    <span class="web3-badge" id="web3-profile-badge">单命主限制: 未绑定</span>
  </div>
  <button type="button" class="web3-connect-btn" id="web3-connect-btn">
    🔗 签名登录 / 连接钱包
  </button>
</div>
```
*Observation*: The top bar displays `<span id="web3-profile-badge">单命主限制: 未绑定</span>` which reflects a legacy single-profile design ("单命主限制"). Furthermore, `web3-connect-btn` is defined in HTML but has no event listener connected in inline JS.

### Obs-4: Frontend JavaScript State in `index.html` (Lines 2978–2990)
```javascript
const demoInput = Object.freeze({
  date: "1990-06-15",
  time: "14:30",
  timeKnown: true,
  birthplace: "",
  consent: true,
});

let currentInput = null;
let previousReading = "";
let currentIsDemo = false;
let currentTopic = "overview";
```
*Observation*: Inline JS maintains only `currentInput`, `previousReading`, `currentIsDemo`, `currentTopic`. There is no state management for:
- Active Profile (`activeProfile`: e.g. `{ name: '韩立', date: '1990-06-15', ... }`)
- Profile List (`profiles`: array of saved profiles)
- Active Session ID (`currentSessionId`)
- Bookmarked Sessions (`bookmarks`)
- Session History Flow (`historySessions`)
- Newcomer Tasks & Points Quota (`pointsBalance`, `checkinProgress`)

---

## 2. Logic Chain

1. **Requirement R1 Assessment**:
   - R1 explicitly demands:
     - Left sidebar: New session button (`+👤`), Profile switcher/list with search ("韩立"), Bookmarks list, History conversation flow.
     - Newcomer task progress bar and points balance panel (`⚡ 1580 Free`).
2. **Current vs Required Comparison**:
   - **Left Sidebar Layout**: Currently a static 180px navigation column. Needs structure expansion to a 260px scrollable sidebar containing all 5 required sub-panels.
   - **New Session Button (`+👤`)**: Currently missing. Needs a button in sidebar top section that resets active chat state and clears form/workspace for a new session.
   - **Profile List & Switcher**: Currently missing in HTML/JS. Top bar displays legacy single-profile badge ("单命主限制: 未绑定"). Needs search input, profile dropdown list, active profile badge, and dynamic profile switching handler that populates `#birth-form` and updates history.
   - **Bookmarks & History Flow**: Currently missing. Needs `.sidebar-bookmarks` and `.sidebar-history` lists in HTML, styled with CSS, and managed by a JS session controller.
   - **Points Panel (`⚡ 1580 Free`) & Newcomer Check-in**: Currently top bar shows plain `AI 积分: 0`. Needs a sidebar panel card featuring `⚡ 1580 Free` quota display, `新手打卡 (3/5)` progress bar, and check-in button.
3. **Execution Plan Strategy for Implementers**:
   - Update `system-page.css`: Expand `.layout` to `260px minmax(0, 1fr)`, add CSS classes for sidebar search input, profile cards, bookmark/history items, checkin progress bar, and `⚡ 1580 Free` badge styling.
   - Update `index.html`: Inject complete R1 DOM structure inside `<aside class="sidebar">`.
   - Implement `sidebar-controller.js` or extend `index.html` inline JS: Add state management for profiles, sessions, bookmarks, newcomer checkin tasks, and `⚡ 1580 Free` quota bindings.

---

## 3. Caveats

1. **Read-Only Explorer Scope**: This report is produced under read-only investigation rules. No changes were made to source files in the project root.
2. **Backend Coupling**: The frontend profile switcher and points panel will need backend API support (`/api/profile`, `/api/quota`) for full persistence. Implementers should ensure fallback to `localStorage` when backend APIs return initial defaults or operate offline.
3. **Responsive Mobile Views**: Expanding sidebar width to 260px requires ensuring drawer toggle / mobile drawer styling in `system-page.css` works smoothly on smaller screens (`@media (max-width: 820px)`).

---

## 4. Conclusion

### Current Status Matrix of R1 Frontend Features

| Component | Status | Details | Required Implementation Action |
|---|---|---|---|
| **Left Sidebar Layout** | PARTIAL | Basic column exists; width (180px) too small, lacks R1 sub-containers | Expand width to 260px, create scrollable sections in CSS/HTML |
| **New Session Button (`+👤`)** | MISSING | Not present in DOM or JS | Add `+👤 新建对话` button in sidebar header with reset event handler |
| **Profile Switcher & Search** | MISSING | Single `#birth-form` only; top bar has legacy single-profile badge | Add search input, profile list cards ("韩立"), active profile switcher, profile creation trigger |
| **Bookmarks List** | MISSING | Not present in DOM or JS | Add `⭐ 收藏对话` section with star toggle and saved session list |
| **History Conversation Flow** | MISSING | Not present in DOM or JS | Add `💬 历史对话` stream section displaying past session items with topic & timestamp |
| **Newcomer Task & Points Panel (`⚡ 1580 Free`)** | MISSING | Top bar has plain `AI 积分: 0` badge; no check-in bar | Add `.points-panel` in sidebar foot with `⚡ 1580 Free` badge & progress bar |

### Concrete Code Blueprint for Implementation

#### A. Proposed HTML Structure inside `<aside class="sidebar">` (`index.html`)

```html
<aside class="sidebar">
  <!-- Brand & New Chat Header -->
  <div class="sidebar-header">
    <a class="brand" href="#bazi" aria-label="两仪首页">
      <svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true">...</svg>
      <div><strong>两仪</strong><small>BAZI AGENT</small></div>
    </a>
    <button type="button" class="btn-new-session" id="new-session-btn" title="新建对话">
      <span>+👤</span> 新建对话
    </button>
  </div>

  <!-- Main Navigation -->
  <nav class="nav" aria-label="主导航">
    <a class="active" data-system-switch="bazi" href="#bazi"><span class="nav-icon">◎</span>八字研读</a>
    <a data-system-switch="ziwei" href="#ziwei"><span class="nav-icon">✦</span>紫微斗数</a>
    <a data-system-switch="qimen" href="#qimen"><span class="nav-icon">▦</span>奇门遁甲</a>
  </nav>

  <!-- Profile Switcher & Search Section -->
  <section class="sidebar-section profile-section">
    <div class="sidebar-section-title">
      <span>👥 命主档案</span>
      <button type="button" class="btn-icon-add" id="add-profile-btn" title="添加新命主">+</button>
    </div>
    <div class="profile-search-wrap">
      <input type="search" id="profile-search-input" class="sidebar-input" placeholder="🔍 搜索命主 (如韩立)..." />
    </div>
    <div class="profile-list" id="profile-list-container">
      <!-- Dynamic profile items rendered via JS -->
      <!-- Example: <div class="profile-item active" data-profile-id="p1"><span>韩立</span><small>庚午年</small></div> -->
    </div>
  </section>

  <!-- Bookmarks Section -->
  <section class="sidebar-section bookmarks-section">
    <div class="sidebar-section-title">⭐ 收藏对话</div>
    <div class="session-list" id="bookmark-list-container">
      <!-- Dynamic bookmarked sessions -->
    </div>
  </section>

  <!-- History Conversation Flow Section -->
  <section class="sidebar-section history-section">
    <div class="sidebar-section-title">💬 历史对话流</div>
    <div class="session-list" id="history-list-container">
      <!-- Dynamic history sessions -->
    </div>
  </section>

  <!-- Points & Newcomer Check-in Panel Footer -->
  <div class="side-foot points-panel">
    <div class="points-header">
      <span class="points-balance" id="points-balance-display">⚡ 1580 Free</span>
      <button type="button" class="btn-checkin" id="daily-checkin-btn">打卡</button>
    </div>
    <div class="checkin-progress-wrap">
      <div class="checkin-info">
        <small>新手任务打卡</small>
        <small id="checkin-progress-text">3/5</small>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" id="checkin-progress-fill" style="width: 60%;"></div>
      </div>
    </div>
  </div>
</aside>
```

#### B. Proposed CSS Rules (`system-page.css`)

```css
.layout { min-height: 100vh; display: grid; grid-template-columns: 260px minmax(0, 1fr); }

.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
  gap: 16px;
  overflow-y: auto;
  border-right: 1px solid rgba(211, 168, 94, .15);
  background: rgba(7, 12, 18, .86);
  backdrop-filter: blur(18px);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.btn-new-session {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--gold-dim);
  border-radius: 8px;
  color: var(--gold-light);
  background: rgba(211, 168, 94, .1);
  font-size: 12px;
  transition: all .2s ease;
}
.btn-new-session:hover {
  background: rgba(211, 168, 94, .2);
  border-color: var(--gold);
}

.sidebar-section { display: flex; flex-direction: column; gap: 8px; }
.sidebar-section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--gold-dim);
  font-size: 11px;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.sidebar-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid rgba(211, 168, 94, .2);
  border-radius: 6px;
  color: var(--paper);
  background: rgba(0, 0, 0, .4);
  font-size: 12px;
}

.profile-list, .session-list { display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow-y: auto; }

.profile-item, .session-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: 6px;
  color: #a0a6ac;
  font-size: 12px;
  cursor: pointer;
}
.profile-item:hover, .session-item:hover, .profile-item.active, .session-item.active {
  color: var(--gold-light);
  background: rgba(211, 168, 94, .12);
}

.points-panel {
  margin-top: auto;
  padding: 12px;
  border: 1px solid rgba(211, 168, 94, .2);
  border-radius: 10px;
  background: rgba(15, 22, 30, .8);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.points-balance { font-weight: 700; color: #f3d08c; font-size: 14px; }
.progress-bar { width: 100%; height: 6px; background: rgba(255, 255, 255, .1); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #d3a85e, #f0cb82); transition: width .3s ease; }
```

---

## 5. Verification Method

### Independent Verification Procedure

1. **Automated Test Pass**:
   Run the following commands in terminal:
   ```bash
   npm test
   node --env-file=.env scripts/test-simulation.mjs
   ```
   - *Requirement*: 100% of unit tests and simulation tests pass.

2. **DOM Element Verification**:
   Inspect `index.html` after implementer updates:
   - Check `#new-session-btn` exists and triggers conversation reset.
   - Check `#profile-search-input` filters profile items in real-time.
   - Check `#profile-list-container` displays default profiles (including "韩立").
   - Check `#bookmark-list-container` and `#history-list-container` list session items.
   - Check `#points-balance-display` contains `⚡ 1580 Free` format and `#checkin-progress-fill` updates dynamically.

3. **Invalidation Conditions**:
   - Hardcoded static text in解盘报告 (violates User Rule 1).
   - Sidebar remaining at 180px width or truncating search/profile lists.
   - Profile switching failing to sync input form values or right pane charts.
