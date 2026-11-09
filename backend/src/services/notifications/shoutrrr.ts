import { execFile } from "node:child_process";
import { buildGenericNotificationRequest } from "../settings-service.js";
import {
	isNtfyNotificationUrl,
	type PushNotificationOptions,
	renderNotificationActionPayload,
} from "./action-renderer.js";
import { sendNativePush } from "./native-push.js";

export async function sendShoutrrrNotification(
	url: string,
	title: string,
	message: string,
	options: PushNotificationOptions = {}
): Promise<{ success: boolean; error?: string; providerMessageId?: string }> {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.toLowerCase();
		const http = ["http:", "https:"].includes(parsed.protocol);
		const discord =
			http && ["discord.com", "discordapp.com"].includes(hostname) && parsed.pathname.startsWith("/api/webhooks/");
		const slack = http && (hostname === "hooks.slack.com" || hostname.endsWith(".hooks.slack.com"));
		if (
			isNtfyNotificationUrl(url) ||
			(http && !discord && !slack && hostname !== "api.telegram.org" && !hostname.includes("gotify"))
		) {
			return sendNativePush(url, title, message, options);
		}
		message = renderNotificationActionPayload(url, message, options).message;
		if (discord) {
			const [, , , id, token] = parsed.pathname.split("/");
			url = `discord://${encodeURIComponent(token ?? "")}@${id ?? ""}${parsed.search}`;
		} else if (http) {
			// Preserve legacy JSON webhook payload through the library's Generic template.
			parsed.searchParams.set("template", "json");
			parsed.searchParams.set("$text", `${title}\n\n${message}`);
			url = `generic+${parsed.toString()}`;
		} else if (parsed.protocol === "generic:") {
			// Keep existing authority/framing/method restrictions; the Go library owns delivery.
			const request = buildGenericNotificationRequest(url, title, message);
			if ("error" in request) return { success: false, error: request.error };
			const normalized = new URLSearchParams();
			for (const [key, value] of parsed.searchParams) {
				if (key.startsWith("@")) continue;
				const lower = key.toLowerCase();
				const property = "contenttype disabletls method messagekey template title titlekey".split(" ").includes(lower);
				if (property && normalized.has(lower)) continue;
				normalized.append(property ? lower : key, value);
			}
			normalized.set("method", request.method);
			if (request.template) normalized.set("template", request.template);
			parsed.search = normalized.toString();
			for (const [key, value] of Object.entries(request.headers)) parsed.searchParams.set(`@${key}`, value);
			url = parsed.toString();
		}
		const input = JSON.stringify({ url, title, message });
		if (Buffer.byteLength(input) > 262144) return { success: false, error: "Shoutrrr: input_too_large" };
		return await new Promise((resolve) => {
			const child = execFile(
				process.env.SHOUTRRR_BINARY_PATH || "/usr/local/bin/medassist-shoutrrr",
				[],
				{ timeout: 15000, killSignal: "SIGKILL", maxBuffer: 4096, env: {}, windowsHide: true },
				(error, stdout) => {
					if (error) {
						let message = "Shoutrrr: bridge_failed";
						if (error.code === "ENOENT")
							message = "Shoutrrr bridge missing: build or set SHOUTRRR_BINARY_PATH; see docs/DEVELOPMENT.md";
						resolve({ success: false, error: message });
						return;
					}
					try {
						const result = JSON.parse(stdout);
						const safeError =
							/^(invalid_input|invalid_url|unsupported_provider|target_blocked|dns_failed|request_failed|http_failed|send_failed|bridge_failed)$/.test(
								result.error
							);
						if (result.success === true) resolve({ success: true });
						else
							resolve({
								success: false,
								error: `Shoutrrr: ${safeError ? result.error : "bridge_failed"}${Number.isInteger(result.status) && result.status >= 100 && result.status <= 599 ? ` (HTTP ${result.status})` : ""}`,
							});
					} catch {
						resolve({ success: false, error: "Shoutrrr: bridge_failed" });
					}
				}
			);
			child.stdin?.on("error", () => {}); // execFile callback reports early exit; never log stdin secrets.
			child.stdin?.end(input);
		});
	} catch {
		return { success: false, error: "Shoutrrr: invalid_url" };
	}
}
