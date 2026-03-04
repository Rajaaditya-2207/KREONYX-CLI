import { describe, it, expect, vi, beforeEach } from "vitest"
import { ReviewCycle } from "../review"

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

describe("ReviewCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("createRequest", () => {
    it("should create a review request", async () => {
      const testId = "test-review-id"
      mockUlidFn.mockReturnValue(testId)

      const request = await ReviewCycle.createRequest("session-1", "agent-1", {
        title: "Code Review: API Changes",
        description: "Please review the new API endpoints",
        artifacts: [
          {
            type: "code" as const,
            content: "const api = new API()",
            description: "API implementation",
          },
        ],
        reviewers: ["agent-2", "agent-3"],
      })

      expect(request.id).toBe(testId)
      expect(request.title).toBe("Code Review: API Changes")
      expect(request.status).toBe("pending")
      expect(request.reviewers).toHaveLength(2)
    })
  })
})