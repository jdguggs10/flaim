"use client";

import type { PublicChatDemoSport } from "@/lib/public-chat";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Database, LockKeyhole, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type RefObject } from "react";

export type PhoneEducationPanelId =
  | "about"
  | "drawer"
  | "activation"
  | "ask";
type PhoneInsideChatGptPanelId = Exclude<PhoneEducationPanelId, "about">;

// The composer's plus, Flaim, and send controls each open a short "Inside
// ChatGPT" sheet: a title and a sentence or two. They are informational
// asides, not numbered steps, so there is no step switcher.
const INSIDE_CHATGPT_CONTENT: Record<
  PhoneInsideChatGptPanelId,
  { title: string; body: string }
> = {
  drawer: {
    title: "Find Flaim in the + menu",
    body: "Adding Flaim Fantasy to ChatGPT puts it in this drawer. Connect your leagues first, then add it once.",
  },
  activation: {
    title: "Flaim is active",
    body: "This badge means ChatGPT is using Flaim's read-only league info. It should activate on its own for fantasy questions; if it doesn't, choose Flaim from the drawer.",
  },
  ask: {
    title: "Ask in your own words",
    body: "In ChatGPT, type and send any fantasy question normally. For the demo, select one of these questions that were recently run.",
  },
};

interface PhoneEducationPanelProps {
  container: HTMLElement | null;
  demoTarget: {
    platformLabel: string;
    sport: PublicChatDemoSport;
  };
  panel: PhoneEducationPanelId | null;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

function AboutPanel({
  demoTarget,
}: {
  demoTarget: PhoneEducationPanelProps["demoTarget"];
}) {
  return (
    <>
      <DialogPrimitive.Description className="text-[length:var(--phone-type-secondary)] leading-[1.45] text-[var(--phone-muted)]">
        A real league preview, designed to be useful without exposing Gerry&apos;s
        account.
      </DialogPrimitive.Description>

      <div className="mt-5 space-y-3">
        <div className="flex gap-3 rounded-2xl bg-[var(--phone-panel)] p-3.5">
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-[var(--phone-accent)]" />
          <div>
            <div className="text-[length:var(--phone-type-secondary)] font-semibold leading-5 text-[var(--phone-text)]">
              Real league data
            </div>
            <p className="mt-1 text-[length:var(--phone-type-caption)] leading-[1.45] text-[var(--phone-muted)]">
              Recently refreshed answers from Gerry&apos;s actual{" "}
              {demoTarget.platformLabel} {demoTarget.sport} league.
            </p>
          </div>
        </div>

        <div className="flex gap-3 rounded-2xl bg-[var(--phone-panel)] p-3.5">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-[var(--phone-accent)]" />
          <div>
            <div className="text-[length:var(--phone-type-secondary)] font-semibold leading-5 text-[var(--phone-text)]">
              Safe public preview
            </div>
            <p className="mt-1 text-[length:var(--phone-type-caption)] leading-[1.45] text-[var(--phone-muted)]">
              This page serves prepared, cached answers, and Flaim&apos;s
              league access is read-only — it cannot add, drop, trade, or
              change a roster. Visitors never receive reusable access to
              Gerry&apos;s account.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[length:var(--phone-type-caption)] font-semibold uppercase tracking-[0.12em] text-[var(--phone-muted)]">
          Demo coverage
        </div>
        {/* Hardcoded for this preview pass, matching the anticipation copy
            elsewhere on the page; should derive from the capabilities feed
            once that's stable enough to drive this copy directly. */}
        <div className="mt-2 divide-y divide-[var(--phone-border)] overflow-hidden rounded-2xl border border-[var(--phone-border)] bg-[var(--phone-panel)]">
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-[length:var(--phone-type-caption)] font-medium text-[var(--phone-text)]">
              ESPN · Football and Baseball
            </span>
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
              aria-hidden="true"
            />
          </div>
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-[length:var(--phone-type-caption)] font-medium text-[var(--phone-text)]">
              Sleeper · Football
            </span>
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
              aria-hidden="true"
            />
          </div>
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[var(--phone-muted)]">
            <span className="text-[length:var(--phone-type-caption)] font-medium">
              Yahoo
            </span>
            <span className="text-[length:var(--phone-type-caption)]">
              Returns when Yahoo restores API access
            </span>
          </div>
        </div>
      </div>

      <Link
        href="/leagues"
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--phone-text)] px-4 text-[length:var(--phone-type-secondary)] font-semibold text-[var(--phone-screen)] transition-opacity hover:opacity-85"
      >
        Connect your leagues
      </Link>
    </>
  );
}

export function PhoneEducationPanel({
  container,
  demoTarget,
  panel,
  returnFocusRef,
}: PhoneEducationPanelProps) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (panel) {
      titleRef.current?.focus();
    }
  }, [panel]);

  if (!container || !panel) {
    return null;
  }

  const heading =
    panel === "about"
      ? { eyebrow: "Demo guide", title: "About this demo" }
      : {
          eyebrow: "Inside ChatGPT",
          title: INSIDE_CHATGPT_CONTENT[panel].title,
        };

  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Overlay className="absolute inset-0 z-40 bg-black/35 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        className="absolute inset-x-0 bottom-0 z-50 max-h-[86%] overflow-y-auto rounded-t-[2rem] border-t border-[var(--phone-border)] bg-[var(--phone-screen)] px-5 pb-6 pt-3 text-[var(--phone-text)] shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.45)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-6 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-6"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-[var(--phone-border)]" aria-hidden="true" />

        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-[length:var(--phone-type-caption)] font-semibold uppercase tracking-[0.12em] text-[var(--phone-muted)]">
              {heading.eyebrow}
            </div>
            <DialogPrimitive.Title
              ref={titleRef}
              tabIndex={-1}
              className="mt-1 text-[clamp(1.125rem,5.8cqw,1.3rem)] font-semibold leading-tight tracking-[-0.025em] text-[var(--phone-text)] outline-none"
            >
              {heading.title}
            </DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Close className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--phone-border)] bg-[var(--phone-panel)] text-[var(--phone-text)] transition-colors hover:bg-[var(--phone-panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]">
            <X className="h-4.5 w-4.5" />
            <span className="sr-only">Close demo guide</span>
          </DialogPrimitive.Close>
        </div>

        <div className="mt-3">
          {panel === "about" ? (
            <AboutPanel demoTarget={demoTarget} />
          ) : (
            <DialogPrimitive.Description className="text-[length:var(--phone-type-body)] leading-[var(--phone-leading-body)] text-[var(--phone-text)]">
              {INSIDE_CHATGPT_CONTENT[panel].body}
            </DialogPrimitive.Description>
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
