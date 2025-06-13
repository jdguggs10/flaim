export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  JWT_SECRET: string;
}

export class UiHandler {
  constructor(private env: Env) {}

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    switch (url.pathname) {
      case '/':
        return this.serveHomePage(corsHeaders);
      case '/authorize':
        return this.handleAuthorize(request, corsHeaders);
      case '/callback':
        return this.handleCallback(request, corsHeaders);
      case '/login':
        return this.serveLoginPage(corsHeaders);
      default:
        return new Response('Not Found', { 
          status: 404, 
          headers: corsHeaders 
        });
    }
  }

  private serveHomePage(corsHeaders: Record<string, string>): Response {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Fantasy Sports MCP - Authentication</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px; 
            margin: 50px auto; 
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #333; text-align: center; }
        .login-btn {
            display: inline-block;
            background: #24292e;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            margin: 10px auto;
            text-align: center;
            display: block;
            width: fit-content;
        }
        .login-btn:hover { background: #444; }
        .feature-list {
            list-style: none;
            padding: 0;
        }
        .feature-list li {
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        .feature-list li:before {
            content: "✓ ";
            color: #28a745;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏈 Fantasy Sports MCP</h1>
        <p>Secure access to your fantasy sports data through our MCP server.</p>
        
        <h3>Features:</h3>
        <ul class="feature-list">
            <li>Connect to ESPN Fantasy Sports</li>
            <li>Access Yahoo Fantasy Sports (Coming Soon)</li>
            <li>Secure credential management</li>
            <li>OpenAI MCP integration</li>
        </ul>
        
        <a href="/authorize" class="login-btn">🔐 Login with GitHub</a>
        
        <p style="text-align: center; margin-top: 30px; color: #666; font-size: 14px;">
            Your credentials are encrypted and stored securely.<br>
            We never access your fantasy data without your permission.
        </p>
    </div>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html', ...corsHeaders }
    });
  }

  private serveLoginPage(corsHeaders: Record<string, string>): Response {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Login - Fantasy Sports MCP</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 400px; 
            margin: 100px auto; 
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        h2 { color: #333; margin-bottom: 30px; }
        .github-btn {
            display: inline-flex;
            align-items: center;
            background: #24292e;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            gap: 8px;
        }
        .github-btn:hover { background: #444; }
        .github-icon {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }
    </style>
</head>
<body>
    <div class="container">
        <h2>🔐 Secure Login</h2>
        <p style="color: #666; margin-bottom: 30px;">
            Authenticate with GitHub to access your fantasy sports data securely.
        </p>
        
        <a href="/authorize" class="github-btn">
            <svg class="github-icon" viewBox="0 0 16 16">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            Continue with GitHub
        </a>
    </div>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html', ...corsHeaders }
    });
  }

  private async handleAuthorize(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const url = new URL(request.url);
    const state = crypto.randomUUID();
    
    // Store state for verification (in production, use proper storage)
    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', this.env.GITHUB_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', `${url.origin}/callback`);
    authUrl.searchParams.set('scope', 'user:email');
    authUrl.searchParams.set('state', state);

    return Response.redirect(authUrl.toString(), 302);
  }

  private async handleCallback(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      return new Response('Missing authorization code or state', { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    try {
      // Exchange code for access token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.env.GITHUB_CLIENT_ID,
          client_secret: this.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      const tokenData = await tokenResponse.json();
      
      if (tokenData.error) {
        throw new Error(tokenData.error_description || tokenData.error);
      }

      // Get user info
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json',
        },
      });

      const userData = await userResponse.json();

      if (!userData.id) {
        throw new Error('Failed to get user data from GitHub');
      }

      // Generate JWT token
      const { JWTHandler } = await import('./jwt-handler');
      const jwtHandler = new JWTHandler(this.env);
      
      // For demo, all users get free plan initially
      const jwt = await jwtHandler.generateToken(
        userData.id.toString(),
        'free',
        userData.email
      );

      // Return success page with JWT
      const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Authentication Success</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px; 
            margin: 100px auto; 
            padding: 20px;
            text-align: center;
        }
        .success { color: #28a745; font-size: 48px; }
        .token { 
            background: #f8f9fa; 
            padding: 20px; 
            border-radius: 8px; 
            word-break: break-all;
            margin: 20px 0;
            font-family: monospace;
        }
        .copy-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="success">✅</div>
    <h2>Authentication Successful!</h2>
    <p>Welcome, ${userData.name || userData.login}!</p>
    <p>Your JWT token (copy this for MCP configuration):</p>
    <div class="token" id="token">${jwt}</div>
    <button class="copy-btn" onclick="copyToken()">Copy Token</button>
    
    <script>
        function copyToken() {
            const token = document.getElementById('token').textContent;
            navigator.clipboard.writeText(token).then(() => {
                alert('Token copied to clipboard!');
            });
        }
    </script>
</body>
</html>`;

      return new Response(html, {
        headers: { 'Content-Type': 'text/html', ...corsHeaders }
      });

    } catch (error) {
      console.error('OAuth callback error:', error);
      return new Response(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        status: 500,
        headers: corsHeaders
      });
    }
  }
}