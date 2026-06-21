const KEY = 'spaceInvadersLeaderboardV1';
const MAX_ENTRIES = 10;

/**
 * @typedef {{ name: string, score: number, wave: number, date: number }} LeaderboardEntry
 */

/** @returns {LeaderboardEntry[]} */
export function getLeaderboard() {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(e) =>
					e &&
					typeof e.name === 'string' &&
					typeof e.score === 'number' &&
					typeof e.wave === 'number'
			)
			.slice(0, MAX_ENTRIES);
	} catch (_) {
		return [];
	}
}

/** @param {number} score */
export function qualifies(score) {
	if (score <= 0) return false;
	const board = getLeaderboard();
	if (board.length < MAX_ENTRIES) return true;
	return score > board[board.length - 1].score;
}

/** @param {LeaderboardEntry} entry */
export function addEntry(entry) {
	const board = getLeaderboard();
	board.push(entry);
	board.sort((a, b) => b.score - a.score);
	const trimmed = board.slice(0, MAX_ENTRIES);
	try {
		localStorage.setItem(KEY, JSON.stringify(trimmed));
	} catch (_) {
		/* storage unavailable */
	}
	return trimmed;
}

/** @param {LeaderboardEntry} entry */
export function rankOf(entry) {
	const board = getLeaderboard();
	const idx = board.findIndex(
		(e) => e.score === entry.score && e.date === entry.date && e.name === entry.name
	);
	return idx === -1 ? null : idx + 1;
}

export function clearLeaderboard() {
	try {
		localStorage.removeItem(KEY);
	} catch (_) {
		/* storage unavailable */
	}
}
