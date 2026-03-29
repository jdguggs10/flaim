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

      // After exit animation, swap word and enter
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
    <section className="px-4 py-10 text-center md:py-16">
      <div className="mx-auto max-w-[42rem]">
        <h1 className="mb-4 text-4xl font-bold leading-[0.95] tracking-tight md:text-6xl">
          <span className="block text-foreground/65">
            Can you see my fantasy leagues?
          </span>
          <span className="mt-3 block text-[1.08em] text-foreground md:mt-4">
            Yes, your{" "}
            <span
              className="inline-block overflow-hidden align-bottom"
              style={{ minWidth: "5ch" }}
            >
              <span
                className="inline-block text-primary"
                style={
                  prefersReducedMotion
                    ? undefined
                    : {
                        transition:
                          "transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease",
                        transform: isAnimating
                          ? "translateY(-100%)"
                          : "translateY(0)",
                        opacity: isAnimating ? 0 : 1,
                      }
                }
              >
                {currentWord}
              </span>
            </span>
            .
          </span>
        </h1>
        <p className="mx-auto max-w-2xl text-lg leading-7 text-foreground/70 md:text-[1.4rem] md:leading-8">
          Flaim connects ChatGPT, Claude, and Perplexity to ESPN, Yahoo, and
          Sleeper. Ask about start/sit decisions, waiver wire targets, and what
          matters in your league right now.
        </p>
        <div className="mx-auto mt-8 h-px w-24 bg-border/60" />
      </div>
    </section>
  );
}
