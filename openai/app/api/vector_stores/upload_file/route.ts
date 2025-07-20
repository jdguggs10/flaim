import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from 'next/server';
import type { VectorStoreRequest } from '@/types/api-responses';

export const runtime = 'edge';

const openai = new OpenAI();

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
