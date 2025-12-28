import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "crypto";
import { db } from "../db/client.js";
import { medications, shareTokens, userSettings, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, optionalAuth, getAnonymousUserId } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";

// Share token validity: 1 year in milliseconds
const SHARE_TOKEN_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

// =============================================================================
// Validation Schemas
// =============================================================================
const createShareSchema = z.object({
  takenBy: z.string().min(1, "takenBy is required"),
  scheduleDays: z.number().int().min(1).max(365).default(30),
});

// Helper to get user ID from request
// Returns anonymous user ID when auth is disabled
async function getUserId(request: any, reply: any): Promise<number> {
  // If auth is disabled, use the anonymous user
  if (!env.AUTH_ENABLED) {
    return getAnonymousUserId();
  }
  
  const authUser = request.user as unknown as AuthUser | null;
  if (!authUser) {
    reply.status(401).send({ error: "Not authenticated" });
    throw new Error("AUTH_REQUIRED");
  }
  return authUser.id;
}

// =============================================================================
// Share Routes
// =============================================================================
export async function shareRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // GET /share/:token - PUBLIC: Get shared schedule by token
  // ---------------------------------------------------------------------------
  app.get<{ Params: { token: string } }>("/share/:token", async (request, reply) => {
    const { token } = request.params;

    // Find share token
    const [share] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
    if (!share) {
      return reply.status(404).send({ 
        error: "Share link not found",
        code: "NOT_FOUND"
      });
    }

    // Check if token has expired
    if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
      // Get the username of the owner to show in the expired message
      const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, share.userId));
      return reply.status(410).send({
        error: "Share link has expired",
        code: "EXPIRED",
        ownerUsername: owner?.username ?? "the owner",
        takenBy: share.takenBy,
        expiredAt: share.expiresAt.toISOString(),
      });
    }

    // Get user settings for stock thresholds
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, share.userId));

    // Get medications for this user filtered by takenBy
    const meds = await db.select().from(medications).where(
      and(
        eq(medications.userId, share.userId),
        eq(medications.takenBy, share.takenBy)
      )
    );

    // Parse blisters and build schedule data
    const medicationsWithBlisters = meds.map((med) => {
      let blisters: { usage: number; every: number; start: string }[] = [];
      try {
        const usageArr = JSON.parse(med.usageJson || "[]");
        const everyArr = JSON.parse(med.everyJson || "[]");
        const startArr = JSON.parse(med.startJson || "[]");
        blisters = usageArr.map((usage: number, i: number) => ({
          usage,
          every: everyArr[i] ?? 1,
          start: startArr[i] ?? new Date().toISOString(),
        }));
      } catch {
        blisters = [];
      }

      return {
        id: med.id,
        name: med.name,
        genericName: med.genericName,
        pillWeightMg: med.pillWeightMg,
        imageUrl: med.imageUrl,
        count: med.count,
        tabsPerStrip: med.tabsPerStrip,
        blisters,
      };
    });

    return {
      takenBy: share.takenBy,
      scheduleDays: share.scheduleDays,
      medications: medicationsWithBlisters,
      stockThresholds: {
        lowStockDays: settings?.lowStockDays ?? 30,
      },
    };
  });

  // ---------------------------------------------------------------------------
  // POST /share - PROTECTED: Create a new share link
  // ---------------------------------------------------------------------------
  app.post<{ Body: z.infer<typeof createShareSchema> }>(
    "/share",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = await getUserId(request, reply);

      const parsed = createShareSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.errors[0]?.message ?? "Invalid input",
          code: "VALIDATION_ERROR",
        });
      }

      const { takenBy, scheduleDays } = parsed.data;

      // Check if user has medications for this takenBy
      const [existingMed] = await db.select().from(medications).where(
        and(
          eq(medications.userId, userId),
          eq(medications.takenBy, takenBy)
        )
      );

      if (!existingMed) {
        return reply.status(400).send({
          error: "No medications found for this person",
          code: "NO_MEDICATIONS",
        });
      }

      // Generate unique token (8 bytes = 16 hex chars)
      const token = randomBytes(8).toString("hex");
      
      // Set expiration date (1 year from now)
      const expiresAt = new Date(Date.now() + SHARE_TOKEN_VALIDITY_MS);

      // Create share token
      await db.insert(shareTokens).values({
        userId: userId,
        token,
        takenBy,
        scheduleDays,
        expiresAt,
      });

      return {
        token,
        shareUrl: `/share/${token}`,
        expiresAt: expiresAt.toISOString(),
      };
    }
  );

  // ---------------------------------------------------------------------------
  // GET /share/people - PROTECTED: Get list of unique takenBy values
  // ---------------------------------------------------------------------------
  app.get(
    "/share/people",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = await getUserId(request, reply);

      // Get all unique takenBy values for this user
      const meds = await db.select({ takenBy: medications.takenBy })
        .from(medications)
        .where(eq(medications.userId, userId));

      const uniquePeople = [...new Set(meds.map((m) => m.takenBy).filter(Boolean))] as string[];

      return { people: uniquePeople };
    }
  );
}
