"use client";

import type { PublicChatDemoSport } from "@/lib/public-chat";
import type { PublicDemoSportOption } from "@/lib/public-demo-client";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  IconBallAmericanFootball,
  IconBallBaseball,
  IconBallBasketball,
  IconIceSkating,
} from "@tabler/icons-react";
import { Database, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type RefObject } from "react";

export type PhoneEducationPanelId =
  | "about"
  | "drawer"
  | "activation"
  | "ask"
  | "sports";
type PhoneInsideChatGptPanelId = Exclude<
  PhoneEducationPanelId,
  "about" | "sports"
>;

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
  onSelectSport: (sport: PublicChatDemoSport) => void;
  panel: PhoneEducationPanelId | null;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  sportOptions: PublicDemoSportOption[];
}

const SPORT_CHOOSER_ICONS: Record<PublicChatDemoSport, React.ReactNode> = {
  football: <IconBallAmericanFootball className="h-5 w-5" stroke={1.5} />,
  baseball: <IconBallBaseball className="h-5 w-5" stroke={1.5} />,
};

// Basketball and hockey aren't real demo sports yet (see
// PublicChatDemoSport), so they're rendered as permanently-disabled tiles
// rather than driven by `sportOptions`.
const SPORTS_PANEL_COMING_SOON = [
  {
    key: "basketball",
    label: "Basketball",
    icon: <IconBallBasketball className="h-5 w-5" stroke={1.5} />,
  },
  {
    key: "hockey",
    label: "Hockey",
    icon: <IconIceSkating className="h-5 w-5" stroke={1.5} />,
  },
] as const;

function AboutPanel() {
  return (
    <>
      <DialogPrimitive.Description className="text-[length:var(--phone-type-secondary)] leading-[1.45] text-[var(--phone-muted)]">
        A real league preview, designed to be useful without exposing Gerry&apos;s
        account.
      </DialogPrimitive.Description>

      <div className="mt-5 flex gap-3 rounded-2xl bg-[var(--phone-panel)] p-3.5">
        <Database className="mt-0.5 h-5 w-5 shrink-0 text-[var(--phone-accent)]" />
        <div>
          <div className="text-[length:var(--phone-type-secondary)] font-semibold leading-5 text-[var(--phone-text)]">
            Real league data
          </div>
          <p className="mt-1 text-[length:var(--phone-type-caption)] leading-[1.45] text-[var(--phone-muted)]">
            Recently refreshed answers from Gerry&apos;s actual leagues.
          </p>
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
          </div>
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-[length:var(--phone-type-caption)] font-medium text-[var(--phone-text)]">
              Sleeper · Football
            </span>
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

function SportsPanel({
  onSelectSport,
  sportOptions,
}: {
  onSelectSport: (sport: PublicChatDemoSport) => void;
  sportOptions: PublicDemoSportOption[];
}) {
  return (
    <>
      <DialogPrimitive.Description className="text-[length:var(--phone-type-secondary)] leading-[1.45] text-[var(--phone-muted)]">
        Flaim supports football, baseball, basketball, and hockey. The demo
        covers the sports with prepared answers.
      </DialogPrimitive.Description>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {sportOptions.map((option) => (
          <button
            key={option.sport}
            type="button"
            disabled={!option.available}
            aria-pressed={option.selected}
            onClick={() => {
              if (!option.available) {
                return;
              }
              onSelectSport(option.sport);
            }}
            className={cn(
              "flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[length:var(--phone-type-secondary)] font-medium transition-colors",
              option.selected
                ? "border-[var(--phone-accent)] bg-[var(--phone-panel-strong)] text-[var(--phone-text)]"
                : option.available
                  ? "border-[var(--phone-border)] bg-[var(--phone-panel)] text-[var(--phone-text)] hover:bg-[var(--phone-panel-strong)]"
                  : "cursor-not-allowed border-[var(--phone-border)] bg-[var(--phone-panel)] text-[var(--phone-muted)] opacity-45",
            )}
          >
            {SPORT_CHOOSER_ICONS[option.sport]}
            {option.label}
          </button>
        ))}

        {SPORTS_PANEL_COMING_SOON.map((sport) => (
          <button
            key={sport.key}
            type="button"
            disabled
            className="flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-[var(--phone-border)] bg-[var(--phone-panel)] px-3 py-2.5 text-[length:var(--phone-type-secondary)] font-medium text-[var(--phone-muted)] opacity-45"
          >
            {sport.icon}
            {sport.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-[length:var(--phone-type-caption)] leading-[1.45] text-[var(--phone-muted)]">
        Basketball and hockey demos are not available yet.
      </p>
    </>
  );
}

export function PhoneEducationPanel({
  container,
  onSelectSport,
  panel,
  returnFocusRef,
  sportOptions,
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
      : panel === "sports"
        ? { eyebrow: "Demo sport", title: "All sports" }
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
            <AboutPanel />
          ) : panel === "sports" ? (
            <SportsPanel onSelectSport={onSelectSport} sportOptions={sportOptions} />
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
