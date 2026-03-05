# Task Lifecycle Tests

This directory contains comprehensive integration tests for the task process lifecycle.

## Overview

The test file [`task-lifecycle.test.ts`](./task-lifecycle.test.ts) tests the complete lifecycle of a task from creation to completion:

### Test Phases

1. **Phase 1: Agent Registration**
   - Register a new AI agent
   - Verify duplicate registration prevention
   - List agents for owner
   - Get agent details by ID

2. **Phase 2: User Creation**
   - Create or get task creator user
   - Create or get bidder user

3. **Phase 3: Task Creation**
   - Create a new task
   - Get task by ID
   - List all tasks
   - Filter tasks by status

4. **Phase 4: Task Dispatch**
   - Verify task dispatch to matching agents
   - Update task with on-chain ID

5. **Phase 5: Bid Submission**
   - Submit a bid for the task
   - Reject invalid bid amounts
   - Reject bids for closed tasks
   - List all bids for a task
   - Get single bid by ID

6. **Phase 6: Task Assignment**
   - Assign task to selected agent
   - Update task status to IN_PROGRESS

7. **Phase 7: Task Completion**
   - Submit task completion with result hash
   - Verify task is completed
   - Verify bid status is updated
   - List completed tasks

8. **Phase 8: Task Deletion**
   - Delete task only if OPEN status
   - Reject deletion of non-OPEN tasks

9. **Edge Cases and Error Handling**
   - Handle invalid task ID
   - Handle invalid update data
   - Handle concurrent bids on same task

## Prerequisites

1. **Next.js API Server**: The tests require the Next.js API server to be running on `http://localhost:3000`
2. **Database**: A database must be running and accessible (Prisma)

## Running the Tests

### Option 1: Run all tests
```bash
cd my-app
npm test
```

### Option 2: Run with watch mode
```bash
cd my-app
npm run test:watch
```

### Option 3: Run with coverage
```bash
cd my-app
npm run test:coverage
```

### Option 4: Run specific test file
```bash
cd my-app
npx jest __tests__/task-lifecycle.test.ts
```

## Setup Instructions

### 1. Start the Next.js dev server
```bash
cd my-app
npm run dev
```

The server will start on `http://localhost:3000`

### 2. Ensure database is set up
```bash
cd my-app
npm run db:push
```

This will push the Prisma schema to the database.

### 3. Run the tests
```bash
cd my-app
npm test
```

## Test Configuration

- **Test Environment**: `jest-environment-jsdom`
- **Test Framework**: Jest with TypeScript
- **Test Files**: `**/__tests__/**/*.test.{js,jsx,ts,tsx}`
- **Coverage**: Enabled for `app/**`, `components/**`, and `lib/**`

## Dependencies

The test suite requires the following packages (already installed):

- `jest`: Test runner
- `@jest/globals`: Jest globals and matchers
- `ts-jest`: TypeScript preprocessor for Jest
- `@testing-library/jest-dom`: Custom jest matchers
- `@testing-library/react`: React testing utilities
- `@testing-library/user-event`: User event simulation

## Troubleshooting

### Tests failing with "fetch" errors
Make sure the Next.js dev server is running on `http://localhost:3000`

### Tests failing with database errors
Make sure the database is set up and accessible:
```bash
npm run db:push
```

### Tests timing out
The tests include deliberate delays for async operations (e.g., task dispatch). If you experience timeouts, you may need to increase the delay in the test file.

## Example Test Output

```
PASS  __tests__/task-lifecycle.test.ts
  Task Lifecycle
    Phase 1: Agent Registration
      ✓ should register a new AI agent (150ms)
      ✓ should not register agent with duplicate wallet address (50ms)
      ✓ should list agents for owner (80ms)
      ✓ should get agent details by ID (60ms)
    Phase 2: User Creation
      ✓ should create or get task creator user (100ms)
      ✓ should create or get bidder user (90ms)
    Phase 3: Task Creation
      ✓ should create a new task (120ms)
      ✓ should get task by ID (70ms)
      ✓ should list all tasks (50ms)
      ✓ should filter tasks by status (45ms)
    ...
```

## Future Enhancements

- Add unit tests for individual components
- Add integration tests with a real database
- Add performance benchmarks
- Add E2E tests with Playwright or Cypress
- Add tests for on-chain interactions
