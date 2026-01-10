"use client";

type Environment = "development" | "preview" | "production";

const ENV_CONFIG: Record<Environment, { label: string; color: string; textColor: string }> = {
  development: {
    label: "DEV",
    color: "bg-green-500",
    textColor: "text-white",
  },
  preview: {
    label: "PREVIEW",
    color: "bg-yellow-500",
    textColor: "text-black",
  },
  production: {
    label: "PROD",
    color: "bg-red-500",
    textColor: "text-white",
  },
};

function detectEnvironment(): Environment {
  // Check Vercel environment first
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "production") return "production";

  // Fall back to NODE_ENV
  if (process.env.NODE_ENV === "development") return "development";

  return "production";
}

function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

export function EnvironmentBadge() {
  const env = detectEnvironment();
  const config = ENV_CONFIG[env];
  const baseUrl = getBaseUrl();

  return (
    <div className="flex items-center justify-between p-3 bg-card border border-border rounded-lg">
      <div className="flex items-center gap-2">
        <span
          className={`px-2 py-0.5 text-xs font-bold rounded ${config.color} ${config.textColor}`}
        >
          {config.label}
        </span>
        <span className="text-xs text-muted-foreground truncate max-w-[180px]">
          {baseUrl || "loading..."}
        </span>
      </div>
    </div>
  );
}
