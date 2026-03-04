# Multi-Agent Collaboration System - Test Plan

## Overview

**Total Code**: 3,424 lines across 9 modules
**Total Functions**: 64 async functions
**Test Coverage Goal**: 80% minimum

## Test Structure

```
packages/kreonyx/src/
├── __tests__/
│   └── OPENCODE_MULTI_AGENT_TEST_PLAN.md (this file)
├── agent/
│   ├── orchestrator.ts
│   └── __tests__/
│       └── orchestrator.test.ts
├── collaboration/
│   ├── debate.ts
│   ├── mapreduce.ts
│   ├── message.ts
│   ├── review.ts
│   ├── vote.ts
│   └── __tests__/
│       ├── debate.test.ts
│       ├── mapreduce.test.ts
│       ├── message.test.ts
│       ├── review.test.ts
│       └── vote.test.ts
└── workspace/
    ├── filesystem.ts
    ├── memory.ts
    └── __tests__/
        ├── filesystem.test.ts
        └── memory.test.ts
```

## Test Priorities

### Priority 1: Core Orchestrator (High)
- [ ] `createSession()` - Session creation
- [ ] `getSession()` - Session retrieval
- [ ] `createMapReduceJob()` - Job creation
- [ ] `createVote()` - Voting creation
- [ ] `requestReview()` - Review creation
- [ ] `createDebate()` - Debate creation
- [ ] `broadcast()` - Message broadcasting
- [ ] `coordinateFeatureImplementation()` - Full workflow integration

### Priority 2: Collaboration Modules (High)
- [ ] Debate module: create, start, end, participate
- [ ] MapReduce: createJob, startJob, completeJob, subscribe
- [ ] Vote: createProposal, castVote, tally, subscribe
- [ ] Review: createRequest, approve, reject, subscribe
- [ ] Message: create, send, sendAndWait, reply

### Priority 3: Workspace Modules (Medium)
- [ ] SharedMemory: set, get, delete, subscribe
- [ ] SharedFilesystem: acquireLock, releaseLock, trackChange, getState

### Priority 4: Integration Tests (Low)
- [ ] End-to-end workflow: debate → map-reduce → review → vote
- [ ] Multi-agent coordination scenarios
- [ ] Conflict resolution scenarios

## Test Approach

### Unit Tests
- Mock external dependencies (Bus, Log, Instance)
- Test each function in isolation
- Verify inputs, outputs, and side effects
- Test error conditions

### Integration Tests
- Test workflow coordination
- Test inter-module communication
- Test event propagation
- Test agent coordination

### Mocking Strategy
```typescript
// Mock Bus events
vi.mock('@/bus', () => ({
  Bus: {
    define: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
  }
}))

// Mock Log
vi.mock('@/util/log', () => ({
  Log: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    })),
  },
}))

// Mock Instance
vi.mock('@/project/instance', () => ({
  Instance: {
    state: vi.fn(),
    worktree: '/test',
  }
}))
```

## Test Utilities

### Mock Agent Sessions
```typescript
export function createMockAgentSession(id: string = 'test-agent') {
  return {
    id,
    providerID: 'mock',
    modelID: 'mock-model',
  }
}
```

### Mock Collaboration Sessions
```typescript
export function createMockCollaborationSession(opts?: Partial<Orchestrator.CollaborationSession>) {
  return {
    id: 'test-session',
    title: 'Test Session',
    orchestrator: 'orchestrator-1',
    participants: ['agent-1', 'agent-2'],
    status: 'active' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...opts,
  }
}
```

## Success Criteria

- [ ] 80% code coverage
- [ ] All 64 async functions tested
- [ ] All 45+ public functions tested
- [ ] Integration tests for workflow coordination
- [ ] No flaky tests
- [ ] Tests run in <5 seconds

## Test Timeline

**Phase 1**: Unit tests for Orchestrator (2 hours)
**Phase 2**: Collaboration module tests (2 hours)
**Phase 3**: Workspace module tests (1 hour)
**Phase 4**: Integration tests (1 hour)

**Total**: 6 hours

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test packages/kreonyx/src/agent/__tests__/orchestrator.test.ts

# Run with coverage
bun test --coverage

# Watch mode
bun test --watch
```
