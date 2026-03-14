// Stratus Weather System
// Created by Lukas Esterhuizen

import { useEffect, useRef, useCallback, useState } from "react";
import type { WeatherData } from "@shared/schema";

type WebSocketStatus = "connecting" | "connected" | "disconnected" | "error";

// Reconnection configuration constants
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;

interface UseWeatherWebSocketOptions {
  stationId: number | null;
  onUpdate?: (data: WeatherData) => void;
}

export function useWeatherWebSocket({ stationId, onUpdate }: UseWeatherWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [latestData, setLatestData] = useState<WeatherData | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const onUpdateRef = useRef(onUpdate);
  
  // Keep onUpdate ref current to avoid stale closures
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    setStatus("connecting");
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatus("connected");
      // Reset reconnect attempts on successful connection
      reconnectAttemptRef.current = 0;
      if (stationId !== null) {
        ws.send(JSON.stringify({ type: "subscribe", stationId }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === "weather_update" && message.stationId === stationId) {
          setLatestData(message.data);
          onUpdateRef.current?.(message.data);
        }
      } catch (error) {
        console.error("WebSocket message parse error:", error);
      }
    };

    ws.onerror = () => {
      setStatus("error");
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
      
      // Implement exponential backoff with max attempts
      if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptRef.current),
          MAX_RECONNECT_DELAY_MS
        );
        reconnectAttemptRef.current++;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        console.warn(`WebSocket: Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
      }
    };

    wsRef.current = ws;
  }, [stationId]); // Removed onUpdate from deps - using ref instead

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setStatus("disconnected");
  }, []);

  const subscribe = useCallback((newStationId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", stationId: newStationId }));
    }
  }, []);

  const unsubscribe = useCallback((targetStationId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "unsubscribe", stationId: targetStationId }));
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    if (stationId !== null && wsRef.current?.readyState === WebSocket.OPEN) {
      subscribe(stationId);
    }
  }, [stationId, subscribe]);

  // Manual reconnect that resets attempts counter
  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    disconnect();
    connect();
  }, [connect, disconnect]);

  return {
    status,
    latestData,
    subscribe,
    unsubscribe,
    disconnect,
    reconnect,
    reconnectAttempts: reconnectAttemptRef.current,
  };
}
