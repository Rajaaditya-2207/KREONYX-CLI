import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { z } from "zod"
import { ulid } from "ulid"

export namespace SharedMemory {
  const log = Log.create({ service: "shared-memory" })

  export const Entry = z.object({
    key: z.string(),
    value: z.any(),
    version: z.number(),
    updatedAt: z.number(),
    updatedBy: z.string(), // agent session ID
    ttl: z.number().optional(), // optional TTL in ms
  })
  export type Entry = z.infer<typeof Entry>

  export const Event = {
    Update: BusEvent.define(
      "shared_memory.update",
      z.object({
        key: z.string(),
        value: z.any(),
        version: z.number(),
        updatedBy: z.string(),
        previousValue: z.any().optional(),
      }),
    ),
    Delete: BusEvent.define(
      "shared_memory.delete",
      z.object({
        key: z.string(),
        deletedBy: z.string(),
      }),
    ),
    Conflict: BusEvent.define(
      "shared_memory.conflict",
      z.object({
        key: z.string(),
        localVersion: z.number(),
        remoteVersion: z.number(),
        localValue: z.any(),
        remoteValue: z.any(),
      }),
    ),
  }

  // In-memory storage - shared across all agents in the same instance
  const storage = new Map<string, Entry>()
  const subscribers = new Map<string, Set<(event: any) => void>>()

  export async function get(key: string): Promise<Entry | undefined> {
    const entry = storage.get(key)
    if (!entry) return undefined

    // Check TTL expiration
    if (entry.ttl && Date.now() > entry.updatedAt + entry.ttl) {
      storage.delete(key)
      return undefined
    }

    return entry
  }

  export async function getAll(prefix?: string): Promise<Record<string, any>> {
    const result: Record<string, any> = {}
    const now = Date.now()

    for (const [key, entry] of storage.entries()) {
      // Skip expired entries
      if (entry.ttl && now > entry.updatedAt + entry.ttl) {
        storage.delete(key)
        continue
      }

      if (!prefix || key.startsWith(prefix)) {
        result[key] = entry.value
      }
    }

    return result
  }

  export async function set(
    key: string,
    value: any,
    options: {
      agentSessionID: string
      ttl?: number
      expectedVersion?: number
    }
  ): Promise<{ success: boolean; version: number; conflict?: boolean }> {
    const existing = storage.get(key)

    // Optimistic locking - check version if specified
    if (options.expectedVersion !== undefined && existing) {
      if (existing.version !== options.expectedVersion) {
        log.warn("version conflict detected", {
          key,
          expected: options.expectedVersion,
          actual: existing.version,
        })

        Bus.publish(Event.Conflict, {
          key,
          localVersion: options.expectedVersion,
          remoteVersion: existing.version,
          localValue: value,
          remoteValue: existing.value,
        })

        return { success: false, version: existing.version, conflict: true }
      }
    }

    const newVersion = existing ? existing.version + 1 : 1
    const entry: Entry = {
      key,
      value,
      version: newVersion,
      updatedAt: Date.now(),
      updatedBy: options.agentSessionID,
      ttl: options.ttl,
    }

    storage.set(key, entry)

    // Publish update event
    Bus.publish(Event.Update, {
      key,
      value,
      version: newVersion,
      updatedBy: options.agentSessionID,
      previousValue: existing?.value,
    })

    log.debug("memory entry set", { key, version: newVersion, agent: options.agentSessionID })

    return { success: true, version: newVersion }
  }

  export async function delete_(key: string, agentSessionID: string): Promise<boolean> {
    const existed = storage.has(key)
    if (existed) {
      storage.delete(key)
      Bus.publish(Event.Delete, { key, deletedBy: agentSessionID })
      log.debug("memory entry deleted", { key, agent: agentSessionID })
    }
    return existed
  }

  export async function atomicUpdate<T>(
    key: string,
    updater: (current: T | undefined) => T,
    options: { agentSessionID: string; maxRetries?: number }
  ): Promise<{ success: boolean; value: T; version: number }> {
    const maxRetries = options.maxRetries ?? 10
    let lastVersion = 0

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const current = await get(key)
      const newValue = updater(current?.value as T | undefined)

      const result = await set(key, newValue, {
        agentSessionID: options.agentSessionID,
        expectedVersion: current?.version,
      })

      if (result.success) {
        return { success: true, value: newValue, version: result.version }
      }

      lastVersion = result.version

      // Small delay before retry
      await new Promise(r => setTimeout(r, 10 * (attempt + 1)))
    }

    // Return current value on failure
    const current = await get(key)
    return {
      success: false,
      value: current?.value,
      version: lastVersion
    }
  }

  export function subscribe(
    keyPattern: string,
    callback: (event: { type: "update" | "delete"; key: string; value?: any; agent: string }) => void
  ): () => void {
    const pattern = keyPattern === "*" ? null : new RegExp(keyPattern.replace("*", ".*"))

    const handler = (event: any) => {
      if (!pattern || pattern.test(event.properties.key)) {
        callback({
          type: "update",
          key: event.properties.key,
          value: event.properties.value,
          agent: event.properties.updatedBy,
        })
      }
    }

    const unsubscribe = Bus.subscribe(Event.Update, handler)

    return unsubscribe
  }

  export async function clear(prefix?: string): Promise<number> {
    let count = 0
    if (prefix) {
      for (const key of storage.keys()) {
        if (key.startsWith(prefix)) {
          storage.delete(key)
          count++
        }
      }
    } else {
      count = storage.size
      storage.clear()
    }
    log.info("memory cleared", { count, prefix: prefix ?? "all" })
    return count
  }

  export function stats(): { entries: number; memoryUsage: number } {
    return {
      entries: storage.size,
      memoryUsage: JSON.stringify([...storage.entries()]).length,
    }
  }
}
