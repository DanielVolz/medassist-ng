import { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    smtpConfigured: Boolean(process.env.SMTP_HOST),
    shoutrrrConfigured: Boolean(process.env.SHOUTRRR_URL),
  }));
}
