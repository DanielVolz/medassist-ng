import { existsSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import sharp from "sharp";

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

export function getThumbFilename(imageFilename: string): string {
	const ext = extname(imageFilename);
	const base = ext ? imageFilename.slice(0, -ext.length) : imageFilename;
	return `${base}-thumb.webp`;
}

export function removeImageFiles(imagesDir: string, imageFilename: string): void {
	const fullPath = resolve(imagesDir, imageFilename);
	if (existsSync(fullPath)) unlinkSync(fullPath);

	const thumbFilename = getThumbFilename(imageFilename);
	if (thumbFilename !== imageFilename) {
		const thumbPath = resolve(imagesDir, thumbFilename);
		if (existsSync(thumbPath)) unlinkSync(thumbPath);
	}
}

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let totalSize = 0;

	for await (const chunk of stream) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		totalSize += buffer.length;
		if (totalSize > MAX_IMAGE_UPLOAD_BYTES) {
			throw new Error("IMAGE_TOO_LARGE");
		}
		chunks.push(buffer);
	}

	return Buffer.concat(chunks);
}

export async function writeOptimizedImageSet(
	imagesDir: string,
	filePrefix: string,
	uploadBuffer: Buffer,
	options?: {
		maxEdgePx?: number;
		thumbSizePx?: number;
		fullQuality?: number;
		thumbQuality?: number;
	}
): Promise<{ filename: string; thumbFilename: string }> {
	const maxEdgePx = options?.maxEdgePx ?? 1600;
	const thumbSizePx = options?.thumbSizePx ?? 96;
	const fullQuality = options?.fullQuality ?? 82;
	const thumbQuality = options?.thumbQuality ?? 76;

	const filename = `${filePrefix}-${Date.now()}.webp`;
	const thumbFilename = getThumbFilename(filename);

	const filepath = resolve(imagesDir, filename);
	const thumbFilepath = resolve(imagesDir, thumbFilename);

	const optimizedBuffer = await sharp(uploadBuffer, { failOn: "error" })
		.rotate()
		.resize({ width: maxEdgePx, height: maxEdgePx, fit: "inside", withoutEnlargement: true })
		.webp({ quality: fullQuality })
		.toBuffer();

	const thumbBuffer = await sharp(uploadBuffer, { failOn: "error" })
		.rotate()
		.resize({ width: thumbSizePx, height: thumbSizePx, fit: "cover", position: "attention" })
		.webp({ quality: thumbQuality })
		.toBuffer();

	await writeFile(filepath, optimizedBuffer);
	await writeFile(thumbFilepath, thumbBuffer);

	return { filename, thumbFilename };
}
