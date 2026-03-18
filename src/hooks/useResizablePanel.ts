import { useState, useRef, useEffect, useCallback } from "react";
import { getSetting, setSetting } from "../api/settings";

interface UseResizablePanelOptions {
	defaultWidth: number;
	defaultHeight: number;
	minWidth: number;
	minHeight: number;
	maxWidthRatio: number;
	maxHeightRatio: number;
	widthKey: string;
	heightKey: string;
}

export function useResizablePanel({
	defaultWidth,
	defaultHeight,
	minWidth,
	minHeight,
	maxWidthRatio,
	maxHeightRatio,
	widthKey,
	heightKey,
}: UseResizablePanelOptions) {
	const [panelWidth, setPanelWidth] = useState(defaultWidth);
	const [panelHeight, setPanelHeight] = useState(defaultHeight);
	const latestWidthRef = useRef(panelWidth);
	const latestHeightRef = useRef(panelHeight);
	const resizingRef = useRef(false);
	const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const listenersRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: () => void } | null>(null);
	const bodyStylesRef = useRef({ cursor: "", userSelect: "" });

	useEffect(() => { latestWidthRef.current = panelWidth; }, [panelWidth]);
	useEffect(() => { latestHeightRef.current = panelHeight; }, [panelHeight]);

	const detach = useCallback(() => {
		if (listenersRef.current) {
			document.removeEventListener("mousemove", listenersRef.current.onMove);
			document.removeEventListener("mouseup", listenersRef.current.onUp);
			listenersRef.current = null;
		}
		document.body.style.cursor = bodyStylesRef.current.cursor;
		document.body.style.userSelect = bodyStylesRef.current.userSelect;
	}, []);

	useEffect(() => {
		return () => {
			if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
			if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
			detach();
			resizingRef.current = false;
		};
	}, [detach]);

	// Restore persisted size
	useEffect(() => {
		(async () => {
			try {
				const rawW = parseInt(await getSetting(widthKey), 10);
				const rawH = parseInt(await getSetting(heightKey), 10);
				const maxW = Math.max(minWidth, Math.floor(window.innerWidth * maxWidthRatio));
				const maxH = Math.max(minHeight, Math.floor(window.innerHeight * maxHeightRatio));
				if (!Number.isNaN(rawW) && rawW >= minWidth) setPanelWidth(Math.min(rawW, maxW));
				if (!Number.isNaN(rawH) && rawH >= minHeight) setPanelHeight(Math.min(rawH, maxH));
			} catch { /* settings may not exist yet */ }
		})();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const persist = useCallback((w: number, h: number) => {
		if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
		persistTimerRef.current = setTimeout(() => {
			setSetting(widthKey, String(Math.round(w))).catch(console.error);
			setSetting(heightKey, String(Math.round(h))).catch(console.error);
		}, 120);
	}, [widthKey, heightKey]);

	const beginResize = useCallback((
		e: React.MouseEvent,
		axis: "width" | "height",
	) => {
		e.preventDefault();
		e.stopPropagation();
		resizingRef.current = true;

		const startPos = axis === "width" ? e.clientX : e.clientY;
		const startSize = axis === "width" ? latestWidthRef.current : latestHeightRef.current;
		const min = axis === "width" ? minWidth : minHeight;
		const ratio = axis === "width" ? maxWidthRatio : maxHeightRatio;
		const viewport = axis === "width" ? window.innerWidth : window.innerHeight;
		const max = Math.max(min, Math.floor(viewport * ratio));
		const cursor = axis === "width" ? "col-resize" : "row-resize";

		detach();
		bodyStylesRef.current = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
		document.body.style.cursor = cursor;
		document.body.style.userSelect = "none";

		const setSize = axis === "width" ? setPanelWidth : setPanelHeight;

		const onMove = (ev: MouseEvent) => {
			const pos = axis === "width" ? ev.clientX : ev.clientY;
			const next = Math.max(min, Math.min(max, startSize + (pos - startPos)));
			setSize(next);
		};

		const onUp = () => {
			persist(latestWidthRef.current, latestHeightRef.current);
			detach();
			if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
			resetTimerRef.current = setTimeout(() => { resizingRef.current = false; }, 80);
		};

		listenersRef.current = { onMove, onUp };
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	}, [minWidth, minHeight, maxWidthRatio, maxHeightRatio, detach, persist]);

	const onResizeWidthStart = useCallback((e: React.MouseEvent) => beginResize(e, "width"), [beginResize]);
	const onResizeHeightStart = useCallback((e: React.MouseEvent) => beginResize(e, "height"), [beginResize]);

	const handleOverlayClick = useCallback((onClose: () => void) => {
		if (!resizingRef.current) onClose();
	}, []);

	return {
		panelWidth,
		panelHeight,
		onResizeWidthStart,
		onResizeHeightStart,
		handleOverlayClick,
	};
}
