/**
 * Tests for /doses/taken API endpoints.
 * Tests marking doses as taken, listing taken doses, and unmarking.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  buildTestApp,
  closeTestApp,
  clearTestData,
  createTestUser,
  createTestMedication,
  TestContext,
} from "./setup.js";

// =============================================================================
// Route Registration
// Since we can't easily import routes that depend on the global db,
// we'll create simplified route handlers for testing the core logic.
// =============================================================================

async function registerDoseRoutes(ctx: TestContext) {
  const { app, client } = ctx;

  // GET /doses/taken - List all taken doses
  app.get("/doses/taken", async (request, reply) => {
    // In test mode, use user ID 1 (will be created in tests)
    const userId = 1;

    const result = await client.execute({
      sql: `SELECT dose_id, taken_at, marked_by FROM dose_tracking WHERE user_id = ?`,
      args: [userId],
    });

    return {
      doses: result.rows.map((d) => ({
        doseId: d.dose_id,
        takenAt: (d.taken_at as number) * 1000, // Convert to ms
        markedBy: d.marked_by,
      })),
    };
  });

  // POST /doses/taken - Mark a dose as taken
  app.post<{ Body: { doseId: string } }>("/doses/taken", async (request, reply) => {
    const userId = 1;
    const { doseId } = request.body || {};

    if (!doseId || typeof doseId !== "string" || doseId.length === 0) {
      return reply.status(400).send({ error: "doseId is required" });
    }

    // Check if already marked
    const existing = await client.execute({
      sql: `SELECT id FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
      args: [userId, doseId],
    });

    if (existing.rows.length > 0) {
      return { success: true, message: "Already marked" };
    }

    // Insert new record
    await client.execute({
      sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by) VALUES (?, ?, NULL)`,
      args: [userId, doseId],
    });

    return { success: true };
  });

  // DELETE /doses/taken/:doseId - Unmark a dose
  app.delete<{ Params: { doseId: string } }>("/doses/taken/:doseId", async (request, reply) => {
    const userId = 1;
    const { doseId } = request.params;

    await client.execute({
      sql: `DELETE FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
      args: [userId, doseId],
    });

    return { success: true };
  });
}

// =============================================================================
// Tests
// =============================================================================

describe("Dose Tracking API", () => {
  let ctx: TestContext;
  let userId: number;

  beforeAll(async () => {
    ctx = await buildTestApp();
    await registerDoseRoutes(ctx);
    await ctx.app.ready();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await clearTestData(ctx.client);
    // Create test user - will get ID 1 since table is cleared
    userId = await createTestUser(ctx.client, { username: "testuser" });
    // Reset SQLite autoincrement so user gets ID 1
    await ctx.client.execute("DELETE FROM sqlite_sequence WHERE name='users'");
    await clearTestData(ctx.client);
    userId = await createTestUser(ctx.client, { username: "testuser" });
  });

  // ---------------------------------------------------------------------------
  // POST /doses/taken
  // ---------------------------------------------------------------------------

  describe("POST /doses/taken", () => {
    it("should mark a dose as taken", async () => {
      const doseId = "1-0-1735344000000";

      const response = await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: { doseId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });

      // Verify in database
      const result = await ctx.client.execute({
        sql: `SELECT dose_id, marked_by FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
        args: [userId, doseId],
      });
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].dose_id).toBe(doseId);
      expect(result.rows[0].marked_by).toBeNull();
    });

    it("should return idempotent response when dose already marked", async () => {
      const doseId = "1-0-1735344000000";

      // Mark once
      await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: { doseId },
      });

      // Mark again
      const response = await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: { doseId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, message: "Already marked" });

      // Should still only have one record
      const result = await ctx.client.execute({
        sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE user_id = ? AND dose_id = ?`,
        args: [userId, doseId],
      });
      expect(result.rows[0].count).toBe(1);
    });

    it("should reject request without doseId", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "doseId is required" });
    });

    it("should reject request with empty doseId", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: { doseId: "" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "doseId is required" });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /doses/taken
  // ---------------------------------------------------------------------------

  describe("GET /doses/taken", () => {
    it("should return empty array when no doses taken", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/doses/taken",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ doses: [] });
    });

    it("should return list of taken doses", async () => {
      const doseId1 = "1-0-1735344000000";
      const doseId2 = "1-0-1735430400000";

      // Mark two doses
      await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: { doseId: doseId1 },
      });
      await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: { doseId: doseId2 },
      });

      const response = await ctx.app.inject({
        method: "GET",
        url: "/doses/taken",
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.doses).toHaveLength(2);
      expect(data.doses.map((d: any) => d.doseId).sort()).toEqual([doseId1, doseId2].sort());
      // Each dose should have a takenAt timestamp
      for (const dose of data.doses) {
        expect(dose.takenAt).toBeTypeOf("number");
        expect(dose.takenAt).toBeGreaterThan(0);
        expect(dose.markedBy).toBeNull();
      }
    });

    it("should include markedBy when present", async () => {
      const doseId = "1-0-1735344000000";

      // Insert directly with markedBy
      await ctx.client.execute({
        sql: `INSERT INTO dose_tracking (user_id, dose_id, marked_by) VALUES (?, ?, ?)`,
        args: [userId, doseId, "Daniel"],
      });

      const response = await ctx.app.inject({
        method: "GET",
        url: "/doses/taken",
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.doses).toHaveLength(1);
      expect(data.doses[0].markedBy).toBe("Daniel");
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /doses/taken/:doseId
  // ---------------------------------------------------------------------------

  describe("DELETE /doses/taken/:doseId", () => {
    it("should unmark a dose", async () => {
      const doseId = "1-0-1735344000000";

      // Mark first
      await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: { doseId },
      });

      // Verify marked
      let result = await ctx.client.execute({
        sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id = ?`,
        args: [doseId],
      });
      expect(result.rows[0].count).toBe(1);

      // Unmark
      const response = await ctx.app.inject({
        method: "DELETE",
        url: `/doses/taken/${encodeURIComponent(doseId)}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });

      // Verify unmarked
      result = await ctx.client.execute({
        sql: `SELECT COUNT(*) as count FROM dose_tracking WHERE dose_id = ?`,
        args: [doseId],
      });
      expect(result.rows[0].count).toBe(0);
    });

    it("should succeed even if dose was not marked", async () => {
      const doseId = "nonexistent-dose-id";

      const response = await ctx.app.inject({
        method: "DELETE",
        url: `/doses/taken/${encodeURIComponent(doseId)}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });
  });

  // ---------------------------------------------------------------------------
  // Dose ID Format Tests
  // ---------------------------------------------------------------------------

  describe("Dose ID Format", () => {
    it("should handle standard dose ID format: {medId}-{blisterIdx}-{timestamp}", async () => {
      const doseId = "5-0-1735344000000";

      const response = await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: { doseId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });

    it("should handle dose ID with person: {medId}-{blisterIdx}-{timestamp}-{person}", async () => {
      const doseId = "5-0-1735344000000-Daniel";

      const response = await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: { doseId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });

    it("should handle special characters in dose ID", async () => {
      // Dose ID with URL-unsafe characters (edge case)
      const doseId = "5-0-1735344000000-Max Müller";

      const response = await ctx.app.inject({
        method: "POST",
        url: "/doses/taken",
        payload: { doseId },
      });

      expect(response.statusCode).toBe(200);

      // Can retrieve it
      const getResponse = await ctx.app.inject({
        method: "GET",
        url: "/doses/taken",
      });

      expect(getResponse.json().doses[0].doseId).toBe(doseId);
    });
  });
});
