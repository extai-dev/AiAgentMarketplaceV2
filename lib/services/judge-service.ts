/**
 * Judge Agent Evaluation Service
 * 
 * Uses LLM-as-a-judge to evaluate multiple agent submissions
 * and provide structured scores with actionable feedback.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

interface Submission {
  submissionId: string;
  agentId: string;
  agentName: string;
  content: string;
  version: number;
}

interface EvaluationDimension {
  name: string;
  description: string;
  weight: number;
}

interface EvaluationResult {
  agentId: string;
  agentName: string;
  submissionId: string;
  overallScore: number;
  dimensions: Record<string, number>;
  feedback: string;
  shouldContinue: boolean;
  eliminationReason?: string;
  tokensUsed?: number;
  costUsd?: number;
}

interface EvaluateParams {
  taskTitle: string;
  taskDescription: string;
  submissions: Submission[];
  round: number;
  maxRound: number;
  judgeModel?: string;
  judgeProvider?: string;
}

// Default evaluation dimensions
const DEFAULT_DIMENSIONS: EvaluationDimension[] = [
  { name: 'relevance', description: 'How well the response addresses the task requirements', weight: 0.25 },
  { name: 'completeness', description: 'Coverage of all required elements and details', weight: 0.20 },
  { name: 'correctness', description: 'Accuracy of information and absence of errors', weight: 0.20 },
  { name: 'structure', description: 'Organization, clarity, and readability', weight: 0.15 },
  { name: 'quality', description: 'Overall production quality and professionalism', weight: 0.20 },
];

// Task-type specific dimension overrides
const TASK_TYPE_DIMENSIONS: Record<string, EvaluationDimension[]> = {
  seo_content: [
    { name: 'keyword_usage', description: 'Proper integration of target keywords', weight: 0.20 },
    { name: 'seo_structure', description: 'Headings, meta tags, internal links', weight: 0.20 },
    { name: 'readability', description: 'Content is easy to read and scan', weight: 0.15 },
    { name: 'content_quality', description: 'Value provided to readers', weight: 0.25 },
    { name: 'completeness', description: 'All SEO elements included', weight: 0.20 },
  ],
  code_generation: [
    { name: 'functionality', description: 'Code compiles and works as intended', weight: 0.30 },
    { name: 'code_quality', description: 'Clean, readable, well-structured', weight: 0.20 },
    { name: 'best_practices', description: 'Follows language conventions', weight: 0.15 },
    { name: 'security', description: 'No security vulnerabilities', weight: 0.20 },
    { name: 'documentation', description: 'Comments and docs included', weight: 0.15 },
  ],
  data_analysis: [
    { name: 'accuracy', description: 'Correct data interpretation', weight: 0.25 },
    { name: 'insights', description: 'Valuable and actionable insights', weight: 0.25 },
    { name: 'visualization', description: 'Clear charts/graphs if applicable', weight: 0.15 },
    { name: 'methodology', description: 'Sound analytical approach', weight: 0.20 },
    { name: 'presentation', description: 'Clear and professional output', weight: 0.15 },
  ],
};

// Scoring thresholds
const ELIMINATION_SCORE_THRESHOLD = 40; // Below this, agent is eliminated
const MIN_SCORE_IMPROVEMENT = 5; // Minimum score improvement needed to continue

export async function evaluateSubmissions(params: EvaluateParams): Promise<{
  success: boolean;
  evaluations?: EvaluationResult[];
  winnerAgentId?: string;
  error?: string;
}> {
  const {
    taskTitle,
    taskDescription,
    submissions,
    round,
    maxRound,
    judgeModel = 'gemini-2.0-flash',
    judgeProvider = 'gemini',
  } = params;

  if (submissions.length === 0) {
    return { success: false, error: 'No submissions to evaluate' };
  }

  try {
    // Determine dimensions based on task type (could be inferred from title/description)
    const dimensions = inferDimensions(taskTitle, taskDescription);

    // Build judge prompt
    const prompt = buildJudgePrompt(taskTitle, taskDescription, submissions, dimensions, round, maxRound);

    // Call LLM judge
    const judgeResult = await callLLMJudge(prompt, judgeModel, judgeProvider);

    if (!judgeResult.success) {
      return { success: false, error: judgeResult.error };
    }

    // Parse judge response
    const parsed = parseJudgeResponse(judgeResult.response!, submissions);

    if (!parsed) {
      return { success: false, error: 'Failed to parse judge response' };
    }

    // Calculate scores and determine continuations
    const evaluations = calculateScores(parsed, dimensions, submissions, round);

    // Find winner (highest score)
    const winner = evaluations.reduce((best, current) => 
      current.overallScore > best.overallScore ? current : best
    );

    return {
      success: true,
      evaluations,
      winnerAgentId: winner.agentId,
    };
  } catch (error) {
    console.error('[JudgeService] Evaluation failed:', error);
    return { success: false, error: `Evaluation failed: ${error}` };
  }
}

function inferDimensions(taskTitle: string, taskDescription: string): EvaluationDimension[] {
  const combined = `${taskTitle} ${taskDescription}`.toLowerCase();

  if (combined.includes('seo') || combined.includes('content') || combined.includes('blog') || combined.includes('article')) {
    return TASK_TYPE_DIMENSIONS.seo_content;
  }
  if (combined.includes('code') || combined.includes('function') || combined.includes('api') || combined.includes('implement')) {
    return TASK_TYPE_DIMENSIONS.code_generation;
  }
  if (combined.includes('analysis') || combined.includes('data') || combined.includes('report') || combined.includes('insights')) {
    return TASK_TYPE_DIMENSIONS.data_analysis;
  }

  return DEFAULT_DIMENSIONS;
}

function buildJudgePrompt(
  taskTitle: string,
  taskDescription: string,
  submissions: Submission[],
  dimensions: EvaluationDimension[],
  round: number,
  maxRound: number
): string {
  const dimensionDescriptions = dimensions
    .map((d) => `- ${d.name}: ${d.description} (weight: ${d.weight * 100}%)`)
    .join('\n');

  const submissionTexts = submissions
    .map((s, i) => `### Submission ${i + 1} (Agent: ${s.agentName}, Version ${s.version})
${s.content}`)
    .join('\n\n---\n\n');

  return `You are an expert judge evaluating AI agent submissions for a competitive task.

## Task
**Title:** ${taskTitle}
**Description:** ${taskDescription}

## Evaluation Context
- Current Round: ${round} of ${maxRound}
- Number of Submissions: ${submissions.length}

## Scoring Dimensions
${dimensionDescriptions}

## Submissions
${submissionTexts}

## Your Task
Evaluate each submission and provide:
1. Scores (0-100) for each dimension
2. Overall score (weighted average)
3. Specific, actionable feedback for each agent
4. Whether the agent should continue to the next round

## Output Format (JSON)
Return ONLY a valid JSON array with this structure:
[
  {
    "agentId": "agent_123",
    "agentName": "Agent Name",
    "scores": {
      "relevance": 85,
      "completeness": 90,
      ...
    },
    "overallScore": 87,
    "feedback": "Specific feedback for this agent...",
    "shouldContinue": true
  },
  ...
]

IMPORTANT:
- Be strict and fair - compare submissions against each other
- Provide specific, actionable feedback (not generic praise/criticism)
- Consider the round number - early rounds should be more lenient
- shouldContinue should be false only if the submission is significantly below average
- Return ONLY the JSON array, no markdown formatting, no explanation`;
}

async function callLLMJudge(prompt: string, model: string, provider: string): Promise<{
  success: boolean;
  response?: string;
  tokens?: number;
  cost?: number;
  error?: string;
}> {
  try {
    if (provider === 'gemini' || model.includes('gemini')) {
      return await callGeminiJudge(prompt, model);
    } else if (provider === 'openai' || model.includes('gpt')) {
      return await callOpenAIJudge(prompt, model);
    } else if (provider === 'anthropic' || model.includes('claude')) {
      return await callAnthropicJudge(prompt, model);
    }

    // Default to Gemini
    return await callGeminiJudge(prompt, model);
  } catch (error) {
    return { success: false, error: `LLM call failed: ${error}` };
  }
}

async function callGeminiJudge(prompt: string, model: string): Promise<{
  success: boolean;
  response?: string;
  tokens?: number;
  cost?: number;
  error?: string;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'GEMINI_API_KEY not configured' };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = model || 'gemini-2.0-flash';
  const genModel = genAI.getGenerativeModel({ model: modelName });

  const result = await genModel.generateContent(prompt);
  const response = result.response.text();

  // Estimate tokens and cost (Gemini pricing is approximate)
  const inputTokens = Math.ceil(prompt.length / 4);
  const outputTokens = Math.ceil(response.length / 4);
  const cost = (inputTokens * 0.000000125) + (outputTokens * 0.0000005); // Approximate

  return {
    success: true,
    response,
    tokens: inputTokens + outputTokens,
    cost,
  };
}

async function callOpenAIJudge(prompt: string, model: string): Promise<{
  success: boolean;
  response?: string;
  tokens?: number;
  cost?: number;
  error?: string;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'OPENAI_API_KEY not configured' };
  }

  const client = new OpenAI({ apiKey });
  const modelName = model || 'gpt-4o-mini';

  const response = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: 'You are an expert judge evaluating AI agent submissions.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content || '';
  const tokens = response.usage?.total_tokens || 0;
  const cost = (tokens * 0.000003) + (response.usage?.prompt_tokens! * 0.0000015) || 0; // Approximate

  return {
    success: true,
    response: content,
    tokens,
    cost,
  };
}

async function callAnthropicJudge(prompt: string, model: string): Promise<{
  success: boolean;
  response?: string;
  tokens?: number;
  cost?: number;
  error?: string;
}> {
  // Simplified - would need @anthropic-ai/sdk
  return { success: false, error: 'Anthropic judge not yet implemented' };
}

function parseJudgeResponse(response: string, submissions: Submission[]): Array<{
  agentId: string;
  agentName: string;
  scores: Record<string, number>;
  overallScore: number;
  feedback: string;
  shouldContinue: boolean;
}> | null {
  try {
    // Try to extract JSON from response (handle markdown code blocks)
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || 
                      response.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      console.error('[JudgeService] No JSON found in response');
      return null;
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) {
      console.error('[JudgeService] Response is not an array');
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[JudgeService] Failed to parse judge response:', error);
    return null;
  }
}

function calculateScores(
  parsedResults: Array<{
    agentId: string;
    agentName: string;
    scores: Record<string, number>;
    overallScore: number;
    feedback: string;
    shouldContinue: boolean;
  }>,
  dimensions: EvaluationDimension[],
  submissions: Submission[],
  round: number
): EvaluationResult[] {
  // Calculate weighted scores if judge didn't provide them
  const results: EvaluationResult[] = parsedResults.map((result) => {
    const submission = submissions.find((s) => s.agentId === result.agentId);
    
    // Calculate weighted dimension score if not provided
    let calculatedOverall = result.overallScore;
    if (!calculatedOverall && result.scores) {
      calculatedOverall = dimensions.reduce((sum, dim) => {
        const score = result.scores[dim.name] || result.scores[dim.name.replace('_', '')] || 50;
        return sum + (score * dim.weight);
      }, 0);
    }

    // Determine if should continue
    let shouldContinue = result.shouldContinue;
    let eliminationReason: string | undefined;

    if (calculatedOverall < ELIMINATION_SCORE_THRESHOLD) {
      shouldContinue = false;
      eliminationReason = `Score ${calculatedOverall} below threshold ${ELIMINATION_SCORE_THRESHOLD}`;
    }

    return {
      agentId: result.agentId,
      agentName: result.agentName,
      submissionId: submission?.submissionId || '',
      overallScore: Math.round(calculatedOverall),
      dimensions: result.scores || {},
      feedback: result.feedback || 'No specific feedback provided.',
      shouldContinue,
      eliminationReason,
    };
  });

  // Adjust shouldContinue based on relative performance
  const scores = results.map((r) => r.overallScore);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const maxScore = Math.max(...scores);

  for (const result of results) {
    // If significantly below average and not already eliminated
    if (result.shouldContinue && result.overallScore < avgScore - 15) {
      result.shouldContinue = false;
      result.eliminationReason = `Significantly below average (${result.overallScore} vs ${Math.round(avgScore)})`;
    }
  }

  return results;
}

// Helper to get evaluation dimensions for a task type
export function getEvaluationDimensions(taskType: string): EvaluationDimension[] {
  return TASK_TYPE_DIMENSIONS[taskType] || DEFAULT_DIMENSIONS;
}

// Helper to estimate cost for an evaluation
export function estimateEvaluationCost(
  submissionsCount: number,
  avgSubmissionLength: number,
  provider: string = 'gemini'
): { inputTokens: number; outputTokens: number; estimatedCost: number } {
  const promptTokens = Math.ceil((submissionsCount * avgSubmissionLength + 2000) / 4);
  const outputTokens = Math.ceil(submissionsCount * 500 / 4);
  
  let costPerToken = 0.0000005; // Default Gemini
  if (provider === 'openai') costPerToken = 0.000003;
  
  return {
    inputTokens: promptTokens,
    outputTokens,
    estimatedCost: (promptTokens + outputTokens) * costPerToken,
  };
}