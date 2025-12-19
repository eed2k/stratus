/**
 * Simulation Protocol Adapter
 * Generates realistic weather data for hardware-dependent protocols
 * Used when BLE, Serial, RF, and other hardware-requiring protocols are selected
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";

export class SimulationAdapter extends BaseProtocolAdapter {
  private baselineData: Record<string, number>;
  private simulationStartTime: Date;
  private updateCount: number = 0;

  constructor(config: ProtocolConfig) {
    super(config);
    this.simulationStartTime = new Date();
    
    this.baselineData = {
      temperature: 22 + Math.random() * 8,
      humidity: 45 + Math.random() * 30,
      pressure: 1010 + Math.random() * 20,
      windSpeed: 2 + Math.random() * 8,
      windDirection: Math.random() * 360,
      rainfall: 0,
      solarRadiation: 400 + Math.random() * 400,
      batteryVoltage: 12.4 + Math.random() * 0.4,
    };
  }

  async connect(): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
    
    this.setConnected(true);
    console.log(`[Simulation] Station ${this.config.stationId} connected (${this.config.connectionType} simulation)`);
    return true;
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();
    this.setConnected(false);
    console.log(`[Simulation] Station ${this.config.stationId} disconnected`);
  }

  async readData(): Promise<NormalizedWeatherData | null> {
    if (!this.status.connected) {
      return null;
    }

    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    this.updateCount++;
    const data = this.generateRealisticData();
    
    const normalized = this.normalizeData(data);
    this.emit("data", normalized);
    
    return normalized;
  }

  private generateRealisticData(): Record<string, number | null> {
    const now = new Date();
    const hourOfDay = now.getHours();
    const minuteOfHour = now.getMinutes();
    const dayProgress = (hourOfDay * 60 + minuteOfHour) / (24 * 60);

    const tempVariation = Math.sin((dayProgress - 0.25) * 2 * Math.PI) * 5;
    const cloudFactor = 0.7 + Math.random() * 0.3;
    const windVariation = Math.sin(this.updateCount * 0.1) * 2 + (Math.random() - 0.5) * 3;

    const temperature = this.baselineData.temperature + tempVariation + (Math.random() - 0.5) * 0.5;
    
    const humidity = Math.max(20, Math.min(95,
      this.baselineData.humidity - tempVariation * 2 + (Math.random() - 0.5) * 5
    ));

    const pressureChange = Math.sin(this.updateCount * 0.02) * 3;
    const pressure = this.baselineData.pressure + pressureChange + (Math.random() - 0.5) * 0.5;

    const windSpeed = Math.max(0, this.baselineData.windSpeed + windVariation);
    const windDirection = (this.baselineData.windDirection + this.updateCount * 2 + (Math.random() - 0.5) * 30) % 360;
    const windGust = windSpeed * (1.2 + Math.random() * 0.5);

    const isDaytime = hourOfDay >= 6 && hourOfDay <= 18;
    const solarAngle = isDaytime ? Math.sin((dayProgress - 0.25) * Math.PI) : 0;
    const solarRadiation = Math.max(0, solarAngle * 1000 * cloudFactor);

    const isRaining = Math.random() > 0.95;
    const rainfall = isRaining ? Math.random() * 5 : 0;

    const dewPoint = temperature - ((100 - humidity) / 5);

    const batteryVoltage = Math.max(11.5, Math.min(14.4,
      this.baselineData.batteryVoltage + (isDaytime ? 0.3 : -0.1) + (Math.random() - 0.5) * 0.1
    ));

    return {
      temperature: Math.round(temperature * 100) / 100,
      humidity: Math.round(humidity * 10) / 10,
      pressure: Math.round(pressure * 10) / 10,
      windSpeed: Math.round(windSpeed * 100) / 100,
      windDirection: Math.round(windDirection),
      windGust: Math.round(windGust * 100) / 100,
      rainfall: Math.round(rainfall * 100) / 100,
      solarRadiation: Math.round(solarRadiation),
      dewPoint: Math.round(dewPoint * 100) / 100,
      batteryVoltage: Math.round(batteryVoltage * 100) / 100,
    };
  }

  getStatus() {
    return {
      ...super.getStatus(),
      isSimulation: true,
      simulationRunning: this.status.connected,
      updatesGenerated: this.updateCount,
      simulationStartTime: this.simulationStartTime,
    };
  }
}
