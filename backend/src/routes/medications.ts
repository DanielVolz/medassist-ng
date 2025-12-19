import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { medications } from "../db/schema.js";
import { eq } from "drizzle-orm";

const sliceSchema = z.object({
  usage: z.number().nonnegative(),
  every: z.number().int().min(1),
  start: z.string().datetime(),
});

const medicationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  count: z.number().int().min(0),
  stripSize: z.number().int().min(1),
  slices: z.array(sliceSchema).min(1).max(12),
});

function zipSlices(usage: number[], every: number[], start: string[]) {
  const len = Math.min(usage.length, every.length, start.length);
  const slices: Array<{ usage: number; every: number; start: string }> = [];
  for (let i = 0; i < len; i++) {
    slices.push({ usage: usage[i], every: every[i], start: start[i] });
  }
  return slices;
}

function parseSlices(row: typeof medications.$inferSelect) {
  try {
    const usage = JSON.parse(row.usageJson) as number[];
    const every = JSON.parse(row.everyJson) as number[];
    const start = JSON.parse(row.startJson) as string[];
    return zipSlices(usage, every, start);
  } catch (err) {
    return [];
  }
}

export async function medicationRoutes(app: FastifyInstance) {
  app.get("/medications", async () => {
    const rows = await db.select().from(medications).orderBy(medications.id);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      count: row.count,
      stripSize: row.stripSize,
      slices: parseSlices(row),
      updatedAt: row.updatedAt,
    }));
  });

  app.post("/medications", async (req, reply) => {
    const parsed = medicationSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(parsed.error.format());

    const { name, count, stripSize, slices } = parsed.data;
    const usageJson = JSON.stringify(slices.map((s) => s.usage));
    const everyJson = JSON.stringify(slices.map((s) => s.every));
    const startJson = JSON.stringify(slices.map((s) => s.start));

    const [inserted] = await db
      .insert(medications)
      .values({ name, count, stripSize, usageJson, everyJson, startJson })
      .returning();

    return {
      id: inserted.id,
      name: inserted.name,
      count: inserted.count,
      stripSize: inserted.stripSize,
      slices,
      updatedAt: inserted.updatedAt,
    };
  });

  app.put<{ Params: { id: string } }>("/medications/:id", async (req, reply) => {
    const parsed = medicationSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(parsed.error.format());
    const idNum = Number(req.params.id);
    if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

    const { name, count, stripSize, slices } = parsed.data;
    const usageJson = JSON.stringify(slices.map((s) => s.usage));
    const everyJson = JSON.stringify(slices.map((s) => s.every));
    const startJson = JSON.stringify(slices.map((s) => s.start));

    const result = await db
      .update(medications)
      .set({ name, count, stripSize, usageJson, everyJson, startJson, updatedAt: new Date() })
      .where(eq(medications.id, idNum))
      .returning();

    if (!result.length) return reply.notFound();

    return {
      id: result[0].id,
      name: result[0].name,
      count: result[0].count,
      stripSize: result[0].stripSize,
      slices,
      updatedAt: result[0].updatedAt,
    };
  });
}