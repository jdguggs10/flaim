import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { EspnCredentialsResponse, OnboardingStatusRequest } from '@/types/api-responses';

export const runtime = 'edge';

export async function GET(_request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // For now, we'll determine onboarding status based on existing data
    // In the future, this could query a database for stored onboarding state
    
    // Check if user has ESPN credentials stored
    let hasEspnCredentials = false;
    try {
      const espnCheckResponse = await fetch(`${process.env.NEXTJS_URL}/api/auth/espn/status`, {
        headers: {
          Cookie: _request.headers.get('cookie') || '',
        },
        cache: 'no-store',
      });
      
      if (espnCheckResponse.ok) {
        const espnData = await espnCheckResponse.json() as EspnCredentialsResponse;
        hasEspnCredentials = espnData.hasCredentials || false;
      }
    } catch (error) {
      console.log('Could not check ESPN credentials status:', error);
    }

    // Determine onboarding step based on available data
    let step = 'NOT_STARTED';
    let isComplete = false;

    if (hasEspnCredentials) {
      // If they have ESPN credentials, they've completed basic setup
      step = 'COMPLETED';
      isComplete = true;
    }

    return NextResponse.json({
      success: true,
      onboarding: {
        step,
        isComplete,
        hasEspnCredentials,
        userId
      }
    });

  } catch (error) {
    console.error('Onboarding status error:', error);
    return NextResponse.json(
      { error: 'Failed to get onboarding status' }, 
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { step, isComplete } = await request.json() as OnboardingStatusRequest;

    // For now, we'll just log the onboarding completion
    // In the future, this could store the completion status in a database
    console.log(`User ${userId} onboarding update:`, { step, isComplete });

    return NextResponse.json({
      success: true,
      message: 'Onboarding status updated',
      step,
      isComplete
    });

  } catch (error) {
    console.error('Onboarding status update error:', error);
    return NextResponse.json(
      { error: 'Failed to update onboarding status' }, 
      { status: 500 }
    );
  }
}