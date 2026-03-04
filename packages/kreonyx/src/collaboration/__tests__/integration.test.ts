import { describe, it, expect, vi, beforeEach } from "vitest"
import { Orchestrator } from "@/agent/orchestrator"
import { AgentMessage } from "../message"
import { Voting } from "../vote"
import { MapReduce } from "../mapreduce"
import { ReviewCycle } from "../review"
import { Debate } from "../debate"
import { Bus } from "@/bus"
import { ulid } from "ulid"
import { CollaborationIntegration } from "@/agent/collaboration-integration"

// Mock the Bus module
vi.mock("@/bus", () => ({
  Bus: {
    publish: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    subscribeAll: vi.fn(() => vi.fn()),
    once: vi.fn(() => vi.fn()),
    InstanceDisposed: { type: "server.instance.disposed" },
  },
  BusEvent: {
    define: vi.fn((type, properties) => ({ type, properties })),
    payloads: vi.fn(),
  },
}))

vi.mock("@/util/log", () => ({
  Log: {
    create: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}))

vi.mock("@/workspace/memory", () => ({
  SharedMemory: {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(undefined),
    atomicUpdate: vi.fn().mockImplementation((_key, updater) => {
      return Promise.resolve(updater ? updater(undefined) : undefined)
    }),
  },
}))

// Mock AgentMessage module
vi.mock("../message", () => {
  const messageHistory = new Map()
  const pendingResponses = new Map()

  return {
    AgentMessage: {
      create: vi.fn((type, from, collaborationId, content, options = {}) => ({
        id: `test-msg-${Date.now()}-${Math.random()}`,
        type,
        from,
        collaborationId,
        timestamp: Date.now(),
        priority: options.priority ?? "normal",
        requiresResponse: options.requiresResponse ?? false,
        inReplyTo: options.inReplyTo,
        content,
      })),
      send: vi.fn().mockImplementation(async (message) => {
        const history = messageHistory.get(message.collaborationId) ?? []
        history.push(message)
        messageHistory.set(message.collaborationId, history)
      }),
      sendAndWait: vi.fn().mockResolvedValue({
        type: "RESPONSE",
        content: { result: [] },
      }),
      reply: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(() => vi.fn()),
      subscribeToType: vi.fn(() => vi.fn()),
      getHistory: vi.fn().mockResolvedValue([]),
      getThread: vi.fn().mockResolvedValue([]),
      clearHistory: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ total: 0, byType: {} }),
    },
  }
})

vi.mock("ulid", () => ({
  ulid: vi.fn(() => `test-ulid-${Date.now()}`),
}))

describe("Collaboration End-to-End", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("Complete Workflow: Debate → Vote → Implement → Review", () => {
    it("should coordinate a full feature implementation workflow", async () => {
      // Setup: Create collaboration session with multiple agents
      const orchestratorAgent = "orchestrator-1"
      const implementerAgent = "implementer-1"
      const reviewerAgent = "reviewer-1"
      const debaterAgent = "debater-1"
      const participants = [implementerAgent, reviewerAgent, debaterAgent]

      // Step 1: Create collaboration session
      const session = await Orchestrator.createSession(orchestratorAgent, {
        title: "Feature: Add User Authentication",
        description: "Implement user authentication system with login/logout",
        participants,
      })

      expect(session.id).toEqual(expect.any(String))
      expect(session.title).toBe("Feature: Add User Authentication")
      expect(session.participants).toHaveLength(3)
      expect(session.status).toBe("active")

      // Step 2: Initialize agents for collaboration
      await CollaborationIntegration.initializeAgent(implementerAgent, session.id, "implementer")
      await CollaborationIntegration.initializeAgent(reviewerAgent, session.id, "reviewer")
      await CollaborationIntegration.initializeAgent(debaterAgent, session.id, "debater")

      // Verify agents are active
      expect(CollaborationIntegration.isActive(implementerAgent)).toBe(true)
      expect(CollaborationIntegration.isActive(reviewerAgent)).toBe(true)
      expect(CollaborationIntegration.isActive(debaterAgent)).toBe(true)

      // Step 3: Create a debate about implementation approach
      const debate = await Orchestrator.createDebate(session.id, orchestratorAgent, {
        topic: "Implementation approach for user authentication",
        description: "Should we use JWT tokens or session-based authentication?",
        participants: [debaterAgent, implementerAgent],
        format: "structured",
        maxRounds: 2,
      })

      expect(debate.topic).toBe("Implementation approach for user authentication")
      expect(debate.format).toBe("structured")
      expect(debate.maxRounds).toBe(2)
      expect(debate.status).toBe("pending")

      // Step 4: Start the debate
      const startResult = await Debate.start(debate.id, orchestratorAgent)
      expect(startResult.success).toBe(true)

      // Get current speaker
      const activeDebate = await Debate.getDebate(debate.id)
      const currentSpeaker = activeDebate?.currentSpeaker!

      // Step 5: Simulate debate arguments
      await Debate.submitArgument(debate.id, currentSpeaker, {
        position: "pro",
        content: "JWT tokens are stateless and scale better horizontally",
        evidence: ["No session storage needed", "Easy to distribute across servers"],
      })

      // Get updated debate to find next speaker
      const debateAfterFirstArg = await Debate.getDebate(debate.id)
      const secondSpeaker = debateAfterFirstArg?.currentSpeaker!

      await Debate.submitArgument(debate.id, secondSpeaker, {
        position: "con",
        content: "Session-based is simpler and more secure by default",
        evidence: ["Easier to revoke", "No token refresh complexity"],
      })

      const debateArgs = await Debate.getArguments(debate.id)
      expect(debateArgs).toHaveLength(2)

      // Step 6: Create a vote on the implementation approach
      const vote = await Orchestrator.createVote(session.id, orchestratorAgent, {
        title: "Choose authentication approach",
        description: "Vote for the preferred implementation approach",
        options: [
          { id: "jwt", label: "JWT Tokens", description: "Stateless authentication" },
          { id: "session", label: "Session-based", description: "Server-side sessions" },
        ],
        votingStrategy: "majority",
        minVotes: 2,
      })

      expect(vote.title).toBe("Choose authentication approach")
      expect(vote.options).toHaveLength(2)
      expect(vote.status).toBe("open")

      // Step 7: Cast votes
      const voteResult1 = await Orchestrator.castVote(vote.id, implementerAgent, "jwt", "Better for microservices")
      expect(voteResult1.success).toBe(true)

      const voteResult2 = await Orchestrator.castVote(vote.id, reviewerAgent, "jwt", "Scalability is key")
      expect(voteResult2.success).toBe(true)

      // Verify votes were cast
      const votes = await Voting.getVotes(vote.id)
      expect(votes).toHaveLength(2)

      // Step 8: Create map-reduce job to implement across files
      const job = await Orchestrator.createMapReduceJob(
        session.id,
        orchestratorAgent,
        {
          title: "Implement authentication",
          description: "Implement JWT-based authentication in the codebase",
          inputs: [
            { file: "auth/login.ts", requirements: ["Create login endpoint", "Generate JWT"] },
            { file: "auth/logout.ts", requirements: ["Create logout endpoint", "Invalidate token"] },
            { file: "auth/middleware.ts", requirements: ["Verify JWT", "Protect routes"] },
          ],
          mapper: "implementer",
          reducer: "integrator",
          maxParallel: 2,
        }
      )

      expect(job.title).toBe("Implement authentication")
      expect(job.tasks).toHaveLength(3)

      // Step 9: Start and complete tasks
      await MapReduce.startJob(job.id, orchestratorAgent)

      for (const task of job.tasks) {
        await MapReduce.completeTask(job.id, task.id, implementerAgent, {
          file: task.input.file,
          implemented: true,
          code: `// Implementation for ${task.input.file}`,
        })
      }

      // Wait for job completion
      await new Promise(resolve => setTimeout(resolve, 50))

      // Verify job is completed
      const completedJob = await MapReduce.getJob(job.id)
      expect(completedJob?.status).toBe("completed")

      // Step 10: Request code review
      const reviewRequest = await Orchestrator.requestReview(session.id, orchestratorAgent, {
        title: "Review: Authentication Implementation",
        description: "Please review the JWT authentication implementation",
        artifacts: [
          {
            type: "code",
            content: "// Login implementation",
            description: "Login endpoint with JWT generation",
          },
          {
            type: "code",
            content: "// Middleware implementation",
            description: "JWT verification middleware",
          },
        ],
        reviewers: [reviewerAgent],
        minApprovals: 1,
      })

      expect(reviewRequest.title).toBe("Review: Authentication Implementation")
      expect(reviewRequest.reviewers).toContain(reviewerAgent)
      expect(reviewRequest.status).toBe("pending")

      // Step 11: Submit review
      const reviewResult = await ReviewCycle.submitReview(reviewRequest.id, reviewerAgent, {
        verdict: "approve",
        comments: [
          {
            id: "comment-1",
            message: "Well implemented JWT logic",
            severity: "info" as const,
            resolved: false,
            replies: [],
          },
        ],
        summary: "LGTM! Good implementation.",
      })

      expect(reviewResult.success).toBe(true)

      // Verify review is approved
      const approvedRequest = await ReviewCycle.getRequest(reviewRequest.id)
      expect(approvedRequest?.status).toBe("approved")

      // Step 12: Final approval vote
      const finalVote = await Orchestrator.createVote(session.id, orchestratorAgent, {
        title: "Merge authentication feature?",
        description: "Final approval to merge the authentication implementation",
        options: [
          { id: "merge", label: "Merge to main" },
          { id: "rework", label: "Request changes" },
        ],
        votingStrategy: "majority",
      })

      await Orchestrator.castVote(finalVote.id, implementerAgent, "merge")
      await Orchestrator.castVote(finalVote.id, reviewerAgent, "merge")

      // Step 13: Get session status
      const status = await Orchestrator.getStatus(session.id)
      expect(status).toBeDefined()
      expect(status?.session.id).toBe(session.id)
      expect(status?.jobs).toHaveLength(1)
      expect(status?.reviews).toHaveLength(1)

      // Step 14: Format session summary
      const summary = await Orchestrator.formatSessionSummary(session.id)
      expect(summary).toContain("Feature: Add User Authentication")
      expect(summary).toContain("Active Jobs")

      // Cleanup: Clean up agent subscriptions
      CollaborationIntegration.cleanupAgent(implementerAgent)
      CollaborationIntegration.cleanupAgent(reviewerAgent)
      CollaborationIntegration.cleanupAgent(debaterAgent)

      expect(CollaborationIntegration.isActive(implementerAgent)).toBe(false)
    })

    it("should handle debate with multiple rounds and participants", async () => {
      const orchestratorAgent = "orchestrator-1"
      const agent1 = "debater-1"
      const agent2 = "debater-2"
      const agent3 = "debater-3"

      const session = await Orchestrator.createSession(orchestratorAgent, {
        title: "Architecture Decision",
        participants: [agent1, agent2, agent3],
      })

      const debate = await Debate.create(session.id, orchestratorAgent, {
        topic: "Monolith vs Microservices",
        participants: [agent1, agent2, agent3],
        format: "structured",
        maxRounds: 2,
      })

      await Debate.start(debate.id, orchestratorAgent)

      // Round 1 - get current speaker for each turn
      for (let i = 0; i < 3; i++) {
        const currentDebate = await Debate.getDebate(debate.id)
        const speaker = currentDebate?.currentSpeaker
        if (speaker) {
          await Debate.submitArgument(debate.id, speaker, {
            position: i === 1 ? "con" : "pro",
            content: `Argument ${i + 1} from ${speaker}`,
          })
        }
      }

      const args = await Debate.getArguments(debate.id)
      expect(args).toHaveLength(3)

      const argsByRound = await Debate.getArgumentsByRound(debate.id, 1)
      expect(argsByRound).toHaveLength(3)
    })

    it("should handle map-reduce with task failures and retries", async () => {
      const orchestratorAgent = "orchestrator-1"
      const session = await Orchestrator.createSession(orchestratorAgent, {
        title: "Refactoring Project",
        participants: ["agent-1", "agent-2"],
      })

      const job = await Orchestrator.createMapReduceJob(
        session.id,
        orchestratorAgent,
        {
          title: "Refactor legacy code",
          description: "Refactor old code files",
          inputs: [
            { file: "legacy1.ts" },
            { file: "legacy2.ts" },
            { file: "legacy3.ts" },
          ],
          mapper: "implementer",
          maxParallel: 2,
        }
      )

      await MapReduce.startJob(job.id, orchestratorAgent)

      // Complete first task
      await MapReduce.completeTask(job.id, job.tasks[0].id, "agent-1", {
        file: "legacy1.ts",
        refactored: true,
      })

      // Fail second task
      await MapReduce.failTask(job.id, job.tasks[1].id, "agent-1", "Syntax error in refactored code")

      // Complete third task
      await MapReduce.completeTask(job.id, job.tasks[2].id, "agent-2", {
        file: "legacy3.ts",
        refactored: true,
      })

      // Wait for job completion
      await new Promise(resolve => setTimeout(resolve, 50))

      // Job should complete with partial results
      const completedJob = await MapReduce.getJob(job.id)
      expect(completedJob?.status).toBe("completed")
      expect(completedJob?.tasks.filter(t => t.status === "completed")).toHaveLength(2)
      expect(completedJob?.tasks.filter(t => t.status === "failed")).toHaveLength(1)
    })

    it("should handle code review with changes requested", async () => {
      const orchestratorAgent = "orchestrator-1"
      const reviewer = "reviewer-1"

      const session = await Orchestrator.createSession(orchestratorAgent, {
        title: "Code Review Session",
        participants: [reviewer],
      })

      const reviewRequest = await ReviewCycle.createRequest(session.id, orchestratorAgent, {
        title: "Review: New Feature",
        artifacts: [
          {
            type: "code",
            content: "// Feature code",
            description: "Feature implementation",
          },
        ],
        reviewers: [reviewer],
        minApprovals: 1,
      })

      // Submit review requesting changes
      const reviewResult = await ReviewCycle.submitReview(reviewRequest.id, reviewer, {
        verdict: "request_changes",
        comments: [
          {
            id: "comment-1",
            line: 10,
            file: "feature.ts",
            message: "Add error handling here",
            severity: "error" as const,
            resolved: false,
            replies: [],
          },
        ],
        summary: "Please add error handling before merging",
      })

      expect(reviewResult.success).toBe(true)

      const request = await ReviewCycle.getRequest(reviewRequest.id)
      expect(request?.status).toBe("changes_requested")

      // Add a reply to the comment
      const replyResult = await ReviewCycle.replyToComment(reviewRequest.id, "comment-1", orchestratorAgent, "Will add error handling")
      expect(replyResult.success).toBe(true)

      // Resubmit after fixing
      const resubmitResult = await ReviewCycle.resubmit(reviewRequest.id, orchestratorAgent, {
        description: "Added error handling as requested",
      })

      expect(resubmitResult.success).toBe(true)

      const resubmitted = await ReviewCycle.getRequest(reviewRequest.id)
      expect(resubmitted?.status).toBe("pending")

      // Approve after resubmission
      await ReviewCycle.submitReview(reviewRequest.id, reviewer, {
        verdict: "approve",
        comments: [],
        summary: "Changes look good now",
      })

      const approved = await ReviewCycle.getRequest(reviewRequest.id)
      expect(approved?.status).toBe("approved")
    })

    it("should handle voting with different strategies", async () => {
      const orchestratorAgent = "orchestrator-1"
      const session = await Orchestrator.createSession(orchestratorAgent, {
        title: "Voting Session",
        participants: ["agent-1", "agent-2", "agent-3", "agent-4"],
      })

      // Test majority voting
      const majorityVote = await Voting.createProposal(session.id, orchestratorAgent, {
        title: "Majority Vote",
        description: "Simple majority wins",
        options: [
          { id: "option-a", label: "Option A" },
          { id: "option-b", label: "Option B" },
        ],
        votingStrategy: "majority",
      })

      await Voting.castVote(majorityVote.id, "agent-1", "option-a")
      await Voting.castVote(majorityVote.id, "agent-2", "option-a")
      await Voting.castVote(majorityVote.id, "agent-3", "option-b")

      const closed = await Voting.closeProposal(majorityVote.id, "test")
      expect(closed?.result?.winningOption).toBe("option-a")
      expect(closed?.result?.consensusReached).toBe(true)

      // Test unanimous voting
      const unanimousVote = await Voting.createProposal(session.id, orchestratorAgent, {
        title: "Unanimous Vote",
        description: "Everyone must agree",
        options: [{ id: "approve", label: "Approve" }],
        votingStrategy: "unanimous",
        minVotes: 4,
      })

      await Voting.castVote(unanimousVote.id, "agent-1", "approve")
      await Voting.castVote(unanimousVote.id, "agent-2", "approve")
      await Voting.castVote(unanimousVote.id, "agent-3", "approve")
      await Voting.castVote(unanimousVote.id, "agent-4", "approve")

      const unanimousClosed = await Voting.closeProposal(unanimousVote.id, "test")
      expect(unanimousClosed?.result?.winningOption).toBe("approve")
      expect(unanimousClosed?.result?.consensusReached).toBe(true)
    })

    it("should broadcast messages to all participants", async () => {
      const orchestratorAgent = "orchestrator-1"
      const participants = ["agent-1", "agent-2", "agent-3"]

      const session = await Orchestrator.createSession(orchestratorAgent, {
        title: "Broadcast Test",
        participants,
      })

      // Broadcast a message
      await Orchestrator.broadcast(session.id, orchestratorAgent, "Starting collaboration session", "info")

      // Verify session exists
      expect(session.participants).toHaveLength(3)
    })

    it("should handle session status queries", async () => {
      const orchestratorAgent = "orchestrator-1"
      const session = await Orchestrator.createSession(orchestratorAgent, {
        title: "Status Test",
        participants: ["agent-1"],
      })

      // Create various activities
      await Orchestrator.createVote(session.id, orchestratorAgent, {
        title: "Test Vote",
        description: "Test",
      })

      await Orchestrator.createDebate(session.id, orchestratorAgent, {
        topic: "Test Debate",
        participants: ["agent-1"],
      })

      const status = await Orchestrator.getStatus(session.id)
      expect(status?.session.status).toBe("active")
      expect(status?.proposals).toHaveLength(1)
      expect(status?.debates).toHaveLength(1)
    })
  })

  describe("Error Handling", () => {
    it("should handle non-existent sessions gracefully", async () => {
      const status = await Orchestrator.getStatus("non-existent-session")
      expect(status).toBeUndefined()

      const summary = await Orchestrator.formatSessionSummary("non-existent-session")
      expect(summary).toBe("Session not found")
    })

    it("should reject votes on non-existent proposals", async () => {
      const result = await Voting.castVote("non-existent", "agent-1", "option-a")
      expect(result.success).toBe(false)
      expect(result.error).toBe("Proposal not found")
    })

    it("should handle unauthorized review submissions", async () => {
      const orchestratorAgent = "orchestrator-1"
      const session = await Orchestrator.createSession(orchestratorAgent, {
        title: "Unauthorized Test",
        participants: ["agent-1"],
      })

      const reviewRequest = await ReviewCycle.createRequest(session.id, orchestratorAgent, {
        title: "Test Review",
        artifacts: [],
        reviewers: ["agent-1"],
      })

      const result = await ReviewCycle.submitReview(reviewRequest.id, "unauthorized-agent", {
        verdict: "approve",
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("not assigned")
    })
  })

  describe("CollaborationIntegration", () => {
    it("should track agent participation status", async () => {
      const agentId = "test-agent"
      const sessionId = "test-session"

      expect(CollaborationIntegration.isActive(agentId)).toBe(false)

      await CollaborationIntegration.initializeAgent(agentId, sessionId, "implementer")

      expect(CollaborationIntegration.isActive(agentId)).toBe(true)

      const info = CollaborationIntegration.getAgentInfo(agentId)
      expect(info?.collaborationId).toBe(sessionId)
      expect(info?.role).toBe("implementer")

      CollaborationIntegration.cleanupAgent(agentId)

      expect(CollaborationIntegration.isActive(agentId)).toBe(false)
    })
  })
})
