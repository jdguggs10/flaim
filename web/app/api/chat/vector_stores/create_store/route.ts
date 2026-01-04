import OpenAI from "openai";
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import type { VectorStoreRequest } from '@/types/api-responses';

const openai = new OpenAI();

export async function POST(request: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const { name } = await request.json() as VectorStoreRequest;
    
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    
    const vectorStore = await openai.vectorStores.create({
      name,
    });
    return NextResponse.json(vectorStore, { status: 200 });
  } catch (error) {
    console.error("Error creating vector store:", error);
    return NextResponse.json({ error: "Failed to create vector store" }, { status: 500 });
  }
}
