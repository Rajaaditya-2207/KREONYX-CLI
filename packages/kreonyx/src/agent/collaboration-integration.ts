import { AgentMessage } from "@/collaboration/message"
import { Voting } from "@/collaboration/vote"
import { MapReduce } from "@/collaboration/mapreduce"
import { ReviewCycle } from "@/collaboration/review"
import { Debate } from "@/collaboration/debate"
import { Orchestrator } from "./orchestrator"
import { Log } from "@/util/log"
import { Bus } from "@/bus"

const log = Log.create({ service: "collaboration-integration" })

export namespace CollaborationIntegration {
  // Track active agent participation in collaboration
  const activeAgents = new Map<string, {
    collaborationId: string
    role: "implementer" | "integrator" | "reviewer" | "debater" | "general"
    subscriptions: (() => void)[]
  }>()

  /**
   * Initialize collaboration capabilities for an agent
   * Call this when an agent starts participating in a collaboration session
   */
  export async function initializeAgent(
    agentSessionId: string,
    collaborationId: string,
    role: "implementer" | "integrator" | "reviewer" | "debater" | "general" = "general"
  ): Promise<void> {
    log.info("initializing agent for collaboration", { agentSessionId, collaborationId, role })

    // Clean up any existing subscriptions
    cleanupAgent(agentSessionId)

    const subscriptions: (() => void)[] = []

    // Subscribe to collaboration messages
    subscriptions.push(
      AgentMessage.subscribe(collaborationId, async (message) => {
        await handleMessage(agentSessionId, message)
      })
    )

    activeAgents.set(agentSessionId, {
      collaborationId,
      role,
      subscriptions,
    })

    // Send ready notification
    await AgentMessage.send(
      AgentMessage.create(
        "NOTIFY",
        agentSessionId,
        collaborationId,
        {
          message: `Agent ${agentSessionId} ready for ${role} duties`,
          level: "info",
        },
        { priority: "normal" }
      ) as AgentMessage.Message
    )
  }

  /**
   * Handle incoming messages for an agent
   */
  async function handleMessage(
    agentSessionId: string,
    message: AgentMessage.Message
  ): Promise<void> {
    const agentInfo = activeAgents.get(agentSessionId)
    if (!agentInfo) return

    // Skip messages from self
    if (message.from === agentSessionId) return

    // Handle based on message type
    switch (message.type) {
      case "REQUEST":
        await handleRequest(agentSessionId, message)
        break
      case "DEBATE":
        if (agentInfo.role === "debater" || agentInfo.role === "general") {
          await handleDebateMessage(agentSessionId, message)
        }
        break
      case "REVIEW":
        if (agentInfo.role === "reviewer" || agentInfo.role === "general") {
          await handleReviewMessage(agentSessionId, message)
        }
        break
      case "VOTE":
        await handleVoteMessage(agentSessionId, message)
        break
      case "NOTIFY":
        // Notifications are logged but don't require action
        log.debug("notification received", {
          agent: agentSessionId,
          message: message.content.message,
        })
        break
    }
  }

  /**
   * Handle request messages (mapreduce tasks, review requests, etc.)
   */
  async function handleRequest(
    agentSessionId: string,
    message: AgentMessage.Message & { type: "REQUEST" }
  ): Promise<void> {
    const { action, parameters } = message.content

    log.info("handling request", { agent: agentSessionId, action })

    if (!parameters) {
      log.warn("request missing parameters", { action })
      return
    }

    switch (action) {
      case "mapreduce_process_task":
        await handleMapReduceTask(agentSessionId, message, parameters as Parameters<typeof handleMapReduceTask>[2])
        break
      case "mapreduce_reduce":
        await handleMapReduceReduce(agentSessionId, message, parameters as Parameters<typeof handleMapReduceReduce>[2])
        break
      case "review_code":
        await handleReviewRequest(agentSessionId, message, parameters as Parameters<typeof handleReviewRequest>[2])
        break
      case "debate_submit_argument":
        await handleDebateArgument(agentSessionId, message, parameters as Parameters<typeof handleDebateArgument>[2])
        break
      default:
        log.warn("unknown request action", { action })
    }
  }

  /**
   * Handle mapreduce task processing
   */
  async function handleMapReduceTask(
    agentSessionId: string,
    message: AgentMessage.Message,
    params: {
      jobId: string
      taskId: string
      input: unknown
      description: string
      mapper: string
    }
  ): Promise<void> {
    log.info("processing mapreduce task", { agent: agentSessionId, taskId: params.taskId })

    try {
      // Send acknowledgment
      await AgentMessage.reply(
        message,
        agentSessionId,
        "RESPONSE",
        {
          requestId: message.id,
          status: "in_progress" as const,
          result: { taskId: params.taskId, status: "started" },
        }
      )

      // Process the task (simplified - would actually do the work)
      const result = await processTask(params.input, params.description, params.mapper)

      // Complete the task
      await MapReduce.completeTask(params.jobId, params.taskId, agentSessionId, result)

      // Send response
      await AgentMessage.reply(
        message,
        agentSessionId,
        "RESPONSE",
        {
          requestId: message.id,
          status: "success" as const,
          result,
        }
      )
    } catch (error) {
      log.error("task processing failed", { error: String(error), taskId: params.taskId })

      await MapReduce.failTask(params.jobId, params.taskId, agentSessionId, String(error))

      await AgentMessage.reply(
        message,
        agentSessionId,
        "RESPONSE",
        {
          requestId: message.id,
          status: "failure" as const,
          error: String(error),
        }
      )
    }
  }

  /**
   * Handle mapreduce reduce operation
   */
  async function handleMapReduceReduce(
    agentSessionId: string,
    message: AgentMessage.Message,
    params: {
      jobId: string
      results: Record<string, unknown>[]
      reducer: string
    }
  ): Promise<void> {
    log.info("processing mapreduce reduction", { agent: agentSessionId, jobId: params.jobId })

    try {
      // Combine results (simplified)
      const combined = combineResults(params.results, params.reducer)

      await AgentMessage.reply(
        message,
        agentSessionId,
        "RESPONSE",
        {
          requestId: message.id,
          status: "success" as const,
          result: combined,
        }
      )
    } catch (error) {
      log.error("reduction failed", { error: String(error), jobId: params.jobId })

      await AgentMessage.reply(
        message,
        agentSessionId,
        "RESPONSE",
        {
          requestId: message.id,
          status: "failure" as const,
          error: String(error),
        }
      )
    }
  }

  /**
   * Handle code review request
   */
  async function handleReviewRequest(
    agentSessionId: string,
    message: AgentMessage.Message,
    params: {
      requestId: string
      title: string
      description: string
      artifacts: ReviewCycle.ReviewRequest["artifacts"]
    }
  ): Promise<void> {
    log.info("processing review request", { agent: agentSessionId, requestId: params.requestId })

    // Perform review (simplified - would actually analyze code)
    const review = await performReview(params.artifacts, agentSessionId)

    // Submit review
    await ReviewCycle.submitReview(params.requestId, agentSessionId, {
      verdict: review.verdict,
      comments: review.comments,
      summary: review.summary,
    })

    await AgentMessage.reply(
      message,
      agentSessionId,
      "RESPONSE",
      {
        requestId: message.id,
        status: "success" as const,
        result: { reviewed: true, verdict: review.verdict },
      }
    )
  }

  /**
   * Handle debate argument submission
   */
  async function handleDebateArgument(
    agentSessionId: string,
    message: AgentMessage.Message,
    params: {
      debateId: string
      topic: string
      round: number
      speaker: string
      format: Debate.DebateSession["format"]
      previousArguments: Debate.Argument[]
    }
  ): Promise<void> {
    log.info("processing debate argument", { agent: agentSessionId, debateId: params.debateId })

    // Generate argument based on format and previous arguments
    const argument = await generateDebateArgument(
      params.topic,
      params.format,
      params.previousArguments,
      agentSessionId
    )

    // Submit argument
    await Debate.submitArgument(params.debateId, agentSessionId, {
      position: argument.position,
      content: argument.content,
      evidence: argument.evidence,
    })

    await AgentMessage.reply(
      message,
      agentSessionId,
      "RESPONSE",
      {
        requestId: message.id,
        status: "success" as const,
        result: { submitted: true },
      }
    )
  }

  /**
   * Handle debate messages
   */
  async function handleDebateMessage(
    agentSessionId: string,
    message: AgentMessage.Message & { type: "DEBATE" }
  ): Promise<void> {
    // Debates are handled via REQUEST messages for arguments
    // This handles additional broadcast debate messages
    log.debug("debate message received", {
      agent: agentSessionId,
      topic: message.content.topic,
    })
  }

  /**
   * Handle review messages
   */
  async function handleReviewMessage(
    agentSessionId: string,
    message: AgentMessage.Message & { type: "REVIEW" }
  ): Promise<void> {
    // Reviews are handled via REQUEST messages
    // This handles additional review notifications
    log.debug("review message received", {
      agent: agentSessionId,
      verdict: message.content.verdict,
    })
  }

  /**
   * Handle vote messages
   */
  async function handleVoteMessage(
    agentSessionId: string,
    message: AgentMessage.Message & { type: "VOTE" }
  ): Promise<void> {
    log.debug("vote message received", {
      agent: agentSessionId,
      proposalId: message.content.proposalId,
    })
  }

  /**
   * Clean up an agent's collaboration subscriptions
   */
  export function cleanupAgent(agentSessionId: string): void {
    const agentInfo = activeAgents.get(agentSessionId)
    if (agentInfo) {
      agentInfo.subscriptions.forEach((unsub) => unsub())
      activeAgents.delete(agentSessionId)
      log.info("cleaned up agent collaboration", { agent: agentSessionId })
    }
  }

  /**
   * Get agent's collaboration info
   */
  export function getAgentInfo(agentSessionId: string): {
    collaborationId: string
    role: string
  } | undefined {
    const agentInfo = activeAgents.get(agentSessionId)
    if (!agentInfo) return undefined
    return {
      collaborationId: agentInfo.collaborationId,
      role: agentInfo.role,
    }
  }

  /**
   * Check if an agent is participating in collaboration
   */
  export function isActive(agentSessionId: string): boolean {
    return activeAgents.has(agentSessionId)
  }

  // Helper functions for task processing

  async function processTask(
    input: unknown,
    description: string,
    mapper: string
  ): Promise<Record<string, unknown>> {
    // Simplified implementation - would actually process based on mapper type
    return {
      processed: true,
      input,
      description,
      mapper,
      timestamp: Date.now(),
    }
  }

  function combineResults(results: Record<string, unknown>[], reducer: string): Record<string, unknown> {
    // Simplified implementation - would actually combine based on reducer type
    return {
      combined: true,
      results,
      reducer,
      count: results.length,
      timestamp: Date.now(),
    }
  }

  async function performReview(
    artifacts: ReviewCycle.ReviewRequest["artifacts"],
    reviewer: string
  ): Promise<{
    verdict: ReviewCycle.Review["verdict"]
    comments: ReviewCycle.Review["comments"]
    summary: string
  }> {
    // Simplified implementation - would actually analyze artifacts
    return {
      verdict: "comment",
      comments: [
        {
          id: `comment-${Date.now()}`,
          message: `Reviewed by ${reviewer}`,
          severity: "info",
          resolved: false,
          replies: [],
        },
      ],
      summary: `Review completed by ${reviewer}`,
    }
  }

  async function generateDebateArgument(
    topic: string,
    format: Debate.DebateSession["format"],
    previousArguments: Debate.Argument[],
    speaker: string
  ): Promise<{
    position: Debate.Argument["position"]
    content: string
    evidence?: string[]
  }> {
    // Simplified implementation - would actually generate based on format and history
    const position: Debate.Argument["position"] =
      previousArguments.filter((a) => a.position === "pro").length >
        previousArguments.filter((a) => a.position === "con").length
        ? "con"
        : "pro"

    return {
      position,
      content: `Argument on "${topic}" from ${speaker} taking ${position} position`,
      evidence: [`Previous arguments considered: ${previousArguments.length}`],
    }
  }
}
