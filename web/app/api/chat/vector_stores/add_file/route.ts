import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from 'next/server';
import type { VectorStoreRequest } from '@/types/api-responses';

const openai = new OpenAI();

export async function POST(_request: NextRequest) {
  // Check authentication
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { vectorStoreId, fileId } = await _request.json() as VectorStoreRequest;
  
  if (!vectorStoreId || !fileId) {
    return NextResponse.json({ error: "vectorStoreId and fileId are required" }, { status: 400 });
  }
  
  try {
    const vectorStore = await openai.vectorStores.files.create(
      vectorStoreId,
      {
        file_id: fileId,
      }
    );
    return NextResponse.json(vectorStore, { status: 200 });
  } catch (error) {
    console.error("Error adding file:", error);
    return NextResponse.json({ error: "Error adding file" }, { status: 500 });
  }
}
