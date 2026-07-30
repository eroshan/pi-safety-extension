import { describe, expect, test } from "vitest";

import { emitHerdrBlockedEvent, HERDR_BLOCKED_EVENT } from "../src/ui/blocked-event.js";

describe("herdr blocked event", () => {
	test("emits active blocked state with label", () => {
		const events: Array<{ name: string; payload: unknown }> = [];
		const eventBus = {
			emit(name: string, payload: unknown) {
				events.push({ name, payload });
			},
		};

		emitHerdrBlockedEvent(eventBus, { active: true, label: "Safety approval required (high)" });

		expect(events).toEqual([
			{
				name: HERDR_BLOCKED_EVENT,
				payload: { active: true, label: "Safety approval required (high)" },
			},
		]);
	});

	test("omits label when clearing blocked state", () => {
		const events: Array<{ name: string; payload: unknown }> = [];
		const eventBus = {
			emit(name: string, payload: unknown) {
				events.push({ name, payload });
			},
		};

		emitHerdrBlockedEvent(eventBus, { active: false });

		expect(events).toEqual([
			{
				name: HERDR_BLOCKED_EVENT,
				payload: { active: false },
			},
		]);
	});
});
