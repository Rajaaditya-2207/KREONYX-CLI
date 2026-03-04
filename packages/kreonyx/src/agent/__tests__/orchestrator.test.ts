import { describe, it, expect, vi, beforeEach } from "vitest"
import { Orchestrator } from "../orchestrator"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { ulid } from "ulid"

// Mock dependencies
vi.mock("@/bus")
vi.mock("@/util/log")
vi.mock("ulid")

describe("Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("DESCRIPTION", () => {
    it("should have correct description", () => {
      expect(Orchestrator.DESCRIPTION).toContain("Master orchestrator agent")
    })
  })

  describe("createSession", () => {
    it("should create a new collaboration session", async () => {
      const mockUlid = "test-session-id"
      vi.mocked(ulid).mockReturnValue(mockUlid)

      const result = await Orchestrator.createSession("agent-1", {
        title: "Test Session",
        description: "Test description",
        participants: ["agent-2", "agent-3"],
      })

      expect(result.id).toBe(mockUlid)
      expect(result.title).toBe("Test Session")
      expect(result.description).toBe("Test description")
      expect(result.orchestrator).toBe("agent-1")
      expect(result.participants).toEqual(["agent-2", "agent-3"])
      expect(result.status).toBe("active")
      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()
    })

    it("should create session without description", async () => {
      const mockUlid = "test-session-id-2"
      vi.mocked(ulid).mockReturnValue(mockUlid)

      const result = await Orchestrator.createSession("agent-1", {
        title: "Test Session",
        participants: ["agent-2"],
      })

      expect(result.id).toBe(mockUlid)
      expect(result.title).toBe("Test Session")
      expect(result.description).toBeUndefined()
    })
  })

  describe("getSession", () => {
    it("should return undefined for non-existent session", async () => {
      const result = await Orchestrator.getSession("non-existent")
      expect(result).toBeUndefined()
    })
  })

  describe("createMapReduceJob", () => {
    it("should create a map-reduce job", async () => {
      // First create a session
      const session = await Orchestrator.createSession("agent-1", {
        title: "Test Session",
        participants: ["agent-2"],
      })

      const job = await Orchestrator.createMapReduceJob(session.id!, "agent-1", {
        title: "Test Job",
        description: "Test job description",
        inputs: [{ file: "file1.ts", requirements: ["req1"] }],
        mapper: "mapper-agent",
        reducer: "reducer-agent",
        maxParallel: 3,
      })

      expect(job.id).toBeDefined()
      expect(job.title).toBe("Test Job")
      expect(job.collaborationId).toBe(session.id)
    })
  })

  describe("createVote", () => {
    it("should create a voting proposal", async () => {
      const session = await Orchestrator.createSession("agent-1", {
        title: "Test Session",
        participants: ["agent-2"],
      })

      const proposal = await Orchestrator.createVote(session.id!, "agent-1", {
        title: "Test Vote",
        description: "Test vote description",
        options: [
          { id: "opt1", label: "Option 1" },
          { id: "opt2", label: "Option 2" },
        ],
      })

      expect(proposal.id).toBeDefined()
      expect(proposal.title).toBe("Test Vote")
      expect(proposal.options).toHaveLength(2)
    })
  })

  describe("createDebate", () => {
    it("should create a debate session", async () => {
      const session = await Orchestrator.createSession("agent-1", {
        title: "Test Session",
        participants: ["agent-2", "agent-3"],
      })

      const debate = await Orchestrator.createDebate(session.id!, "agent-1", {
        topic: "Test Topic",
        description: "Test debate",
        participants: ["agent-2", "agent-3"],
        format: "structured",
        maxRounds: 3,
      })

      expect(debate.id).toBeDefined()
      expect(debate.topic).toBe("Test Topic")
      expect(debate.format).toBe("structured")
      expect(debate.maxRounds).toBe(3)
    })
  })
})
