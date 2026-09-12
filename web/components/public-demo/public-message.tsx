"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface PublicMessageProps {
  role: "user" | "assistant";
  text: string;
}

export function PublicMessage({ role, text }: PublicMessageProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "overflow-hidden",
          isUser
            ? "max-w-[88%] rounded-[1.45rem] bg-[var(--phone-user-bubble)] px-4 py-3 text-[var(--phone-user-text)]"
            : "w-full bg-transparent text-[var(--phone-text)]"
        )}
      >
        <div>
          <div
            className={cn(
              "prose prose-sm min-w-0 max-w-none flex-1 text-[length:var(--phone-type-body)] leading-[var(--phone-leading-body)] prose-headings:font-semibold prose-headings:tracking-[-0.02em] prose-h2:text-[clamp(1rem,5.2cqw,1.125rem)] prose-h2:leading-[1.35] prose-h3:text-[clamp(0.95rem,4.9cqw,1.05rem)] prose-h3:leading-[1.4] prose-p:my-0 prose-p:leading-[var(--phone-leading-body)] prose-strong:font-semibold prose-ul:my-2.5 prose-li:my-0.5 prose-li:leading-[var(--phone-leading-body)]",
              isUser
                ? "prose-headings:text-[var(--phone-user-text)] prose-strong:text-[var(--phone-user-text)] prose-p:text-[var(--phone-user-text)] prose-li:text-[var(--phone-user-text)] prose-li:marker:text-[var(--phone-muted)]"
                : "prose-headings:text-[var(--phone-text)] prose-strong:text-[var(--phone-text)] prose-p:text-[var(--phone-text)] prose-li:text-[var(--phone-text)] prose-li:marker:text-[var(--phone-muted)]"
            )}
          >
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
