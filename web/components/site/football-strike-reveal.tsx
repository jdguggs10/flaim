"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FIRST_ROW_START = 0.12;
const ROW_STEP = 0.125;
const OLD_LINE_DURATION = 0.09;
const NEW_TEXT_OFFSET = 0.075;
const NEW_TEXT_DURATION = 0.065;

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, value));
}

function rangeProgress(progress: number, start: number, duration: number) {
  return clampProgress((progress - start) / duration);
}

export function FootballStrikeReveal({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-football-strike-row]"),
    );
    let animationFrame = 0;

    const updateProgress = () => {
      animationFrame = 0;

      const bounds = container.getBoundingClientRect();
      const coverDistance = window.innerHeight + bounds.height;
      const sectionProgress = clampProgress(
        (window.innerHeight - bounds.top) / coverDistance,
      );

      rows.forEach((row, index) => {
        const rowStart = FIRST_ROW_START + index * ROW_STEP;
        const oldProgress = rangeProgress(
          sectionProgress,
          rowStart,
          OLD_LINE_DURATION,
        );
        const newProgress = rangeProgress(
          sectionProgress,
          rowStart + NEW_TEXT_OFFSET,
          NEW_TEXT_DURATION,
        );

        row.style.setProperty("--strike-old-progress", String(oldProgress));
        row.style.setProperty("--strike-new-progress", String(newProgress));
        row.style.setProperty(
          "--strike-new-offset",
          `${(1 - newProgress) * 0.4}rem`,
        );
      });
    };

    const requestProgressUpdate = () => {
      if (animationFrame) {
        return;
      }

      animationFrame = window.requestAnimationFrame(updateProgress);
    };

    updateProgress();
    container.classList.add(
      "football-strike-ready",
      "football-strike-scroll-controlled",
    );
    window.addEventListener("scroll", requestProgressUpdate, { passive: true });
    window.addEventListener("resize", requestProgressUpdate);

    return () => {
      window.removeEventListener("scroll", requestProgressUpdate);
      window.removeEventListener("resize", requestProgressUpdate);

      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="football-strike-sequence">
      {children}
    </div>
  );
}
