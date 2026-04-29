import { z } from "zod"
import { Log } from "@/util/log"
import { AgentMessage } from "@/collaboration/message"
import { Voting } from "@/collaboration/vote"
import { MapReduce } from "@/collaboration/mapreduce"
import { ReviewCycle } from "@/collaboration/review"
import { Debate } from "@/collaboration/debate"
import { SharedMemory } from "@/workspace/memory"
import { SharedFilesystem } from "@/workspace/filesystem"
import { AgentTypes } from "./types"
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

  // Track debate completion promises
  const debateCompletionPromises = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()

  // Track if debate subscription is initialized
  let debateSubscriptionInitialized = false

  // Initialize debate subscription (lazy initialization)
  function initializeDebateSubscription(): void {
    if (debateSubscriptionInitialized) return

    // Subscribe to debate completion events
    Debate.subscribeToDebate("*", (event) => {
      if (event.type === "concluded") {
        const { debateId } = event.data as { debateId: string }
        const promise = debateCompletionPromises.get(debateId)
        if (promise) {
          promise.resolve()
          debateCompletionPromises.delete(debateId)
        }
      }
    })

    debateSubscriptionInitialized = true
  }

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
      await SharedFilesystem.write(PERSISTENCE_KEY, data, {
        agentSessionID: "system",
        overwrite: true,
      })
    } catch (err) {
      log.warn("failed to save sessions", { error: (err as Error).message })
    }
  }

  // Archive completed session to separate storage
  async function archiveSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) return

    try {
      const archiveKey = `orchestrator:archive:${sessionId}`
      const archived = {
        ...session,
        archivedAt: Date.now(),
      }
      await SharedFilesystem.write(archiveKey, JSON.stringify(archived), {
        agentSessionID: "system",
        overwrite: true,
      })
      log.debug("session archived", { sessionId })
    } catch (err) {
      log.warn("failed to archive session", { sessionId, error: (err as Error).message })
    }
  }

  // Wait for a debate to complete
  export function waitForDebate(debateId: string, timeout: number = 300000): Promise<void> {
    // Initialize debate subscription on first use
    initializeDebateSubscription()

    return new Promise((resolve, reject) => {
      // Check if debate already concluded
      const debate = Debate.getDebate(debateId)
      if (debate) {
        debate.then(d => {
          if (d?.status === "concluded" || d?.status === "cancelled") {
            resolve()
            return
          }

          // Set up completion tracking
          debateCompletionPromises.set(debateId, { resolve, reject })

          // Set timeout
          setTimeout(() => {
            debateCompletionPromises.delete(debateId)
            reject(new Error(`Timeout waiting for debate ${debateId}`))
          }, timeout)
        })
      } else {
        reject(new Error(`Debate ${debateId} not found`))
      }
    })
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

  // Complete a collaboration session
  export async function completeSession(
    sessionId: string,
    orchestratorAgent: string
  ): Promise<{ success: boolean; error?: string }> {
    const session = sessions.get(sessionId)
    if (!session) {
      return { success: false, error: "Session not found" }
    }

    if (session.orchestrator !== orchestratorAgent) {
      return { success: false, error: "Only the orchestrator can complete the session" }
    }

    session.status = "completed"
    session.updatedAt = Date.now()
    sessions.set(sessionId, session)

    await saveSessions()
    await archiveSession(sessionId)

    log.info("collaboration session completed", { sessionId })

    await broadcast(
      sessionId,
      orchestratorAgent,
      `Collaboration session "${session.title}" has been completed`,
      "info"
    )

    return { success: true }
  }

  // Cancel a collaboration session
  export async function cancelSession(
    sessionId: string,
    orchestratorAgent: string,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> {
    const session = sessions.get(sessionId)
    if (!session) {
      return { success: false, error: "Session not found" }
    }

    if (session.orchestrator !== orchestratorAgent) {
      return { success: false, error: "Only the orchestrator can cancel the session" }
    }

    session.status = "cancelled"
    session.updatedAt = Date.now()
    sessions.set(sessionId, session)

    await saveSessions()
    await archiveSession(sessionId)

    log.info("collaboration session cancelled", { sessionId, reason })

    await broadcast(
      sessionId,
      orchestratorAgent,
      `Collaboration session "${session.title}" has been cancelled${reason ? `: ${reason}` : ""}`,
      "warn"
    )

    return { success: true }
  }

  // List all active sessions
  export async function listSessions(options?: {
    status?: CollaborationSession["status"][]
    orchestrator?: string
  }): Promise<CollaborationSession[]> {
    await initializePersistence()

    let result = Array.from(sessions.values())

    if (options?.status) {
      result = result.filter((s) => options.status!.includes(s.status))
    }

    if (options?.orchestrator) {
      result = result.filter((s) => s.orchestrator === options.orchestrator)
    }

    // Sort by most recently updated
    result.sort((a, b) => b.updatedAt - a.updatedAt)

    return result
  }

  // Get archived session
  export async function getArchivedSession(sessionId: string): Promise<CollaborationSession & { archivedAt: number } | undefined> {
    try {
      const archiveKey = `orchestrator:archive:${sessionId}`
      const data = await SharedFilesystem.read(archiveKey)
      if (data) {
        return JSON.parse(data)
      }
    } catch (err) {
      log.debug("archived session not found", { sessionId })
    }
    return undefined
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

    // Wait for debate to complete before proceeding
    try {
      await waitForDebate(debate.id, 300000) // 5 minute timeout
      log.info("debate completed, proceeding with implementation", { debateId: debate.id })
    } catch (err) {
      log.warn("debate did not complete in time, proceeding anyway", { debateId: debate.id, error: String(err) })
    }

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
