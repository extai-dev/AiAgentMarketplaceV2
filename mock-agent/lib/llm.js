/**
 * LLM Integration Module
 *
 * Supports multiple LLM providers:
 * - Google Gemini
 * - OpenAI GPT
 * - Anthropic Claude
 * - Ollama (Local LLMs - FREE!)
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
// import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";

// ===== CONFIGURATION =====

const LLM_CONFIG = {
  // Provider selection
  provider: process.env.LLM_PROVIDER || "ollama", // "gemini", "openai", "anthropic", "ollama"
  
  // Model configurations
  models: {
    gemini: {
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "4096"),
    },
    openai: {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "4096"),
    },
    // anthropic: {
    //   model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
    //   temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
    //   maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "4096"),
    // },
    ollama: {
      model: process.env.OLLAMA_MODEL || "llama3.2:latest",
      temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "4096"),
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    }
  }
};

// ===== PROVIDER INITIALIZATION =====

let geminiModel = null;
let openaiClient = null;
let anthropicClient = null;
let ollamaReady = false;

/**
 * Initialize LLM clients based on configuration
 */
export async function initializeLLM() {
  const provider = LLM_CONFIG.provider;
  
  console.log(`[LLM] Initializing ${provider} provider...`);
  
  if (provider === "gemini") {
    if (!process.env.GEMINI_API_KEY) {
      console.warn("[LLM] GEMINI_API_KEY not set - Gemini will not be available");
    } else {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      geminiModel = genAI.getGenerativeModel({
        model: LLM_CONFIG.models.gemini.model
      });
      console.log(`[LLM] Gemini initialized with model: ${LLM_CONFIG.models.gemini.model}`);
    }
  }
  
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      console.warn("[LLM] OPENAI_API_KEY not set - OpenAI will not be available");
    } else {
      openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      console.log(`[LLM] OpenAI initialized with model: ${LLM_CONFIG.models.openai.model}`);
    }
  }
  
  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn("[LLM] ANTHROPIC_API_KEY not set - Anthropic will not be available");
    } else {
      anthropicClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });
      console.log(`[LLM] Anthropic initialized with model: ${LLM_CONFIG.models.anthropic.model}`);
    }
  }
  
  if (provider === "ollama") {
    try {
      // Re-read env vars now (dotenv may not have loaded at module init time)
      const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      const model = process.env.OLLAMA_MODEL || "llama3.2:latest";
      LLM_CONFIG.models.ollama.baseUrl = baseUrl;
      LLM_CONFIG.models.ollama.model = model;

      // Check if Ollama is running
      await axios.get(`${baseUrl}/api/tags`);
      ollamaReady = true;
      console.log(`[LLM] Ollama initialized at ${baseUrl} with model: ${model}`);
      console.log(`[LLM] 🎉 Using FREE local LLM via Ollama!`);
    } catch (error) {
      console.warn(`[LLM] Ollama not available at ${LLM_CONFIG.models.ollama.baseUrl}`);
      console.warn(`[LLM] Make sure Ollama is running: ollama serve`);
      console.warn(`[LLM] And pull the model: ollama pull ${LLM_CONFIG.models.ollama.model}`);
    }
  }
}

/**
 * Check if LLM is initialized and available
 */
export function isLLMAvailable() {
  const provider = LLM_CONFIG.provider;
  
  switch (provider) {
    case "gemini":
      return geminiModel !== null;
    case "openai":
      return openaiClient !== null;
    case "anthropic":
      return anthropicClient !== null;
    case "ollama":
      return ollamaReady;
    default:
      return false;
  }
}

// ===== MAIN LLM FUNCTION =====

/**
 * Generate content using the configured LLM
 * @param {string} prompt - The prompt to send to the LLM
 * @param {object} options - Optional configuration overrides
 * @returns {Promise<string>} - The LLM response text
 */
export async function generate(prompt, options = {}) {
  const provider = LLM_CONFIG.provider;
  const config = { ...LLM_CONFIG.models[provider], ...options };
  
  console.log(`[LLM] Generating with ${provider}...`);
  console.log(`[LLM] Model: ${config.model}, Temperature: ${config.temperature}`);
  
  try {
    let result;
    
    switch (provider) {
      case "gemini":
        result = await generateWithGemini(prompt, config);
        break;
      case "openai":
        result = await generateWithOpenAI(prompt, config);
        break;
      case "anthropic":
        result = await generateWithAnthropic(prompt, config);
        break;
      case "ollama":
        result = await generateWithOllama(prompt, config);
        break;
      default:
        throw new Error(`Unknown LLM provider: ${provider}`);
    }
    
    console.log(`[LLM] Generated ${result.length} characters`);
    return result;
    
  } catch (error) {
    console.error(`[LLM] Error:`, error.message);
    throw error;
  }
}

// ===== PROVIDER-SPECIFIC IMPLEMENTATIONS =====

async function generateWithGemini(prompt, config) {
  if (!geminiModel) {
    throw new Error("Gemini not initialized. Set GEMINI_API_KEY.");
  }
  
  const result = await geminiModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: config.temperature,
      maxOutputTokens: config.maxTokens,
    },
  });
  
  return result.response.text();
}

async function generateWithOpenAI(prompt, config) {
  if (!openaiClient) {
    throw new Error("OpenAI not initialized. Set OPENAI_API_KEY.");
  }
  
  const response = await openaiClient.chat.completions.create({
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    temperature: config.temperature,
    max_tokens: config.maxTokens,
  });
  
  return response.choices[0]?.message?.content || "";
}

async function generateWithAnthropic(prompt, config) {
  if (!anthropicClient) {
    throw new Error("Anthropic not initialized. Set ANTHROPIC_API_KEY.");
  }
  
  const response = await anthropicClient.messages.create({
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    temperature: config.temperature,
    max_tokens: config.maxTokens,
  });
  
  return response.content[0]?.text || "";
}

async function generateWithOllama(prompt, config) {
  if (!ollamaReady) {
    throw new Error("Ollama not initialized. Make sure Ollama is running.");
  }
  
  try {
    const response = await axios.post(
      `${config.baseUrl}/api/generate`,
      {
        model: config.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: config.temperature,
          num_predict: config.maxTokens,
        }
      },
      {
        timeout: 120000, // 2 minute timeout for local generation
      }
    );
    
    return response.data.response || "";
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Ollama not running at ${config.baseUrl}. Run: ollama serve`);
    }
    throw error;
  }
}

// ===== SPECIALIZED FUNCTIONS =====

/**
 * Evaluate a task using LLM reasoning
 */
export async function evaluateTaskWithLLM(task) {
  const prompt = `
You are an expert AI agent evaluating whether you should bid on a task.

## Your Capabilities
You have expertise in:
- Software development (web, mobile, backend, DevOps)
- Data analysis and visualization
- Research and documentation
- Writing and content creation
- API design and integration

## Task Information
- Title: ${task.title}
- Description: ${task.description}
- Reward: ${task.reward} ${task.tokenSymbol || "TT"}
- Deadline: ${task.deadline || "Not specified"}
- Escrow Deposited: ${task.escrowDeposited ? "Yes" : "No"}

## Your Criteria (for reference)
- Min Reward: ${process.env.MIN_REWARD || 0}
- Max Reward: ${process.env.MAX_REWARD || 100000}
- Keywords: ${process.env.KEYWORDS || "none"}
- Exclude: ${process.env.EXCLUDE_KEYWORDS || "urgent, asap"}

## Your Task
Analyze this task and respond with a JSON object:
{
  "shouldBid": true/false,
  "confidence": 0.0-1.0,
  "reason": "detailed explanation",
  "estimatedComplexity": "low/medium/high",
  "risks": ["risk1", "risk2"],
  "requiredSkills": ["skill1", "skill2"]
}

Respond ONLY with valid JSON, no other text.
`;

  try {
    const response = await generate(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Invalid JSON response from LLM");
  } catch (error) {
    console.error("[LLM] Task evaluation failed:", error.message);
    // Fallback to basic evaluation
    return {
      shouldBid: true,
      confidence: 0.5,
      reason: "LLM evaluation failed, using default",
      estimatedComplexity: "medium",
      risks: [],
      requiredSkills: []
    };
  }
}

/**
 * Calculate optimal bid amount using LLM
 */
export async function calculateBidAmountWithLLM(task, evaluation) {
  const prompt = `
You are calculating a fair bid amount for a task.

## Task Details
- Title: ${task.title}
- Description: ${task.description}
- Posted Reward: ${task.reward} ${task.tokenSymbol || "TT"}
- Deadline: ${task.deadline || "Not specified"}

## Your Evaluation
- Complexity: ${evaluation.estimatedComplexity || "medium"}
- Confidence: ${evaluation.confidence || 0.5}
- Risks: ${evaluation.risks?.join(", ") || "none"}
- Required Skills: ${evaluation.requiredSkills?.join(", ") || "general"}

## Market Context
- Your typical profit margin: 20-40%
- Competition: Assume other agents may bid
- Task complexity affects your bid

## Your Task
Calculate the optimal bid amount. Respond with JSON:
{
  "bidAmount": number,
  "reasoning": "why this amount",
  "minimumAcceptable": number,
  "strategy": "aggressive/balanced/conservative"
}

Respond ONLY with valid JSON, no other text.
`;

  try {
    const response = await generate(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Invalid JSON response");
  } catch (error) {
    console.error("[LLM] Bid calculation failed:", error.message);
    // Fallback to full reward
    return {
      bidAmount: task.reward,
      reasoning: "LLM failed, using full reward",
      minimumAcceptable: task.reward * 0.8,
      strategy: "balanced"
    };
  }
}

/**
 * Execute a task using LLM with tools
 */
export async function executeTaskWithLLM(task) {
  const prompt = `
You are executing a task assigned to you.

## Task Details
- ID: ${task.id}
- Title: ${task.title}
- Description: ${task.description}
- Reward: ${task.reward} ${task.tokenSymbol || "TT"}

## Instructions
1. Carefully analyze the task requirements
2. Execute the task to the best of your ability
3. Provide a comprehensive deliverable

## Output Format
Provide your work in markdown format:
# Task Completion Report

## Task Analysis
[What you understood from the task]

## Work Performed
[Detailed description of what you did]

## Deliverable
[Your actual work output]

## Quality Notes
[Any notes about quality, limitations, or recommendations]

Remember: Your work will be reviewed and rated. Quality matters!
`;

  try {
    const response = await generate(prompt, { maxTokens: 8192 });
    
    return {
      content: response,
      resultUri: null,
      resultHash: null,
      success: true
    };
  } catch (error) {
    console.error("[LLM] Task execution failed:", error.message);
    return {
      content: `# Task Execution Failed\n\nError: ${error.message}\n\nThe agent encountered an error while processing this task.`,
      resultUri: null,
      resultHash: null,
      success: false
    };
  }
}

/**
 * Generate a bid message using LLM
 */
export async function generateBidMessageWithLLM(task, evaluation, bidInfo) {
  const prompt = `
You are writing a bid message to convince a task creator to choose you.

## Task
- Title: ${task.title}
- Description: ${task.description.substring(0, 200)}...

## Your Evaluation
- Complexity: ${evaluation.estimatedComplexity}
- Confidence: ${evaluation.confidence}
- Required Skills: ${evaluation.requiredSkills?.join(", ")}

## Your Bid
- Amount: ${bidInfo.bidAmount} ${task.tokenSymbol || "TT"}
- Strategy: ${bidInfo.strategy}

## Your Task
Write a compelling, concise bid message (2-3 sentences) that:
1. Shows you understand the task
2. Highlights relevant skills
3. Explains why you're the right choice

Respond ONLY with the message, no formatting.
`;

  try {
    const response = await generate(prompt, { maxTokens: 200 });
    return response.trim();
  } catch (error) {
    console.error("[LLM] Bid message generation failed:", error.message);
    return `I can complete this task for ${bidInfo.bidAmount} ${task.tokenSymbol || "TT"}.`;
  }
}

export default {
  initializeLLM,
  isLLMAvailable,
  generate,
  evaluateTaskWithLLM,
  calculateBidAmountWithLLM,
  executeTaskWithLLM,
  generateBidMessageWithLLM
};
