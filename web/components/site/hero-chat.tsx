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
  "text-[#004dff] dark:text-[#22d3ee] dark:drop-shadow-[0_0_20px_rgba(34,211,238,0.62)]",
  "text-[#d000b8] dark:text-[#ff4fd8] dark:drop-shadow-[0_0_20px_rgba(255,79,216,0.58)]",
  "text-[#009e3d] dark:text-[#a3ff12] dark:drop-shadow-[0_0_20px_rgba(163,255,18,0.56)]",
  "text-[#ff4d00] dark:text-[#ff8a00] dark:drop-shadow-[0_0_20px_rgba(255,138,0,0.58)]",
  "text-[#6a00ff] dark:text-[#b76cff] dark:drop-shadow-[0_0_20px_rgba(183,108,255,0.6)]",
  "text-[#c98a00] dark:text-[#fff04a] dark:drop-shadow-[0_0_20px_rgba(255,240,74,0.54)]",
  "text-[#008b8b] dark:text-[#00f5d4] dark:drop-shadow-[0_0_20px_rgba(0,245,212,0.56)]",
  "text-[#e6002e] dark:text-[#ff4d5e] dark:drop-shadow-[0_0_20px_rgba(255,77,94,0.58)]",
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
