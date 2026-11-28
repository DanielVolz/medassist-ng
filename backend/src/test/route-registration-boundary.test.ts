import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Expression, Node, ObjectLiteralElementLike, SourceFile } from "typescript/unstable/ast";
import {
	isCallExpression,
	isGetAccessorDeclaration,
	isIdentifier,
	isMethodDeclaration,
	isObjectLiteralExpression,
	isPropertyAccessExpression,
	isPropertyAssignment,
	isSetAccessorDeclaration,
	isShorthandPropertyAssignment,
	isStringLiteralLikeNode,
	isTemplateExpression,
} from "typescript/unstable/ast";
import { API, type Snapshot } from "typescript/unstable/sync";
import { afterAll, describe, expect, it } from "vitest";

const routeMethods = new Set(["get", "post", "put", "delete", "patch", "options", "head"]);
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let typescriptApi: API | undefined;

interface RouteRegistration {
	method: string;
	line: number;
}

function getTypeScriptApi(): API {
	typescriptApi ??= new API({ cwd: backendRoot });
	return typescriptApi;
}

function getSourceFile(snapshot: Snapshot, filePath: string) {
	const sourceFile = snapshot.getDefaultProjectForFile(filePath)?.program.getSourceFile(filePath);
	if (!sourceFile) throw new Error(`TypeScript did not parse ${filePath}`);
	return sourceFile;
}

function getRoutePath(node: Expression | undefined): string | undefined {
	if (!node) return undefined;
	if (isStringLiteralLikeNode(node)) return node.text;
	if (isTemplateExpression(node)) return node.head.text;
	return undefined;
}

function getPropertyName(property: ObjectLiteralElementLike): string | undefined {
	if (
		!isPropertyAssignment(property) &&
		!isShorthandPropertyAssignment(property) &&
		!isMethodDeclaration(property) &&
		!isGetAccessorDeclaration(property) &&
		!isSetAccessorDeclaration(property)
	) {
		return undefined;
	}

	const { name } = property;
	if (isIdentifier(name) || isStringLiteralLikeNode(name)) return name.text;
	return undefined;
}

function isRouteOptions(node: Expression | undefined): boolean {
	if (!node || !isObjectLiteralExpression(node)) return false;

	const propertyNames = new Set(node.properties.map(getPropertyName));
	return propertyNames.has("method") && propertyNames.has("url");
}

function findRouteRegistrations(sourceFile: SourceFile): RouteRegistration[] {
	const registrations: RouteRegistration[] = [];

	function visit(node: Node): void {
		if (isCallExpression(node) && isPropertyAccessExpression(node.expression)) {
			const method = node.expression.name.text;
			const firstArgument = node.arguments[0];
			const isShorthandRegistration = routeMethods.has(method) && getRoutePath(firstArgument)?.startsWith("/");
			const isGenericRegistration = method === "route" && isRouteOptions(firstArgument);

			if (isShorthandRegistration || isGenericRegistration) {
				registrations.push({
					method,
					line: sourceFile.getLineAndCharacterOfPosition(node.expression.name.getStart(sourceFile)).line + 1,
				});
			}
		}

		node.forEachChild(visit);
	}

	visit(sourceFile);
	return registrations;
}

function isInRoutesDirectory(filePath: string): boolean {
	const normalizedPath = filePath.split(sep).join("/");
	return normalizedPath === "routes" || normalizedPath.startsWith("routes/");
}

function findOutsideRouteRegistrations(filePath: string, sourceFile: SourceFile): RouteRegistration[] {
	if (isInRoutesDirectory(filePath)) return [];
	return findRouteRegistrations(sourceFile);
}

function collectProductionFiles(directory: string, sourceRoot: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (directory === sourceRoot && (entry.name === "routes" || entry.name === "test")) continue;
			files.push(...collectProductionFiles(entryPath, sourceRoot));
			continue;
		}

		if (!/\.[cm]?tsx?$/.test(entry.name) || /\.(?:test|spec)\.[cm]?tsx?$/.test(entry.name)) continue;
		if (entry.name.endsWith(".d.ts")) continue;
		files.push(entryPath);
	}
	return files;
}

describe("route registration boundary", () => {
	afterAll(() => {
		typescriptApi?.close();
	});

	it("rejects outside Fastify registrations without matching ordinary methods", () => {
		const fixture = `
app.get("/example");
database.delete(medications);
cache.get("example");
router.route("/example");
`;
		const genericFixture = 'router.route({ method: "GET", url: "/example" });';
		const fixtureDirectory = mkdtempSync(join(tmpdir(), "medassist-route-registration-"));
		const fixturePath = join(fixtureDirectory, "fixture.ts");
		const genericFixturePath = join(fixtureDirectory, "generic-fixture.ts");
		writeFileSync(fixturePath, fixture);
		writeFileSync(genericFixturePath, genericFixture);

		try {
			const snapshot = getTypeScriptApi().updateSnapshot({ openFiles: [fixturePath, genericFixturePath] });
			try {
				const fixtureSource = getSourceFile(snapshot, fixturePath);
				const genericSource = getSourceFile(snapshot, genericFixturePath);
				expect(findOutsideRouteRegistrations("services/example.ts", fixtureSource)).toEqual([
					{ method: "get", line: 2 },
				]);
				expect(findOutsideRouteRegistrations("routes/medications.ts", fixtureSource)).toEqual([]);
				expect(findRouteRegistrations(genericSource)).toEqual([{ method: "route", line: 1 }]);
			} finally {
				snapshot.dispose();
				getTypeScriptApi()
					.updateSnapshot({ closeFiles: [fixturePath, genericFixturePath] })
					.dispose();
			}
		} finally {
			rmSync(fixtureDirectory, { recursive: true, force: true });
		}
	});

	it("keeps production HTTP route registrations under src/routes", () => {
		const sourceRoot = join(backendRoot, "src");
		const productionFiles = collectProductionFiles(sourceRoot, sourceRoot);
		const snapshot = getTypeScriptApi().updateSnapshot({ openFiles: productionFiles });
		let violations: string[];
		try {
			violations = productionFiles.flatMap((filePath) => {
				const relativePath = relative(sourceRoot, filePath);
				return findOutsideRouteRegistrations(relativePath, getSourceFile(snapshot, filePath)).map(
					({ method, line }) => `${relativePath.split(sep).join("/")}:${line} (${method})`
				);
			});
		} finally {
			snapshot.dispose();
			getTypeScriptApi().updateSnapshot({ closeFiles: productionFiles }).dispose();
		}

		expect(violations, "production HTTP route registrations must stay under src/routes").toEqual([]);
	});
});
