# Durable Objects Migration Issues - FLAIM v6.0

> **Research Findings**: Comprehensive analysis of Cloudflare Workers Durable Objects migration challenges and solutions based on July 2025 best practices.

## Problem Statement

During the migration from Durable Objects to KV storage in FLAIM v6.0, production deployments failed with the following error:

```
✘ [ERROR] New version of script does not export class 'EspnStorage' which is depended on by existing Durable Objects.
```

## Root Cause Analysis

### Technical Background

**Durable Objects Persistence**: Cloudflare Workers maintains metadata about Durable Objects classes that have been deployed. When a class is removed from the code without proper migration, the runtime still expects the class to exist for existing object instances.

**Migration Requirement**: According to Cloudflare documentation (July 2025), you must explicitly migrate or delete Durable Objects classes before removing them from your code.

### Why Standard Migration Failed

1. **Legacy Production State**: Production workers contained Durable Objects from earlier deployments
2. **Code Migration**: Code was updated to use KV storage but didn't properly clean up Durable Objects
3. **Binding Dependencies**: Cloudflare runtime maintained references to the removed `EspnStorage` class

## Research Findings (July 2025)

### Current Best Practices

Based on internet research conducted in July 2025:

#### 1. Migration File Format

**Correct syntax** for `migrations.toml`:
```toml
[[migration]]
tag = "v1"
deleted_classes = ["EspnStorage"]
```

**Common mistake**:
```toml
[[migration]]
tag = "v1"
delete_classes = ["EspnStorage"]  # ❌ Wrong syntax
```

#### 2. Binding Removal Requirement

**Critical step**: Must remove Durable Objects bindings before deleting the class:

```json
{
  "env": {
    "prod": {
      "durable_objects": {
        "bindings": []  // ← Must be empty before deletion
      }
    }
  }
}
```

#### 3. Two-Step Migration Process

**Step 1**: Deploy with empty bindings
```json
{
  "durable_objects": {
    "bindings": []
  }
}
```

**Step 2**: Deploy with delete migration
```toml
[[migration]]
tag = "v1"
deleted_classes = ["EspnStorage"]
```

### Alternative Solutions

#### 1. Command Line Migration
```bash
wrangler deploy --env prod --migrations '[{"tag": "v1", "deleted_classes": ["EspnStorage"]}]'
```
**Status**: Not supported in Wrangler 4.25.0 (July 2025)

#### 2. Temporary Class Approach
Add empty class temporarily:
```typescript
export class EspnStorage {
  constructor() {}
  async fetch() {
    return new Response('Deprecated', { status: 410 });
  }
}
```
**Status**: Risky - can cause data corruption

#### 3. Nuclear Option (Recommended)
Delete and recreate workers:
```bash
wrangler delete worker-name --env prod
wrangler deploy --env prod
```
**Status**: Most reliable for complex migrations

## Lessons Learned

### What Works

1. **Clean Slate Approach**: Deleting and recreating workers eliminates all migration complexity
2. **Dependency Order**: Deploy auth worker first, then dependent workers
3. **Domain Configuration**: Ensure domain is properly configured before deployment
4. **Secrets Management**: Use Cloudflare secrets for all sensitive data

### What Doesn't Work

1. **Inline Migration Commands**: Not supported in current Wrangler versions
2. **Temporary Classes**: Can cause data corruption and deployment issues
3. **Ignoring Bindings**: Must remove bindings before deleting classes
4. **Single-Step Migration**: Complex migrations require multiple deployment steps

### 2025 Updates

#### Durable Objects on Free Plan
- SQLite-backed Durable Objects now available on Workers Free plan
- General availability of Storage API methods like `sql.exec`
- Migration system enhanced for better error handling

#### Wrangler Configuration
- Support for both `wrangler.toml` and `wrangler.jsonc`
- Improved migration validation and error messages
- Better support for multi-environment deployments

## Best Practices for Future Migrations

### 1. Migration Strategy

**For Simple Migrations**:
1. Add migration file with proper syntax
2. Remove bindings from configuration
3. Deploy with migration
4. Verify deployment success

**For Complex Migrations**:
1. Test migration in preview environment
2. Document rollback procedures
3. Consider nuclear option for production
4. Verify all dependencies post-migration

### 2. Configuration Management

**Use structured migration files**:
```toml
[[migration]]
tag = "v1"
new_classes = []
deleted_classes = ["LegacyClass"]
renamed_classes = []
```

**Maintain clean environment configurations**:
```json
{
  "env": {
    "prod": {
      "durable_objects": {
        "bindings": []
      }
    }
  }
}
```

### 3. Testing Strategy

**Pre-deployment testing**:
1. Test migration in development
2. Verify in preview environment
3. Document expected behaviors
4. Prepare rollback procedures

**Post-deployment verification**:
1. Health check endpoints
2. Functional testing
3. Performance monitoring
4. Error rate tracking

## Troubleshooting Guide

### Common Errors

**Error**: `Cannot apply --delete-class migration to class 'EspnStorage'`
**Solution**: Remove bindings first, then deploy migration

**Error**: `Could not find zone for 'domain.com'`
**Solution**: Add domain to Cloudflare account and configure DNS

**Error**: `KV namespace not found`
**Solution**: Verify namespace exists and binding is correct

### Diagnostic Commands

```bash
# Check worker status
wrangler deployments list

# Verify KV namespace
wrangler kv:namespace list

# Check worker logs
wrangler tail worker-name

# Test health endpoints
curl https://api.domain.com/worker/health
```

## Future Considerations

### Migration Automation
- Create migration scripts for common scenarios
- Integrate with CI/CD pipelines
- Add automated rollback capabilities

### Documentation
- Maintain migration history
- Document dependency relationships
- Create troubleshooting runbooks

### Monitoring
- Add migration success/failure metrics
- Monitor post-migration performance
- Track error rates during migrations

## Related Resources

- [Cloudflare Durable Objects Migration Docs](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Wrangler Configuration Reference](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Production Deployment Guide](PRODUCTION_DEPLOYMENT_GUIDE.md)

---

**Document Status**: Active  
**Research Date**: 2025-07-18  
**Version**: 1.0.0  
**Covers**: Durable Objects migration challenges and solutions