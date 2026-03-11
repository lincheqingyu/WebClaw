/**
 * Agent 模块统一导出
 */

export { runSimpleAgent, type SimpleAgentOptions, type SimpleAgentResult, type TurnState } from './agent-runner.js'
export { runManagerAgent, type ManagerAgentOptions, type ManagerAgentResult } from './manager-runner.js'
export { runWorkerAgent, type WorkerAgentOptions, type WorkerAgentResult } from './worker-runner.js'
export { createVllmModel, type VllmModelOptions } from './vllm-model.js'
export { createSimpleTools, createManagerTools, createWorkerTools } from './tools/index.js'
export {
  MAX_ITERATIONS,
  MAX_TOOL_FAILURES,
  MAX_SUB_ITERATIONS,
  MAX_SUB_TOOL_FAILURES,
  TOOL_OUTPUT_LIMIT,
  type IterationTracker,
} from './types.js'
