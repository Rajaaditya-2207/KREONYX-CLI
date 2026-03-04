import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentMessage } from "../message"

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

describe("AgentMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("create", () => {
    it("should create a message with NOTIFY type", () => {
      const testId = "test-message-id"
      mockUlidFn.mockReturnValue(testId)

      const message = AgentMessage.create(
        "NOTIFY",
        "agent-1",
        "session-1",
        {
          message: "Hello world",
          level: "info" as const,
        },
        { priority: "normal" }
      )

      expect(message.id).toBe(testId)
      expect(message.type).toBe("NOTIFY")
      expect(message.from).toBe("agent-1")
      expect(message.collaborationId).toBe("session-1")
    })
  })
})