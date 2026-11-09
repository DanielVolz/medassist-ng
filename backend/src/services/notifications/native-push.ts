import { sanitizeNotificationUrl, validateNotificationTargetUrl } from "../settings-service.js";
import { type PushNotificationOptions, renderNotificationActionPayload } from "./action-renderer.js";

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
		const targetValidationError = await validateNotificationTargetUrl(targetUrl, { allowLocalNtfyTarget: isNtfy });
		if (targetValidationError) return { success: false, error: targetValidationError };
		const response = await fetch(targetUrl, {
			method: "POST",
			headers,
			body: renderedPayload.message,
			redirect: "error",
		});
		if (!response.ok) {
			const errorText = await response.text();
			return { success: false, error: `HTTP ${response.status}: ${errorText}` };
		}
		let providerMessageId: string | undefined;
		if (isNtfy) {
			try {
				const payload = (await response.json()) as { id?: unknown };
				providerMessageId = typeof payload.id === "string" && payload.id.length > 0 ? payload.id : undefined;
			} catch {
				providerMessageId = undefined;
			}
		}
		return { success: true, providerMessageId };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
	}
}
