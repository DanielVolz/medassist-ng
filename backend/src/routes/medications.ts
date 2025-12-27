import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { medications } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { createWriteStream, existsSync, unlinkSync } from "fs";
import { resolve, extname } from "path";
import { pipeline } from "stream/promises";
import { requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";

const IMAGES_DIR = resolve(process.cwd(), "data/images");

const blisterSchema = z.object({
  usage: z.number().nonnegative(),
  every: z.number().int().min(1),
  start: z.string().datetime(),
});

const medicationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  genericName: z.string().trim().max(100).nullable().optional(),
  takenBy: z.string().trim().max(100).nullable().optional(),
  packCount: z.number().int().min(0).default(1),
  stripsPerPack: z.number().int().min(1).default(1),
  tabsPerStrip: z.number().int().min(1).default(1),
  looseTablets: z.number().int().min(0).default(0),
  pillWeightMg: z.number().int().min(1).nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  intakeRemindersEnabled: z.boolean().default(false),
  blisters: z.array(blisterSchema).min(1).max(12),
});

function zipBlisters(usage: number[], every: number[], start: string[]) {
  const len = Math.min(usage.length, every.length, start.length);
  const blisters: Array<{ usage: number; every: number; start: string }> = [];
  for (let i = 0; i < len; i++) {
    blisters.push({ usage: usage[i], every: every[i], start: start[i] });
  }
  return blisters;
}

function parseBlisters(row: typeof medications.$inferSelect) {
  try {
    const usage = JSON.parse(row.usageJson) as number[];
    const every = JSON.parse(row.everyJson) as number[];
    const start = JSON.parse(row.startJson) as string[];
    return zipBlisters(usage, every, start);
  } catch (err) {
    return [];
  }
}

export async function medicationRoutes(app: FastifyInstance) {
  // All medication routes require auth
  app.addHook("preHandler", requireAuth);

  // Helper to get user ID from request
  // Returns a default user ID when auth is disabled
  function getUserId(request: any, reply: any): number {
    // If auth is disabled, use a default user ID (1)
    if (!env.AUTH_ENABLED) {
      return 1;
    }
    
    const authUser = request.user as unknown as AuthUser | null;
    if (!authUser) {
      // This should never happen if requireAuth worked, but be safe
      reply.status(401).send({ error: "User not authenticated", code: "AUTH_REQUIRED" });
      throw new Error("AUTH_REQUIRED");
    }
    return authUser.id;
  }

  app.get("/medications", async (request, reply) => {
    const userId = getUserId(request, reply);
    const rows = await db.select().from(medications).where(eq(medications.userId, userId)).orderBy(medications.id);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      genericName: row.genericName,
      takenBy: row.takenBy,
      count: row.count,
      strips: row.strips,
      stripSize: row.stripSize,
      packCount: row.packCount ?? 1,
      stripsPerPack: row.stripsPerPack ?? row.strips ?? 1,
      tabsPerStrip: row.tabsPerStrip ?? row.stripSize ?? 1,
      looseTablets: row.looseTablets ?? 0,
      pillWeightMg: row.pillWeightMg,
      blisters: parseBlisters(row),
      imageUrl: row.imageUrl,
      expiryDate: row.expiryDate,
      notes: row.notes,
      intakeRemindersEnabled: row.intakeRemindersEnabled ?? false,
      updatedAt: row.updatedAt,
    }));
  });

  app.post("/medications", async (req, reply) => {
    const parsed = medicationSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(parsed.error.format());

    const userId = getUserId(req, reply);
    const { name, genericName, takenBy, packCount, stripsPerPack, tabsPerStrip, looseTablets, pillWeightMg, expiryDate, notes, intakeRemindersEnabled, blisters } = parsed.data;
    const usageJson = JSON.stringify(blisters.map((s) => s.usage));
    const everyJson = JSON.stringify(blisters.map((s) => s.every));
    const startJson = JSON.stringify(blisters.map((s) => s.start));

    const derivedCount = deriveTotalTablets(packCount, stripsPerPack, tabsPerStrip, looseTablets);

    const [inserted] = await db
      .insert(medications)
      .values({
        userId,
        name,
        genericName: genericName || null,
        takenBy: takenBy || null,
        count: derivedCount,
        strips: stripsPerPack,
        stripSize: tabsPerStrip,
        packCount,
        stripsPerPack,
        tabsPerStrip,
        looseTablets,
        pillWeightMg: pillWeightMg || null,
        expiryDate: expiryDate || null,
        notes: notes || null,
        intakeRemindersEnabled: intakeRemindersEnabled ?? false,
        usageJson,
        everyJson,
        startJson,
      })
      .returning();

    return {
      id: inserted.id,
      name: inserted.name,
      genericName: inserted.genericName,
      takenBy: inserted.takenBy,
      count: inserted.count,
      strips: inserted.strips,
      stripSize: inserted.stripSize,
      packCount: inserted.packCount,
      stripsPerPack: inserted.stripsPerPack,
      tabsPerStrip: inserted.tabsPerStrip,
      looseTablets: inserted.looseTablets,
      pillWeightMg: inserted.pillWeightMg,
      blisters,
      imageUrl: inserted.imageUrl,
      expiryDate: inserted.expiryDate,
      notes: inserted.notes,
      intakeRemindersEnabled: inserted.intakeRemindersEnabled,
      updatedAt: inserted.updatedAt,
    };
  });

  app.put<{ Params: { id: string } }>("/medications/:id", async (req, reply) => {
    const parsed = medicationSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(parsed.error.format());
    const idNum = Number(req.params.id);
    if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

    const userId = getUserId(req, reply);
    
    // Verify ownership
    const [existing] = await db.select().from(medications).where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
    if (!existing) return reply.notFound();

    const { name, genericName, takenBy, packCount, stripsPerPack, tabsPerStrip, looseTablets, pillWeightMg, expiryDate, notes, intakeRemindersEnabled, blisters } = parsed.data;
    const usageJson = JSON.stringify(blisters.map((s) => s.usage));
    const everyJson = JSON.stringify(blisters.map((s) => s.every));
    const startJson = JSON.stringify(blisters.map((s) => s.start));

    const derivedCount = deriveTotalTablets(packCount, stripsPerPack, tabsPerStrip, looseTablets);

    const result = await db
      .update(medications)
      .set({
        name,
        genericName: genericName || null,
        takenBy: takenBy || null,
        count: derivedCount,
        strips: stripsPerPack,
        stripSize: tabsPerStrip,
        packCount,
        stripsPerPack,
        tabsPerStrip,
        looseTablets,
        pillWeightMg: pillWeightMg || null,
        expiryDate: expiryDate || null,
        notes: notes || null,
        intakeRemindersEnabled: intakeRemindersEnabled ?? false,
        usageJson,
        everyJson,
        startJson,
        updatedAt: new Date(),
      })
      .where(and(eq(medications.id, idNum), eq(medications.userId, userId)))
      .returning();

    if (!result.length) return reply.notFound();

    return {
      id: result[0].id,
      name: result[0].name,
      genericName: result[0].genericName,
      takenBy: result[0].takenBy,
      count: result[0].count,
      strips: result[0].strips,
      stripSize: result[0].stripSize,
      packCount: result[0].packCount,
      stripsPerPack: result[0].stripsPerPack,
      tabsPerStrip: result[0].tabsPerStrip,
      looseTablets: result[0].looseTablets,
      pillWeightMg: result[0].pillWeightMg,
      blisters,
      imageUrl: result[0].imageUrl,
      expiryDate: result[0].expiryDate,
      notes: result[0].notes,
      intakeRemindersEnabled: result[0].intakeRemindersEnabled,
      updatedAt: result[0].updatedAt,
    };
  });

  app.delete<{ Params: { id: string } }>("/medications/:id", async (req, reply) => {
    const idNum = Number(req.params.id);
    if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

    const userId = getUserId(req, reply);

    // Delete associated image if exists (with ownership check)
    const [existing] = await db.select().from(medications).where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
    if (!existing) return reply.notFound();
    
    if (existing.imageUrl) {
      const imagePath = resolve(IMAGES_DIR, existing.imageUrl);
      if (existsSync(imagePath)) unlinkSync(imagePath);
    }

    const deleted = await db.delete(medications).where(and(eq(medications.id, idNum), eq(medications.userId, userId))).returning();
    if (!deleted.length) return reply.notFound();
    return reply.status(204).send();
  });

  // Upload medication image
  app.post<{ Params: { id: string } }>("/medications/:id/image", async (req, reply) => {
    const idNum = Number(req.params.id);
    if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

    const userId = getUserId(req, reply);
    const [existing] = await db.select().from(medications).where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
    if (!existing) return reply.notFound();

    const data = await req.file();
    if (!data) return reply.badRequest("No file uploaded");

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.badRequest("Invalid file type. Allowed: JPEG, PNG, WebP, GIF");
    }

    const ext = extname(data.filename) || ".jpg";
    const filename = `med-${idNum}-${Date.now()}${ext}`;
    const filepath = resolve(IMAGES_DIR, filename);

    await pipeline(data.file, createWriteStream(filepath));

    // Delete old image if exists
    if (existing.imageUrl) {
      const oldPath = resolve(IMAGES_DIR, existing.imageUrl);
      if (existsSync(oldPath)) unlinkSync(oldPath);
    }

    await db.update(medications).set({ imageUrl: filename, updatedAt: new Date() }).where(and(eq(medications.id, idNum), eq(medications.userId, userId)));

    return { success: true, imageUrl: filename };
  });

  // Delete medication image
  app.delete<{ Params: { id: string } }>("/medications/:id/image", async (req, reply) => {
    const idNum = Number(req.params.id);
    if (Number.isNaN(idNum)) return reply.badRequest("Invalid id");

    const userId = getUserId(req, reply);
    const [existing] = await db.select().from(medications).where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
    if (!existing) return reply.notFound();

    if (existing.imageUrl) {
      const filepath = resolve(IMAGES_DIR, existing.imageUrl);
      if (existsSync(filepath)) unlinkSync(filepath);
    }

    await db.update(medications).set({ imageUrl: null, updatedAt: new Date() }).where(and(eq(medications.id, idNum), eq(medications.userId, userId)));
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

    const userId = getUserId(req, reply);
    const rows = await db.select().from(medications).where(eq(medications.userId, userId)).orderBy(medications.id);
    const now = new Date();
    
    const payload = rows.map((row) => {
      const blisters = parseBlisters(row);
      const usageTotal = calculateUsageInRange(blisters, start, end);
      const tabsPerStrip = row.tabsPerStrip ?? row.stripSize ?? 1;
      const packCount = row.packCount ?? 1;
      const stripsPerPack = row.stripsPerPack ?? row.strips ?? 1;
      const looseTablets = row.looseTablets ?? 0;
      const originalTotalPills = packCount * stripsPerPack * tabsPerStrip + looseTablets;

      // Calculate consumption up to now (same logic as frontend)
      let consumedUntilNow = 0;
      blisters.forEach((blister) => {
        const blisterStart = new Date(blister.start);
        if (Number.isNaN(blisterStart.getTime()) || blisterStart > now) return;
        const msPerDay = 86400000;
        const period = Math.max(1, blister.every) * msPerDay;
        const occurrences = Math.floor((now.getTime() - blisterStart.getTime()) / period) + 1;
        consumedUntilNow += occurrences * blister.usage;
      });
      
      const currentPills = Math.max(0, originalTotalPills - consumedUntilNow);
      const stripsNeeded = tabsPerStrip > 0 ? Math.ceil(usageTotal / tabsPerStrip) : 0;
      
      // Calculate current stock using realistic consumption order (loose first, then blisters)
      const consumed = originalTotalPills - currentPills;
      const looseConsumed = Math.min(consumed, looseTablets);
      const loosePillsRemaining = looseTablets - looseConsumed;
      const blisterPillsConsumed = consumed - looseConsumed;
      const originalBlisterPills = originalTotalPills - looseTablets;
      const blisterPillsRemaining = Math.max(0, originalBlisterPills - blisterPillsConsumed);
      
      const fullBlisters = tabsPerStrip > 0 ? Math.floor(blisterPillsRemaining / tabsPerStrip) : 0;
      const openBlisterPills = tabsPerStrip > 0 ? blisterPillsRemaining % tabsPerStrip : 0;
      const loosePills = loosePillsRemaining + openBlisterPills; // Combine open blister + remaining loose
      
      const enough = currentPills >= usageTotal;
      return {
        medicationId: row.id,
        medicationName: row.name,
        totalPills: currentPills,
        plannerUsage: usageTotal,
        stripSize: tabsPerStrip,
        stripsNeeded,
        fullBlisters,
        loosePills,
        enough,
      };
    });

    return payload;
  });
}

function calculateUsageInRange(blisters: Array<{ usage: number; every: number; start: string }>, start: Date, end: Date) {
  let total = 0;
  blisters.forEach((blister) => {
    const blisterStart = new Date(blister.start);
    if (Number.isNaN(blisterStart.getTime())) return;
    // iterate occurrences from blisterStart up to end
    for (let dt = new Date(blisterStart); dt < end; dt.setDate(dt.getDate() + blister.every)) {
      if (dt >= start && dt < end) total += blister.usage;
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