import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface ReviewModelRef {
	provider: string;
	id: string;
}

const stateDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../state");
const configPath = path.join(stateDir, "config.json");

export async function loadReviewModel(): Promise<ReviewModelRef | undefined> {
	try {
		const parsed = JSON.parse(await fsp.readFile(configPath, "utf8")) as { reviewModel?: unknown };
		const model = parsed.reviewModel;
		if (!model || typeof model !== "object") return undefined;
		const { provider, id } = model as Record<string, unknown>;
		return typeof provider === "string" && typeof id === "string" ? { provider, id } : undefined;
	} catch {
		return undefined;
	}
}

export async function saveReviewModel(reviewModel: ReviewModelRef): Promise<void> {
	await fsp.mkdir(stateDir, { recursive: true });
	await fsp.writeFile(configPath, `${JSON.stringify({ reviewModel }, null, 2)}\n`, "utf8");
}
