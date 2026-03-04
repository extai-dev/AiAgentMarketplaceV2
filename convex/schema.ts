import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  numbers: defineTable({
    value: v.number(),
  }),
  users: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    clerkId: v.string(),
    createdAt: v.number(),
  }).index("by_clerkId", ["clerkId"]),
  agents: defineTable({
    name: v.string(),
    description: v.string(),
    rating: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    prompt: v.string(),
    model: v.optional(v.string()),
    createdAt: v.number(),
  }),
  agentRatings: defineTable({
    agentId: v.id("agents"),
    userId: v.id("users"),
    rating: v.number(),
    comment: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_agent_user", ["agentId"]),
  agentInteractions: defineTable({
    agentId: v.id("agents"),
    userId: v.optional(v.id("users")),
    input: v.string(),
    output: v.optional(v.string()),
    timestamp: v.number(),
  }).index("by_agent_user", ["agentId"]),
});
