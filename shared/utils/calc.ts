export function convertCelsiusToFahrenheit(celsius: number): number {
    return (celsius * 9/5) + 32;
}

export function convertFahrenheitToCelsius(fahrenheit: number): number {
    return (fahrenheit - 32) * 5/9;
}

export function calculateAverage(values: number[]): number {
    const total = values.reduce((acc, value) => acc + value, 0);
    return total / values.length;
}

export function calculateWindChill(temperature: number, windSpeed: number): number {
    return 35.74 + 0.6215 * temperature - 35.75 * Math.pow(windSpeed, 0.16) + 0.4275 * temperature * Math.pow(windSpeed, 0.16);
}