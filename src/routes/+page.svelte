<script>
	import { onMount } from 'svelte';

	/** @type {{name:string, score:number, wave:number, date:number}[]} */
	let board = [];

	onMount(async () => {
		const { getLeaderboard } = await import('$lib/game/leaderboard.js');
		board = getLeaderboard();
	});

	/** @param {number} ts */
	function formatDate(ts) {
		try {
			return new Date(ts).toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric'
			});
		} catch (_) {
			return '';
		}
	}
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Libre+Baskerville&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="page">
	<h1>Space Invaders</h1>
	<div class="buttons">
		<a href="/game" class="btn">Play</a>
		<a
			href="https://github.com/niiccoo2/nexus-project"
			target="_blank"
			rel="noopener noreferrer"
			class="btn">Source Code</a
		>
	</div>

	<section class="leaderboard">
		<h2>Leaderboard</h2>
		{#if board.length === 0}
			<p class="empty">No entries yet — play a round to claim the top spot.</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th class="rank">#</th>
						<th class="name">Name</th>
						<th class="num">Score</th>
						<th class="num">Wave</th>
						<th class="date">Date</th>
					</tr>
				</thead>
				<tbody>
					{#each board as e, i}
						<tr class:gold={i === 0} class:silver={i === 1} class:bronze={i === 2}>
							<td class="rank">{i + 1}</td>
							<td class="name">{e.name}</td>
							<td class="num">{e.score.toLocaleString()}</td>
							<td class="num">{e.wave}</td>
							<td class="date">{formatDate(e.date)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
</div>

<style>
	:global(body) {
		margin: 0;
	}

	.page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		margin: 0;
		padding: 3rem 1rem 4rem;
		box-sizing: border-box;
		font-family: 'Libre Baskerville', serif;
		background: #fff;
	}

	h1 {
		font-size: 3rem;
		margin: 0 0 2rem;
		font-weight: 400;
	}

	.buttons {
		display: flex;
		gap: 1.5rem;
	}

	.btn {
		padding: 0.75rem 2rem;
		font-family: 'Libre Baskerville', serif;
		font-size: 1rem;
		text-decoration: none;
		border: 2px solid #000;
		color: #000;
		background: transparent;
		cursor: pointer;
		transition:
			background 0.2s,
			color 0.2s;
	}

	.btn:hover {
		background: #000;
		color: #fff;
	}

	.leaderboard {
		margin-top: 3rem;
		width: 100%;
		max-width: 520px;
	}

	.leaderboard h2 {
		font-weight: 400;
		font-size: 1.25rem;
		margin: 0 0 0.75rem;
		text-align: center;
		letter-spacing: 0.05em;
	}

	.empty {
		text-align: center;
		color: #555;
		font-style: italic;
		margin: 0;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		border-top: 2px solid #000;
		border-bottom: 2px solid #000;
		font-family: 'Libre Baskerville', serif;
		font-size: 0.95rem;
	}

	thead th {
		font-weight: 400;
		font-style: italic;
		color: #555;
		padding: 0.45rem 0.5rem;
		border-bottom: 1px solid #000;
		text-align: left;
	}

	tbody td {
		padding: 0.45rem 0.5rem;
		border-bottom: 1px dotted #999;
	}
	tbody tr:last-child td {
		border-bottom: none;
	}

	.rank {
		width: 2.25rem;
		text-align: right;
		color: #555;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.name {
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.date {
		color: #777;
		text-align: right;
		width: 4.5rem;
	}

	tbody tr.gold td.rank,
	tbody tr.gold td.name {
		font-weight: 700;
	}
	tbody tr.gold td.rank::before {
		content: '★ ';
		color: #c9a227;
	}
	tbody tr.silver td.rank::before {
		content: '★ ';
		color: #9aa0a6;
	}
	tbody tr.bronze td.rank::before {
		content: '★ ';
		color: #b06b3a;
	}
</style>
