import * as crypto from "node:crypto";

function sha256Hex(input: string): string {
	return crypto.createHash("sha256").update(input).digest("hex");
}

function isLikelyUrl(tok: string): boolean {
	return /^https?:\/\//i.test(tok);
}

function isLikelyPath(tok: string): boolean {
	if (!tok) return false;
	if (tok.startsWith("-")) return false;
	if (tok === "." || tok === "..") return true;
	if (tok.startsWith("./") || tok.startsWith("../") || tok.startsWith("/") || tok.startsWith("~")) return true;
	// contains a slash somewhere
	if (tok.includes("/")) return true;
	return false;
}

function extractPathsAndUrls(tokens: string[]) {
	const paths: string[] = [];
	const urls: string[] = [];
	for (const t of tokens) {
		if (isLikelyUrl(t)) urls.push(t);
		else if (isLikelyPath(t)) paths.push(t);
	}
	return { paths, urls };
}

export function makePathFingerprint(effectiveCwd: string, rawTokens: string[]): string {
	const { paths, urls } = extractPathsAndUrls(rawTokens);
	const uniq = <T>(arr: T[]) => Array.from(new Set(arr));
	const payload = {
		cwd: effectiveCwd,
		paths: uniq(paths).sort(),
		urls: uniq(urls).sort(),
	};
	return sha256Hex(JSON.stringify(payload)).slice(0, 12);
}
