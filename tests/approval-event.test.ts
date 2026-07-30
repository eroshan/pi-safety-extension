import { describe, expect, test } from "vitest";

import {
	APPROVAL_NOTIFICATION_EVENT,
	emitApprovalNotificationEvent,
	formatApprovalNotificationMessage,
} from "../src/ui/approval-event.js";

describe("approval notification event", () => {
	test("formats an approval message for notification extensions", () => {
		const message = formatApprovalNotificationMessage({
			rawCommand: "rm -rf /tmp/demo",
			risk: "high",
			reason: "Needs user approval",
		});

		expect(message).toBe(
			"Safety approval required (high)\n\nCommand: rm -rf /tmp/demo\n\nReason: Needs user approval",
		);
	});

	test("uses fallbacks for empty fields", () => {
		const message = formatApprovalNotificationMessage({
			rawCommand: "   ",
			risk: "   ",
			reason: "   ",
		});

		expect(message).toBe(
			"Safety approval required (unknown)\n\nCommand: (empty command)\n\nReason: No reason provided",
		);
	});

	test("emits the generic notify alert event", () => {
		const events: Array<{ name: string; payload: unknown }> = [];
		const eventBus = {
			emit(name: string, payload: unknown) {
				events.push({ name, payload });
			},
		};

		emitApprovalNotificationEvent(eventBus, {
			rawCommand: "terraform apply",
			risk: "medium",
			reason: "Infrastructure change",
		});

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			name: APPROVAL_NOTIFICATION_EVENT,
			payload: {
				title: "safety: approval required",
				message:
					"Safety approval required (medium)\n\nCommand: terraform apply\n\nReason: Infrastructure change",
			},
		});
	});
});
