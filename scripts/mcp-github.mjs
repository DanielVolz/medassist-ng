import { execFileSync, spawn } from "node:child_process";

const image =
	"ghcr.io/github/github-mcp-server@sha256:a9dd39eec67f09ded51631c79641dd72acb4945c6391df47824fa2d508b5431b";

try {
	const token = execFileSync("gh", ["auth", "token", "--hostname", "github.com"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
	if (!token) throw new Error("GitHub CLI returned an empty credential; sign in with gh auth login");
	const child = spawn(
		"docker",
		["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", image, "stdio", "--toolsets=all"],
		{ env: { ...process.env, GITHUB_PERSONAL_ACCESS_TOKEN: token }, stdio: "inherit" }
	);
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, () => child.kill(signal));
	}
	child.on("error", (error) => {
		console.error(`Unable to launch GitHub MCP: ${error.message}`);
		process.exitCode = 1;
	});
	child.on("exit", (code, signal) => {
		if (signal) console.error(`GitHub MCP exited with ${signal}`);
		process.exitCode = code ?? 1;
	});
} catch (error) {
	console.error(`Unable to start GitHub MCP using GitHub CLI authentication: ${error.message}`);
	if (error.stderr) console.error(error.stderr.toString().trim());
	process.exitCode = 1;
}
