import type { RecommendedAction, ReviewResult, RiskLevel } from "./verdict.js";

const ACTION_RANK: Record<RecommendedAction, number> = {
	allow: 0,
	confirm: 1,
	block: 2,
};

const RISK_RANK: Record<RiskLevel, number> = {
	low: 0,
	medium: 1,
	high: 2,
	critical: 3,
};

const SHELL_CONTROL_SYNTAX = /[\n\r;&|<>`$(){}[\]*?!#'"\\]/;
const FORK_BOMB = /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;
const SHUTDOWN_COMMANDS = new Set(["halt", "poweroff", "reboot", "shutdown"]);

const HIGH_RISK_COMMANDS = new Set([
	"chmod",
	"chown",
	"curl",
	"dd",
	"doas",
	"docker",
	"fdisk",
	"kill",
	"kubectl",
	"mkfs",
	"mount",
	"mv",
	"parted",
	"pkill",
	"rm",
	"rsync",
	"scp",
	"ssh",
	"sudo",
	"umount",
	"wget",
	"wipefs",
]);

function simpleTokens(command: string): string[] | undefined {
	const trimmed = command.trim();
	if (!trimmed || SHELL_CONTROL_SYNTAX.test(trimmed)) return undefined;
	return trimmed.split(/\s+/);
}

function catastrophicReason(command: string, tokens: string[] | undefined): string | undefined {
	if (FORK_BOMB.test(command)) return "process fork bombs are not permitted";
	if (!tokens) return undefined;

	const directTokens = tokens[0] === "sudo" || tokens[0] === "doas" ? tokens.slice(1) : tokens;
	const [executable, ...args] = directTokens;
	if (!executable) return undefined;
	if (/^mkfs(?:\.[a-z0-9_-]+)?$/i.test(executable) || executable === "wipefs") {
		return "disk formatting commands are not permitted";
	}
	if (executable === "dd" && args.some((argument) => argument.startsWith("of=/dev/"))) {
		return "raw writes to device paths are not permitted";
	}
	if (SHUTDOWN_COMMANDS.has(executable)) return "system shutdown commands are not permitted";
	if (executable !== "rm") return undefined;

	const shortOptions = args.filter((argument) => /^-[^-]/.test(argument)).join("");
	const recursive = shortOptions.includes("r") || shortOptions.includes("R") || args.includes("--recursive");
	const forced = shortOptions.includes("f") || args.includes("--force");
	const protectedTarget = args.some((argument) =>
		argument === "/" || argument.startsWith("/*") || argument === "~" || argument.startsWith("~/"));
	return recursive && forced && protectedTarget
		? "recursive forced deletion of a root or home path is not permitted"
		: undefined;
}

function isSafeGitStatus(tokens: string[]): boolean {
	if (tokens[0] !== "git" || tokens[1] !== "status") return false;
	const safeArguments = new Set([
		"--branch",
		"--porcelain",
		"--porcelain=v1",
		"--porcelain=v2",
		"--short",
		"--untracked-files=all",
		"--untracked-files=no",
		"--untracked-files=normal",
		"-b",
		"-s",
		"-uall",
		"-uno",
		"-unormal",
	]);
	return tokens.slice(2).every((argument) => safeArguments.has(argument));
}

function isLocallyAllowlisted(tokens: string[]): boolean {
	const [command, ...args] = tokens;
	if (command === "pwd" || command === "whoami") return args.length === 0;
	if (command === "ls" || command === "id" || command === "uname") return true;
	return isSafeGitStatus(tokens);
}

export function classifyBashCommand(command: string): ReviewResult {
	const tokens = simpleTokens(command);
	const catastrophic = catastrophicReason(command, tokens);
	if (catastrophic) {
		return {
			risk: "critical",
			reason: `Local safety policy: ${catastrophic}.`,
			recommendedAction: "block",
		};
	}

	if (!tokens) {
		return {
			risk: "medium",
			reason: "Local safety policy requires confirmation for empty commands or shell control syntax.",
			recommendedAction: "confirm",
		};
	}

	if (isLocallyAllowlisted(tokens)) {
		return {
			risk: "low",
			reason: "Local safety policy recognizes a simple read-only command.",
			recommendedAction: "allow",
		};
	}

	if (HIGH_RISK_COMMANDS.has(tokens[0])) {
		return {
			risk: "high",
			reason: `Local safety policy requires confirmation for ${tokens[0]}.`,
			recommendedAction: "confirm",
		};
	}

	return {
		risk: "medium",
		reason: "Local safety policy requires confirmation for commands outside the read-only allowlist.",
		recommendedAction: "confirm",
	};
}

export function mergeReviewResults(local: ReviewResult, model: ReviewResult): ReviewResult {
	const risk = RISK_RANK[local.risk] >= RISK_RANK[model.risk] ? local.risk : model.risk;
	let recommendedAction = ACTION_RANK[local.recommendedAction] >= ACTION_RANK[model.recommendedAction]
		? local.recommendedAction
		: model.recommendedAction;

	if (risk === "critical") {
		recommendedAction = "block";
	} else if ((risk === "medium" || risk === "high") && recommendedAction === "allow") {
		recommendedAction = "confirm";
	}

	const localRaisedDecision =
		RISK_RANK[local.risk] > RISK_RANK[model.risk] ||
		ACTION_RANK[local.recommendedAction] > ACTION_RANK[model.recommendedAction];

	return {
		risk,
		reason: localRaisedDecision ? `${model.reason} ${local.reason}` : model.reason,
		recommendedAction,
	};
}
