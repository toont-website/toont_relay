# Partner Chat Slack Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a partner chat Slack reply bridge without changing existing SMS relay behavior.

**Architecture:** Reuse the running `toont_relay` app and Slack App entrypoint, but isolate partner chat storage, message formatting, webhook routes, and modal handlers in new files. The demo app talks to relay through server-side proxy routes so relay secrets are never exposed to the browser.

**Tech Stack:** Next.js App Router, Prisma/MySQL, Slack Web API Block Kit, Vitest, TypeScript.

---

### Task 1: Relay Partner Chat Contract

**Files:**
- Create: `src/lib/partner-chat/types.ts`
- Create: `src/lib/slack/messages/partner-chat.ts`
- Test: `src/lib/slack/messages/__tests__/partner-chat.test.ts`

- [ ] Write a failing test that asserts a new partner chat Slack message includes customer metadata, a `reply_partner_chat` button, and a serialized `conversationId`.
- [ ] Implement `buildPartnerChatInquiryMessage()` in a new partner chat message module.
- [ ] Run `npx pnpm@10.23.0 vitest run src/lib/slack/messages/__tests__/partner-chat.test.ts`.

### Task 2: Relay Persistence And API

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/config/env.ts`
- Create: `src/lib/partner-chat/service.ts`
- Create: `src/app/api/webhook/partner-chat/route.ts`
- Create: `src/app/api/webhook/partner-chat/messages/route.ts`
- Test: `src/lib/partner-chat/__tests__/service.test.ts`

- [ ] Add `PartnerChatConversation` and `PartnerChatMessage` models. Do not modify `MessageLog`.
- [ ] Add `SLACK_CHANNEL_PARTNER_CHAT` and `PARTNER_CHAT_WEBHOOK_SECRET` env validation.
- [ ] Add a bearer-token guard for partner chat relay routes.
- [ ] Implement conversation creation, customer message append, message listing, and Slack notification posting.
- [ ] Verify targeted tests pass.

### Task 3: Slack Action Branch

**Files:**
- Modify: `src/app/api/slack/action/route.ts`
- Create: `src/lib/slack/actions/partner-chat-reply.ts`
- Test: `src/lib/slack/actions/__tests__/partner-chat-reply.test.ts`

- [ ] Add only two branches to the existing Slack action route: `reply_partner_chat` and `partner_chat_reply_modal`.
- [ ] Implement modal opening and modal submission handling in a new partner chat action module.
- [ ] Ensure agent replies are stored in `PartnerChatMessage` and mirrored to the Slack thread.
- [ ] Run targeted action tests.

### Task 4: Demo Proxy And Widget Wiring

**Files:**
- Create: `/Users/kth/Desktop/toontm/toont-m-intro-page-online-showroom-review/src/app/api/partner-chat/route.ts`
- Create: `/Users/kth/Desktop/toontm/toont-m-intro-page-online-showroom-review/src/app/api/partner-chat/messages/route.ts`
- Modify: `/Users/kth/Desktop/toontm/toont-m-intro-page-online-showroom-review/src/components/PartnerChatWidget.tsx`
- Modify: `/Users/kth/Desktop/toontm/toont-m-intro-page-online-showroom-review/README.md`

- [ ] Add server-side demo API routes that call relay with `TOONT_RELAY_PARTNER_CHAT_URL` and `TOONT_RELAY_PARTNER_CHAT_SECRET`.
- [ ] Replace chat submit `/api/contact` call with `/api/partner-chat`.
- [ ] Store returned `relayConversationId` and poll `/api/partner-chat/messages` while the chat is submitted/open.
- [ ] Enable post-submit customer messages through `/api/partner-chat/messages`.

### Task 5: Verification

**Files:**
- All modified files.

- [ ] Run relay targeted tests for partner chat modules.
- [ ] Run relay `npx tsc --noEmit` and targeted ESLint.
- [ ] Run demo `npx tsc --noEmit` and targeted ESLint.
- [ ] Use the in-app browser on `/partner` for a smoke test without submitting to production Slack unless explicitly configured for local relay testing.
