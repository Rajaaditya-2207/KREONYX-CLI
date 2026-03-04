import { z } from "zod"
import { Log } from "@/util/log"
import { AgentMessage } from "@/collaboration/message"
import { Voting } from "@/collaboration/vote"
import { MapReduce } from "@/collaboration/mapreduce"
import { ReviewCycle } from "@/collaboration/review"
import { Debate } from "@/collaboration/debate"
import { SharedMemory } from "@/workspace/memory"
import { SharedFilesystem } from "@/workspace/filesystem"
import { ulid } from "ulid"

export namespace Orchestrator {
  const log = Log.create({ service: "orchestrator" })

  export const CollaborationSession = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    orchestrator: z.string(), // agent session ID
    participants: z.array(z.string()), // agent session IDs
    status: z.enum(["active", "paused", "completed", "cancelled"]).default("active"),
    activeJobs: z.array(z.string()).default([]),
    activeReviews: z.array(z.string()).default([]),
    activeDebates: z.array(z.string()).default([]),
    activeProposals: z.array(z.string()).default([]),
    createdAt: z.number(),
    updatedAt: z.number(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  export type CollaborationSession = z.infer<typeof CollaborationSession>

  const sessions = new Map<string, CollaborationSession>()
  const PERSISTENCE_KEY = "orchestrator:sessions"
  let persistenceInitialized = false

  // Initialize persistence - load existing sessions
  async function initializePersistence(): Promise<void> {
    if (persistenceInitialized) return

    try {
      const data = await SharedFilesystem.read(PERSISTENCE_KEY)
      if (data) {
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed)) {
          for (const session of parsed) {
            const validated = CollaborationSession.safeParse(session)
            if (validated.success) {
              sessions.set(validated.data.id, validated.data)
            }
          }
        }
      }
      log.info("persistence initialized", { sessionsLoaded: sessions.size })
    } catch (err) {
      log.debug("no persisted sessions found or error loading", { error: (err as Error).message })
    }
    persistenceInitialized = true
  }

  // Save sessions to persistence
  async function saveSessions(): Promise<void> {
    try {
      const data = JSON.stringify(Array.from(sessions.values()))
      await SharedFilesystem.write(PERSISTENCE_KEY, data, { overwrite: true })
    } catch (err) {
      log.warn("failed to save sessions", { error: (err as Error).message })
    }
  }

  // Orchestrator description (agent definition in agent.ts)
  export const DESCRIPTION = "Master orchestrator agent that coordinates multiple specialized agents. Can create voting sessions, map-reduce jobs, code reviews, and debates. Manages shared workspace and agent communication."

  export async function createSession(
    orchestratorAgent: string,
    options: {
      title: string
      description?: string
      participants: string[]
    }
  ): Promise<CollaborationSession> {
    await initializePersistence()

    const session: CollaborationSession = {
      id: ulid(),
      title: options.title,
      description: options.description,
      orchestrator: orchestratorAgent,
      participants: options.participants,
      status: "active",
      activeJobs: [],
      activeReviews: [],
      activeDebates: [],
      activeProposals: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    sessions.set(session.id, session)

    // Persist sessions
    await saveSessions()

    // Initialize shared memory for this session
    await SharedMemory.set(`collaboration:${session.id}:info`, session, {
      agentSessionID: orchestratorAgent,
    })

    log.info("collaboration session created", {
      sessionId: session.id,
      title: session.title,
      participants: options.participants.length,
    })

    await saveSessions()

    return session
  }

  export async function getSession(sessionId: string): Promise<CollaborationSession | undefined> {
    await initializePersistence()
    return sessions.get(sessionId)
  }

  // MapReduce operations
  export async function createMapReduceJob(
    sessionId: string,
    orchestrator: string,
    config: {
      title: string
      description: string
      inputs: unknown[]
      mapper: string
      reducer?: string
      maxParallel?: number
    }
  ): Promise<MapReduce.Job> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error("Session not found")

    const job = await MapReduce.createJob(sessionId, {
      title: config.title,
      description: config.description,
      inputs: config.inputs,
      mapper: config.mapper,
      reducer: config.reducer,
      maxParallel: config.maxParallel,
    })

    session.activeJobs.push(job.id)
    sessions.set(sessionId, session)
    await saveSessions()

    await MapReduce.startJob(job.id, orchestrator)

    return job
  }

  // Voting operations
  export async function createVote(
    sessionId: string,
    proposer: string,
    config: {
      title: string
      description: string
      options?: { id: string; label: string; description?: string }[]
      votingStrategy?: Voting.Proposal["votingStrategy"]
      minVotes?: number
      deadline?: number
    }
  ): Promise<Voting.Proposal> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error("Session not found")

    const proposal = await Voting.createProposal(sessionId, proposer, {
      title: config.title,
      description: config.description,
      options: config.options,
      votingStrategy: config.votingStrategy,
      minVotes: config.minVotes,
      deadline: config.deadline,
    })

    session.activeProposals.push(proposal.id)
    sessions.set(sessionId, session)
    await saveSessions()

    return proposal
  }

  export async function castVote(
    proposalId: string,
    voter: string,
    choice: string | string[],
    reasoning?: string
  ): Promise<{ success: boolean; error?: string; vote?: Voting.Vote }> {
    return Voting.castVote(proposalId, voter, choice, { reasoning })
  }

  // Review operations
  export async function requestReview(
    sessionId: string,
    submitter: string,
    config: {
      title: string
      description?: string
      artifacts: ReviewCycle.ReviewRequest["artifacts"]
      reviewers: string[]
      minApprovals?: number
    }
  ): Promise<ReviewCycle.ReviewRequest> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error("Session not found")

    const request = await ReviewCycle.createRequest(sessionId, submitter, {
      title: config.title,
      description: config.description,
      artifacts: config.artifacts,
      reviewers: config.reviewers,
      minApprovals: config.minApprovals,
    })

    session.activeReviews.push(request.id)
    sessions.set(sessionId, session)
    await saveSessions()

    return request
  }

  // Debate operations
  export async function createDebate(
    sessionId: string,
    initiator: string,
    config: {
      topic: string
      description?: string
      participants: string[]
      format?: Debate.DebateSession["format"]
      maxRounds?: number
    }
  ): Promise<Debate.DebateSession> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error("Session not found")

    const debate = await Debate.create(sessionId, initiator, {
      topic: config.topic,
      description: config.description,
      participants: config.participants,
      format: config.format,
      maxRounds: config.maxRounds,
    })

    session.activeDebates.push(debate.id)
    sessions.set(sessionId, session)
    await saveSessions()

    return debate
  }

  // Helper to coordinate a complete workflow
  export async function coordinateFeatureImplementation(
    sessionId: string,
    orchestrator: string,
    feature: {
      title: string
      description: string
      affectedFiles: string[]
      requirements: string[]
    }
  ): Promise<void> {
    log.info("coordinating feature implementation", { sessionId, feature: feature.title })

    // Step 1: Create debate to discuss approach
    const debate = await createDebate(sessionId, orchestrator, {
      topic: `Implementation approach for: ${feature.title}`,
      description: `Discuss the best approach to implement ${feature.title}`,
      participants: [
        orchestrator,
        ...sessions.get(sessionId)!.participants.slice(0, 2),
      ],
      format: "structured",
      maxRounds: 2,
    })

    await Debate.start(debate.id, orchestrator)

    // Wait for debate to complete (this would be async in real implementation)
    // For now, we continue and let agents handle via messages

    // Step 2: Create map-reduce job to implement across files
    const job = await createMapReduceJob(sessionId, orchestrator, {
      title: `Implement ${feature.title}`,
      description: feature.description,
      inputs: feature.affectedFiles.map((file) => ({
        file,
        requirements: feature.requirements,
      })),
      mapper: "implementer",
      reducer: "integrator",
      maxParallel: 3,
    })

    // Step 3: Request code review once complete
    const unsub = MapReduce.subscribeToJob(job.id, async (event) => {
      if (event.type === "completed") {
        log.info("implementation complete, requesting review", { jobId: job.id })

        const reviewRequest = await requestReview(sessionId, orchestrator, {
          title: `Review: ${feature.title}`,
          description: `Code review for implementation of ${feature.title}`,
          artifacts: [
            {
              type: "code",
              content: JSON.stringify(event.data.result),
              description: "Implementation results",
            },
          ],
          reviewers: sessions.get(sessionId)!.participants.filter((p) => p !== orchestrator),
          minApprovals: Math.ceil(sessions.get(sessionId)!.participants.length / 2),
        })

        // Step 4: Subscribe to review completion and vote on final approval
        const unsubReview = ReviewCycle.subscribeToRequest(reviewRequest.id, async (reviewEvent) => {
          if (reviewEvent.type === "approved") {
            log.info("code approved, creating final vote", { reviewId: reviewEvent.data.requestId })

            await createVote(sessionId, orchestrator, {
              title: `Approve ${feature.title} for merge?`,
              description: "Final approval vote for the implementation",
              options: [
                { id: "approve", label: "Approve and merge" },
                { id: "reject", label: "Reject and revise" },
              ],
              votingStrategy: "majority",
            })

            unsubReview()
          }
        })

        unsub()
      }
    })
  }

  // Broadcast message to all participants
  export async function broadcast(
    sessionId: string,
    from: string,
    message: string,
    level: "info" | "warn" | "error" = "info"
  ): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) return

    await AgentMessage.send(
      AgentMessage.create(
        "NOTIFY",
        from,
        sessionId,
        { message, level },
        { priority: level === "error" ? "high" : "normal" }
      )
    )
  }

  // Get session status summary
  export async function getStatus(sessionId: string): Promise<{
    session: CollaborationSession
    jobs: MapReduce.Job[]
    proposals: Voting.Proposal[]
    reviews: ReviewCycle.ReviewRequest[]
    debates: Debate.DebateSession[]
  } | undefined> {
    const session = sessions.get(sessionId)
    if (!session) return undefined

    const jobs: MapReduce.Job[] = []
    for (const jobId of session.activeJobs) {
      const job = await MapReduce.getJob(jobId)
      if (job) jobs.push(job)
    }

    const proposals: Voting.Proposal[] = []
    for (const proposalId of session.activeProposals) {
      const proposal = await Voting.getProposal(proposalId)
      if (proposal) proposals.push(proposal)
    }

    const reviews: ReviewCycle.ReviewRequest[] = []
    for (const reviewId of session.activeReviews) {
      const review = await ReviewCycle.getRequest(reviewId)
      if (review) reviews.push(review)
    }

    const debates: Debate.DebateSession[] = []
    for (const debateId of session.activeDebates) {
      const debate = await Debate.getDebate(debateId)
      if (debate) debates.push(debate)
    }

    return { session, jobs, proposals, reviews, debates }
  }

  // Format session summary for display
  export async function formatSessionSummary(sessionId: string): Promise<string> {
    const status = await getStatus(sessionId)
    if (!status) return "Session not found"

    const { session, jobs, proposals, reviews, debates } = status

    let summary = `# ${session.title}\n\n`

    if (session.description) {
      summary += `${session.description}\n\n`
    }

    summary += `**Status:** ${session.status}\n`
    summary += `**Participants:** ${session.participants.join(", ")}\n`
    summary += `**Created:** ${new Date(session.createdAt).toISOString()}\n\n`

    if (jobs.length > 0) {
      summary += "## Active Jobs\n\n"
      for (const job of jobs) {
        summary += `- **${job.title}** (${job.status}) - ${job.tasks.length} tasks\n`
      }
      summary += "\n"
    }

    if (proposals.length > 0) {
      summary += "## Active Votes\n\n"
      for (const proposal of proposals) {
        summary += `- **${proposal.title}** (${proposal.status})\n`
      }
      summary += "\n"
    }

    if (reviews.length > 0) {
      summary += "## Active Reviews\n\n"
      for (const review of reviews) {
        summary += `- **${review.title}** (${review.status})\n`
      }
      summary += "\n"
    }

    if (debates.length > 0) {
      summary += "## Active Debates\n\n"
      for (const debate of debates) {
        summary += `- **${debate.topic}** (${debate.status}, round ${debate.currentRound}/${debate.maxRounds})\n`
      }
      summary += "\n"
    }

    return summary
  }
}
