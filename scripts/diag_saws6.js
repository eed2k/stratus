// Simulate dashboard fetch end-to-end via the storage layer
const path = require('path');
process.chdir('/app');

(async () => {
  // Compile + load via tsx? Server is already compiled in dist
  const { storage } = require('/app/dist/server/localStorage.js');

  for (const sid of [18, 19]) {
    console.log(`\n========== STATION ${sid} ==========`);
    const latest = await storage.getLatestWeatherData(sid);
    if (latest) {
      console.log('LATEST: timestamp=', latest.timestamp);
      console.log('  temperature=', latest.temperature);
      console.log('  humidity=', latest.humidity);
      console.log('  pressure=', latest.pressure);
      console.log('  windSpeed=', latest.windSpeed);
      console.log('  rainfall=', latest.rainfall);
      console.log('  mpptSolarVoltage=', latest.mpptSolarVoltage);
      console.log('  mpptBatteryVoltage=', latest.mpptBatteryVoltage);
      console.log('  mppt2SolarVoltage=', latest.mppt2SolarVoltage);
      console.log('  mppt2BatteryVoltage=', latest.mppt2BatteryVoltage);
    } else {
      console.log('NO LATEST');
    }
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 3600 * 1000);
    const range = await storage.getWeatherDataRange(sid, start, end);
    console.log(`24h range count: ${range.length}`);
    if (range.length) {
      const r = range[range.length - 1];
      console.log('  last: t=', r.temperature, 'h=', r.humidity, 'mppt1V=', r.mpptSolarVoltage, 'mppt2V=', r.mppt2SolarVoltage);
    }
  }
  process.exit(0);
})();
