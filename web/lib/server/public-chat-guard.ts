const INTERNAL_SERVICE_TOKEN_HEADER = "X-Flaim-Internal-Token";

export type PublicChatRunCompletionStatus = "completed" | "error" | "aborted";

function getAuthWorkerUrl(): string {
  const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL?.trim();
  if (!authWorkerUrl) {
    throw new Error("NEXT_PUBLIC_AUTH_WORKER_URL is not configured");
  }

  return authWorkerUrl.replace(/\/+$/, "");
}

function getInternalServiceToken(): string {
  const token = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  if (!token) {
    throw new Error("INTERNAL_SERVICE_TOKEN is not configured");
  }

  return token;
}

export async function acquirePublicChatRun(input: {
  visitorIp: string;
  presetId: string;
  model: string;
  signal?: AbortSignal;
}): Promise<{ runId: string }> {
  const response = await fetch(`${getAuthWorkerUrl()}/internal/public-chat/runs/acquire`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [INTERNAL_SERVICE_TOKEN_HEADER]: getInternalServiceToken(),
    },
    body: JSON.stringify({
      visitorIp: input.visitorIp,
      presetId: input.presetId,
      model: input.model,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "unknown_error" })) as {
      error?: string;
      error_description?: string;
    };
    const error = new Error(body.error_description || body.error || "Failed to acquire public chat run") as Error & {
      status?: number;
      code?: string;
    };
    error.status = response.status;
    error.code = body.error;
    throw error;
  }

  const body = await response.json() as { runId?: string };
  if (!body.runId) {
    throw new Error("Public chat run did not return a runId");
  }

  return { runId: body.runId };
}

export async function completePublicChatRun(input: {
  runId: string;
  status: PublicChatRunCompletionStatus;
  durationMs: number | null;
  errorCode?: string | null;
}): Promise<void> {
  const response = await fetch(
    `${getAuthWorkerUrl()}/internal/public-chat/runs/${input.runId}/complete`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_SERVICE_TOKEN_HEADER]: getInternalServiceToken(),
      },
      body: JSON.stringify({
        status: input.status,
        durationMs: input.durationMs,
        errorCode: input.errorCode ?? null,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "unknown_error" })) as {
      error?: string;
      error_description?: string;
    };
    throw new Error(body.error_description || body.error || "Failed to complete public chat run");
  }
}
