import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from 'next/server';
import type { VectorStoreRequest } from '@/types/api-responses';

const openai = new OpenAI();

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

function estimateBase64Bytes(base64: string): number {
  const trimmed = base64.trim();
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding);
}

export async function POST(_request: NextRequest) {
  // Check authentication
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { fileObject } = await _request.json() as VectorStoreRequest;

  if (!fileObject) {
    return NextResponse.json({ error: "fileObject is required" }, { status: 400 });
  }

  try {
    const content = fileObject.content;
    if (typeof content !== 'string') {
      return NextResponse.json({ error: "fileObject.content must be a base64 string" }, { status: 400 });
    }

    const estimatedBytes = estimateBase64Bytes(content);
    if (estimatedBytes > MAX_UPLOAD_BYTES) {
      return NextResponse.json({
        error: "File too large",
        maxBytes: MAX_UPLOAD_BYTES
      }, { status: 413 });
    }

    const fileBuffer = Buffer.from(fileObject.content, "base64");
    const fileBlob = new Blob([fileBuffer], {
      type: "application/octet-stream",
    });

    const file = await openai.files.create({
      file: new File([fileBlob], fileObject.name),
      purpose: "assistants",
    });

    return NextResponse.json(file, { status: 200 });
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json({ error: "Error uploading file" }, { status: 500 });
  }
}
