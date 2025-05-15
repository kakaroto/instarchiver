export function sanitizeFilename(name) {
	// Replace any character that is not accepted in filenames with an underscore
	return (name || "unnamed").replace(/[^a-z0-9 _-]/gi, '_').slice(0, 100);
}
export async function waitMS(ms, randomness = 0) {
	return new Promise(r => setTimeout(r, ms + Math.floor(Math.random() * randomness)));
}

// Format a Date object to a string appropriate for filenames
export function formatDateForFilename(date) {
	const pad = (num) => String(num).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}