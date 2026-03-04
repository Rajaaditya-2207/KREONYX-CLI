import { z } from "zod"
import { ulid } from "ulid"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { AgentMessage } from "./message"
import { Voting } from "./vote"

export namespace Debate {
  const log = Log.create({ service: "debate" })

  export const DebateSession = z.object({
    id: z.string(),
    collaborationId: z.string(),
    topic: z.string(),
    description: z.string().optional(),
    initiator: z.string(), // agent session ID
    participants: z.array(z.string()), // agent session IDs
    format: z.enum(["structured", "freeform", "tournament", "devils_advocate"]).default("structured"),
    maxRounds: z.number().default(3),
    currentRound: z.number().default(0),
    speakingOrder: z.array(z.string()), // ordered list of participants
    currentSpeaker: z.string().optional(),
    status: z.enum(["pending", "active", "voting", "concluded", "cancelled"]).default("pending"),
    resolution: z.string().optional(),
    winningPosition: z.string().optional(),
    createdAt: z.number(),
    startedAt: z.number().optional(),
    concludedAt: z.number().optional(),
    timeLimitPerTurn: z.number().optional(), // in milliseconds
  })
  export type DebateSession = z.infer<typeof DebateSession>

  export const Argument = z.object({
    id: z.string(),
    debateId: z.string(),
    round: z.number(),
    speaker: z.string(), // agent session ID
    position: z.enum(["pro", "con", "neutral", "counter"]),
    content: z.string(),
    evidence: z.array(z.string()).optional(),
    timestamp: z.number(),
    respondingTo: z.string().optional(), // argument ID being responded to
  })
  export type Argument = z.infer<typeof Argument>

  export const Event = {
    DebateCreated: BusEvent.define("debate.created", DebateSession),
    DebateStarted: BusEvent.define("debate.started", z.object({ debateId: z.string(), round: z.number() })),
    TurnStarted: BusEvent.define("debate.turn_started", z.object({ debateId: z.string(), speaker: z.string(), round: z.number() })),
    ArgumentSubmitted: BusEvent.define("debate.argument_submitted", Argument),
    RoundCompleted: BusEvent.define("debate.round_completed", z.object({ debateId: z.string(), round: z.number(), nextRound: z.number() })),
    DebateConcluded: BusEvent.define("debate.concluded", z.object({ debateId: z.string(), resolution: z.string(), winningPosition: z.string() })),
  }

  const debates = new Map<string, DebateSession>()
  const arguments_ = new Map<string, Argument[]>() // debateId -> arguments

  export async function create(
    collaborationId: string,
    initiator: string,
    content: {
      topic: string
      description?: string
      participants: string[]
      format?: DebateSession["format"]
      maxRounds?: number
      timeLimitPerTurn?: number
    }
  ): Promise<DebateSession> {
    const debate: DebateSession = {
      id: ulid(),
      collaborationId,
      topic: content.topic,
      description: content.description,
      initiator,
      participants: content.participants,
      format: content.format ?? "structured",
      maxRounds: content.maxRounds ?? 3,
      currentRound: 0,
      speakingOrder: content.participants,
      status: "pending",
      createdAt: Date.now(),
      timeLimitPerTurn: content.timeLimitPerTurn,
    }

    debates.set(debate.id, debate)
    arguments_.set(debate.id, [])

    Bus.publish(Event.DebateCreated, debate)
    log.info("debate created", { debateId: debate.id, participants: content.participants.length })

    // Notify participants
    await AgentMessage.send(
      AgentMessage.create(
        "NOTIFY",
        initiator,
        collaborationId,
        {
          message: `Debate "${content.topic}" initiated by ${initiator}. ${content.participants.length} participants invited.`,
          level: "info",
        },
        { priority: "normal" }
      )
    )

    return debate
  }

  export async function start(debateId: string, initiator: string): Promise<{ success: boolean; error?: string }> {
    const debate = debates.get(debateId)
    if (!debate) {
      return { success: false, error: "Debate not found" }
    }

    if (debate.status !== "pending") {
      return { success: false, error: `Debate is already ${debate.status}` }
    }

    debate.status = "active"
    debate.startedAt = Date.now()
    debate.currentRound = 1
    debates.set(debateId, debate)

    Bus.publish(Event.DebateStarted, { debateId, round: 1 })
    log.info("debate started", { debateId, format: debate.format })

    // Start first turn
    await startTurn(debateId)

    return { success: true }
  }

  async function startTurn(debateId: string): Promise<void> {
    const debate = debates.get(debateId)
    if (!debate || debate.status !== "active") return

    const currentSpeaker = debate.speakingOrder[0]
    debate.currentSpeaker = currentSpeaker
    debates.set(debateId, debate)

    Bus.publish(Event.TurnStarted, {
      debateId,
      speaker: currentSpeaker,
      round: debate.currentRound,
    })

    log.debug("turn started", { debateId, speaker: currentSpeaker, round: debate.currentRound })

    // Request argument from current speaker
    await AgentMessage.send(
      AgentMessage.create(
        "REQUEST",
        debate.initiator,
        debate.collaborationId,
        {
          action: "debate_submit_argument",
          parameters: {
            debateId: debate.id,
            topic: debate.topic,
            round: debate.currentRound,
            speaker: currentSpeaker,
            format: debate.format,
            previousArguments: (arguments_.get(debateId) ?? []).slice(-3), // Last 3 arguments
          },
          deadline: debate.timeLimitPerTurn ? Date.now() + debate.timeLimitPerTurn : undefined,
        },
        {
          to: currentSpeaker,
          requiresResponse: true,
          priority: "normal",
        }
      )
    )
  }

  export async function submitArgument(
    debateId: string,
    speaker: string,
    content: {
      position: Argument["position"]
      content: string
      evidence?: string[]
      respondingTo?: string // argument ID
    }
  ): Promise<{ success: boolean; error?: string; argument?: Argument }> {
    const debate = debates.get(debateId)
    if (!debate) {
      return { success: false, error: "Debate not found" }
    }

    if (debate.status !== "active") {
      return { success: false, error: `Debate is ${debate.status}` }
    }

    if (debate.currentSpeaker !== speaker) {
      return { success: false, error: "It's not your turn" }
    }

    const argument: Argument = {
      id: ulid(),
      debateId,
      round: debate.currentRound,
      speaker,
      position: content.position,
      content: content.content,
      evidence: content.evidence,
      timestamp: Date.now(),
      respondingTo: content.respondingTo,
    }

    const debateArguments = arguments_.get(debateId) ?? []
    debateArguments.push(argument)
    arguments_.set(debateId, debateArguments)

    Bus.publish(Event.ArgumentSubmitted, argument)
    log.debug("argument submitted", { debateId, speaker, round: debate.currentRound })

    // Broadcast argument to all participants
    await AgentMessage.send(
      AgentMessage.create(
        "DEBATE",
        speaker,
        debate.collaborationId,
        {
          topic: debate.topic,
          position: content.position,
          argument: content.content,
          evidence: content.evidence,
        },
        { priority: "normal" }
      )
    )

    // Move to next speaker
    await advanceTurn(debateId)

    return { success: true, argument }
  }

  async function advanceTurn(debateId: string): Promise<void> {
    const debate = debates.get(debateId)
    if (!debate || debate.status !== "active") return

    // Rotate speaking order
    debate.speakingOrder.push(debate.speakingOrder.shift()!)

    // Check if round is complete
    const completedThisRound = (arguments_.get(debateId) ?? []).filter(
      a => a.round === debate.currentRound
    ).length

    if (completedThisRound >= debate.participants.length) {
      // Round complete
      Bus.publish(Event.RoundCompleted, {
        debateId,
        round: debate.currentRound,
        nextRound: debate.currentRound + 1,
      })

      debate.currentRound++

      // Check if debate should conclude
      if (debate.currentRound > debate.maxRounds) {
        await concludeDebate(debateId)
        return
      }
    }

    debates.set(debateId, debate)

    // Start next turn
    await startTurn(debateId)
  }

  async function concludeDebate(debateId: string): Promise<void> {
    const debate = debates.get(debateId)
    if (!debate) return

    debate.status = "concluded"
    debate.concludedAt = Date.now()

    // Analyze arguments to determine winning position
    const debateArguments = arguments_.get(debateId) ?? []

    // Simple scoring: count pro vs con arguments
    const proCount = debateArguments.filter(a => a.position === "pro").length
    const conCount = debateArguments.filter(a => a.position === "con").length

    if (proCount > conCount) {
      debate.winningPosition = "pro"
      debate.resolution = `The proposition "${debate.topic}" was supported by the majority of arguments (${proCount} pro vs ${conCount} con).`
    } else if (conCount > proCount) {
      debate.winningPosition = "con"
      debate.resolution = `The proposition "${debate.topic}" was opposed by the majority of arguments (${conCount} con vs ${proCount} pro).`
    } else {
      debate.winningPosition = "neutral"
      debate.resolution = `The debate on "${debate.topic}" resulted in a tie with equal pro and con arguments.`
    }

    debates.set(debateId, debate)

    Bus.publish(Event.DebateConcluded, {
      debateId,
      resolution: debate.resolution,
      winningPosition: debate.winningPosition,
    })

    log.info("debate concluded", {
      debateId,
      winningPosition: debate.winningPosition,
      totalArguments: debateArguments.length,
    })

    // Notify all participants
    await AgentMessage.send(
      AgentMessage.create(
        "COMPLETE",
        debate.initiator,
        debate.collaborationId,
        {
          taskId: debateId,
          summary: debate.resolution,
          artifacts: [
            {
              type: "documentation",
              content: JSON.stringify({
                topic: debate.topic,
                arguments: debateArguments,
                result: debate.winningPosition,
              }, null, 2),
            },
          ],
          metrics: {
            timeTaken: debate.concludedAt - (debate.startedAt ?? debate.createdAt),
          },
        },
        { priority: "high" }
      )
    )
  }

  export async function startVoting(
    debateId: string,
    initiator: string,
    options: { title?: string; votingStrategy?: Voting.Proposal["votingStrategy"] }
  ): Promise<{ success: boolean; error?: string; proposalId?: string }> {
    const debate = debates.get(debateId)
    if (!debate) {
      return { success: false, error: "Debate not found" }
    }

    debate.status = "voting"
    debates.set(debateId, debate)

    // Create a voting proposal based on debate
    const proposal = await Voting.createProposal(debate.collaborationId, initiator, {
      title: options.title ?? `Vote on: ${debate.topic}`,
      description: debate.description ?? `Vote to approve the position: ${debate.winningPosition ?? "undecided"}`,
      options: [
        { id: "approve", label: "Approve the winning position", description: "Support the conclusion" },
        { id: "reject", label: "Reject the winning position", description: "Oppose the conclusion" },
        { id: "abstain", label: "Abstain", description: "No strong opinion" },
      ],
      votingStrategy: options.votingStrategy ?? "majority",
      minVotes: debate.participants.length,
    })

    return { success: true, proposalId: proposal.id }
  }

  export async function skipTurn(debateId: string, speaker: string): Promise<{ success: boolean; error?: string }> {
    const debate = debates.get(debateId)
    if (!debate) {
      return { success: false, error: "Debate not found" }
    }

    if (debate.currentSpeaker !== speaker) {
      return { success: false, error: "It's not your turn" }
    }

    log.debug("turn skipped", { debateId, speaker })

    await advanceTurn(debateId)
    return { success: true }
  }

  export async function cancelDebate(debateId: string, initiator: string): Promise<boolean> {
    const debate = debates.get(debateId)
    if (!debate) return false

    if (debate.initiator !== initiator) {
      return false
    }

    if (debate.status === "concluded" || debate.status === "cancelled") {
      return false
    }

    debate.status = "cancelled"
    debate.concludedAt = Date.now()
    debates.set(debateId, debate)

    log.info("debate cancelled", { debateId })

    await AgentMessage.send(
      AgentMessage.create(
        "NOTIFY",
        initiator,
        debate.collaborationId,
        {
          message: `Debate "${debate.topic}" has been cancelled by the initiator.`,
          level: "warn",
        },
        { priority: "high" }
      )
    )

    return true
  }

  export async function getDebate(debateId: string): Promise<DebateSession | undefined> {
    return debates.get(debateId)
  }

  export async function getArguments(debateId: string): Promise<Argument[]> {
    return arguments_.get(debateId) ?? []
  }

  export async function getArgumentsByRound(debateId: string, round: number): Promise<Argument[]> {
    return (arguments_.get(debateId) ?? []).filter(a => a.round === round)
  }

  export async function getActiveDebates(collaborationId?: string): Promise<DebateSession[]> {
    let result = Array.from(debates.values()).filter(d =>
      d.status === "active" || d.status === "pending"
    )

    if (collaborationId) {
      result = result.filter(d => d.collaborationId === collaborationId)
    }

    return result.sort((a, b) => b.createdAt - a.createdAt)
  }

  export async function getParticipantDebates(agent: string): Promise<{
    active: DebateSession[]
    past: DebateSession[]
  }> {
    const all = Array.from(debates.values())

    const active = all.filter(
      d => d.participants.includes(agent) && (d.status === "active" || d.status === "pending" || d.status === "voting")
    )

    const past = all.filter(
      d => d.participants.includes(agent) && (d.status === "concluded" || d.status === "cancelled")
    )

    return { active, past }
  }

  export function subscribeToDebate(
    debateId: string,
    callback: (event: { type: string; data: any }) => void
  ): () => void {
    const unsubscribe: (() => void)[] = []

    unsubscribe.push(
      Bus.subscribe(Event.DebateStarted, (event: { debateId: string }) => {
        if (event.debateId === debateId) callback({ type: "started", data: event })
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.TurnStarted, (event: { debateId: string }) => {
        if (event.debateId === debateId) callback({ type: "turn_started", data: event })
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.ArgumentSubmitted, (arg: Argument) => {
        if (arg.debateId === debateId) callback({ type: "argument", data: arg })
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.RoundCompleted, (event: { debateId: string }) => {
        if (event.debateId === debateId) callback({ type: "round_completed", data: event })
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.DebateConcluded, (event: { debateId: string }) => {
        if (event.debateId === debateId) callback({ type: "concluded", data: event })
      })
    )

    return () => unsubscribe.forEach(u => u())
  }

  // Format debate for display
  export function formatDebateSummary(debateId: string): string {
    const debate = debates.get(debateId)
    if (!debate) return "Debate not found"

    const debateArguments = arguments_.get(debateId) ?? []

    let summary = `# ${debate.topic}\n\n`
    summary += `**Format:** ${debate.format}\n`
    summary += `**Status:** ${debate.status}\n`
    summary += `**Round:** ${debate.currentRound}/${debate.maxRounds}\n`
    summary += `**Participants:** ${debate.participants.join(", ")}\n\n`

    if (debateArguments.length > 0) {
      summary += "## Arguments\n\n"
      for (const arg of debateArguments) {
        summary += `### Round ${arg.round} - ${arg.speaker} (${arg.position})\n`
        summary += `${arg.content}\n\n`
        if (arg.evidence && arg.evidence.length > 0) {
          summary += `**Evidence:** ${arg.evidence.join(", ")}\n\n`
        }
      }
    }

    if (debate.resolution) {
      summary += `## Resolution\n${debate.resolution}\n`
    }

    return summary
  }
}
