import { z } from "zod"

/**
 * Agent role definitions for multi-agent collaboration system.
 * These types define the capabilities, permissions, and behaviors
 * of different agent types in a collaboration session.
 */

export namespace AgentTypes {
  /**
   * Collaboration roles available to agents
   */
  export const CollaborationRole = z.enum([
    "orchestrator",  // Master coordinator - manages sessions and workflows
    "implementer",   // Code implementation specialist
    "integrator",    // Code integration and conflict resolution
    "reviewer",      // Code review and quality assurance
    "debater",       // Structured debate and decision making
    "general",       // General-purpose participant
  ])
  export type CollaborationRole = z.infer<typeof CollaborationRole>

  /**
   * Role capabilities define what actions an agent can perform
   */
  export const RoleCapabilities = z.object({
    canCreateSessions: z.boolean().default(false),
    canManageSessions: z.boolean().default(false),
    canVote: z.boolean().default(true),
    canReview: z.boolean().default(false),
    canDebate: z.boolean().default(true),
    canImplement: z.boolean().default(false),
    canIntegrate: z.boolean().default(false),
    canBroadcast: z.boolean().default(true),
    canRequestVotes: z.boolean().default(false),
    canRequestReviews: z.boolean().default(false),
    canAssignTasks: z.boolean().default(false),
  })
  export type RoleCapabilities = z.infer<typeof RoleCapabilities>

  /**
   * Role configuration including capabilities and metadata
   */
  export const RoleConfig = z.object({
    role: CollaborationRole,
    displayName: z.string(),
    description: z.string(),
    color: z.string(), // Hex color for UI
    icon: z.string().optional(), // Icon identifier
    capabilities: RoleCapabilities,
    maxConcurrentTasks: z.number().default(1),
    priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
    timeout: z.number().default(300000), // Default timeout in ms (5 minutes)
  })
  export type RoleConfig = z.infer<typeof RoleConfig>

  /**
   * Agent participant in a collaboration session
   */
  export const Participant = z.object({
    agentSessionId: z.string(),
    role: CollaborationRole,
    joinedAt: z.number(),
    status: z.enum(["active", "idle", "busy", "offline"]).default("active"),
    currentTask: z.string().optional(),
    completedTasks: z.number().default(0),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  export type Participant = z.infer<typeof Participant>

  /**
   * Agent assignment for a specific task
   */
  export const TaskAssignment = z.object({
    taskId: z.string(),
    agentSessionId: z.string(),
    role: CollaborationRole,
    assignedAt: z.number(),
    deadline: z.number().optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    status: z.enum(["pending", "assigned", "in_progress", "completed", "failed"]).default("pending"),
  })
  export type TaskAssignment = z.infer<typeof TaskAssignment>

  /**
   * Predefined role configurations
   */
  export const ROLE_CONFIGS: Record<CollaborationRole, RoleConfig> = {
    orchestrator: {
      role: "orchestrator",
      displayName: "Orchestrator",
      description: "Master coordinator that manages collaboration sessions, assigns tasks, and coordinates workflows between agents",
      color: "#9C27B0", // Purple
      icon: "orchestrator",
      capabilities: {
        canCreateSessions: true,
        canManageSessions: true,
        canVote: true,
        canReview: true,
        canDebate: true,
        canImplement: false,
        canIntegrate: false,
        canBroadcast: true,
        canRequestVotes: true,
        canRequestReviews: true,
        canAssignTasks: true,
      },
      maxConcurrentTasks: 10,
      priority: "critical",
      timeout: 600000, // 10 minutes
    },
    implementer: {
      role: "implementer",
      displayName: "Implementer",
      description: "Specialized agent for implementing code changes. Works on specific files or functions as part of a map-reduce job",
      color: "#4CAF50", // Green
      icon: "implementer",
      capabilities: {
        canCreateSessions: false,
        canManageSessions: false,
        canVote: true,
        canReview: false,
        canDebate: true,
        canImplement: true,
        canIntegrate: false,
        canBroadcast: true,
        canRequestVotes: false,
        canRequestReviews: false,
        canAssignTasks: false,
      },
      maxConcurrentTasks: 3,
      priority: "normal",
      timeout: 300000, // 5 minutes
    },
    integrator: {
      role: "integrator",
      displayName: "Integrator",
      description: "Specialized agent for combining results from multiple implementers. Merges code changes and resolves conflicts",
      color: "#FF9800", // Orange
      icon: "integrator",
      capabilities: {
        canCreateSessions: false,
        canManageSessions: false,
        canVote: true,
        canReview: true,
        canDebate: true,
        canImplement: false,
        canIntegrate: true,
        canBroadcast: true,
        canRequestVotes: false,
        canRequestReviews: false,
        canAssignTasks: false,
      },
      maxConcurrentTasks: 2,
      priority: "high",
      timeout: 300000,
    },
    reviewer: {
      role: "reviewer",
      displayName: "Reviewer",
      description: "Specialized agent for code review. Analyzes code changes for correctness, style, security, and performance",
      color: "#2196F3", // Blue
      icon: "reviewer",
      capabilities: {
        canCreateSessions: false,
        canManageSessions: false,
        canVote: true,
        canReview: true,
        canDebate: true,
        canImplement: false,
        canIntegrate: false,
        canBroadcast: true,
        canRequestVotes: false,
        canRequestReviews: false,
        canAssignTasks: false,
      },
      maxConcurrentTasks: 5,
      priority: "high",
      timeout: 300000,
    },
    debater: {
      role: "debater",
      displayName: "Debater",
      description: "Specialized agent for structured debates. Presents arguments for or against proposals with evidence-based reasoning",
      color: "#9C27B3", // Purple-ish
      icon: "debater",
      capabilities: {
        canCreateSessions: false,
        canManageSessions: false,
        canVote: true,
        canReview: false,
        canDebate: true,
        canImplement: false,
        canIntegrate: false,
        canBroadcast: true,
        canRequestVotes: true,
        canRequestReviews: false,
        canAssignTasks: false,
      },
      maxConcurrentTasks: 2,
      priority: "normal",
      timeout: 300000,
    },
    general: {
      role: "general",
      displayName: "General",
      description: "General-purpose agent that can participate in collaborations with basic capabilities",
      color: "#757575", // Gray
      icon: "general",
      capabilities: {
        canCreateSessions: false,
        canManageSessions: false,
        canVote: true,
        canReview: false,
        canDebate: true,
        canImplement: false,
        canIntegrate: false,
        canBroadcast: true,
        canRequestVotes: false,
        canRequestReviews: false,
        canAssignTasks: false,
      },
      maxConcurrentTasks: 1,
      priority: "low",
      timeout: 300000,
    },
  }

  /**
   * Get role configuration by role type
   */
  export function getRoleConfig(role: CollaborationRole): RoleConfig {
    return ROLE_CONFIGS[role]
  }

  /**
   * Check if a role has a specific capability
   */
  export function hasCapability(
    role: CollaborationRole,
    capability: keyof RoleCapabilities
  ): boolean {
    return ROLE_CONFIGS[role].capabilities[capability] ?? false
  }

  /**
   * Validate that an agent can perform an action
   */
  export function canPerformAction(
    participant: Participant,
    action: keyof RoleCapabilities
  ): { allowed: boolean; reason?: string } {
    const config = ROLE_CONFIGS[participant.role]

    if (!config) {
      return { allowed: false, reason: `Unknown role: ${participant.role}` }
    }

    if (participant.status === "offline") {
      return { allowed: false, reason: "Agent is offline" }
    }

    if (participant.status === "busy" && action !== "canVote") {
      return { allowed: false, reason: "Agent is busy with another task" }
    }

    if (!config.capabilities[action]) {
      return {
        allowed: false,
        reason: `Role ${config.displayName} does not have permission to ${action}`,
      }
    }

    return { allowed: true }
  }

  /**
   * Create a new participant
   */
  export function createParticipant(
    agentSessionId: string,
    role: CollaborationRole,
    metadata?: Record<string, unknown>
  ): Participant {
    return {
      agentSessionId,
      role,
      joinedAt: Date.now(),
      status: "active",
      completedTasks: 0,
      metadata,
    }
  }

  /**
   * All collaboration roles as an array
   */
  export const ALL_ROLES: CollaborationRole[] = [
    "orchestrator",
    "implementer",
    "integrator",
    "reviewer",
    "debater",
    "general",
  ]

  /**
   * Roles that can modify code
   */
  export const CODE_ROLES: CollaborationRole[] = [
    "implementer",
    "integrator",
  ]

  /**
   * Roles that can make decisions
   */
  export const DECISION_ROLES: CollaborationRole[] = [
    "orchestrator",
    "reviewer",
    "debater",
  ]
}
