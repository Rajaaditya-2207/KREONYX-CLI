import { z } from "zod"
import { ulid } from "ulid"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { AgentMessage } from "./message"

export namespace Voting {
  const log = Log.create({ service: "voting" })

  export const Proposal = z.object({
    id: z.string(),
    collaborationId: z.string(),
    title: z.string(),
    description: z.string(),
    proposer: z.string(), // agent session ID
    options: z.array(z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
    })).optional(), // for multiple choice voting
    votingStrategy: z.enum(["majority", "unanimous", "weighted", "ranked"]).default("majority"),
    minVotes: z.number().optional(), // minimum votes required
    quorum: z.number().optional(), // percentage of participants required
    createdAt: z.number(),
    deadline: z.number().optional(),
    status: z.enum(["open", "closed", "executed", "cancelled"]).default("open"),
    result: z.object({
      winningOption: z.string().optional(),
      votes: z.record(z.string(), z.number()), // optionId -> count
      totalVotes: z.number(),
      consensusReached: z.boolean(),
    }).optional(),
  })
  export type Proposal = z.infer<typeof Proposal>

  export const Vote = z.object({
    id: z.string(),
    proposalId: z.string(),
    voter: z.string(), // agent session ID
    choice: z.union([z.string(), z.array(z.string())]), // single option or ranked choices
    weight: z.number().default(1),
    reasoning: z.string().optional(),
    timestamp: z.number(),
  })
  export type Vote = z.infer<typeof Vote>

  export const Event = {
    ProposalCreated: BusEvent.define("voting.proposal_created", Proposal),
    VoteCast: BusEvent.define("voting.vote_cast", Vote),
    ProposalClosed: BusEvent.define("voting.proposal_closed", z.object({
      proposalId: z.string(),
      result: z.object({
        winningOption: z.string().optional(),
        votes: z.record(z.string(), z.number()),
        totalVotes: z.number(),
        consensusReached: z.boolean(),
      }),
    })),
    ConsensusReached: BusEvent.define("voting.consensus_reached", z.object({
      proposalId: z.string(),
      winningOption: z.string(),
      agreement: z.number(), // percentage of agreement
    })),
  }

  const proposals = new Map<string, Proposal>()
  const votes = new Map<string, Vote[]>() // proposalId -> votes

  export async function createProposal(
    collaborationId: string,
    proposer: string,
    content: {
      title: string
      description: string
      options?: { id: string; label: string; description?: string }[]
      votingStrategy?: Proposal["votingStrategy"]
      minVotes?: number
      quorum?: number
      deadline?: number
    }
  ): Promise<Proposal> {
    const proposal: Proposal = {
      id: ulid(),
      collaborationId,
      title: content.title,
      description: content.description,
      proposer,
      options: content.options,
      votingStrategy: content.votingStrategy ?? "majority",
      minVotes: content.minVotes,
      quorum: content.quorum,
      createdAt: Date.now(),
      deadline: content.deadline,
      status: "open",
    }

    proposals.set(proposal.id, proposal)
    votes.set(proposal.id, [])

    Bus.publish(Event.ProposalCreated, proposal)
    log.info("proposal created", { proposalId: proposal.id, title: proposal.title })

    // Broadcast to all agents in collaboration
    await AgentMessage.send(
      AgentMessage.create(
        "PROPOSE",
        proposer,
        collaborationId,
        {
          proposal: `${proposal.title}: ${proposal.description}`,
          rationale: `Voting strategy: ${proposal.votingStrategy}`,
          alternatives: proposal.options?.map(o => o.label) ?? [],
          confidence: 1.0,
        },
        { priority: "high" }
      )
    )

    return proposal
  }

  export async function castVote(
    proposalId: string,
    voter: string,
    choice: string | string[],
    options: { weight?: number; reasoning?: string } = {}
  ): Promise<{ success: boolean; error?: string; vote?: Vote }> {
    const proposal = proposals.get(proposalId)
    if (!proposal) {
      return { success: false, error: "Proposal not found" }
    }

    if (proposal.status !== "open") {
      return { success: false, error: `Proposal is ${proposal.status}` }
    }

    if (proposal.deadline && Date.now() > proposal.deadline) {
      await closeProposal(proposalId, "deadline_reached")
      return { success: false, error: "Voting deadline has passed" }
    }

    const proposalVotes = votes.get(proposalId) ?? []

    // Check if already voted
    const existingIndex = proposalVotes.findIndex(v => v.voter === voter)
    if (existingIndex >= 0) {
      // Update vote
      proposalVotes[existingIndex] = {
        ...proposalVotes[existingIndex],
        choice,
        weight: options.weight ?? 1,
        reasoning: options.reasoning,
        timestamp: Date.now(),
      }
    } else {
      // New vote
      const vote: Vote = {
        id: ulid(),
        proposalId,
        voter,
        choice,
        weight: options.weight ?? 1,
        reasoning: options.reasoning,
        timestamp: Date.now(),
      }
      proposalVotes.push(vote)
    }

    votes.set(proposalId, proposalVotes)

    const vote = proposalVotes[existingIndex >= 0 ? existingIndex : proposalVotes.length - 1]

    Bus.publish(Event.VoteCast, vote)
    log.debug("vote cast", { proposalId, voter, choice })

    // Check if we should auto-close
    await checkAutoClose(proposalId)

    // Notify via message bus
    await AgentMessage.send(
      AgentMessage.create(
        "VOTE",
        voter,
        proposal.collaborationId,
        {
          proposalId,
          vote: Array.isArray(choice) ? "for" : choice === (proposal.options?.[0]?.id ?? "yes") ? "for" : "against",
          reasoning: options.reasoning,
        },
        { priority: "normal" }
      )
    )

    return { success: true, vote }
  }

  async function checkAutoClose(proposalId: string): Promise<void> {
    const proposal = proposals.get(proposalId)
    if (!proposal || proposal.status !== "open") return

    const proposalVotes = votes.get(proposalId) ?? []

    // Check minimum votes
    if (proposal.minVotes && proposalVotes.length < proposal.minVotes) return

    // Check if we have enough participants for quorum
    const uniqueVoters = new Set(proposalVotes.map(v => v.voter))
    // For now, we'll just check if consensus is possible
    // In a real implementation, you'd track total eligible voters

    const result = calculateResult(proposalId)

    // For unanimous voting, check if all votes are the same
    if (proposal.votingStrategy === "unanimous") {
      const firstChoice = proposalVotes[0]?.choice
      const allSame = proposalVotes.every(v =>
        JSON.stringify(v.choice) === JSON.stringify(firstChoice)
      )
      if (allSame && proposalVotes.length >= (proposal.minVotes ?? 2)) {
        await closeProposal(proposalId, "consensus_reached", result)
        return
      }
    }
  }

  function calculateResult(proposalId: string): Proposal["result"] {
    const proposal = proposals.get(proposalId)
    if (!proposal) return undefined

    const proposalVotes = votes.get(proposalId) ?? []
    const voteCounts: Record<string, number> = {}

    for (const vote of proposalVotes) {
      if (Array.isArray(vote.choice)) {
        // Ranked voting - assign points based on rank
        const points = vote.choice.length
        for (let i = 0; i < vote.choice.length; i++) {
          const option = vote.choice[i]
          voteCounts[option] = (voteCounts[option] ?? 0) + (points - i) * vote.weight
        }
      } else {
        voteCounts[vote.choice] = (voteCounts[vote.choice] ?? 0) + vote.weight
      }
    }

    // Find winner
    let winningOption: string | undefined
    let maxVotes = 0

    for (const [option, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count
        winningOption = option
      }
    }

    // Check if consensus reached based on strategy
    let consensusReached = false
    const totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0)

    if (proposal.votingStrategy === "majority" && winningOption) {
      consensusReached = maxVotes > totalVotes / 2
    } else if (proposal.votingStrategy === "unanimous" && winningOption) {
      // For unanimous: all votes must be for the same option AND we have minVotes
      const firstChoice = proposalVotes[0]?.choice
      const allSame = proposalVotes.every(v =>
        JSON.stringify(v.choice) === JSON.stringify(firstChoice)
      )
      consensusReached = allSame && proposalVotes.length >= (proposal.minVotes ?? proposalVotes.length)
    } else if (proposal.votingStrategy === "weighted" && winningOption) {
      consensusReached = maxVotes > totalVotes / 2
    }

    return {
      winningOption,
      votes: voteCounts,
      totalVotes: proposalVotes.length,
      consensusReached,
    }
  }

  export async function closeProposal(
    proposalId: string,
    reason: string,
    precomputedResult?: Proposal["result"]
  ): Promise<Proposal | undefined> {
    const proposal = proposals.get(proposalId)
    if (!proposal || proposal.status !== "open") return undefined

    const result = precomputedResult ?? calculateResult(proposalId)

    proposal.status = result?.consensusReached ? "executed" : "closed"
    proposal.result = result

    proposals.set(proposalId, proposal)

    Bus.publish(Event.ProposalClosed, {
      proposalId,
      result: result!,
    })

    if (result?.consensusReached && result.winningOption) {
      Bus.publish(Event.ConsensusReached, {
        proposalId,
        winningOption: result.winningOption,
        agreement: result.totalVotes > 0
          ? (result.votes[result.winningOption] ?? 0) / Object.values(result.votes).reduce((a, b) => a + b, 0)
          : 0,
      })
    }

    log.info("proposal closed", {
      proposalId,
      reason,
      consensusReached: result?.consensusReached,
      winningOption: result?.winningOption,
    })

    // Notify all agents
    await AgentMessage.send(
      AgentMessage.create(
        "NOTIFY",
        "system",
        proposal.collaborationId,
        {
          message: `Proposal "${proposal.title}" closed. ${result?.consensusReached ? `Consensus reached: ${result.winningOption}` : "No consensus"}`,
          level: result?.consensusReached ? "info" : "warn",
        },
        { priority: "high" }
      )
    )

    return proposal
  }

  export async function getProposal(proposalId: string): Promise<Proposal | undefined> {
    return proposals.get(proposalId)
  }

  export async function getProposals(
    collaborationId: string,
    options: { status?: Proposal["status"][]; limit?: number } = {}
  ): Promise<Proposal[]> {
    let result = Array.from(proposals.values()).filter(
      p => p.collaborationId === collaborationId
    )

    if (options.status) {
      result = result.filter(p => options.status!.includes(p.status))
    }

    // Sort by most recent
    result.sort((a, b) => b.createdAt - a.createdAt)

    if (options.limit) {
      result = result.slice(0, options.limit)
    }

    return result
  }

  export async function getVotes(proposalId: string): Promise<Vote[]> {
    return votes.get(proposalId) ?? []
  }

  export async function hasVoted(proposalId: string, voter: string): Promise<boolean> {
    const proposalVotes = votes.get(proposalId) ?? []
    return proposalVotes.some(v => v.voter === voter)
  }

  export function subscribeToProposal(
    proposalId: string,
    callback: (event: { type: "vote_cast" | "closed" | "consensus"; data: any }) => void
  ): () => void {
    const unsubscribe: (() => void)[] = []

    unsubscribe.push(
      Bus.subscribe(Event.VoteCast, (vote: Vote) => {
        if (vote.proposalId === proposalId) {
          callback({ type: "vote_cast", data: vote })
        }
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.ProposalClosed, (event: { proposalId: string }) => {
        if (event.proposalId === proposalId) {
          callback({ type: "closed", data: event })
        }
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.ConsensusReached, (event: { proposalId: string }) => {
        if (event.proposalId === proposalId) {
          callback({ type: "consensus", data: event })
        }
      })
    )

    return () => unsubscribe.forEach(u => u())
  }
}
