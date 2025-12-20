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
  packCount: z.number().int().min(0).default(1),
  stripsPerPack: z.number().int().min(1).default(1),
  tabsPerStrip: z.number().int().min(1).default(1),
  looseTablets: z.number().int().min(0).default(0),
  // count will be derived on the backend
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
      strips: row.strips,
      stripSize: row.stripSize,
      packCount: row.packCount ?? 1,
      stripsPerPack: row.stripsPerPack ?? row.strips ?? 1,
      tabsPerStrip: row.tabsPerStrip ?? row.stripSize ?? 1,
      looseTablets: row.looseTablets ?? 0,
      slices: parseSlices(row),
      updatedAt: row.updatedAt,
    }));
  });

  app.post("/medications", async (req, reply) => {
    const parsed = medicationSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(parsed.error.format());

    const { name, packCount, stripsPerPack, tabsPerStrip, looseTablets, slices } = parsed.data;
    const usageJson = JSON.stringify(slices.map((s) => s.usage));
    const everyJson = JSON.stringify(slices.map((s) => s.every));
    const startJson = JSON.stringify(slices.map((s) => s.start));

    const derivedCount = deriveTotalTablets(packCount, stripsPerPack, tabsPerStrip, looseTablets);

    const [inserted] = await db
      .insert(medications)
      .values({
        name,
        count: derivedCount,
        strips: stripsPerPack,
        stripSize: tabsPerStrip,
        packCount,
        stripsPerPack,
        tabsPerStrip,
        looseTablets,
        usageJson,
        everyJson,
        startJson,
      })
      .returning();

    return {
      id: inserted.id,
      name: inserted.name,
      count: inserted.count,
      strips: inserted.strips,
      stripSize: inserted.stripSize,
      packCount: inserted.packCount,
      stripsPerPack: inserted.stripsPerPack,
      tabsPerStrip: inserted.tabsPerStrip,
      looseTablets: inserted.looseTablets,
      slices,
      updatedAt: inserted.updatedAt,
    };
  });

  app.put<{ Params: { id: string } }>("/medications/:id", async (req, reply) => {
    const parsed = medicationSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(parsed.error.format());
    const idNum = Number(req.params.id);
    if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

    const { name, packCount, stripsPerPack, tabsPerStrip, looseTablets, slices } = parsed.data;
    const usageJson = JSON.stringify(slices.map((s) => s.usage));
    const everyJson = JSON.stringify(slices.map((s) => s.every));
    const startJson = JSON.stringify(slices.map((s) => s.start));

    const derivedCount = deriveTotalTablets(packCount, stripsPerPack, tabsPerStrip, looseTablets);

    const result = await db
      .update(medications)
      .set({
        name,
        count: derivedCount,
        strips: stripsPerPack,
        stripSize: tabsPerStrip,
        packCount,
        stripsPerPack,
        tabsPerStrip,
        looseTablets,
        usageJson,
        everyJson,
        startJson,
        updatedAt: new Date(),
      })
      .where(eq(medications.id, idNum))
      .returning();

    if (!result.length) return reply.notFound();

    return {
      id: result[0].id,
      name: result[0].name,
      count: result[0].count,
      strips: result[0].strips,
      stripSize: result[0].stripSize,
      packCount: result[0].packCount,
      stripsPerPack: result[0].stripsPerPack,
      tabsPerStrip: result[0].tabsPerStrip,
      looseTablets: result[0].looseTablets,
      slices,
      updatedAt: result[0].updatedAt,
    };
  });

  app.delete<{ Params: { id: string } }>("/medications/:id", async (req, reply) => {
    const idNum = Number(req.params.id);
    if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

    const deleted = await db.delete(medications).where(eq(medications.id, idNum)).returning();
    if (!deleted.length) return reply.notFound();
    return reply.status(204).send();
  });

  app.post("/medications/usage", async (req, reply) => {
    const schema = z.object({ startDate: z.string().datetime(), endDate: z.string().datetime() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(parsed.error.format());
    const { startDate, endDate } = parsed.data;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return reply.badRequest("Invalid date range");
    }

    const rows = await db.select().from(medications).orderBy(medications.id);
    const payload = rows.map((row) => {
      const slices = parseSlices(row);
      const usageTotal = calculateUsageInRange(slices, start, end);
      const tabsPerStrip = row.tabsPerStrip ?? row.stripSize ?? 1;
      const packCount = row.packCount ?? 1;
      const stripsPerPack = row.stripsPerPack ?? row.strips ?? 1;
      const looseTablets = row.looseTablets ?? 0;

      const stripsNeeded = tabsPerStrip > 0 ? Math.ceil(usageTotal / tabsPerStrip) : 0;
      const stripsAvailable = packCount * stripsPerPack + (tabsPerStrip > 0 ? looseTablets / tabsPerStrip : 0);
      const enough = stripsAvailable >= stripsNeeded;
      return {
        medicationId: row.id,
        medicationName: row.name,
        plannerUsage: usageTotal,
        stripSize: tabsPerStrip,
        stripsNeeded,
        stripsAvailable,
        enough,
      };
    });

    return payload;
  });
}

function calculateUsageInRange(slices: Array<{ usage: number; every: number; start: string }>, start: Date, end: Date) {
  let total = 0;
  slices.forEach((slice) => {
    const sliceStart = new Date(slice.start);
    if (Number.isNaN(sliceStart.getTime())) return;
    // iterate occurrences from sliceStart up to end
    for (let dt = new Date(sliceStart); dt < end; dt.setDate(dt.getDate() + slice.every)) {
      if (dt >= start && dt < end) total += slice.usage;
    }
  });
  return Number(total.toFixed(2));
}

function deriveTotalTablets(packCount: number, stripsPerPack: number, tabsPerStrip: number, looseTablets: number) {
  const packs = packCount || 0;
  const strips = stripsPerPack || 0;
  const tabs = tabsPerStrip || 1;
  const loose = looseTablets || 0;
  const packed = packs * strips * tabs;
  return packed + loose;
}