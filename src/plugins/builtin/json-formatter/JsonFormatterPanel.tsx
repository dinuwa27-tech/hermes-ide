import { useState, useCallback } from "react";
import { getAPI } from "./activate";
import "./JsonFormatterPanel.css";

export function JsonFormatterPanel() {
	const api = getAPI();
	const [input, setInput] = useState("");
	const [output, setOutput] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [indent, setIndent] = useState(2);

	const format = useCallback(() => {
		try {
			const parsed = JSON.parse(input);
			setOutput(JSON.stringify(parsed, null, indent));
			setError(null);
			api.ui.updateStatusBarItem("json-formatter.status", { text: "JSON Valid" });
		} catch (e) {
			setError(e instanceof Error ? e.message : "Invalid JSON");
			setOutput("");
			api.ui.updateStatusBarItem("json-formatter.status", { text: "JSON Invalid" });
		}
	}, [input, indent, api]);

	const minify = useCallback(() => {
		try {
			const parsed = JSON.parse(input);
			setOutput(JSON.stringify(parsed));
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Invalid JSON");
			setOutput("");
		}
	}, [input]);

	const validate = useCallback(() => {
		try {
			JSON.parse(input);
			setError(null);
			setOutput("Valid JSON");
			api.ui.showToast("JSON is valid", { type: "success" });
		} catch (e) {
			setError(e instanceof Error ? e.message : "Invalid JSON");
			setOutput("");
		}
	}, [input, api]);

	const pasteFromClipboard = useCallback(async () => {
		try {
			const text = await api.clipboard.readText();
			setInput(text);
		} catch {
			api.ui.showToast("Failed to read clipboard", { type: "error" });
		}
	}, [api]);

	const copyResult = useCallback(async () => {
		if (!output) return;
		try {
			await api.clipboard.writeText(output);
			api.ui.showToast("Copied to clipboard", { type: "success" });
		} catch {
			api.ui.showToast("Failed to copy", { type: "error" });
		}
	}, [output, api]);

	const clear = useCallback(() => {
		setInput("");
		setOutput("");
		setError(null);
		api.ui.updateStatusBarItem("json-formatter.status", { text: "JSON" });
	}, [api]);

	return (
		<div className="json-fmt">
			<div className="json-fmt-header">
				<span className="json-fmt-title">JSON FORMATTER</span>
				<div className="json-fmt-actions">
					<button onClick={pasteFromClipboard} className="json-fmt-link-btn">Paste</button>
					<button onClick={clear} className="json-fmt-link-btn">Clear</button>
				</div>
			</div>

			<textarea
				className="json-fmt-input"
				value={input}
				onChange={(e) => setInput(e.target.value)}
				placeholder="Paste or type JSON here..."
				spellCheck={false}
			/>

			<div className="json-fmt-toolbar">
				<div className="json-fmt-btn-group">
					<button onClick={format} className="json-fmt-btn json-fmt-btn-primary">Format</button>
					<button onClick={minify} className="json-fmt-btn">Minify</button>
					<button onClick={validate} className="json-fmt-btn">Validate</button>
				</div>
				<select
					className="json-fmt-select"
					value={indent}
					onChange={(e) => setIndent(Number(e.target.value))}
				>
					<option value={2}>2 spaces</option>
					<option value={4}>4 spaces</option>
					<option value={1}>1 space</option>
				</select>
			</div>

			{error && <div className="json-fmt-error">{error}</div>}

			{output && (
				<div className="json-fmt-output-wrap">
					<pre className="json-fmt-output">{output}</pre>
					<button onClick={copyResult} className="json-fmt-copy-btn">Copy</button>
				</div>
			)}
		</div>
	);
}
