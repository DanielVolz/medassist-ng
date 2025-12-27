import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "crypto";
import { db } from "../db/client.js";
import { medications, shareTokens } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, optionalAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import type { AuthUser } from "../types/fastify.js";

// =============================================================================
// Validation Schemas
// =============================================================================
const createShareSchema = z.object({
  takenBy: z.string().min(1, "takenBy is required"),
  scheduleDays: z.number().int().min(1).max(365).default(30),
});

// Helper to get user ID from request
// Returns a default user ID when auth is disabled
function getUserId(request: any, reply: any): number {
  // If auth is disabled, use a default user ID (1)
  if (!env.AUTH_ENABLED) {
    return 1;
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
      return reply.notFound("Share link not found");
    }

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
        blisters,
      };
    });

    return {
      takenBy: share.takenBy,
      scheduleDays: share.scheduleDays,
      medications: medicationsWithBlisters,
    };
  });

  // ---------------------------------------------------------------------------
  // POST /share - PROTECTED: Create a new share link
  // ---------------------------------------------------------------------------
  app.post<{ Body: z.infer<typeof createShareSchema> }>(
    "/share",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = getUserId(request, reply);

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

      // Create share token
      await db.insert(shareTokens).values({
        userId: userId,
        token,
        takenBy,
        scheduleDays,
      });

      return {
        token,
        shareUrl: `/share/${token}`,
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
      const userId = getUserId(request, reply);

      // Get all unique takenBy values for this user
      const meds = await db.select({ takenBy: medications.takenBy })
        .from(medications)
        .where(eq(medications.userId, userId));

      const uniquePeople = [...new Set(meds.map((m) => m.takenBy).filter(Boolean))] as string[];

      return { people: uniquePeople };
    }
  );
}
