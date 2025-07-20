/**
 * Legacy API Route - ESPN League Management
 * 
 * This route provides backward compatibility for the old /api/onboarding/leagues endpoint.
 * It redirects to the new ESPN-specific endpoint to maintain compatibility during the transition.
 * 
 * @deprecated Use /api/onboarding/espn/leagues instead
 * @todo Remove this route after one release cycle
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
  // Return deprecation notice for GET requests
  return NextResponse.json({
    error: 'This endpoint is deprecated',
    _deprecated: {
      message: 'This endpoint is deprecated. Use /api/onboarding/espn/leagues instead.',
      newEndpoint: '/api/onboarding/espn/leagues',
      willBeRemovedIn: 'v6.1.0',
      migration: 'The new endpoint uses a different flow. Please update your client to use the new manual entry + auto-pull system.'
    }
  }, { 
    status: 410, // Gone
    headers: {
      'Deprecation': 'true',
      'Sunset': new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days from now
    }
  });
}

export async function POST(request: NextRequest) {
  // Redirect POST requests to the new ESPN-specific endpoint
  const url = new URL('/api/onboarding/espn/leagues', request.url);
  
  try {
    // Forward the request body to the new endpoint
    const body = await request.text();
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward all headers
        ...Object.fromEntries(request.headers.entries()),
      },
      body,
    });

    const data = await response.json() as { [key: string]: any };
    
    // Return the response from the new endpoint with a deprecation warning
    return NextResponse.json({
      ...data,
      _deprecated: {
        message: 'This endpoint is deprecated. Use /api/onboarding/espn/leagues instead.',
        newEndpoint: '/api/onboarding/espn/leagues',
        willBeRemovedIn: 'v6.1.0'
      }
    }, { 
      status: response.status,
      headers: {
        'Deprecation': 'true',
        'Sunset': new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days from now
      }
    });
    
  } catch (error) {
    console.error('Legacy API redirect failed:', error);
    return NextResponse.json({
      error: 'Failed to process request',
      _deprecated: {
        message: 'This endpoint is deprecated. Use /api/onboarding/espn/leagues instead.',
        newEndpoint: '/api/onboarding/espn/leagues'
      }
    }, { status: 500 });
  }
}

// Handle other methods with appropriate deprecation notices
export async function PUT() {
  return NextResponse.json({
    error: 'Method not supported',
    _deprecated: {
      message: 'This endpoint is deprecated. Use /api/onboarding/espn/leagues instead.',
      newEndpoint: '/api/onboarding/espn/leagues'
    }
  }, { 
    status: 405,
    headers: {
      'Deprecation': 'true',
      'Allow': 'GET, POST'
    }
  });
}

export async function DELETE() {
  return NextResponse.json({
    error: 'Method not supported',
    _deprecated: {
      message: 'This endpoint is deprecated. Use /api/onboarding/espn/leagues instead.',
      newEndpoint: '/api/onboarding/espn/leagues'
    }
  }, { 
    status: 405,
    headers: {
      'Deprecation': 'true',
      'Allow': 'GET, POST'
    }
  });
}