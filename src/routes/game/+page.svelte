<script>
	import { onMount } from 'svelte';

	/** @type {HTMLDivElement} */
	let container;
	/** @type {import('phaser').Game | undefined} */
	let game;

	onMount(() => {
		// Phaser touches `window`, so import it only in the browser.
		let destroyed = false;
		import('$lib/game/SpaceInvaders.js').then(({ startGame }) => {
			if (destroyed) return;
			game = startGame(container);
		});

		return () => {
			destroyed = true;
			game?.destroy(true);
		};
	});
</script>

<svelte:head>
	<title>Space Invaders</title>
</svelte:head>

<div class="page">
	<h1>Space Invaders</h1>
	<p class="hint">← → to move &nbsp;·&nbsp; Space to shoot &nbsp;·&nbsp; R to restart</p>
	<div class="game" bind:this={container}></div>
	<a href="/" class="back">← Home</a>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-height: 100vh;
		margin: 0;
		padding: 1.5rem 0;
		gap: 0.75rem;
		font-family: 'Libre Baskerville', serif;
		background: #fff;
		color: #18181b;
	}

	h1 {
		font-size: 2rem;
		font-weight: 400;
		margin: 0;
	}

	.hint {
		font-family: monospace;
		color: #52525b;
		margin: 0;
	}

	.game {
		border: 2px solid #18181b;
		line-height: 0;
	}

	.back {
		font-family: monospace;
		color: #18181b;
		text-decoration: none;
		border-bottom: 1px solid transparent;
	}

	.back:hover {
		border-bottom-color: #18181b;
	}
</style>
