# FLAIM Test Suite

Comprehensive testing framework for the FLAIM (Fantasy League AI Manager) platform, covering local development, Cloudflare Workers deployment, and inter-service connectivity.

## Test Structure

```
tests/
├── unit/                    # Unit tests for individual modules
│   ├── auth/               # Authentication module tests
│   ├── encryption/         # Encryption utility tests
│   └── league-discovery/   # League discovery tests
├── integration/            # Integration tests between services
│   ├── worker-connectivity/ # Inter-worker communication tests
│   ├── auth-flow/          # End-to-end auth flow tests
│   └── mcp-tools/          # MCP tool integration tests
├── deployment/             # Deployment verification tests
│   ├── local/              # Local development server tests
│   ├── cloudflare/         # Cloudflare Workers deployment tests
│   └── frontend/           # Next.js frontend deployment tests
├── e2e/                    # End-to-end user journey tests
│   ├── user-registration/  # Complete user onboarding flow
│   ├── espn-integration/   # ESPN credential and league discovery
│   └── ai-chat/            # AI chat functionality tests
├── utils/                  # Test utilities and helpers
│   ├── fixtures/           # Test data and mock responses
│   ├── helpers/            # Common test functions
│   └── setup/              # Test environment setup
├── config/                 # Test configuration files
├── scripts/                # Test runner scripts
└── README.md              # This file
```

## Test Categories

### 1. Unit Tests (`/unit`)
Test individual modules and functions in isolation:
- **Authentication**: Clerk integration, token management, session verification
- **Encryption**: AES-GCM credential encryption/decryption
- **League Discovery**: ESPN gambit API integration, data parsing
- **MCP Tools**: Tool implementation and response formatting

### 2. Integration Tests (`/integration`)
Test interactions between different services:
- **Worker Connectivity**: Baseball ↔ Football worker communication
- **Auth Flow**: Frontend → Auth Module → Workers
- **MCP Tools**: Tool calls through the MCP protocol
- **Database Operations**: Durable Object storage and retrieval

### 3. Deployment Tests (`/deployment`)
Verify successful deployment across environments:
- **Local Development**: `wrangler dev` server startup and health
- **Cloudflare Workers**: Production deployment verification
- **Frontend**: Next.js build and deployment validation
- **Environment Variables**: Required secrets and configuration

### 4. End-to-End Tests (`/e2e`)
Complete user journey validation:
- **User Registration**: Sign up → Login → Usage tracking
- **ESPN Integration**: Credential storage → League discovery → Data access
- **AI Chat**: Message sending → Tool execution → Response generation

## Running Tests

### Prerequisites
```bash
# Install dependencies
npm install

# Set up test environment variables
cp tests/config/.env.test.example tests/config/.env.test
# Edit .env.test with your test credentials
```

### Quick Test Commands
```bash
# Run all tests
npm run test

# Run specific test categories
npm run test:unit
npm run test:integration
npm run test:deployment
npm run test:e2e

# Run tests for specific service
npm run test:baseball-worker
npm run test:football-worker
npm run test:frontend

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode (development)
npm run test:watch
```

### Detailed Test Scripts
```bash
# Test local deployment of all services
./scripts/test-local-deployment.sh

# Test Cloudflare deployment
./scripts/test-cloudflare-deployment.sh

# Test inter-worker connectivity
./scripts/test-worker-connectivity.sh

# Run full test suite
./scripts/run-all-tests.sh
```

## Test Environment Setup

### Required Environment Variables
```bash
# Test Clerk Application (use development environment)
TEST_CLERK_PUBLISHABLE_KEY=pk_test_...
TEST_CLERK_SECRET_KEY=sk_test_...

# Test ESPN Credentials (for integration tests)
TEST_ESPN_S2=your-test-espn-s2-cookie
TEST_ESPN_SWID=your-test-swid-cookie

# Test Encryption Key
TEST_ENCRYPTION_KEY=test-32-char-encryption-key-here

# Test OpenAI API (optional, can use mocks)
TEST_OPENAI_API_KEY=sk-test-...

# Deployed Worker URLs (updated after modular migration)
TEST_BASEBALL_WORKER_URL=https://baseball-espn-mcp.gerrygugger.workers.dev
TEST_FOOTBALL_WORKER_URL=https://football-espn-mcp.gerrygugger.workers.dev

# Cloudflare Workers Test Environment
TEST_CLOUDFLARE_ACCOUNT_ID=your-test-account-id
TEST_CLOUDFLARE_API_TOKEN=your-test-api-token
```

### Test Data and Fixtures
- Mock ESPN API responses in `/utils/fixtures/espn/`
- Sample user data in `/utils/fixtures/users/`
- Test league configurations in `/utils/fixtures/leagues/`

## Test Architecture

### Unit Test Framework
- **Framework**: Jest with TypeScript support
- **Mocking**: Jest mocks for external APIs (ESPN, Clerk, OpenAI)
- **Coverage**: Minimum 80% code coverage requirement
- **Isolation**: Each test runs in isolation with fresh mocks

### Integration Test Framework
- **Framework**: Jest + Playwright for browser automation
- **Real Services**: Tests against actual deployed workers (test environment)
- **Network**: Real HTTP requests between services
- **Database**: Uses test Durable Objects namespace

### E2E Test Framework
- **Framework**: Playwright for full browser automation
- **Environment**: Complete test environment deployment
- **User Flows**: Simulates real user interactions
- **Data Cleanup**: Automatic test data cleanup after runs

## Key Test Scenarios

### 1. Worker Deployment Tests
```typescript
describe('Baseball ESPN MCP Worker', () => {
  test('deploys successfully to Cloudflare', async () => {
    // Test wrangler deploy command
    // Verify /health endpoint responds
    // Check MCP capabilities endpoint
  });

  test('handles authentication correctly', async () => {
    // Test Clerk session verification
    // Verify credential storage/retrieval
    // Check error handling for invalid sessions
  });
});
```

### 2. Inter-Worker Connectivity Tests
```typescript
describe('Worker Communication', () => {
  test('both workers use modular EspnStorage correctly', async () => {
    // Test credential storage via shared auth/espn module
    // Verify encryption/decryption works with shared encryption
    // Check user ID validation and isolation
  });

  test('workers share authentication infrastructure', async () => {
    // Verify both workers use same EspnStorage class
    // Test consistent authentication patterns
    // Verify shared encryption module usage
  });
});
```

### 3. League Discovery Integration Tests
```typescript
describe('ESPN League Discovery', () => {
  test('discovers leagues automatically after auth', async () => {
    // Authenticate user with ESPN credentials
    // Call /discover-leagues endpoint
    // Verify correct league data returned
    // Check multi-sport detection works
  });

  test('handles ESPN API errors gracefully', async () => {
    // Test with invalid credentials
    // Test with expired credentials
    // Test with rate limiting scenarios
    // Verify appropriate error messages
  });
});
```

### 4. End-to-End User Journey Tests
```typescript
describe('Complete User Journey', () => {
  test('new user can sign up and discover leagues', async () => {
    // 1. Sign up via Clerk
    // 2. Configure ESPN credentials
    // 3. Auto-discover leagues
    // 4. Ask AI questions about leagues
    // 5. Verify usage tracking works
  });
});
```

## Continuous Integration

### GitHub Actions Workflow
- **On Push**: Run unit and integration tests
- **On PR**: Full test suite including deployment tests
- **Nightly**: E2E tests against production-like environment
- **Release**: Complete test suite + deployment verification

### Test Data Management
- **Isolation**: Each test run uses isolated test data
- **Cleanup**: Automatic cleanup of test users and credentials
- **Fixtures**: Consistent test data across all test runs
- **Secrets**: Test secrets managed separately from production

## Development Workflow

### Before Committing
```bash
# Run quick tests
npm run test:unit

# Run integration tests if touching multiple services
npm run test:integration

# Run full suite before major releases
npm run test:all
```

### Adding New Tests
1. **Unit Tests**: Add to appropriate `/unit` subdirectory
2. **Integration Tests**: Add to `/integration` if testing service interactions
3. **E2E Tests**: Add to `/e2e` for user journey testing
4. **Update Documentation**: Add test descriptions to this README

### Test Debugging
```bash
# Run specific test file
npm test -- tests/unit/auth/encryption.test.ts

# Run tests in debug mode
npm run test:debug

# Run tests with verbose output
npm run test:verbose
```

## Performance Testing

### Load Testing (Optional)
- **Workers**: Test concurrent request handling
- **Database**: Test Durable Object performance under load
- **API Limits**: Verify ESPN API rate limiting handling

### Benchmarking
- **Response Times**: Track API response time trends
- **Memory Usage**: Monitor worker memory consumption
- **Cold Start**: Measure worker cold start performance

## Security Testing

### Authentication Security
- **Session Validation**: Test Clerk session token verification
- **Header Spoofing**: Verify protection against header spoofing attacks
- **Modular Encryption**: Test shared auth/espn encryption module security
- **Production Security**: Verify development credentials disabled in production

### Data Protection
- **User Isolation**: Verify users can only access their own data via EspnStorage
- **Credential Security**: Test encrypted credential storage with AES-GCM
- **Legacy Code Removal**: Ensure no UserCredentials remnants exist
- **Error Information**: Ensure errors don't leak sensitive data

## Architecture Changes (v4.1.1)

### Modular Auth Migration Completed ✅
The test suite has been updated to reflect the successful migration to modular authentication:

- **✅ Removed**: Local `UserCredentials` class from baseball worker
- **✅ Migrated**: Both workers now use shared `auth/espn/EspnStorage` 
- **✅ Deployed**: Fresh workers with clean modular implementation
- **✅ Updated**: Worker URLs reflect new deployment structure
- **✅ Verified**: Authentication, health checks, and MCP endpoints working

### Current Worker Architecture
```
auth/espn/EspnStorage ──→ baseball-espn-mcp (baseball-espn-mcp.gerrygugger.workers.dev)
                     └──→ football-espn-mcp (football-espn-mcp.gerrygugger.workers.dev)
```

### Test Implications
- **Integration tests** now verify shared authentication infrastructure
- **Deployment tests** confirm modular approach works in production
- **Unit tests** validate shared encryption module functionality
- **Legacy code removal** ensures no UserCredentials remnants

## Troubleshooting

### Common Test Failures
1. **Environment Variables**: Check test environment configuration
2. **Network Issues**: Verify test services are accessible
3. **Rate Limiting**: ESPN API rate limits may affect integration tests
4. **Timing Issues**: Add appropriate waits for async operations

### Test Environment Reset
```bash
# Reset test database
./scripts/reset-test-environment.sh

# Clear test caches
./scripts/clear-test-cache.sh

# Rebuild test fixtures
./scripts/rebuild-fixtures.sh
```

---

## Contributing to Tests

When adding new features to FLAIM:

1. **Write Tests First**: Add tests before implementing features
2. **Test Coverage**: Ensure new code has adequate test coverage
3. **Integration Impact**: Consider how changes affect other services
4. **Documentation**: Update test documentation for new test patterns

For questions about testing strategy or help with specific tests, see the [Contributing Guide](../docs/contributing.md) or open an issue on GitHub.