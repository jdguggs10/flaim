"use client";

import { PhoneFlaimMark } from "@/components/site/phone-demo-frame";
import type { PublicChatDemoSport } from "@/lib/public-chat";
import type { PublicDemoSportOption } from "@/lib/public-demo-client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { IconBallAmericanFootball, IconBallBaseball } from "@tabler/icons-react";
import {
  ArrowUp,
  Database,
  LockKeyhole,
  MessageCircle,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type RefObject } from "react";

export type PhoneEducationPanelId =
  | "about"
  | "sport"
  | "drawer"
  | "activation"
  | "ask";
type PhoneFlowPanelId = Exclude<PhoneEducationPanelId, "about" | "sport">;

interface PhoneEducationPanelProps {
  container: HTMLElement | null;
  demoTarget: {
    platformLabel: string;
    sport: PublicChatDemoSport;
  };
  /** Sports for the selected platform, with the ones it advertises enabled. */
  sportOptions: readonly PublicDemoSportOption[];
  onSelectSport: (sport: PublicChatDemoSport) => void;
  panel: PhoneEducationPanelId | null;
  onPanelChange: (panel: PhoneEducationPanelId) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

const SPORT_ICONS: Record<PublicChatDemoSport, React.ReactNode> = {
  baseball: <IconBallBaseball className="h-4 w-4" stroke={1.5} />,
  football: <IconBallAmericanFootball className="h-4 w-4" stroke={1.5} />,
};

const PHONE_FLOW_CONTENT = {
  drawer: {
    number: "1",
    label: "Add",
    title: "Find Flaim in the app drawer",
    icon: <Plus className="h-6 w-6" />,
    body: (
      <>
        Connect your leagues in Flaim first. Then open the{" "}
        <strong className="font-semibold text-[var(--phone-text)]">+</strong>{" "}
        menu in ChatGPT and choose Flaim Fantasy. You only add it once.
      </>
    ),
  },
  activation: {
    number: "2",
    label: "Activate",
    title: "Flaim is active",
    icon: <PhoneFlaimMark size={24} />,
    body: (
      <>
        This badge means ChatGPT can use Flaim&apos;s read-only league info. It
        should activate automatically for fantasy questions; if it does not,
        choose Flaim from the drawer.
      </>
    ),
  },
  ask: {
    number: "3",
    label: "Ask",
    title: "Ask in your own words",
    icon: <ArrowUp className="h-5 w-5" />,
    body: (
      <>
        In ChatGPT, type and send any fantasy question normally. For the demo,
        select one of these questions that were recently run.
      </>
    ),
  },
} satisfies Record<
  PhoneFlowPanelId,
  {
    number: string;
    label: string;
    title: string;
    icon: React.ReactNode;
    body: React.ReactNode;
  }
>;

const PHONE_FLOW_STEPS = Object.keys(PHONE_FLOW_CONTENT) as PhoneFlowPanelId[];

function PhoneFlowSteps({
  active,
  onSelect,
}: {
  active?: PhoneFlowPanelId;
  onSelect: (panel: PhoneEducationPanelId) => void;
}) {
  return (
    <div
      className="grid grid-cols-3 gap-2"
      role="group"
      aria-label="How Flaim works in ChatGPT"
    >
      {PHONE_FLOW_STEPS.map((stepId) => {
        const step = PHONE_FLOW_CONTENT[stepId];
        const isActive = stepId === active;

        return (
          <button
            key={stepId}
            type="button"
            onClick={() => onSelect(stepId)}
            aria-pressed={isActive}
            className={
              isActive
                ? "rounded-2xl border border-[var(--phone-accent)] bg-[var(--phone-accent)] px-2 py-2.5 text-[var(--phone-accent-text)]"
                : "rounded-2xl border border-[var(--phone-border)] bg-[var(--phone-panel)] px-2 py-2.5 text-[var(--phone-text)] transition-colors hover:bg-[var(--phone-panel-strong)]"
            }
          >
            <span className="block text-[length:var(--phone-type-caption)] font-semibold leading-none">
              {step.number}
            </span>
            <span className="mt-1 block text-[length:var(--phone-type-caption)] font-medium leading-none">
              {step.label}
            </span>
          </button>
        );
      })}
    </div>
  );
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
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--phone-accent)]" />
          <div>
            <div className="text-[length:var(--phone-type-secondary)] font-semibold leading-5 text-[var(--phone-text)]">
              Read-only by design
            </div>
            <p className="mt-1 text-[length:var(--phone-type-caption)] leading-[1.45] text-[var(--phone-muted)]">
              Flaim can analyze a league. It cannot add, drop, trade, or change a
              roster.
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
              This page serves prepared, cached answers. Visitors never receive
              reusable access to Gerry&apos;s account.
            </p>
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

function SportPanel({
  demoTarget,
  sportOptions,
  onSelectSport,
}: {
  demoTarget: PhoneEducationPanelProps["demoTarget"];
  sportOptions: PhoneEducationPanelProps["sportOptions"];
  onSelectSport: PhoneEducationPanelProps["onSelectSport"];
}) {
  const sportLabel = demoTarget.sport === "baseball" ? "Baseball" : "Football";
  const hasFootball = sportOptions.some(
    (option) => option.sport === "football" && option.available,
  );

  return (
    <>
      <DialogPrimitive.Description className="text-[length:var(--phone-type-secondary)] leading-[1.45] text-[var(--phone-muted)]">
        The demo runs against one real league at a time, and only combinations
        with complete, recently refreshed answers are enabled.
      </DialogPrimitive.Description>

      <div className="mt-5 rounded-2xl border border-[var(--phone-border)] bg-[var(--phone-panel)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[length:var(--phone-type-caption)] font-medium text-[var(--phone-muted)]">
              Current demo
            </div>
            <div className="mt-1 text-[length:var(--phone-type-body)] font-semibold text-[var(--phone-text)]">
              {demoTarget.platformLabel} · {sportLabel}
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-[length:var(--phone-type-caption)] font-medium text-success">
            <span
              className="h-1.5 w-1.5 rounded-full bg-success"
              aria-hidden="true"
            />
            Available
          </span>
        </div>
      </div>

      <div
        className="mt-4 grid grid-cols-2 gap-2"
        role="group"
        aria-label={`Demo sport for ${demoTarget.platformLabel}`}
      >
        {sportOptions.map((option) => (
          <button
            key={option.sport}
            type="button"
            disabled={!option.available}
            aria-pressed={option.selected}
            aria-label={
              option.available
                ? `${option.label} demo`
                : `${option.label} demo not available for ${demoTarget.platformLabel}`
            }
            onClick={() => onSelectSport(option.sport)}
            className={
              option.selected
                ? "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--phone-accent)] bg-[var(--phone-panel-strong)] px-3 text-[length:var(--phone-type-caption)] font-semibold text-[var(--phone-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]"
                : option.available
                  ? "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--phone-border)] bg-[var(--phone-panel)] px-3 text-[length:var(--phone-type-caption)] font-medium text-[var(--phone-text)] transition-colors hover:bg-[var(--phone-panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]"
                  : "inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-[var(--phone-border)] bg-[var(--phone-panel)] px-3 text-[length:var(--phone-type-caption)] font-medium text-[var(--phone-muted)] opacity-55"
            }
          >
            {SPORT_ICONS[option.sport]}
            {option.label}
          </button>
        ))}
      </div>

      <p className="mt-4 text-[length:var(--phone-type-caption)] leading-[1.5] text-[var(--phone-muted)]">
        Flaim itself supports ESPN and Yahoo across football, baseball,
        basketball, and hockey, plus Sleeper for football and basketball.{" "}
        {hasFootball
          ? "More platforms and sports arrive here as their answers are prepared."
          : "The football demo returns for draft season, and more platforms arrive here as their answers are prepared."}
      </p>
    </>
  );
}

function FlowPanel({
  panel,
  onPanelChange,
}: {
  panel: PhoneFlowPanelId;
  onPanelChange: (panel: PhoneEducationPanelId) => void;
}) {
  const content = PHONE_FLOW_CONTENT[panel];

  return (
    <>
      <DialogPrimitive.Description className="sr-only">
        Step {content.number} · {content.label}: {content.title}
      </DialogPrimitive.Description>

      <div className="mt-1 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--phone-border)] bg-[var(--phone-panel)] text-[var(--phone-text)]">
        {content.icon}
      </div>
      <p className="mt-5 text-[length:var(--phone-type-body)] leading-[var(--phone-leading-body)] text-[var(--phone-text)]">
        {content.body}
      </p>

      {panel === "ask" ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-[var(--phone-panel)] p-3.5 text-[length:var(--phone-type-caption)] leading-[1.45] text-[var(--phone-muted)]">
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Choose one of the questions above to run the homepage preview.
        </div>
      ) : null}

      <div className="mt-6">
        <PhoneFlowSteps active={panel} onSelect={onPanelChange} />
      </div>
    </>
  );
}

export function PhoneEducationPanel({
  container,
  demoTarget,
  sportOptions,
  onSelectSport,
  panel,
  onPanelChange,
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
      : panel === "sport"
        ? {
            eyebrow: "Demo coverage",
            title: `${demoTarget.platformLabel} · ${demoTarget.sport === "baseball" ? "Baseball" : "Football"}`,
          }
        : {
            eyebrow: `${PHONE_FLOW_CONTENT[panel].number} · ${PHONE_FLOW_CONTENT[panel].label}`,
            title: PHONE_FLOW_CONTENT[panel].title,
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
          ) : panel === "sport" ? (
            <SportPanel
              demoTarget={demoTarget}
              sportOptions={sportOptions}
              onSelectSport={onSelectSport}
            />
          ) : (
            <FlowPanel panel={panel} onPanelChange={onPanelChange} />
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
