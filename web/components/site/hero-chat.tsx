"use client";

import { useEffect, useState, useCallback } from "react";

const QUESTION = "Can you see my fantasy leagues?";

const SHOWCASE_ITEMS = [
  "rosters",
  "standings",
  "matchups",
  "free agents",
  "transactions",
  "player stats",
  "league history",
  "waiver wire",
];

const PLATFORMS = ["ESPN", "Yahoo", "Sleeper"];
const AI_APPS = ["ChatGPT", "Claude", "Perplexity"];

type Phase = "question" | "dots" | "yes" | "showcase" | "body";

function useHeroTimeline() {
  const [phase, setPhase] = useState<Phase>("question");
  const [showcaseIndex, setShowcaseIndex] = useState(0);

  useEffect(() => {
    if (phase === "question") {
      const t = window.setTimeout(() => setPhase("dots"), 600);
      return () => window.clearTimeout(t);
    }
    if (phase === "dots") {
      const t = window.setTimeout(() => setPhase("yes"), 1800);
      return () => window.clearTimeout(t);
    }
    if (phase === "yes") {
      const t = window.setTimeout(() => setPhase("showcase"), 800);
      return () => window.clearTimeout(t);
    }
    if (phase === "showcase") {
      const t = window.setTimeout(() => setPhase("body"), 400);
      return () => window.clearTimeout(t);
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== "body" && phase !== "showcase") return;
    const interval = window.setInterval(() => {
      setShowcaseIndex((i) => (i + 1) % SHOWCASE_ITEMS.length);
    }, 1600);
    return () => window.clearInterval(interval);
  }, [phase]);

  const isPast = useCallback(
    (target: Phase) => {
      const order: Phase[] = ["question", "dots", "yes", "showcase", "body"];
      return order.indexOf(phase) >= order.indexOf(target);
    },
    [phase],
  );

  return { phase, isPast, showcaseIndex };
}

export function HeroChat() {
  const { phase, isPast, showcaseIndex } = useHeroTimeline();

  const visiblePills = isPast("showcase")
    ? SHOWCASE_ITEMS.slice(
        0,
        Math.min(showcaseIndex + 3, SHOWCASE_ITEMS.length),
      )
    : [];

  return (
    <section className="px-4 py-10 md:py-16">
      <div className="mx-auto max-w-xl space-y-4">
        {/* User question bubble */}
        <div
          className="flex justify-end"
          style={{
            opacity: isPast("question") ? 1 : 0,
            transform: isPast("question") ? "translateY(0)" : "translateY(8px)",
            transition: "all 0.4s ease",
          }}
        >
          <div className="rounded-2xl rounded-br-md bg-primary px-5 py-3 text-base font-medium text-primary-foreground md:text-lg">
            {QUESTION}
          </div>
        </div>

        {/* Assistant response bubble */}
        <div className="flex justify-start">
          <div
            className="rounded-2xl rounded-bl-md border border-border/50 bg-card px-5 py-4"
            style={{
              opacity: isPast("dots") ? 1 : 0,
              transform: isPast("dots")
                ? "translateY(0)"
                : "translateY(8px)",
              transition: "all 0.3s ease",
            }}
          >
            {phase === "dots" ? (
              <div className="py-1">
                <span className="inline-flex items-center gap-1.5">
                  {[0, 0.2, 0.4].map((delay) => (
                    <span
                      key={delay}
                      className="inline-block h-3 w-3 rounded-full bg-foreground/30 md:h-3.5 md:w-3.5"
                      style={{
                        animation: `hero-dot-bounce 1.4s ease-in-out ${delay}s infinite`,
                      }}
                    />
                  ))}
                </span>
              </div>
            ) : isPast("yes") ? (
              <div>
                <h1>
                  <span
                    className="block text-4xl font-bold tracking-tight text-foreground md:text-5xl"
                    style={{
                      animation:
                        "hero-pop-in 0.3s cubic-bezier(0.16,1,0.3,1)",
                    }}
                  >
                    Yes.
                  </span>
                </h1>
                {isPast("showcase") && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {visiblePills.map((item, i) => (
                      <span
                        key={item}
                        className="inline-block rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground md:text-sm"
                        style={{
                          animation: `hero-fade-swap 0.3s cubic-bezier(0.16,1,0.3,1) ${i * 0.05}s both`,
                        }}
                      >
                        {item}
                      </span>
                    ))}
                    <span className="inline-block rounded-full border border-border/50 bg-transparent px-3 py-1 text-xs text-muted-foreground md:text-sm">
                      + more
                    </span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Body: platform → Flaim → AI row */}
        <div
          style={{
            opacity: isPast("body") ? 1 : 0,
            transform: isPast("body") ? "translateY(0)" : "translateY(10px)",
            transition: "all 0.5s ease 0.2s",
          }}
        >
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 pt-2 text-sm">
            {PLATFORMS.map((p, i) => (
              <span key={p}>
                <span className="font-medium text-foreground/70">{p}</span>
                {i < PLATFORMS.length - 1 && (
                  <span className="ml-2 text-foreground/20">/</span>
                )}
              </span>
            ))}
            <span className="mx-1.5 text-base text-foreground/30">→</span>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-primary">
              Flaim
            </span>
            <span className="mx-1.5 text-base text-foreground/30">→</span>
            {AI_APPS.map((app, i) => (
              <span key={app}>
                <span className="font-medium text-foreground/70">{app}</span>
                {i < AI_APPS.length - 1 && (
                  <span className="ml-2 text-foreground/20">/</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
