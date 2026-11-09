import { sanitizeNotificationUrl } from "../settings-service.js";
import { type PushNotificationOptions, renderNotificationActionPayload } from "./action-renderer.js";
import { createNotificationTargetDispatcher } from "./target-transport.js";

export async function sendNativePush(
	urlStr: string,
	title: string,
	message: string,
	options: PushNotificationOptions = {}
): Promise<{ success: boolean; error?: string; providerMessageId?: string }> {
	try {
		const validation = sanitizeNotificationUrl(urlStr);
		if ("error" in validation) return { success: false, error: validation.error };
		const { url: targetUrl, isNtfy, auth } = validation;
		const renderedPayload = renderNotificationActionPayload(urlStr, message, options);
		const cleanTitle = title
			.replace(
				/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{2000}-\u{206F}]|⚠|️/gu,
				""
			)
			.trim();
		let headers: Record<string, string> = {
			Title: `=?UTF-8?B?${Buffer.from(cleanTitle, "utf-8").toString("base64")}?=`,
			Tags: "pill",
		};
		if (auth) headers.Authorization = `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString("base64")}`;
		if (isNtfy) headers = { ...headers, ...renderedPayload.headers };
		const targetResult = await createNotificationTargetDispatcher(targetUrl, {
			allowLocalNtfyTarget: isNtfy,
		});
		if ("error" in targetResult) return { success: false, error: targetResult.error };
		const { target, dispatcher } = targetResult;
		try {
			// Like Generic notifications, request never follows redirects and uses only pinned DNS answers.
			const response = await dispatcher.request({
				origin: target.origin,
				path: `${target.pathname}${target.search}`,
				method: "POST",
				headers,
				body: renderedPayload.message,
				headersTimeout: 10_000,
				bodyTimeout: 10_000,
			});
			if (response.statusCode < 200 || response.statusCode >= 300) {
				const errorText = await response.body.text();
				return { success: false, error: `HTTP ${response.statusCode}: ${errorText}` };
			}
			let providerMessageId: string | undefined;
			if (isNtfy) {
				try {
					const payload = (await response.body.json()) as { id?: unknown };
					providerMessageId = typeof payload.id === "string" && payload.id.length > 0 ? payload.id : undefined;
				} catch {
					providerMessageId = undefined;
				}
			} else {
				await response.body.dump();
			}
			return { success: true, providerMessageId };
		} finally {
			await dispatcher.close();
		}
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
	}
}
