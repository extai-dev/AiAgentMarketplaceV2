import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";

// Helper function to call Gemini API
async function callGeminiAPI(messages: any[], model: string = "gemini-pro") {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: messages.map((msg) => ({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        })),
        maxOutputTokens: 2000,
        temperature: 0.7,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${error}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated";
}

// Mutation to create an agent in the database
export const createAgentMutation = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    prompt: v.string(),
    model: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const agentId = await ctx.db.insert("agents", {
      name: args.name,
      description: args.description,
      prompt: args.prompt,
      model: args.model || "gemini-pro",
      tags: args.tags || [],
      createdAt: Date.now(),
    });
    return agentId;
  },
});

// Mutation to get an agent
export const getAgentMutation = mutation({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    return agent;
  },
});

// Mutation to create an interaction
export const createInteractionMutation = mutation({
  args: {
    agentId: v.id("agents"),
    userId: v.optional(v.id("users")),
    input: v.string(),
    output: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentInteractions", {
      agentId: args.agentId,
      userId: args.userId,
      input: args.input,
      output: args.output,
      timestamp: Date.now(),
    });
  },
});

// Query to get agent interactions
export const getAgentInteractions = query({
  args: {
    agentId: v.id("agents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const interactions = await ctx.db
      .query("agentInteractions")
      .withIndex("by_agent_user", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .take(limit);
    return interactions;
  },
});

// Create a Gemini-powered agent
export const createGeminiAgent = action({
  args: {
    name: v.string(),
    description: v.string(),
    prompt: v.string(),
    model: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ success: boolean; agentId: any; message: string }> => {
    try {
      // Test the Gemini API connection
      await callGeminiAPI([
        { role: "user", content: "Hello, this is a test message." }
      ], args.model || "gemini-pro");

      // Create the agent in the database using runMutation
      const agentId: any = await ctx.runMutation(api.agentService.createAgentMutation, {
        name: args.name,
        description: args.description,
        prompt: args.prompt,
        model: args.model || "gemini-pro",
        tags: args.tags || [],
      });

      return {
        success: true,
        agentId,
        message: "Agent created successfully",
      };
    } catch (error) {
      console.error("Error creating Gemini agent:", error);
      throw new Error(`Failed to create agent: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
});

// Helper function to get or create user
async function getOrCreateUser(ctx: any, identity: any) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q: any) => q.eq("clerkId", identity.subject))
    .first();
  
  if (!user) {
    return await ctx.db.insert("users", {
      name: identity.name || "User",
      email: identity.email,
      clerkId: identity.subject,
      createdAt: Date.now(),
    });
  }
  
  return user._id;
}

// Execute an agent's task using Gemini
export const executeAgent = action({
  args: {
    agentId: v.id("agents"),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Get the agent from the database using runMutation
      const agent = await ctx.runMutation(api.agentService.getAgentMutation, { agentId: args.agentId });
      if (!agent) {
        throw new Error("Agent not found");
      }

      // Get user context if authenticated
      const identity = await ctx.auth.getUserIdentity();
      const userName = identity?.name ?? "Anonymous";

      // Construct the prompt with agent instructions
      const systemPrompt = `
You are ${agent.name}, an AI agent powered by Google Gemini.

${agent.prompt}

Your task is to help users with their requests based on your capabilities and instructions.

Always be helpful, accurate, and safe in your responses.
`;

      // Call Gemini API
      const output = await callGeminiAPI([
        { role: "system", content: systemPrompt },
        { role: "user", content: args.input },
      ], agent.model || "gemini-pro");

      // Store the interaction in the database
      await ctx.runMutation(api.agentService.createInteractionMutation, {
        agentId: args.agentId,
        userId: identity?.subject ? await getOrCreateUser(ctx, identity) : null,
        input: args.input,
        output: output,
      });

      return {
        success: true,
        output,
      };
    } catch (error) {
      console.error("Error executing agent:", error);
      throw new Error(`Failed to execute agent: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
});

// Generate agent suggestions using Gemini
export const generateAgentSuggestions = action({
  args: {
    category: v.optional(v.string()),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const category = args.category || "general";
      const count = args.count || 5;

      const suggestions = await callGeminiAPI([
        {
          role: "system",
          content: `You are an expert in AI agent design. Generate ${count} creative and practical AI agent ideas for the ${category} category. 
            
            For each agent, provide:
            - Name (concise, catchy)
            - Description (2-3 sentences)
            - Use case (what problem it solves)
            - Tags (3-5 relevant tags)
            
            Format as JSON array of objects with fields: name, description, useCase, tags.`,
        },
        {
          role: "user",
          content: `Generate ${count} AI agent ideas for ${category}.`,
        },
      ], "gemini-pro");

      // Parse the JSON response
      let suggestionsArray = [];
      try {
        suggestionsArray = JSON.parse(suggestions);
      } catch (e) {
        console.error("Failed to parse suggestions JSON:", e);
        suggestionsArray = [];
      }

      return {
        success: true,
        suggestions: suggestionsArray,
      };
    } catch (error) {
      console.error("Error generating suggestions:", error);
      throw new Error(`Failed to generate suggestions: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
});

// Get agent statistics using Gemini analysis
export const analyzeAgentPerformance = action({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; analysis: any; stats: { totalInteractions: number; avgResponseLength: number } }> => {
    try {
      const agent = await ctx.runMutation(api.agentService.getAgentMutation, { agentId: args.agentId });
      if (!agent) {
        throw new Error("Agent not found");
      }

      // Get recent interactions
      const interactions: any[] = await ctx.runQuery(api.agentService.getAgentInteractions, { agentId: args.agentId });

      if (interactions.length === 0) {
        return {
          success: true,
          analysis: null,
          stats: {
            totalInteractions: 0,
            avgResponseLength: 0,
          },
        };
      }

      const totalInteractions: number = interactions.length;
      const totalResponseLength = interactions.reduce((sum: number, i: any) => sum + (i.output?.length || 0), 0);
      const avgResponseLength = totalResponseLength / totalInteractions;

      // Generate analysis using Gemini
      const analysis = await callGeminiAPI([
        {
          role: "system",
          content: `You are an AI agent performance analyst. Analyze the following interactions for the agent "${agent.name}" and provide insights about:
            - Common user intents
            - Response quality indicators
            - Potential improvements
            - Use case effectiveness
            
            Format as JSON with keys: commonIntents, responseQuality, potentialImprovements, useCaseEffectiveness.`,
        },
        {
          role: "user",
          content: `Analyze these interactions for agent "${agent.name}":\n\n${interactions.slice(0, 10).map((i: any, idx: number) => 
            `Interaction ${idx + 1}:\nInput: ${i.input}\nOutput: ${i.output?.substring(0, 200)}...`
          ).join("\n\n")}`,
        },
      ], "gemini-pro");

      let analysisResult = {};
      try {
        analysisResult = JSON.parse(analysis);
      } catch (e) {
        console.error("Failed to parse analysis JSON:", e);
        analysisResult = {};
      }

      return {
        success: true,
        analysis: analysisResult,
        stats: {
          totalInteractions,
          avgResponseLength,
        },
      };
    } catch (error) {
      console.error("Error analyzing agent performance:", error);
      throw new Error(`Failed to analyze agent: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
});
