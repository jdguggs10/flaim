"use client";

import { useEffect, useState, useRef } from "react";

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

type Variant = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";

const VARIANT_LABELS: Record<Variant, string> = {
  A: "A: Soft pill",
  B: "B: Underline",
  C: "C: Gradient text",
  D: "D: Outline pill",
  E: "E: No decoration",
  F: "F: Typewriter",
  G: "G: Highlighter",
  H: "H: Scramble",
  I: "I: Flip card",
  J: "J: Glow",
};

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

function useRotatingWord(
  prefersReducedMotion: boolean,
  mode: "slide" | "typewriter" | "scramble",
) {
  const [index, setIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  // Typewriter state
  const [displayedChars, setDisplayedChars] = useState(
    ROTATING_WORDS[0].length,
  );
  const [isDeleting, setIsDeleting] = useState(false);
  // Scramble state
  const [scrambleText, setScrambleText] = useState(ROTATING_WORDS[0]);
  const scrambleRef = useRef<number | null>(null);

  // Slide animation
  useEffect(() => {
    if (prefersReducedMotion || mode !== "slide") return;

    const interval = window.setInterval(() => {
      setIsAnimating(true);
      const exitTimer = window.setTimeout(() => {
        setIndex((i) => (i + 1) % ROTATING_WORDS.length);
        setIsAnimating(false);
      }, 300);
      return () => window.clearTimeout(exitTimer);
    }, 2400);

    return () => window.clearInterval(interval);
  }, [prefersReducedMotion, mode]);

  // Typewriter animation
  useEffect(() => {
    if (prefersReducedMotion || mode !== "typewriter") return;

    const word = ROTATING_WORDS[index];

    if (!isDeleting && displayedChars < word.length) {
      const t = window.setTimeout(
        () => setDisplayedChars((c) => c + 1),
        60 + Math.random() * 40,
      );
      return () => window.clearTimeout(t);
    }

    if (!isDeleting && displayedChars === word.length) {
      const t = window.setTimeout(() => setIsDeleting(true), 1800);
      return () => window.clearTimeout(t);
    }

    if (isDeleting && displayedChars > 0) {
      const t = window.setTimeout(
        () => setDisplayedChars((c) => c - 1),
        35,
      );
      return () => window.clearTimeout(t);
    }

    if (isDeleting && displayedChars === 0) {
      setIsDeleting(false);
      setIndex((i) => (i + 1) % ROTATING_WORDS.length);
    }
  }, [prefersReducedMotion, mode, index, displayedChars, isDeleting]);

  useEffect(() => {
    if (mode === "typewriter" && !isDeleting) {
      setDisplayedChars(0);
    }
  }, [index, mode, isDeleting]);

  // Scramble animation
  useEffect(() => {
    if (prefersReducedMotion || mode !== "scramble") return;

    const interval = window.setInterval(() => {
      setIsAnimating(true);

      const nextIndex = (index + 1) % ROTATING_WORDS.length;
      const target = ROTATING_WORDS[nextIndex];
      const chars = "abcdefghijklmnopqrstuvwxyz";
      let tick = 0;
      const totalTicks = 8;

      if (scrambleRef.current) window.clearInterval(scrambleRef.current);

      scrambleRef.current = window.setInterval(() => {
        tick++;
        if (tick >= totalTicks) {
          setScrambleText(target);
          setIndex(nextIndex);
          setIsAnimating(false);
          if (scrambleRef.current) window.clearInterval(scrambleRef.current);
          return;
        }

        // Progressively reveal correct characters
        const revealed = Math.floor((tick / totalTicks) * target.length);
        let result = "";
        for (let i = 0; i < target.length; i++) {
          if (i < revealed) {
            result += target[i];
          } else if (target[i] === " ") {
            result += " ";
          } else {
            result += chars[Math.floor(Math.random() * chars.length)];
          }
        }
        setScrambleText(result);
      }, 50);
    }, 2400);

    return () => {
      window.clearInterval(interval);
      if (scrambleRef.current) window.clearInterval(scrambleRef.current);
    };
  }, [prefersReducedMotion, mode, index]);

  return {
    currentWord: ROTATING_WORDS[index],
    isAnimating,
    displayedChars,
    scrambleText,
  };
}

function RotatingWord({
  variant,
  currentWord,
  isAnimating,
  displayedChars,
  scrambleText,
  prefersReducedMotion,
}: {
  variant: Variant;
  currentWord: string;
  isAnimating: boolean;
  displayedChars: number;
  scrambleText: string;
  prefersReducedMotion: boolean;
}) {
  const slideStyle = prefersReducedMotion
    ? undefined
    : {
        transition:
          "transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease",
        transform: isAnimating ? "translateY(-110%)" : "translateY(0)",
        opacity: isAnimating ? 0 : 1,
      };

  if (variant === "F") {
    const partial = currentWord.slice(0, displayedChars);
    return (
      <>
        <span className="text-primary">{partial}</span>
        <span
          className="ml-0.5 inline-block h-[0.85em] w-[3px] translate-y-[0.1em] rounded-full bg-primary/70"
          style={
            prefersReducedMotion
              ? undefined
              : { animation: "hero-cursor-blink 0.8s step-end infinite" }
          }
        />
      </>
    );
  }

  if (variant === "A") {
    return (
      <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
        <span
          className="inline-block rounded-lg bg-primary/10 px-2.5 py-0.5 text-primary dark:bg-primary/15"
          style={slideStyle}
        >
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "B") {
    return (
      <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
        <span
          className="inline-block border-b-[3px] border-primary/50 pb-0.5 text-foreground"
          style={slideStyle}
        >
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "C") {
    return (
      <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
        <span
          className="inline-block bg-gradient-to-r from-blue-500 via-violet-500 to-purple-500 bg-clip-text text-transparent dark:from-blue-400 dark:via-violet-400 dark:to-purple-400"
          style={slideStyle}
        >
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "D") {
    return (
      <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
        <span
          className="inline-block rounded-lg border-2 border-primary/30 px-2.5 py-0.5 text-primary"
          style={slideStyle}
        >
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "E") {
    return (
      <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
        <span className="inline-block text-primary" style={slideStyle}>
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "G") {
    // Highlighter — yellow marker stroke behind the word
    return (
      <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
        <span className="relative inline-block" style={slideStyle}>
          <span
            className="absolute inset-x-[-4px] bottom-[0.05em] top-[0.35em] -skew-x-2 rounded-sm bg-yellow-300/50 dark:bg-yellow-400/30"
            aria-hidden
          />
          <span className="relative text-foreground">{currentWord}</span>
        </span>
      </span>
    );
  }

  if (variant === "H") {
    // Scramble — letters randomize then settle
    return (
      <span className="inline-block font-mono text-primary">
        {scrambleText}
      </span>
    );
  }

  if (variant === "I") {
    // Flip card — 3D Y-axis rotation
    return (
      <span
        className="inline-block text-primary"
        style={
          prefersReducedMotion
            ? undefined
            : {
                transition:
                  "transform 0.5s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease",
                transform: isAnimating ? "rotateX(90deg)" : "rotateX(0deg)",
                opacity: isAnimating ? 0 : 1,
                transformOrigin: "bottom",
              }
        }
      >
        {currentWord}
      </span>
    );
  }

  // J: Glow — soft text shadow pulse
  return (
    <span
      className="inline-block text-primary"
      style={
        prefersReducedMotion
          ? undefined
          : {
              animation: "hero-glow-pulse 2.4s ease-in-out infinite",
              ...slideStyle,
            }
      }
    >
      {currentWord}
    </span>
  );
}

export function HeroChat() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [variant, setVariant] = useState<Variant>("A");

  const mode =
    variant === "F"
      ? ("typewriter" as const)
      : variant === "H"
        ? ("scramble" as const)
        : ("slide" as const);

  const { currentWord, isAnimating, displayedChars, scrambleText } =
    useRotatingWord(prefersReducedMotion, mode);

  return (
    <>
      {/* Variant switcher — sticky bar */}
      <div className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center gap-1.5 overflow-x-auto px-4 py-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            Style:
          </span>
          {(Object.keys(VARIANT_LABELS) as Variant[]).map((v) => (
            <button
              key={v}
              onClick={() => setVariant(v)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                variant === v
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {VARIANT_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      <section className="px-4 py-10 md:py-16">
        <div className="mx-auto max-w-2xl">
          <h1 className="mb-5 text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">
            <span className="block text-foreground/55">
              Can you see my fantasy leagues?
            </span>
            <span className="mt-2 block text-foreground md:mt-3">
              Yes, your{" "}
              <RotatingWord
                variant={variant}
                currentWord={currentWord}
                isAnimating={isAnimating}
                displayedChars={displayedChars}
                scrambleText={scrambleText}
                prefersReducedMotion={prefersReducedMotion}
              />
              {variant !== "F" && "."}
            </span>
          </h1>
          <p className="max-w-xl text-lg leading-7 text-foreground/70 md:text-xl md:leading-8">
            Flaim connects ChatGPT, Claude, and Perplexity to ESPN, Yahoo, and
            Sleeper. Ask about start/sit decisions, waiver wire targets, and
            what matters in your league right now.
          </p>
          <div className="mt-8 h-px w-24 bg-border/60" />
        </div>
      </section>
    </>
  );
}
