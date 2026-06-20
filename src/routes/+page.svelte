<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville&display=swap" rel="stylesheet" />
</svelte:head>

<div class="page">
	<h1>Home</h1>
	<div class="buttons">
		<a href="/game" class="btn">Game</a>
		<a href="https://github.com/niiccoo2/nexus-project" target="_blank" rel="noopener noreferrer" class="btn">Source Code</a>
	</div>

</div>

<style>

	.page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100vh;
		margin: 0;
		font-family: 'Libre Baskerville', serif;
		background: #fff;
	}


	h1 {
		font-size: 3rem;
		margin-bottom: 2rem;
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
		transition: background 0.2s, color 0.2s;
	}


	.btn:hover {
		background: #000;
		color: #fff;
	}


</style>
