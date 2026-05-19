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

const HERO_WORD_COLORS = [
  "text-sky-600 dark:text-cyan-300 dark:drop-shadow-[0_0_18px_rgba(103,232,249,0.45)]",
  "text-violet-600 dark:text-fuchsia-300 dark:drop-shadow-[0_0_18px_rgba(240,171,252,0.4)]",
  "text-emerald-600 dark:text-lime-300 dark:drop-shadow-[0_0_18px_rgba(190,242,100,0.38)]",
  "text-rose-600 dark:text-rose-300 dark:drop-shadow-[0_0_18px_rgba(253,164,175,0.42)]",
  "text-amber-600 dark:text-yellow-300 dark:drop-shadow-[0_0_18px_rgba(253,224,71,0.38)]",
  "text-blue-600 dark:text-sky-300 dark:drop-shadow-[0_0_18px_rgba(125,211,252,0.4)]",
  "text-teal-600 dark:text-teal-300 dark:drop-shadow-[0_0_18px_rgba(94,234,212,0.38)]",
  "text-orange-600 dark:text-orange-300 dark:drop-shadow-[0_0_18px_rgba(253,186,116,0.4)]",
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

  const colorClass = HERO_WORD_COLORS[wordIndex % HERO_WORD_COLORS.length];

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
          Connect ChatGPT to ESPN, Yahoo, and Sleeper. Ask about your actual
          roster, matchup, standings, free agents, league history, and more.
        </p>
      </div>
    </section>
  );
}
