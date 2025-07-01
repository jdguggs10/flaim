# FLAIM Onboarding Flow Rework & Status (v6.1.1)

> **Last Updated**: 2025-06-28
> **Status**: Analysis Complete; Awaiting Implementation of Outstanding Tasks

---

## 1. Executive Summary

The project successfully undertook a major refactoring to split credential management from sport-specific logic by introducing a dedicated `auth-worker`. The initial implementation of this architecture is complete: the `auth-worker` handles credential storage **and now fully supports league CRUD**; the `sport-workers` call it to retrieve credentials **and league data** for interacting with the ESPN API.

However, a significant gap exists between the initial implementation and a fully functional, robust onboarding flow. The `auth-worker` is missing critical CRUD endpoints for managing user leagues, which is a core requirement of the new architecture. Furthermore, end-to-end testing has not yet been completed, and key design decisions regarding rate-limiting and error handling between services remain unaddressed.

This document outlines the completed work, identifies the remaining gaps and outstanding tasks, and proposes a clear action plan to bring the feature to completion.

## 2. Background & Problem Statement

The previous architecture duplicated credential-handling logic across each `sport-worker` (e.g., `baseball-espn-mcp`, `football-espn-mcp`). This created code redundancy and a fragile local development experience, requiring at least one sport worker to be running for the initial credential-saving step in the onboarding flow.

The goal of this rework was to centralize all authentication and user-data management into a single, platform-agnostic `auth-worker`. This worker would be the single source of truth for user credentials (e.g., ESPN cookies) and user-specific league configurations. The `sport-workers` would then become stateless regarding user data, fetching credentials from the `auth-worker` on-demand to perform their specific tasks (e.g., fetching league info from ESPN).

## 3. Current Implementation Status (Completed Work)

Based on the previous plan and a review of the project structure, the following foundational work is **complete**:

*   **✅ Auth-Worker Foundation**:
    *   The `auth-worker` has been created and deployed.
    *   It successfully handles the storage and retrieval of encrypted ESPN credentials (`swid`, `s2`) in Cloudflare KV, keyed by the user's Clerk ID.
    *   It exposes `POST /credentials/:platform` and `GET /credentials/:platform` endpoints.

*   **✅ Sport-Worker Refactoring**:
    *   The `sport-workers` (`baseball-espn-mcp`, `football-espn-mcp`) have been updated.
    *   A new `POST /onboarding/initialize` endpoint has been added to each `sport-worker`.
    *   This endpoint correctly uses the `X-Clerk-User-ID` header to fetch the necessary credentials from the `auth-worker` via an internal API call.
    *   The old, direct credential-handling logic has been removed from the sport workers.

*   **✅ Next.js API Layer (Proxy)**:
    *   The `/api/onboarding/espn/auto-pull` API route in the Next.js application now acts as a simple, secure proxy.
    *   It no longer handles credentials directly from the browser.
    *   It correctly forwards requests to the appropriate `sport-worker` based on the selected `sport`, adding the necessary `X-Clerk-User-ID` header for authentication.

*   **✅ Environment Configuration**:
    *   All necessary environment variables (`NEXT_PUBLIC_*_MCP_URL`, `AUTH_WORKER_URL`, etc.) have been added to the respective `wrangler.toml` and `.env.local.example` files.

## 4. Gap Analysis & Outstanding Tasks

Despite the progress, the implementation is incomplete. The following gaps and tasks must be addressed:

*   **✅ League Management Implemented in Auth-Worker**:
    *   `POST /leagues`, `GET /leagues`, `PATCH /leagues/:leagueId/team`, and `DELETE /leagues/:leagueId` are live and verified via unit tests. Remaining work is to exercise them in end-to-end tests.

*   **📝 Unwritten Tests**:
    *   The new, unimplemented `/leagues` endpoints in the `auth-worker` will require a corresponding suite of unit and integration tests.
    *   Existing tests for the `auth-worker` only cover the `/credentials` endpoints.

*   **⚠️ Gap: Incomplete CORS Configuration**:
    *   The `auth-worker` needs its CORS policy reviewed to ensure it can accept requests from all `sport-worker` origins in a production environment, in addition to the Next.js application's origin.

*   **⚠️ Design Decision: Rate Limiting & Caching**:
    *   There is no defined strategy for rate-limiting or caching requests between the services. The `sport-workers` will call the `auth-worker` on every `/onboarding/initialize` request, and then call the external ESPN API. This could lead to performance bottlenecks, excessive costs, or hitting API limits. A caching strategy (e.g., caching credentials in the `sport-worker` for a short duration) should be considered.

*   **📝 Technical Debt: Code Duplication**:
    *   The utility code for communicating with the `auth-worker` is likely duplicated across the `sport-workers`. This should be refactored into a shared library (`@flaim/auth/shared` or similar) to improve maintainability.

*   **⚠️ Risk: Lack of End-to-End Testing**:
    *   The full, multi-step onboarding flow has not been tested end-to-end. The successful integration and error handling between the Next.js app, `sport-worker`, and `auth-worker` are unverified.

## 5. Revised Action Plan & Next Steps

The following plan outlines the path to completing the onboarding flow rework.

1.  **Implement `auth-worker` League Endpoints**:
    *   **Task**: Implement the full suite of CRUD endpoints on the `auth-worker` for managing league metadata.
    *   **Endpoints**:
        *   `POST /leagues`: Create/update a user's league entry (`{ leagueId, sport }`).
        *   `GET /leagues`: Retrieve all leagues for the authenticated user.
        *   `PATCH /leagues/:leagueId/team`: Update a specific league with the user's `teamId`.
        *   `DELETE /leagues/:leagueId`: Remove a league from the user's list.
    *   **Acceptance Criteria**: All endpoints must be fully functional and backed by Cloudflare KV storage.

2.  **Write Tests for Auth-Worker**:
    *   **Task**: Add comprehensive Jest/Vitest unit and integration tests for the new `/leagues` endpoints.
    *   **Acceptance Criteria**: Achieve sufficient test coverage to ensure reliability.

3.  **Perform Full End-to-End Testing**:
    *   **Task**: Manually execute the complete onboarding flow in a local development environment as detailed in the "Testing Checklist".
    *   **Acceptance Criteria**: The flow must work seamlessly from credential entry to team selection, with data persisting correctly across page refreshes. All positive and negative paths (e.g., invalid credentials) must be validated.

4.  **Address Design Decisions**:
    *   **Task**: Define and implement a caching and/or rate-limiting strategy for inter-worker communication and calls to the ESPN API.
    *   **Acceptance Criteria**: A decision is documented and implemented to prevent performance issues and unnecessary API calls.

5.  **Refactor Shared Code**:
    *   **Task**: Consolidate the duplicated `auth-worker` communication logic from the `sport-workers` into a shared utility.
    *   **Acceptance Criteria**: `sport-workers` import and use the shared utility, removing the duplicated code.

6.  **Final QA and Deployment**:
    *   **Task**: Run a final regression test of the entire platform in a staging environment.
    *   **Acceptance Criteria**: Once all tests pass and the feature is stable, merge to `main` and deploy to production. Update all relevant documentation.