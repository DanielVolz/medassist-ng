import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getThumbFilename,
	MAX_IMAGE_UPLOAD_BYTES,
	removeImageFiles,
	streamToBuffer,
	writeOptimizedImageSet,
} from "../utils/image-upload";

describe("image-upload utils", () => {
	const MOCK_TIMESTAMP_MS = 1_700_000_000_000;
	const tempDirs: string[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("builds thumb filename with and without extension", () => {
		expect(getThumbFilename("avatar.png")).toBe("avatar-thumb.webp");
		expect(getThumbFilename("avatar")).toBe("avatar-thumb.webp");
	});

	it("removes original and thumb files when they exist", () => {
		const imagesDir = mkdtempSync(join(tmpdir(), "medassist-image-upload-"));
		tempDirs.push(imagesDir);

		const imageFilename = "profile.webp";
		const imagePath = join(imagesDir, imageFilename);
		const thumbPath = join(imagesDir, getThumbFilename(imageFilename));
		writeFileSync(imagePath, Buffer.from("image"));
		writeFileSync(thumbPath, Buffer.from("thumb"));

		removeImageFiles(imagesDir, imageFilename);

		expect(() => readFileSync(imagePath)).toThrow();
		expect(() => readFileSync(thumbPath)).toThrow();
	});

	it("buffers stream chunks and rejects payloads above max size", async () => {
		const stream = Readable.from([Buffer.from("hello"), Buffer.from("world")]);
		await expect(streamToBuffer(stream)).resolves.toEqual(Buffer.from("helloworld"));

		const oversized = Readable.from([Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1)]);
		await expect(streamToBuffer(oversized)).rejects.toThrow("IMAGE_TOO_LARGE");
	});

	it("writes optimized full and thumbnail webp variants", async () => {
		const imagesDir = mkdtempSync(join(tmpdir(), "medassist-image-upload-"));
		tempDirs.push(imagesDir);
		vi.spyOn(Date, "now").mockReturnValue(MOCK_TIMESTAMP_MS);

		const uploadBuffer = await sharp({
			create: {
				width: 64,
				height: 48,
				channels: 3,
				background: { r: 255, g: 0, b: 0 },
			},
		})
			.png()
			.toBuffer();

		const result = await writeOptimizedImageSet(imagesDir, "med-42", uploadBuffer, {
			maxEdgePx: 32,
			thumbSizePx: 16,
		});

		expect(result.filename).toBe("med-42-1700000000000.webp");
		expect(result.thumbFilename).toBe("med-42-1700000000000-thumb.webp");

		const optimizedMeta = await sharp(join(imagesDir, result.filename)).metadata();
		const thumbMeta = await sharp(join(imagesDir, result.thumbFilename)).metadata();
		expect(optimizedMeta.format).toBe("webp");
		expect(thumbMeta.format).toBe("webp");
		expect(Math.max(optimizedMeta.width ?? 0, optimizedMeta.height ?? 0)).toBeLessThanOrEqual(32);
		expect(thumbMeta.width).toBe(16);
		expect(thumbMeta.height).toBe(16);
	});
});
