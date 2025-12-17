import React from 'react';
import { Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface TimeSeriesChartProps {
  data: {
    labels: string[];
    datasets: {
      label: string;
      data: number[];
      borderColor: string;
      backgroundColor: string;
    }[];
  };
}

const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({ data }) => {
  return (
    <div>
      <h2>Time Series Data</h2>
      <Line data={data} />
    </div>
  );
};

export default TimeSeriesChart;