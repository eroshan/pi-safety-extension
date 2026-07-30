import * as crypto from "node:crypto";
import * as path from "node:path";
import { tokenizeShell } from "./tokenize.js";
import { makePathFingerprint } from "./fingerprint.js";

export interface NormalizedCommand {
	raw: string;
	effectiveCwd: string;
	tokensAfterCd: string[];
	stableTokens: string[];
	stableCommand: string;
	baseKey: string;
	fingerprintKey: string;
}

function sha256Short(s: string): string {
	return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function normalizeToken(token: string, maps: {
	pathMap: Map<string, string>;
	urlMap: Map<string, string>;
	pathCounter: number;
	urlCounter: number;
}) {
	if (/^https?:\/\//i.test(token)) {
		let v = maps.urlMap.get(token);
		if (!v) {
			v = `<url${++maps.urlCounter}>`;
			maps.urlMap.set(token, v);
		}
		return v;
	}

	const isPathLike =
		!token.startsWith("-") &&
		(token === "." || token === ".." || token.startsWith("./") || token.startsWith("../") || token.startsWith("/") ||
			token.startsWith("~") || token.includes("/"));

	if (isPathLike) {
		let v = maps.pathMap.get(token);
		if (!v) {
			v = `<path${++maps.pathCounter}>`;
			maps.pathMap.set(token, v);
		}
		return v;
	}

	// Long hex (commits, hashes, etc.)
	if (/^(?:0x)?[0-9a-f]{12,}$/i.test(token)) return "<hex>";

	// Pure numbers
	if (/^-?\d+(?:\.\d+)?$/.test(token)) return "<number>";

	return token;
}

function isSimpleFlag(tok: string, nextTok: string | undefined): boolean {
	if (!tok.startsWith("-")) return false;
	if (tok === "-" || tok === "--") return false;
	if (tok.includes("=")) return false;
	// If next token exists and doesn't look like a flag, assume this flag takes a value.
	if (nextTok !== undefined && !nextTok.startsWith("-")) return false;
	return true;
}

function sortFlagRuns(tokens: string[]): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < tokens.length) {
		const t = tokens[i]!;
		const next = tokens[i + 1];
		if (!isSimpleFlag(t, next)) {
			out.push(t);
			i++;
			continue;
		}

		let j = i;
		const run: string[] = [];
		while (j < tokens.length && isSimpleFlag(tokens[j]!, tokens[j + 1])) {
			run.push(tokens[j]!);
			j++;
		}
		run.sort();
		out.push(...run);
		i = j;
	}
	return out;
}

function resolveCd(cwd: string, target: string): string {
	if (!target) return cwd;
	if (target.startsWith("~")) return path.join(process.env.HOME || "~", target.slice(1));
	if (path.isAbsolute(target)) return path.normalize(target);
	return path.resolve(cwd, target);
}

export function normalizeCommand(raw: string, initialCwd: string): NormalizedCommand {
	const { tokens } = tokenizeShell(raw);

	let effectiveCwd = initialCwd;
	let idx = 0;
	// Extract leading `cd <dir>` segments, optionally followed by `&&` or `;`
	while (tokens[idx] === "cd" && tokens[idx + 1]) {
		effectiveCwd = resolveCd(effectiveCwd, tokens[idx + 1]!);
		idx += 2;
		if (tokens[idx] === "&&" || tokens[idx] === ";") idx += 1;
		else break;
	}

	const tokensAfterCd = tokens.slice(idx);

	const maps = { pathMap: new Map<string, string>(), urlMap: new Map<string, string>(), pathCounter: 0, urlCounter: 0 };
	const stableTokensRaw = tokensAfterCd.map((t) => normalizeToken(t, maps));
	const stableTokens = sortFlagRuns(stableTokensRaw);
	const stableCommand = stableTokens.join(" ").trim();

	const baseKey = sha256Short(`${effectiveCwd}||${stableCommand}`);
	const fp = makePathFingerprint(effectiveCwd, tokens);
	const fingerprintKey = `${baseKey}-${fp}`;

	return {
		raw,
		effectiveCwd,
		tokensAfterCd,
		stableTokens,
		stableCommand,
		baseKey,
		fingerprintKey,
	};
}
