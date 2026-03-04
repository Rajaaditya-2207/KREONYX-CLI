import z from "zod"
import { Tool } from "./tool"
import { Orchestrator } from "@/agent/orchestrator"

export const RequestReviewTool = Tool.define("request_review", {
    description: `Request a code review from specialized reviewer agents.
Use this tool to submit implemented code for peer review before marking it as complete.
The review will be conducted by a reviewer agent who will analyze the code for correctness, style, security, and performance.`,
    parameters: z.object({
        title: z.string().describe("Title of the review request"),
        description: z.string().describe("Detailed description of changes and areas to focus on"),
        code: z.string().describe("The code or git patch to be reviewed"),
    }),
    async execute(input, ctx) {
        await ctx.ask({
            description: `Request peer review for: "${input.title}"`,
        })

        // Create a standalone session for the review
        const session = await Orchestrator.createSession(ctx.agent, {
            title: `Review: ${input.title}`,
            participants: [ctx.agent, "reviewer"],
        })

        const request = await Orchestrator.requestReview(session.id, ctx.agent, {
            title: input.title,
            description: input.description,
            artifacts: [
                {
                    type: "code",
                    content: input.code,
                    description: "Implementation code to review",
                },
            ],
            reviewers: ["reviewer"],
            minApprovals: 1,
        })

        return {
            title: `Review requested: ${input.title}`,
            output: `Successfully requested code review "${request.id}".\nSession ID: ${session.id}\nReview ID: ${request.id}\nStatus: ${request.status}\nReviewers: reviewer`,
            metadata: {
                sessionId: session.id,
                reviewId: request.id,
            },
        }
    },
})
