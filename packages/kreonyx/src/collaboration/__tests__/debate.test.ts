import { describe, it, expect, vi, beforeEach } from "vitest"
import { Debate } from "../debate"

// Mock ulid
const mockUlidFn = vi.fn(() => `test-ulid-${Date.now()}`)

// Mock dependencies
vi.mock("@/bus", () => ({
  Bus: {
    publish: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    subscribeAll: vi.fn(() => vi.fn()),
    once: vi.fn(() => vi.fn()),
  },
  BusEvent: {
    define: vi.fn((type: string, properties: any) => ({ type, properties })),
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

vi.mock("ulid", () => ({
  ulid: mockUlidFn,
}))

describe("Debate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("create", () => {
    it("should create a structured debate session", async () => {
      const testId = "test-debate-id"
      mockUlidFn.mockReturnValue(testId)

      const debate = await Debate.create("session-1", "agent-1", {
        topic: "API Design",
        description: "Should we use REST or GraphQL?",
        participants: ["agent-2", "agent-3"],
        format: "structured",
        maxRounds: 3,
      })

      expect(debate.id).toBe(testId)
      expect(debate.topic).toBe("API Design")
      expect(debate.format).toBe("structured")
      expect(debate.maxRounds).toBe(3)
      expect(debate.status).toBe("pending")
      expect(debate.currentRound).toBe(0)
      expect(debate.participants).toContain("agent-2")
      expect(debate.participants).toContain("agent-3")
    })

    it("should create debate with default values", async () => {
      const debate = await Debate.create("session-1", "agent-1", {
        topic: "Simple Topic",
        participants: ["agent-2"],
      })

      expect(debate.format).toBe("structured") // default
      expect(debate.maxRounds).toBe(3) // default
      expect(debate.status).toBe("pending")
    })
  })

  describe("getDebate", () => {
    it("should return undefined for non-existent debate", async () => {
      const result = await Debate.getDebate("non-existent")
      expect(result).toBeUndefined()
    })

    it("should return existing debate", async () => {
      const debate = await Debate.create("session-1", "agent-1", {
        topic: "API Design",
        participants: ["agent-2"],
      })

      const retrieved = await Debate.getDebate(debate.id)
      expect(retrieved).toEqual(debate)
    })
  })
})