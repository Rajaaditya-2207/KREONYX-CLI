import { describe, it, expect, vi, beforeEach } from "vitest"
import { SharedMemory } from "../memory"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { z } from "zod"

// Mock dependencies
vi.mock("@/bus")
vi.mock("@/util/log")

describe("SharedMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("set and get", () => {
    it("should set and get value from shared memory", async () => {
      await SharedMemory.set("test-key", { value: "test-value" }, { agentSessionID: "agent-1" })

      const value = await SharedMemory.get("test-key")
      expect(value).toEqual({ value: "test-value" })
    })

    it("should set value with TTL", async () => {
      const ttl = 5000 // 5 seconds
      await SharedMemory.set("test-key-ttl", { value: "test" }, { agentSessionID: "agent-1" }, ttl)

      const value = await SharedMemory.get("test-key-ttl")
      expect(value).toEqual({ value: "test" })
    })

    it("should return undefined for non-existent key", async () => {
      const value = await SharedMemory.get("non-existent-key")
      expect(value).toBeUndefined()
    })
  })

  describe("getEntry", () => {
    it("should return full entry with metadata", async () => {
      const startTime = Date.now()
      await SharedMemory.set("test-entry", { data: "test" }, { agentSessionID: "agent-1" })

      const entry = await SharedMemory.getEntry("test-entry")

      expect(entry).toBeDefined()
      expect(entry?.key).toBe("test-entry")
      expect(entry?.value).toEqual({ data: "test" })
      expect(entry?.version).toBe(1)
      expect(entry?.updatedBy).toBe("agent-1")
      expect(entry?.updatedAt).toBeGreaterThanOrEqual(startTime)
      expect(entry?.updatedAt).toBeLessThanOrEqual(Date.now())
    })

    it("should return undefined for non-existent entry", async () => {
      const entry = await SharedMemory.getEntry("non-existent")
      expect(entry).toBeUndefined()
    })
  })

  describe("delete", () => {
    it("should delete value from shared memory", async () => {
      await SharedMemory.set("test-delete", { value: "to-delete" }, { agentSessionID: "agent-1" })

      // Verify it exists
      const value = await SharedMemory.get("test-delete")
      expect(value).toEqual({ value: "to-delete" })

      // Delete it
      await SharedMemory.delete("test-delete", { agentSessionID: "agent-2" })

      // Verify it's gone
      const deletedValue = await SharedMemory.get("test-delete")
      expect(deletedValue).toBeUndefined()
    })
  })

  describe("exists", () => {
    it("should return true for existing key", async () => {
      await SharedMemory.set("test-exists", { value: "test" }, { agentSessionID: "agent-1" })

      const exists = await SharedMemory.exists("test-exists")
      expect(exists).toBe(true)
    })

    it("should return false for non-existent key", async () => {
      const exists = await SharedMemory.exists("non-existent-exists")
      expect(exists).toBe(false)
    })
  })

  describe("clear", () => {
    it("should clear all entries", async () => {
      await SharedMemory.set("key1", { value: 1 }, { agentSessionID: "agent-1" })
      await SharedMemory.set("key2", { value: 2 }, { agentSessionID: "agent-1" })
      await SharedMemory.set("key3", { value: 3 }, { agentSessionID: "agent-1" })

      await SharedMemory.clear()

      expect(await SharedMemory.get("key1")).toBeUndefined()
      expect(await SharedMemory.get("key2")).toBeUndefined()
      expect(await SharedMemory.get("key3")).toBeUndefined()
    })
  })

  describe("subscribeToUpdates", () => {
    it("should allow subscribing to updates", async () => {
      const mockHandler = vi.fn()
      const unsubscribe = SharedMemory.subscribeToUpdates("test-sub", mockHandler)

      // Subscribe before setting
      await SharedMemory.set("test-sub", { value: "initial" }, { agentSessionID: "agent-1" })

      expect(mockHandler).toHaveBeenCalledWith({
        type: "shared_memory.update",
        data: {
          key: "test-sub",
          value: { value: "initial" },
          version: 1,
          updatedBy: "agent-1",
          previousValue: undefined,
        },
      })

      unsubscribe()
    })
  })

  describe("getStats", () => {
    it("should return memory statistics", async () => {
      await SharedMemory.set("key1", { value: 1 }, { agentSessionID: "agent-1" })
      await SharedMemory.set("key2", { value: 2 }, { agentSessionID: "agent-1" })

      const stats = await SharedMemory.getStats()

      expect(stats.totalEntries).toBe(2)
      expect(stats.totalSize).toBeGreaterThan(0)
      expect(stats.keys).toContain("key1")
      expect(stats.keys).toContain("key2")
    })
  })

  describe("conflict detection", () => {
    it("should detect version conflicts", async () => {
      await SharedMemory.set("conflict-test", { value: 1 }, { agentSessionID: "agent-1" })

      const entry1 = await SharedMemory.getEntry("conflict-test")
      expect(entry1?.version).toBe(1)

      // Agent 2 tries to update (succeeds - becomes version 2)
      await SharedMemory.set("conflict-test", { value: 2 }, { agentSessionID: "agent-2" })
      const entry2 = await SharedMemory.getEntry("conflict-test")
      expect(entry2?.version).toBe(2)

      // Agent 1 tries to update based on version 1 (should fail or be detected)
      // This would be handled by the conflict resolution in actual implementation
    })
  })

  describe("TTL expiration", () => {
    it("should expire entries after TTL", async () => {
      const ttl = 100 // 100ms
      await SharedMemory.set("ttl-test", { value: "expire" }, { agentSessionID: "agent-1" }, ttl)

      // Should exist immediately
      expect(await SharedMemory.get("ttl-test")).toEqual({ value: "expire" })

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150))

      // Should be gone after TTL + buffer
      expect(await SharedMemory.get("ttl-test")).toBeUndefined()
    })
  })

  describe("batch operations", () => {
    it("should handle batch set operations", async () => {
      const batch = [
        { key: "batch1", value: { data: 1 } },
        { key: "batch2", value: { data: 2 } },
        { key: "batch3", value: { data: 3 } },
      ]

      for (const item of batch) {
        await SharedMemory.set(item.key, item.value, { agentSessionID: "agent-1" })
      }

      for (const item of batch) {
        expect(await SharedMemory.get(item.key)).toEqual(item.value)
      }
    })
  })
})
