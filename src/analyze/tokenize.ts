interface TokenizeResult {
	tokens: string[];
}

// Minimal shell-ish tokenizer.
// - Splits on whitespace
// - Preserves quoted strings (single and double quotes)
// - Handles backslash escapes in unquoted and double-quoted context
// - Treats operators like &&, ||, ;, | as tokens
export function tokenizeShell(command: string): TokenizeResult {
	const input = command ?? "";
	const tokens: string[] = [];
	let i = 0;

	const push = (t: string) => {
		if (t.length > 0) tokens.push(t);
	};

	while (i < input.length) {
		// whitespace
		if (/\s/.test(input[i]!)) {
			i++;
			continue;
		}

		// two-char operators
		const two = input.slice(i, i + 2);
		if (two === "&&" || two === "||" || two === ">>" || two === "<<") {
			push(two);
			i += 2;
			continue;
		}

		// one-char operators
		const ch = input[i]!;
		if (["|", ";", ">", "<", "(", ")", "{", "}"].includes(ch)) {
			push(ch);
			i++;
			continue;
		}

		// word / quoted
		let buf = "";
		let mode: "none" | "single" | "double" = "none";
		
		const handleEscape = (): boolean => {
			const next = input[i + 1];
			if (next !== undefined) {
				buf += next;
				i += 2;
				return true;
			}
			return false;
		};

		while (i < input.length) {
			const c = input[i]!;

			if (mode === "none") {
				if (/\s/.test(c)) break;

				const peek2 = input.slice(i, i + 2);
				if (peek2 === "&&" || peek2 === "||" || peek2 === ">>" || peek2 === "<<") break;
				if (["|", ";", ">", "<", "(", ")", "{", "}"].includes(c)) break;

				if (c === "'") {
					mode = "single";
					i++;
					continue;
				}
				if (c === '"') {
					mode = "double";
					i++;
					continue;
				}
				if (c === "\\" && handleEscape()) continue;

				buf += c;
				i++;
				continue;
			}

			if (mode === "single") {
				if (c === "'") {
					mode = "none";
					i++;
					continue;
				}
				buf += c;
				i++;
				continue;
			}

			// double
			if (c === '"') {
				mode = "none";
				i++;
				continue;
			}
			if (c === "\\" && handleEscape()) continue;
			
			buf += c;
			i++;
		}
		push(buf);
	}

	return { tokens };
}
