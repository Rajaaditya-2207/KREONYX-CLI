import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "@/util/log"
import { z } from "zod"
import { ulid } from "ulid"
import type { Session } from "@/session"

export namespace AgentMessage {
  const log = Log.create({ service: "agent-message" })

  // Message types for agent communication
  export const Type = z.enum([
    "PROPOSE",      // Agent proposes a solution/idea
    "REVIEW",       // Agent reviews another's work
    "VOTE",         // Agent casts a vote
    "DEBATE",       // Agent participates in debate
    "NOTIFY",       // General notification
    "REQUEST",      // Agent requests something from another
    "RESPONSE",     // Response to a request
    "SYNCHRONIZE",  // Sync shared state
    "COMPLETE",     // Agent completes a task
    "ERROR",        // Error occurred
  ])
  export type Type = z.infer<typeof Type>

  // Base message structure
  export const Base = z.object({
    id: z.string(),
    type: Type,
    from: z.string(), // agent session ID
    to: z.string().optional(), // specific recipient (optional for broadcast)
    collaborationId: z.string(), // ID of the collaboration session
    timestamp: z.number(),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    requiresResponse: z.boolean().default(false),
    inReplyTo: z.string().optional(), // ID of message this is replying to
  })

  // Content schemas for each message type
  export const ProposeContent = z.object({
    proposal: z.string(),
    rationale: z.string().optional(),
    alternatives: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })

  export const ReviewContent = z.object({
    targetMessageId: z.string(), // What is being reviewed
    verdict: z.enum(["approve", "reject", "request_changes", "comment"]),
    comments: z.array(z.object({
      line: z.number().optional(),
      file: z.string().optional(),
      message: z.string(),
      severity: z.enum(["info", "warning", "error", "critical"]).default("info"),
    })),
    suggestions: z.array(z.string()).optional(),
  })

  export const VoteContent = z.object({
    proposalId: z.string(),
    vote: z.enum(["for", "against", "abstain"]),
    reasoning: z.string().optional(),
  })

  export const DebateContent = z.object({
    topic: z.string(),
    position: z.enum(["for", "against", "neutral"]),
    argument: z.string(),
    evidence: z.array(z.string()).optional(),
  })

  export const RequestContent = z.object({
    action: z.string(),
    parameters: z.record(z.string(), z.any()).optional(),
    deadline: z.number().optional(),
  })

  export const ResponseContent = z.object({
    requestId: z.string(),
    status: z.enum(["success", "failure", "partial", "in_progress"]),
    result: z.any().optional(),
    error: z.string().optional(),
  })

  export const SynchronizeContent = z.object({
    key: z.string(),
    value: z.any(),
    operation: z.enum(["set", "delete", "merge"]),
  })

  export const CompleteContent = z.object({
    taskId: z.string(),
    summary: z.string(),
    artifacts: z.array(z.object({
      type: z.enum(["file", "code", "documentation", "test"]),
      path: z.string().optional(),
      content: z.string().optional(),
    })).optional(),
    metrics: z.object({
      tokensUsed: z.number().optional(),
      timeTaken: z.number().optional(),
      filesModified: z.number().optional(),
    }).optional(),
  })

  export const ErrorContent = z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
    recoverable: z.boolean().default(false),
  })

  // Union of all message types
  export const Message = z.discriminatedUnion("type", [
    Base.extend({ type: z.literal("PROPOSE"), content: ProposeContent }),
    Base.extend({ type: z.literal("REVIEW"), content: ReviewContent }),
    Base.extend({ type: z.literal("VOTE"), content: VoteContent }),
    Base.extend({ type: z.literal("DEBATE"), content: DebateContent }),
    Base.extend({ type: z.literal("NOTIFY"), content: z.object({ message: z.string(), level: z.enum(["info", "warn", "error"]) }) }),
    Base.extend({ type: z.literal("REQUEST"), content: RequestContent }),
    Base.extend({ type: z.literal("RESPONSE"), content: ResponseContent }),
    Base.extend({ type: z.literal("SYNCHRONIZE"), content: SynchronizeContent }),
    Base.extend({ type: z.literal("COMPLETE"), content: CompleteContent }),
    Base.extend({ type: z.literal("ERROR"), content: ErrorContent }),
  ])
  export type Message = z.infer<typeof Message>

  // Message events for Bus
  export const Event = {
    MessageReceived: BusEvent.define("agent.message.received", Message),
    MessageSent: BusEvent.define("agent.message.sent", Message),
    ResponseTimeout: BusEvent.define("agent.message.timeout", z.object({ messageId: z.string(), collaborationId: z.string() })),
  }

  // Message history storage
  const messageHistory = new Map<string, Message[]>() // collaborationId -> messages
  const pendingResponses = new Map<string, { resolve: (msg: Message) => void; reject: (err: Error) => void; timeout: number }>()

  export function create(
    type: Message["type"],
    from: string,
    collaborationId: string,
    content: Message["content"],
    options: {
      to?: string
      priority?: Message["priority"]
      requiresResponse?: boolean
      inReplyTo?: string
    } = {}
  ): Message {
    const base = {
      id: ulid(),
      type,
      from,
      to: options.to,
      collaborationId,
      timestamp: Date.now(),
      priority: options.priority ?? "normal",
      requiresResponse: options.requiresResponse ?? false,
      inReplyTo: options.inReplyTo,
    }

    return { ...base, content } as Message
  }

  export async function send(message: Message): Promise<void> {
    // Store in history
    const history = messageHistory.get(message.collaborationId) ?? []
    history.push(message)
    messageHistory.set(message.collaborationId, history)

    // Publish event
    Bus.publish(Event.MessageSent, message)
    Bus.publish(Event.MessageReceived, message)

    log.debug("message sent", {
      id: message.id,
      type: message.type,
      from: message.from,
      to: message.to ?? "broadcast",
      collaborationId: message.collaborationId,
    })
  }

  export async function sendAndWait(
    message: Message,
    options: { timeout?: number } = {}
  ): Promise<Message> {
    const timeout = options.timeout ?? 60000

    return new Promise((resolve, reject) => {
      // Set up response handler
      const timeoutId = setTimeout(() => {
        pendingResponses.delete(message.id)
        Bus.publish(Event.ResponseTimeout, { messageId: message.id, collaborationId: message.collaborationId })
        reject(new Error(`Timeout waiting for response to message ${message.id}`))
      }, timeout)

      pendingResponses.set(message.id, {
        resolve: (msg: Message) => {
          clearTimeout(timeoutId)
          resolve(msg)
        },
        reject: (err: Error) => {
          clearTimeout(timeoutId)
          reject(err)
        },
        timeout: timeoutId,
      })

      // Send the message
      send(message).catch(reject)
    })
  }

  export async function reply(
    originalMessage: Message,
    from: string,
    type: Message["type"],
    content: Message["content"]
  ): Promise<void> {
    const reply = create(
      type,
      from,
      originalMessage.collaborationId,
      content,
      {
        to: originalMessage.from,
        inReplyTo: originalMessage.id,
      }
    )

    // Check if someone is waiting for this response
    const pending = pendingResponses.get(originalMessage.id)
    if (pending && reply.type === "RESPONSE") {
      pending.resolve(reply)
      pendingResponses.delete(originalMessage.id)
    }

    await send(reply)
  }

  export async function getHistory(
    collaborationId: string,
    options: {
      since?: number
      from?: string
      to?: string
      type?: Type
    } = {}
  ): Promise<Message[]> {
    let messages = messageHistory.get(collaborationId) ?? []

    if (options.since) {
      messages = messages.filter((m) => m.timestamp >= options.since!)
    }
    if (options.from) {
      messages = messages.filter((m) => m.from === options.from)
    }
    if (options.to) {
      messages = messages.filter((m) => m.to === options.to)
    }
    if (options.type) {
      messages = messages.filter((m) => m.type === options.type)
    }

    return messages
  }

  export async function getThread(
    messageId: string,
    collaborationId: string
  ): Promise<Message[]> {
    const history = messageHistory.get(collaborationId) ?? []
    const thread: Message[] = []

    // Find the root message
    let current = history.find((m) => m.id === messageId)
    if (!current) return []

    // Add to thread
    thread.push(current)

    // Find all replies
    const findReplies = (parentId: string) => {
      const replies = history.filter((m) => m.inReplyTo === parentId)
      for (const reply of replies) {
        thread.push(reply)
        findReplies(reply.id)
      }
    }

    findReplies(messageId)

    // Sort by timestamp
    return thread.sort((a, b) => a.timestamp - b.timestamp)
  }

  export function subscribe(
    collaborationId: string,
    handler: (message: Message) => void | Promise<void>
  ): () => void {
    const subscription = Bus.subscribe(Event.MessageReceived, (message: Message) => {
      if (message.collaborationId === collaborationId) {
        handler(message)
      }
    })

    return subscription
  }

  export function subscribeToType(
    type: Type,
    handler: (message: Message) => void | Promise<void>
  ): () => void {
    const subscription = Bus.subscribe(Event.MessageReceived, (message: Message) => {
      if (message.type === type) {
        handler(message)
      }
    })

    return subscription
  }

  export async function clearHistory(collaborationId: string): Promise<void> {
    messageHistory.delete(collaborationId)
    log.info("message history cleared", { collaborationId })
  }

  export function getStats(collaborationId?: string): { total: number; byType: Record<Type, number> } {
    const messages = collaborationId
      ? (messageHistory.get(collaborationId) ?? [])
      : Array.from(messageHistory.values()).flat()

    const byType: Record<Type, number> = {
      PROPOSE: 0, REVIEW: 0, VOTE: 0, DEBATE: 0,
      NOTIFY: 0, REQUEST: 0, RESPONSE: 0, SYNCHRONIZE: 0,
      COMPLETE: 0, ERROR: 0,
    }

    for (const msg of messages) {
      byType[msg.type] = (byType[msg.type] ?? 0) + 1
    }

    return { total: messages.length, byType }
  }
}
