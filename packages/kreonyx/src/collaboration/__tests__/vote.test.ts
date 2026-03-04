import { describe, it, expect, vi, beforeEach } from "vitest"
import { Voting } from "../vote"

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

describe("Voting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("createProposal", () => {
    it("should create a voting proposal with majority strategy", async () => {
      const testId = "test-proposal-id"
      mockUlidFn.mockReturnValue(testId)

      const proposal = await Voting.createProposal("session-1", "agent-1", {
        title: "Test Vote",
        description: "Should we proceed?",
        options: [
          { id: "yes", label: "Yes", description: "Approve" },
          { id: "no", label: "No", description: "Reject" },
        ],
        votingStrategy: "majority",
      })

      expect(proposal.id).toBe(testId)
      expect(proposal.title).toBe("Test Vote")
      expect(proposal.votingStrategy).toBe("majority")
      expect(proposal.status).toBe("open")
    })
  })
})