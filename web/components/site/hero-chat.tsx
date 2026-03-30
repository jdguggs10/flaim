"use client";

import { useEffect, useState } from "react";

const ROTATING_WORDS = [
  "rosters",
  "standings",
  "matchups",
  "free agents",
  "transactions",
  "player stats",
  "history",
  "waiver wire",
];

const COLOR_CYCLE = [
  "text-blue-500 dark:text-blue-400",
  "text-emerald-500 dark:text-emerald-400",
  "text-orange-500 dark:text-orange-400",
  "text-violet-500 dark:text-violet-400",
  "text-rose-500 dark:text-rose-400",
  "text-cyan-500 dark:text-cyan-400",
  "text-amber-500 dark:text-amber-400",
  "text-fuchsia-500 dark:text-fuchsia-400",
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

function useRotatingWord(prefersReducedMotion: boolean) {
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

  return { currentWord: ROTATING_WORDS[index], wordIndex: index, isAnimating };
}

export function HeroChat() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const { currentWord, wordIndex, isAnimating } =
    useRotatingWord(prefersReducedMotion);

  const colorClass = COLOR_CYCLE[wordIndex % COLOR_CYCLE.length];

  const slideStyle = prefersReducedMotion
    ? undefined
    : {
        transition:
          "transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease",
        transform: isAnimating ? "translateY(-110%)" : "translateY(0)",
        opacity: isAnimating ? 0 : 1,
      };

  return (
    <section className="px-4 py-10 md:py-16">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">
          <span className="block text-foreground/55">
            Can you see my fantasy leagues?
          </span>
          <span className="mt-4 block text-foreground md:mt-5">
            Yes, your{" "}
            <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
              <span
                className={`inline-block transition-colors duration-500 ${colorClass}`}
                style={slideStyle}
              >
                {currentWord}
              </span>
            </span>
            .
          </span>
        </h1>
        <p className="max-w-xl text-lg leading-7 text-foreground/70 md:text-xl md:leading-8">
          Flaim connects ChatGPT, Claude, and Perplexity to ESPN, Yahoo, and
          Sleeper. Ask about start/sit decisions, waiver wire targets, and
          what matters in your league right now.
        </p>
      </div>
    </section>
  );
}
