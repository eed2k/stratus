import React from "react";

export default function CloudAnimation({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`} aria-hidden="true">
      <div className="clouds absolute inset-0 pointer-events-none">
        <svg className="cloud cloud-1" viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg">
          <path fill="url(#g1)" d="M20 40c0-11 9-20 20-20 6 0 11 3 15 7 4-4 9-7 15-7 11 0 20 9 20 20H20z"/>
          <defs><linearGradient id="g1" x1="0" x2="1"><stop offset="0" stopColor="#e6f0ff"/><stop offset="1" stopColor="#cfe6ff"/></linearGradient></defs>
        </svg>
        <svg className="cloud cloud-2" viewBox="0 0 180 50" xmlns="http://www.w3.org/2000/svg">
          <path fill="url(#g2)" d="M10 30c0-8 7-15 15-15 5 0 9 2 12 5 3-3 7-5 12-5 9 0 15 7 15 15H10z"/>
          <defs><linearGradient id="g2" x1="0" x2="1"><stop offset="0" stopColor="#f2f9ff"/><stop offset="1" stopColor="#dceffd"/></linearGradient></defs>
        </svg>
      </div>
    </div>
  );
}
