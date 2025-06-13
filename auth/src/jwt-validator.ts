/**
 * Shared JWT Validator
 * Can be used by other services to validate JWTs minted by the auth service
 */

import { jwtVerify } from 'jose';

export interface JWTPayload {
  sub: string; // Stripe customer ID
  email: string;
  plan: 'pro';
  exp: number;
  iat: number;
  iss: 'flaim-auth';
  aud: 'flaim-platform';
}

export class JWTValidator {
  private jwtSecret: Uint8Array;

  constructor(jwtSecret: string) {
    this.jwtSecret = new TextEncoder().encode(jwtSecret);
  }

  /**
   * Verify JWT token locally (without calling auth service)
   */
  async verifyToken(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecret, {
        issuer: 'flaim-auth',
        audience: 'flaim-platform',
        clockTolerance: 60
      });

      return payload as JWTPayload;
    } catch (error) {
      throw new Response(JSON.stringify({
        error: 'Invalid token',
        message: error instanceof Error ? error.message : 'Token verification failed'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Extract JWT from Authorization header or cookie
   */
  extractToken(request: Request): string | null {
    // Check Authorization header first
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Check for HttpOnly cookie
    const cookieHeader = request.headers.get('Cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/Auth=([^;]+)/);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Validate token and extract user info from request
   */
  async authenticateRequest(request: Request): Promise<JWTPayload> {
    const token = this.extractToken(request);
    
    if (!token) {
      throw new Response(JSON.stringify({
        error: 'Authentication required',
        message: 'Bearer token required'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return await this.verifyToken(token);
  }

  /**
   * Middleware function for services that need auth
   */
  async requireAuth(request: Request, handler: (request: Request, user: JWTPayload) => Promise<Response>): Promise<Response> {
    try {
      const user = await this.authenticateRequest(request);
      return await handler(request, user);
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      
      return new Response(JSON.stringify({
        error: 'Authentication failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}