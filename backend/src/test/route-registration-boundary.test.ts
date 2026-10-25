import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const routeMethods = new Set(["get", "post", "put", "delete", "patch", "options", "head"]);

interface RouteRegistration {
	method: string;
	line: number;
}

function getRoutePath(node: ts.Expression | undefined): string | undefined {
	if (!node) return undefined;
	if (ts.isStringLiteralLike(node)) return node.text;
	if (ts.isTemplateExpression(node)) return node.head.text;
	return undefined;
}

function getPropertyName(property: ts.ObjectLiteralElementLike): string | undefined {
	if (
		!ts.isPropertyAssignment(property) &&
		!ts.isShorthandPropertyAssignment(property) &&
		!ts.isMethodDeclaration(property) &&
		!ts.isGetAccessorDeclaration(property) &&
		!ts.isSetAccessorDeclaration(property)
	) {
		return undefined;
	}

	const { name } = property;
	if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
	return undefined;
}

function isRouteOptions(node: ts.Expression | undefined): boolean {
	if (!node || !ts.isObjectLiteralExpression(node)) return false;

	const propertyNames = new Set(node.properties.map(getPropertyName));
	return propertyNames.has("method") && propertyNames.has("url");
}

function findRouteRegistrations(sourceText: string): RouteRegistration[] {
	const sourceFile = ts.createSourceFile("fixture.ts", sourceText, ts.ScriptTarget.Latest, true);
	const registrations: RouteRegistration[] = [];

	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
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

		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	return registrations;
}

function isInRoutesDirectory(filePath: string): boolean {
	const normalizedPath = filePath.split(sep).join("/");
	return normalizedPath === "routes" || normalizedPath.startsWith("routes/");
}

function findOutsideRouteRegistrations(filePath: string, sourceText: string): RouteRegistration[] {
	if (isInRoutesDirectory(filePath)) return [];
	return findRouteRegistrations(sourceText);
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
	it("rejects outside Fastify registrations without matching ordinary methods", () => {
		const fixture = `
app.get("/example");
database.delete(medications);
cache.get("example");
router.route("/example");
`;

		expect(findOutsideRouteRegistrations("services/example.ts", fixture)).toEqual([{ method: "get", line: 2 }]);
		expect(findOutsideRouteRegistrations("routes/medications.ts", fixture)).toEqual([]);
		expect(findRouteRegistrations('router.route({ method: "GET", url: "/example" });')).toEqual([
			{ method: "route", line: 1 },
		]);
	});

	it("keeps production HTTP route registrations under src/routes", () => {
		const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
		const sourceRoot = join(backendRoot, "src");
		const violations = collectProductionFiles(sourceRoot, sourceRoot).flatMap((filePath) => {
			const relativePath = relative(sourceRoot, filePath);
			return findOutsideRouteRegistrations(relativePath, readFileSync(filePath, "utf8")).map(
				({ method, line }) => `${relativePath.split(sep).join("/")}:${line} (${method})`
			);
		});

		expect(violations, "production HTTP route registrations must stay under src/routes").toEqual([]);
	});
});
