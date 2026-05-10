import type { Language } from "../../i18n/translations.js";

export type PushNotificationAction =
	| {
			kind: "taken";
			label: string;
			url: string;
			method: "POST";
	  }
	| {
			kind: "skip";
			label: string;
			url: string;
			method: "POST";
	  }
	| {
			kind: "view";
			label: string;
			url: string;
			method: "GET";
	  };

export type PushNotificationOptions = {
	actions?: PushNotificationAction[];
	respondUrl?: string;
	viewUrl?: string;
	clickUrl?: string;
	tags?: string[];
	priority?: number;
	sequenceId?: string;
};

type NtfyActionPayload = {
	action: "http" | "view";
	label: string;
	url: string;
	method?: "POST";
	clear: boolean;
};

function encodeHeaderValue(value: string): string {
	if ([...value].every((char) => char.charCodeAt(0) <= 0x7f)) {
		return value;
	}

	return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

export function isNtfyNotificationUrl(urlStr: string): boolean {
	if (urlStr.startsWith("ntfy://")) {
		return true;
	}

	try {
		const parsed = new URL(urlStr);
		if (!["http:", "https:"].includes(parsed.protocol)) {
			return false;
		}

		const hostname = parsed.hostname.toLowerCase();
		return hostname === "ntfy.sh" || hostname === "ntfy" || hostname.startsWith("ntfy.") || hostname.includes(".ntfy.");
	} catch {
		return false;
	}
}

export function getNotificationProvider(urlStr: string): string {
	if (isNtfyNotificationUrl(urlStr)) {
		return "ntfy";
	}

	try {
		return new URL(urlStr).protocol.replace(":", "").toLowerCase();
	} catch {
		return "unknown";
	}
}

export function getNotificationActionLabels(language: Language): {
	taken: string;
	skip: string;
	respond: string;
	view: string;
} {
	if (language === "de") {
		return {
			taken: "Einnehmen",
			skip: "Überspringen",
			respond: "Antworten",
			view: "Öffnen",
		};
	}

	return {
		taken: "Take",
		skip: "Skip",
		respond: "Respond",
		view: "View",
	};
}

export function buildNtfyActions(options: PushNotificationOptions): NtfyActionPayload[] {
	const actions = options.actions ?? [];

	return actions.map((action) => {
		if (action.kind === "view") {
			return {
				action: "view",
				label: action.label,
				url: action.url,
				clear: false,
			};
		}

		return {
			action: "http",
			label: action.label,
			url: action.url,
			method: "POST",
			clear: false,
		};
	});
}

export function appendFallbackActionLinks(message: string, options: PushNotificationOptions): string {
	if (!options.respondUrl && !options.viewUrl) {
		return message;
	}

	const lines = [message.trimEnd()];

	if (options.respondUrl) {
		lines.push("", "Respond:", options.respondUrl);
	}

	if (options.viewUrl) {
		lines.push("", "View:", options.viewUrl);
	}

	return lines.join("\n");
}

export function renderNotificationActionPayload(
	urlStr: string,
	message: string,
	options: PushNotificationOptions
): { message: string; headers: Record<string, string> } {
	if (!isNtfyNotificationUrl(urlStr)) {
		return {
			message: appendFallbackActionLinks(message, options),
			headers: {},
		};
	}

	const headers: Record<string, string> = {};
	const ntfyActions = buildNtfyActions(options);
	if (ntfyActions.length > 0) {
		headers.Actions = encodeHeaderValue(JSON.stringify(ntfyActions));
	}
	if (options.clickUrl && ntfyActions.length === 0) {
		headers.Click = options.clickUrl;
	}
	if (options.tags && options.tags.length > 0) {
		headers.Tags = options.tags.join(",");
	}
	if (typeof options.priority === "number") {
		headers.Priority = String(options.priority);
	}
	if (options.sequenceId) {
		headers["X-Sequence-ID"] = options.sequenceId;
	}

	return { message, headers };
}
