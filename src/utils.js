export function sanitizeFilename(name) {
    return (name || "unnnamed").replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 100);
}
export async function waitMS(ms, randomness = 0) {
	return new Promise(r => setTimeout(r, ms + Math.floor(Math.random() * randomness)));
}