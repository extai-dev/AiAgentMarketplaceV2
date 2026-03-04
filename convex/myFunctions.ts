import { v } from "convex/values";
import { query, mutation, action } from "./_generated/server";
import { api } from "./_generated/api";

// Write your Convex functions in any file inside this directory (`convex`).
// See https://docs.convex.dev/functions for more.

// You can read data from the database via a query:
export const listNumbers = query({
  // Validators for arguments.
  args: {
    count: v.number(),
  },

  // Query implementation.
  handler: async (ctx, args) => {
    //// Read the database as many times as you need here.
    //// See https://docs.convex.dev/database/reading-data.
    const numbers = await ctx.db
      .query("numbers")
      // Ordered by _creationTime, return most recent
      .order("desc")
      .take(args.count);
    return {
      viewer: (await ctx.auth.getUserIdentity())?.name ?? null,
      numbers: numbers.reverse().map((number) => number.value),
    };
  },
});

// You can write data to the database via a mutation:
export const addNumber = mutation({
  // Validators for arguments.
  args: {
    value: v.number(),
  },

  // Mutation implementation.
  handler: async (ctx, args) => {
    //// Insert or modify documents in the database here.
    //// Mutations can also read from the database like queries.
    //// See https://docs.convex.dev/database/writing-data.

    const id = await ctx.db.insert("numbers", { value: args.value });

    console.log("Added new document with id:", id);
    // Optionally, return a value from your mutation.
    // return id;
  },
});

// You can fetch data from and send data to third-party APIs via an action:
export const myAction = action({
  // Validators for arguments.
  args: {
    first: v.number(),
    second: v.string(),
  },

  // Action implementation.
  handler: async (ctx, args) => {
    //// Use the browser-like `fetch` API to send HTTP requests.
    //// See https://docs.convex.dev/functions/actions#calling-third-party-apis-and-using-npm-packages.
    // const response = await ctx.fetch("https://api.thirdpartyservice.com");
    // const data = await response.json();

    //// Query data by running Convex queries.
    const data = await ctx.runQuery(api.myFunctions.listNumbers, {
      count: 10,
    });
    console.log(data);

    //// Write data by running Convex mutations.
    await ctx.runMutation(api.myFunctions.addNumber, {
      value: args.first,
    });
  },
});

// User functions
export const createUser = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .first();
    
    if (existingUser) {
      return existingUser;
    }
    
    return await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      clerkId: args.clerkId,
      createdAt: Date.now(),
    });
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();
    
    return user;
  },
});

// Agent functions
export const listAgents = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const agents = await ctx.db
      .query("agents")
      .order("desc")
      .take(limit);
    
    return agents.map((agent) => ({
      _id: agent._id,
      name: agent.name,
      description: agent.description,
      rating: agent.rating,
      tags: agent.tags,
      prompt: agent.prompt,
      model: agent.model,
      createdAt: agent.createdAt,
    }));
  },
});

export const createAgent = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    prompt: v.string(),
    model: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    
    // Get or create user
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }
    
    return await ctx.db.insert("agents", {
      name: args.name,
      description: args.description,
      prompt: args.prompt,
      model: args.model || "gemini-pro",
      tags: args.tags || [],
      createdAt: Date.now(),
    });
  },
});

export const rateAgent = mutation({
  args: {
    agentId: v.id("agents"),
    rating: v.number(),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    
    // Get or create user
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }
    
    // Check if user already rated this agent
    const ratings = await ctx.db
      .query("agentRatings")
      .withIndex("by_agent_user", (q) => q.eq("agentId", args.agentId))
      .collect();
    
    const existingRating = ratings.find((r) => r.userId === user._id);
    
    if (existingRating) {
      throw new Error("You have already rated this agent");
    }
    
    return await ctx.db.insert("agentRatings", {
      agentId: args.agentId,
      userId: user._id,
      rating: args.rating,
      comment: args.comment,
      createdAt: Date.now(),
    });
  },
});

export const getAgentRating = query({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const ratings = await ctx.db
      .query("agentRatings")
      .withIndex("by_agent_user", (q) => q.eq("agentId", args.agentId))
      .collect();
    
    if (ratings.length === 0) {
      return null;
    }
    
    const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
    return {
      average: avgRating,
      count: ratings.length,
    };
  },
});
