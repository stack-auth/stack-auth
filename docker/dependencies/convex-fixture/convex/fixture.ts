import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const addPerson = mutation({
  args: { name: v.string(), age: v.number(), active: v.boolean(), tags: v.array(v.string()), meta: v.object({ rank: v.number() }) },
  handler: async (ctx, args) => await ctx.db.insert("it_people", args),
});

export const setAge = mutation({
  args: { id: v.id("it_people"), age: v.number() },
  handler: async (ctx, args) => { await ctx.db.patch(args.id, { age: args.age }); },
});

export const removePerson = mutation({
  args: { id: v.id("it_people") },
  handler: async (ctx, args) => { await ctx.db.delete(args.id); },
});

/** Clears the table so a test run starts from a known state. */
export const clearPeople = mutation({
  args: {},
  handler: async (ctx) => {
    for (const row of await ctx.db.query("it_people").collect()) await ctx.db.delete(row._id);
  },
});

export const addOddity = mutation({
  args: { big: v.int64(), blob: v.bytes() },
  handler: async (ctx, args) => await ctx.db.insert("it_oddities", args),
});

export const listPeople = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("it_people").collect(),
});
