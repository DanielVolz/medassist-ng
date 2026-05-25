import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/client.js";
import { medications, users } from "../db/schema.js";
import { getAnonymousUserId, requireAuth } from "../plugins/auth.js";
import { env } from "../plugins/env.js";
import { getActiveShareToken } from "../services/share-token-service.js";
import { getThumbFilename } from "../utils/image-upload.js";
import { parseIntakesJson, parseTakenByJson, personTakesMedication } from "../utils/scheduler-utils.js";

type ImageRoutesOptions = {
	imagesDir: string;
};

type ImageQuery = {
	shareToken?: string;
};

const imageFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

function isValidImageFilename(filename: string): boolean {
	return (
		imageFilenamePattern.test(filename) &&
		!filename.includes("/") &&
		!filename.includes("\\") &&
		!filename.includes("..")
	);
}

function getImageContentType(filename: string): string | null {
	const ext = extname(filename).toLowerCase();
	if (ext === ".webp") return "image/webp";
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".png") return "image/png";
	if (ext === ".gif") return "image/gif";
	return null;
}

function getStoredFilenameCandidates(requestedFilename: string): Set<string> {
	const candidates = new Set([requestedFilename]);
	if (requestedFilename.endsWith("-thumb.webp")) {
		candidates.add(requestedFilename.replace(/-thumb\.webp$/, ".webp"));
	}
	return candidates;
}

function matchesStoredImage(storedFilename: string | null | undefined, requestedCandidates: Set<string>): boolean {
	if (!storedFilename) return false;
	if (requestedCandidates.has(storedFilename)) return true;
	return requestedCandidates.has(getThumbFilename(storedFilename));
}

async function getAuthenticatedUserId(request: FastifyRequest, reply: FastifyReply): Promise<number> {
	if (!env.AUTH_ENABLED) {
		return getAnonymousUserId();
	}

	await requireAuth(request, reply);
	const userId = request.user?.id;
	if (typeof userId !== "number") {
		reply.status(401).send({ error: "Authentication required", code: "AUTH_REQUIRED" });
		throw new Error("AUTH_REQUIRED");
	}
	return userId;
}

async function isAuthorizedOwnerImage(userId: number, requestedCandidates: Set<string>): Promise<boolean> {
	const [user] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId));
	if (matchesStoredImage(user?.avatarUrl, requestedCandidates)) {
		return true;
	}

	const ownerMedications = await db
		.select({ imageUrl: medications.imageUrl })
		.from(medications)
		.where(eq(medications.userId, userId));

	return ownerMedications.some((medication) => matchesStoredImage(medication.imageUrl, requestedCandidates));
}

async function isAuthorizedSharedMedicationImage(
	shareToken: string,
	requestedCandidates: Set<string>
): Promise<boolean> {
	const { share, reason } = await getActiveShareToken(shareToken, { touchLastUsed: false });
	if (!share || reason !== "ok") {
		return false;
	}

	const sharedMedications = await db
		.select({
			imageUrl: medications.imageUrl,
			takenByJson: medications.takenByJson,
			intakesJson: medications.intakesJson,
			usageJson: medications.usageJson,
			everyJson: medications.everyJson,
			startJson: medications.startJson,
			intakeRemindersEnabled: medications.intakeRemindersEnabled,
		})
		.from(medications)
		.where(and(eq(medications.userId, share.userId), eq(medications.isObsolete, false)));

	return sharedMedications.some((medication) => {
		if (!matchesStoredImage(medication.imageUrl, requestedCandidates)) {
			return false;
		}

		const takenByArray = parseTakenByJson(medication.takenByJson);
		const intakes = parseIntakesJson(
			medication.intakesJson,
			{
				usageJson: medication.usageJson,
				everyJson: medication.everyJson,
				startJson: medication.startJson,
			},
			medication.intakeRemindersEnabled ?? false
		);
		return personTakesMedication(share.takenBy, takenByArray, intakes);
	});
}

export async function imageRoutes(app: FastifyInstance, options: ImageRoutesOptions) {
	app.get<{ Params: { filename: string }; Querystring: ImageQuery }>("/images/:filename", async (request, reply) => {
		const { filename } = request.params;
		const contentType = getImageContentType(filename);

		if (!isValidImageFilename(filename) || !contentType) {
			return reply.status(400).send({ error: "Invalid image filename", code: "INVALID_IMAGE_FILENAME" });
		}

		const filePath = resolve(options.imagesDir, filename);
		const requestedCandidates = getStoredFilenameCandidates(filename);
		const shareToken = typeof request.query.shareToken === "string" ? request.query.shareToken.trim() : "";

		const authorized = shareToken
			? await isAuthorizedSharedMedicationImage(shareToken, requestedCandidates)
			: await isAuthorizedOwnerImage(await getAuthenticatedUserId(request, reply), requestedCandidates);

		if (!authorized) {
			return reply.status(404).send({ error: "Image not found", code: "IMAGE_NOT_FOUND" });
		}

		if (!existsSync(filePath)) {
			return reply.status(404).send({ error: "Image not found", code: "IMAGE_NOT_FOUND" });
		}

		const fileStat = await stat(filePath);
		reply.header("Cache-Control", "private, no-store");
		reply.header("Content-Length", fileStat.size);
		return reply.type(contentType).send(createReadStream(filePath));
	});
}
