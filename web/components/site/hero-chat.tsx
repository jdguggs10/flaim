"use client";

import { useEffect, useState } from "react";

const ROTATING_WORDS = [
  "rosters",
  "standings",
  "matchups",
  "free agents",
  "transactions",
  "player stats",
  "league history",
  "waiver wire",
];

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = () => setPrefersReducedMotion(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}

export function HeroChat() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const interval = window.setInterval(() => {
      setIsAnimating(true);

      const exitTimer = window.setTimeout(() => {
        setIndex((i) => (i + 1) % ROTATING_WORDS.length);
        setIsAnimating(false);
      }, 300);

      return () => window.clearTimeout(exitTimer);
    }, 2400);

    return () => window.clearInterval(interval);
  }, [prefersReducedMotion]);

  const currentWord = ROTATING_WORDS[index];

  return (
    <section className="px-4 py-10 md:py-16">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-5 text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">
          <span className="block text-foreground/55">
            Can you see my fantasy leagues?
          </span>
          <span className="mt-2 block text-foreground md:mt-3">
            Yes, your{" "}
            <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
              <span
                className="inline-block rounded-lg bg-primary/10 px-2.5 py-0.5 text-primary dark:bg-primary/15"
                style={
                  prefersReducedMotion
                    ? undefined
                    : {
                        transition:
                          "transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease",
                        transform: isAnimating
                          ? "translateY(-110%)"
                          : "translateY(0)",
                        opacity: isAnimating ? 0 : 1,
                      }
                }
              >
                {currentWord}
              </span>
            </span>
            <span
              className="ml-0.5 inline-block h-[0.9em] w-[3px] translate-y-[0.08em] rounded-full bg-primary/60"
              style={
                prefersReducedMotion
                  ? undefined
                  : {
                      animation: "hero-cursor-blink 1s step-end infinite",
                    }
              }
            />
          </span>
        </h1>
        <p className="max-w-xl text-lg leading-7 text-foreground/70 md:text-xl md:leading-8">
          Flaim connects ChatGPT, Claude, and Perplexity to ESPN, Yahoo, and
          Sleeper. Ask about start/sit decisions, waiver wire targets, and what
          matters in your league right now.
        </p>
        <div className="mt-8 h-px w-24 bg-border/60" />
      </div>
    </section>
  );
}
