import z from "zod"
import { Tool } from "./tool"
import { Orchestrator } from "@/agent/orchestrator"

export const OrchestrateTool = Tool.define("orchestrate", {
    description: `Launch a parallel multi-agent collaboration session.
Use this tool when a user request requires coordinating multiple agents in parallel.
Modes:
- "map-reduce": Split work across files and process them in parallel with implementer agents, then merge results with an integrator.
- "debate": Start a structured debate among agents to evaluate trade-offs for a technical decision.`,
    parameters: z.object({
        mode: z.enum(["map-reduce", "debate"]).describe("The orchestration mode to use"),
        title: z.string().describe("Title of the collaboration session"),
        description: z.string().describe("What needs to be accomplished"),
        files: z.array(z.string()).optional().describe("List of files to process (required for map-reduce)"),
        requirements: z.array(z.string()).optional().describe("Requirements for the agents (for map-reduce)"),
    }),
    async execute(input, ctx) {
        await ctx.ask({
            description: `Execute ${input.mode} orchestration: "${input.title}"`,
        })

        // Create a collaboration session
        const session = await Orchestrator.createSession(ctx.agent, {
            title: input.title,
            description: input.description,
            participants: [ctx.agent, "implementer", "integrator", "reviewer"],
        })

        if (input.mode === "map-reduce") {
            if (!input.files || input.files.length === 0) {
                return {
                    title: "Orchestration failed",
                    output: "Map-Reduce mode requires a non-empty 'files' array.",
                    metadata: { error: true },
                }
            }

            const job = await Orchestrator.createMapReduceJob(session.id, ctx.agent, {
                title: input.title,
                description: input.description,
                inputs: input.files.map((file) => ({
                    file,
                    requirements: input.requirements || [input.description],
                })),
                mapper: "implementer",
                reducer: "integrator",
                maxParallel: 3,
            })

            return {
                title: `Map-Reduce: ${input.title}`,
                output: `Successfully launched Map-Reduce job "${job.id}" across ${input.files.length} files.\nSession ID: ${session.id}\nJob ID: ${job.id}\nStatus: ${job.status}\nTasks: ${job.tasks.length}`,
                metadata: {
                    sessionId: session.id,
                    jobId: job.id,
                    mode: "map-reduce",
                    fileCount: input.files.length,
                },
            }
        }

        if (input.mode === "debate") {
            const debate = await Orchestrator.createDebate(session.id, ctx.agent, {
                topic: input.title,
                description: input.description,
                participants: [ctx.agent, "implementer", "reviewer"],
                format: "structured",
                maxRounds: 2,
            })

            return {
                title: `Debate: ${input.title}`,
                output: `Successfully launched Debate "${debate.id}" on topic: "${input.title}".\nSession ID: ${session.id}\nDebate ID: ${debate.id}\nFormat: structured\nMax Rounds: 2`,
                metadata: {
                    sessionId: session.id,
                    debateId: debate.id,
                    mode: "debate",
                },
            }
        }

        return {
            title: "Orchestration failed",
            output: `Unsupported orchestration mode: "${input.mode}". Use "map-reduce" or "debate".`,
            metadata: { error: true },
        }
    },
})
