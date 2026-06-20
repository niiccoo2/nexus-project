<script>
    import { onMount } from 'svelte';
    import { startGame } from '../../game/Game.js';

    /** @type {HTMLCanvasElement} */
    let canvas;

    onMount(() => {
        startGame(canvas);
    });
</script>

<canvas bind:this={canvas}></canvas>

<style>
    canvas {
        display: block;
    }
</style>
