import { z } from "zod"
import { ulid } from "ulid"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { AgentMessage } from "./message"
import { SharedMemory } from "@/workspace/memory"

export namespace MapReduce {
  const log = Log.create({ service: "mapreduce" })

  export const Task = z.object({
    id: z.string(),
    jobId: z.string(),
    index: z.number(),
    input: z.any(),
    status: z.enum(["pending", "assigned", "running", "completed", "failed"]).default("pending"),
    assignedTo: z.string().optional(), // agent session ID
    result: z.any().optional(),
    error: z.string().optional(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
  })
  export type Task = z.infer<typeof Task>

  export const Job = z.object({
    id: z.string(),
    collaborationId: z.string(),
    title: z.string(),
    description: z.string(),
    mapper: z.string(), // agent type to use for mapping
    reducer: z.string().optional(), // agent type to use for reducing
    splitStrategy: z.enum(["file", "function", "line_count", "custom"]).default("file"),
    tasks: z.array(Task),
    results: z.array(z.any()).default([]),
    finalResult: z.any().optional(),
    status: z.enum(["pending", "mapping", "reducing", "completed", "failed"]).default("pending"),
    maxParallel: z.number().default(5),
    createdAt: z.number(),
    completedAt: z.number().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  export type Job = z.infer<typeof Job>

  export const Event = {
    JobCreated: BusEvent.define("mapreduce.job_created", Job),
    TaskAssigned: BusEvent.define(
      "mapreduce.task_assigned",
      z.object({ jobId: z.string(), taskId: z.string(), agent: z.string() }),
    ),
    TaskCompleted: BusEvent.define(
      "mapreduce.task_completed",
      z.object({ jobId: z.string(), taskId: z.string(), result: z.any() }),
    ),
    TaskFailed: BusEvent.define(
      "mapreduce.task_failed",
      z.object({ jobId: z.string(), taskId: z.string(), error: z.string() }),
    ),
    JobCompleted: BusEvent.define(
      "mapreduce.job_completed",
      z.object({ jobId: z.string(), result: z.any() }),
    ),
  }

  const jobs = new Map<string, Job>()
  const runningTasks = new Map<string, Set<string>>() // jobId -> Set of task IDs

  export async function createJob(
    collaborationId: string,
    content: {
      title: string
      description: string
      inputs: any[]
      mapper: string
      reducer?: string
      splitStrategy?: Job["splitStrategy"]
      maxParallel?: number
      metadata?: Record<string, any>
    }
  ): Promise<Job> {
    const tasks: Task[] = content.inputs.map((input, index) => ({
      id: ulid(),
      jobId: "",
      index,
      input,
      status: "pending",
    }))

    const jobId = ulid()

    // Fix task references with correct jobId
    const tasksWithJobId = tasks.map(t => ({ ...t, jobId }))

    const job: Job = {
      id: jobId,
      collaborationId,
      title: content.title,
      description: content.description,
      mapper: content.mapper,
      reducer: content.reducer,
      splitStrategy: content.splitStrategy ?? "file",
      tasks: tasksWithJobId,
      results: [],
      status: "pending",
      maxParallel: content.maxParallel ?? 5,
      createdAt: Date.now(),
      metadata: content.metadata,
    }

    jobs.set(job.id, job)
    runningTasks.set(job.id, new Set())

    Bus.publish(Event.JobCreated, job)
    log.info("mapreduce job created", { jobId: job.id, tasks: tasks.length })

    // Store in shared memory for coordination
    await SharedMemory.set(`mapreduce:job:${job.id}`, job, {
      agentSessionID: "system",
    })

    return job
  }

  export async function startJob(
    jobId: string,
    orchestratorAgent: string
  ): Promise<{ success: boolean; error?: string }> {
    const job = jobs.get(jobId)
    if (!job) {
      return { success: false, error: "Job not found" }
    }

    if (job.status !== "pending") {
      return { success: false, error: `Job is already ${job.status}` }
    }

    job.status = "mapping"
    jobs.set(jobId, job)

    log.info("starting mapreduce job", { jobId, tasks: job.tasks.length })

    // Broadcast job start to all agents
    await AgentMessage.send(
      AgentMessage.create(
        "NOTIFY",
        orchestratorAgent,
        job.collaborationId,
        {
          message: `MapReduce job "${job.title}" started with ${job.tasks.length} tasks`,
          level: "info",
        },
        { priority: "high" }
      )
    )

    // Start processing tasks
    await processNextTasks(jobId, orchestratorAgent)

    return { success: true }
  }

  async function processNextTasks(jobId: string, orchestratorAgent: string): Promise<void> {
    const job = jobs.get(jobId)
    if (!job || job.status !== "mapping") return

    const running = runningTasks.get(jobId) ?? new Set()
    const available = job.maxParallel - running.size

    if (available <= 0) return

    // Get pending tasks
    const pending = job.tasks.filter(t => t.status === "pending").slice(0, available)

    for (const task of pending) {
      task.status = "assigned"
      running.add(task.id)

      Bus.publish(Event.TaskAssigned, {
        jobId,
        taskId: task.id,
        agent: task.assignedTo ?? "",
      })

      // Assign to agent via message
      await assignTaskToAgent(job, task, orchestratorAgent)
    }

    runningTasks.set(jobId, running)
    jobs.set(jobId, job)
  }

  async function assignTaskToAgent(
    job: Job,
    task: Task,
    orchestratorAgent: string
  ): Promise<void> {
    // Create a request for an agent to process this task
    const request = AgentMessage.create(
      "REQUEST",
      orchestratorAgent,
      job.collaborationId,
      {
        action: "mapreduce_process_task",
        parameters: {
          jobId: job.id,
          taskId: task.id,
          input: task.input,
          description: job.description,
          mapper: job.mapper,
        },
      },
      {
        requiresResponse: true,
        priority: "normal",
      }
    )

    log.debug("task assigned", { jobId: job.id, taskId: task.id })

    // Store task assignment
    await SharedMemory.set(`mapreduce:task:${task.id}`, {
      assignedAt: Date.now(),
      requestId: request.id,
    }, { agentSessionID: orchestratorAgent })
  }

  export async function completeTask(
    jobId: string,
    taskId: string,
    agent: string,
    result: any
  ): Promise<void> {
    const job = jobs.get(jobId)
    if (!job) return

    const task = job.tasks.find(t => t.id === taskId)
    if (!task || task.status === "completed") return

    task.status = "completed"
    task.result = result
    task.completedAt = Date.now()

    job.results.push(result)

    // Update running tasks
    const running = runningTasks.get(jobId) ?? new Set()
    running.delete(taskId)
    runningTasks.set(jobId, running)

    Bus.publish(Event.TaskCompleted, { jobId, taskId, result })
    log.debug("task completed", { jobId, taskId, agent })

    // Update shared memory
    await SharedMemory.atomicUpdate(`mapreduce:job:${jobId}`, (current: Job | undefined) => {
      if (!current) return job
      const updatedTasks = current.tasks.map(t =>
        t.id === taskId ? { ...t, status: "completed" as const, result } : t
      )
      return { ...current, tasks: updatedTasks, results: [...current.results, result] }
    }, { agentSessionID: agent })

    // Save job state
    jobs.set(jobId, job)

    // Check if all tasks are complete
    const allCompleted = job.tasks.every(t => t.status === "completed" || t.status === "failed")
    const hasFailures = job.tasks.some(t => t.status === "failed")

    if (allCompleted) {
      if (hasFailures && job.results.length === 0) {
        await failJob(jobId, "All tasks failed")
      } else {
        await completeJob(jobId, agent)
      }
    } else {
      // Process more tasks
      await processNextTasks(jobId, agent)
    }
  }

  export async function failTask(
    jobId: string,
    taskId: string,
    agent: string,
    error: string
  ): Promise<void> {
    const job = jobs.get(jobId)
    if (!job) return

    const task = job.tasks.find(t => t.id === taskId)
    if (!task) return

    task.status = "failed"
    task.error = error
    task.completedAt = Date.now()

    // Update running tasks
    const running = runningTasks.get(jobId) ?? new Set()
    running.delete(taskId)
    runningTasks.set(jobId, running)

    // Save job state
    jobs.set(jobId, job)

    Bus.publish(Event.TaskFailed, { jobId, taskId, error })
    log.warn("task failed", { jobId, taskId, agent, error })

    // Check if we should retry or continue
    const pendingCount = job.tasks.filter(t => t.status === "pending").length
    const completedCount = job.tasks.filter(t => t.status === "completed").length

    if (pendingCount === 0 && completedCount === 0) {
      await failJob(jobId, "All tasks failed")
    } else if (pendingCount > 0) {
      await processNextTasks(jobId, agent)
    } else if (completedCount > 0) {
      // Some tasks succeeded, continue with reduction
      await completeJob(jobId, agent)
    }
  }

  async function completeJob(jobId: string, orchestratorAgent: string): Promise<void> {
    const job = jobs.get(jobId)
    if (!job || job.status === "completed") return

    job.status = "reducing"
    jobs.set(jobId, job)

    // Perform reduction
    let finalResult: any

    if (job.reducer && job.results.length > 0) {
      // Use reducer agent to combine results
      const reduceRequest = AgentMessage.create(
        "REQUEST",
        orchestratorAgent,
        job.collaborationId,
        {
          action: "mapreduce_reduce",
          parameters: {
            jobId: job.id,
            results: job.results,
            reducer: job.reducer,
          },
        },
        { requiresResponse: true, priority: "high" }
      )

      try {
        const response = await AgentMessage.sendAndWait(reduceRequest, { timeout: 120000 })
        if (response.type === "RESPONSE") {
          finalResult = response.content.result
        } else {
          // Fallback: simple concatenation
          finalResult = job.results
        }
      } catch (err) {
        log.warn("reducer timed out, using fallback", { jobId })
        finalResult = job.results
      }
    } else {
      // No reducer, return all results
      finalResult = job.results
    }

    job.finalResult = finalResult
    job.status = "completed"
    job.completedAt = Date.now()
    jobs.set(jobId, job)

    Bus.publish(Event.JobCompleted, { jobId, result: finalResult })
    log.info("mapreduce job completed", { jobId, tasks: job.tasks.length, results: job.results.length })

    // Notify all agents
    await AgentMessage.send(
      AgentMessage.create(
        "COMPLETE",
        orchestratorAgent,
        job.collaborationId,
        {
          taskId: jobId,
          summary: `MapReduce job "${job.title}" completed with ${job.results.length}/${job.tasks.length} successful tasks`,
          artifacts: [
            {
              type: "file",
              content: JSON.stringify(finalResult, null, 2),
            },
          ],
          metrics: {
            timeTaken: job.completedAt - job.createdAt,
            filesModified: job.results.length,
          },
        },
        { priority: "high" }
      )
    )

    // Update shared memory
    await SharedMemory.set(`mapreduce:job:${jobId}`, job, { agentSessionID: orchestratorAgent })
  }

  async function failJob(jobId: string, error: string): Promise<void> {
    const job = jobs.get(jobId)
    if (!job) return

    job.status = "failed"
    job.completedAt = Date.now()
    jobs.set(jobId, job)

    log.error("mapreduce job failed", { jobId, error })

    await AgentMessage.send(
      AgentMessage.create(
        "ERROR",
        "system",
        job.collaborationId,
        {
          code: "MAPREDUCE_JOB_FAILED",
          message: `MapReduce job "${job.title}" failed: ${error}`,
          recoverable: false,
        },
        { priority: "urgent" }
      )
    )
  }

  export async function getJob(jobId: string): Promise<Job | undefined> {
    return jobs.get(jobId)
  }

  export async function getJobStatus(jobId: string): Promise<{
    status: Job["status"]
    progress: { completed: number; failed: number; pending: number; total: number }
    results: any[]
    finalResult?: any
  } | undefined> {
    const job = jobs.get(jobId)
    if (!job) return undefined

    return {
      status: job.status,
      progress: {
        completed: job.tasks.filter(t => t.status === "completed").length,
        failed: job.tasks.filter(t => t.status === "failed").length,
        pending: job.tasks.filter(t => t.status === "pending").length,
        total: job.tasks.length,
      },
      results: job.results,
      finalResult: job.finalResult,
    }
  }

  export async function cancelJob(
    jobId: string,
    orchestratorAgent: string
  ): Promise<boolean> {
    const job = jobs.get(jobId)
    if (!job || job.status === "completed" || job.status === "failed") {
      return false
    }

    job.status = "failed"
    job.completedAt = Date.now()
    jobs.set(jobId, job)

    log.info("mapreduce job cancelled", { jobId })

    await AgentMessage.send(
      AgentMessage.create(
        "NOTIFY",
        orchestratorAgent,
        job.collaborationId,
        {
          message: `MapReduce job "${job.title}" cancelled`,
          level: "warn",
        },
        { priority: "high" }
      )
    )

    return true
  }

  export function subscribeToJob(
    jobId: string,
    callback: (event: { type: string; data: any }) => void
  ): () => void {
    const unsubscribe: (() => void)[] = []

    unsubscribe.push(
      Bus.subscribe(Event.TaskAssigned, (event: { jobId: string }) => {
        if (event.jobId === jobId) callback({ type: "task_assigned", data: event })
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.TaskCompleted, (event: { jobId: string }) => {
        if (event.jobId === jobId) callback({ type: "task_completed", data: event })
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.TaskFailed, (event: { jobId: string }) => {
        if (event.jobId === jobId) callback({ type: "task_failed", data: event })
      })
    )

    unsubscribe.push(
      Bus.subscribe(Event.JobCompleted, (event: { jobId: string }) => {
        if (event.jobId === jobId) callback({ type: "completed", data: event })
      })
    )

    return () => unsubscribe.forEach(u => u())
  }

  // Helper to split files for processing
  export function splitFiles(
    files: string[],
    strategy: Job["splitStrategy"]
  ): { chunks: string[][]; metadata: any } {
    switch (strategy) {
      case "file":
        // Each file is its own task
        return {
          chunks: files.map(f => [f]),
          metadata: { strategy: "file", count: files.length },
        }

      case "function":
        // Would need to parse files to extract functions
        // For now, fallback to file strategy
        return {
          chunks: files.map(f => [f]),
          metadata: { strategy: "function", count: files.length },
        }

      case "line_count":
        // Group files by line count
        // Simple approach: 10 files per chunk
        const chunks: string[][] = []
        const chunkSize = 10
        for (let i = 0; i < files.length; i += chunkSize) {
          chunks.push(files.slice(i, i + chunkSize))
        }
        return {
          chunks,
          metadata: { strategy: "line_count", count: chunks.length },
        }

      case "custom":
        // User-defined splitting
        return {
          chunks: [files],
          metadata: { strategy: "custom", count: 1 },
        }

      default:
        return {
          chunks: files.map(f => [f]),
          metadata: { strategy: "file", count: files.length },
        }
    }
  }
}
