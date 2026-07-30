export function parseBool(value: string | undefined, defaultValue: boolean): boolean {
	if (value === undefined) return defaultValue;
	const v = value.trim().toLowerCase();
	if (["1", "true", "yes", "y", "on"].includes(v)) return true;
	if (["0", "false", "no", "n", "off"].includes(v)) return false;
	return defaultValue;
}

export function parseIntEnv(value: string | undefined, defaultValue: number): number {
	if (!value) return defaultValue;
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) ? n : defaultValue;
}
