# Guest Session and Wallet Authentication Design

## Goal

Allow a visitor to create profiles and request the full analysis workflow without an account or database writes, while making wallet authentication a single signature action that automatically registers or logs in the wallet.

## Scope and Constraints

- A guest session persists only in the current browser session through `sessionStorage` and survives a page refresh.
- Closing the browser session clears guest information. Guest profiles, questions, reports, preferences, credits, and check-ins must never be written to D1, KV, or another server-side store.
- A guest analysis must use the same deterministic chart and six-stage report pipeline as an authenticated analysis.
- Guest data is never imported into a wallet account during authentication.
- Wallet ownership remains cryptographically verified with `personal_sign`; an unverified address must never become authenticated.
- Persistent wallet users continue to use D1-backed profiles, conversations, reports, preferences, credits, and check-ins.

## Alternatives Considered

1. Browser-only state plus a stateless guest analysis endpoint: selected. It satisfies refresh recovery and the no-database requirement without retaining personal birth data or reports server-side.
2. KV or Durable Object guest sessions with TTL: rejected because temporary server-side records still retain visitor information.
3. D1 rows marked for later deletion: rejected because it explicitly writes visitor information to the database.

## Guest Session Architecture

`app.js` owns a guest session store backed by `sessionStorage` under one versioned key. The stored object contains only the active profile, profile list, current report/chart view, and local conversation history required to render the existing workbench after refresh. It has no wallet address and is never sent wholesale to the server.

When `/api/auth/me` has no valid authenticated session, the frontend enters guest mode instead of treating the workbench as unavailable. Profile create, switch, delete, preferences, bookmark, and history actions operate on the guest session store. The UI identifies this as a temporary visitor session and keeps the existing wallet button as the path to persistent storage.

`POST /api/guest/chat` accepts a single profile and question. It validates the same required profile fields as the authenticated chat path, invokes `run6StagePipeline`, and streams the same stage, conclusion, report, and session-end event shapes. It does not construct repositories, create conversations, debit credits, create sessions, or call D1/KV persistence APIs. The browser writes the completed result into its guest session only after it receives the stream.

The existing deterministic chart endpoints remain available to guest mode because they do not persist profiles. Guest UI code must not call the authenticated profile, history, preferences, quota, or chat APIs for state-changing actions.

## Wallet Authentication Architecture

The authentication challenge operation becomes `authenticate`. The signed message includes the canonical origin, wallet, nonce, issue time, and this operation. It does not include a username.

`POST /api/auth/authenticate` consumes the one-time challenge. For Cloudflare environments it finds the user by verified wallet address or creates a user with a null username, grants the existing welcome credit only on first creation, and issues the normal HttpOnly session cookie. Re-authenticating an existing wallet issues a new session and does not create a second user or grant credits again.

The legacy in-memory implementation mirrors this behavior so local development and automated tests remain aligned. Existing `/register` and `/login` handlers can remain temporarily for backwards compatibility, but the frontend no longer calls them and no new auth code may require a username.

The modal becomes a wallet-selection and signature confirmation surface with one primary action. It calls `eth_requestAccounts`, requests an authentication challenge, signs only after the explicit user action, and submits the address, challenge ID, and signature. A wallet change or rejected signature leaves the UI unauthenticated. Logging in from a guest session clears the in-memory guest state rather than persisting it to the account.

## Failure Handling

- A missing wallet provider, cancelled account selection, cancelled signature, malformed challenge, or recovered-address mismatch leaves the visitor in guest mode and shows a concise action error.
- Invalid guest profile input returns a validation response before the analysis pipeline starts.
- An analysis pipeline failure emits the existing stream error event but does not write partial guest data server-side.
- Calling the authenticated persistence endpoints without a wallet session continues to return `401 AUTH_REQUIRED`; guest code never relies on bypassing this guard.

## Test Strategy

1. Add an API test that posts a valid guest profile/question and verifies streamed report events while all D1 persistence tables remain empty.
2. Add a guest frontend contract test covering the versioned `sessionStorage` store, refresh restoration, and the absence of guest writes to persistent API endpoints.
3. Add Cloudflare auth tests proving a verified `authenticate` signature creates a username-free wallet user on first use, restores the same user on repeat use, and grants welcome credit once.
4. Update legacy auth tests to use the same no-username authentication contract.
5. Run the complete `npm test` suite and `node --env-file=.env scripts/test-simulation.mjs`; then exercise guest profile creation, guest analysis, refresh restoration, and wallet sign-in against the local workbench.

## Acceptance Criteria

- A visitor can use the workbench, create a profile, request an AI analysis, and review that session after refreshing the page without a wallet connection.
- The guest flow produces no D1/KV records for profiles, conversations, messages, reports, preferences, credits, sessions, or check-ins.
- A wallet user signs once with no username input; first use creates the account and later use signs into the existing account.
- The user interface never invents a wallet address or authenticates after a rejected signature.
- Logged-in wallet users retain their existing persistent behavior.
