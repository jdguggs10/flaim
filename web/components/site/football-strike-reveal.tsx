"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function FootballStrikeReveal({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    container.classList.add("football-strike-ready");

    if (!("IntersectionObserver" in window)) {
      container.classList.add("football-strike-visible");
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          return;
        }

        container.classList.add("football-strike-visible");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.2 },
    );

    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef}>{children}</div>;
}
