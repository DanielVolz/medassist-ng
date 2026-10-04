import { z } from "zod";

export const registerSchema = z.object({
	username: z
		.string()
		.trim()
		.min(3, "Username must be at least 3 characters")
		.max(50, "Username must be at most 50 characters")
		.regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, underscores, and hyphens"),
	email: z.string().trim().email("Email must be valid").max(255, "Email must be at most 255 characters"),
	password: z
		.string()
		.min(8, "Password must be at least 8 characters")
		.max(128, "Password must be at most 128 characters"),
});

export const loginSchema = z.object({
	username: z.string().trim().min(1, "Username is required"),
	password: z.string().min(1, "Password is required"),
	rememberMe: z.boolean().optional().default(false),
});

export const updateProfileSchema = z.object({
	currentPassword: z.string().optional(),
	email: z.string().trim().email("Email must be valid").max(255, "Email must be at most 255 characters").optional(),
	newPassword: z
		.string()
		.min(8, "Password must be at least 8 characters")
		.max(128, "Password must be at most 128 characters")
		.optional(),
});

export const forgotPasswordSchema = z.object({
	emailOrUsername: z.string().trim().min(1).max(255),
});

export const resetPasswordSchema = z.object({
	token: z.string().regex(/^[a-f0-9]{64}$/i, "Invalid reset token"),
	newPassword: z
		.string()
		.min(8, "Password must be at least 8 characters")
		.max(128, "Password must be at most 128 characters"),
});

export const authErrorSchema = {
	type: "object",
	properties: {
		error: { type: "string" },
		code: { type: "string" },
	},
};

export const registerRouteSchema = {
	tags: ["auth"],
	summary: "Register local user",
	body: {
		type: "object",
		required: ["username", "email", "password"],
		properties: {
			username: { type: "string", minLength: 3, maxLength: 50 },
			email: { type: "string", format: "email", maxLength: 255 },
			password: { type: "string", minLength: 8, maxLength: 128 },
		},
		example: {
			username: "daniel",
			email: "daniel@example.com",
			password: "correct-horse-battery-staple",
		},
	},
	response: {
		201: {
			type: "object",
			properties: {
				ok: { type: "boolean" },
				user: {
					type: "object",
					properties: {
						id: { type: "number" },
						username: { type: "string" },
					},
				},
				message: { type: "string" },
			},
		},
		400: authErrorSchema,
		409: authErrorSchema,
	},
};

export const loginRouteSchema = {
	tags: ["auth"],
	summary: "Login with username and password",
	body: {
		type: "object",
		required: ["username", "password"],
		properties: {
			username: { type: "string" },
			password: { type: "string" },
			rememberMe: { type: "boolean" },
		},
		example: {
			username: "daniel",
			password: "correct-horse-battery-staple",
			rememberMe: true,
		},
	},
	response: {
		200: {
			type: "object",
			properties: {
				ok: { type: "boolean" },
				user: {
					type: "object",
					properties: {
						id: { type: "number" },
						username: { type: "string" },
						avatarUrl: { type: ["string", "null"] },
					},
				},
			},
		},
		400: authErrorSchema,
		401: authErrorSchema,
	},
};

export const refreshRouteSchema = {
	tags: ["auth"],
	summary: "Refresh access token",
	description: "Requires refresh token cookie context.",
	response: {
		200: { type: "object", properties: { ok: { type: "boolean" } } },
		401: authErrorSchema,
	},
};

export const logoutRouteSchema = {
	tags: ["auth"],
	summary: "Logout and clear auth cookies",
	response: {
		200: { type: "object", properties: { ok: { type: "boolean" } } },
	},
};

const authEndpointSecurity: ReadonlyArray<Record<string, readonly string[]>> = [{ bearerAuth: [] }, { cookieAuth: [] }];

export const getProfileRouteSchema = {
	tags: ["auth"],
	summary: "Get current user profile",
	security: authEndpointSecurity,
	response: {
		200: {
			type: "object",
			properties: {
				id: { type: "number" },
				username: { type: "string" },
				email: { type: ["string", "null"], format: "email" },
				avatarUrl: { type: ["string", "null"] },
				authProvider: { type: "string" },
				createdAt: { type: "string", format: "date-time" },
				lastLoginAt: { type: ["string", "null"], format: "date-time" },
			},
		},
		401: authErrorSchema,
		404: authErrorSchema,
	},
};

export const updateProfileRouteSchema = {
	tags: ["auth"],
	summary: "Update current user profile",
	security: authEndpointSecurity,
	body: {
		type: "object",
		properties: {
			currentPassword: { type: "string" },
			email: { type: "string", format: "email", maxLength: 255 },
			newPassword: { type: "string", minLength: 8, maxLength: 128 },
		},
		example: {
			currentPassword: "current-password",
			newPassword: "new-strong-password",
		},
	},
	response: {
		200: {
			type: "object",
			properties: {
				ok: { type: "boolean" },
				message: { type: "string" },
			},
		},
		400: authErrorSchema,
		401: authErrorSchema,
		404: authErrorSchema,
	},
};

export const uploadAvatarRouteSchema = {
	tags: ["auth"],
	summary: "Upload user avatar",
	description: "Uploads and optimizes a profile image using multipart/form-data.",
	security: authEndpointSecurity,
	consumes: ["multipart/form-data"],
	response: {
		200: {
			type: "object",
			properties: {
				ok: { type: "boolean" },
				avatarUrl: { type: "string" },
			},
		},
		400: authErrorSchema,
		401: authErrorSchema,
	},
};

export const deleteAvatarRouteSchema = {
	tags: ["auth"],
	summary: "Delete user avatar",
	security: authEndpointSecurity,
	response: {
		200: { type: "object", properties: { ok: { type: "boolean" } } },
		401: authErrorSchema,
		404: authErrorSchema,
	},
};

export const deleteAccountRouteSchema = {
	tags: ["auth"],
	summary: "Delete current user account",
	description: "Deletes the current account and related data (cascade delete).",
	security: authEndpointSecurity,
	response: {
		200: {
			type: "object",
			properties: {
				ok: { type: "boolean" },
				message: { type: "string" },
			},
		},
		401: authErrorSchema,
	},
};
