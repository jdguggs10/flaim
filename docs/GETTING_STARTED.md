# Getting Started with FLAIM v6.0

**FLAIM (Fantasy League AI Manager)** is your AI-powered fantasy sports assistant with modular authentication, usage limits, and multi-sport ESPN integration through MCP (Model Context Protocol) tools.

## What is FLAIM?

FLAIM revolutionizes fantasy sports management by providing:
- **AI-powered chat assistant** for fantasy sports questions
- **Free tier**: 100 AI messages per month
- **Multi-sport ESPN integration** for baseball and football
- **Cross-platform authentication** ready for web and iOS
- **Open MCP access** for external AI assistants

Instead of juggling multiple apps and spreadsheets, you can ask natural language questions like:
- *"How did my team perform this week?"*
- *"Who should I start at shortstop today?"*
- *"Analyze this trade proposal for me"*

## Quick Start (10 minutes)

### What You'll Need

1. **Email address** for account creation
2. **[OpenAI API key](https://platform.openai.com/docs/api-reference/authentication)** (for AI chat)
3. **[Cloudflare Workers account](https://developers.cloudflare.com/workers/get-started/guide/)** (free tier)
4. **ESPN Fantasy league** (optional, for private leagues)
5. **[Cloudflare KV namespace](https://developers.cloudflare.com/kv/get-started/)** (for secure credential storage)
6. **[Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)** (`npm install -g wrangler`)

### Step 1: Set Up Authentication

1. Create a **[Clerk account](https://clerk.com/docs/quickstarts/setup-clerk)**
2. Create a new application in Clerk dashboard
3. Get your **Publishable Key** and **Secret Key**
4. Configure sign-in options (email/password recommended)

### Step 2: Install Dependencies & Build Artifacts

```bash
# Clone the repository
git clone https://github.com/yourusername/flaim
cd flaim

# Install all dependencies from monorepo root
npm install

# Build all production artifacts. This is required before deploying.
./build.sh

# The build script creates:
# - Compiled auth module with scoped imports (@flaim/auth/*)
# - Next.js production build adapted for Cloudflare Pages
# - Type-checked worker artifacts
```

### Step 3: Interactive Development & Deployment

The `./start.sh` script is the single entry point for all development and deployment workflows. It will guide you through running services locally or deploying them to Cloudflare.

```bash
# Use the interactive orchestrator for all workflows
./start.sh

# The launcher will prompt you to choose a mode:
# ▶  Deployment Mode Selection
#     1) Local dev          (all services run locally)
#     2) Remote dev         (deploy workers + frontend to dev)
#     3) Deploy prod        (deploy workers + frontend to production)
#     0) Custom             (configure each worker individually)

# For local development, choose option 1 (dev).
# For production deployment, choose option 3.

# Before deploying (options 3/4), ensure you have:
# 1. Set CF_ACCOUNT_ID environment variable
# 2. Configure secrets for each worker you're deploying
```

### Step 3a: Configure Secrets (For Deployment)

```bash
# Required for all workers being deployed:
export CF_ACCOUNT_ID=your-cloudflare-account-id  # Get from: wrangler whoami

# For auth worker:
cd workers/auth-worker
wrangler secret put ENCRYPTION_KEY      # Generate: openssl rand -base64 32
wrangler secret put CLERK_SECRET_KEY    # sk_test_... from Clerk dashboard

# For baseball worker:
cd ../baseball-espn-mcp
wrangler secret put ENCRYPTION_KEY      # Same key as auth worker
wrangler secret put CLERK_SECRET_KEY    # Same key as auth worker

# For football worker:
cd ../football-espn-mcp
wrangler secret put ENCRYPTION_KEY      # Same key as auth worker
wrangler secret put CLERK_SECRET_KEY    # Same key as auth worker

cd ../..  # Return to root for interactive launcher
```

### Step 4: Configure and Deploy Frontend

The frontend is designed for Cloudflare Pages. Configuration is managed via three files in the `openai/` directory: `.env.local` (local development), `wrangler.jsonc` (Pages configuration), and secrets for sensitive data.

1.  **Configure Local Environment**:
    ```bash
    cd openai
    cp .env.example .env.local
    ```
    Fill in `.env.local` with your `OPENAI_API_KEY` and Clerk keys for local development.

2.  **Configure Production Environment (`wrangler.jsonc`)**:
    - Open `openai/wrangler.jsonc`.
    - Under the `vars` and `env.preview.vars` sections, add the required `NEXT_PUBLIC_*` variables, such as your Clerk publishable key and the URLs of your deployed workers.

3.  **Set Production Secrets**:
    - Use the `wrangler pages secret put` command to add your `OPENAI_API_KEY` and `CLERK_SECRET_KEY` to your Pages project.

4.  **Deploy**:
    - The `build.sh` script provides the easiest way to deploy.
    ```bash
    # From the project root
    ./build.sh --remote-dev   # Deploy to the preview branch
    ./build.sh --remote-prod  # Deploy to the main branch
    ```
    - For detailed manual deployment steps, see the [Deployment Guide](DEPLOYMENT.md).

### Step 5: Create Your Account

1. Visit your FLAIM application
2. Click **"Sign Up"** to create your account
3. Complete Clerk registration flow
4. You'll start with **15 free AI messages**

### Step 6: Start Chatting!

Ask your AI assistant:
> *"Hello! Help me understand my fantasy baseball team performance."*

For private league access, configure ESPN credentials in the tools panel.

## What's New in v5.0

### 🏗️ **Monorepo Architecture**
- **True NPM workspace**: Root package.json with proper dependency hoisting
- **Single Next.js instance**: Eliminates duplicate dependencies and type conflicts
- **Separated build targets**: Shared, workers, and web code compile independently
- **Scoped imports**: Clean `@flaim/auth/*` imports instead of relative paths
- **Client/server separation**: Prevents "server-only" errors in React components

### 🔗 **Import Cheatsheet**

| Target | Example Import |
|--------|---------------|
| **Next.js Components** | `import { ClerkProvider, useAuth } from '@flaim/auth/web/components'` |
| **API Routes** | `import { withAuth, requireAuth } from '@flaim/auth/web/server'` |
| **Middleware** | `import { clerkMiddleware } from '@flaim/auth/web/middleware'` |
| **Workers** | `import { EspnStorage } from '@flaim/auth/workers/espn/storage'` |
| **Shared Logic** | `import { UsageTracker } from '@flaim/auth/shared'` |

### 🚀 **Developer Experience**
- **ESLint v9 compatible**: Modern linting with typescript-eslint v8
- **Type-safe auth wrappers**: Explicit union types for all response shapes
- **TypeScript path mapping**: Automatic import resolution across monorepo
- **Hot reloading**: Changes reflect immediately in development
- **Consistent API**: Same auth interface across all platforms

## Key Features

### 🔐 Production-Grade Authentication
- **Server-side [Clerk](https://clerk.com/docs) verification** for secure credential storage
- **Anti-spoofing protection** - user identity verified server-side
- **Social logins** (Google, GitHub, etc.)
- **Session management** with automatic renewal and validation

### 💬 AI Chat Assistant
- **[OpenAI](https://platform.openai.com/docs) integration** for natural language conversations
- **Fantasy sports expertise** built into prompts
- **Context-aware** responses about your teams

### 📊 Usage Management
- **Free tier**: 100 messages per month
- **Usage tracking** with real-time dashboard
- **Upgrade options** for unlimited access
- **Automatic reset** every 30 days

### ⚾ ESPN Integration
- **Manual league entry**: Add up to 10 ESPN leagues with credentials
- **Auto-pull team setup**: Automatically fetch league data and team selection
- **Real-time data** from ESPN API  
- **MCP tools** for external AI assistants

## User Experience Flow

### New User Journey
```
1. Visit FLAIM → Welcome screen
2. Click "Sign Up" → Clerk registration
3. Account created → Start with 15 free messages
4. Optional: Add ESPN credentials for private leagues
5. Chat with AI about fantasy sports
```

### Free Tier Experience
```
1. Sign in → See usage dashboard (X/15 messages)
2. Ask fantasy questions → Get AI responses
3. Approaching limit → See upgrade prompts
4. Limit reached → Upgrade or wait for reset
```

### ESPN League Setup
```
1. Complete account setup → Access league management
2. Click "Add League" → Select sport (Baseball, Football, etc.)
3. Enter league ID, ESPN S2 and SWID cookies
4. Save league → Credentials encrypted and stored securely
5. Use "Auto-pull" → Fetch league data and select your team
6. 🎉 AI can now access your league data for insights
```

## Example Conversations

### Getting Started
**You:** *"I'm new to fantasy baseball. Can you help me understand the basics?"*

**AI:** *"Welcome to fantasy baseball! I can help you understand scoring, lineup management, and strategy. Do you have a league set up on ESPN? If so, I can analyze your specific team and league settings."*

### League Analysis (Public)
**You:** *"Can you look up information about ESPN league 12345?"*

**AI:** *"I'll check that league for you... This is a 10-team head-to-head points league with standard scoring. The season runs through week 23. Would you like me to look at specific teams or matchups?"*

### Private League Access  
**You:** *"I want to analyze my private league team. How do you give you access?"*

**AI:** *"To access your ESPN league, complete the league setup flow. Click 'Add League', select your sport, enter your league ID along with your S2 and SWID cookies. You can add up to 10 leagues. Use the 'Auto-pull' feature to fetch league data and identify your team automatically!"*

### Usage Awareness
**You:** *"How many messages do I have left this month?"*

**AI:** *"You can check your usage in the panel on the right. As a free user, you get 15 messages per month. You can upgrade anytime for unlimited conversations about your fantasy teams!"*

## ESPN Credential Setup

### For Private League Access

1. **Get ESPN Cookies**:
   - Log into [ESPN Fantasy Sports](https://fantasy.espn.com)
   - Open Developer Tools (`F12` or right-click → Inspect)
   - Go to Application tab → Cookies → `https://fantasy.espn.com`
   - Copy `espn_s2` and `SWID` values

2. **Store in FLAIM**:
   - Complete onboarding to access league management
   - Click "Add League" and select your sport
   - Enter league ID and paste your credentials
   - They're encrypted and stored securely per user

3. **What You Get**:
   - **Manual league management** - add up to 10 leagues across all sports
   - **Auto-pull team setup** - automatically identify your team
   - Access to your league data and standings
   - Team roster analysis
   - Lineup optimization suggestions
   - Trade evaluation help

## MCP Integration for External AIs

### For Claude Desktop, ChatGPT, etc.

Configure external AI assistants to use your MCP server:

```json
{
  "type": "mcp",
  "server_label": "fantasy-baseball",
  "server_url": "https://your-mcp-service.workers.dev/mcp",
  "allowed_tools": [
    "get_espn_league_info",
    "get_espn_team_roster", 
    "get_espn_matchups"
  ],
  "require_approval": "never"
}
```

### Available MCP Tools

- **`get_espn_league_info`**: League settings and metadata
- **`get_espn_team_roster`**: Detailed team roster information  
- **`get_espn_matchups`**: Current week matchups and scores

## Tips for Better Results

### Be Specific with Requests
❌ *"How's my team?"*  
✅ *"How did my team perform this week in my ESPN league?"*

### Provide Context
❌ *"Who should I start?"*  
✅ *"Based on this week's matchups, who should I start at 2B and OF?"*

### Use Your Free Messages Wisely
❌ Multiple simple questions  
✅ *"Give me a comprehensive analysis of my team's performance, lineup optimization suggestions, and trade targets for this week"*

### Take Advantage of ESPN Integration
✅ *"Compare the stats of my starting pitchers with available waiver wire options"*  
✅ *"Analyze the trade value of players on my bench"*

## Troubleshooting

### Authentication Issues
**Problem**: Can't sign in or session expired  
**Solution**: 
- Check Clerk configuration in environment variables
- Clear browser cache and cookies
- Try incognito/private browsing mode

### Usage Limit Reached
**Problem**: "Free tier limit exceeded" message  
**Solution**:
- Upgrade to paid plan for unlimited messages
- Wait for monthly reset (shown in usage panel)
- Use external AI assistants with MCP integration

### ESPN Access Problems
**Problem**: "ESPN credentials not found" or API errors  
**Solution**:
- Re-enter ESPN credentials (they may have expired)
- Check that you're a member of the private league
- Verify league ID is correct
- Try accessing a public league first to test

### MCP Connection Issues
**Problem**: External AI can't connect to MCP server  
**Solution**:
- Verify MCP service is deployed and healthy
- Check the server URL in your AI assistant configuration
- Test with `curl https://your-service.workers.dev/mcp`

## Upgrade Options

### Paid Plan Benefits
- **Unlimited AI messages** per month
- **Priority support** and feature access
- **Advanced analytics** (coming soon)
- **Multi-league management** tools

### How to Upgrade
1. Use upgrade button in usage panel
2. Payment processing via Stripe (secure)
3. Instant access to unlimited messaging
4. Cancel anytime

## What's Next?

### Planned Features
- **Yahoo Fantasy Sports** integration
- **NFL and NBA** fantasy tools
- **Advanced analytics** and projections
- **League comparison** tools
- **Mobile-optimized** interface
- **Team collaboration** features

### Community & Support
- **GitHub**: [github.com/your-repo/flaim](https://github.com)
- **Documentation**: Comprehensive guides and API reference
- **Feature Requests**: Submit ideas and vote on improvements
- **Discord**: Community chat and support

## Advanced Setup

### Custom Domain
Deploy with your own domain for branded experience:
```bash
# Configure custom domain in Vercel/Cloudflare
# Update CORS settings for your domain
# Configure Clerk allowed origins
```

### Database Integration
Replace in-memory usage tracking with persistent storage. See the [Hono documentation](https://hono.dev/guides/best-practices#database) for best practices on database integration.

### Payment Integration
Set up Stripe for automated plan management:
```bash
# Configure Stripe webhooks
# Implement plan upgrade/downgrade automation
# Add billing portal for users
```

---

## Support & Resources

### Documentation
- **[ARCHITECTURE.md](./ARCHITECTURE.md)**: Technical overview and system design
- **[DEPLOYMENT.md](./DEPLOYMENT.md)**: Detailed deployment instructions
- **API Reference**: MCP tool schemas and endpoints

### Getting Help
- **GitHub Issues**: Report bugs and request features
- **Community Support**: Connect with other FLAIM users
- **Email Support**: Direct contact with maintainers

### Contributing
- **Open Source**: Full codebase available on GitHub
- **Pull Requests**: Contribute improvements and fixes
- **Feature Development**: Help build new integrations

---

**Ready to transform your fantasy sports experience?** 

Set up your FLAIM assistant in 10 minutes and start having AI-powered conversations about your fantasy teams with modern authentication and usage management!