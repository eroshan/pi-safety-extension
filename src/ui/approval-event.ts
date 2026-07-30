export const APPROVAL_NOTIFICATION_EVENT = "notify:alert";

interface EventBusLike {
	emit: (eventName: string, payload: unknown) => void;
}

function normalizeText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function formatApprovalNotificationMessage(info: {
	rawCommand: string;
	risk: string;
	reason: string;
}): string {
	const risk = normalizeText(info.risk) || "unknown";
	const command = info.rawCommand.trim() || "(empty command)";
	const reason = normalizeText(info.reason) || "No reason provided";

	return [
		`Safety approval required (${risk})`,
		"",
		`Command: ${command}`,
		"",
		`Reason: ${reason}`,
	].join("\n");
}

export function emitApprovalNotificationEvent(
	eventBus: EventBusLike,
	info: {
		rawCommand: string;
		risk: string;
		reason: string;
	},
): void {
	eventBus.emit(APPROVAL_NOTIFICATION_EVENT, {
		title: "safety: approval required",
		message: formatApprovalNotificationMessage(info),
	});
}
