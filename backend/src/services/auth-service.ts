import argon2, { type HashOptions } from "argon2";

// Keep the same Argon2id work factor for credentials and enumeration-resistant dummy work.
const ARGON2_OPTIONS: HashOptions = {
	type: argon2.argon2id,
	memoryCost: 65536,
	timeCost: 3,
	parallelism: 4,
	hashLength: 32,
};

export function hashPassword(password: string): Promise<string> {
	return argon2.hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	return argon2.verify(passwordHash, password);
}

export async function performDummyCredentialWork(): Promise<void> {
	await hashPassword("dummy");
}
