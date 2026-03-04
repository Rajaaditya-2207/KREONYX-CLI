import path from "path"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { z } from "zod"
import { ulid } from "ulid"
import { Global } from "@/global"

export namespace SharedFilesystem {
  const log = Log.create({ service: "shared-filesystem" })

  export const Lock = z.object({
    id: z.string(),
    filePath: z.string(),
    agentSessionID: z.string(),
    acquiredAt: z.number(),
    expiresAt: z.number(),
    exclusive: z.boolean(), // true = exclusive lock, false = shared lock
  })
  export type Lock = z.infer<typeof Lock>

  export const FileState = z.object({
    path: z.string(),
    hash: z.string(), // content hash for change detection
    lastModified: z.number(),
    lastModifiedBy: z.string(),
    version: z.number(),
    lockedBy: Lock.nullable(),
  })
  export type FileState = z.infer<typeof FileState>

  export const Event = {
    FileLocked: BusEvent.define(
      "fs.file_locked",
      z.object({
        filePath: z.string(),
        lock: Lock,
      }),
    ),
    FileUnlocked: BusEvent.define(
      "fs.file_unlocked",
      z.object({
        filePath: z.string(),
        lock: Lock,
      }),
    ),
    FileChanged: BusEvent.define(
      "fs.file_changed",
      z.object({
        filePath: z.string(),
        previousHash: z.string().optional(),
        currentHash: z.string(),
        changedBy: z.string(),
      }),
    ),
    Conflict: BusEvent.define(
      "fs.conflict",
      z.object({
        filePath: z.string(),
        localVersion: z.number(),
        remoteVersion: z.number(),
        localHash: z.string(),
        remoteHash: z.string(),
      }),
    ),
  }

  // In-memory tracking of file states and locks
  const fileStates = new Map<string, FileState>()
  const activeLocks = new Map<string, Lock[]>() // filePath -> locks

  function getLockPath(filePath: string): string {
    return path.resolve(Instance.worktree, filePath)
  }

  export async function acquireLock(
    filePath: string,
    options: {
      agentSessionID: string
      exclusive?: boolean
      timeout?: number // timeout in ms
      ttl?: number // lock TTL in ms (default 30s)
    }
  ): Promise<{ success: boolean; lock?: Lock; error?: string }> {
    const resolvedPath = getLockPath(filePath)
    const ttl = options.ttl ?? 30000
    const expiresAt = Date.now() + ttl

    const existingLocks = activeLocks.get(resolvedPath) ?? []

    // Check if already locked exclusively
    const exclusiveLock = existingLocks.find((l) => l.exclusive)
    if (exclusiveLock) {
      // Check if expired
      if (exclusiveLock.expiresAt < Date.now()) {
        // Remove expired lock
        activeLocks.set(
          resolvedPath,
          existingLocks.filter((l) => l.id !== exclusiveLock.id)
        )
      } else {
        return {
          success: false,
          error: `File is exclusively locked by ${exclusiveLock.agentSessionID} until ${new Date(exclusiveLock.expiresAt).toISOString()}`,
        }
      }
    }

    // If requesting exclusive lock, check for any existing locks
    if (options.exclusive && existingLocks.length > 0) {
      // Check for expired locks
      const now = Date.now()
      const validLocks = existingLocks.filter((l) => l.expiresAt > now)

      if (validLocks.length > 0) {
        return {
          success: false,
          error: `File has ${validLocks.length} active shared lock(s)`,
        }
      }

      // Update locks after removing expired ones
      activeLocks.set(resolvedPath, validLocks)
    }

    const lock: Lock = {
      id: ulid(),
      filePath: resolvedPath,
      agentSessionID: options.agentSessionID,
      acquiredAt: Date.now(),
      expiresAt,
      exclusive: options.exclusive ?? false,
    }

    const newLocks = [...(activeLocks.get(resolvedPath) ?? []), lock]
    activeLocks.set(resolvedPath, newLocks)

    // Update file state
    const state = fileStates.get(resolvedPath) ?? {
      path: resolvedPath,
      hash: "",
      lastModified: 0,
      lastModifiedBy: "",
      version: 0,
      lockedBy: lock,
    }
    state.lockedBy = lock
    fileStates.set(resolvedPath, state)

    Bus.publish(Event.FileLocked, { filePath: resolvedPath, lock })
    log.debug("lock acquired", { filePath, agent: options.agentSessionID, exclusive: lock.exclusive })

    return { success: true, lock }
  }

  export async function releaseLock(lockId: string, agentSessionID: string): Promise<boolean> {
    for (const [filePath, locks] of activeLocks.entries()) {
      const lockIndex = locks.findIndex((l) => l.id === lockId)
      if (lockIndex >= 0) {
        const lock = locks[lockIndex]

        // Only the owner or admin can release
        if (lock.agentSessionID !== agentSessionID) {
          log.warn("attempted to release lock owned by another agent", {
            lockId,
            owner: lock.agentSessionID,
            attemptedBy: agentSessionID,
          })
          return false
        }

        const newLocks = locks.filter((_, i) => i !== lockIndex)
        activeLocks.set(filePath, newLocks)

        // Update file state
        const state = fileStates.get(filePath)
        if (state?.lockedBy?.id === lockId) {
          state.lockedBy = newLocks.length > 0 ? newLocks[0] : null
        }

        Bus.publish(Event.FileUnlocked, { filePath, lock })
        log.debug("lock released", { filePath, agent: agentSessionID })

        return true
      }
    }
    return false
  }

  export async function withLock<T>(
    filePath: string,
    fn: () => Promise<T>,
    options: {
      agentSessionID: string
      exclusive?: boolean
      ttl?: number
    }
  ): Promise<T> {
    const result = await acquireLock(filePath, options)
    if (!result.success) {
      throw new Error(`Failed to acquire lock: ${result.error}`)
    }

    try {
      return await fn()
    } finally {
      if (result.lock) {
        await releaseLock(result.lock.id, options.agentSessionID)
      }
    }
  }

  export async function trackChange(
    filePath: string,
    options: {
      agentSessionID: string
      contentHash: string
    }
  ): Promise<void> {
    const resolvedPath = getLockPath(filePath)
    const existing = fileStates.get(resolvedPath)

    const newState: FileState = {
      path: resolvedPath,
      hash: options.contentHash,
      lastModified: Date.now(),
      lastModifiedBy: options.agentSessionID,
      version: existing ? existing.version + 1 : 1,
      lockedBy: existing?.lockedBy ?? null,
    }

    // Detect conflict if hash changed unexpectedly
    if (existing && existing.hash !== options.contentHash && existing.lastModifiedBy !== options.agentSessionID) {
      // Someone else modified the file
      Bus.publish(Event.Conflict, {
        filePath: resolvedPath,
        localVersion: existing.version,
        remoteVersion: existing.version + 1,
        localHash: existing.hash,
        remoteHash: options.contentHash,
      })
    }

    Bus.publish(Event.FileChanged, {
      filePath: resolvedPath,
      previousHash: existing?.hash,
      currentHash: options.contentHash,
      changedBy: options.agentSessionID,
    })

    fileStates.set(resolvedPath, newState)
  }

  export async function getState(filePath: string): Promise<FileState | undefined> {
    return fileStates.get(getLockPath(filePath))
  }

  export async function isLocked(filePath: string): Promise<{ locked: boolean; exclusive: boolean; by?: string }> {
    const resolvedPath = getLockPath(filePath)
    const locks = activeLocks.get(resolvedPath) ?? []

    // Clean expired locks
    const now = Date.now()
    const validLocks = locks.filter((l) => l.expiresAt > now)

    if (validLocks.length === 0) {
      return { locked: false, exclusive: false }
    }

    const exclusiveLock = validLocks.find((l) => l.exclusive)
    if (exclusiveLock) {
      return { locked: true, exclusive: true, by: exclusiveLock.agentSessionID }
    }

    return { locked: true, exclusive: false, by: validLocks[0].agentSessionID }
  }

  export function cleanupExpiredLocks(): number {
    let cleaned = 0
    const now = Date.now()

    for (const [filePath, locks] of activeLocks.entries()) {
      const validLocks = locks.filter((l) => {
        if (l.expiresAt <= now) {
          cleaned++
          Bus.publish(Event.FileUnlocked, { filePath, lock: l })
          return false
        }
        return true
      })

      if (validLocks.length !== locks.length) {
        activeLocks.set(filePath, validLocks)
      }
    }

    if (cleaned > 0) {
      log.debug("cleaned expired locks", { count: cleaned })
    }

    return cleaned
  }

  // Periodic cleanup
  setInterval(cleanupExpiredLocks, 10000)

  /**
   * Read a file from the shared filesystem
   * Acquires a shared lock for reading
   */
  export async function read(filePath: string): Promise<string | undefined> {
    const resolvedPath = getLockPath(filePath)
    const fs = await import("fs")

    try {
      const content = await fs.promises.readFile(resolvedPath, "utf-8")
      return content
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined
      }
      throw err
    }
  }

  /**
   * Write to a file in the shared filesystem
   * Acquires an exclusive lock for writing
   */
  export async function write(
    filePath: string,
    content: string,
    options?: { overwrite?: boolean }
  ): Promise<void> {
    const resolvedPath = getLockPath(filePath)
    const fs = await import("fs")
    const { overwrite = false } = options ?? {}

    // Check if file exists
    if (!overwrite) {
      try {
        await fs.promises.access(resolvedPath)
        throw new Error(`File already exists: ${filePath}`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err
        }
      }
    }

    // Ensure directory exists
    const dir = path.dirname(resolvedPath)
    await fs.promises.mkdir(dir, { recursive: true })

    // Write the file
    await fs.promises.writeFile(resolvedPath, content, "utf-8")
  }

  export async function waitForUnlock(
    filePath: string,
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<boolean> {
    const timeout = options.timeout ?? 30000
    const pollInterval = options.pollInterval ?? 100
    const start = Date.now()

    while (Date.now() - start < timeout) {
      const status = await isLocked(filePath)
      if (!status.locked) return true
      await new Promise((r) => setTimeout(r, pollInterval))
    }

    return false
  }

  // Simple file read with optional locking
  export async function read(
    filePath: string,
    options?: { agentSessionID?: string; lock?: boolean }
  ): Promise<string | undefined> {
    const resolvedPath = getLockPath(filePath)
    const fs = await import("fs/promises")

    try {
      if (options?.lock && options.agentSessionID) {
        return await withLock(
          filePath,
          async () => {
            const content = await fs.readFile(resolvedPath, "utf-8")
            return content
          },
          { agentSessionID: options.agentSessionID!, exclusive: false }
        )
      }
      return await fs.readFile(resolvedPath, "utf-8")
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined
      }
      throw err
    }
  }

  // Simple file write with optional locking and change tracking
  export async function write(
    filePath: string,
    content: string,
    options?: {
      agentSessionID?: string
      overwrite?: boolean
      track?: boolean
    }
  ): Promise<void> {
    const resolvedPath = getLockPath(filePath)
    const fs = await import("fs/promises")
    const crypto = await import("crypto")

    const doWrite = async () => {
      // Check if file exists
      let exists = false
      try {
        await fs.access(resolvedPath)
        exists = true
      } catch {
        exists = false
      }

      if (exists && options?.overwrite === false) {
        throw new Error(`File already exists: ${filePath}`)
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
      await fs.writeFile(resolvedPath, content, "utf-8")

      // Track the change if requested
      if (options?.track && options.agentSessionID) {
        const hash = crypto.createHash("sha256").update(content).digest("hex")
        await trackChange(filePath, {
          agentSessionID: options.agentSessionID!,
          contentHash: hash,
        })
      }
    }

    if (options?.agentSessionID) {
      await withLock(filePath, doWrite, {
        agentSessionID: options.agentSessionID,
        exclusive: true,
      })
    } else {
      await doWrite()
    }
  }
}
