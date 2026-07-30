export const HERDR_BLOCKED_EVENT = "herdr:blocked";

interface EventBusLike {
	emit: (eventName: string, payload: unknown) => void;
}

export function emitHerdrBlockedEvent(
	eventBus: EventBusLike,
	info: {
		active: boolean;
		label?: string;
	},
): void {
	eventBus.emit(
		HERDR_BLOCKED_EVENT,
		info.label === undefined ? { active: info.active } : { active: info.active, label: info.label },
	);
}
