import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createClient, Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// Create test database and mocks before anything else (hoisted)
const { testClient, testDb, mockSendMail, mockSendShoutrrr, mockUpdateReminderSentTime, mockUpdateUserReminderSentTime } = vi.hoisted(() => {
  const { createClient } = require("@libsql/client");
  const { drizzle } = require("drizzle-orm/libsql");
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);
  return { 
    testClient: client, 
    testDb: db,
    mockSendMail: vi.fn(),
    mockSendShoutrrr: vi.fn(),
    mockUpdateReminderSentTime: vi.fn(),
    mockUpdateUserReminderSentTime: vi.fn(),
  };
});

// Mock nodemailer
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

// Mock the db module
vi.mock("../db/client.js", () => ({
  db: testDb,
  migrationsReady: Promise.resolve(),
}));

// Mock env to disable auth
vi.mock("../plugins/env.js", () => ({
  env: {
    AUTH_ENABLED: false,
    JWT_SECRET: "test-secret-key-for-testing",
    JWT_REFRESH_SECRET: "test-refresh-secret-key",
  },
}));

// Mock auth plugin
vi.mock("../plugins/auth.js", () => ({
  requireAuth: async () => {},
  getAnonymousUserId: () => 999999999,
}));

// Mock reminder-scheduler
vi.mock("../services/reminder-scheduler.js", () => ({
  updateReminderSentTime: mockUpdateReminderSentTime,
  updateUserReminderSentTime: mockUpdateUserReminderSentTime,
}));

// Mock sendShoutrrrNotification from settings
vi.mock("../routes/settings.js", async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    sendShoutrrrNotification: mockSendShoutrrr,
  };
});

import { plannerRoutes } from "../routes/planner.js";

// =============================================================================
// Test Setup
// =============================================================================

async function createSchema(client: Client) {
  const tableCreations = [
    `CREATE TABLE IF NOT EXISTS users (
      id integer PRIMARY KEY AUTOINCREMENT,
      username text NOT NULL UNIQUE,
      password_hash text,
      auth_provider text NOT NULL DEFAULT 'local',
      is_active integer NOT NULL DEFAULT 1,
      created_at integer NOT NULL DEFAULT (strftime('%s','now')),
      updated_at integer NOT NULL DEFAULT (strftime('%s','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS user_settings (
      id integer PRIMARY KEY AUTOINCREMENT,
      user_id integer NOT NULL UNIQUE,
      email_enabled integer NOT NULL DEFAULT 0,
      notification_email text,
      email_stock_reminders integer NOT NULL DEFAULT 1,
      email_intake_reminders integer NOT NULL DEFAULT 1,
      shoutrrr_enabled integer NOT NULL DEFAULT 0,
      shoutrrr_url text,
      shoutrrr_stock_reminders integer NOT NULL DEFAULT 1,
      shoutrrr_intake_reminders integer NOT NULL DEFAULT 1,
      reminder_days_before integer NOT NULL DEFAULT 7,
      repeat_daily_reminders integer NOT NULL DEFAULT 0,
      low_stock_days integer NOT NULL DEFAULT 30,
      normal_stock_days integer NOT NULL DEFAULT 90,
      high_stock_days integer NOT NULL DEFAULT 180,
      expiry_warning_days integer NOT NULL DEFAULT 90,
      language text NOT NULL DEFAULT 'en',
      stock_calculation_mode text NOT NULL DEFAULT 'automatic',
      last_auto_email_sent text,
      last_notification_type text,
      last_notification_channel text,
      updated_at integer NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  ];

  for (const sql of tableCreations) {
    await client.execute(sql);
  }
}

async function clearData(client: Client) {
  await client.execute("DELETE FROM user_settings");
  await client.execute("DELETE FROM users");
  await client.execute("DELETE FROM sqlite_sequence");
}

describe("Planner Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await createSchema(testClient);
  });

  beforeEach(async () => {
    await clearData(testClient);
    
    // Create anonymous user
    await testClient.execute(
      "INSERT INTO users (id, username, auth_provider) VALUES (999999999, '__anonymous__', 'anonymous')"
    );

    app = Fastify({ logger: false });
    await app.register(plannerRoutes);
    await app.ready();
    
    vi.clearAllMocks();
    mockSendMail.mockReset();
    mockSendShoutrrr.mockReset();
  });

  afterAll(async () => {
    await app?.close();
    testClient.close();
  });

  describe("POST /planner/send-email", () => {
    it("should reject request with missing email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/planner/send-email",
        payload: {
          from: "2025-01-01",
          until: "2025-01-31",
          rows: [{ medicationName: "Test", totalPills: 10, plannerUsage: 5, enough: true }],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Missing email or planner data" });
    });

    it("should reject request with missing rows", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/planner/send-email",
        payload: {
          email: "test@example.com",
          from: "2025-01-01",
          until: "2025-01-31",
          rows: [],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Missing email or planner data" });
    });

    it("should reject when SMTP is not configured", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/planner/send-email",
        payload: {
          email: "test@example.com",
          from: "2025-01-01",
          until: "2025-01-31",
          rows: [
            {
              medicationId: 1,
              medicationName: "Aspirin",
              totalPills: 30,
              plannerUsage: 10,
              blisterSize: 10,
              blistersNeeded: 1,
              fullBlisters: 3,
              loosePills: 0,
              enough: true,
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "SMTP not configured" });
    });

    it("should send email successfully when SMTP is configured", async () => {
      // Set SMTP env vars
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_USER = "user@test.com";
      process.env.SMTP_PASS = "password";

      mockSendMail.mockResolvedValueOnce({ messageId: "123" });

      const response = await app.inject({
        method: "POST",
        url: "/planner/send-email",
        payload: {
          email: "test@example.com",
          from: "2025-01-01",
          until: "2025-01-31",
          language: "en",
          rows: [
            {
              medicationId: 1,
              medicationName: "Aspirin",
              totalPills: 30,
              plannerUsage: 10,
              blisterSize: 10,
              blistersNeeded: 1,
              fullBlisters: 3,
              loosePills: 0,
              enough: true,
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, message: "Email sent successfully" });
      expect(mockSendMail).toHaveBeenCalledTimes(1);

      // Cleanup
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });

    it("should handle email with out of stock medications", async () => {
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_USER = "user@test.com";
      process.env.SMTP_PASS = "password";

      mockSendMail.mockResolvedValueOnce({ messageId: "123" });

      const response = await app.inject({
        method: "POST",
        url: "/planner/send-email",
        payload: {
          email: "test@example.com",
          from: "2025-01-01",
          until: "2025-01-31",
          rows: [
            {
              medicationId: 1,
              medicationName: "Aspirin",
              totalPills: 5,
              plannerUsage: 30,
              blisterSize: 10,
              blistersNeeded: 3,
              fullBlisters: 0,
              loosePills: 5,
              enough: false,
            },
            {
              medicationId: 2,
              medicationName: "Ibuprofen",
              totalPills: 100,
              plannerUsage: 10,
              blisterSize: 10,
              blistersNeeded: 1,
              fullBlisters: 10,
              loosePills: 0,
              enough: true,
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      
      // Check that HTML contains out of stock warning
      const mailCall = mockSendMail.mock.calls[0][0];
      expect(mailCall.html).toContain("Out of Stock");
      expect(mailCall.html).toContain("1 medication");

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });

    it("should handle SMTP error gracefully", async () => {
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_USER = "user@test.com";
      process.env.SMTP_PASS = "password";

      mockSendMail.mockRejectedValueOnce(new Error("Connection refused"));

      const response = await app.inject({
        method: "POST",
        url: "/planner/send-email",
        payload: {
          email: "test@example.com",
          from: "2025-01-01",
          until: "2025-01-31",
          rows: [
            {
              medicationId: 1,
              medicationName: "Aspirin",
              totalPills: 30,
              plannerUsage: 10,
              blisterSize: 10,
              blistersNeeded: 1,
              fullBlisters: 3,
              loosePills: 0,
              enough: true,
            },
          ],
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("Failed to send email");
      expect(response.json().error).toContain("Connection refused");

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });

    it("should use German locale when language is de", async () => {
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_USER = "user@test.com";
      process.env.SMTP_PASS = "password";

      mockSendMail.mockResolvedValueOnce({ messageId: "123" });

      const response = await app.inject({
        method: "POST",
        url: "/planner/send-email",
        payload: {
          email: "test@example.com",
          from: "2025-01-15",
          until: "2025-02-15",
          language: "de",
          rows: [
            {
              medicationId: 1,
              medicationName: "Aspirin",
              totalPills: 30,
              plannerUsage: 10,
              blisterSize: 10,
              blistersNeeded: 1,
              fullBlisters: 3,
              loosePills: 0,
              enough: true,
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      
      // German date format should be used
      const mailCall = mockSendMail.mock.calls[0][0];
      expect(mailCall.subject).toContain("Supply Overview");

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });
  });

  describe("POST /reminder/send-email", () => {
    it("should reject request with missing lowStock data", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Missing low stock data" });
    });

    it("should reject request with no lowStock array", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Missing low stock data" });
    });

    it("should return error when no notification channels configured", async () => {
      // User settings exist but email/shoutrrr disabled
      await testClient.execute({
        sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 0, 0, 'en')`,
        args: [999999999],
      });

      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [
            { name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "No notification channels configured" });
    });

    it("should send email reminder when email is enabled", async () => {
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_USER = "user@test.com";
      process.env.SMTP_PASS = "password";

      // Enable email in user settings
      await testClient.execute({
        sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
        args: [999999999],
      });

      mockSendMail.mockResolvedValueOnce({ messageId: "123" });

      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [
            { name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, message: "Reminder sent via email" });
      expect(mockSendMail).toHaveBeenCalledTimes(1);

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });

    it("should handle empty medications (medsLeft <= 0)", async () => {
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_USER = "user@test.com";
      process.env.SMTP_PASS = "password";

      await testClient.execute({
        sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
        args: [999999999],
      });

      mockSendMail.mockResolvedValueOnce({ messageId: "123" });

      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [
            { name: "Aspirin", medsLeft: 0, daysLeft: 0, depletionDate: null },
            { name: "Ibuprofen", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      
      // Check email contains EMPTY warning
      const mailCall = mockSendMail.mock.calls[0][0];
      expect(mailCall.subject).toContain("Empty");
      expect(mailCall.html).toContain("EMPTY");

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });

    it("should handle mixed empty and low stock medications", async () => {
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_USER = "user@test.com";
      process.env.SMTP_PASS = "password";

      await testClient.execute({
        sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
        args: [999999999],
      });

      mockSendMail.mockResolvedValueOnce({ messageId: "123" });

      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [
            { name: "Aspirin", medsLeft: 0, daysLeft: 0, depletionDate: null },
            { name: "Ibuprofen", medsLeft: 10, daysLeft: 5, depletionDate: "2025-01-05" },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      
      const mailCall = mockSendMail.mock.calls[0][0];
      expect(mailCall.subject).toContain("Empty");
      expect(mailCall.subject).toContain("Running Low");

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });

    it("should handle email error gracefully", async () => {
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_USER = "user@test.com";
      process.env.SMTP_PASS = "password";

      await testClient.execute({
        sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, language) VALUES (?, 1, 0, 'en')`,
        args: [999999999],
      });

      mockSendMail.mockRejectedValueOnce(new Error("SMTP error"));

      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [
            { name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" },
          ],
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("Email:");

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });

    it("should send push notification when shoutrrr is enabled", async () => {
      await testClient.execute({
        sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
        args: [999999999],
      });

      mockSendShoutrrr.mockResolvedValueOnce({ success: true });

      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [
            { name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, message: "Reminder sent via push" });
      expect(mockSendShoutrrr).toHaveBeenCalledTimes(1);
    });

    it("should send both email and push when both enabled", async () => {
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_USER = "user@test.com";
      process.env.SMTP_PASS = "password";

      await testClient.execute({
        sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 1, 1, 'ntfy://localhost/test', 'en')`,
        args: [999999999],
      });

      mockSendMail.mockResolvedValueOnce({ messageId: "123" });
      mockSendShoutrrr.mockResolvedValueOnce({ success: true });

      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [
            { name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, message: "Reminder sent via email and push" });
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendShoutrrr).toHaveBeenCalledTimes(1);

      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });

    it("should handle push notification error gracefully", async () => {
      await testClient.execute({
        sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
        args: [999999999],
      });

      mockSendShoutrrr.mockResolvedValueOnce({ success: false, error: "Connection failed" });

      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [
            { name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" },
          ],
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("Push:");
    });

    it("should handle push with empty meds using German translations", async () => {
      await testClient.execute({
        sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'de')`,
        args: [999999999],
      });

      mockSendShoutrrr.mockResolvedValueOnce({ success: true });

      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [
            { name: "Aspirin", medsLeft: 0, daysLeft: 0, depletionDate: null },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockSendShoutrrr).toHaveBeenCalledTimes(1);
      
      // Check German translations are used
      const [title, message] = mockSendShoutrrr.mock.calls[0].slice(1);
      expect(title).toContain("Leer");
    });

    it("should handle push exception gracefully", async () => {
      await testClient.execute({
        sql: `INSERT INTO user_settings (user_id, email_enabled, shoutrrr_enabled, shoutrrr_url, language) VALUES (?, 0, 1, 'ntfy://localhost/test', 'en')`,
        args: [999999999],
      });

      mockSendShoutrrr.mockRejectedValueOnce(new Error("Network error"));

      const response = await app.inject({
        method: "POST",
        url: "/reminder/send-email",
        payload: {
          email: "test@example.com",
          lowStock: [
            { name: "Aspirin", medsLeft: 5, daysLeft: 3, depletionDate: "2025-01-03" },
          ],
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("Push:");
      expect(response.json().error).toContain("Network error");
    });
  });
});
