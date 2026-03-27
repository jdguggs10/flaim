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
          "max-w-3xl overflow-hidden rounded-[1.1rem] border px-3 py-3 shadow-sm sm:rounded-[1.35rem] sm:px-4 sm:py-4 lg:rounded-[2rem] lg:px-5",
          isUser
            ? "max-w-[85%] border-primary/15 bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground"
        )}
      >
        <div
          className={cn(
            "prose prose-sm max-w-none prose-p:my-0 prose-ul:my-2 prose-li:my-0 prose-li:marker:text-muted-foreground",
            isUser
              ? "prose-headings:text-primary-foreground prose-strong:text-primary-foreground prose-p:text-primary-foreground prose-li:text-primary-foreground prose-li:marker:text-primary-foreground/70"
              : "prose-headings:text-foreground prose-strong:text-foreground prose-p:text-foreground prose-li:text-foreground"
          )}
        >
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
