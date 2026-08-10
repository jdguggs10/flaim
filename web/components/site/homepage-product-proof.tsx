"use client";

import Image from "next/image";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ProductProofItem {
  id: string;
  name: string;
  title: string;
  description: string;
  placeholderClassName: string;
  videoSrc: string | null;
}

const PRODUCT_PROOF_ITEMS: readonly ProductProofItem[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    title: "Ask about the team you actually manage",
    description:
      "Grade your roster, check your matchup, or compare your team with the rest of the league.",
    placeholderClassName:
      "from-emerald-100 via-white to-emerald-50 dark:from-emerald-950 dark:via-neutral-950 dark:to-emerald-950/70",
    videoSrc: null,
  },
  {
    id: "claude",
    name: "Claude",
    title: "See what is happening across your league",
    description:
      "Review standings, recent moves, league rules, and the players available to add.",
    placeholderClassName:
      "from-orange-100 via-white to-amber-50 dark:from-orange-950 dark:via-neutral-950 dark:to-amber-950/70",
    videoSrc: null,
  },
  {
    id: "perplexity",
    name: "Perplexity",
    title: "Bring your league into your research",
    description:
      "Use your real roster and available players alongside current player research and news.",
    placeholderClassName:
      "from-cyan-100 via-white to-sky-50 dark:from-cyan-950 dark:via-neutral-950 dark:to-sky-950/70",
    videoSrc: null,
  },
];

const ROTATION_INTERVAL_MS = 7000;

export function HomepageProductProof() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (isPaused || prefersReducedMotion) return;

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % PRODUCT_PROOF_ITEMS.length);
    }, ROTATION_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [isPaused]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPaused) {
      video.pause();
      return;
    }

    void video.play().catch(() => {
      setIsPaused(true);
    });
  }, [activeIndex, isPaused]);

  const activeItem = PRODUCT_PROOF_ITEMS[activeIndex];

  return (
    <section
      id="examples"
      aria-labelledby="product-proof-heading"
      className="scroll-mt-20 bg-muted px-4 py-14 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-3xl text-center">
          <h2
            id="product-proof-heading"
            className="text-3xl font-bold tracking-tight"
          >
            Flaim works where you already ask
          </h2>
          <p className="mx-auto mt-3 max-w-2xl leading-7 text-muted-foreground">
            Connect once, then ask ChatGPT, Claude, or Perplexity about your
            roster, matchup, standings, available players, and the rest of your
            league.
          </p>
        </div>

        <div
          className="mx-auto mt-9 grid max-w-4xl gap-6 rounded-[2rem] border bg-background p-3 shadow-sm sm:p-5 md:grid-cols-[minmax(15rem,0.85fr)_minmax(0,1.15fr)] md:gap-8"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          onFocusCapture={() => setIsPaused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setIsPaused(false);
            }
          }}
        >
          <div>
            <div
              className="mb-3 grid grid-cols-3 gap-2 md:hidden"
              role="group"
              aria-label="Choose an AI app example"
            >
              {PRODUCT_PROOF_ITEMS.map((item, index) => {
                const isActive = index === activeIndex;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-pressed={isActive}
                    className={`rounded-full border px-2 py-2 text-xs font-semibold transition-colors motion-reduce:transition-none ${
                      isActive
                        ? "border-foreground/20 bg-muted"
                        : "border-transparent text-muted-foreground hover:border-border"
                    }`}
                  >
                    {item.name}
                  </button>
                );
              })}
            </div>

            <div className="relative mx-auto aspect-[9/16] w-full max-w-[19rem] overflow-hidden rounded-[1.6rem] border bg-primary shadow-lg">
              {activeItem.videoSrc ? (
                <video
                  key={activeItem.id}
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-label={`${activeItem.name} using Flaim Fantasy`}
                >
                  <source src={activeItem.videoSrc} type="video/mp4" />
                </video>
              ) : (
                <div
                  className={`flex h-full flex-col items-center justify-center bg-gradient-to-br p-8 text-center ${activeItem.placeholderClassName}`}
                >
                  <div className="rounded-full border border-foreground/10 bg-background/80 p-4 shadow-sm backdrop-blur">
                    <Image
                      src="/flaim-mark-hero.png"
                      alt=""
                      width={56}
                      height={56}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/55">
                    Video slot ready
                  </p>
                  <p className="mt-3 text-xl font-semibold">
                    {activeItem.name} example
                  </p>
                  <p className="mt-3 max-w-[13rem] text-sm leading-6 text-muted-foreground">
                    The finished iPhone capture will drop into this frame.
                  </p>
                </div>
              )}

              {activeItem.videoSrc ? (
                <button
                  type="button"
                  onClick={() => setIsPaused((current) => !current)}
                  className="absolute bottom-4 right-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label={isPaused ? "Play example" : "Pause example"}
                >
                  {isPaused ? (
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  ) : (
                    <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </div>

            <div className="px-2 pb-2 pt-5 md:hidden" aria-live="polite">
              <p className="font-semibold">{activeItem.title}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {activeItem.description}
              </p>
            </div>
          </div>

          <div className="hidden flex-col justify-center px-1 pb-2 md:flex md:px-0 md:py-4">
            <div
              className="space-y-2"
              role="group"
              aria-label="Choose an AI app example"
            >
              {PRODUCT_PROOF_ITEMS.map((item, index) => {
                const isActive = index === activeIndex;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-pressed={isActive}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors motion-reduce:transition-none ${
                      isActive
                        ? "border-foreground/20 bg-muted"
                        : "border-transparent hover:border-border hover:bg-muted/60"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-4">
                      <span className="font-semibold">{item.name}</span>
                      <span
                        className={`h-2.5 w-2.5 rounded-full transition-colors ${
                          isActive ? "bg-primary" : "bg-border"
                        }`}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mt-2 block text-sm font-medium leading-6">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      {item.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
