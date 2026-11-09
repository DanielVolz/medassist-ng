import type { User } from "../components/Auth";

/** Local uploads always win; remote provider images are optional browser-only fallbacks. */
export function getUserAvatarSrc(user: Pick<User, "avatarUrl" | "oidcPictureUrl">): string | undefined {
	if (user.avatarUrl) return `/api/images/${user.avatarUrl}`;
	const picture = user.oidcPictureUrl;
	if (!picture || picture.length > 2048 || !/^https:\/\//i.test(picture)) return undefined;
	if (/[\s\\]|\p{Cc}/u.test(picture)) return undefined;
	try {
		const url = new URL(picture);
		if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return undefined;
		url.hash = "";
		return url.href;
	} catch {
		return undefined;
	}
}
