# Solo Developer Guidelines

> **Critical Context for AI Assistants working with FLAIM**

## Project Reality

**This is a SOLO DEVELOPER'S FIRST PRODUCTION PROJECT**

- 👤 **One person** managing everything (frontend, backend, devops, design)
- 🎓 **Learning project** - First time building production-grade software
- ⏰ **Part-time development** - Limited bandwidth, not a full-time job
- 🎯 **Goal: Ship working product** - Not winning architecture awards

## AI Assistant Principles

### ✅ DO Recommend

**"Boring" Technology:**
- **Next.js** - Industry standard, excellent docs, large community
- **Vercel** - Zero-config deployment, made by Next.js team
- **Clerk** - Managed auth, handles complexity for you
- **Cloudflare Workers** - Serverless, pay-per-use, simple deployment
- **TypeScript** - Mainstream, prevents basic errors
- **Tailwind CSS** - Popular, component-friendly, good docs

**Simple Patterns:**
- Standard REST APIs over GraphQL
- Server components over complex state management
- File-based routing over custom routing
- Environment variables over configuration systems
- Direct database queries over complex ORMs

**Proven Solutions:**
- Copy-paste from official docs over custom implementations
- Use framework defaults over custom configurations
- Follow community best practices over innovative approaches
- Choose solutions with large communities and active support

### ❌ DON'T Recommend

**Complex Architecture:**
- Microservices, domain-driven design, event sourcing
- Custom build tools, webpack configurations
- Complex state management (Redux, Zustand patterns)
- Advanced deployment patterns (blue-green, canary)
- Sophisticated monitoring/observability setups

**Experimental Technology:**
- Beta/alpha versions of anything
- Cutting-edge frameworks or libraries
- Custom authentication systems
- Complex database designs
- Advanced caching strategies

**Enterprise Patterns:**
- Multiple environments beyond dev/preview/prod
- Complex CI/CD pipelines
- Advanced testing strategies
- Performance optimization before it's needed
- Premature abstractions or design patterns

## Specific Guidance Areas

### Architecture Decisions
- **Start with monolith** - Don't suggest microservices
- **Use managed services** - Avoid self-hosting when possible
- **Follow framework patterns** - Don't reinvent wheels
- **Copy working examples** - Adapt existing solutions

### Technology Choices
- **Mainstream over innovative** - Choose boring, proven tech
- **Documentation quality matters** - Good docs > better features
- **Community size matters** - Large community = more help available
- **Hosting simplicity** - Prefer platforms over custom infrastructure

### Development Process
- **Working over perfect** - Ship functional features first
- **Incremental improvements** - Small changes over big refactors
- **Learn one thing at a time** - Don't introduce multiple new concepts
- **Test in production** - Real users > perfect staging environments

### Problem-Solving Approach
1. **Search for existing solutions** - Someone has solved this before
2. **Use official examples** - Framework docs usually have the answer
3. **Ask community** - Stack Overflow, Discord, GitHub discussions
4. **Start simple** - Basic implementation first, improve later
5. **Document decisions** - Write down why you chose something

## Red Flags to Avoid

**When AI suggests these, push back:**
- "You should really consider..." (complex architecture)
- "Best practice is to..." (enterprise patterns)
- "This is more scalable..." (premature optimization)
- "Industry standard is..." (when simpler options exist)
- "You'll need this later..." (YAGNI violations)

**Warning signs in recommendations:**
- Requires learning 3+ new concepts
- Needs custom configuration files
- Involves setting up additional services
- Requires "just a little bit" of DevOps knowledge
- Sounds impressive but you don't understand why you need it

## Success Metrics

**Good recommendations:**
- ✅ Can be implemented in 1-2 hours
- ✅ Uses tools you already know
- ✅ Has clear, step-by-step documentation
- ✅ Doesn't break existing functionality
- ✅ Solves immediate problem without creating new ones

**Bad recommendations:**
- ❌ "Quick refactor" that touches 10+ files
- ❌ "Simple upgrade" that changes build process
- ❌ "Just add this package" that requires configuration
- ❌ "Industry best practice" that you don't understand
- ❌ "Future-proof solution" that's complex today

## Emergency Principles

**When overwhelmed:**
1. **Stop adding features** - Fix what's broken first
2. **Revert to working state** - Git is your friend
3. **Ask for simpler alternatives** - There's usually an easier way
4. **Focus on users** - What do they actually need?
5. **Take breaks** - Complexity decisions are better with fresh perspective

## Technology Stack Constraints

**Current stack is intentionally simple** - see [Architecture Guide](ARCHITECTURE.md) for detailed technology choices.

**Don't suggest adding:**
- Additional databases or backend services
- Complex state management or custom authentication  
- Advanced caching, monitoring, or performance optimizations

## Learning Path

**Focus on mastering current tools first:**
1. Next.js fundamentals and best practices
2. React patterns and hooks
3. TypeScript basics
4. Cloudflare Workers API
5. Basic deployment and debugging

**Don't learn simultaneously:**
- Multiple frameworks
- Advanced architecture patterns
- Complex DevOps concepts
- Performance optimization techniques
- Advanced testing methodologies

---

## For AI Assistants: Key Reminders

- **This developer is learning** - Explain decisions, don't just prescribe
- **Bandwidth is limited** - Suggest the simplest working solution
- **Production experience is new** - Prioritize stability over innovation
- **It's a side project** - Maintenance burden matters more than technical elegance
- **Goal is shipping** - Working product > perfect architecture

**When in doubt, ask:** "Is there a simpler way to solve this problem?"