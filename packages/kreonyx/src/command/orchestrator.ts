import { CommandInfo, commandHints } from "./command-info"
import PROMPT_ORCHESTRATOR_CREATE_SESSION from "./template/orchestrator_create_session.txt"
import PROMPT_ORCHESTRATOR_STATUS from "./template/orchestrator_status.txt"
import PROMPT_ORCHESTRATOR_DEBATE from "./template/orchestrator_debate.txt"
import PROMPT_ORCHESTRATOR_VOTE from "./template/orchestrator_vote.txt"
import PROMPT_ORCHESTRATOR_REVIEW from "./template/orchestrator_review.txt"
import PROMPT_ORCHESTRATOR_MAP_REDUCE from "./template/orchestrator_map_reduce.txt"

export namespace OrchestratorCommand {
  export const CREATE_SESSION = "orchestrator:create-session"
  export const STATUS = "orchestrator:status"
  export const DEBATE = "orchestrator:debate"
  export const VOTE = "orchestrator:vote"
  export const REVIEW = "orchestrator:review"
  export const MAP_REDUCE = "orchestrator:map-reduce"

  export const Info = {
    CREATE_SESSION: CommandInfo.parse({
      name: CREATE_SESSION,
      description: "Create a new multi-agent collaboration session",
      agent: "orchestrator",
      template: PROMPT_ORCHESTRATOR_CREATE_SESSION,
      hints: commandHints(PROMPT_ORCHESTRATOR_CREATE_SESSION),
      subtask: false,
    }),

    STATUS: CommandInfo.parse({
      name: STATUS,
      description: "Get status of a collaboration session",
      agent: "orchestrator",
      template: PROMPT_ORCHESTRATOR_STATUS,
      hints: commandHints(PROMPT_ORCHESTRATOR_STATUS),
      subtask: false,
    }),

    DEBATE: CommandInfo.parse({
      name: DEBATE,
      description: "Create a structured debate among agents",
      agent: "orchestrator",
      template: PROMPT_ORCHESTRATOR_DEBATE,
      hints: commandHints(PROMPT_ORCHESTRATOR_DEBATE),
      subtask: false,
    }),

    VOTE: CommandInfo.parse({
      name: VOTE,
      description: "Create a voting proposal for agents to vote on",
      agent: "orchestrator",
      template: PROMPT_ORCHESTRATOR_VOTE,
      hints: commandHints(PROMPT_ORCHESTRATOR_VOTE),
      subtask: false,
    }),

    REVIEW: CommandInfo.parse({
      name: REVIEW,
      description: "Request code review from agents",
      agent: "orchestrator",
      template: PROMPT_ORCHESTRATOR_REVIEW,
      hints: commandHints(PROMPT_ORCHESTRATOR_REVIEW),
      subtask: false,
    }),

    MAP_REDUCE: CommandInfo.parse({
      name: MAP_REDUCE,
      description: "Create a MapReduce job for parallel processing",
      agent: "orchestrator",
      template: PROMPT_ORCHESTRATOR_MAP_REDUCE,
      hints: commandHints(PROMPT_ORCHESTRATOR_MAP_REDUCE),
      subtask: false,
    }),
  } as const
}

export default OrchestratorCommand
