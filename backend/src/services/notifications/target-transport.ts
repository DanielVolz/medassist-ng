import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

const localhostNotificationUrlError = "Localhost URLs are not allowed";
const privateNotificationIpError = "Private IP addresses are not allowed";
const internalNotificationHostnameError = "Internal hostnames are not allowed";
const resolvedPrivateNotificationTargetError = "Notification target resolves to a private IP address";
const unresolvedNotificationTargetError = "Notification target hostname could not be resolved";

function normalizeNotificationHostname(hostnameRaw: string): string {
	const trimmed = hostnameRaw.trim().toLowerCase().replace(/\.$/, "");
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseIpv4Address(hostname: string): [number, number, number, number] | null {
	const match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (!match) return null;

	const octets = match.slice(1).map(Number);
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return null;
	}

	return octets as [number, number, number, number];
}

function getRestrictedIpv4AddressError(address: [number, number, number, number]): string | null {
	const [a, b] = address;

	if (a === 127) {
		return localhostNotificationUrlError;
	}

	if (
		a === 0 ||
		a === 10 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		a >= 224
	) {
		return privateNotificationIpError;
	}

	return null;
}

function parseIpv4MappedIpv6(hostname: string): [number, number, number, number] | null {
	if (!hostname.startsWith("::ffff:")) return null;

	const mapped = hostname.slice("::ffff:".length);
	const dotted = parseIpv4Address(mapped);
	if (dotted) return dotted;

	const groups = mapped.split(":");
	if (groups.length !== 2) return null;

	const [high, low] = groups.map((group) => Number.parseInt(group, 16));
	if ([high, low].some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) {
		return null;
	}

	return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
}

function getRestrictedIpv6AddressError(hostname: string): string | null {
	if (hostname === "::" || hostname === "::1") {
		return localhostNotificationUrlError;
	}

	const mappedIpv4 = parseIpv4MappedIpv6(hostname);
	if (mappedIpv4) {
		return getRestrictedIpv4AddressError(mappedIpv4);
	}

	if (
		hostname.startsWith("fc") ||
		hostname.startsWith("fd") ||
		hostname.startsWith("fe8") ||
		hostname.startsWith("fe9") ||
		hostname.startsWith("fea") ||
		hostname.startsWith("feb") ||
		hostname.startsWith("ff")
	) {
		return privateNotificationIpError;
	}

	return null;
}

export function validateNotificationHostname(hostnameRaw: string): string | null {
	const hostname = normalizeNotificationHostname(hostnameRaw);

	if (!hostname) {
		return "Invalid notification hostname";
	}

	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		return localhostNotificationUrlError;
	}

	const ipv4Address = parseIpv4Address(hostname);
	if (ipv4Address) {
		return getRestrictedIpv4AddressError(ipv4Address);
	}

	if (isIP(hostname) === 6) {
		return getRestrictedIpv6AddressError(hostname);
	}

	if (
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal") ||
		hostname.endsWith(".lan") ||
		hostname === "metadata.google.internal"
	) {
		return internalNotificationHostnameError;
	}

	return null;
}

export async function validateNotificationTargetUrl(
	urlStr: string,
	options: { allowLocalNtfyTarget?: boolean } = {}
): Promise<string | null> {
	const result = await resolveNotificationTargetUrl(urlStr, options);
	return "error" in result ? result.error : null;
}

async function resolveNotificationTargetUrl(
	urlStr: string,
	options: { allowLocalNtfyTarget?: boolean } = {}
): Promise<{ target: URL; addresses: LookupAddress[] } | { error: string }> {
	try {
		const parsed = new URL(urlStr);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return { error: "Only HTTP/HTTPS protocols are allowed" };
		}
		if (parsed.username || parsed.password || parsed.hash) {
			return { error: "Invalid notification target URL" };
		}
		const hostnameError = validateNotificationHostname(parsed.hostname);
		if (hostnameError && !options.allowLocalNtfyTarget) {
			return { error: hostnameError };
		}

		const hostname = normalizeNotificationHostname(parsed.hostname);
		const addressFamily = isIP(hostname);
		if (addressFamily) {
			return { target: parsed, addresses: [{ address: hostname, family: addressFamily }] };
		}

		const addresses = await lookup(hostname, { all: true, verbatim: true });
		if (addresses.length === 0) {
			return { error: unresolvedNotificationTargetError };
		}
		for (const { address, family } of addresses) {
			// DNS results must be literal IPs, even for the intentional private ntfy exception.
			if (!isIP(address) || isIP(address) !== family) {
				return { error: unresolvedNotificationTargetError };
			}
			// Canonicalize IPv6 so expanded loopback/mapped-private answers cannot bypass the policy.
			const literal = family === 6 ? new URL(`http://[${address}]/`).hostname : address;
			const addressError = validateNotificationHostname(literal);
			if (addressError && !options.allowLocalNtfyTarget) {
				return { error: resolvedPrivateNotificationTargetError };
			}
		}

		return { target: parsed, addresses };
	} catch {
		return { error: unresolvedNotificationTargetError };
	}
}

function createPinnedLookup(addresses: LookupAddress[]): LookupFunction {
	return (_hostname, options, callback) => {
		const matchingAddresses = options.family ? addresses.filter(({ family }) => family === options.family) : addresses;
		const firstAddress = matchingAddresses[0];
		if (!firstAddress) {
			const error = Object.assign(new Error(unresolvedNotificationTargetError), { code: "ENOTFOUND" });
			callback(error, "", 0);
			return;
		}

		if (options.all) {
			callback(null, matchingAddresses);
			return;
		}

		callback(null, firstAddress.address, firstAddress.family);
	};
}

export async function createNotificationTargetDispatcher(
	urlStr: string,
	options: { allowLocalNtfyTarget?: boolean } = {}
): Promise<{ target: URL; dispatcher: Agent } | { error: string }> {
	const result = await resolveNotificationTargetUrl(urlStr, options);
	if ("error" in result) {
		return result;
	}

	return {
		target: result.target,
		// Keep the original URL hostname for Host, TLS SNI and certificate verification.
		// Only the socket lookup is replaced; there is no second DNS resolution.
		dispatcher: new Agent({
			connect: { lookup: createPinnedLookup(result.addresses) },
			maxResponseSize: 64 * 1024,
		}),
	};
}
