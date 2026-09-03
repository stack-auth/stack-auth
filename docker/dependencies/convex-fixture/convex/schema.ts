import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Deliberately spans the type shapes the driver has to map: scalars, a nested
// object and an array (which land as JSON text), and Convex's Int64 and Bytes,
// which are the two types its JSON Schema only distinguishes by annotation.
export default defineSchema({
  it_people: defineTable({
    name: v.string(),
    age: v.number(),
    active: v.boolean(),
    tags: v.array(v.string()),
    meta: v.object({ rank: v.number() }),
  }),
  it_oddities: defineTable({
    big: v.int64(),
    blob: v.bytes(),
  }),
});
