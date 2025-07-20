import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { PlatformCredentialsRequest } from '@/types/api-responses';

export const runtime = 'edge';

export async function POST(_request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { platform } = await _request.json() as PlatformCredentialsRequest;

    if (!platform || !['ESPN', 'Yahoo'].includes(platform)) {
      return NextResponse.json({ error: 'Invalid platform selection' }, { status: 400 });
    }

    // For now, we'll just return success since we're storing in the client-side store
    // In the future, this could store the selection in a database
    console.log(`User ${userId} selected platform: ${platform}`);

    return NextResponse.json({ 
      success: true, 
      platform,
      message: `${platform} platform selected successfully`
    });

  } catch (error) {
    console.error('Platform selection error:', error);
    return NextResponse.json(
      { error: 'Failed to process platform selection' }, 
      { status: 500 }
    );
  }
}