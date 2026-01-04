import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from 'next/server';

const openai = new OpenAI();

export async function GET(request: NextRequest) {
  // Check authentication
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const vectorStoreId = searchParams.get("vector_store_id");

  try {
    const vectorStore = await openai.vectorStores.files.list(
      vectorStoreId || ""
    );
    return NextResponse.json(vectorStore, { status: 200 });
  } catch (error) {
    console.error("Error fetching files:", error);
    return NextResponse.json({ error: "Error fetching files" }, { status: 500 });
  }
}
