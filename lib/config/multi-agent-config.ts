/**
 * Multi-Agent Feature Flags
 * 
 * Configuration for enabling/disabling multi-agent features.
 * Can be overridden per-task or globally.
 */

export interface MultiAgentConfig {
  enabled: boolean;
  defaultMaxRounds: number;
  defaultMinScoreThreshold: number;
  defaultSelectionMode: 'WINNER_TAKE_ALL' | 'MERGED_OUTPUT' | 'SPLIT_PAYMENT';
  minAgentsPerTask: number;
  maxAgentsPerTask: number;
  minRewardThreshold: number; // Minimum reward to enable multi-agent
  judgeModels: {
    primary: string;
    fallback: string[];
  };
  costControls: {
    maxCostPerEvaluation: number;
    maxTotalCost: number;
    costAlertThreshold: number;
  };
}

export const DEFAULT_MULTI_AGENT_CONFIG: MultiAgentConfig = {
  enabled: process.env.MULTI_AGENT_ENABLED === 'true',
  defaultMaxRounds: parseInt(process.env.MULTI_AGENT_MAX_ROUNDS || '3'),
  defaultMinScoreThreshold: parseInt(process.env.MULTI_AGENT_MIN_SCORE || '70'),
  defaultSelectionMode: (process.env.MULTI_AGENT_SELECTION_MODE as any) || 'WINNER_TAKE_ALL',
  minAgentsPerTask: 2,
  maxAgentsPerTask: 5,
  minRewardThreshold: parseInt(process.env.MULTI_AGENT_MIN_REWARD || '50'),
  judgeModels: {
    primary: process.env.MULTI_AGENT_JUDGE_MODEL || 'gemini-2.0-flash',
    fallback: ['gpt-4o-mini', 'claude-3-haiku-20240307'],
  },
  costControls: {
    maxCostPerEvaluation: parseFloat(process.env.MULTI_AGENT_MAX_COST_EVAL || '0.50'),
    maxTotalCost: parseFloat(process.env.MULTI_AGENT_MAX_TOTAL_COST || '10.00'),
    costAlertThreshold: 0.7, // Alert at 70% of max
  },
};

export function isMultiAgentEnabled(taskReward?: number): boolean {
  if (!DEFAULT_MULTI_AGENT_CONFIG.enabled) return false;
  
  // Check reward threshold if provided
  if (taskReward !== undefined && taskReward < DEFAULT_MULTI_AGENT_CONFIG.minRewardThreshold) {
    return false;
  }
  
  return true;
}

export function getMultiAgentConfig(): MultiAgentConfig {
  return DEFAULT_MULTI_AGENT_CONFIG;
}

export function validateMultiAgentRequest(params: {
  taskReward: number;
  agentCount: number;
  maxRounds?: number;
}): { valid: boolean; error?: string } {
  const config = DEFAULT_MULTI_AGENT_CONFIG;
  
  if (!config.enabled) {
    return { valid: false, error: 'Multi-agent feature is not enabled' };
  }
  
  if (params.taskReward < config.minRewardThreshold) {
    return { valid: false, error: `Task reward must be at least ${config.minRewardThreshold} for multi-agent mode` };
  }
  
  if (params.agentCount < config.minAgentsPerTask) {
    return { valid: false, error: `At least ${config.minAgentsPerTask} agents required` };
  }
  
  if (params.agentCount > config.maxAgentsPerTask) {
    return { valid: false, error: `Maximum ${config.maxAgentsPerTask} agents allowed` };
  }
  
  if (params.maxRounds && params.maxRounds > config.defaultMaxRounds * 2) {
    return { valid: false, error: `Maximum ${config.defaultMaxRounds * 2} rounds allowed` };
  }
  
  return { valid: true };
}

export function estimateExecutionCost(
  agentCount: number,
  maxRounds: number,
  avgSubmissionLength: number = 2000
): { estimatedRounds: number; costPerRound: number; totalEstimated: number } {
  const costPerEvaluation = agentCount * 0.15; // ~$0.15 per evaluation (3-5 agents)
  const estimatedRounds = Math.min(maxRounds, 3); // Most tasks complete in 2-3 rounds
  const totalEstimated = costPerEvaluation * estimatedRounds;
  
  return {
    estimatedRounds,
    costPerRound: costPerEvaluation,
    totalEstimated: Math.min(totalEstimated, DEFAULT_MULTI_AGENT_CONFIG.costControls.maxTotalCost),
  };
}