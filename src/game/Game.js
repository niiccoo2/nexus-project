/** @param {HTMLCanvasElement} canvas */
export function startGame(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const groundHeight = 80;
    const groundY = canvas.height - groundHeight;

    ctx.fillStyle = '#5b9bd5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#4a7c3f';
    ctx.fillRect(0, groundY, canvas.width, groundHeight);
}
