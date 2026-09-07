export function download(name: string, text: string, type = "application/json"): void {
	const blob = new Blob([text], { type });
	const url = URL.createObjectURL(blob);
	const el = document.createElement("a");
	el.href = url;
	el.download = name;
	document.body.appendChild(el);
	el.click();
	setTimeout(() => { document.body.removeChild(el); URL.revokeObjectURL(url); }, 0);
}

export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		try {
			const ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand("copy");
			document.body.removeChild(ta);
			return true;
		} catch {
			return false;
		}
	}
}
