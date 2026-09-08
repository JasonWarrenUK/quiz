<script lang="ts">
	type Mode = "light" | "system" | "dark";

	const KEY = "theme";

	function read(): Mode {
		try {
			const v = localStorage.getItem(KEY);
			return v === "light" || v === "dark" ? v : "system";
		} catch {
			return "system";
		}
	}
	function write(mode: Mode): void {
		try {
			localStorage.setItem(KEY, mode);
		} catch {
			/* private window, blocked storage, preview capture: ignore */
		}
	}
	function apply(mode: Mode): void {
		const root = document.documentElement;
		if (mode === "system") root.removeAttribute("data-theme");
		else root.setAttribute("data-theme", mode);
		current = mode;
	}

	// app.html applies the stored choice synchronously before first paint;
	// this just syncs the button state to what's already on the root.
	let current = $state<Mode>("system");

	$effect(() => {
		current = read();
	});

	function set(mode: Mode): void {
		write(mode);
		apply(mode);
	}
</script>

<div class="toggle" role="group" aria-label="Colour theme">
	<button type="button" onclick={() => set("light")} aria-pressed={current === "light"}>☀</button>
	<button type="button" onclick={() => set("system")} aria-pressed={current === "system"}>◐</button>
	<button type="button" onclick={() => set("dark")} aria-pressed={current === "dark"}>☾</button>
</div>

<style>
	.toggle {
		position: fixed;
		top: 12px;
		right: 12px;
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: var(--radius-md, 6px);
		background: var(--color-surface-deep);
		box-shadow: inset 0 0 0 1px var(--color-border);
		z-index: 50;
	}
	.toggle button {
		width: 26px;
		height: 26px;
		border: none;
		border-radius: calc(var(--radius-md, 6px) - 2px);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
	}
	.toggle button[aria-pressed="true"] {
		background: var(--color-primary);
		color: var(--color-on-primary);
	}
	@media print {
		.toggle {
			display: none;
		}
	}
</style>
