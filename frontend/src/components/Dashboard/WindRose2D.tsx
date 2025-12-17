import React from 'react';

interface WindRose2DProps {
    data: Array<{ direction: number; speed: number }>;
}

const WindRose2D: React.FC<WindRose2DProps> = ({ data }) => {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                drawWindRose(ctx, data);
            }
        }
    }, [data]);

    const drawWindRose = (ctx: CanvasRenderingContext2D, data: Array<{ direction: number; speed: number }>) => {
        const radius = Math.min(ctx.canvas.width, ctx.canvas.height) / 2;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.translate(radius, radius);
        
        const maxSpeed = Math.max(...data.map(d => d.speed));
        const numDirections = 360; // Degrees
        const speedClasses = 5; // Number of speed classes
        const speedStep = maxSpeed / speedClasses;

        for (let i = 0; i < numDirections; i++) {
            const directionData = data.filter(d => Math.floor(d.direction) === i);
            const speedSum = directionData.reduce((sum, d) => sum + d.speed, 0);
            const averageSpeed = directionData.length > 0 ? speedSum / directionData.length : 0;

            const angle = (i * Math.PI) / 180;
            const innerRadius = (averageSpeed / maxSpeed) * radius;
            const outerRadius = radius;

            ctx.beginPath();
            ctx.moveTo(innerRadius * Math.cos(angle), innerRadius * Math.sin(angle));
            ctx.lineTo(outerRadius * Math.cos(angle), outerRadius * Math.sin(angle));
            ctx.lineTo(outerRadius * Math.cos(angle + Math.PI / 180), outerRadius * Math.sin(angle + Math.PI / 180));
            ctx.closePath();

            const color = `hsl(${(i / numDirections) * 360}, 100%, 50%)`;
            ctx.fillStyle = color;
            ctx.fill();
        }

        ctx.resetTransform();
    };

    return <canvas ref={canvasRef} width={400} height={400} />;
};

export default WindRose2D;