import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

/**
 * Stratus Weather Station App
 * Credit: Lukas Esterhuizen
 */

const App = () => {
  return (
    <div className="min-h-screen bg-atmospheric-bg text-atmospheric-foreground">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <svg className="h-6 w-6 text-atmospheric-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 17H6a4 4 0 0 1 0-8 5 5 0 0 0-9.9-.6A3.5 3.5 0 0 0 6 17z" />
            </svg>
            <span className="text-xl font-semibold">Stratus</span>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-12">
        <div className="relative h-64 mb-12 overflow-hidden rounded-lg border border-atmospheric-primary/20">
          <div className="absolute inset-0 bg-gradient-to-b from-blue-50 to-white" />
          <svg className="cloud cloud-1 absolute" style={{width: '40%', top: '20%', left: '-40%'}} viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg">
            <path fill="url(#g1)" d="M20 40c0-11 9-20 20-20 6 0 11 3 15 7 4-4 9-7 15-7 11 0 20 9 20 20H20z"/>
            <defs><linearGradient id="g1" x1="0" x2="1"><stop offset="0" stopColor="#e6f0ff"/><stop offset="1" stopColor="#cfe6ff"/></linearGradient></defs>
          </svg>
        </div>
        
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl font-bold mb-4 text-atmospheric-primary">
            Stratus
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Modern weather station monitoring — Real-time telemetry, beautiful charts, and an atmospheric UI.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
              <h3 className="font-semibold text-lg mb-2">Research-Grade Data</h3>
              <p className="text-gray-600">Integrate with Campbell Scientific and Rika weather stations</p>
            </div>
            <div className="p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
              <h3 className="font-semibold text-lg mb-2">Real-Time Monitoring</h3>
              <p className="text-gray-600">Live weather data with configurable polling intervals</p>
            </div>
            <div className="p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
              <h3 className="font-semibold text-lg mb-2">Advanced Visualization</h3>
              <p className="text-gray-600">2D and 3D wind roses, charts, and statistics</p>
            </div>
          </div>

          <footer className="text-center text-sm text-gray-500 border-t pt-8">
            <p>Credit: Lukas Esterhuizen</p>
            <p className="mt-2">Stratus © 2025-2026. All rights reserved.</p>
          </footer>
        </div>
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
