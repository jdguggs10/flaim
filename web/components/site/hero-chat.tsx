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

const SHOWCASE_VISIBLE_COUNT = 2;
const SHOWCASE_PILL_WIDTH_REM = 9.25;
const SHOWCASE_PILL_GAP_REM = 0.5;

type Phase = "question" | "dots" | "yes" | "showcase" | "body";

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);

    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

function useHeroTimeline(prefersReducedMotion: boolean) {
  const [phase, setPhase] = useState<Phase>("question");
  const [showcaseIndex, setShowcaseIndex] = useState(0);
  const [animateShowcaseTrack, setAnimateShowcaseTrack] = useState(true);

  useEffect(() => {
    if (prefersReducedMotion) {
      setPhase("body");
      return;
    }

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
  }, [phase, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion || (phase !== "body" && phase !== "showcase")) {
      return;
    }

    const interval = window.setInterval(() => {
      setAnimateShowcaseTrack(true);
      setShowcaseIndex((i) => i + 1);
    }, 1600);
    return () => window.clearInterval(interval);
  }, [phase, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) {
      setShowcaseIndex(0);
      setAnimateShowcaseTrack(false);
      return;
    }

    if (showcaseIndex < SHOWCASE_ITEMS.length) {
      return;
    }

    const resetTimeout = window.setTimeout(() => {
      setAnimateShowcaseTrack(false);
      setShowcaseIndex(0);

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setAnimateShowcaseTrack(true);
        });
      });
    }, 420);

    return () => window.clearTimeout(resetTimeout);
  }, [showcaseIndex, prefersReducedMotion]);

  const isPast = useCallback(
    (target: Phase) => {
      const order: Phase[] = ["question", "dots", "yes", "showcase", "body"];
      return order.indexOf(phase) >= order.indexOf(target);
    },
    [phase],
  );

  return { phase, isPast, showcaseIndex, animateShowcaseTrack };
}

export function HeroChat() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const { phase, isPast, showcaseIndex, animateShowcaseTrack } =
    useHeroTimeline(prefersReducedMotion);
  const showcaseTrackItems = [
    ...SHOWCASE_ITEMS,
    ...SHOWCASE_ITEMS.slice(0, SHOWCASE_VISIBLE_COUNT),
  ];
  const showcaseTranslate = `translateX(calc(-${showcaseIndex} * (${SHOWCASE_PILL_WIDTH_REM}rem + ${SHOWCASE_PILL_GAP_REM}rem)))`;

  return (
    <section className="px-4 py-10 md:py-16">
      <div className="mx-auto max-w-xl space-y-4">
        {/* User question bubble */}
        <div
          className="flex justify-end"
          style={{
            opacity: isPast("question") ? 1 : 0,
            transform: isPast("question") ? "translateY(0)" : "translateY(10px)",
            transition: prefersReducedMotion
              ? undefined
              : "all 0.55s cubic-bezier(0.22,1,0.36,1)",
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
                : "translateY(10px)",
              transition: prefersReducedMotion
                ? undefined
                : "all 0.48s cubic-bezier(0.22,1,0.36,1)",
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
                        animation: prefersReducedMotion
                          ? undefined
                          : `hero-dot-bounce 1.4s ease-in-out ${delay}s infinite`,
                      }}
                    />
                  ))}
                </span>
              </div>
            ) : isPast("yes") ? (
              <div>
                <h1>
                  <span
                    className="block text-3xl font-bold tracking-tight text-foreground md:text-5xl"
                    style={{
                      animation: prefersReducedMotion
                        ? undefined
                        : "hero-pop-in 0.3s cubic-bezier(0.16,1,0.3,1)",
                    }}
                  >
                    Yes,{" "}
                    <span className="text-foreground/65">Flaim</span> can get
                    you:
                  </span>
                </h1>
                {isPast("showcase") && (
                  <div className="mt-3 space-y-2">
                    <div
                      className="overflow-hidden"
                      style={{
                        width: `calc(${SHOWCASE_VISIBLE_COUNT * SHOWCASE_PILL_WIDTH_REM}rem + ${(SHOWCASE_VISIBLE_COUNT - 1) * SHOWCASE_PILL_GAP_REM}rem)`,
                        maxWidth: "100%",
                      }}
                    >
                      <div
                        className="flex gap-2"
                        style={{
                          transform: showcaseTranslate,
                          transition:
                            prefersReducedMotion || !animateShowcaseTrack
                              ? undefined
                              : "transform 620ms cubic-bezier(0.22,1,0.36,1)",
                        }}
                      >
                        {showcaseTrackItems.map((item, i) => (
                          <span
                            key={`${item}-${i}`}
                            className="inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground md:text-sm"
                            style={{
                              width: `${SHOWCASE_PILL_WIDTH_REM}rem`,
                            }}
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">and more</div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Body copy */}
        <div
          style={{
            opacity: isPast("body") ? 1 : 0,
            transform: isPast("body") ? "translateY(0)" : "translateY(14px)",
            transition: prefersReducedMotion
              ? undefined
              : "all 0.68s cubic-bezier(0.22,1,0.36,1) 0.24s",
          }}
        >
          <div className="mx-auto max-w-lg space-y-3 px-2 pt-3 text-center">
            <p className="text-sm leading-6 text-foreground/78 md:text-base">
              Flaim connects{" "}
              <span className="font-medium text-foreground">ChatGPT</span>,{" "}
              <span className="font-medium text-foreground">Claude</span>, and{" "}
              <span className="font-medium text-foreground">Perplexity</span> to{" "}
              <span className="font-medium text-foreground">ESPN</span>,{" "}
              <span className="font-medium text-foreground">Yahoo</span>, and{" "}
              <span className="font-medium text-foreground">Sleeper</span>.
            </p>
            <p className="text-sm leading-6 text-muted-foreground md:text-[0.95rem]">
              Give your AI access to your fantasy leagues. Manage start/sit,
              find waiver wire gems, and more.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
