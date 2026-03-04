import { describe, it, expect, vi, beforeEach } from "vitest"
import { MapReduce } from "../mapreduce"

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

describe("MapReduce", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("createJob", () => {
    it("should create a map-reduce job with mapper only", async () => {
      const testId = "test-job-id"
      mockUlidFn.mockReturnValue(testId)

      const job = await MapReduce.createJob("session-1", {
        title: "Test Job",
        description: "Process files",
        inputs: ["file1.ts", "file2.ts"],
        mapper: "reviewer",
      })

      expect(job.id).toBe(testId)
      expect(job.title).toBe("Test Job")
      expect(job.mapper).toBe("reviewer")
      expect(job.reducer).toBeUndefined()
      expect(job.status).toBe("pending")
      expect(job.tasks).toHaveLength(2)
    })

    it("should create job with mapper and reducer", async () => {
      const job = await MapReduce.createJob("session-1", {
        title: "Test Job",
        description: "Process and combine",
        inputs: ["file1.ts", "file2.ts"],
        mapper: "reviewer",
        reducer: "integrator",
      })

      expect(job.mapper).toBe("reviewer")
      expect(job.reducer).toBe("integrator")
    })
  })
})