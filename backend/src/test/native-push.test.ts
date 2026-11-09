import { createServer } from "node:http";
import { createConnection, type LookupFunction } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock, requestMock, closeMock, agents } = vi.hoisted(() => ({
	lookupMock: vi.fn(),
	requestMock: vi.fn(),
	closeMock: vi.fn(),
	agents: [] as { connect: { lookup: LookupFunction } }[],
}));

vi.mock("../db/client.js", () => ({ db: {} }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("undici", async (importOriginal) => {
	const actual = await importOriginal<typeof import("undici")>();
	return {
		...actual,
		Agent: class {
			constructor(options: { connect: { lookup: LookupFunction } }) {
				agents.push(options);
			}
			request = requestMock;
			close = closeMock;
		},
	};
});

const { sendNativePush } = await import("../services/notifications/native-push.js");

describe("native notification pinned transport", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		agents.length = 0;
		lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		requestMock.mockResolvedValue({
			statusCode: 200,
			body: { json: async () => ({ id: "fixture-id" }), dump: vi.fn(), text: async () => "" },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(() => {
				throw new Error("Unpinned fetch must not be used");
			})
		);
	});

	afterEach(() => vi.unstubAllGlobals());

	it.each(["http:", "https:"])(
		"pins all public DNS answers for %s without changing the TLS hostname",
		async (protocol) => {
			lookupMock.mockResolvedValueOnce([
				{ address: "93.184.216.34", family: 4 },
				{ address: "2606:4700:4700::1111", family: 6 },
			]);
			expect(await sendNativePush(`${protocol}//push.example.test:8443/topic?key=value`, "Title", "Body")).toEqual({
				success: true,
				providerMessageId: undefined,
			});
			expect(requestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					origin: `${protocol}//push.example.test:8443`,
					path: "/topic?key=value",
					method: "POST",
					headersTimeout: 10_000,
					bodyTimeout: 10_000,
				})
			);
			// DNS changes after validation must never be consulted by the socket lookup.
			lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
			const callback = vi.fn();
			const pinned = agents[0].connect.lookup;
			pinned("push.example.test", { all: true }, callback);
			expect(callback).toHaveBeenLastCalledWith(null, [
				{ address: "93.184.216.34", family: 4 },
				{ address: "2606:4700:4700::1111", family: 6 },
			]);
			pinned("push.example.test", { family: 6 }, callback);
			expect(callback).toHaveBeenLastCalledWith(null, "2606:4700:4700::1111", 6);
			expect(lookupMock).toHaveBeenCalledTimes(1);
			expect(closeMock).toHaveBeenCalledTimes(1);
		}
	);

	it.each([
		[
			{ address: "93.184.216.34", family: 4 },
			{ address: "127.0.0.1", family: 4 },
		],
		[{ address: "not-an-ip", family: 4 }],
		[{ address: "93.184.216.34", family: 6 }],
		[{ address: "0:0:0:0:0:0:0:1", family: 6 }],
		[{ address: "0:0:0:0:0:ffff:7f00:1", family: 6 }],
		[],
	])("rejects unsafe or invalid DNS answers before transport: %j", async (...addresses) => {
		lookupMock.mockResolvedValue(addresses);
		expect((await sendNativePush("https://push.example.test/topic", "Title", "Body")).success).toBe(false);
		expect(requestMock).not.toHaveBeenCalled();
	});

	it.each(["file:///tmp/fixture", "ftp://push.example.test/topic", "http://127.0.0.1/topic"])(
		"rejects unsafe targets: %s",
		async (url) => {
			expect((await sendNativePush(url, "Title", "Body")).success).toBe(false);
			expect(requestMock).not.toHaveBeenCalled();
		}
	);

	it("allows only the existing ntfy private-target exception and preserves its message ID", async () => {
		lookupMock.mockResolvedValue([{ address: "192.168.1.5", family: 4 }]);
		expect(await sendNativePush("ntfy://ntfy.example.test/topic", "Title", "Body")).toEqual({
			success: true,
			providerMessageId: "fixture-id",
		});
		expect((await sendNativePush("https://push.example.test/topic", "Title", "Body")).success).toBe(false);
		expect(requestMock).toHaveBeenCalledTimes(1);
	});

	it("closes the dispatcher on transport errors", async () => {
		requestMock.mockRejectedValue(new Error("fixture transport failure"));
		expect(await sendNativePush("https://push.example.test/topic", "Title", "Body")).toEqual({
			success: false,
			error: "fixture transport failure",
		});
		expect(closeMock).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ host: "push.fixture.test", ip: "93.184.216.34" },
		{ host: "ntfy.fixture.test", ip: "127.0.0.1" },
	])(
		"pins $host and rejects redirects using a real dispatcher with injected loopback transport",
		async ({ host, ip }) => {
			const { Agent } = await vi.importActual<typeof import("undici")>("undici");
			const paths: string[] = [];
			const server = createServer((req, res) => {
				paths.push(req.url ?? "");
				res.writeHead(302, { Location: "/must-not-follow" });
				res.end("fixture redirect");
			});
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Missing fixture port");
			const agent = new Agent({
				connect: (options, callback) => {
					expect(options.hostname).toBe(host);
					// Exercise the actual pinned lookup before routing only the fixture socket to loopback.
					// Changing DNS here must not change the validated public address used by the connector.
					lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
					agents[0].connect.lookup(host, { family: 4 }, (error, pinnedAddress) => {
						if (error) return callback(error, null);
						expect(pinnedAddress).toBe(ip);
						const socket = createConnection({ host: "127.0.0.1", port: address.port });
						socket.once("connect", () => callback(null, socket));
						socket.once("error", (socketError) => callback(socketError, null));
					});
				},
			});
			requestMock.mockImplementation((options) => agent.request(options));
			closeMock.mockImplementation(() => agent.close());
			lookupMock.mockResolvedValue([{ address: ip, family: 4 }]);
			try {
				expect(await sendNativePush(`http://${host}:${address.port}/topic`, "Title", "Body")).toEqual({
					success: false,
					error: "HTTP 302: fixture redirect",
				});
				expect(paths).toEqual(["/topic"]);
				expect(lookupMock).toHaveBeenCalledTimes(1);
			} finally {
				if (!agent.destroyed) await agent.close();
				await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			}
		}
	);
});
