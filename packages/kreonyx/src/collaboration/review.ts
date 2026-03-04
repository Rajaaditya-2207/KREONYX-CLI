import { z } from "zod"
import { ulid } from "ulid"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { AgentMessage } from "./message"
import { SharedFilesystem } from "@/workspace/filesystem"

export namespace ReviewCycle {
  const log = Log.create({ service: "review" })

  export const ReviewRequest = z.object({
    id: z.string(),
    collaborationId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    submitter: z.string(), // agent session ID
    artifacts: z.array(z.object({
      type: z.enum(["file", "code", "documentation", "test", "general"]),
      path: z.string().optional(),
      content: z.string().optional(),
      description: z.string().optional(),
    })),
    reviewers: z.array(z.string()), // agent session IDs
    status: z.enum(["pending", "under_review", "changes_requested", "approved", "rejected"]).default("pending"),
    minApprovals: z.number().default(1),
    createdAt: z.number(),
    updatedAt: z.number(),
    completedAt: z.number().optional(),
    deadline: z.number().optional(),
  })
  export type ReviewRequest = z.infer<typeof ReviewRequest>

  export const Comment = z.object({
    id: z.string(),
    line: z.number().optional(),
    file: z.string().optional(),
    message: z.string(),
    severity: z.enum(["info", "warning", "error", "critical"]).default("info"),
    resolved: z.boolean().default(false),
    replies: z.array(z.object({
      from: z.string(),
      message: z.string(),
      timestamp: z.number(),
    })).default([]),
  })
  export type Comment = z.infer<typeof Comment>

  export const Review = z.object({
    id: z.string(),
    requestId: z.string(),
    reviewer: z.string(), // agent session ID
    status: z.enum(["pending", "in_progress", "submitted"]).default("pending"),
    verdict: z.enum(["approve", "reject", "request_changes", "comment"]).optional(),
    comments: z.array(Comment).default([]),
    summary: z.string().optional(),
    submittedAt: z.number().optional(),
  })
  export type Review = z.infer<typeof Review>

  export const Event = {
    ReviewRequested: BusEvent.define("review.requested", ReviewRequest),
    ReviewAssigned: BusEvent.define("review.assigned", z.object({ requestId: z.string(), reviewer: z.string() })),
    ReviewSubmitted: BusEvent.define("review.submitted", Review),
    CommentAdded: BusEvent.define("review.comment_added", z.object({ reviewId: z.string(), comment: Review.shape.comments.element })),
    ReviewApproved: BusEvent.define("review.approved", z.object({ requestId: z.string(), reviewers: z.array(z.string()) })),
    ChangesRequested: BusEvent.define("review.changes_requested", z.object({ requestId: z.string(), reviews: z.array(Review) })),
    ReviewRejected: BusEvent.define("review.rejected", z.object({ requestId: z.string(), reviewer: z.string(), reason: z.string() })),
  }

  const requests = new Map<string, ReviewRequest>()
  const reviews = new Map<string, Review[]>() // requestId -> reviews

  export async function createRequest(
    collaborationId: string,
    submitter: string,
    content: {
      title: string
      description?: string
      artifacts: ReviewRequest["artifacts"]
      reviewers: string[]
      minApprovals?: number
      deadline?: number
    }
  ): Promise<ReviewRequest> {
    const request: ReviewRequest = {
      id: ulid(),
      collaborationId,
      title: content.title,
      description: content.description,
      submitter,
      artifacts: content.artifacts,
      reviewers: content.reviewers,
      minApprovals: content.minApprovals ?? 1,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deadline: content.deadline,
    }

    requests.set(request.id, request)

    // Create individual review records for each reviewer
    const reviewRecords: Review[] = content.reviewers.map(reviewer => ({
      id: ulid(),
      requestId: request.id,
      reviewer,
      status: "pending",
      comments: [],
    }))

    reviews.set(request.id, reviewRecords)

    Bus.publish(Event.ReviewRequested, request)
    log.info("review request created", { requestId: request.id, reviewers: content.reviewers.length })

    // Notify each reviewer
    for (const reviewer of content.reviewers) {
      Bus.publish(Event.ReviewAssigned, { requestId: request.id, reviewer })

      await AgentMessage.send(
        AgentMessage.create(
          "REQUEST",
          submitter,
          collaborationId,
          {
            action: "review_code",
            parameters: {
              requestId: request.id,
              title: request.title,
              description: request.description,
              artifacts: request.artifacts,
            },
            deadline: request.deadline,
          },
          {
            to: reviewer,
            requiresResponse: true,
            priority: "normal",
          }
        )
      )
    }

    return request
  }

  export async function submitReview(
    requestId: string,
    reviewer: string,
    content: {
      verdict: Review["verdict"]
      comments?: Review["comments"]
      summary?: string
    }
  ): Promise<{ success: boolean; error?: string; review?: Review }> {
    const request = requests.get(requestId)
    if (!request) {
      return { success: false, error: "Review request not found" }
    }

    if (request.status === "approved" || request.status === "rejected") {
      return { success: false, error: "Review request already completed" }
    }

    const requestReviews = reviews.get(requestId) ?? []
    const reviewIndex = requestReviews.findIndex(r => r.reviewer === reviewer)

    if (reviewIndex < 0) {
      return { success: false, error: "You are not assigned as a reviewer" }
    }

    const review: Review = {
      ...requestReviews[reviewIndex],
      status: "submitted",
      verdict: content.verdict,
      comments: content.comments ?? requestReviews[reviewIndex].comments,
      summary: content.summary,
      submittedAt: Date.now(),
    }

    requestReviews[reviewIndex] = review
    reviews.set(requestId, requestReviews)

    request.updatedAt = Date.now()
    request.status = "under_review"
    requests.set(requestId, request)

    Bus.publish(Event.ReviewSubmitted, review)
    log.info("review submitted", {
      requestId,
      reviewer,
      verdict: content.verdict,
      comments: content.comments?.length ?? 0,
    })

    // Notify submitter
    await AgentMessage.send(
      AgentMessage.create(
        "REVIEW",
        reviewer,
        request.collaborationId,
        {
          targetMessageId: requestId,
          verdict: content.verdict ?? "comment",
          comments: content.comments?.map(c => ({
            line: c.line,
            file: c.file,
            message: c.message,
            severity: c.severity,
          })) ?? [],
          suggestions: content.summary ? [content.summary] : undefined,
        },
        {
          to: request.submitter,
          priority: content.verdict === "reject" ? "urgent" : "normal",
        }
      )
    )

    // Check if review is complete
    await checkReviewComplete(requestId)

    return { success: true, review }
  }

  export async function addComment(
    requestId: string,
    reviewer: string,
    comment: {
      line?: number
      file?: string
      message: string
      severity?: Review["comments"][0]["severity"]
    }
  ): Promise<{ success: boolean; error?: string }> {
    const request = requests.get(requestId)
    if (!request) {
      return { success: false, error: "Review request not found" }
    }

    const requestReviews = reviews.get(requestId) ?? []
    const review = requestReviews.find(r => r.reviewer === reviewer)

    if (!review) {
      return { success: false, error: "You are not assigned as a reviewer" }
    }

    const newComment: Review["comments"][0] = {
      id: ulid(),
      line: comment.line,
      file: comment.file,
      message: comment.message,
      severity: comment.severity ?? "info",
      resolved: false,
      replies: [],
    }

    review.comments.push(newComment)
    review.status = "in_progress"
    reviews.set(requestId, requestReviews)

    request.updatedAt = Date.now()
    requests.set(requestId, request)

    Bus.publish(Event.CommentAdded, { reviewId: review.id, comment: newComment })
    log.debug("review comment added", { requestId, reviewer, message: comment.message.substring(0, 50) })

    return { success: true }
  }

  export async function replyToComment(
    requestId: string,
    commentId: string,
    from: string,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    const requestReviews = reviews.get(requestId) ?? []

    for (const review of requestReviews) {
      const comment = review.comments.find(c => c.id === commentId)
      if (comment) {
        comment.replies.push({
          from,
          message,
          timestamp: Date.now(),
        })
        reviews.set(requestId, requestReviews)
        return { success: true }
      }
    }

    return { success: false, error: "Comment not found" }
  }

  export async function resolveComment(
    requestId: string,
    commentId: string,
    resolver: string
  ): Promise<{ success: boolean; error?: string }> {
    const requestReviews = reviews.get(requestId) ?? []

    for (const review of requestReviews) {
      const comment = review.comments.find(c => c.id === commentId)
      if (comment) {
        comment.resolved = true
        reviews.set(requestId, requestReviews)
        log.debug("comment resolved", { requestId, commentId, resolver })
        return { success: true }
      }
    }

    return { success: false, error: "Comment not found" }
  }

  async function checkReviewComplete(requestId: string): Promise<void> {
    const request = requests.get(requestId)
    if (!request || request.status === "approved" || request.status === "rejected") return

    const requestReviews = reviews.get(requestId) ?? []
    const submittedReviews = requestReviews.filter(r => r.status === "submitted")

    // Check if we have enough approvals
    const approvals = submittedReviews.filter(r => r.verdict === "approve")
    const rejections = submittedReviews.filter(r => r.verdict === "reject")
    const changesRequested = submittedReviews.filter(r => r.verdict === "request_changes")

    if (rejections.length > 0) {
      // Any rejection rejects the whole request
      request.status = "rejected"
      request.completedAt = Date.now()
      requests.set(requestId, request)

      Bus.publish(Event.ReviewRejected, {
        requestId,
        reviewer: rejections[0].reviewer,
        reason: rejections[0].summary ?? "Review rejected",
      })

      await AgentMessage.send(
        AgentMessage.create(
          "NOTIFY",
          "system",
          request.collaborationId,
          {
            message: `Review request "${request.title}" rejected by ${rejections[0].reviewer}`,
            level: "error",
          },
          { priority: "high" }
        )
      )
    } else if (changesRequested.length > 0) {
      // Changes requested
      request.status = "changes_requested"
      request.updatedAt = Date.now()
      requests.set(requestId, request)

      Bus.publish(Event.ChangesRequested, { requestId, reviews: changesRequested })

      await AgentMessage.send(
        AgentMessage.create(
          "NOTIFY",
          "system",
          request.collaborationId,
          {
            message: `Changes requested for "${request.title}" by ${changesRequested.map(r => r.reviewer).join(", ")}`,
            level: "warn",
          },
          { priority: "high" }
        )
      )
    } else if (approvals.length >= request.minApprovals) {
      // Sufficient approvals
      request.status = "approved"
      request.completedAt = Date.now()
      requests.set(requestId, request)

      Bus.publish(Event.ReviewApproved, {
        requestId,
        reviewers: approvals.map(r => r.reviewer),
      })

      await AgentMessage.send(
        AgentMessage.create(
          "NOTIFY",
          "system",
          request.collaborationId,
          {
            message: `Review request "${request.title}" approved by ${approvals.map(r => r.reviewer).join(", ")}`,
            level: "info",
          },
          { priority: "high" }
        )
      )

      // Notify submitter of approval
      await AgentMessage.send(
        AgentMessage.create(
          "COMPLETE",
          "system",
          request.collaborationId,
          {
            taskId: requestId,
            summary: `Code review approved for "${request.title}"`,
            artifacts: request.artifacts,
          },
          {
            to: request.submitter,
            priority: "high",
          }
        )
      )
    }
  }

  export async function resubmit(
    requestId: string,
    submitter: string,
    changes: {
      artifacts?: ReviewRequest["artifacts"]
      description?: string
    }
  ): Promise<{ success: boolean; error?: string }> {
    const request = requests.get(requestId)
    if (!request) {
      return { success: false, error: "Review request not found" }
    }

    if (request.submitter !== submitter) {
      return { success: false, error: "Only the submitter can resubmit" }
    }

    if (request.status !== "changes_requested") {
      return { success: false, error: "Can only resubmit when changes are requested" }
    }

    // Update request
    if (changes.artifacts) {
      request.artifacts = changes.artifacts
    }
    if (changes.description) {
      request.description = changes.description
    }

    request.status = "pending"
    request.updatedAt = Date.now()
    requests.set(requestId, request)

    // Reset reviews
    const requestReviews = reviews.get(requestId) ?? []
    for (const review of requestReviews) {
      review.status = "pending"
      review.verdict = undefined
      review.submittedAt = undefined
    }
    reviews.set(requestId, requestReviews)

    log.info("review resubmitted", { requestId })

    // Re-notify reviewers
    for (const reviewer of request.reviewers) {
      await AgentMessage.send(
        AgentMessage.create(
          "REQUEST",
          submitter,
          request.collaborationId,
          {
            action: "review_code",
            parameters: {
              requestId: request.id,
              title: request.title,
              description: `${request.description}\n\n(RESUBMITTED with changes)`,
              artifacts: request.artifacts,
            },
          },
          {
            to: reviewer,
            requiresResponse: true,
            priority: "normal",
          }
        )
      )
    }

    return { success: true }
  }

  export async function getRequest(requestId: string): Promise<ReviewRequest | undefined> {
    return requests.get(requestId)
  }

  export async function getReviews(requestId: string): Promise<Review[]> {
    return reviews.get(requestId) ?? []
  }

  export async function getPendingReviews(agent: string): Promise<ReviewRequest[]> {
    const result: ReviewRequest[] = []

    for (const request of requests.values()) {
      if (request.status === "pending" || request.status === "under_review") {
        const requestReviews = reviews.get(request.id) ?? []
        const myReview = requestReviews.find(r => r.reviewer === agent)
        if (myReview && myReview.status !== "submitted") {
          result.push(request)
        }
      }
    }

    return result.sort((a, b) => b.createdAt - a.createdAt)
  }

  export function subscribeToRequest(
    requestId: string,
    callback: (event: { type: string; data: any }) => void
  ): () => void {
    const unsubscribe: (() => void)[] = []

    unsubscribe.push(
      Bus.subscribe(Event.ReviewSubmitted, (review: Review) => {
        if (review.requestId === requestId) {
          callback({ type: "review_submitted", data: review })
        }
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.ReviewApproved, (event: { requestId: string }) => {
        if (event.requestId === requestId) {
          callback({ type: "approved", data: event })
        }
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.ChangesRequested, (event: { requestId: string }) => {
        if (event.requestId === requestId) {
          callback({ type: "changes_requested", data: event })
        }
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.ReviewRejected, (event: { requestId: string }) => {
        if (event.requestId === requestId) {
          callback({ type: "rejected", data: event })
        }
      })
    )

    return () => unsubscribe.forEach(u => u())
  }
}
