import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

const packageRoots = [
	"packages/shared/src",
	"packages/sdk/src",
	"packages/hono/src",
	"packages/supabase/src",
	"packages/react/src",
	"packages/better-auth/src",
];

const supportedExtensions = new Set([".ts", ".tsx"]);

// Minimum words in the JSDoc description — a stub one-liner isn't enough.
const MIN_DESCRIPTION_WORDS = 5;

async function listSourceFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listSourceFiles(path)));
			continue;
		}
		if (
			supportedExtensions.has(extname(entry.name)) &&
			!entry.name.endsWith(".d.ts") &&
			!entry.name.includes(".test.") &&
			!path.includes(`${"__tests__"}`)
		) {
			files.push(path);
		}
	}
	return files;
}

function hasExportModifier(node) {
	return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function declarationName(node) {
	if (node.name && ts.isIdentifier(node.name)) return node.name.text;
	return "<anonymous>";
}

function location(sourceFile, node) {
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	return `${relative(root, sourceFile.fileName)}:${position.line + 1}:${position.character + 1}`;
}

/** Pulls the description text and tags out of a node's JSDoc block(s). */
function readJsDoc(node) {
	const commentsAndTags = ts.getJSDocCommentsAndTags(node);
	let description = "";
	const tags = [];
	for (const item of commentsAndTags) {
		if (ts.isJSDoc(item)) {
			description += ` ${jsDocCommentText(item.comment)}`;
			if (item.tags) tags.push(...item.tags);
		} else {
			tags.push(item);
		}
	}
	return { present: commentsAndTags.length > 0, description: description.trim(), tags };
}

function jsDocCommentText(comment) {
	if (!comment) return "";
	if (typeof comment === "string") return comment;
	return comment.map((part) => part.text ?? "").join("");
}

function tagText(tag) {
	return jsDocCommentText(tag.comment).trim();
}

function countWords(text) {
	return text.split(/\s+/).filter(Boolean).length;
}

/** Resolves an exported statement to the function-like node it documents, if any. */
function asFunctionLike(statement) {
	if (ts.isFunctionDeclaration(statement)) return statement;
	if (ts.isVariableStatement(statement)) {
		const decl = statement.declarationList.declarations[0];
		if (
			decl?.initializer &&
			(ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
		) {
			return decl.initializer;
		}
	}
	return null;
}

function returnsAValue(fn) {
	const type = fn.type;
	if (!type) return false; // inferred return type — don't force @returns (avoid false positives)
	if (type.kind === ts.SyntaxKind.VoidKeyword || type.kind === ts.SyntaxKind.NeverKeyword)
		return false;
	// Promise<void>
	if (
		ts.isTypeReferenceNode(type) &&
		ts.isIdentifier(type.typeName) &&
		type.typeName.text === "Promise"
	) {
		const inner = type.typeArguments?.[0];
		if (inner && inner.kind === ts.SyntaxKind.VoidKeyword) return false;
	}
	return true;
}

function paramName(param) {
	return ts.isIdentifier(param.name) ? param.name.text : null;
}

/** Returns a list of problem strings for one exported declaration, or [] if it's well-documented. */
function inspectDeclaration(statement) {
	const doc = readJsDoc(statement);
	if (!doc.present) return ["missing JSDoc"];

	const problems = [];
	if (countWords(doc.description) < MIN_DESCRIPTION_WORDS) {
		problems.push(`description too short (needs >= ${MIN_DESCRIPTION_WORDS} words)`);
	}

	const fn = asFunctionLike(statement);
	const isClass = ts.isClassDeclaration(statement);

	if (fn) {
		const paramTags = doc.tags.filter(ts.isJSDocParameterTag);
		const documentedParams = new Set(
			paramTags.map((t) => (ts.isIdentifier(t.name) ? t.name.text : null)).filter(Boolean),
		);
		for (const param of fn.parameters) {
			const pName = paramName(param);
			if (pName?.startsWith("_")) continue; // intentionally-unused
			if (pName && !documentedParams.has(pName)) {
				problems.push(`@param ${pName} missing`);
			} else if (!pName && paramTags.length < fn.parameters.length) {
				problems.push("@param missing for a destructured parameter");
			}
		}
		for (const t of paramTags) {
			if (!tagText(t))
				problems.push(`@param ${ts.isIdentifier(t.name) ? t.name.text : ""} has no description`);
		}

		if (returnsAValue(fn)) {
			const ret = doc.tags.find((t) => ts.isJSDocReturnTag(t));
			if (!ret) problems.push("@returns missing");
			else if (!tagText(ret)) problems.push("@returns has no description");
		}
	}

	if (fn || isClass) {
		const example = doc.tags.find((t) => t.tagName?.text === "example");
		if (!example) problems.push("@example missing");
		else if (!tagText(example)) problems.push("@example is empty");
	}

	return problems;
}

function collectViolations(sourceFile) {
	const violations = [];
	const consider = (statement, name) => {
		const problems = inspectDeclaration(statement);
		if (problems.length > 0) {
			violations.push({ location: location(sourceFile, statement), name, problems });
		}
	};

	for (const statement of sourceFile.statements) {
		if (!hasExportModifier(statement)) continue;

		if (
			ts.isFunctionDeclaration(statement) ||
			ts.isClassDeclaration(statement) ||
			ts.isInterfaceDeclaration(statement) ||
			ts.isTypeAliasDeclaration(statement) ||
			ts.isEnumDeclaration(statement)
		) {
			consider(statement, declarationName(statement));
			continue;
		}

		if (ts.isVariableStatement(statement)) {
			const names = statement.declarationList.declarations
				.map((d) => (ts.isIdentifier(d.name) ? d.name.text : null))
				.filter(Boolean);
			consider(statement, names.join(", "));
		}
	}

	return violations;
}

const sourceFiles = (
	await Promise.all(packageRoots.map((packageRoot) => listSourceFiles(join(root, packageRoot))))
).flat();

const violations = [];
for (const file of sourceFiles) {
	const text = await readFile(file, "utf-8");
	const sourceFile = ts.createSourceFile(
		file,
		text,
		ts.ScriptTarget.Latest,
		true,
		extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	violations.push(...collectViolations(sourceFile));
}

if (violations.length > 0) {
	console.error(
		"Exported declarations need thorough JSDoc (description + @param/@returns/@example):",
	);
	for (const item of violations) {
		console.error(`- ${item.location} ${item.name}`);
		for (const problem of item.problems) console.error(`    · ${problem}`);
	}
	console.error(`\n${violations.length} declaration(s) with insufficient JSDoc.`);
	process.exit(1);
}

console.log(`Checked exported JSDoc quality in ${sourceFiles.length} package source files.`);
